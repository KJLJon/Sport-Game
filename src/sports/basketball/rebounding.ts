/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.6 — Rebounding: height/vertical/strength/box-out/timing contest
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  06-game-design.md §3.1 (rebounds contested by height, vertical, strength, box-out
 *          positioning, jump timing), 05-data-model.md §3.1 (rebounding weights)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: deciding who comes down with a miss. `06` §3.1 names five ingredients and this weighs all
 * five: the `rebounding` rating (which `05` §3.1 has already loaded with height), vertical, strength,
 * where you are standing, and when you jumped.
 *
 * **Why a weighted draw rather than the highest score.** Taking the best score would mean the same
 * five athletes always rebound in the same order, and a possession's outcome would be readable from
 * the box score before the shot went up. A weighted draw keeps the better rebounder winning most of
 * them while leaving the guard who got position his share — which is what actually happens, and what
 * makes crashing the glass worth doing.
 */
import type { Rng } from '../../engine/rng.ts';
import type { EntityId } from '../../engine/world.ts';

/** What an athlete brings to the glass. `rebounding` already carries the height modifier. */
export interface RebounderRatings {
  readonly rebounding: number;
  readonly vertical: number;
  readonly strength: number;
}

export const REBOUNDING = {
  /** How far from the ball an athlete can still be in the contest. */
  reach: 2.2,

  /** Weight of each ingredient in the contest. These sum to 1 across the rating terms. */
  reboundWeight: 0.5,
  verticalWeight: 0.3,
  strengthWeight: 0.2,

  /** Floor and span the weighted rating maps onto — nobody is weightless. */
  skillFloor: 0.2,
  skillSpan: 1,
  /**
   * Skill enters the draw raised to this power. Linear, an elite rebounder beats a guard only
   * about 60/40 with everything else equal, which does not read as elite. Squared it is nearer
   * 75/25 — decisive without being deterministic.
   */
  skillExponent: 2,

  /** Position falls off over this many metres from the ball. */
  positionFalloff: 1.3,
  /** Being boxed out costs this share of your weight. */
  boxOutCost: 0.55,
  /** An opponent this close, on the basket side, is boxing you out. */
  boxOutRange: 1.4,

  /** Timing multiplier runs from this to 1. */
  timingFloor: 0.45,
  /** How much of the timing spread a perfect rebounding rating removes. */
  timingRelief: 0.7,
} as const;

/** One athlete's claim on the ball. */
export interface Contender {
  readonly athlete: EntityId;
  readonly side: 0 | 1;
  readonly weight: number;
  /** Kept for the event detail, so a box score can say *why* somebody got it. */
  readonly boxedOut: boolean;
  readonly timing: number;
}

/**
 * How well an athlete timed the jump, `0–1`.
 *
 * A better rebounder does not get a bonus so much as a narrower spread: the floor rises, the ceiling
 * does not move. That is the difference between "good at rebounding" and "lucky", and it is why an
 * elite rebounder is reliable rather than spectacular.
 */
export function jumpTiming(ratings: RebounderRatings, rng: Rng): number {
  const floor = REBOUNDING.timingRelief * (ratings.rebounding / 100);
  return floor + (1 - floor) * rng.float(0, 1);
}

/** The rating half of the contest: `06` §3.1's height (via `rebounding`), vertical, and strength. */
export function reboundSkill(ratings: RebounderRatings): number {
  const blend =
    ratings.rebounding * REBOUNDING.reboundWeight +
    ratings.vertical * REBOUNDING.verticalWeight +
    ratings.strength * REBOUNDING.strengthWeight;
  return REBOUNDING.skillFloor + REBOUNDING.skillSpan * (blend / 100);
}

/**
 * One athlete's weight in the draw.
 *
 * @spec-ref 06-game-design.md §3.1 — height, vertical, strength, box-out positioning, jump timing
 */
export function contenderWeight(
  ratings: RebounderRatings,
  distanceToBall: number,
  boxedOut: boolean,
  timing: number,
): number {
  const position = Math.exp(-Math.max(0, distanceToBall) / REBOUNDING.positionFalloff);
  const boxOut = boxedOut ? 1 - REBOUNDING.boxOutCost : 1;
  const time = REBOUNDING.timingFloor + (1 - REBOUNDING.timingFloor) * clamp01(timing);
  return Math.pow(reboundSkill(ratings), REBOUNDING.skillExponent) * position * boxOut * time;
}

/**
 * Whether an opponent has sealed an athlete off the glass: standing between them and the basket,
 * and close enough to be leaning on them.
 */
export function isBoxedOut(
  athlete: { x: number; y: number },
  opponent: { x: number; y: number },
  basket: { x: number; y: number },
): boolean {
  const gap = Math.hypot(opponent.x - athlete.x, opponent.y - athlete.y);
  if (gap > REBOUNDING.boxOutRange || gap < 1e-6) return false;

  const toBasketX = basket.x - athlete.x;
  const toBasketY = basket.y - athlete.y;
  const toBasket = Math.hypot(toBasketX, toBasketY);
  if (toBasket < 1e-6) return false;

  // The opponent has to be on the basket side, not merely nearby.
  const cos =
    ((opponent.x - athlete.x) * toBasketX + (opponent.y - athlete.y) * toBasketY) /
    (gap * toBasket);
  return cos > 0.35;
}

/**
 * Picks the winner by weight. Deterministic given the rng, and stable in the face of an athlete
 * whose weight rounds to nothing — with every weight at zero the closest contender takes it, rather
 * than the function having no answer.
 */
export function pickRebounder(contenders: readonly Contender[], rng: Rng): Contender | null {
  if (contenders.length === 0) return null;
  if (contenders.length === 1) return contenders[0] as Contender;

  const total = contenders.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return contenders[0] as Contender;

  let roll = rng.float(0, total);
  for (const contender of contenders) {
    roll -= contender.weight;
    if (roll <= 0) return contender;
  }
  return contenders[contenders.length - 1] as Contender;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
