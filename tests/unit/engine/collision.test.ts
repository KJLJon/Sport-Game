/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.5 — Collision & contact contests
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  04-architecture.md §6, 06-game-design.md §3.1
 * @invariant INV-2, INV-8
 *
 * Purpose: separation that is symmetric, mass-weighted, and stable; and a contest curve that
 * rewards ratings without making upsets impossible — the property that decides whether a
 * low-rated squad is playable or pointless.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Flags, World, type EntityId } from '@/engine/world.ts';
import { createRng } from '@/engine/rng.ts';
import {
  CONTACT_STIFFNESS,
  OVERLAP_EPSILON,
  DEFAULT_CONTEST_WEIGHTS,
  contest,
  contestOdds,
  isOverlapping,
  resolveCollisions,
  separatePair,
  type Contestant,
} from '@/engine/physics/collision.ts';

function world(): World {
  return new World({ width: 28, height: 15, cellSize: 4, capacity: 32 });
}

function athlete(w: World, x: number, y: number, mass = 80, radius = 0.4): EntityId {
  return w.spawn({ x, y, mass, radius });
}

function contestant(id: number, strength: number, agility = strength, position = 0): Contestant {
  return { id, strength, agility, position };
}

describe('separatePair', () => {
  it('does nothing when the circles do not touch', () => {
    const w = world();
    const a = athlete(w, 5, 5);
    const b = athlete(w, 7, 5);

    expect(separatePair(w, a, b)).toBe(false);
    expect(w.x[a]).toBe(5);
    expect(w.x[b]).toBe(7);
  });

  it('pushes an overlapping pair apart along their centre line', () => {
    const w = world();
    const a = athlete(w, 5, 5);
    const b = athlete(w, 5.5, 5);

    expect(separatePair(w, a, b)).toBe(true);
    expect(w.x[a] as number).toBeLessThan(5);
    expect(w.x[b] as number).toBeGreaterThan(5.5);
    expect(w.y[a]).toBe(5);
    expect(w.y[b]).toBe(5);
  });

  it('corrects a fraction of the overlap, so contact leans rather than snaps', () => {
    const w = world();
    const a = athlete(w, 5, 5);
    const b = athlete(w, 5.5, 5);
    const overlap = 0.8 - 0.5;

    separatePair(w, a, b);
    const moved = 5 - (w.x[a] as number);
    expect(moved).toBeCloseTo(overlap * CONTACT_STIFFNESS * 0.5, 5);
  });

  it('moves the lighter athlete further', () => {
    const w = world();
    const heavy = athlete(w, 5, 5, 110);
    const light = athlete(w, 5.5, 5, 70);

    separatePair(w, heavy, light);
    const heavyMoved = Math.abs(5 - (w.x[heavy] as number));
    const lightMoved = Math.abs(5.5 - (w.x[light] as number));

    expect(lightMoved).toBeGreaterThan(heavyMoved);
  });

  it('leaves a frozen athlete planted and moves the other the whole way', () => {
    const w = world();
    const screener = athlete(w, 5, 5);
    const cutter = athlete(w, 5.5, 5);
    w.setFlag(screener, Flags.FROZEN);

    separatePair(w, screener, cutter);
    expect(w.x[screener]).toBe(5);
    expect(w.x[cutter] as number).toBeGreaterThan(5.5);
  });

  it('separates exactly coincident athletes deterministically', () => {
    const outcome = () => {
      const w = world();
      const a = athlete(w, 5, 5);
      const b = athlete(w, 5, 5);
      separatePair(w, a, b);
      return [w.x[a], w.y[a], w.x[b], w.y[b]];
    };

    const first = outcome();
    expect(first).toEqual(outcome());
    expect(first[0]).not.toBe(first[2]);
  });

  it('converges to within the ignored-overlap tolerance', () => {
    const w = world();
    const a = athlete(w, 5, 5);
    const b = athlete(w, 5.3, 5);

    for (let i = 0; i < 60; i++) separatePair(w, a, b);

    // Not to exactly touching: sub-millimetre overlaps are deliberately left alone, so the pair
    // settles within OVERLAP_EPSILON rather than resolving forever.
    expect(w.distance(a, b)).toBeGreaterThan(0.8 - OVERLAP_EPSILON);
    expect(separatePair(w, a, b)).toBe(false);
  });

  it('reports overlap by circle, ignoring height', () => {
    const w = world();
    const a = w.spawn({ x: 5, y: 5, radius: 0.4 });
    const overhead = w.spawn({ x: 5.2, y: 5, z: 3, radius: 0.4 });
    const clear = w.spawn({ x: 9, y: 5, radius: 0.4 });

    expect(isOverlapping(w, a, overhead)).toBe(true);
    expect(isOverlapping(w, a, clear)).toBe(false);
  });

  it('never swaps the pair past each other, however deep the overlap', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 0.79, noNaN: true }), (gap) => {
        const w = world();
        const a = athlete(w, 5, 5);
        const b = athlete(w, 5 + gap, 5);
        separatePair(w, a, b);
        expect(w.x[a] as number).toBeLessThan(w.x[b] as number);
      }),
    );
  });
});

describe('resolveCollisions', () => {
  it('resolves every overlapping pair in one pass', () => {
    const w = world();
    const a = athlete(w, 5, 5);
    const b = athlete(w, 5.4, 5);
    const c = athlete(w, 12, 5);
    const d = athlete(w, 12.4, 5);
    w.reindex();

    expect(resolveCollisions(w, new Int32Array(32))).toBe(2);
    expect(w.x[a] as number).toBeLessThan(5);
    expect(w.x[d] as number).toBeGreaterThan(12.4);
    expect(w.distance(a, b)).toBeGreaterThan(0.4);
    expect(w.distance(c, d)).toBeGreaterThan(0.4);
  });

  it('counts each pair once, not twice', () => {
    const w = world();
    athlete(w, 5, 5);
    athlete(w, 5.2, 5);
    w.reindex();

    expect(resolveCollisions(w, new Int32Array(32))).toBe(1);
  });

  it('reports nothing when the field is spread out', () => {
    const w = world();
    for (let i = 0; i < 10; i++) athlete(w, 2 + i * 2.5, 7);
    w.reindex();

    expect(resolveCollisions(w, new Int32Array(32))).toBe(0);
  });

  it('skips intangible and benched entities', () => {
    const w = world();
    const a = athlete(w, 5, 5);
    const ghost = athlete(w, 5.2, 5);
    w.setFlag(ghost, Flags.INTANGIBLE);
    w.reindex();

    expect(resolveCollisions(w, new Int32Array(32))).toBe(0);
    expect(w.x[a]).toBe(5);

    w.setFlag(ghost, Flags.INTANGIBLE, false);
    w.setFlag(ghost, Flags.BENCHED);
    expect(resolveCollisions(w, new Int32Array(32))).toBe(0);
  });

  it('untangles a pile-up of ten athletes on the same spot', () => {
    const w = world();
    const ids: EntityId[] = [];
    for (let i = 0; i < 10; i++) ids.push(athlete(w, 14 + i * 0.05, 7.5));

    const scratch = new Int32Array(32);
    for (let step = 0; step < 400; step++) {
      w.reindex();
      resolveCollisions(w, scratch);
    }

    for (const a of ids) {
      for (const b of ids) {
        if (a >= b) continue;
        expect(w.distance(a, b)).toBeGreaterThan(0.8 - OVERLAP_EPSILON);
      }
    }
  });

  it('is deterministic over a crowded field', () => {
    const snapshot = () => {
      const w = world();
      const rng = createRng('pile');
      for (let i = 0; i < 22; i++) w.spawn({ x: rng.float(12, 16), y: rng.float(6, 9) });

      const scratch = new Int32Array(32);
      for (let step = 0; step < 50; step++) {
        w.reindex();
        resolveCollisions(w, scratch);
      }
      return Array.from(w.x.subarray(0, 22));
    };

    expect(snapshot()).toEqual(snapshot());
  });

  it('marks the index stale when it moved anything', () => {
    const w = world();
    athlete(w, 5, 5);
    athlete(w, 5.2, 5);
    w.reindex();

    resolveCollisions(w, new Int32Array(32));
    expect(w.isIndexed).toBe(false);
  });
});

describe('contest', () => {
  const rng = () => createRng('contest');

  it('favours the stronger athlete without guaranteeing them', () => {
    const strong = contestant(1, 90);
    const weak = contestant(2, 40);

    const generator = rng();
    let strongWins = 0;
    for (let i = 0; i < 2000; i++) {
      if (contest(strong, weak, generator).winner === strong.id) strongWins++;
    }

    const rate = strongWins / 2000;
    expect(rate).toBeGreaterThan(0.6);
    expect(rate).toBeLessThan(0.95);
  });

  it('is a coin flip between equals', () => {
    const generator = rng();
    let aWins = 0;
    for (let i = 0; i < 4000; i++) {
      if (contest(contestant(1, 60), contestant(2, 60), generator).winner === 1) aWins++;
    }
    expect(aWins / 4000).toBeCloseTo(0.5, 1);
  });

  it('leaves the underdog a real chance even at the extremes', () => {
    const odds = contestOdds(contestant(1, 99), contestant(2, 1));
    expect(odds).toBeLessThan(0.99);
    expect(odds).toBeGreaterThan(0.9);
  });

  it('gives a 20-point edge a meaningful but beatable advantage', () => {
    const odds = contestOdds(contestant(1, 70), contestant(2, 50));
    expect(odds).toBeGreaterThan(0.58);
    expect(odds).toBeLessThan(0.75);
  });

  it('lets positioning overturn a rating gap', () => {
    const boxedOut = contestant(1, 70, 70, -1);
    const inPosition = contestant(2, 60, 60, 1);
    expect(contestOdds(inPosition, boxedOut)).toBeGreaterThan(0.5);
  });

  it('reports the winner’s own probability and the margin', () => {
    const generator = rng();
    for (let i = 0; i < 200; i++) {
      const result = contest(contestant(1, 80), contestant(2, 45), generator);
      expect(result.probability).toBeGreaterThanOrEqual(0);
      expect(result.probability).toBeLessThanOrEqual(1);
      expect(result.margin).toBeGreaterThanOrEqual(0);
      expect(result.margin).toBeLessThanOrEqual(1);
      expect(result.winner).not.toBe(result.loser);
    }
  });

  it('has a near-zero margin between equals and a wide one in a mismatch', () => {
    const even = contest(contestant(1, 55), contestant(2, 55), rng());
    const lopsided = contest(contestant(1, 95), contestant(2, 15), rng());
    expect(even.margin).toBeLessThan(0.05);
    expect(lopsided.margin).toBeGreaterThan(0.6);
  });

  it('is symmetric: swapping the contestants mirrors the odds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 1, max: 99 }),
        (strengthA, strengthB) => {
          const forward = contestOdds(contestant(1, strengthA), contestant(2, strengthB));
          const reverse = contestOdds(contestant(2, strengthB), contestant(1, strengthA));
          expect(forward + reverse).toBeCloseTo(1, 10);
        },
      ),
    );
  });

  it('replays identically from the same seed', () => {
    const roll = () => {
      const generator = createRng('replay');
      return Array.from(
        { length: 50 },
        () => contest(contestant(1, 72), contestant(2, 64), generator).winner,
      );
    };

    expect(roll()).toEqual(roll());
  });

  it('honours custom weights — an agility contest is not a strength contest', () => {
    const quick = contestant(1, 40, 90);
    const powerful = contestant(2, 90, 40);
    const agilityFight = { strength: 0.1, agility: 0.9, position: 0 };

    expect(contestOdds(quick, powerful, agilityFight)).toBeGreaterThan(0.5);
    expect(contestOdds(quick, powerful, DEFAULT_CONTEST_WEIGHTS)).toBeLessThan(0.5);
  });

  it('clamps out-of-range ratings instead of letting them run away', () => {
    expect(contestOdds(contestant(1, 5000), contestant(2, 99))).toBeCloseTo(0.5, 6);
  });
});
