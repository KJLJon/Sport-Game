/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.6 — Ball physics: position + height, gravity, bounce, spin/curve, possession
 * @story   US-3.2 — Shoot, drive, pass, and rebound; US-4.2 — Soccer that feels like soccer
 * @design  04-architecture.md §6, 06-game-design.md §3.1
 * @invariant INV-2 (no unseeded randomness), INV-8 (determinism)
 *
 * Purpose: the one object every sport in this game is actually about. It flies, bounces, rolls,
 * curves, and belongs to somebody or to nobody — and all five behaviours are sport-agnostic.
 * Basketball and soccer differ in the constants they pass, not in the physics they get.
 *
 * The ball lives in the same `World` as the athletes, using `z`/`vz`, so neighbour queries find it
 * for free. Possession is a state the *ball* holds rather than a flag on an athlete: exactly one
 * carrier can exist, which makes "who has it" unambiguous at every instant, and makes losing it a
 * single assignment instead of a search.
 */
import type { EntityId, World } from '../world.ts';
import { Flags, NO_ENTITY } from '../world.ts';
import type { Rng } from '../rng.ts';

/** Sport-supplied physical constants. Every value is in metres, seconds, or kilograms. */
export interface BallPhysics {
  /** Downward acceleration, m/s². Earth unless a sport wants otherwise. */
  readonly gravity: number;
  /** Fraction of vertical speed kept after a bounce. Basketball ≈ 0.75, soccer ≈ 0.6. */
  readonly restitution: number;
  /** Fraction of horizontal speed kept after a bounce — the surface grabbing the ball. */
  readonly friction: number;
  /** Per-second horizontal speed decay while rolling on the ground. */
  readonly rollingFriction: number;
  /** Per-second decay of speed through the air. */
  readonly drag: number;
  /** How strongly spin curves flight, in m/s² per (rad/s × m/s). */
  readonly magnus: number;
  /** Per-second decay of spin. */
  readonly spinDecay: number;
  /** Ball radius, m. Used for the resting height and for catch range. */
  readonly radius: number;
}

/**
 * Basketball-ish defaults. A sport module overrides what it needs; these exist so the engine's
 * own tests and the T-1.11 test sport have something physical to run with.
 *
 * @spec-ref 06-game-design.md §3.1 — a basketball returns roughly three quarters of the height it
 * is dropped from, which is what `restitution` 0.75 encodes.
 */
export const DEFAULT_BALL_PHYSICS: BallPhysics = {
  gravity: 9.81,
  restitution: 0.75,
  friction: 0.7,
  rollingFriction: 0.6,
  drag: 0.05,
  magnus: 0.02,
  spinDecay: 0.8,
  radius: 0.12,
};

/** Below this vertical speed a bounce is treated as a settle, so the ball stops buzzing. */
const SETTLE_SPEED = 0.35;

/** Below this horizontal speed a rolling ball is stopped outright. */
const REST_SPEED = 0.05;

/** Mutable ball state that does not fit in the `World` arrays. */
export interface BallState {
  /** The ball's entity id in the world. */
  readonly entity: EntityId;
  /** Who is carrying it, or `NO_ENTITY`. */
  carrier: EntityId;
  /**
   * Spin about the vertical axis, rad/s. Positive curves the ball to its left. One axis is
   * enough: a curving pass, a banana cross, and a hook shot are all yaw; backspin on a jump shot
   * is cosmetic at this fidelity and would double the state for it.
   */
  spin: number;
  /** Steps remaining before the ball can be caught again. Stops an instant re-catch after a pass. */
  catchCooldown: number;
  /** Who last touched it — for turnovers, assists, and last-touch out-of-bounds calls. */
  lastToucher: EntityId;
}

/** Spawns the ball into the world and returns its state. */
export function createBall(
  world: World,
  x: number,
  y: number,
  physics: BallPhysics = DEFAULT_BALL_PHYSICS,
  kind = 1,
): BallState {
  const entity = world.spawn({
    x,
    y,
    z: physics.radius,
    radius: physics.radius,
    mass: 0.62,
    team: -1,
    kind,
  });

  // The ball is queryable but never pushed around by contact resolution: a ball that resolved
  // collisions like a body would shove athletes off their line every time it rolled past.
  world.setFlag(entity, Flags.INTANGIBLE);

  return { entity, carrier: NO_ENTITY, spin: 0, catchCooldown: 0, lastToucher: NO_ENTITY };
}

/** What one step of ball physics did, for the sport layer to turn into events. */
export interface BallStepResult {
  /** The ball hit the ground this step. */
  readonly bounced: boolean;
  /** The ball came to rest on the ground this step. */
  readonly settled: boolean;
  /** Vertical speed at the moment of impact, m/s. `0` when it did not bounce. */
  readonly impactSpeed: number;
}

const NO_EVENT: BallStepResult = { bounced: false, settled: false, impactSpeed: 0 };

/**
 * Advances the ball one fixed step.
 *
 * A carried ball does not integrate at all — it is placed in front of its carrier, which is both
 * simpler and better-feeling than simulating a dribble as a constrained physical body. Sports that
 * want a visible dribble animate it; the simulation only cares where the ball is.
 */
export function stepBall(
  world: World,
  ball: BallState,
  dt: number,
  physics: BallPhysics = DEFAULT_BALL_PHYSICS,
): BallStepResult {
  if (ball.catchCooldown > 0) ball.catchCooldown--;

  if (ball.carrier !== NO_ENTITY) {
    carry(world, ball, physics);
    return NO_EVENT;
  }

  const id = ball.entity;

  let vx = world.vx[id] as number;
  let vy = world.vy[id] as number;
  let vz = world.vz[id] as number;

  // In flight whenever it is off the ground *or* moving upward. The `vz > 0` half matters more
  // than it looks: without it, the step immediately after a bounce sees the ball sitting exactly
  // at ground height and skips gravity, so every bounce gets one free gravity-less step of rise.
  // That injected energy is enough to leave the ball in a permanent low limit cycle — it never
  // settles, and the floor of a match ends up covered in buzzing balls.
  const airborne = (world.z[id] as number) > physics.radius + 1e-6 || vz > 0;

  if (airborne) {
    vz -= physics.gravity * dt;

    // Magnus: spin about the vertical axis pushes the ball perpendicular to its travel. This is
    // what makes a curved cross bend around a defender rather than travelling on rails.
    const speed = Math.hypot(vx, vy);
    if (speed > 0 && ball.spin !== 0) {
      const force = physics.magnus * ball.spin * speed;
      // Both components read the pre-update velocity: applying the rotation to a half-updated
      // vector adds a small speed gain every step, and a pass that accelerates in flight is one
      // of those bugs that only shows up as "why does the ball feel wrong".
      const alongX = vx / speed;
      const alongY = vy / speed;
      vx += -alongY * force * dt;
      vy += alongX * force * dt;
    }

    const drag = Math.max(0, 1 - physics.drag * dt);
    vx *= drag;
    vy *= drag;
  } else {
    const rolling = Math.max(0, 1 - physics.rollingFriction * dt);
    vx *= rolling;
    vy *= rolling;
    if (Math.hypot(vx, vy) < REST_SPEED) {
      vx = 0;
      vy = 0;
    }
  }

  ball.spin *= Math.max(0, 1 - physics.spinDecay * dt);

  let x = (world.x[id] as number) + vx * dt;
  let y = (world.y[id] as number) + vy * dt;
  let z = (world.z[id] as number) + vz * dt;

  let bounced = false;
  let settled = false;
  let impactSpeed = 0;

  // Only a ball that was actually in flight can land. A ball already at rest on the floor would
  // otherwise re-report a settle every step for the rest of the match.
  if (airborne && z <= physics.radius) {
    z = physics.radius;
    impactSpeed = Math.abs(vz);

    if (impactSpeed > SETTLE_SPEED) {
      vz = impactSpeed * physics.restitution;
      vx *= physics.friction;
      vy *= physics.friction;
      bounced = true;
    } else {
      // Below the settle threshold a bounce would be a millimetre of buzz — stop it dead instead.
      vz = 0;
      settled = true;
    }
  }

  // Out-of-bounds is the sport's call, not the engine's, so the ball is allowed to leave. Only
  // the far-field is clamped, to keep a wild pass from flying to the coordinate horizon.
  x = clampAxis(x, world.width);
  y = clampAxis(y, world.height);

  world.x[id] = x;
  world.y[id] = y;
  world.z[id] = z;
  world.vx[id] = vx;
  world.vy[id] = vy;
  world.vz[id] = vz;
  world.invalidateIndex();

  return bounced || settled ? { bounced, settled, impactSpeed } : NO_EVENT;
}

/** A ball may leave the field, but only by a sensible margin. */
function clampAxis(value: number, extent: number): number {
  const margin = 10;
  return value < -margin ? -margin : value > extent + margin ? extent + margin : value;
}

/** Places a carried ball just ahead of its carrier, at carrying height. */
function carry(world: World, ball: BallState, physics: BallPhysics): void {
  const id = ball.entity;
  const carrier = ball.carrier;
  const facing = world.facing[carrier] as number;
  const offset = (world.radius[carrier] as number) + physics.radius;

  world.x[id] = (world.x[carrier] as number) + Math.cos(facing) * offset;
  world.y[id] = (world.y[carrier] as number) + Math.sin(facing) * offset;
  world.z[id] = physics.radius * 4;
  world.vx[id] = world.vx[carrier] as number;
  world.vy[id] = world.vy[carrier] as number;
  world.vz[id] = 0;
  world.invalidateIndex();
}

/** Gives the ball to an athlete. Cancels flight; the carrier's motion takes over. */
export function attach(world: World, ball: BallState, carrier: EntityId): void {
  ball.carrier = carrier;
  ball.lastToucher = carrier;
  ball.spin = 0;
  world.vz[ball.entity] = 0;
  carry(world, ball, DEFAULT_BALL_PHYSICS);
}

/**
 * Releases the ball with a velocity and spin — every shot, pass, and clearance goes through here.
 *
 * `cooldownSteps` stops the releasing athlete from instantly re-catching their own pass, which is
 * otherwise the first thing that happens: the ball is released inside their catch radius.
 */
export function release(
  world: World,
  ball: BallState,
  vx: number,
  vy: number,
  vz: number,
  spin = 0,
  cooldownSteps = 8,
): void {
  const id = ball.entity;
  if (ball.carrier !== NO_ENTITY) ball.lastToucher = ball.carrier;
  ball.carrier = NO_ENTITY;
  ball.spin = spin;
  ball.catchCooldown = cooldownSteps;

  world.vx[id] = vx;
  world.vy[id] = vy;
  world.vz[id] = vz;
  world.invalidateIndex();
}

/**
 * The launch velocity that lands a ball at a target, given a flight time. Used by passing and by
 * any AI that needs to know whether a pass is physically possible before attempting it.
 *
 * Solves the vertical component from `Δz = vz·t − ½g·t²`, which is exact rather than iterative,
 * so the same request always produces the same pass (INV-8).
 */
export function launchVelocity(
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  flightTime: number,
  gravity: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const t = Math.max(flightTime, 1e-3);
  out.x = (toX - fromX) / t;
  out.y = (toY - fromY) / t;
  out.z = (toZ - fromZ) / t + 0.5 * gravity * t;
  return out;
}

/** Whether an athlete could take the ball this instant: in range, in reach, and off cooldown. */
export function canCatch(
  world: World,
  ball: BallState,
  athlete: EntityId,
  reach: number,
  maxHeight: number,
): boolean {
  if (ball.carrier !== NO_ENTITY) return false;
  if (ball.catchCooldown > 0 && ball.lastToucher === athlete) return false;
  if ((world.z[ball.entity] as number) > maxHeight) return false;

  const dx = (world.x[ball.entity] as number) - (world.x[athlete] as number);
  const dy = (world.y[ball.entity] as number) - (world.y[athlete] as number);
  return dx * dx + dy * dy <= reach * reach;
}

/**
 * A contested catch: succeeds on a draw against `control`, a 0–1 chance the sport computes from
 * coordination, the ball's speed, and pressure. Failure is a fumble, so the ball is nudged away
 * rather than simply not caught — a ball that stays perfectly still on a drop reads as a bug.
 */
export function attemptCatch(
  world: World,
  ball: BallState,
  athlete: EntityId,
  control: number,
  rng: Rng,
): boolean {
  if (rng.bool(control)) {
    attach(world, ball, athlete);
    return true;
  }

  ball.lastToucher = athlete;
  ball.catchCooldown = 6;

  const id = ball.entity;
  const deflection = rng.float(-1.5, 1.5);
  world.vx[id] = (world.vx[id] as number) * 0.4 + deflection;
  world.vy[id] = (world.vy[id] as number) * 0.4 + rng.float(-1.5, 1.5);
  world.vz[id] = Math.max(world.vz[id] as number, 1.2);
  world.invalidateIndex();
  return false;
}

/** Whether the ball is on the ground and not moving — a dead ball. */
export function isAtRest(world: World, ball: BallState, physics = DEFAULT_BALL_PHYSICS): boolean {
  if (ball.carrier !== NO_ENTITY) return false;
  const id = ball.entity;
  return (
    (world.z[id] as number) <= physics.radius + 1e-6 &&
    Math.hypot(world.vx[id] as number, world.vy[id] as number) === 0 &&
    (world.vz[id] as number) === 0
  );
}
