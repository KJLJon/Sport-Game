/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.10 — AI regression harness: headless batches per difficulty per mode, asserted win-rate bands
 * @story   US-7.2 — Choose a difficulty
 * @design  06-game-design.md §7, 12-quality-and-testing.md §5
 *
 * Purpose: the harness's own judgement, and the one property of the ladder that can be asserted
 * cheaply enough to run in the suite.
 *
 * **The batches themselves are not run here.** A full ladder is four levels × four sport-and-mode
 * pairs × two dozen matches, and the Live half of it takes minutes — that is `pnpm ai:ladder`,
 * run before a gate, exactly as `12` §1 files the balance batches. What runs in the suite is
 * `judge()` against fixtures, so that the *bands* cannot rot silently, plus the thing a batch
 * cannot check for itself: that a level is actually plumbed through to both sides.
 */
import { describe, expect, it } from 'vitest';
import {
  LADDER_BANDS,
  LADDER_SPREAD,
  REFERENCE,
  judge,
  type LadderRow,
} from '../../tools/ai-regression.ts';
import { DIFFICULTIES } from '../../src/modes/difficulty.ts';
import { LiveMatch } from '../../src/modes/live/match.ts';
import { EMPTY_FRAME } from '../../src/engine/input/types.ts';
import { basketball } from '../../src/sports/basketball/index.ts';
import { soccer } from '../../src/sports/soccer/index.ts';

const row = (
  level: LadderRow['level'],
  winRate: number,
  margin = (winRate - 0.5) * 20,
): LadderRow => ({
  sport: 'basketball',
  mode: 'live',
  level,
  matches: 24,
  winRate,
  // Margin tracks the win rate by default, which is what a real ladder looks like; the tests that
  // care about the two disagreeing pass their own.
  margin: level === 'pro' ? 0 : margin,
});

/** A ladder that passes: losing badly on Rookie, even at Pro, winning above it. */
const HEALTHY: LadderRow[] = [
  row('rookie', 0.25),
  row('pro', 0.5),
  row('allStar', 0.62),
  row('legend', 0.75),
];

describe('the bands themselves', () => {
  it('covers all four levels and nothing else', () => {
    expect(Object.keys(LADDER_BANDS).sort()).toEqual([...DIFFICULTIES].sort());
  });

  it('asks Rookie to lose and Legend to win, against the same reference', () => {
    expect(REFERENCE).toBe('pro');
    expect(LADDER_BANDS.rookie.max).toBeLessThan(0.5);
    expect(LADDER_BANDS.legend.min).toBeGreaterThanOrEqual(0.5);
    // Pro against itself is a symmetry check, so its band has to straddle even.
    expect(LADDER_BANDS.pro.min).toBeLessThan(0.5);
    expect(LADDER_BANDS.pro.max).toBeGreaterThan(0.5);
  });

  it('leaves room between the levels rather than overlapping them into one', () => {
    expect(LADDER_SPREAD).toBeGreaterThan(0);
    expect(LADDER_BANDS.rookie.max).toBeLessThan(LADDER_BANDS.legend.min);
  });
});

describe('judge', () => {
  it('passes a ladder that is a ladder', () => {
    expect(judge(HEALTHY)).toEqual([]);
  });

  it('names the level that is out of band, and says by how much', () => {
    // A Rookie winning 80% of its matches also flattens the ladder, so it is two findings and
    // both are true — the band one is the one that names the level.
    const findings = judge([...HEALTHY.slice(1), row('rookie', 0.8)]);
    const band = findings.find((finding) => finding.label.endsWith('rookie'));

    expect(band).toBeDefined();
    expect(band?.detail).toContain('80.0%');
    expect(band?.detail).toContain(REFERENCE);
  });

  it('catches a flattened ladder even when every level is inside its own band', () => {
    // Each of these sits in its band; what is wrong is the shape, not any single row.
    const flat = [row('rookie', 0.44), row('pro', 0.5), row('allStar', 0.46), row('legend', 0.5)];
    const findings = judge(flat);

    expect(findings.some((finding) => finding.label.endsWith('spread'))).toBe(true);
    expect(findings.find((finding) => finding.label.endsWith('spread'))?.detail).toContain(
      'not four opponents',
    );
  });

  it('judges each sport and mode on its own — one broken ladder is not four', () => {
    const soccerRows = HEALTHY.map((entry) => ({ ...entry, sport: 'soccer' as const }));
    const findings = judge([...HEALTHY, ...soccerRows.map((r) => ({ ...r, winRate: 0.5 }))]);

    expect(findings.every((finding) => finding.label.startsWith('soccer'))).toBe(true);
  });

  it('says nothing about a group it has no ends for', () => {
    expect(judge([row('pro', 0.5)])).toEqual([]);
  });

  it('catches an inverted ladder on the margin, before the win rate has noticed', () => {
    // Win rates within their bands and spread apart the right way; the margins say otherwise, and
    // the margin is the measure that moves out of the noise first.
    const inverted = [
      row('rookie', 0.3, 4),
      row('pro', 0.5),
      row('allStar', 0.6, 1),
      row('legend', 0.7, -2),
    ];
    const findings = judge(inverted);

    expect(findings.some((finding) => finding.label.endsWith('ladder'))).toBe(true);
    expect(findings.find((finding) => finding.label.endsWith('ladder'))?.detail).toContain(
      'the wrong way',
    );
  });

  it('reports a pairing that is not pairing as a bug in the harness, not in the game', () => {
    const skewed = HEALTHY.map((entry) =>
      entry.level === 'pro' ? { ...entry, margin: 1.4 } : entry,
    );
    const findings = judge(skewed);

    expect(findings.some((finding) => finding.label.endsWith('pairing'))).toBe(true);
    expect(findings.find((finding) => finding.label.endsWith('pairing'))?.detail).toContain(
      'not the same match',
    );
  });
});

describe('a level reaches the side it was given to', () => {
  /**
   * These three play whole matches, which is seconds normally and far longer under coverage
   * instrumentation. Vitest's 5-second default is written for unit tests; a batch check needs to
   * say so rather than fail the gate run intermittently.
   */
  const MATCH_TIMEOUT_MS = 60_000;

  /** Two matches on one seed, differing only in which side is Legend, must not be identical. */
  function diverges(sport: typeof basketball | typeof soccer, seed: string): boolean {
    const scores = ([0, 1] as const).map((side) => {
      const match = new LiveMatch({
        seed,
        sport,
        playerSide: -1,
        difficulties: side === 0 ? ['legend', 'rookie'] : ['rookie', 'legend'],
      });
      match.setInput(EMPTY_FRAME);
      let guard = 0;
      while (!match.finished && guard++ < 400_000) match.step();
      const view = match.view();
      return `${view.score[0]}-${view.score[1]}`;
    });

    return scores[0] !== scores[1];
  }

  it(
    'gives basketball two different matches when the levels are swapped',
    () => {
      expect(diverges(basketball, 'ladder-swap-basketball')).toBe(true);
    },
    MATCH_TIMEOUT_MS,
  );

  it(
    'gives soccer two different matches when the levels are swapped',
    () => {
      expect(diverges(soccer, 'ladder-swap-soccer')).toBe(true);
    },
    MATCH_TIMEOUT_MS,
  );

  it(
    'is still exactly the old match when both sides share a level (INV-8)',
    () => {
      const play = (options: { difficulty?: 'legend'; difficulties?: ['legend', 'legend'] }) => {
        const match = new LiveMatch({
          seed: 'ladder-parity',
          sport: basketball,
          playerSide: -1,
          ...options,
        });
        match.setInput(EMPTY_FRAME);
        let guard = 0;
        while (!match.finished && guard++ < 400_000) match.step();
        return match.view().score.join('-');
      };

      expect(play({ difficulties: ['legend', 'legend'] })).toBe(play({ difficulty: 'legend' }));
    },
    MATCH_TIMEOUT_MS,
  );
});
