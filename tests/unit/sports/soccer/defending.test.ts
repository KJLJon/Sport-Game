/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.8 — Defending: pressure, standing and slide tackles, foul/card risk
 * @story   US-4.3 — Defend and keep goal
 * @design  06-game-design.md §3.2
 *
 * Purpose: that timing beats ratings. A well-timed tackle from a poor defender has to beat a wild
 * one from a good defender, or tackling rewards having rather than playing — so that comparison is
 * the test this module exists to pass. Plus the seam with `fouls.ts`: this decides severity, and
 * never a card.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import { cardFor } from '@/sports/soccer/fouls.ts';
import { CENTRE_X, CENTRE_Y } from '@/sports/soccer/pitch.ts';
import {
  DEFENDING,
  pressureOn,
  resolveTackle,
  severityOf,
  tackleOdds,
  tackleReach,
  tackleTiming,
  type CarrierDefenceRatings,
  type TackleKind,
  type TacklerRatings,
} from '@/sports/soccer/defending.ts';

const AVERAGE_D: TacklerRatings = { tackling: 50, marking: 50 };
const ELITE_D: TacklerRatings = { tackling: 95, marking: 95 };
const POOR_D: TacklerRatings = { tackling: 20, marking: 20 };

const CARRIER: CarrierDefenceRatings = { dribbling: 50, pace: 50 };

const tackler = (ratings: TacklerRatings) => ({ id: 1, ratings });
const carrier = { id: 2, ratings: CARRIER };

/** Fraction of tackles won over a long seeded run. */
function winRate(ratings: TacklerRatings, timing: number, kind: TackleKind, runs = 800): number {
  const rng = createRng('tackles');
  let won = 0;
  for (let i = 0; i < runs; i++) {
    if (resolveTackle(tackler(ratings), carrier, timing, kind, 3, rng).won) won++;
  }
  return won / runs;
}

describe('pressure', () => {
  const on = { x: CENTRE_X, y: CENTRE_Y };

  it('is nothing with nobody near', () => {
    expect(pressureOn(on, [])).toBe(0);
    expect(pressureOn(on, [{ x: CENTRE_X + 20, y: CENTRE_Y, marking: 90 }])).toBe(0);
  });

  it('rises as a defender closes', () => {
    const far = pressureOn(on, [{ x: CENTRE_X + 5, y: CENTRE_Y, marking: 50 }]);
    const near = pressureOn(on, [{ x: CENTRE_X + 1, y: CENTRE_Y, marking: 50 }]);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });

  it('makes being surrounded worse than being marked', () => {
    const one = pressureOn(on, [{ x: CENTRE_X + 2, y: CENTRE_Y, marking: 50 }]);
    const three = pressureOn(on, [
      { x: CENTRE_X + 2, y: CENTRE_Y, marking: 50 },
      { x: CENTRE_X - 2, y: CENTRE_Y, marking: 50 },
      { x: CENTRE_X, y: CENTRE_Y + 2, marking: 50 },
    ]);
    expect(three).toBeGreaterThan(one);
  });

  it('saturates, so a fourth defender cannot break the term', () => {
    const crowd = Array.from({ length: 8 }, () => ({ x: CENTRE_X, y: CENTRE_Y, marking: 99 }));
    const value = pressureOn(on, crowd);
    expect(value).toBeLessThanOrEqual(1);
    expect(value).toBeGreaterThan(0.9);
  });

  it('counts a good marker for more than a poor one', () => {
    const good = pressureOn(on, [{ x: CENTRE_X + 2, y: CENTRE_Y, marking: 95 }]);
    const poor = pressureOn(on, [{ x: CENTRE_X + 2, y: CENTRE_Y, marking: 10 }]);
    expect(good).toBeGreaterThan(poor);
  });
});

describe('reach and timing', () => {
  it('lets a slide reach further than a standing challenge', () => {
    expect(tackleReach('slide')).toBeGreaterThan(tackleReach('standing'));
  });

  it('is perfect on the ball and nothing beyond reach', () => {
    expect(tackleTiming(0, 'standing')).toBe(1);
    expect(tackleTiming(tackleReach('standing'), 'standing')).toBe(0);
    expect(tackleTiming(99, 'slide')).toBe(0);
  });

  it('rates the same distance better for a slide, because it reaches further', () => {
    expect(tackleTiming(1.2, 'slide')).toBeGreaterThan(tackleTiming(1.2, 'standing'));
  });
});

describe('timing beats ratings', () => {
  it('gives a hopeless challenge no chance at all, however good the defender', () => {
    expect(tackleOdds(tackler(ELITE_D), carrier, 0, 'slide')).toBe(0);
    expect(tackleOdds(tackler(ELITE_D), carrier, DEFENDING.hopelessTiming, 'standing')).toBe(0);
  });

  it('has a well-timed poor defender beat a badly-timed good one', () => {
    const wellTimedPoor = tackleOdds(tackler(POOR_D), carrier, 0.95, 'standing');
    const wildElite = tackleOdds(tackler(ELITE_D), carrier, 0.25, 'standing');
    expect(wellTimedPoor).toBeGreaterThan(wildElite);
  });

  it('still rewards the better defender from the same position', () => {
    expect(tackleOdds(tackler(ELITE_D), carrier, 0.8, 'standing')).toBeGreaterThan(
      tackleOdds(tackler(POOR_D), carrier, 0.8, 'standing'),
    );
  });

  it('wins the ball more often on a slide that lands', () => {
    expect(tackleOdds(tackler(AVERAGE_D), carrier, 0.9, 'slide')).toBeGreaterThan(
      tackleOdds(tackler(AVERAGE_D), carrier, 0.9, 'standing'),
    );
  });
});

describe('resolving a challenge', () => {
  it('is deterministic for a seed', () => {
    const once = resolveTackle(tackler(AVERAGE_D), carrier, 0.5, 'slide', 5, createRng('s'));
    const twice = resolveTackle(tackler(AVERAGE_D), carrier, 0.5, 'slide', 5, createRng('s'));
    expect(once).toEqual(twice);
  });

  it('lands about as often as the odds say', () => {
    const timing = 0.85;
    const expected = tackleOdds(tackler(AVERAGE_D), carrier, timing, 'standing');
    expect(winRate(AVERAGE_D, timing, 'standing')).toBeCloseTo(expected, 1);
  });

  it('never fouls when it wins the ball', () => {
    const rng = createRng('fair');
    for (let i = 0; i < 500; i++) {
      const outcome = resolveTackle(tackler(ELITE_D), carrier, 0.95, 'standing', 6, rng);
      if (outcome.won) expect(outcome.foul).toBeNull();
    }
  });

  it('commits the defender on a slide, win or lose', () => {
    const rng = createRng('commit');
    for (let i = 0; i < 50; i++) {
      expect(resolveTackle(tackler(AVERAGE_D), carrier, 0.6, 'slide', 4, rng).committed).toBe(true);
      expect(resolveTackle(tackler(AVERAGE_D), carrier, 0.6, 'standing', 4, rng).committed).toBe(
        false,
      );
    }
  });

  it('fouls more from a badly timed challenge than a well timed one', () => {
    const fouls = (timing: number) => {
      const rng = createRng('fouls');
      let count = 0;
      for (let i = 0; i < 800; i++) {
        if (resolveTackle(tackler(AVERAGE_D), carrier, timing, 'slide', 5, rng).foul !== null) {
          count++;
        }
      }
      return count;
    };
    expect(fouls(0.1)).toBeGreaterThan(fouls(0.9));
  });

  it('names the offence after the challenge that caused it', () => {
    const rng = createRng('kinds');
    for (let i = 0; i < 200; i++) {
      const slide = resolveTackle(tackler(POOR_D), carrier, 0.2, 'slide', 5, rng);
      if (slide.foul !== null) expect(slide.foul.kind).toBe('slideTackle');
      const standing = resolveTackle(tackler(POOR_D), carrier, 0.2, 'standing', 5, rng);
      if (standing.foul !== null) expect(standing.foul.kind).toBe('trip');
    }
  });
});

describe('how bad the foul was', () => {
  const fast = DEFENDING.hardChallengeSpeed + 1;
  const slow = 1;

  it('is careless for a clumsy challenge at walking pace', () => {
    expect(severityOf(0.5, 'standing', slow)).toBe('careless');
    expect(severityOf(0.02, 'standing', slow)).toBe('careless');
  });

  it('is reckless when a hopeless challenge goes in hard', () => {
    expect(severityOf(0.02, 'standing', fast)).toBe('reckless');
  });

  it('makes any hopeless slide reckless, however slowly it arrives', () => {
    expect(severityOf(0.02, 'slide', slow)).toBe('reckless');
  });

  it('reserves excessive for a dangerous slide going in fast', () => {
    expect(severityOf(0.01, 'slide', fast)).toBe('excessive');
    // A standing challenge can never reach it.
    expect(severityOf(0, 'standing', fast)).not.toBe('excessive');
  });

  it('hands fouls.ts a severity it already knows how to card', () => {
    const base = {
      offender: 1,
      offenderSide: 0 as const,
      victim: 2,
      x: CENTRE_X,
      y: CENTRE_Y,
      kind: 'slideTackle' as const,
    };
    expect(cardFor({ ...base, severity: severityOf(0.5, 'slide', slow) })).toBeNull();
    expect(cardFor({ ...base, severity: severityOf(0.02, 'slide', slow) })).toBe('yellow');
    expect(cardFor({ ...base, severity: severityOf(0.01, 'slide', fast) })).toBe('red');
  });
});
