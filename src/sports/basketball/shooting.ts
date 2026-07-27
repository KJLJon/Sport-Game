/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.3 — Shooting: hold-release meter, arc trajectory, make probability
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  06-game-design.md §3.1 (shooting model), §2 (release window), §7 (difficulty assists),
 *          05-data-model.md §3.1 (basketball weights)
 * @invariant INV-1 (difficulty never touches ratings), INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: turns a shot attempt into an outcome. Everything that makes a shot go in lives here —
 * the release meter, the make-probability model, and the arc the ball actually travels on.
 *
 * **Why the outcome is decided at release.** The probability model runs the instant the ball leaves
 * the hand, and the trajectory is then aimed to match: dead at the rim for a make, deliberately
 * short or wide for a miss. The alternative — flying the ball and letting collision decide — makes
 * the make probability a property of the physics tuning rather than of the athlete, which is exactly
 * what `06` §3.1 says it must not be ("not by a coin flip" cuts both ways). The ball still travels a
 * real arc and a miss still caroms off a real rim, so nothing about it reads as decided.
 *
 * **Difficulty (INV-1).** Difficulty enters through one number, `timingAssist`, which widens or
 * narrows the *player's* release window. It never appears in the probability model and never touches
 * a rating on either side.
 */
import type { Rng } from '../../engine/rng.ts';
import {
  DEFAULT_BALL_PHYSICS,
  launchVelocity,
  release,
  type BallState,
} from '../../engine/physics/ball.ts';
import type { EntityId, World } from '../../engine/world.ts';
import {
  COURT,
  attackedBasket,
  isThreePointShot,
  shotDistance,
  shotZone,
  type ShotZone,
  type Side,
} from './court.ts';

/**
 * The basketball ratings a shot reads, `0–100`. Supplied by the athlete layer from T-3.3; until
 * then the module generates them from the match seed.
 */
export interface ShooterRatings {
  readonly finishing: number;
  readonly midRange: number;
  readonly threePoint: number;
  readonly freeThrow: number;
  readonly composure: number;
}

/** How the shooter was moving when they let go. `06` §3.1 names exactly these three. */
export const ShotMovement = {
  SET: 'set',
  OFF_DRIBBLE: 'offDribble',
  FADEAWAY: 'fadeaway',
} as const;
export type ShotMovementName = (typeof ShotMovement)[keyof typeof ShotMovement];

/** Everything the make-probability model reads. */
export interface ShotInput {
  readonly ratings: ShooterRatings;
  /** Metres from the rim. */
  readonly distance: number;
  readonly zone: ShotZone;
  /** `0` clean, `1` smothered. See `contestLevel`. */
  readonly contest: number;
  /** `0–1` from the release meter. */
  readonly release: number;
  readonly movement: ShotMovementName;
  /** `0–1`; `1` is fresh. Stamina lands with T-3.13, so callers pass `1` until then. */
  readonly stamina: number;
  /** `0–1` — how much of a hurry the shot clock put the shooter in. */
  readonly clockPressure: number;
}

/**
 * Tuning. One table, because a balance pass (T-2.13) that has to hunt for numbers is a balance
 * pass that does not happen.
 *
 * @spec-ref 06-game-design.md §3.1 — rating × distance × pressure × movement × release × composure
 */
export const SHOOTING = {
  /**
   * Make chance at the rim for a 50-rated shooter, clean, set, perfect release.
   *
   * Raised from 0.68 by the balance pass (T-2.13). The original was picked by asking "what should a
   * perfect shot go in at" and never checked against what a *typical* shot in a real possession
   * looks like once the penalty stack below is applied to it — which came out at 30% from the
   * field, against a real game's 46%.
   */
  baseAtRim: 0.78,
  /** Exponential falloff length in metres. */
  falloffMetres: 13,
  /** Extra per-metre penalty past this distance, which is what makes a heave a heave. */
  heaveFrom: 8,
  heavePenaltyPerMetre: 0.028,

  /** Rating multiplier is `ratingFloor + ratingSpan × rating/100`; 50 is exactly 1.0. */
  ratingFloor: 0.7,
  ratingSpan: 0.6,

  /**
   * Release multiplier is `releaseFloor + (1 − releaseFloor) × quality`.
   *
   * Also raised by T-2.13: at 0.55, a merely-decent release cost a fifth of the shot, and since
   * almost every shot is a merely-decent release the penalty was not a skill gradient, it was a
   * flat tax on shooting.
   */
  releaseFloor: 0.72,
  /** A fully smothered shot loses this share of its chance. */
  contestWeight: 0.36,

  movement: { set: 1, offDribble: 0.92, fadeaway: 0.85 } as Readonly<
    Record<ShotMovementName, number>
  >,

  /** Stamina's worst case costs this share. */
  staminaWeight: 0.15,
  /** Late-clock penalty at zero composure; composure buys it back. */
  clockPenalty: 0.18,
  clockPenaltyPerComposure: 0.0015,

  /** Nothing is certain and nothing is hopeless. */
  minProbability: 0.02,
  maxProbability: 0.95,

  /** Release-window half-width in steps, before the rating and assist scale it. */
  windowBaseSteps: 9,
  /** Steps of hold that make a perfect release. A third of a second: long enough to be a timing
   * mechanic, short enough that the decision to shoot and the shot itself are the same moment. At
   * half a second the defence closed between the two and every shot went up contested. */
  idealHoldSteps: 22,
  /** Beyond `ideal + overholdWindows × window`, the shot goes up whether you like it or not. */
  overholdWindows: 2,

  /** A defender inside this many metres contests at all. */
  contestRadius: 2.6,
  /** Default arm reach, until athlete heights arrive with T-3.2. */
  defaultReach: 2.35,
  /** Share of a contest a defender standing *behind* the shooter still contributes. */
  behindShare: 0.3,
} as const;

/** Which rating a shot from here is judged on. `06` §3.1 names three; the zones map onto them. */
export function ratingForZone(ratings: ShooterRatings, zone: ShotZone): number {
  switch (zone) {
    case 'restricted':
    case 'paint':
      return ratings.finishing;
    case 'midRange':
      return ratings.midRange;
    default:
      return ratings.threePoint;
  }
}

/** Make chance from distance alone, for an average shooter with everything else perfect. */
export function baseChance(distance: number): number {
  const decay = SHOOTING.baseAtRim * Math.exp(-distance / SHOOTING.falloffMetres);
  const heave = Math.max(0, distance - SHOOTING.heaveFrom) * SHOOTING.heavePenaltyPerMetre;
  return Math.max(0, decay - heave);
}

/**
 * The model. Multiplicative rather than additive: a smothered shot from an elite shooter is still a
 * bad shot, and an open shot from a poor one is still a poor one. An additive model lets one
 * excellent term paper over a terrible one, which is how you get 40% contested heaves.
 *
 * @spec-ref 06-game-design.md §3.1
 */
export function shotProbability(input: ShotInput): number {
  const rating = ratingForZone(input.ratings, input.zone);

  const ratingMul = SHOOTING.ratingFloor + SHOOTING.ratingSpan * (rating / 100);
  const releaseMul = SHOOTING.releaseFloor + (1 - SHOOTING.releaseFloor) * clamp01(input.release);
  const contestMul = 1 - SHOOTING.contestWeight * clamp01(input.contest);
  const movementMul = SHOOTING.movement[input.movement];
  const staminaMul = 1 - SHOOTING.staminaWeight * (1 - clamp01(input.stamina));

  // Composure is what a shooter has instead of a shot clock. It cannot make late pressure a bonus.
  const clockCost = Math.max(
    0,
    SHOOTING.clockPenalty - SHOOTING.clockPenaltyPerComposure * input.ratings.composure,
  );
  const clockMul = 1 - clockCost * clamp01(input.clockPressure);

  const p =
    baseChance(input.distance) *
    ratingMul *
    releaseMul *
    contestMul *
    movementMul *
    staminaMul *
    clockMul;

  return clamp(p, SHOOTING.minProbability, SHOOTING.maxProbability);
}

/**
 * How hard the nearest defender is making it. Distance does most of the work; reach adds the
 * "contest height" `06` §3.1 asks for, so a tall defender closing out matters more than a short one
 * at the same distance.
 */
export function contestLevel(distance: number, reach: number = SHOOTING.defaultReach): number {
  if (distance >= SHOOTING.contestRadius) return 0;
  const closeness = 1 - distance / SHOOTING.contestRadius;
  const reachFactor = clamp(reach / SHOOTING.defaultReach, 0.7, 1.3);
  return clamp01(closeness * reachFactor);
}

/**
 * How much of a contest a defender in a given *direction* is.
 *
 * A defender standing behind the shooter is not contesting the shot, however close they are — the
 * hand has to be in the shot line. Without this, tight man defence makes every shot maximally
 * contested from every angle and the whole floor shoots 25%.
 *
 * `alignment` is the cosine between "towards the defender" and "towards the basket": `1` directly
 * in the way, `-1` directly behind.
 */
export function contestFromDirection(distance: number, alignment: number, reach?: number): number {
  const raw = reach === undefined ? contestLevel(distance) : contestLevel(distance, reach);
  return raw * (SHOOTING.behindShare + (1 - SHOOTING.behindShare) * clamp01(alignment));
}

/**
 * The release meter (`06` §2). A shot is charged by holding and taken by letting go; how close the
 * release is to the ideal decides its quality, and the window it is judged against is the athlete's
 * — which is where familiarity will be *felt* rather than read (T-3.6).
 */
export interface ShotMeter {
  /** Steps the button has been held. */
  charge: number;
  /** Window half-width in steps, fixed at the start of the shot. */
  readonly window: number;
  /** Where the shooter was and how, captured at the start so a spin move cannot rewrite it. */
  readonly movement: ShotMovementName;
}

/**
 * Window half-width. A great shooter has a forgiving window and a poor one a tiny one (`06` §2);
 * `timingAssist` is difficulty's only entry point, and it scales the window, never the rating.
 */
export function releaseWindow(rating: number, timingAssist = 1): number {
  const fromRating = 0.5 + rating / 100;
  return Math.max(2, SHOOTING.windowBaseSteps * fromRating * timingAssist);
}

export function startShot(
  ratings: ShooterRatings,
  zone: ShotZone,
  movement: ShotMovementName,
  timingAssist = 1,
): ShotMeter {
  return { charge: 0, window: releaseWindow(ratingForZone(ratings, zone), timingAssist), movement };
}

/** True once the shooter has held so long the shot goes up on its own. */
export function isOverheld(meter: ShotMeter): boolean {
  return meter.charge > SHOOTING.idealHoldSteps + SHOOTING.overholdWindows * meter.window;
}

/**
 * Release quality, `0–1`. Linear inside the window and zero outside it: a curve that stays generous
 * near the edge makes the window feel bigger than the HUD says it is, and a timing mechanic the HUD
 * lies about is worse than no timing mechanic.
 */
export function releaseQuality(meter: ShotMeter): number {
  const error = Math.abs(meter.charge - SHOOTING.idealHoldSteps);
  return clamp01(1 - error / meter.window);
}

/** A shot the ball is currently in the air for. */
export interface ShotInFlight {
  readonly shooter: EntityId;
  readonly side: Side;
  /** 2 or 3. */
  readonly value: number;
  readonly made: boolean;
  /** Step the ball reaches the rim and the outcome becomes visible. */
  readonly resolveStep: number;
  readonly probability: number;
  readonly zone: ShotZone;
  readonly release: number;
  readonly contest: number;
}

/** Flight time for a shot, in seconds. Long shots hang longer, which is what makes them readable. */
export function flightTime(distance: number): number {
  return 0.6 + 0.055 * distance;
}

/**
 * Puts the ball in the air and decides the shot.
 *
 * A make is aimed at the rim centre. A miss is aimed off it by an amount that grows as the shot
 * gets worse, in a seeded direction — so a badly missed three visibly misses badly, and a near-miss
 * rattles out. Both land inside the rebound zone T-2.6 will fight over.
 */
export function takeShot(
  world: World,
  ball: BallState,
  shooter: EntityId,
  side: Side,
  input: ShotInput,
  step: number,
  rng: Rng,
): ShotInFlight {
  const basket = attackedBasket(side);
  const probability = shotProbability(input);
  const made = rng.bool(probability);

  const fromX = world.x[shooter] as number;
  const fromY = world.y[shooter] as number;
  const fromZ = Math.max(world.z[shooter] as number, 1.9);

  let targetX = basket.x;
  let targetY = basket.y;
  let targetZ = COURT.rimHeight;

  if (!made) {
    // A miss is missed by roughly how bad the shot was, capped so it stays a basketball shot.
    const severity = clamp(0.35 + (1 - input.release) * 0.5 + input.contest * 0.5, 0.35, 1.4);
    const angle = rng.float(0, Math.PI * 2);
    targetX += Math.cos(angle) * severity;
    targetY += Math.sin(angle) * severity;
    // Short is the commonest miss, and a short miss is the one that produces a live rebound.
    targetZ -= rng.float(0, 0.35);
  }

  const t = flightTime(input.distance);
  const velocity = { x: 0, y: 0, z: 0 };
  launchVelocity(
    fromX,
    fromY,
    fromZ,
    targetX,
    targetY,
    targetZ,
    t,
    DEFAULT_BALL_PHYSICS.gravity,
    velocity,
  );

  release(world, ball, velocity.x, velocity.y, velocity.z);

  return {
    shooter,
    side,
    value: isThreePointShot(fromX, fromY, side) ? 3 : 2,
    made,
    resolveStep: step + Math.round(t * 60),
    probability,
    zone: input.zone,
    release: input.release,
    contest: input.contest,
  };
}

/**
 * Sends a missed ball off the rim, so the rebound (T-2.6) is a real loose ball rather than a
 * teleport. Caroms are seeded and biased away from the basket, which is where rebounders stand.
 */
export function caromOffRim(world: World, ball: BallState, side: Side, rng: Rng): void {
  const basket = attackedBasket(side);
  const angle = rng.float(0, Math.PI * 2);
  const speed = rng.float(1.6, 3.4);

  world.x[ball.entity] = basket.x + Math.cos(angle) * 0.3;
  world.y[ball.entity] = basket.y + Math.sin(angle) * 0.3;
  world.z[ball.entity] = COURT.rimHeight - 0.1;
  world.vx[ball.entity] = Math.cos(angle) * speed;
  world.vy[ball.entity] = Math.sin(angle) * speed;
  world.vz[ball.entity] = rng.float(0.4, 1.6);
  world.invalidateIndex();
}

/** Drops a made ball through the net, so the restart starts from under the basket. */
export function dropThroughNet(world: World, ball: BallState, side: Side): void {
  const basket = attackedBasket(side);
  world.x[ball.entity] = basket.x;
  world.y[ball.entity] = basket.y;
  world.z[ball.entity] = 1.2;
  world.vx[ball.entity] = 0;
  world.vy[ball.entity] = 0;
  world.vz[ball.entity] = -1;
  world.invalidateIndex();
}

/** Builds the model's input from a position and the shooter's circumstances. */
export function shotInputAt(
  x: number,
  y: number,
  side: Side,
  ratings: ShooterRatings,
  options: {
    contest?: number;
    release?: number;
    movement?: ShotMovementName;
    stamina?: number;
    clockPressure?: number;
  } = {},
): ShotInput {
  return {
    ratings,
    distance: shotDistance(x, y, side),
    zone: shotZone(x, y, side),
    contest: options.contest ?? 0,
    release: options.release ?? 1,
    movement: options.movement ?? ShotMovement.SET,
    stamina: options.stamina ?? 1,
    clockPressure: options.clockPressure ?? 0,
  };
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
