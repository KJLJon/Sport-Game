/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.12 — Packs: tiers, prices, published odds, pity timers, reveal animation with skip
 * @story   US-9.2 — Open packs to earn new athletes
 * @design  05-data-model.md §5.2 (the table, the odds, the pity timers), §5.5 (the anti-farm
 *          invariant), §4 (rarity)
 * @invariant INV-2 (seeded PRNG only — a pack is a function of its seed),
 *            INV-5 (a pack's expected sell value stays below its price)
 *
 * Purpose: `05` §5.2's table as data, and what opening one produces.
 *
 * **Every roll is seeded and forked by label.** A pack opened from seed `s` produces the same
 * athletes every time it is replayed, which is what makes the reveal skippable (the result exists
 * before the animation does), what makes the odds testable at a hundred thousand samples, and what
 * INV-2 requires. Cards fork by index, so adding a sixth card to a tier cannot change the first
 * five an existing seed produced.
 *
 * **Pity is a counter per tier, and it triggers *before* the roll rather than replacing it.** `05`
 * §5.2 says "guaranteed Rare+ within 6 Bronze": the sixth Bronze opened without a Rare rolls its
 * first card from the Rare-and-above part of the table, and the counter resets. Implementing it the
 * other way — rolling normally and then upgrading the result — would make the published odds a lie,
 * because the displayed 4.5% would silently become something else.
 *
 * **The odds are published, so they are the source of truth for the screen too.** The purchase
 * screen renders this table rather than a copy of it (US-9.2), which is the only way the two cannot
 * drift apart.
 */
import type { Rng } from '../engine/rng.ts';
import { RARITIES, type Rarity } from '../athletes/types.ts';
import type { PackTier } from './types.ts';

export interface PackDef {
  readonly tier: PackTier;
  readonly name: string;
  readonly price: number;
  readonly cards: number;
  /** Rarity → probability. Sums to 1. Absent rarities cannot be pulled from this tier. */
  readonly odds: Readonly<Partial<Record<Rarity, number>>>;
  /** After this many openings with no pull at or above `pityFloor`, the next one is guaranteed. */
  readonly pityAfter: number;
  readonly pityFloor: Rarity;
}

/** `05` §5.2, read straight across. */
export const PACKS: Readonly<Record<PackTier, PackDef>> = {
  bronze: {
    tier: 'bronze',
    name: 'Bronze',
    price: 750,
    cards: 3,
    odds: { common: 0.7, uncommon: 0.25, rare: 0.045, epic: 0.005 },
    pityAfter: 6,
    pityFloor: 'rare',
  },
  silver: {
    tier: 'silver',
    name: 'Silver',
    price: 2000,
    cards: 4,
    odds: { common: 0.45, uncommon: 0.4, rare: 0.13, epic: 0.018, legendary: 0.002 },
    pityAfter: 12,
    pityFloor: 'epic',
  },
  gold: {
    tier: 'gold',
    name: 'Gold',
    price: 5000,
    cards: 5,
    odds: { common: 0.2, uncommon: 0.42, rare: 0.28, epic: 0.085, legendary: 0.015 },
    pityAfter: 8,
    pityFloor: 'epic',
  },
  elite: {
    tier: 'elite',
    name: 'Elite',
    price: 12_000,
    cards: 5,
    odds: { rare: 0.6, epic: 0.32, legendary: 0.08 },
    pityAfter: 25,
    pityFloor: 'legendary',
  },
};

export const PACK_ORDER: readonly PackTier[] = ['bronze', 'silver', 'gold', 'elite'];

/** Rarities at or above a floor, in ascending order — what a pity roll draws from. */
export function atOrAbove(floor: Rarity): readonly Rarity[] {
  return RARITIES.slice(RARITIES.indexOf(floor));
}

/** The odds a tier publishes, as ordered rows the purchase screen prints (US-9.2). */
export function publishedOdds(def: PackDef): readonly { rarity: Rarity; chance: number }[] {
  return RARITIES.filter((rarity) => (def.odds[rarity] ?? 0) > 0).map((rarity) => ({
    rarity,
    chance: def.odds[rarity] ?? 0,
  }));
}

/**
 * One rarity from a weighted table.
 *
 * The cumulative walk is over `RARITIES` order rather than over `Object.keys`, so the mapping from
 * a draw to a rarity is stable whatever order the table was written in — the difference between a
 * seed meaning the same thing next month and not.
 */
export function rollRarity(rng: Rng, odds: Readonly<Partial<Record<Rarity, number>>>): Rarity {
  const total = RARITIES.reduce((sum, rarity) => sum + (odds[rarity] ?? 0), 0);
  let roll = rng.next() * total;
  for (const rarity of RARITIES) {
    roll -= odds[rarity] ?? 0;
    if (roll < 0) return rarity;
  }
  // Only reachable through floating-point drift at the very top of the range.
  return RARITIES[RARITIES.length - 1] as Rarity;
}

/** Pity counters, one per tier. Stored in the `economy` record (`05` §5.2). */
export type PityCounters = Readonly<Partial<Record<PackTier, number>>>;

export interface PackRoll {
  readonly tier: PackTier;
  readonly rarities: readonly Rarity[];
  /** True when the pity timer supplied the first card. Shown on the reveal, because it is earned. */
  readonly pityTriggered: boolean;
  /** The counters after this pack. */
  readonly pity: PityCounters;
}

/**
 * What a pack contains.
 *
 * `seed` is the pack's identity: the same seed always produces the same cards, so the reveal
 * animation is a *presentation* of a result that already exists and skipping it cannot change
 * anything (US-9.2).
 */
export function rollPack(tier: PackTier, rng: Rng, pity: PityCounters = {}): PackRoll {
  const def = PACKS[tier];
  const since = pity[tier] ?? 0;
  const owed = since + 1 >= def.pityAfter;

  const rarities: Rarity[] = [];
  for (let index = 0; index < def.cards; index += 1) {
    const cardRng = rng.fork(`card-${index}`);
    rarities.push(
      owed && index === 0 ? rollRarity(cardRng, floorOdds(def)) : rollRarity(cardRng, def.odds),
    );
  }

  const floor = RARITIES.indexOf(def.pityFloor);
  const satisfied = rarities.some((rarity) => RARITIES.indexOf(rarity) >= floor);

  return {
    tier,
    rarities,
    pityTriggered: owed,
    // Reset on any pull at or above the floor, however it arrived — a lucky Epic on the third
    // Bronze resets the counter exactly as the guaranteed one would.
    pity: { ...pity, [tier]: satisfied ? 0 : since + 1 },
  };
}

/** A tier's odds restricted to its pity floor and above, renormalised. */
function floorOdds(def: PackDef): Readonly<Partial<Record<Rarity, number>>> {
  const allowed = atOrAbove(def.pityFloor);
  const restricted: Partial<Record<Rarity, number>> = {};
  for (const rarity of allowed) {
    const chance = def.odds[rarity] ?? 0;
    if (chance > 0) restricted[rarity] = chance;
  }
  // A tier whose floor is above everything it can roll — not a state `05` §5.2 has, but a tuning
  // pass could create one — guarantees the floor itself rather than dividing by zero.
  if (Object.keys(restricted).length === 0) restricted[def.pityFloor] = 1;
  return restricted;
}

/** The number the odds screen prints: "4.5%". One decimal, because 0.5% and 0.05% are different. */
export function oddsText(chance: number): string {
  const percent = chance * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

/** How many more of this tier before the guarantee. `05` §5.2's counter, in words. */
export function pityRemaining(tier: PackTier, pity: PityCounters): number {
  return Math.max(0, PACKS[tier].pityAfter - (pity[tier] ?? 0));
}
