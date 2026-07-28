/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.6 — Behavioural coupling: familiarity → decision noise, control error, reaction penalty
 * @story   US-5.2 — Play any athlete in any sport
 * @design  05-data-model.md §3.3 (behavioural coupling)
 * @invariant INV-8 (determinism — an at-home athlete costs no random draw)
 *
 * Purpose: the pure half of the coupling. The property that matters most is the boring one: an
 * athlete at home in their sport is coupled by exactly nothing, so every call site can skip its
 * draw and the PRNG stream is unchanged from before this existed.
 */
import { describe, expect, it } from 'vitest';
import {
  NO_COUPLING,
  couplingFor,
  degradeControl,
  delayReaction,
  lostness,
  timingSpread,
} from '../../../src/athletes/coupling.ts';
import { COUPLING } from '../../../src/athletes/tuning.ts';
import { STARTING_FAMILIARITY } from '../../../src/athletes/types.ts';

describe('lostness', () => {
  it('is total for a complete novice and nothing at the fade-out point', () => {
    expect(lostness(0)).toBe(1);
    expect(lostness(COUPLING.fadeOut)).toBe(0);
    expect(lostness(100)).toBe(0);
  });

  it('is already zero at the familiarity an athlete has in their own sport', () => {
    expect(lostness(STARTING_FAMILIARITY.primary)).toBe(0);
  });

  it('is substantial at the familiarity an athlete starts a new sport with', () => {
    expect(lostness(STARTING_FAMILIARITY.other)).toBeGreaterThan(0.7);
  });

  it('never rises with familiarity', () => {
    for (let f = 0; f < 100; f++) expect(lostness(f + 1)).toBeLessThanOrEqual(lostness(f));
  });

  it('clamps rather than going negative or complex outside 0–100', () => {
    expect(lostness(-50)).toBe(1);
    expect(lostness(400)).toBe(0);
  });
});

describe('couplingFor', () => {
  it('costs an at-home athlete precisely nothing (INV-8)', () => {
    expect(couplingFor(100)).toEqual(NO_COUPLING);
    expect(couplingFor(STARTING_FAMILIARITY.primary)).toEqual(NO_COUPLING);
  });

  it('gives a novice all three penalties `05` §3.3 names', () => {
    const novice = couplingFor(0);
    expect(novice.decisionNoise).toBeCloseTo(COUPLING.decisionNoise, 10);
    expect(novice.controlError).toBeCloseTo(COUPLING.controlError, 10);
    expect(novice.reactionPenalty).toBeCloseTo(COUPLING.reactionPenalty, 10);
  });

  it('eases off as an athlete learns', () => {
    const learning = couplingFor(40);
    const novice = couplingFor(10);
    expect(learning.decisionNoise).toBeLessThan(novice.decisionNoise);
    expect(learning.controlError).toBeLessThan(novice.controlError);
    expect(learning.reactionPenalty).toBeLessThan(novice.reactionPenalty);
  });

  it('never penalises control or reaction past the point of impossibility', () => {
    for (let f = 0; f <= 100; f++) {
      const coupling = couplingFor(f);
      expect(coupling.controlError).toBeLessThan(1);
      expect(coupling.reactionPenalty).toBeLessThan(1);
    }
  });
});

describe('the three levers', () => {
  it("leave an at-home athlete's numbers untouched", () => {
    expect(degradeControl(0.8, NO_COUPLING)).toBe(0.8);
    expect(delayReaction(0.06, NO_COUPLING)).toBe(0.06);
    expect(timingSpread(NO_COUPLING)).toBe(1);
  });

  it("worsen a novice's control, reaction, and release scatter", () => {
    const novice = couplingFor(0);
    expect(degradeControl(0.8, novice)).toBeLessThan(0.8);
    expect(degradeControl(0.8, novice)).toBeGreaterThan(0);
    expect(delayReaction(0.06, novice)).toBeLessThan(0.06);
    expect(delayReaction(0.06, novice)).toBeGreaterThan(0);
    expect(timingSpread(novice)).toBeGreaterThan(2);
  });

  it('scale monotonically with how lost the athlete is', () => {
    const worse = couplingFor(10);
    const better = couplingFor(50);
    expect(degradeControl(1, worse)).toBeLessThan(degradeControl(1, better));
    expect(delayReaction(1, worse)).toBeLessThan(delayReaction(1, better));
    expect(timingSpread(worse)).toBeGreaterThan(timingSpread(better));
  });
});
