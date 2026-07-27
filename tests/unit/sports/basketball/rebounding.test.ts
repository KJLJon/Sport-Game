/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.6 — Rebounding: height/vertical/strength/box-out/timing contest
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  06-game-design.md §3.1
 * @invariant INV-8 (determinism)
 *
 * Purpose: that all five of `06` §3.1's ingredients actually move the outcome, and that the draw is
 * a draw — the better rebounder wins most of them, not all of them. A contest where the best score
 * always wins would make a possession readable from the box score before the shot went up.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import {
  REBOUNDING,
  contenderWeight,
  isBoxedOut,
  jumpTiming,
  pickRebounder,
  reboundSkill,
  type Contender,
  type RebounderRatings,
} from '@/sports/basketball/rebounding.ts';

const AVERAGE: RebounderRatings = { rebounding: 50, vertical: 50, strength: 50 };
const BIG: RebounderRatings = { rebounding: 90, vertical: 85, strength: 88 };
const GUARD: RebounderRatings = { rebounding: 30, vertical: 65, strength: 40 };

function contender(
  athlete: number,
  side: 0 | 1,
  ratings: RebounderRatings,
  distance: number,
  boxedOut = false,
  timing = 0.7,
): Contender {
  return {
    athlete,
    side,
    boxedOut,
    timing,
    weight: contenderWeight(ratings, distance, boxedOut, timing),
  };
}

describe('what makes a rebounder', () => {
  it('weighs rebounding most, then vertical, then strength', () => {
    const base = reboundSkill(AVERAGE);
    const better = (key: keyof RebounderRatings) => reboundSkill({ ...AVERAGE, [key]: 90 }) - base;

    expect(better('rebounding')).toBeGreaterThan(better('vertical'));
    expect(better('vertical')).toBeGreaterThan(better('strength'));
    expect(better('strength')).toBeGreaterThan(0);
  });

  it('never leaves anybody weightless', () => {
    expect(reboundSkill({ rebounding: 0, vertical: 0, strength: 0 })).toBeGreaterThan(0);
  });
});

describe('position and box-out', () => {
  it('rewards being nearer the ball', () => {
    expect(contenderWeight(AVERAGE, 0.2, false, 0.7)).toBeGreaterThan(
      contenderWeight(AVERAGE, 1.8, false, 0.7),
    );
  });

  it('costs a boxed-out athlete more than half their claim', () => {
    const free = contenderWeight(AVERAGE, 0.5, false, 0.7);
    const sealed = contenderWeight(AVERAGE, 0.5, true, 0.7);
    expect(sealed).toBeLessThan(free);
    expect(sealed / free).toBeCloseTo(1 - REBOUNDING.boxOutCost, 6);
  });

  it('counts an opponent between you and the basket, and not one merely nearby', () => {
    const me = { x: 20, y: 7.5 };
    const basket = { x: 26.4, y: 7.5 };

    expect(isBoxedOut(me, { x: 20.8, y: 7.5 }, basket)).toBe(true);
    // Behind me: not a box-out.
    expect(isBoxedOut(me, { x: 19.2, y: 7.5 }, basket)).toBe(false);
    // In front but out of range: not a box-out either.
    expect(isBoxedOut(me, { x: 23, y: 7.5 }, basket)).toBe(false);
  });
});

describe('jump timing', () => {
  it('raises the floor for a better rebounder without raising the ceiling', () => {
    const rng = createRng('timing');
    let bigWorst = 1;
    let guardWorst = 1;
    let bigBest = 0;
    for (let i = 0; i < 500; i++) {
      bigWorst = Math.min(bigWorst, jumpTiming(BIG, rng));
      guardWorst = Math.min(guardWorst, jumpTiming(GUARD, rng));
      bigBest = Math.max(bigBest, jumpTiming(BIG, rng));
    }
    expect(bigWorst).toBeGreaterThan(guardWorst);
    expect(bigBest).toBeLessThanOrEqual(1);
  });

  it('always contributes something, however badly timed', () => {
    expect(contenderWeight(AVERAGE, 0.3, false, 0)).toBeGreaterThan(0);
    expect(contenderWeight(AVERAGE, 0.3, false, 0)).toBeLessThan(
      contenderWeight(AVERAGE, 0.3, false, 1),
    );
  });
});

describe('the contest', () => {
  it('gives it to the only contender when there is one', () => {
    const solo = contender(3, 0, GUARD, 1.2);
    expect(pickRebounder([solo], createRng('solo'))?.athlete).toBe(3);
    expect(pickRebounder([], createRng('none'))).toBeNull();
  });

  it('lets the better rebounder win most of them, and not all of them', () => {
    const rng = createRng('contest');
    const field = [contender(1, 0, BIG, 0.6), contender(2, 1, GUARD, 0.6)];

    let bigWins = 0;
    for (let i = 0; i < 2000; i++) {
      if (pickRebounder(field, rng)?.athlete === 1) bigWins++;
    }
    expect(bigWins / 2000).toBeGreaterThan(0.68);
    expect(bigWins / 2000).toBeLessThan(0.95);
  });

  it('lets a guard with position beat a big without it', () => {
    const rng = createRng('position');
    const field = [contender(1, 0, BIG, 2.0), contender(2, 1, GUARD, 0.2)];

    let guardWins = 0;
    for (let i = 0; i < 2000; i++) {
      if (pickRebounder(field, rng)?.athlete === 2) guardWins++;
    }
    expect(guardWins / 2000).toBeGreaterThan(0.5);
  });

  it('turns a box-out into a real swing', () => {
    const rng = createRng('boxout');
    const sealed = [contender(1, 0, BIG, 0.6, true), contender(2, 1, AVERAGE, 0.6, false)];
    const free = [contender(1, 0, BIG, 0.6, false), contender(2, 1, AVERAGE, 0.6, false)];

    const wins = (field: Contender[]) => {
      let count = 0;
      for (let i = 0; i < 2000; i++) if (pickRebounder(field, rng)?.athlete === 1) count++;
      return count;
    };

    expect(wins(sealed)).toBeLessThan(wins(free));
  });

  it('still answers when every weight has collapsed to nothing', () => {
    const zeroed: Contender[] = [
      { athlete: 7, side: 0, weight: 0, boxedOut: true, timing: 0 },
      { athlete: 8, side: 1, weight: 0, boxedOut: true, timing: 0 },
    ];
    expect(pickRebounder(zeroed, createRng('zero'))?.athlete).toBe(7);
  });

  it('replays identically from the same seed (INV-8)', () => {
    const run = (seed: string) => {
      const rng = createRng(seed);
      const field = [contender(1, 0, BIG, 0.6), contender(2, 1, GUARD, 0.5)];
      return Array.from({ length: 30 }, () => pickRebounder(field, rng)?.athlete).join(',');
    };
    expect(run('same')).toBe(run('same'));
    expect(run('other')).not.toBe(run('same'));
  });
});
