/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.12 — Packs: tiers, prices, published odds, pity timers, reveal animation with skip
 * @story   US-9.2 — Open packs to earn new athletes
 * @design  05-data-model.md §5.2 (packs), §4 (rarity), 09-modes-and-arcade.md §3.2 (never by paying)
 * @invariant INV-2 (seeded PRNG only), INV-7 (an owed pack is consumed once)
 *
 * Purpose: buying a pack, rolling it, and putting the athletes in the roster.
 *
 * **The whole pack exists before the reveal starts.** `openPack` returns the athletes; the screen
 * then animates them one at a time. That ordering is what makes the skip button honest — skipping
 * shows you what you already had rather than hurrying a roll that has not happened — and it is why
 * a failed write cannot leave a half-opened pack.
 *
 * **The seed is built from the wallet, not from the clock alone.** `entryCount` advances with every
 * coin movement, so two packs opened in the same millisecond still differ, and a replay of the same
 * save state produces the same pack. The clock is a *source* of a seed, never a draw (INV-2).
 */
import { createRng } from '../engine/rng.ts';
import { generateAthlete, type GeneratedAthlete } from '../athletes/generator.ts';
import { PLAYABLE_SPORTS } from '../sports/playable.ts';
import type { AppDatabase } from '../storage/app-db.ts';
import { PACKS, rollPack, type PackRoll } from './packs.ts';
import type { PackTier } from './types.ts';

export interface OpenedPack {
  readonly tier: PackTier;
  readonly roll: PackRoll;
  readonly athletes: readonly GeneratedAthlete[];
  /** What it cost. `0` when an owed pack paid for it. */
  readonly spent: number;
  readonly free: boolean;
  readonly seed: string;
}

/** Why a pack could not be opened. A refusal is a sentence, never a silent no-op. */
export interface PackRefusal {
  readonly reason: 'unaffordable' | 'failed';
  readonly message: string;
}

export function isRefusal(result: OpenedPack | PackRefusal): result is PackRefusal {
  return 'reason' in result;
}

export interface OpenPackOptions {
  readonly db: AppDatabase;
  readonly tier: PackTier;
  /** Overridden by tests so a pack is reproducible; the app lets it be derived. */
  readonly seed?: string;
  readonly now?: number;
}

/**
 * Buys a pack, rolls it, generates its athletes, and stores them.
 *
 * The order is deliberate: pay and advance the pity counter atomically first, then generate, then
 * write the athletes. A failure after payment loses the athletes and keeps the charge, which is the
 * wrong way round — so the athlete write is the *last* thing, and it is a single `putMany` rather
 * than five separate writes that could half-succeed.
 */
export async function openPack(options: OpenPackOptions): Promise<OpenedPack | PackRefusal> {
  const { db, tier } = options;
  const def = PACKS[tier];
  const now = options.now ?? Date.now();

  try {
    const state = await db.economy.state();
    const seed = options.seed ?? `pack:${tier}:${state.entryCount}:${now.toString(36)}`;
    const rng = createRng(seed);

    const purchase = await db.economy.purchasePack(
      tier,
      def.price,
      (pity) => rollPack(tier, rng, pity),
      `${def.name} pack`,
      now,
    );

    if (purchase === null) {
      return {
        reason: 'unaffordable',
        message: `A ${def.name} pack costs ${def.price.toLocaleString('en-US')} coins. Play a match or sell an athlete.`,
      };
    }

    const sports = PLAYABLE_SPORTS.map((sport) => sport.id);
    const used = new Set<string>();
    const athletes = purchase.roll.rarities.map((rarity, index) =>
      generateAthlete(rng.fork(`athlete-${index}`), {
        rarity,
        sports,
        used,
        createdAt: now,
      }),
    );

    await db.athletes.putMany(athletes.map((entry) => entry.athlete));

    return {
      tier,
      roll: purchase.roll,
      athletes,
      spent: purchase.spent,
      free: purchase.free,
      seed,
    };
  } catch {
    return {
      reason: 'failed',
      message: 'The pack could not be opened. Nothing was charged.',
    };
  }
}
