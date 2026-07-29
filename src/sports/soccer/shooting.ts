/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.6 — Shooting: power meter, placement, curve, deflections
 * @story   US-4.2 — Pass, shoot, dribble, and cross
 * @design  06-game-design.md §3.2 (shooting, ball model), §2 (controls),
 *          05-data-model.md §3.2 (soccer weights)
 * @invariant INV-1 (difficulty never touches ratings), INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: turning a held button and a joystick into a ball flying at a specific point of the goal,
 * and everything between there and the net.
 *
 * **Placement error, not angular error.** A pass misses by an angle; a shot misses *the goal*, and
 * the goal is a rectangle. So the error here is applied in the plane of the goal mouth — metres
 * across and metres up — which is what makes "he pulled it wide" and "he skied it" different
 * outcomes with different causes rather than one number pointing in a random direction. It also
 * means the model composes with `goalOpenness`: a tight angle shrinks the target the same error is
 * being sprayed across, with no extra term to say so.
 *
 * **Power is a trade, not a bonus.** More power is more speed and more error, and the meter is the
 * player agreeing to that trade. A shot at full power from thirty metres is meant to be a bad idea
 * most of the time and a wonderful one occasionally; a shot at half power from six yards is the
 * placed finish. If power were free, there would be no meter, only a shoot button.
 *
 * **Curve comes from approach angle and `coordination` — and that is an *attribute*.** `06` §3.2
 * says so in as many words. Soccer's derived ratings (`05` §3.2) have no coordination row, so this
 * is the one place in the sport module that reads an attribute directly rather than a rating
 * derived from it. Flagged rather than quietly substituted, because "use the nearest rating
 * instead" would have been the easy wrong answer and would have made the spec line untrue.
 *
 * **Difficulty (INV-1).** Nothing here. Shooting assists live in the control layer, and no
 * difficulty term touches speed, error, or curve.
 */
import { launchVelocity, release, type BallState } from '../../engine/physics/ball.ts';
import type { Rng } from '../../engine/rng.ts';
import type { EntityId, World } from '../../engine/world.ts';
import { SOCCER_BALL_PHYSICS } from './ball.ts';
import {
  PITCH,
  attackedGoal,
  goalOpenness,
  shotDistance,
  type Side as PitchSide,
} from './pitch.ts';

const TICK_RATE = 60;

/**
 * What a shooter brings.
 *
 * `finishing` and `shotPower` are derived ratings from `05` §3.2. `coordination` is an attribute —
 * see the header; `06` §3.2 names it directly for curve.
 */
export interface ShooterRatings {
  readonly finishing: number;
  readonly shotPower: number;
  readonly coordination: number;
}

export const SHOOTING = {
  /** Real seconds to fill the power meter from empty. */
  chargeRealSeconds: 0.8,
  /** Power below which the meter is treated as a tap — a placed side-foot finish. */
  tapPower: 0.35,

  /** Ball speed, m/s, at zero power and at full power for a 50-rated `shotPower`. */
  minSpeed: 14,
  maxSpeed: 26,
  /** How much a perfect `shotPower` adds to the top end, m/s. */
  powerRatingBonus: 10,

  /**
   * Placement error in metres, at the goal mouth, for a 50-rated finisher taking an unpressured
   * tap from `errorFreeMetres` out. Everything else multiplies this.
   */
  baseError: 0.55,
  /** How much of the error a perfect `finishing` removes. */
  ratingRelief: 0.7,
  /** Full power multiplies the error by up to this — the trade the meter is offering. */
  powerWeight: 1.5,
  /** Pressure does too. */
  pressureWeight: 1.4,
  errorFreeMetres: 8,
  errorPerMetre: 0.045,
  /** Vertical error is smaller than horizontal: skying it is rarer than dragging it wide. */
  verticalErrorScale: 0.6,

  /** Spin, in rad/s, a full sideways approach puts on the ball for a perfect `coordination`. */
  maxCurve: 9,
  /** Approach angles below this put no meaningful bend on it. */
  curveDeadZone: 0.15,

  /** How much of its speed a deflected ball keeps. */
  deflectionSpeedLoss: 0.45,
  /** Widest angle, in radians, a deflection turns the ball through. */
  deflectionSpread: 0.5,
} as const;

const CHARGE_STEPS = SHOOTING.chargeRealSeconds * TICK_RATE;
const GOAL_HALF_WIDTH = PITCH.goalWidth / 2;

/** Meter fill from how long the button has been held, `0–1`. */
export function chargePower(heldSteps: number): number {
  return clamp01(heldSteps / CHARGE_STEPS);
}

/**
 * How fast the ball leaves the boot.
 *
 * `shotPower` raises the ceiling rather than the floor: a weak striker's tap and a strong one's tap
 * are the same shot, and the difference shows up only when both wind up.
 */
export function shotSpeed(ratings: ShooterRatings, power: number): number {
  const ceiling = SHOOTING.maxSpeed + SHOOTING.powerRatingBonus * (ratings.shotPower / 100);
  return SHOOTING.minSpeed + clamp01(power) * (ceiling - SHOOTING.minSpeed);
}

/** A point on the goal mouth, in world terms: across the mouth, and above the ground. */
export interface AimPoint {
  readonly y: number;
  readonly z: number;
}

/**
 * Where the joystick is pointing, as a point in the goal.
 *
 * `place` runs `-1…1` across the mouth and `0…1` up it. Both are pulled inside the frame by
 * `inset`, because aiming at the exact junction of post and bar is not placement, it is a coin
 * toss — the player asking for the top corner should get *near* the top corner.
 */
export function aimPoint(placeAcross: number, placeUp: number, inset = 0.35): AimPoint {
  const across = clamp(placeAcross, -1, 1) * Math.max(0, GOAL_HALF_WIDTH - inset);
  const up = clamp01(placeUp) * Math.max(0, PITCH.goalHeight - inset);
  return { y: PITCH.width / 2 + across, z: Math.max(0.1, up) };
}

/**
 * Placement error, in metres at the goal mouth.
 *
 * Distance, power, and pressure all make it worse; `finishing` buys it back. Returned as a pair
 * because the two axes are not equally hard — dragging a shot wide is commoner than ballooning it.
 *
 * @spec-ref 06-game-design.md §3.2 — execution error scales with rating, never with difficulty
 */
export function placementError(
  ratings: ShooterRatings,
  distance: number,
  power: number,
  pressure: number,
): { across: number; up: number } {
  const skill = 1 - SHOOTING.ratingRelief * (ratings.finishing / 100);
  const wind = 1 + SHOOTING.powerWeight * clamp01(power);
  const nerve = 1 + SHOOTING.pressureWeight * clamp01(pressure) * (1 - ratings.finishing / 200);
  const reach = 1 + Math.max(0, distance - SHOOTING.errorFreeMetres) * SHOOTING.errorPerMetre;

  const across = SHOOTING.baseError * skill * wind * nerve * reach;
  return { across, up: across * SHOOTING.verticalErrorScale };
}

/**
 * Spin from the angle the shooter is running at relative to where they are shooting.
 *
 * @spec-ref 06-game-design.md §3.2 — "curve comes from approach angle and `coordination`"
 *
 * Zero when running straight at goal, most when cutting across the ball. The sign follows the
 * approach, so a right-sided run curls the ball back towards the near post the way a real one does
 * — the player never asks for curve, they earn it by the run they made, which is the whole appeal
 * of the mechanic.
 */
export function curveFrom(approachAngle: number, coordination: number): number {
  const angle = normalise(approachAngle);
  const magnitude = Math.abs(angle) / Math.PI;
  if (magnitude < SHOOTING.curveDeadZone) return 0;

  const scaled = (magnitude - SHOOTING.curveDeadZone) / (1 - SHOOTING.curveDeadZone);
  return -Math.sign(angle) * scaled * SHOOTING.maxCurve * (coordination / 100);
}

export interface ShotAttempt {
  readonly shooter: EntityId;
  readonly side: PitchSide;
  readonly ratings: ShooterRatings;
  /** `0–1` from the meter. */
  readonly power: number;
  /** Joystick placement: `-1…1` across the mouth, `0…1` up it. */
  readonly placeAcross: number;
  readonly placeUp: number;
  /** `0–1`, how closely the shooter is being closed down. */
  readonly pressure: number;
  /**
   * The shooter's run direction relative to the line to goal, in radians. `0` is running straight
   * at it. Drives curve, and nothing else.
   */
  readonly approachAngle: number;
}

export interface ShotInFlight {
  readonly shooter: EntityId;
  readonly side: PitchSide;
  readonly releaseStep: number;
  /** Where it is actually going, after error — not where it was aimed. */
  readonly aim: AimPoint;
  readonly speed: number;
  readonly spin: number;
  /** Distance the shot was struck from. */
  readonly distance: number;
  /** How much of the goal was on offer, `0–1`. The honest measure of the chance. */
  readonly openness: number;
  /** Whether anything has already deflected it. A ball only takes one wicked deflection. */
  deflected: boolean;
}

/**
 * Strikes the shot: resolves power, placement, and curve, and puts the ball in the air.
 *
 * Nothing here decides whether it goes in. The ball is given a real velocity towards a real point
 * and the keeper (T-6.9), the defenders, and `isGoal` settle it between them — the same reason
 * passes are flown rather than resolved, and the reason a save is something a *player* can make.
 */
export function takeShot(
  world: World,
  ball: BallState,
  attempt: ShotAttempt,
  step: number,
  rng: Rng,
): ShotInFlight {
  const fromX = world.x[attempt.shooter] as number;
  const fromY = world.y[attempt.shooter] as number;
  const goal = attackedGoal(attempt.side);

  const distance = Math.max(shotDistance(fromX, fromY, attempt.side), 0.5);
  const openness = goalOpenness(fromX, fromY, attempt.side);

  const target = aimPoint(attempt.placeAcross, attempt.placeUp);
  const error = placementError(attempt.ratings, distance, attempt.power, attempt.pressure);

  const aim: AimPoint = {
    y: target.y + rng.float(-1, 1) * error.across,
    z: Math.max(0, target.z + rng.float(-1, 1) * error.up),
  };

  const speed = shotSpeed(attempt.ratings, attempt.power);
  const spin = curveFrom(attempt.approachAngle, attempt.ratings.coordination);

  // Flight time from the straight-line distance to the aim point, so a shot into the far corner
  // is in the air longer than one straight down the middle — which is what gives a keeper a chance.
  const flightDistance = Math.hypot(goal.x - fromX, aim.y - fromY);
  const flightTime = Math.max(flightDistance / speed, 0.05);

  const velocity = { x: 0, y: 0, z: 0 };
  launchVelocity(
    fromX,
    fromY,
    SOCCER_BALL_PHYSICS.radius,
    goal.x,
    aim.y,
    aim.z,
    flightTime,
    SOCCER_BALL_PHYSICS.gravity,
    velocity,
  );
  release(world, ball, velocity.x, velocity.y, velocity.z, spin);

  return {
    shooter: attempt.shooter,
    side: attempt.side,
    releaseStep: step,
    aim,
    speed,
    spin,
    distance,
    openness,
    deflected: false,
  };
}

/**
 * A defender gets something on it.
 *
 * The ball is turned through a seeded angle and slowed, and the shot is marked so it cannot be
 * deflected twice — a ball that ricochets off three legs in a row is a physics bug, not drama. The
 * turn is applied in the horizontal plane only: a boot that lifts a shot over the bar is a
 * different event, and it is the keeper's model (T-6.9) that owns it.
 *
 * Returns whether the deflection actually happened, so the caller can emit or not.
 */
export function deflectShot(world: World, ball: BallState, shot: ShotInFlight, rng: Rng): boolean {
  if (shot.deflected) return false;
  shot.deflected = true;

  const vx = world.vx[ball.entity] as number;
  const vy = world.vy[ball.entity] as number;
  const speed = Math.hypot(vx, vy);
  if (speed <= 0) return false;

  const turn = rng.float(-1, 1) * SHOOTING.deflectionSpread;
  const angle = Math.atan2(vy, vx) + turn;
  const slowed = speed * (1 - SHOOTING.deflectionSpeedLoss);

  world.vx[ball.entity] = Math.cos(angle) * slowed;
  world.vy[ball.entity] = Math.sin(angle) * slowed;
  // A deflection kills the bend: the ball is no longer spinning the way it was struck.
  ball.spin = 0;
  return true;
}

function normalise(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
