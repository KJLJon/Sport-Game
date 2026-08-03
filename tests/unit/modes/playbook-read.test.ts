/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.6 — Playbook AI depth for both sports: tendency modelling, counter-calling
 * @story   US-15.7 — Face a Playbook CPU that reads you
 * @design  06-game-design.md §7
 * @invariant INV-1 (difficulty never touches a rating)
 *
 * Purpose: the two halves of "reads you". The half worth the most attention is the second one —
 * a CPU that punishes your patterns and has none of its own — because its absence is what made
 * Legend the most predictable level in Playbook (T-7.10's finding).
 */
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../../../src/modes/difficulty.ts';
import {
  readStrength,
  repeatPenalty,
  scaleRead,
  varietyStrength,
} from '../../../src/modes/playbook/read.ts';

const many = (call: string, times: number): { call: string }[] =>
  Array.from({ length: times }, () => ({ call }));

describe('readStrength', () => {
  it('runs from not reading you at all to reading you consistently', () => {
    expect(readStrength('rookie')).toBe(0);
    expect(readStrength('legend')).toBe(1);
  });

  it('rises with every level, in the order the picker shows them', () => {
    const strengths = DIFFICULTIES.map((level) => readStrength(level));
    for (let i = 1; i < strengths.length; i += 1) {
      expect(strengths[i] as number).toBeGreaterThan(strengths[i - 1] as number);
    }
  });
});

describe('scaleRead', () => {
  it('throws a Rookie read away and keeps a Legend one whole', () => {
    expect(scaleRead(0.5, 'rookie')).toBe(0);
    expect(scaleRead(0.5, 'legend')).toBe(0.5);
  });

  it('keeps the sign — countering a bad read should not become a bonus', () => {
    expect(scaleRead(-0.3, 'allStar')).toBeLessThan(0);
  });
});

describe('repeatPenalty', () => {
  it('says nothing about a call the CPU has not leaned on', () => {
    const mixed = [...many('a', 3), ...many('b', 3), ...many('c', 3)];

    expect(repeatPenalty(mixed, 'a', 1, 1, 3)).toBe(0);
  });

  it('discounts the call it keeps making', () => {
    const spammed = [...many('a', 9), ...many('b', 1)];

    expect(repeatPenalty(spammed, 'a', 1, 1, 4)).toBeGreaterThan(0);
    expect(repeatPenalty(spammed, 'b', 1, 1, 4)).toBe(0);
  });

  it('discounts harder the harder it is being leaned on', () => {
    const some = [...many('a', 5), ...many('b', 5)];
    const all = many('a', 10);

    expect(repeatPenalty(all, 'a', 1, 1, 4)).toBeGreaterThan(repeatPenalty(some, 'a', 1, 1, 4));
  });

  it('is a share, so a short history and a long one read the same', () => {
    expect(repeatPenalty(many('a', 4), 'a', 1, 1, 4)).toBeCloseTo(
      repeatPenalty(many('a', 40), 'a', 1, 1, 4),
    );
  });

  it('only a level that reads you bothers to vary itself', () => {
    const spammed = many('a', 8);

    expect(repeatPenalty(spammed, 'a', 1, varietyStrength('rookie'), 4)).toBe(0);
    expect(repeatPenalty(spammed, 'a', 1, varietyStrength('legend'), 4)).toBeGreaterThan(
      repeatPenalty(spammed, 'a', 1, varietyStrength('pro'), 4),
    );
  });

  it('is a discount, not a ban — a dominant call still gets called', () => {
    // Even at full lean and full variety, the penalty stays inside the weight it was given, so a
    // call that is better than the alternatives by more than that is still the one taken.
    expect(repeatPenalty(many('a', 12), 'a', 0.2, 1, 4)).toBeLessThan(0.2);
  });

  it('says nothing when there was only ever one call to make', () => {
    expect(repeatPenalty(many('a', 8), 'a', 1, 1, 1)).toBe(0);
  });

  it('says nothing at all about an empty history, or a switched-off weight', () => {
    expect(repeatPenalty([], 'a', 1, 1, 4)).toBe(0);
    expect(repeatPenalty(many('a', 5), 'a', 0, 1, 4)).toBe(0);
    expect(repeatPenalty(many('a', 5), 'a', 1, 0, 4)).toBe(0);
  });
});
