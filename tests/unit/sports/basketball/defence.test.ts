/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.7 — Defence: marking, contest, steal, block, foul model, free throws
 * @story   US-3.3 — Defend
 * @design  06-game-design.md §3.1 (fouls from approach angle, speed differential, discipline)
 * @invariant INV-8 (determinism)
 *
 * Purpose: that a defender's choices cost something. The foul model gets the most attention because
 * it is what makes a steal a decision rather than a free action — and because all three of the
 * ingredients `06` §3.1 names have to actually move it, not just appear in the signature.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import {
  BlockResult,
  DEFENCE,
  StealResult,
  approachAngle,
  assignMarks,
  blockChance,
  boxOutSpot,
  foulChance,
  freeThrowProbability,
  markingSpot,
  resolveBlock,
  resolveSteal,
  stealChance,
  type AttackerRatings,
  type DefenderRatings,
} from '@/sports/basketball/defence.ts';

const DEFENDER: DefenderRatings = {
  perimeterD: 50,
  interiorD: 50,
  vertical: 50,
  strength: 50,
  agility: 50,
  discipline: 50,
};

const ATTACKER: AttackerRatings = { ballHandling: 50, strength: 50, agility: 50 };

const BASKET = { x: 26.425, y: 7.5 };

describe('marking', () => {
  it('assigns like to like, by role order', () => {
    const marks = assignMarks([10, 11, 12], [20, 21, 22]);
    expect(marks.get(20)).toBe(10);
    expect(marks.get(21)).toBe(11);
    expect(marks.get(22)).toBe(12);
  });

  it('stands between the mark and the basket, not behind them', () => {
    const mark = { x: 20, y: 7.5 };
    const spot = markingSpot(mark, BASKET, DEFENDER, false);
    expect(spot.x).toBeGreaterThan(mark.x);
    expect(spot.x).toBeLessThan(BASKET.x);
    expect(spot.y).toBeCloseTo(7.5, 6);
  });

  it('lets a better defender sit closer', () => {
    const mark = { x: 20, y: 7.5 };
    const tight = markingSpot(mark, BASKET, { ...DEFENDER, perimeterD: 95 }, false);
    const loose = markingSpot(mark, BASKET, { ...DEFENDER, perimeterD: 15 }, false);
    expect(tight.x - mark.x).toBeLessThan(loose.x - mark.x);
  });

  it('plays tighter in the paint than on the perimeter', () => {
    const mark = { x: 24, y: 7.5 };
    const inside = markingSpot(mark, BASKET, DEFENDER, true);
    const outside = markingSpot(mark, BASKET, DEFENDER, false);
    expect(inside.x - mark.x).toBeLessThan(outside.x - mark.x);
  });

  it('seals an attacker off the glass on the basket side', () => {
    const attacker = { x: 22, y: 7.5 };
    const spot = boxOutSpot(attacker, BASKET);
    expect(spot.x).toBeGreaterThan(attacker.x);
    expect(spot.x - attacker.x).toBeCloseTo(DEFENCE.boxOutDistance, 6);
  });
});

describe('the foul model', () => {
  it('moves with all three of the ingredients the spec names', () => {
    const base = foulChance(DEFENDER, 0.2, 1);

    // Approach angle.
    expect(foulChance(DEFENDER, 0.9, 1)).toBeGreaterThan(base);
    // Speed differential.
    expect(foulChance(DEFENDER, 0.2, 6)).toBeGreaterThan(base);
    // Discipline.
    expect(foulChance({ ...DEFENDER, discipline: 95 }, 0.2, 1)).toBeLessThan(base);
    expect(foulChance({ ...DEFENDER, discipline: 5 }, 0.2, 1)).toBeGreaterThan(base);
  });

  it('never certifies a whistle', () => {
    expect(foulChance({ ...DEFENDER, discipline: 0 }, 1, 20)).toBeLessThanOrEqual(0.95);
    expect(foulChance({ ...DEFENDER, discipline: 100 }, 0, 0)).toBeGreaterThanOrEqual(0);
  });

  it('reads a challenge across the body as worse than one alongside', () => {
    const alongside = approachAngle({ x: 5, y: 0 }, { x: 5, y: 0 });
    const across = approachAngle({ x: -5, y: 0 }, { x: 5, y: 0 });
    const sideways = approachAngle({ x: 0, y: 5 }, { x: 5, y: 0 });

    expect(alongside).toBeCloseTo(0, 6);
    expect(across).toBeCloseTo(1, 6);
    expect(sideways).toBeGreaterThan(alongside);
    expect(sideways).toBeLessThan(across);
  });

  it('reads a stationary pair as no challenge at all', () => {
    expect(approachAngle({ x: 0, y: 0 }, { x: 5, y: 0 })).toBe(0);
    expect(approachAngle({ x: 5, y: 0 }, { x: 0, y: 0 })).toBe(0);
  });
});

describe('steals', () => {
  it('needs to be in range at all', () => {
    expect(stealChance(DEFENDER, ATTACKER, DEFENCE.stealReach + 0.1)).toBe(0);
    expect(stealChance(DEFENDER, ATTACKER, 0.3)).toBeGreaterThan(0);
  });

  it('favours a better defender against a worse handler', () => {
    const good = stealChance({ ...DEFENDER, perimeterD: 95 }, ATTACKER, 0.5);
    const poor = stealChance({ ...DEFENDER, perimeterD: 20 }, ATTACKER, 0.5);
    expect(good).toBeGreaterThan(poor);

    const slippery = stealChance(DEFENDER, { ...ATTACKER, ballHandling: 95 }, 0.5);
    expect(slippery).toBeLessThan(stealChance(DEFENDER, ATTACKER, 0.5));
  });

  it('resolves the ball before the whistle — a clean steal is not a foul', () => {
    // A defender who cannot miss, arriving as recklessly as possible.
    const thief: DefenderRatings = { ...DEFENDER, perimeterD: 100, discipline: 0 };
    const butterfingers: AttackerRatings = { ...ATTACKER, ballHandling: 0 };
    const rng = createRng('steal');

    let stolen = 0;
    let fouled = 0;
    for (let i = 0; i < 500; i++) {
      const result = resolveSteal(thief, butterfingers, 0.1, 1, 8, rng);
      if (result === StealResult.STOLEN) stolen++;
      if (result === StealResult.FOULED) fouled++;
    }
    expect(stolen).toBeGreaterThan(fouled);
  });

  it('makes a reckless lunge a real risk', () => {
    const rng = createRng('reckless');
    const wild: DefenderRatings = { ...DEFENDER, discipline: 5 };
    let fouled = 0;
    for (let i = 0; i < 500; i++) {
      if (resolveSteal(wild, ATTACKER, 1.5, 1, 8, rng) === StealResult.FOULED) fouled++;
    }
    expect(fouled).toBeGreaterThan(20);
  });
});

describe('blocks', () => {
  it('needs to be close, and gets much harder against a clean release', () => {
    expect(blockChance(DEFENDER, DEFENCE.blockReach + 0.1, 0)).toBe(0);
    expect(blockChance(DEFENDER, 0.4, 1)).toBeLessThan(blockChance(DEFENDER, 0.4, 0));
    expect(blockChance(DEFENDER, 1.6, 0)).toBeLessThan(blockChance(DEFENDER, 0.4, 0));
  });

  it('rewards interior defence and vertical', () => {
    expect(blockChance({ ...DEFENDER, interiorD: 95, vertical: 95 }, 0.5, 0.2)).toBeGreaterThan(
      blockChance({ ...DEFENDER, interiorD: 20, vertical: 20 }, 0.5, 0.2),
    );
  });

  it('resolves the ball before the whistle, same as a steal', () => {
    const swatter: DefenderRatings = { ...DEFENDER, interiorD: 100, vertical: 100, discipline: 0 };
    const rng = createRng('block');
    let blocked = 0;
    let fouled = 0;
    for (let i = 0; i < 500; i++) {
      const result = resolveBlock(swatter, 0.1, 0, 1, 8, rng);
      if (result === BlockResult.BLOCKED) blocked++;
      if (result === BlockResult.FOULED) fouled++;
    }
    expect(blocked).toBeGreaterThan(0);
    expect(blocked + fouled).toBeLessThanOrEqual(500);
  });
});

describe('free throws', () => {
  it('runs from a poor shooter to a very good one', () => {
    const poor = freeThrowProbability({ freeThrow: 20, composure: 50 }, 1);
    const great = freeThrowProbability({ freeThrow: 95, composure: 50 }, 1);
    expect(poor).toBeGreaterThan(0.3);
    expect(great).toBeGreaterThan(0.8);
    expect(great).toBeLessThan(0.98);
  });

  it('costs a rushed release', () => {
    expect(freeThrowProbability({ freeThrow: 70, composure: 50 }, 0)).toBeLessThan(
      freeThrowProbability({ freeThrow: 70, composure: 50 }, 1),
    );
  });

  it('lets composure answer the one that matters', () => {
    const calm = freeThrowProbability({ freeThrow: 70, composure: 95 }, 0.8, 1);
    const rattled = freeThrowProbability({ freeThrow: 70, composure: 10 }, 0.8, 1);
    expect(calm).toBeGreaterThan(rattled);
    // And composure is irrelevant with nothing riding on it.
    expect(freeThrowProbability({ freeThrow: 70, composure: 95 }, 0.8, 0)).toBe(
      freeThrowProbability({ freeThrow: 70, composure: 10 }, 0.8, 0),
    );
  });
});
