/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.5 — Passing suite: short, through-ball, lofted, cross, with weight and rating-driven error
 * @story   US-4.2 — Pass, shoot, dribble, and cross
 * @design  06-game-design.md §3.2 (ball model, passing), 05-data-model.md §3.2 (soccer weights)
 * @invariant INV-1 (difficulty never touches ratings), INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: the four passes and everything that can go wrong on the way.
 *
 * **Weight is the soccer-shaped half, and basketball does not have it.** A basketball pass goes
 * wrong by being *aimed* wrong. A soccer pass mostly goes wrong by being hit too hard or not hard
 * enough: an underweighted through ball is cut out, an overweighted one runs through to the keeper,
 * and neither of those is a direction error. So error here has two independent components —
 * angular, and weight — and the second is the one the pass types differ most in. A through ball is
 * not a short pass aimed further; it is a short pass whose weight matters three times as much.
 *
 * **Grounded and aerial passes are genuinely different, so they are two code paths.** A ground pass
 * has no vertical component at all: it is released flat and rolls. Trying to express that through
 * `launchVelocity` produces a floated ten-metre pass with an eighty-centimetre apex, which is not a
 * pass anybody has ever played. Lofted balls and crosses do use `launchVelocity`, because an arc
 * over a defensive line is exactly what it computes.
 *
 * **Weighting a ground pass is a sum, not a solve.** The engine decays a rolling ball at
 * `rollingFriction` per second, which works out to a *linear* loss with distance (see
 * `ball.ts`'s `ROLL_DECAY_PER_METRE`). So the speed needed to arrive at `v` over `d` metres is
 * `v + k·d`, and the arrival speed of a mis-weighted pass is that arithmetic run backwards. An
 * underhit pass arrives slower; hit badly enough, it stops short, and the model produces that
 * without a special case for it.
 *
 * **The offside contract (T-6.3).** Offside is judged at the instant the ball is played. `throwPass`
 * calls `captureOffside` itself, at release, rather than trusting a caller to do it at the right
 * moment — the snapshot travels on the returned `PassInFlight` and is read when the ball arrives.
 * There is deliberately no way to build a `PassInFlight` with a snapshot taken at any other time.
 *
 * **Difficulty (INV-1).** One assist, on the player's side of the ball, touching no rating: `assist`
 * widens the cone `selectPassTarget` snaps within. It changes which teammate is *offered*, never
 * how well the pass is then struck.
 */
import { launchVelocity, release, type BallState } from '../../engine/physics/ball.ts';
import type { Rng } from '../../engine/rng.ts';
import { NO_ENTITY, type EntityId, type World } from '../../engine/world.ts';
import { ROLL_DECAY_PER_METRE, SOCCER_BALL_PHYSICS } from './ball.ts';
import { captureOffside, type OffsideSnapshot, type PlayerPosition } from './offside.ts';
import type { Side as PitchSide } from './pitch.ts';
import type { RestartKindName } from './rules.ts';

const TICK_RATE = 60;

/** The four passes `06` §3.2 asks for. */
export type PassKind = 'short' | 'through' | 'lofted' | 'cross';

/**
 * What a passer brings.
 *
 * Note what is *not* here: composure. Soccer's derived set (`05` §3.2) has no composure row —
 * composure is an attribute, and it is already spent inside `finishing`. So pressure is resisted by
 * the same rating that strikes the pass, which is the honest reading of the table rather than
 * inventing a thirteenth rating to make this file symmetrical with basketball's.
 */
export interface PasserRatings {
  readonly shortPass: number;
  readonly longPass: number;
  readonly crossing: number;
}

/** Which derived rating a pass type is struck with. */
type RatingKey = keyof PasserRatings;

export interface PassProfile {
  readonly rating: RatingKey;
  /** True for a ball played along the ground. */
  readonly grounded: boolean;
  /** Speed the ball should be travelling *on arrival*, m/s. What "weight" actually means. */
  readonly arrivalSpeed: number;
  /** Release speed is capped here, which is what puts a ceiling on a ground pass's range. */
  readonly maxSpeed: number;
  /** Aerial only: how much longer than a flat ball's the flight is. Higher is loopier. */
  readonly hang: number;
  /** Aerial only: metres above the ground the ball is struck from and arrives at. */
  readonly releaseHeight: number;
  readonly arrivalHeight: number;
  /** Angular error in radians for a 50-rated passer, unpressured, inside `errorFreeMetres`. */
  readonly baseError: number;
  readonly errorFreeMetres: number;
  readonly errorPerMetre: number;
  /** Fractional error on the weight for the same passer. The soccer-shaped half. */
  readonly weightError: number;
  /** How much spin the player's curve input can put on it. */
  readonly curveScale: number;
}

/**
 * The four passes, as numbers.
 *
 * @spec-ref 06-game-design.md §3.2 — short, through, lofted, cross
 *
 * The row that carries the design is `weightError`. A through ball's is three times a short pass's,
 * and that single figure is why one is the safe option and the other is the one that wins matches —
 * not a different code path, and not a lower success rate bolted on top.
 */
export const PASS_PROFILES: Readonly<Record<PassKind, PassProfile>> = {
  short: {
    rating: 'shortPass',
    grounded: true,
    arrivalSpeed: 7,
    maxSpeed: 20,
    hang: 1,
    releaseHeight: 0,
    arrivalHeight: 0,
    baseError: 0.03,
    errorFreeMetres: 10,
    errorPerMetre: 0.003,
    weightError: 0.05,
    curveScale: 0.2,
  },
  through: {
    rating: 'shortPass',
    grounded: true,
    // Played to *arrive* slower, so a runner can take it in stride rather than chase it.
    arrivalSpeed: 4.5,
    maxSpeed: 22,
    hang: 1,
    releaseHeight: 0,
    arrivalHeight: 0,
    baseError: 0.035,
    errorFreeMetres: 8,
    errorPerMetre: 0.004,
    // The defining risk of the pass, and the reason it is a different button.
    weightError: 0.15,
    curveScale: 0.25,
  },
  lofted: {
    rating: 'longPass',
    grounded: false,
    arrivalSpeed: 0,
    maxSpeed: 26,
    hang: 1.35,
    releaseHeight: 0.25,
    arrivalHeight: 0.6,
    baseError: 0.045,
    errorFreeMetres: 12,
    errorPerMetre: 0.0025,
    weightError: 0.1,
    curveScale: 0.5,
  },
  cross: {
    rating: 'crossing',
    grounded: false,
    arrivalSpeed: 0,
    maxSpeed: 28,
    hang: 1.15,
    releaseHeight: 0.3,
    // Head height: a cross that arrives at knee height is a bad cross, and this is where that
    // lives rather than in the header model.
    arrivalHeight: 1.9,
    baseError: 0.05,
    errorFreeMetres: 14,
    errorPerMetre: 0.003,
    weightError: 0.09,
    curveScale: 1,
  },
};

/** Half-angle of the cone target selection considers, before assist widens it. */
const SELECTION_CONE = Math.PI / 3;

/** A pass in the air (or on the grass), and what it needs to be judged on arrival. */
export interface PassInFlight {
  readonly kind: PassKind;
  readonly passer: EntityId;
  readonly side: PitchSide;
  /** Who it was aimed at, or `NO_ENTITY` for a ball played into space. */
  readonly target: EntityId;
  readonly releaseStep: number;
  /** After this step the ball is simply loose, not a pass. */
  readonly expireStep: number;
  /** Where it was actually aimed, after error — for the receiver to run onto. */
  readonly toX: number;
  readonly toY: number;
  /** How fast it will be going when it gets there. Negative-clamped: `0` means it fell short. */
  readonly arrivalSpeed: number;
  /**
   * The offside picture at the instant of release, or `null` if the caller supplied no squad
   * positions. Judged by `judgeOffside` when the ball is next touched (T-6.3).
   */
  readonly offside: OffsideSnapshot | null;
  /** Defenders who have already had a go at it — one read per defender, not one per step. */
  readonly contested: EntityId[];
}

/**
 * The release speed needed to arrive at a given speed, `d` metres away.
 *
 * `v0 = arrival + k·d`, straight out of `ROLL_DECAY_PER_METRE`. Capped, which is what gives a
 * ground pass a natural maximum range: past it, the ball is going as hard as it can be hit and
 * arrives slower and slower until it stops short.
 */
export function groundReleaseSpeed(profile: PassProfile, distance: number, weight = 1): number {
  const needed = (profile.arrivalSpeed + ROLL_DECAY_PER_METRE * distance) * weight;
  return Math.min(needed, profile.maxSpeed);
}

/** What a ground pass will actually be doing when it reaches the target. `0` if it never does. */
export function groundArrivalSpeed(releaseSpeed: number, distance: number): number {
  return Math.max(0, releaseSpeed - ROLL_DECAY_PER_METRE * distance);
}

/**
 * How long a ground pass takes to cover the distance.
 *
 * With speed falling linearly in distance the integral is a logarithm, not a division — and it has
 * to be, because the naive `distance / releaseSpeed` is optimistic by a quarter over any pass long
 * enough for the weight to matter, which is exactly the passes where the lead has to be right.
 */
export function groundFlightTime(releaseSpeed: number, distance: number): number {
  const arrival = groundArrivalSpeed(releaseSpeed, distance);
  if (arrival <= 0) return distance / Math.max(releaseSpeed, 0.1);
  return Math.log(releaseSpeed / arrival) / ROLL_DECAY_PER_METRE;
}

/** Flight time for an aerial pass: a flat ball's, stretched by the profile's hang. */
export function airFlightTime(profile: PassProfile, distance: number): number {
  const flat = distance / profile.maxSpeed;
  return Math.max(flat * profile.hang, 0.2);
}

/**
 * The error a passer puts on the ball: angular, and on the weight.
 *
 * Both scale with the rating and with pressure; only the angular half scales with distance, because
 * over-hitting is a matter of how cleanly the ball was struck rather than of how far it had to go.
 *
 * @spec-ref 06-game-design.md §3.2 — rating-driven error, never a flat miss rate
 */
export function passError(
  profile: PassProfile,
  ratings: PasserRatings,
  distance: number,
  pressure: number,
): { angle: number; weight: number } {
  const rating = ratings[profile.rating];
  const skill = 1 - 0.75 * (rating / 100);
  const nerve = 1 + 1.5 * clamp01(pressure) * (1 - rating / 200);
  const reach = 1 + Math.max(0, distance - profile.errorFreeMetres) * profile.errorPerMetre;

  return {
    angle: profile.baseError * skill * nerve * reach,
    weight: profile.weightError * skill * nerve,
  };
}

/**
 * Pass assist (`06` §2): the teammate closest to where the player is aiming.
 *
 * `assist` widens the cone — difficulty's only lever here, and it changes *which teammate is
 * offered*, never how well the pass is then struck (INV-1).
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
  const cone = Math.min(Math.PI, SELECTION_CONE * assist);

  let best = NO_ENTITY;
  let bestScore = -Infinity;

  for (const id of candidates) {
    const dx = (world.x[id] as number) - from.x;
    const dy = (world.y[id] as number) - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.5) continue;

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
    const score = cos * 2 - distance / 105;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }

  return best;
}

/**
 * Where to play the ball so it and a moving receiver arrive together.
 *
 * Two iterations, for the same reason basketball's needs two: the first estimate uses the
 * receiver's current position, which is wrong precisely when the lead matters — someone running
 * into a channel — and the second uses the first's flight time and is close enough that a third
 * changes nothing a player could see.
 *
 * A through ball leads *further* than the receiver's own velocity implies, by `runOn` metres, which
 * is the difference between a pass to feet and a pass into space.
 */
export function leadTarget(
  world: World,
  from: { x: number; y: number },
  receiver: EntityId,
  kind: PassKind,
  runOn = 0,
): { x: number; y: number; flightTime: number } {
  const profile = PASS_PROFILES[kind];
  const rx = world.x[receiver] as number;
  const ry = world.y[receiver] as number;
  const vx = world.vx[receiver] as number;
  const vy = world.vy[receiver] as number;

  const heading = Math.hypot(vx, vy);
  const aheadX = heading > 0.1 ? (vx / heading) * runOn : 0;
  const aheadY = heading > 0.1 ? (vy / heading) * runOn : 0;

  let x = rx;
  let y = ry;
  let t = 0;
  for (let i = 0; i < 2; i++) {
    const distance = Math.hypot(x - from.x, y - from.y);
    t = profile.grounded
      ? groundFlightTime(groundReleaseSpeed(profile, distance), distance)
      : airFlightTime(profile, distance);
    x = rx + vx * t + aheadX;
    y = ry + vy * t + aheadY;
  }

  return { x, y, flightTime: Math.max(t, 0.05) };
}

/** Everything a pass attempt needs beyond the world. */
export interface PassAttempt {
  readonly kind: PassKind;
  readonly passer: EntityId;
  readonly side: PitchSide;
  /** Who it is aimed at, or `NO_ENTITY` for a ball into space. */
  readonly target: EntityId;
  readonly toX: number;
  readonly toY: number;
  readonly ratings: PasserRatings;
  /** `0–1`. How hard the passer is being closed down. */
  readonly pressure: number;
  /** `-1…1`, the bend the player asked for. */
  readonly curve?: number;
  /** `0–1`+, a deliberate over- or under-hit on the player's part. `1` is the natural weight. */
  readonly power?: number;
}

/**
 * The squad picture, for the offside snapshot taken at release.
 *
 * Optional as a whole: a rules test, a practice mode, or an arcade mini-game has no eleven-a-side
 * shape to offer, and offside cannot apply to something with no defensive line.
 */
export interface PassContext {
  readonly attackers: readonly PlayerPosition[];
  readonly defenders: readonly PlayerPosition[];
  /** The restart the ball is played from, or `null` in open play. */
  readonly restartKind?: RestartKindName | null;
}

/**
 * Strikes the pass: applies the error, releases the ball, and freezes the offside picture.
 *
 * The offside capture happens *here*, at release, and nowhere else — that is T-6.3's contract, and
 * putting it inside this function is what makes it impossible to honour late.
 */
export function throwPass(
  world: World,
  ball: BallState,
  attempt: PassAttempt,
  step: number,
  rng: Rng,
  context?: PassContext,
): PassInFlight {
  const profile = PASS_PROFILES[attempt.kind];
  const fromX = world.x[attempt.passer] as number;
  const fromY = world.y[attempt.passer] as number;

  const dx = attempt.toX - fromX;
  const dy = attempt.toY - fromY;
  const distance = Math.max(Math.hypot(dx, dy), 0.5);

  const error = passError(profile, attempt.ratings, distance, attempt.pressure);
  const angle = Math.atan2(dy, dx) + rng.float(-1, 1) * error.angle;
  const weight = (attempt.power ?? 1) * (1 + rng.float(-1, 1) * error.weight);

  const aimedX = fromX + Math.cos(angle) * distance;
  const aimedY = fromY + Math.sin(angle) * distance;

  const spin = (attempt.curve ?? 0) * profile.curveScale;
  const flight = profile.grounded
    ? releaseGrounded(world, ball, profile, angle, distance, weight, spin)
    : releaseAerial(world, ball, profile, fromX, fromY, aimedX, aimedY, distance, weight, spin);

  const offside =
    context === undefined
      ? null
      : captureOffside(
          attempt.side,
          attempt.passer,
          fromX,
          context.attackers,
          context.defenders,
          context.restartKind ?? null,
        );

  return {
    kind: attempt.kind,
    passer: attempt.passer,
    side: attempt.side,
    target: attempt.target,
    releaseStep: step,
    expireStep: step + Math.round(flight.time * TICK_RATE) + TICK_RATE,
    toX: aimedX,
    toY: aimedY,
    arrivalSpeed: flight.arrivalSpeed,
    offside,
    contested: [],
  };
}

function releaseGrounded(
  world: World,
  ball: BallState,
  profile: PassProfile,
  angle: number,
  distance: number,
  weight: number,
  spin: number,
): { time: number; arrivalSpeed: number } {
  const speed = groundReleaseSpeed(profile, distance, weight);
  release(world, ball, Math.cos(angle) * speed, Math.sin(angle) * speed, 0, spin);
  return {
    time: groundFlightTime(speed, distance),
    arrivalSpeed: groundArrivalSpeed(speed, distance),
  };
}

function releaseAerial(
  world: World,
  ball: BallState,
  profile: PassProfile,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  distance: number,
  weight: number,
  spin: number,
): { time: number; arrivalSpeed: number } {
  // Weight on an aerial ball buys *time*, not speed: an over-hit cross is one that sails long,
  // which in flight terms is a flatter, faster ball that arrives past its target.
  const time = airFlightTime(profile, distance) / Math.max(weight, 0.3);
  const velocity = { x: 0, y: 0, z: 0 };
  launchVelocity(
    fromX,
    fromY,
    profile.releaseHeight,
    toX,
    toY,
    profile.arrivalHeight,
    time,
    SOCCER_BALL_PHYSICS.gravity,
    velocity,
  );
  release(world, ball, velocity.x, velocity.y, velocity.z, spin);
  return { time, arrivalSpeed: Math.hypot(velocity.x, velocity.y) };
}

/** Whether a pass is still a pass, or has become a loose ball. */
export function isLive(pass: PassInFlight, step: number): boolean {
  return step <= pass.expireStep;
}

/** Records that a defender has had their one read at this pass. */
export function markContested(pass: PassInFlight, defender: EntityId): boolean {
  if (pass.contested.includes(defender)) return false;
  pass.contested.push(defender);
  return true;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
