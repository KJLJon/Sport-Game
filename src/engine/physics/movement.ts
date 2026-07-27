/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.4 — Movement & steering from attributes: accel, max speed, turn rate
 * @story   US-2.1 — Control my athlete with a virtual joystick
 * @design  04-architecture.md §6, 05-data-model.md §2.1 (attributes), §3 (derivation)
 * @invariant INV-2 (no unseeded randomness), INV-8 (determinism)
 *
 * Purpose: turns a desired direction into motion an athlete could plausibly produce. Three limits
 * do all the work — top speed, how fast speed changes, and how fast direction changes — and the
 * difference between them is what makes a quick, light guard feel different from a heavy centre
 * with the same joystick input.
 *
 * The engine never sees attributes. `movementProfile()` takes *derived ratings* (1–99, the output
 * of `05` §3) and returns metres and seconds; sports and the athlete layer decide which ratings to
 * pass. That keeps the seam in `04` §5 honest: nothing here knows what sport is being played.
 */
import type { EntityId, World } from '../world.ts';

/** A mutable 2D vector. Reused by callers so the hot path allocates nothing. */
export interface Vec2 {
  x: number;
  y: number;
}

/** What an athlete's body can do, in world units (metres, seconds, radians). */
export interface MovementProfile {
  /** Top speed in m/s. */
  readonly maxSpeed: number;
  /** How fast speed is gained, m/s². */
  readonly acceleration: number;
  /** How fast speed is shed, m/s². Higher than acceleration — stopping is easier than starting. */
  readonly deceleration: number;
  /** How fast the velocity vector can rotate at full speed, rad/s. */
  readonly turnRate: number;
}

/** Derived ratings, 1–99, as produced by `05` §3. */
export interface MovementRatings {
  /** Top-speed rating. */
  readonly speed: number;
  /** First-step rating. */
  readonly acceleration: number;
  /** Change-of-direction rating. */
  readonly agility: number;
}

/**
 * Rating → physical capability. The constants below are the tuning surface for how the game
 * *feels*; they are deliberately in one place rather than scattered through the sports.
 *
 * @spec-ref 05-data-model.md §2.1 — `speed`, `acceleration`, and `agility` are the three
 * attributes that describe locomotion, so they are the three inputs here. The ranges are set so a
 * 50-rated athlete is unremarkable but not sluggish, and a 99 is clearly, visibly quick without
 * turning the game into athletics: roughly 4.0–8.5 m/s top speed, which brackets real basketball
 * and football movement.
 */
export const MOVEMENT_TUNING = {
  minSpeed: 4.0,
  speedRange: 4.5,
  minAcceleration: 3.0,
  accelerationRange: 6.0,
  /** Deceleration is a multiple of acceleration: bodies stop faster than they start. */
  decelerationFactor: 1.6,
  minTurnRate: 4.0,
  turnRateRange: 8.0,
} as const;

/** Below this speed an athlete is effectively standing, and may pivot freely. */
const PIVOT_SPEED = 0.35;

/** Speeds under this are snapped to a stop, so an athlete never drifts a millimetre per second. */
const REST_SPEED = 0.02;

export function movementProfile(ratings: MovementRatings): MovementProfile {
  const t = MOVEMENT_TUNING;
  const speed = normalise(ratings.speed);
  const acceleration = t.minAcceleration + normalise(ratings.acceleration) * t.accelerationRange;

  return {
    maxSpeed: t.minSpeed + speed * t.speedRange,
    acceleration,
    deceleration: acceleration * t.decelerationFactor,
    turnRate: t.minTurnRate + normalise(ratings.agility) * t.turnRateRange,
  };
}

/** 1–99 → 0–1, clamped. Ratings outside the range are a caller bug, not a crash. */
function normalise(rating: number): number {
  return clamp((rating - 1) / 98, 0, 1);
}

/**
 * Advances one entity by one fixed step.
 *
 * `desired` is a velocity in m/s — what the athlete is *trying* to do, from the joystick or from
 * a steering behaviour. Passing a zero vector means "stop", which decelerates rather than halting
 * instantly. `null` means the same thing; it exists so callers need no scratch vector to say it.
 *
 * Order matters and is deliberate: rotate first, then change speed, then move. Rotating the
 * current velocity rather than snapping to the desired one is what makes a sharp joystick flick
 * read as a body turning instead of a sprite teleporting — and it is where agility is felt.
 */
export function integrate(
  world: World,
  id: EntityId,
  profile: MovementProfile,
  desired: Vec2 | null,
  dt: number,
): void {
  const vx = world.vx[id] as number;
  const vy = world.vy[id] as number;
  const speed = Math.hypot(vx, vy);

  let targetX = desired?.x ?? 0;
  let targetY = desired?.y ?? 0;
  let targetSpeed = Math.hypot(targetX, targetY);

  if (targetSpeed > profile.maxSpeed) {
    const scale = profile.maxSpeed / targetSpeed;
    targetX *= scale;
    targetY *= scale;
    targetSpeed = profile.maxSpeed;
  }

  let newVx: number;
  let newVy: number;

  if (targetSpeed <= REST_SPEED) {
    // Coasting to a stop: shed speed along the current heading, never sideways.
    const shed = Math.max(0, speed - profile.deceleration * dt);
    if (shed <= REST_SPEED || speed === 0) {
      newVx = 0;
      newVy = 0;
    } else {
      newVx = (vx / speed) * shed;
      newVy = (vy / speed) * shed;
    }
  } else {
    const targetHeading = Math.atan2(targetY, targetX);

    // A standing athlete may pivot freely; a moving one is bound by their turn rate. Without the
    // pivot case, starting from rest would take a visible beat to face the right way, which reads
    // as unresponsive rather than heavy.
    let heading: number;
    if (speed <= PIVOT_SPEED) {
      heading = targetHeading;
    } else {
      const current = Math.atan2(vy, vx);
      const maxTurn = profile.turnRate * dt;
      heading = current + clamp(signedAngleDelta(current, targetHeading), -maxTurn, maxTurn);
    }

    // Then speed, limited by acceleration when gaining and deceleration when shedding.
    const limit = targetSpeed >= speed ? profile.acceleration * dt : profile.deceleration * dt;
    const newSpeed = speed + clamp(targetSpeed - speed, -limit, limit);

    newVx = Math.cos(heading) * newSpeed;
    newVy = Math.sin(heading) * newSpeed;
  }

  world.vx[id] = newVx;
  world.vy[id] = newVy;
  world.x[id] = (world.x[id] as number) + newVx * dt;
  world.y[id] = (world.y[id] as number) + newVy * dt;

  // Facing follows motion while moving, and the intent while standing — so an athlete waiting for
  // a pass faces where they mean to go, not where they last came from.
  if (newVx !== 0 || newVy !== 0) {
    world.facing[id] = Math.atan2(newVy, newVx);
  } else if (targetSpeed > REST_SPEED) {
    world.facing[id] = Math.atan2(targetY, targetX);
  }

  world.invalidateIndex();
}

/**
 * Integrates every entity that is neither frozen nor benched, using one profile per entity.
 * Reindexes once at the end rather than per entity — the grid is only read after a whole step.
 */
export function integrateAll(
  world: World,
  dt: number,
  profileOf: (id: EntityId) => MovementProfile | null,
  desiredOf: (id: EntityId) => Vec2 | null,
): void {
  world.forEach((id) => {
    const profile = profileOf(id);
    if (profile === null) return;
    integrate(world, id, profile, desiredOf(id), dt);
  });
  world.reindex();
}

/**
 * The shortest signed rotation from `from` to `to`, in `(-π, π]`. Taking the short way round is
 * the difference between an athlete turning 10° and turning 350°.
 */
export function signedAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** Wraps an angle into `(-π, π]`. */
export function normaliseAngle(angle: number): number {
  return signedAngleDelta(0, angle);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Scales `out` to at most `max` in length, in place. */
export function limit(out: Vec2, max: number): Vec2 {
  const length = Math.hypot(out.x, out.y);
  if (length > max && length > 0) {
    out.x = (out.x / length) * max;
    out.y = (out.y / length) * max;
  }
  return out;
}
