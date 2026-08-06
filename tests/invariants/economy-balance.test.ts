/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.16 — Economy balance pass: pack EV vs sell value vs earn rate, simulated over
 *          200 matches
 * @story   US-9.1 — Earn coins, US-9.2 — Packs, US-9.3 — Sell athletes
 * @design  05-data-model.md §5, 09-modes-and-arcade.md §7, 03-phases-and-tasks.md (Gate 8)
 * @invariant INV-5 (no loop generates coins faster than it consumes them), INV-12 (no mode is the
 *            efficient farm)
 *
 * Purpose: Gate 8's sentence, as assertions.
 *
 * > "A new save can be played from zero coins to a meaningfully improved roster with no loop that
 * > generates coins faster than it consumes them."
 *
 * Two claims. The first is about *reachability* — a season of play has to buy enough to matter —
 * and the second is about *closure*: every cycle a player could run has to lose money. Both are
 * measured against the real earning table, the real odds, the real valuation and the real generator.
 *
 * ## The arcade finding from T-8.10, resolved
 *
 * T-8.10 recorded a worry: a 21-second three-star arcade run pays 160 coins where a won 12-minute
 * match pays 250, so arcade "wins" at 453 coins a minute against 21. With the whole economy visible
 * that comparison turns out to be against the wrong denominator — **you cannot fit a twelve-minute
 * match into twenty-one seconds.** The question a player actually faces is what to do with the time
 * they have:
 *
 * - Under ~12 minutes, a match pays *nothing*, because it cannot be finished. Arcade pays up to its
 *   daily ceiling. Arcade winning there is not a farm, it is the entire reason arcade exists.
 * - At one match or longer, playing pays more, and the gap widens with every match — because the
 *   arcade ceiling is a *day's* worth and a match's payout is not.
 *
 * So the property worth asserting is the crossover, not the per-minute rate: **for any session of
 * one match or longer, playing matches pays more than playing arcade.** That is checked below, and
 * it holds with the numbers as they are. No retune; the analysis was what needed fixing.
 */
import { describe, expect, it } from 'vitest';
import { sampledPackValue, simulateEconomy } from '../../src/economy/simulate.ts';
import { PACKS, PACK_ORDER } from '../../src/economy/packs.ts';
import { DAILY_COIN_CAP } from '../../src/modes/arcade/rewards.ts';
import { matchPayout } from '../../src/economy/earning.ts';
import { basketball } from '../../src/sports/basketball/index.ts';
import { createRng } from '../../src/engine/rng.ts';
import { DIFFICULTIES } from '../../src/modes/difficulty.ts';
import { MATCH_RECORD_VERSION, type MatchRecord } from '../../src/stats/types.ts';

const TABLES = {
  weights: basketball.ratingWeights,
  ...(basketball.positionWeights === undefined
    ? {}
    : { positionWeights: basketball.positionWeights }),
};

/** `06` §3.1 — four quarters of three real minutes. */
const MATCH_MINUTES = 12;

const SEASON = {
  seed: 'gate-8',
  matches: 200,
  difficulty: 'pro' as const,
  winRate: 0.5,
  days: 40,
  tables: TABLES,
  sport: 'basketball',
};

function won(index: number): MatchRecord {
  return {
    id: `s-${index}`,
    schemaVersion: MATCH_RECORD_VERSION,
    playedAt: index,
    sportId: 'basketball',
    mode: 'live',
    difficulty: 'pro',
    score: [88, 80],
    playerSide: 0,
    teamNames: ['Home', 'Away'],
    periodsPlayed: 4,
    lines: [],
  };
}

describe('Gate 8 — zero coins to a meaningfully improved roster', () => {
  it('a season of two hundred matches buys enough to matter', () => {
    const run = simulateEconomy(SEASON);

    // Enough for several Gold packs — twenty-five new athletes at minimum, which is a roster twice
    // over. "Meaningfully improved" with a number behind it.
    expect(run.packsAfforded.gold).toBeGreaterThanOrEqual(5);
    expect(run.packsAfforded.gold * PACKS.gold.cards).toBeGreaterThanOrEqual(25);
    // …and at least one Elite, so the top of the store is reachable by playing rather than decorative.
    expect(run.packsAfforded.elite).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('is reachable at every difficulty, not only the paying ones', () => {
    for (const difficulty of DIFFICULTIES) {
      const run = simulateEconomy({ ...SEASON, seed: `gate-8-${difficulty}`, difficulty });
      expect(run.packsAfforded.gold, difficulty).toBeGreaterThanOrEqual(4);
    }
  }, 120_000);

  it('rewards the harder levels, in the order `06` §7 sets', () => {
    const totals = DIFFICULTIES.map(
      (difficulty) =>
        simulateEconomy({ ...SEASON, seed: `order-${difficulty}`, difficulty }).earned,
    );
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  }, 120_000);
});

describe('Gate 8 — no loop generates coins faster than it consumes them', () => {
  it('opening packs and selling every card loses money, at every tier', () => {
    const run = simulateEconomy(SEASON);
    for (const tier of PACK_ORDER) {
      expect(run.openAndSellNet[tier], tier).toBeLessThan(0);
    }
  }, 60_000);

  it('a pack returns well under its price when sold back, measured on real pulls', () => {
    const rng = createRng('pack-ev');
    for (const tier of PACK_ORDER) {
      const value = sampledPackValue(tier, rng.fork(tier), {
        tables: TABLES,
        sport: 'basketball',
        samples: 120,
      });
      expect(value, tier).toBeLessThan(PACKS[tier].price);
      // A wide margin, so a tuning pass has to move a long way before it opens a loop.
      expect(value / PACKS[tier].price, tier).toBeLessThan(0.6);
    }
  }, 60_000);

  it('a whole day of arcade is worth less than two matches', () => {
    // The ceiling is the mechanism: whatever is played, a day of arcade cannot out-earn sitting
    // down to a couple of matches.
    const perMatch = matchPayout({ record: won(0) }).total;
    expect(DAILY_COIN_CAP).toBeLessThan(perMatch * 2);
  });
});

describe('INV-12 — the crossover, which is the honest form of "no efficient farm"', () => {
  const perMatch = matchPayout({ record: won(0) }).total;

  it('for any session of one match or longer, playing pays more than arcade', () => {
    for (const minutes of [12, 20, 30, 60, 120, 240]) {
      const matches = Math.floor(minutes / MATCH_MINUTES);
      const playing = matches * perMatch;
      // The most arcade could possibly pay in that time: its whole daily ceiling, immediately.
      expect(playing, `${minutes} minutes`).toBeGreaterThanOrEqual(DAILY_COIN_CAP);
    }
  });

  it('and below one match, arcade is the only thing that pays — which is the point', () => {
    // Under twelve minutes there is no match to finish, so the comparison is against zero. This is
    // asserted so the *reason* the numbers above are acceptable is written down rather than assumed.
    const shortSession = 5;
    expect(Math.floor(shortSession / MATCH_MINUTES) * perMatch).toBe(0);
    expect(DAILY_COIN_CAP).toBeGreaterThan(0);
  });

  it('the gap widens with every match, so grinding arcade never catches up', () => {
    const anHour = Math.floor(60 / MATCH_MINUTES) * perMatch;
    const aDay = Math.floor(240 / MATCH_MINUTES) * perMatch;
    expect(anHour / DAILY_COIN_CAP).toBeGreaterThan(1);
    expect(aDay / DAILY_COIN_CAP).toBeGreaterThan(anHour / DAILY_COIN_CAP);
  });
});
