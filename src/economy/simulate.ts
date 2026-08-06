/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.16 — Economy balance pass: pack EV vs sell value vs earn rate, simulated over
 *          200 matches
 * @story   US-9.3 — Sell athletes for coins
 * @design  05-data-model.md §5 (the whole economy), 09-modes-and-arcade.md §7 (balance across
 *          modes), 03-phases-and-tasks.md (Gate 8)
 * @invariant INV-2 (the simulation is seeded and reproducible), INV-5 (no loop that generates coins
 *            faster than it consumes them)
 *
 * Purpose: a headless model of a player's first two hundred matches, so Gate 8's claim can be
 * *measured* rather than asserted.
 *
 * Gate 8: "A new save can be played from zero coins to a meaningfully improved roster with no loop
 * that generates coins faster than it consumes them." Those are two testable statements, and this
 * module produces the numbers for both:
 *
 * - **Progress.** Coins earned over 200 matches against what the packs cost, so "meaningfully
 *   improved" becomes "how many Gold packs can a season of play buy".
 * - **No loop.** Every cycle a player could run — open and sell, buy from the market and sell back,
 *   grind the arcade — is simulated and its net checked. A positive net anywhere is a money printer.
 *
 * **It is a model, not the game.** It uses the real earning table, the real odds, the real
 * valuation and the real generator; it does not simulate matches, because how *well* the player
 * plays is not what is being balanced. Wins are a rate, and the rate is an input.
 */
import { createRng, type Rng } from '../engine/rng.ts';
import { generateAthlete } from '../athletes/generator.ts';
import { sportOverall, type SportRatingTables } from '../athletes/derivation.ts';
import { sportSkillFor } from '../athletes/types.ts';
import type { Difficulty } from '../modes/difficulty.ts';
import { MATCH_RECORD_VERSION, type MatchRecord } from '../stats/types.ts';
import { matchPayout } from './earning.ts';
import { PACKS, rollPack, type PityCounters } from './packs.ts';
import { sellPrice } from './valuation.ts';
import type { PackTier } from './types.ts';

export interface SimulationOptions {
  readonly seed: string;
  readonly matches: number;
  readonly difficulty: Difficulty;
  /** How often the player wins, `0–1`. The one thing here that is a *player* property. */
  readonly winRate: number;
  /** How many days the matches are spread over — decides how many first-win bonuses are paid. */
  readonly days: number;
  /** The tables an athlete's overall is taken from. */
  readonly tables: SportRatingTables;
  /** The sport pack athletes are rolled for. */
  readonly sport: string;
}

export interface SimulationResult {
  readonly earned: number;
  readonly matches: number;
  /** Coins per match, the number every price in `05` §5.2 should be read against. */
  readonly perMatch: number;
  /** What the run could buy, tier by tier. */
  readonly packsAfforded: Readonly<Record<PackTier, number>>;
  /** Opening every affordable pack of a tier and selling every card: net coins. Must be negative. */
  readonly openAndSellNet: Readonly<Record<PackTier, number>>;
  /** The best athlete a run of packs produced, by overall. */
  readonly bestPull: number;
}

/** A match record with only the fields the payout reads. The simulation does not play matches. */
function record(won: boolean, difficulty: Difficulty, index: number): MatchRecord {
  return {
    id: `sim-${index}`,
    schemaVersion: MATCH_RECORD_VERSION,
    playedAt: index,
    sportId: 'basketball',
    mode: 'live',
    difficulty,
    score: won ? [88, 80] : [80, 88],
    playerSide: 0,
    teamNames: ['Home', 'Away'],
    periodsPlayed: 4,
    lines: [],
  };
}

/**
 * What two hundred matches earn, and what that buys.
 *
 * Milestones are deliberately excluded: the record carries no box score, so the payout is the flat
 * awards plus the multipliers. That makes the figure a *floor* on what a player earns, which is the
 * right side to be wrong on when the question is "can they afford to improve".
 */
export function simulateEconomy(options: SimulationOptions): SimulationResult {
  const rng = createRng(options.seed);
  const matchesPerDay = Math.max(1, Math.round(options.matches / Math.max(1, options.days)));

  let earned = 0;
  let winsToday = 0;

  for (let index = 0; index < options.matches; index += 1) {
    if (index % matchesPerDay === 0) winsToday = 0;
    const won = rng.fork(`match-${index}`).next() < options.winRate;
    const firstWinToday = won && winsToday === 0;
    if (won) winsToday += 1;

    earned += matchPayout({ record: record(won, options.difficulty, index), firstWinToday }).total;
  }

  const packsAfforded = {} as Record<PackTier, number>;
  const openAndSellNet = {} as Record<PackTier, number>;
  let bestPull = 0;

  for (const tier of Object.keys(PACKS) as PackTier[]) {
    const def = PACKS[tier];
    const affordable = Math.floor(earned / def.price);
    packsAfforded[tier] = affordable;

    // The farm a player would actually try: buy as many as the run affords, sell every card.
    const cycles = Math.max(1, Math.min(affordable, 40));
    let spent = 0;
    let recovered = 0;
    let pity: PityCounters = {};

    for (let index = 0; index < cycles; index += 1) {
      const packRng = rng.fork(`${tier}-${index}`);
      const roll = rollPack(tier, packRng, pity);
      pity = roll.pity;
      spent += def.price;

      roll.rarities.forEach((rarity, card) => {
        const { athlete } = generateAthlete(packRng.fork(`card-${card}`), {
          rarity,
          sports: [options.sport],
          createdAt: 0,
        });
        const overall = sportOverall(athlete, options.sport, options.tables).overall;
        bestPull = Math.max(bestPull, overall);
        recovered += sellPrice({
          rarity,
          overall,
          level: sportSkillFor(athlete, options.sport).level,
        });
      });
    }

    openAndSellNet[tier] = recovered - spent;
  }

  return {
    earned,
    matches: options.matches,
    perMatch: earned / options.matches,
    packsAfforded,
    openAndSellNet,
    bestPull,
  };
}

/** A pack's expected sell value, sampled rather than integrated — the same figure, measured. */
export function sampledPackValue(
  tier: PackTier,
  rng: Rng,
  options: { readonly tables: SportRatingTables; readonly sport: string; readonly samples: number },
): number {
  let total = 0;
  let pity: PityCounters = {};

  for (let index = 0; index < options.samples; index += 1) {
    const packRng = rng.fork(`sample-${index}`);
    const roll = rollPack(tier, packRng, pity);
    pity = roll.pity;

    roll.rarities.forEach((rarity, card) => {
      const { athlete } = generateAthlete(packRng.fork(`card-${card}`), {
        rarity,
        sports: [options.sport],
        createdAt: 0,
      });
      total += sellPrice({
        rarity,
        overall: sportOverall(athlete, options.sport, options.tables).overall,
        level: sportSkillFor(athlete, options.sport).level,
      });
    });
  }

  return total / options.samples;
}
