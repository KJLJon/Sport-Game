/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.4 — Passing: aimed, lead passes, interceptions, turnovers
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  06-game-design.md §2 (aimed passing, pass assist), §3.1, §7 (difficulty assists),
 *          05-data-model.md §3.1 (passing weights)
 * @invariant INV-1 (difficulty never touches ratings), INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: getting the ball from one athlete to another, and everything that can go wrong on the
 * way. Target selection, the lead a moving receiver needs, the error a rushed passer puts on it,
 * and the defender who reads it.
 *
 * **Why a pass is flown rather than resolved.** Unlike a shot (see `shooting.ts`, which decides at
 * release and aims to match), a pass has no fixed outcome to draw for: whether it arrives depends on
 * where five defenders happen to be while it is in the air. So the ball is thrown with a real
 * velocity and a real error, and interceptions fall out of proximity — which is also what makes
 * jumping a lane a thing a *player* can do rather than a die the sim rolls for them.
 *
 * **Difficulty (INV-1).** Two assists, both on the player's side of the ball and neither touching a
 * rating: `assist` widens the cone target selection snaps within, and that is all.
 */
import type { Rng } from '../../engine/rng.ts';
import {
  attemptCatch,
  canCatch,
  launchVelocity,
  release,
  type BallState,
} from '../../engine/physics/ball.ts';
import { DEFAULT_BALL_PHYSICS } from '../../engine/physics/ball.ts';
import { NO_ENTITY, type EntityId, type World } from '../../engine/world.ts';

/** What a passer brings. `05` §3.1's `passing` row is awareness-heavy, and this is why. */
export interface PasserRatings {
  readonly passing: number;
  readonly composure: number;
}

/** What a receiver brings to holding on to it. */
export interface ReceiverRatings {
  readonly ballHandling: number;
}

/** What a defender brings to reading it. */
export interface InterceptorRatings {
  readonly perimeterD: number;
}

export const PASSING = {
  /** Metres per second at the slowest and fastest a pass is thrown. */
  minSpeed: 8,
  maxSpeed: 17,
  /** Height a chest pass travels at — low enough to be jumped, high enough to clear the floor. */
  height: 1.35,

  /** Angular error in radians for a 50-rated passer, clean, at a middling distance. */
  baseError: 0.05,
  /** How much of the error a perfect passing rating removes. */
  ratingRelief: 0.75,
  /** Pressure multiplies the error by up to this. */
  pressureWeight: 1.6,
  /** And so does distance, per metre past `errorFreeMetres`. */
  errorFreeMetres: 4,
  errorPerMetre: 0.04,

  /** Half-angle of the cone target selection considers, in radians, before assist widens it. */
  selectionCone: Math.PI / 3,

  /** Reach for taking a pass out of the air, and the height it can be taken at. */
  catchReach: 1.15,
  catchHeight: 2.3,

  /** Control floor and span for a receiver's catch draw. */
  catchFloor: 0.55,
  catchSpan: 0.42,
  /** A fast ball is harder to hold. */
  catchSpeedPenalty: 0.02,

  /** An interceptor's chance, from their defensive rating. */
  interceptFloor: 0.1,
  interceptSpan: 0.35,
  /**
   * Steps of flight before a pass can be picked off. Without it, the defender already draped over
   * the passer is inside catching range the instant the ball leaves the hand, and every pass out of
   * pressure is an interception. Taking it out of someone's hands is a steal, which is T-2.7's.
   */
  interceptDelaySteps: 6,

  /** Steps after the ball should have arrived before a pass stops being a pass. */
  graceSteps: 30,
} as const;

/** A pass currently in the air. */
export interface PassInFlight {
  readonly passer: EntityId;
  readonly side: 0 | 1;
  /** Who it was aimed at, or `NO_ENTITY` for a pass thrown at space. */
  readonly target: EntityId;
  readonly releaseStep: number;
  /** After this step the ball is simply loose, not a pass. */
  readonly expireStep: number;
  readonly leadDistance: number;
  /**
   * Who has already had a go at it. A pass spends ten-odd steps inside a defender's reach, and
   * without this they get ten-odd rolls — which turns any pass near anybody into an interception.
   * One read per defender per pass is also the honest model: you jump the lane or you do not.
   */
  readonly contested: EntityId[];
}

/** Throw speed for a distance and a power input, so a short pass is not a rocket. */
export function passSpeed(distance: number, power = 1): number {
  const byDistance =
    PASSING.minSpeed + Math.min(1, distance / 14) * (PASSING.maxSpeed - PASSING.minSpeed);
  return clamp(byDistance * power, PASSING.minSpeed * 0.6, PASSING.maxSpeed);
}

/**
 * Where to throw so the ball and a moving receiver arrive together.
 *
 * Two iterations rather than one: the first estimate uses the receiver's current position, which is
 * wrong precisely when the lead matters — a receiver cutting hard. The second uses the first
 * estimate's flight time and is close enough that a third changes nothing a player could see.
 */
export function leadTarget(
  world: World,
  from: { x: number; y: number },
  receiver: EntityId,
  power = 1,
): { x: number; y: number; flightTime: number } {
  const rx = world.x[receiver] as number;
  const ry = world.y[receiver] as number;
  const vx = world.vx[receiver] as number;
  const vy = world.vy[receiver] as number;

  let x = rx;
  let y = ry;
  let t = 0;
  for (let i = 0; i < 2; i++) {
    const distance = Math.hypot(x - from.x, y - from.y);
    t = distance / passSpeed(distance, power);
    x = rx + vx * t;
    y = ry + vy * t;
  }

  return { x, y, flightTime: Math.max(t, 0.05) };
}

/**
 * Angular error, in radians, that a passer puts on the throw. Distance and pressure both make it
 * worse; the rating and composure buy it back.
 *
 * @spec-ref 06-game-design.md §3.1 — execution error scales with rating, not with difficulty
 */
export function passError(ratings: PasserRatings, distance: number, pressure: number): number {
  const skill = 1 - PASSING.ratingRelief * (ratings.passing / 100);
  const nerve = 1 + PASSING.pressureWeight * clamp01(pressure) * (1 - ratings.composure / 200);
  const reach = 1 + Math.max(0, distance - PASSING.errorFreeMetres) * PASSING.errorPerMetre;
  return PASSING.baseError * skill * nerve * reach;
}

/**
 * Pass assist (`06` §2): pick the teammate closest to where the player is aiming.
 *
 * `assist` widens the cone — difficulty's only lever here, and it changes *which teammate is
 * offered*, never how well the pass is then thrown (INV-1).
 */
export function selectPassTarget(
  world: World,
  from: { x: number; y: number },
  aimX: number,
  aimY: number,
  candidates: readonly EntityId[],
  assist = 1,
): EntityId {
  const aimLength = Math.hypot(aimX, aimY);
  const cone = Math.min(Math.PI, PASSING.selectionCone * assist);

  let best = NO_ENTITY;
  let bestScore = -Infinity;

  for (const id of candidates) {
    const dx = (world.x[id] as number) - from.x;
    const dy = (world.y[id] as number) - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.5) continue;

    // With no aim input, the nearest teammate is the offer.
    if (aimLength < 1e-3) {
      if (-distance > bestScore) {
        bestScore = -distance;
        best = id;
      }
      continue;
    }

    const cos = (dx * aimX + dy * aimY) / (distance * aimLength);
    if (Math.acos(clamp(cos, -1, 1)) > cone) continue;

    // Straight ahead beats close by: a pass is aimed, not merely nearby.
    const score = cos * 2 - distance / 28;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }

  return best;
}

/** Puts a pass in the air towards a target point, with the passer's error on it. */
export function throwPass(
  world: World,
  ball: BallState,
  passer: EntityId,
  side: 0 | 1,
  target: EntityId,
  toX: number,
  toY: number,
  flightTime: number,
  ratings: PasserRatings,
  pressure: number,
  step: number,
  rng: Rng,
): PassInFlight {
  const fromX = world.x[passer] as number;
  const fromY = world.y[passer] as number;

  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);

  // Error is angular, so a long pass misses by more metres than a short one for the same skill.
  const spread = rng.float(-1, 1) * passError(ratings, distance, pressure);
  const angle = Math.atan2(dy, dx) + spread;
  const aimedX = fromX + Math.cos(angle) * distance;
  const aimedY = fromY + Math.sin(angle) * distance;

  const velocity = { x: 0, y: 0, z: 0 };
  launchVelocity(
    fromX,
    fromY,
    PASSING.height,
    aimedX,
    aimedY,
    PASSING.height,
    flightTime,
    DEFAULT_BALL_PHYSICS.gravity,
    velocity,
  );

  release(world, ball, velocity.x, velocity.y, velocity.z);

  const flightSteps = Math.round(flightTime * 60);
  return {
    passer,
    side,
    target,
    releaseStep: step,
    expireStep: step + flightSteps + PASSING.graceSteps,
    leadDistance: distance,
    contested: [],
  };
}

/** How likely a receiver is to hold on to it. A fast ball into traffic is not a given. */
export function catchControl(ratings: ReceiverRatings, ballSpeed: number): number {
  const skill = PASSING.catchFloor + PASSING.catchSpan * (ratings.ballHandling / 100);
  return clamp01(skill - PASSING.catchSpeedPenalty * Math.max(0, ballSpeed - PASSING.minSpeed));
}

/**
 * How likely a defender is to come up with a ball they have got a hand to.
 *
 * Deliberately below a receiver's control at the same rating: a pass into a covered lane should
 * mostly be *deflected*, not picked clean, because a deflection keeps the ball live and a steal
 * ends the possession.
 */
export function interceptControl(ratings: InterceptorRatings): number {
  return clamp01(PASSING.interceptFloor + PASSING.interceptSpan * (ratings.perimeterD / 100));
}

/** Whether an athlete can get a hand to the ball this step. */
export function canIntercept(world: World, ball: BallState, athlete: EntityId): boolean {
  return canCatch(world, ball, athlete, PASSING.catchReach, PASSING.catchHeight);
}

/** Speed of the ball right now, for the catch and intercept draws. */
export function ballSpeed(world: World, ball: BallState): number {
  return Math.hypot(world.vx[ball.entity] as number, world.vy[ball.entity] as number);
}

/** A contested attempt on a pass. Returns whether it was taken cleanly. */
export function contest(
  world: World,
  ball: BallState,
  athlete: EntityId,
  control: number,
  rng: Rng,
): boolean {
  return attemptCatch(world, ball, athlete, control, rng);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
