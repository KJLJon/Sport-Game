/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @story   US-9.1 — Earn coins
 * @design  05-data-model.md §5.3 (the earning table), 06-game-design.md §4 (coin itemisation)
 * @invariant INV-1 (difficulty scales the payout, never a rating), INV-6 (no mode branch)
 *
 * Purpose: that the earning table is implemented as written, that the itemisation always adds up to
 * the number printed under it, and that a payout depends on the match rather than on the mode.
 *
 * The summing case is the one that earns its keep: two roundings — the difficulty multiplier and
 * the no-assist bonus — are applied in sequence, and it is entirely possible to produce lines that
 * total 349 under a headline of 350. A player who adds up the post-match screen and gets a different
 * number stops trusting the screen.
 */
import { describe, expect, it } from 'vitest';
import {
  FIRST_WIN_OF_DAY_COINS,
  MATCH_COMPLETED_COINS,
  MILESTONES,
  MILESTONE_CAP,
  WIN_COINS,
  matchPayout,
  milestonesFor,
  payoutDetail,
  teamTotals,
} from '@/economy/earning.ts';
import { DIFFICULTIES, DIFFICULTY_PROFILES } from '@/modes/difficulty.ts';
import { NO_ASSISTS, NO_ASSIST_BONUS, defaultAssists } from '@/modes/assists.ts';
import { MATCH_RECORD_VERSION, type MatchRecord, type StatLine } from '@/stats/types.ts';

function line(overrides: Partial<StatLine> = {}): StatLine {
  return {
    athleteId: null,
    side: 0,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threesMade: 0,
    threesAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    rebounds: 0,
    offensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    ...overrides,
  };
}

/** A plain match: 60–50 to the player, with no line that trips a milestone. */
function record(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'm1',
    schemaVersion: MATCH_RECORD_VERSION,
    playedAt: 1_700_000_000_000,
    sportId: 'basketball',
    mode: 'live',
    difficulty: 'pro',
    score: [60, 50],
    playerSide: 0,
    teamNames: ['Home', 'Away'],
    periodsPlayed: 4,
    lines: [
      line({ side: 0, points: 20, turnovers: 4, steals: 1 }),
      line({ side: 0, points: 20, turnovers: 4, steals: 1 }),
      line({ side: 0, points: 20, turnovers: 4, steals: 1 }),
      line({ side: 1, points: 20, turnovers: 4, steals: 1 }),
      line({ side: 1, points: 20, turnovers: 4, steals: 1 }),
      line({ side: 1, points: 10, turnovers: 4, steals: 1 }),
    ],
    ...overrides,
  };
}

function sum(payout: { items: readonly { coins: number }[] }): number {
  return payout.items.reduce((total, item) => total + item.coins, 0);
}

describe('matchPayout', () => {
  it('pays the completion award and the win bonus from `05` §5.3', () => {
    const payout = matchPayout({ record: record() });
    const ids = payout.items.map((item) => item.id);

    expect(ids).toContain('completed');
    expect(ids).toContain('win');
    expect(payout.items.find((item) => item.id === 'completed')?.coins).toBe(MATCH_COMPLETED_COINS);
    expect(payout.items.find((item) => item.id === 'win')?.coins).toBe(WIN_COINS);
  });

  it('pays completion but no win bonus for a loss', () => {
    // No lines, so nothing but the flat awards is in play — a loss is worth turning up for.
    const payout = matchPayout({ record: record({ score: [50, 60], lines: [] }) });
    expect(payout.items.map((item) => item.id)).not.toContain('win');
    expect(payout.total).toBe(MATCH_COMPLETED_COINS);
  });

  it('pays nothing at all for a match the player was not in', () => {
    expect(matchPayout({ record: record({ playerSide: -1 }) })).toEqual({ total: 0, items: [] });
  });

  it('reads the score from the player’s own side', () => {
    const away = matchPayout({ record: record({ playerSide: 1, score: [50, 60] }) });
    expect(away.items.map((item) => item.id)).toContain('win');
  });

  it('itemises the difficulty multiplier and always sums to the total', () => {
    for (const difficulty of DIFFICULTIES) {
      const payout = matchPayout({ record: record({ difficulty }) });
      const multiplier = DIFFICULTY_PROFILES[difficulty].rewardMultiplier;

      expect(sum(payout)).toBe(payout.total);
      if (multiplier === 1) {
        expect(payout.items.map((item) => item.id)).not.toContain('difficulty');
      } else {
        const item = payout.items.find((entry) => entry.id === 'difficulty');
        expect(item?.multiplier).toBe(multiplier);
        expect(payout.total).toBe(Math.round((MATCH_COMPLETED_COINS + WIN_COINS) * multiplier));
      }
    }
  });

  it('scales harder levels above easier ones for the same match', () => {
    const totals = DIFFICULTIES.map(
      (difficulty) => matchPayout({ record: record({ difficulty }) }).total,
    );
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(Math.max(...totals)).toBeGreaterThan(Math.min(...totals));
  });

  it('pays the no-assist bonus only when every assist is off', () => {
    const base = matchPayout({ record: record() });
    const helped = matchPayout({ record: record(), assists: defaultAssists('pro') });
    const unaided = matchPayout({ record: record(), assists: NO_ASSISTS });

    expect(helped.total).toBe(base.total);
    expect(unaided.total).toBe(Math.round(base.total * (1 + NO_ASSIST_BONUS)));
    expect(unaided.items.find((item) => item.id === 'no-assists')?.multiplier).toBeCloseTo(
      1 + NO_ASSIST_BONUS,
    );
    expect(sum(unaided)).toBe(unaided.total);
  });

  it('adds the first win of the day flat, and only to a win', () => {
    const base = matchPayout({ record: record() });
    const first = matchPayout({ record: record(), firstWinToday: true });
    expect(first.total).toBe(base.total + FIRST_WIN_OF_DAY_COINS);

    const lost = matchPayout({ record: record({ score: [50, 60] }), firstWinToday: true });
    expect(lost.items.map((item) => item.id)).not.toContain('first-win');
  });

  it('does not let difficulty scale the daily bonus', () => {
    const legend = matchPayout({ record: record({ difficulty: 'legend' }), firstWinToday: true });
    const item = legend.items.find((entry) => entry.id === 'first-win');
    expect(item?.coins).toBe(FIRST_WIN_OF_DAY_COINS);
  });

  it('is a function of the record, not of the mode (INV-6)', () => {
    const live = matchPayout({ record: record({ mode: 'live' }) });
    const playbook = matchPayout({ record: record({ mode: 'playbook' }) });
    expect(playbook).toEqual(live);
  });
});

describe('milestones', () => {
  const totals = (overrides: Partial<ReturnType<typeof teamTotals>> = {}) => ({
    points: 50,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 4,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    topScore: 10,
    ...overrides,
  });

  /** A milestone context whose scoreline and box score agree, which is the ordinary case. */
  function context(options: {
    myScore: number;
    theirScore: number;
    mine?: Partial<ReturnType<typeof teamTotals>>;
    theirs?: Partial<ReturnType<typeof teamTotals>>;
  }) {
    const { myScore, theirScore } = options;
    return {
      mine: totals({ points: myScore, ...options.mine }),
      theirs: totals({ points: theirScore, ...options.theirs }),
      myScore,
      theirScore,
      won: myScore > theirScore,
      lost: myScore < theirScore,
      margin: myScore - theirScore,
    };
  }

  it('sums a side from its own lines only', () => {
    const summed = teamTotals(record().lines, 1);
    expect(summed.points).toBe(50);
    expect(summed.topScore).toBe(20);
  });

  it('pays a shutout only to a side that won it', () => {
    const shutout = context({ myScore: 2, theirScore: 0 });
    expect(milestonesFor(shutout).map((m) => m.id)).toContain('shutout');
    expect(milestonesFor({ ...shutout, won: false, lost: true }).map((m) => m.id)).not.toContain(
      'shutout',
    );
  });

  it('does not pay a shutout for a goalless draw', () => {
    expect(milestonesFor(context({ myScore: 0, theirScore: 0 })).map((m) => m.id)).not.toContain(
      'shutout',
    );
  });

  it('reads a dominant win relatively, so both sports can earn it', () => {
    const soccer = context({ myScore: 3, theirScore: 1, mine: { topScore: 1 } });
    const basketball = context({ myScore: 100, theirScore: 79, mine: { topScore: 20 } });
    expect(milestonesFor(soccer).map((m) => m.id)).toContain('dominant');
    expect(milestonesFor(basketball).map((m) => m.id)).toContain('dominant');
  });

  it('does not pay a dominant win for a narrow one', () => {
    const narrow = context({ myScore: 100, theirScore: 98, mine: { topScore: 20 } });
    expect(milestonesFor(narrow).map((m) => m.id)).not.toContain('dominant');
  });

  it('reads the scoreline, not the box score, for the result-shaped awards', () => {
    // An anonymous record keeps no lines at all. The scoreboard still said 3–0.
    const anonymous = {
      ...context({ myScore: 3, theirScore: 0 }),
      mine: totals({ points: 0, topScore: 0 }),
      theirs: totals({ points: 0 }),
    };
    expect(milestonesFor(anonymous).map((m) => m.id)).toContain('shutout');
    expect(milestonesFor(anonymous).map((m) => m.id)).not.toContain('star');
  });

  it('caps the milestone total whatever the match contained', () => {
    const everything = context({
      myScore: 100,
      theirScore: 0,
      mine: {
        topScore: 60,
        turnovers: 0,
        steals: 8,
        blocks: 4,
        fieldGoalsMade: 20,
        fieldGoalsAttempted: 30,
      },
      theirs: { turnovers: 10, steals: 0, blocks: 0 },
    });
    const earned = milestonesFor(everything);
    const coins = earned.reduce((total, milestone) => total + milestone.coins, 0);
    expect(coins).toBeLessThanOrEqual(MILESTONE_CAP);
    expect(earned.length).toBeGreaterThan(1);
  });

  it('keeps every award inside the 25–150 band the table names', () => {
    for (const milestone of MILESTONES) {
      expect(milestone.coins).toBeGreaterThanOrEqual(25);
      expect(milestone.coins).toBeLessThanOrEqual(150);
    }
  });

  it('has no duplicate ids', () => {
    expect(new Set(MILESTONES.map((m) => m.id)).size).toBe(MILESTONES.length);
  });
});

describe('payoutDetail', () => {
  it('says the sport, the mode, and what happened', () => {
    expect(payoutDetail(record(), 'Basketball')).toBe('Basketball · Live · Won 60–50');
    expect(payoutDetail(record({ mode: 'playbook', score: [1, 1] }), 'Soccer')).toBe(
      'Soccer · Playbook · Drew 1–1',
    );
  });
});
