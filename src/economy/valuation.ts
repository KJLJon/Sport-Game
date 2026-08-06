/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.13 — Sell-back: valuation, squad-lock guard, confirmation, anti-farm invariants
 * @story   US-9.3 — Sell athletes for coins
 * @design  05-data-model.md §5.1 (the four formulas), §4 (rarity value bases), §5.5 (the anti-farm
 *          invariant)
 * @invariant INV-5 (`sellPrice < marketAsk` for the same athlete — no buy-low-sell-high loop),
 *            INV-2 (a valuation never draws; the market's randomness is a *seeded* argument)
 *
 * Purpose: what an athlete is worth, as `05` §5.1 writes it.
 *
 * ```
 * value      = base(rarity) × (overall / 60) ^ 2.4 × (1 + 0.02 × level)
 * sellPrice  = round10( 0.35 × value )
 * marketAsk  = round10( value × rand(0.90, 1.35) )
 * buyOffer   = round10( value × rand(0.40, 0.75) )
 * ```
 *
 * **The exponent is the whole shape of the economy.** 2.4 on `overall / 60` means an 80-overall
 * athlete is worth about three times a 60, and a 90 about five times — so upgrading is expensive in
 * a way that a linear curve would not be, and selling a shelf of 60s does not fund a 90. Every
 * balance conversation in T-8.16 is about this number.
 *
 * **The two random formulas take their randomness as an argument.** `marketAsk` and `buyOffer` are
 * *seeded* draws in the market (T-8.14, INV-2), and a function that reached for `Math.random()`
 * would make the market unreproducible and the invariant tests meaningless. So they take a factor
 * in `[0,1)` and the caller supplies it from an `Rng`.
 *
 * **`sellPrice` is 35% of value, and it is deliberately harsh.** `05` §5.5 requires
 * `sellPrice < marketAsk` for the same athlete, so buying from the market and selling back is a
 * loss, always. It also requires that a pack's expected sell value stays below its price — checked
 * against the odds tables in T-8.12's own test, using this function.
 */
import { RARITY_BANDS } from '../athletes/tuning.ts';
import type { Rarity } from '../athletes/types.ts';

/** `05` §5.1's exponent on the overall ratio. */
export const VALUE_EXPONENT = 2.4;

/** The overall a value base is quoted at: an athlete at 60 is worth exactly their rarity's base. */
export const VALUE_PIVOT = 60;

/** Per level above 1, as a fraction. `05` §5.1's `1 + 0.02 × level`. */
export const VALUE_PER_LEVEL = 0.02;

/** `05` §5.1 — the sell-back fraction. */
export const SELL_FRACTION = 0.35;

/** The market's ask band, as multiples of value. */
export const ASK_RANGE: readonly [number, number] = [0.9, 1.35];

/** The band a buy-offer for one of your athletes falls in. */
export const OFFER_RANGE: readonly [number, number] = [0.4, 0.75];

/** Coins are round numbers. Every price in `05` §5.1 goes through this. */
export function round10(value: number): number {
  return Math.max(0, Math.round(value / 10) * 10);
}

export interface Valuable {
  readonly rarity: Rarity;
  /** The athlete's overall in the sport being valued (`05` §3.4). */
  readonly overall: number;
  /** 1–20, from the sport skill being valued. */
  readonly level: number;
}

/** `value` — the number every other price is a fraction or a multiple of. */
export function valueOf(subject: Valuable): number {
  const base = RARITY_BANDS[subject.rarity].valueBase;
  const ratio = Math.max(0, subject.overall) / VALUE_PIVOT;
  return base * ratio ** VALUE_EXPONENT * (1 + VALUE_PER_LEVEL * Math.max(0, subject.level));
}

/** What the game pays you for an athlete. Always below what the market would ask (INV-5). */
export function sellPrice(subject: Valuable): number {
  return round10(SELL_FRACTION * valueOf(subject));
}

function lerp(range: readonly [number, number], factor: number): number {
  const clamped = factor < 0 ? 0 : factor > 1 ? 1 : factor;
  return range[0] + (range[1] - range[0]) * clamped;
}

/**
 * What the market asks for an athlete. `factor` is a seeded draw in `[0,1)` — the caller's `Rng`,
 * never a draw taken here (INV-2).
 */
export function marketAsk(subject: Valuable, factor: number): number {
  return round10(valueOf(subject) * lerp(ASK_RANGE, factor));
}

/** What somebody offers for one of yours. Same rule about `factor`. */
export function buyOffer(subject: Valuable, factor: number): number {
  return round10(valueOf(subject) * lerp(OFFER_RANGE, factor));
}

/**
 * The cheapest the market could ever ask for an athlete — `sellPrice` has to stay under this for
 * every athlete, or buying low and selling back is a coin printer (`05` §5.5).
 */
export function minimumAsk(subject: Valuable): number {
  return marketAsk(subject, 0);
}
