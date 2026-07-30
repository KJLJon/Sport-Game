/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.7 — Dribbling, sprint, shielding, stamina drain
 * @story   US-4.2 — Pass, shoot, dribble, and cross
 * @design  06-game-design.md §3.2 (soccer), §2 (controls), 05-data-model.md §3.2 (soccer weights)
 * @invariant INV-1 (difficulty never touches ratings), INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: carrying the ball. How fast you can go with it, how far in front of you it ends up, what
 * happens when someone leans on you, and what all of that costs.
 *
 * **There is no second movement model here.** Athletes move through `engine/physics/movement.ts`,
 * and this file's job is to produce the `MovementProfile` that module already consumes — a carrier
 * is an athlete with a worse profile than they would have without the ball. Writing soccer's own
 * integrator would have been the quickest way to make the engine's basketball's in disguise.
 *
 * **Sprinting is three costs for one benefit.** It buys speed; it costs stamina, close control (the
 * ball is pushed further ahead), and agility (a sprinting carrier turns slower). A sprint button
 * that only made you faster would be a button nobody ever lets go of, which is not a mechanic.
 * `touchDistance` is where most of that lives: at a full sprint a poor dribbler pushes the ball
 * nearly two metres ahead, which is what makes them dispossessable without any dice at all.
 *
 * **Stamina is in real seconds, not game seconds.** It is a budget on the *player's* aggression
 * across a match, and at 11.25× compression a game-second figure would drain a full tank in twenty
 * real seconds. Same call as the advantage window in `fouls.ts`, for the same reason.
 *
 * **Stamina never touches ratings (INV-1's neighbour).** A tired athlete's `dribbling` is unchanged;
 * what changes is the profile derived from it. That keeps the athlete card honest — a rating is
 * what someone can do, not what they can do right now — and it is the same discipline INV-6 imposes
 * on difficulty.
 */
import { contest, contestOdds, type Contestant } from '../../engine/physics/collision.ts';
import {
  movementProfile,
  type MovementProfile,
  type MovementRatings,
} from '../../engine/physics/movement.ts';
import type { Rng } from '../../engine/rng.ts';
import type { EntityId } from '../../engine/world.ts';

const TICK_RATE = 60;

/**
 * What a carrier brings. All three are derived soccer ratings from `05` §3.2 — unlike shooting,
 * nothing here needs to reach past them to an attribute.
 */
export interface CarrierRatings {
  readonly dribbling: number;
  readonly pace: number;
}

/** What a defender brings to leaning on one. */
export interface ShieldingRatings {
  readonly tackling: number;
  readonly marking: number;
}

export const DRIBBLE = {
  /** Sprinting multiplies top speed by this. */
  sprintSpeed: 1.22,
  /** And divides turn rate by it — a sprinting body does not change direction. */
  sprintTurnPenalty: 1.9,

  /** Fraction of free-running top speed a carrier keeps at a jog. Carrying the ball is slower. */
  carrySpeed: 0.9,
  /** How much of that a perfect `dribbling` gives back. */
  carryRelief: 0.08,

  /** Metres the ball is pushed ahead at a jog and at a full sprint, for a 50-rated dribbler. */
  touchAtJog: 0.55,
  touchAtSprint: 1.5,
  /** How much of the touch distance a perfect `dribbling` removes. */
  touchRelief: 0.55,

  /** Real seconds of unbroken sprinting to empty a full tank. */
  sprintDrainSeconds: 90,
  /** Real seconds of jogging to refill an empty one. */
  recoverSeconds: 150,
  /** A jog still costs something — this fraction of the sprint rate. */
  joggingDrainFraction: 0.18,
  /** Top speed at zero stamina. Exhausted is slower, never immobile. */
  exhaustedSpeed: 0.75,

  /** How much being between the defender and the ball is worth in a shielding contest. */
  shieldPositionWeight: 0.55,
} as const;

const SPRINT_DRAIN_PER_STEP = 1 / (DRIBBLE.sprintDrainSeconds * TICK_RATE);
const RECOVER_PER_STEP = 1 / (DRIBBLE.recoverSeconds * TICK_RATE);

/**
 * Stamina per athlete, `0–1`.
 *
 * A `Record` rather than a `Map` for the same reason `RulesState.yellowCards` is one: it goes into
 * snapshots and replays, and a `Map` does not survive `JSON.stringify`.
 */
export type StaminaState = Record<number, number>;

export function createStamina(): StaminaState {
  return {};
}

/** An athlete not yet in the record is fresh, which is the right default for a substitute. */
export function stamina(state: StaminaState, athlete: EntityId): number {
  return state[athlete] ?? 1;
}

/**
 * Advances one athlete's stamina by one step.
 *
 * `effort` is `0–1`: `0` is standing, around `0.35` is jogging, `1` is a flat sprint. Below the
 * jogging threshold an athlete recovers; above it they spend. There is no separate "resting" call,
 * because a model with two entry points is a model that will be called with the wrong one.
 */
export function tickStamina(state: StaminaState, athlete: EntityId, effort: number): number {
  const current = stamina(state, athlete);
  const work = clamp01(effort);

  const next =
    work <= DRIBBLE.joggingDrainFraction
      ? current + RECOVER_PER_STEP * (1 - work / DRIBBLE.joggingDrainFraction)
      : current - SPRINT_DRAIN_PER_STEP * work;

  const clamped = clamp01(next);
  state[athlete] = clamped;
  return clamped;
}

/** Multiplier stamina puts on top speed. `1` fresh, `DRIBBLE.exhaustedSpeed` empty. */
export function staminaFactor(value: number): number {
  return DRIBBLE.exhaustedSpeed + (1 - DRIBBLE.exhaustedSpeed) * clamp01(value);
}

/**
 * Soccer's ratings in the engine's terms.
 *
 * `pace` already blends speed and acceleration inside its own weights row (`05` §3.2), so it feeds
 * both; `dribbling` is what agility means with a ball at your feet. The mapping is here rather than
 * in the engine because it is soccer's opinion, and hockey's will be a different one.
 */
export function movementRatingsFor(ratings: CarrierRatings): MovementRatings {
  return { speed: ratings.pace, acceleration: ratings.pace, agility: ratings.dribbling };
}

/**
 * The profile an athlete actually moves with: their body, then the ball, the sprint, and the tank.
 *
 * `carrying: false` is a runner off the ball, who pays the stamina and sprint terms but not the
 * carrying penalty — which is why a defender can close down a carrier at all.
 */
export function dribbleProfile(
  ratings: CarrierRatings,
  staminaValue: number,
  options: { carrying?: boolean; sprinting?: boolean } = {},
): MovementProfile {
  const base = movementProfile(movementRatingsFor(ratings));
  const carrying = options.carrying !== false;
  const sprinting = options.sprinting === true;

  const carryPenalty = carrying
    ? DRIBBLE.carrySpeed + DRIBBLE.carryRelief * (ratings.dribbling / 100)
    : 1;

  const maxSpeed =
    base.maxSpeed *
    carryPenalty *
    (sprinting ? DRIBBLE.sprintSpeed : 1) *
    staminaFactor(staminaValue);

  return {
    maxSpeed,
    acceleration: base.acceleration * staminaFactor(staminaValue),
    deceleration: base.deceleration,
    turnRate: sprinting ? base.turnRate / DRIBBLE.sprintTurnPenalty : base.turnRate,
  };
}

/**
 * How far in front of the carrier the ball sits.
 *
 * The heart of dribbling, and the reason it needs no dice: a poor dribbler at a sprint pushes the
 * ball far enough ahead that a defender can simply arrive at it first. Skill shortens the leash;
 * speed lengthens it.
 */
export function touchDistance(ratings: CarrierRatings, sprinting: boolean): number {
  const reach = sprinting ? DRIBBLE.touchAtSprint : DRIBBLE.touchAtJog;
  return reach * (1 - DRIBBLE.touchRelief * (ratings.dribbling / 100));
}

/**
 * How well the carrier's body is between the defender and the ball, `-1…1`.
 *
 * `1` is square-on shielding — the defender is directly behind the ball's owner; `-1` is the
 * defender goalside with a clear run at it. Pure geometry, and the term that makes shielding a
 * thing a player *does* rather than a stat they have.
 */
export function shieldPosition(
  carrier: { x: number; y: number },
  ball: { x: number; y: number },
  defender: { x: number; y: number },
): number {
  const toBallX = ball.x - carrier.x;
  const toBallY = ball.y - carrier.y;
  const toDefX = defender.x - carrier.x;
  const toDefY = defender.y - carrier.y;

  const ballLength = Math.hypot(toBallX, toBallY);
  const defLength = Math.hypot(toDefX, toDefY);
  if (ballLength < 1e-6 || defLength < 1e-6) return 0;

  // Facing the same way means the defender is on the ball's side of the carrier — badly shielded.
  const cos = (toBallX * toDefX + toBallY * toDefY) / (ballLength * defLength);
  return clamp(-cos, -1, 1);
}

function contestants(
  carrier: { id: EntityId; ratings: CarrierRatings },
  defender: { id: EntityId; ratings: ShieldingRatings },
  position: number,
): [Contestant, Contestant] {
  return [
    {
      id: carrier.id,
      strength: carrier.ratings.dribbling,
      agility: carrier.ratings.pace,
      position,
    },
    {
      id: defender.id,
      strength: defender.ratings.tackling,
      agility: defender.ratings.marking,
      position: -position,
    },
  ];
}

const SHIELD_WEIGHTS = {
  strength: 0.5,
  agility: 0.2,
  position: DRIBBLE.shieldPositionWeight,
};

/** The carrier's chance of keeping it, without drawing. What the CPU reads before committing. */
export function shieldOdds(
  carrier: { id: EntityId; ratings: CarrierRatings },
  defender: { id: EntityId; ratings: ShieldingRatings },
  position: number,
): number {
  const [a, b] = contestants(carrier, defender, position);
  return contestOdds(a, b, SHIELD_WEIGHTS);
}

/**
 * The seeded half: whether the carrier holds them off.
 *
 * Returns `true` if the carrier keeps it. Nothing here awards a foul — leaning on someone is legal,
 * and whether *this* one was a foul is `fouls.ts`'s question, asked by the tackle model (T-6.8).
 */
export function resolveShield(
  carrier: { id: EntityId; ratings: CarrierRatings },
  defender: { id: EntityId; ratings: ShieldingRatings },
  position: number,
  rng: Rng,
): boolean {
  const [a, b] = contestants(carrier, defender, position);
  return contest(a, b, rng, SHIELD_WEIGHTS).winner === carrier.id;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
