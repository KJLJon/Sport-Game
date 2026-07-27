/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.1 — Seeded PRNG
 * @story   US-2.5, US-2.7
 * @design  04-architecture.md §6 (determinism)
 * @invariant INV-2, INV-8
 *
 * Purpose: the generator's contract — reproducibility across instances and across snapshots,
 * bounds that hold for every helper, and stream independence between forks.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng, hashString, randomSeed, restoreRng, type Rng } from '@/engine/rng.ts';

/** Draws `count` raw values, which is what "the same stream" means throughout this file. */
function drawU32(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.nextU32());
}

describe('createRng — reproducibility', () => {
  it('gives two generators on the same seed the same stream', () => {
    expect(drawU32(createRng('tip-off'), 64)).toEqual(drawU32(createRng('tip-off'), 64));
  });

  it('gives different seeds different streams', () => {
    expect(drawU32(createRng('seed-a'), 32)).not.toEqual(drawU32(createRng('seed-b'), 32));
  });

  it('separates seeds that differ by one character', () => {
    const a = drawU32(createRng('match-0001'), 32);
    const b = drawU32(createRng('match-0002'), 32);
    expect(a).not.toEqual(b);
    // Not merely different — the streams should share no early values.
    expect(a.filter((value) => b.includes(value))).toEqual([]);
  });

  it('holds the same stream on a golden seed across builds', () => {
    // A regression guard on the algorithm itself. If sfc32, the splitmix32 seeding, the warm-up
    // count, or `hashString` changes, every recorded replay and every golden-seed sim breaks —
    // so this failing is a decision to make deliberately, not a number to update.
    expect(drawU32(createRng('golden'), 8)).toEqual([
      487224688, 887967103, 362868681, 1489926645, 492029746, 1835691059, 39822249, 2662240097,
    ]);
  });

  it('advances, rather than repeating, within one generator', () => {
    const rng = createRng('advance');
    const values = drawU32(rng, 1000);
    expect(new Set(values).size).toBeGreaterThan(990);
  });
});

describe('bounds', () => {
  it('keeps next() in [0, 1)', () => {
    const rng = createRng('unit-interval');
    for (let i = 0; i < 5000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('keeps int() in [min, max) for any range', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 1, max: 500 }),
        (seed, min, span) => {
          const rng = createRng(seed);
          for (let i = 0; i < 25; i++) {
            const value = rng.int(min, min + span);
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(min);
            expect(value).toBeLessThan(min + span);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('returns min for an empty or inverted int() range', () => {
    const rng = createRng('degenerate');
    expect(rng.int(5, 5)).toBe(5);
    expect(rng.int(5, 1)).toBe(5);
  });

  it('covers both ends of a small int() range', () => {
    const rng = createRng('coverage');
    const seen = new Set(Array.from({ length: 500 }, () => rng.int(0, 3)));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it('keeps float() in [min, max)', () => {
    const rng = createRng('float');
    for (let i = 0; i < 1000; i++) {
      const value = rng.float(-2.5, 7.5);
      expect(value).toBeGreaterThanOrEqual(-2.5);
      expect(value).toBeLessThan(7.5);
    }
  });

  it('treats bool() probabilities at and beyond the ends as certainties', () => {
    const rng = createRng('certainty');
    for (let i = 0; i < 100; i++) {
      expect(rng.bool(0)).toBe(false);
      expect(rng.bool(-1)).toBe(false);
      expect(rng.bool(1)).toBe(true);
      expect(rng.bool(2)).toBe(true);
    }
  });

  it('honours bool() probability in aggregate', () => {
    const rng = createRng('coin');
    const trials = 20000;
    let heads = 0;
    for (let i = 0; i < trials; i++) if (rng.bool(0.25)) heads++;
    expect(heads / trials).toBeCloseTo(0.25, 2);
  });
});

describe('pick and shuffle', () => {
  it('returns undefined for an empty array', () => {
    expect(createRng('empty').pick([])).toBeUndefined();
  });

  it('picks only members, and eventually every member', () => {
    const rng = createRng('pick');
    const roster = ['pg', 'sg', 'sf', 'pf', 'c'] as const;
    const seen = new Set(Array.from({ length: 300 }, () => rng.pick(roster)));
    expect([...seen].sort()).toEqual([...roster].sort());
  });

  it('shuffles in place into a permutation', () => {
    const rng = createRng('shuffle');
    const items = Array.from({ length: 50 }, (_, i) => i);
    const result = rng.shuffle(items);
    expect(result).toBe(items);
    expect([...items].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(items).not.toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('shuffles the same way for the same seed', () => {
    const first = createRng('deal').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const second = createRng('deal').shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(first).toEqual(second);
  });

  it('leaves a zero- or one-element array alone', () => {
    const rng = createRng('tiny');
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle(['only'])).toEqual(['only']);
  });
});

describe('gaussian', () => {
  it('matches the requested mean and spread', () => {
    const rng = createRng('bell');
    const samples = Array.from({ length: 20000 }, () => rng.gaussian(100, 15));
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const variance =
      samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (samples.length - 1);

    expect(mean).toBeCloseTo(100, 0);
    expect(Math.sqrt(variance)).toBeGreaterThan(14);
    expect(Math.sqrt(variance)).toBeLessThan(16);
  });

  it('defaults to the standard normal', () => {
    const rng = createRng('standard');
    const samples = Array.from({ length: 5000 }, () => rng.gaussian());
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });

  it('reproduces for the same seed, spare sample included', () => {
    const a = Array.from({ length: 9 }, () => createRng('bell-a')).map((rng) => rng.gaussian());
    expect(new Set(a).size).toBe(1);

    const rng1 = createRng('bell-b');
    const rng2 = createRng('bell-b');
    expect(Array.from({ length: 9 }, () => rng1.gaussian())).toEqual(
      Array.from({ length: 9 }, () => rng2.gaussian()),
    );
  });
});

describe('fork', () => {
  it('produces an independent stream', () => {
    const root = createRng('match');
    const physics = root.fork('physics');
    const ai = root.fork('ai');
    expect(drawU32(physics, 32)).not.toEqual(drawU32(ai, 32));
    expect(drawU32(physics, 32)).not.toEqual(drawU32(createRng('match'), 32));
  });

  it('depends on the label and seed, never on how much the parent has consumed', () => {
    const early = createRng('match').fork('shooting');

    const late = createRng('match');
    drawU32(late, 5000);

    expect(drawU32(late.fork('shooting'), 32)).toEqual(drawU32(early, 32));
  });

  it('nests', () => {
    const a = createRng('match').fork('sport').fork('rebound');
    const b = createRng('match').fork('sport').fork('rebound');
    expect(drawU32(a, 16)).toEqual(drawU32(b, 16));
  });
});

describe('snapshot, restore, and clone', () => {
  it('resumes a stream exactly from a snapshot', () => {
    const rng = createRng('resume');
    drawU32(rng, 100);
    const state = rng.snapshot();
    const expected = drawU32(rng, 50);

    const resumed = restoreRng('resume', state);
    expect(drawU32(resumed, 50)).toEqual(expected);
  });

  it('carries the pending gaussian spare across a snapshot', () => {
    const rng = createRng('spare');
    rng.gaussian(); // consumes a pair, leaving the spare
    const state = rng.snapshot();
    expect(state.spare).not.toBeNull();

    const resumed = restoreRng('spare', state);
    expect(resumed.gaussian()).toBe(rng.gaussian());
  });

  it('rewinds a generator to an earlier position', () => {
    const rng = createRng('rewind');
    const state = rng.snapshot();
    const first = drawU32(rng, 20);
    rng.restore(state);
    expect(drawU32(rng, 20)).toEqual(first);
  });

  it('clones at the current position without sharing state', () => {
    const rng = createRng('clone');
    drawU32(rng, 10);
    const copy = rng.clone();

    expect(drawU32(copy, 20)).toEqual(drawU32(rng, 20));
    drawU32(copy, 5);
    expect(drawU32(copy, 5)).not.toEqual(drawU32(rng, 5));
  });

  it('reports its seed', () => {
    expect(createRng('named').seed).toBe('named');
    expect(createRng('named').fork('sub').seed).toBe('named/sub');
  });
});

describe('hashString', () => {
  it('is stable and unsigned', () => {
    expect(hashString('basketball')).toBe(hashString('basketball'));
    expect(hashString('')).toBe(0x811c9dc5);
    fc.assert(
      fc.property(fc.string(), (text) => {
        const hash = hashString(text);
        expect(Number.isInteger(hash)).toBe(true);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThan(2 ** 32);
      }),
    );
  });

  it('separates similar strings', () => {
    expect(hashString('seed-1')).not.toBe(hashString('seed-2'));
  });
});

describe('randomSeed', () => {
  it('returns distinct non-empty seeds', () => {
    const seeds = new Set(Array.from({ length: 100 }, () => randomSeed()));
    expect(seeds.size).toBe(100);
    for (const seed of seeds) expect(seed.length).toBeGreaterThan(0);
  });

  it('feeds createRng', () => {
    const seed = randomSeed();
    expect(drawU32(createRng(seed), 8)).toEqual(drawU32(createRng(seed), 8));
  });
});
