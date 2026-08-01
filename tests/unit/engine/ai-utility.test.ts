/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.1 — Utility-scoring decision framework shared across sports and modes
 * @story   US-7.1 — Play against the computer
 * @design  06-game-design.md §5 (CPU behaviour)
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/engine/rng.ts';
import {
  consider,
  inverse,
  normalise,
  scoreCandidates,
  selectOption,
  utility,
  type Candidate,
} from '../../../src/engine/ai/utility.ts';

const candidate = (key: string, ...scores: number[]): Candidate<string> => ({
  key,
  option: key,
  considerations: scores.map((score, index) => consider(`c${index}`, score)),
});

describe('utility', () => {
  it('is 0 for an option nobody has a reason for', () => {
    expect(utility([])).toBe(0);
  });

  it('passes a single consideration through unchanged', () => {
    expect(utility([consider('open', 0.7)])).toBeCloseTo(0.7, 10);
  });

  it('lets one fatal consideration sink an otherwise good option', () => {
    expect(utility([consider('open', 1), consider('haveBall', 0)])).toBe(0);
  });

  it('keeps options comparable across different numbers of considerations', () => {
    // Two 0.8s against three 0.8s: multiplying raw would make the better-reasoned option lose
    // (0.64 vs 0.512). Compensation keeps them within a tenth of each other.
    const two = utility([consider('a', 0.8), consider('b', 0.8)]);
    const three = utility([consider('a', 0.8), consider('b', 0.8), consider('c', 0.8)]);
    expect(Math.abs(two - three)).toBeLessThan(0.1);
    expect(0.8 ** 2).toBeLessThan(two);
  });

  it('weights a consideration up by making a poor score hurt more', () => {
    const normal = utility([consider('range', 0.5), consider('open', 0.9)]);
    const heavy = utility([consider('range', 0.5, 3), consider('open', 0.9)]);
    expect(heavy).toBeLessThan(normal);
  });

  it('ignores a zero-weight consideration rather than vetoing on it', () => {
    expect(utility([consider('a', 0.6), consider('unused', 0.4, 0)])).toBeCloseTo(
      utility([consider('a', 0.6)]),
      10,
    );
  });

  it('clamps nonsense scores instead of propagating them', () => {
    expect(utility([consider('over', 4)])).toBe(1);
    expect(utility([consider('nan', Number.NaN)])).toBe(0);
    expect(utility([consider('under', -1)])).toBe(0);
  });
});

describe('scoreCandidates', () => {
  it('sorts best-first and keeps the sport’s order on a tie', () => {
    const scored = scoreCandidates([candidate('a', 0.4), candidate('b', 0.9), candidate('c', 0.4)]);
    expect(scored.map((entry) => entry.key)).toEqual(['b', 'a', 'c']);
  });

  it('is deterministic for a seed', () => {
    const run = () =>
      scoreCandidates([candidate('a', 0.5), candidate('b', 0.5)], {
        noise: 0.4,
        rng: createRng('seed').fork('ai'),
      }).map((entry) => entry.perceived);
    expect(run()).toEqual(run());
  });

  it('draws noise for every candidate, so a losing option cannot shift a later draw', () => {
    const rng = () => createRng('seed').fork('ai');
    const withHopeless = scoreCandidates(
      [candidate('hopeless', 0.01), candidate('a', 0.5), candidate('b', 0.5)],
      { noise: 0.3, rng: rng() },
    );
    const without = scoreCandidates(
      [candidate('x', 0.01), candidate('a', 0.5), candidate('b', 0.5)],
      {
        noise: 0.3,
        rng: rng(),
      },
    );
    expect(withHopeless.map((entry) => entry.perceived)).toEqual(
      without.map((entry) => entry.perceived),
    );
  });

  it('never lets noise resurrect a vetoed option', () => {
    const rng = createRng('loud').fork('ai');
    for (let tick = 0; tick < 200; tick += 1) {
      const [best] = scoreCandidates([candidate('illegal', 1, 0), candidate('legal', 0.2)], {
        noise: 1,
        rng,
      });
      expect(best?.key).toBe('legal');
    }
  });
});

describe('selectOption', () => {
  it('picks the best option', () => {
    expect(selectOption([candidate('a', 0.3), candidate('b', 0.8)])?.key).toBe('b');
  });

  it('does nothing when nothing clears the threshold', () => {
    expect(selectOption([candidate('a', 0.3)], { threshold: 0.5 })).toBeNull();
  });

  it('does nothing when there is nothing to do', () => {
    expect(selectOption([])).toBeNull();
  });

  it('never returns a vetoed option even when it is the only one', () => {
    expect(selectOption([candidate('illegal', 0.9, 0)])).toBeNull();
  });

  it('makes worse decisions as noise rises, and only worse ones', () => {
    const options = [candidate('best', 0.9), candidate('ok', 0.6), candidate('poor', 0.35)];
    const count = (noise: number) => {
      const rng = createRng('ladder').fork('ai');
      let best = 0;
      for (let tick = 0; tick < 400; tick += 1) {
        if (selectOption(options, { noise, rng })?.key === 'best') best += 1;
      }
      return best;
    };
    expect(count(0)).toBe(400);
    expect(count(0.5)).toBeLessThan(count(0.1));
    expect(count(0.5)).toBeGreaterThan(150);
  });
});

describe('normalise', () => {
  it('maps a range onto 0–1 and clamps outside it', () => {
    expect(normalise(5, 0, 10)).toBe(0.5);
    expect(normalise(-3, 0, 10)).toBe(0);
    expect(normalise(30, 0, 10)).toBe(1);
  });

  it('degenerates safely when the range is empty', () => {
    expect(normalise(10, 10, 10)).toBe(1);
    expect(normalise(9, 10, 10)).toBe(0);
  });

  it('inverts', () => {
    expect(inverse(2.5, 0, 10)).toBe(0.75);
  });
});
