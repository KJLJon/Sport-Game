/**
 * T-4.4 — the three modes, and the modifiers a daily challenge applies on top of a calibration.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FRAME } from '../../../../src/engine/input/types.ts';
import {
  ARCADE_MODIFIERS,
  applyModifiers,
  applyRuleModifiers,
  resolveModifiers,
  scoreMultiplierFor,
  startRun,
} from '../../../../src/modes/arcade/modes.ts';
import { calibrateWindow } from '../../../../src/modes/arcade/calibration.ts';
import { PRACTICE_RULES } from '../../../../src/modes/arcade/types.ts';
import { arcadeConfig, fakeGame, madeAttempt } from '../../../helpers/arcade.ts';

const BASE = calibrateWindow({ rating: 60, familiarity: 60, difficulty: 'pro' });

describe('resolveModifiers', () => {
  it('resolves what it knows and drops what it does not', () => {
    expect(resolveModifiers(['hurry', 'nope']).map((modifier) => modifier.id)).toEqual(['hurry']);
    expect(resolveModifiers([])).toEqual([]);
  });

  it('every declared modifier has a name and a one-line description', () => {
    for (const modifier of ARCADE_MODIFIERS) {
      expect(modifier.name.length).toBeGreaterThan(0);
      expect(modifier.description.endsWith('.')).toBe(true);
    }
  });
});

describe('applyModifiers', () => {
  it('leaves a calibration alone when there is nothing to apply', () => {
    expect(applyModifiers(BASE, [])).toBe(BASE);
  });

  it('tightens the window without touching the rating it came from', () => {
    const pressured = applyModifiers(BASE, resolveModifiers(['pressure']));
    expect(pressured.windowSeconds).toBeCloseTo(BASE.windowSeconds * 0.75, 6);
    expect(pressured.reactionSeconds).toBeCloseTo(BASE.reactionSeconds * 0.75, 6);
    expect(pressured.rating).toBe(BASE.rating);
    expect(pressured.label).toBe(BASE.label);
  });

  it('adds drift and clamps it to the scale', () => {
    const jittery = applyModifiers(BASE, resolveModifiers(['jitters']));
    expect(jittery.drift).toBeCloseTo(BASE.drift + 0.25, 6);

    const maxed = applyModifiers({ ...BASE, drift: 0.95 }, resolveModifiers(['jitters']));
    expect(maxed.drift).toBe(1);
  });

  it('is order-independent, so a challenge reads the same either way round', () => {
    const forwards = applyModifiers(BASE, resolveModifiers(['pressure', 'jitters']));
    const backwards = applyModifiers(BASE, resolveModifiers(['jitters', 'pressure']));
    expect(forwards).toEqual(backwards);
  });
});

describe('applyRuleModifiers', () => {
  it('shortens a clock and never lengthens it below a second', () => {
    expect(applyRuleModifiers({ lives: null, seconds: 60 }, resolveModifiers(['hurry']))).toEqual({
      lives: null,
      seconds: 45,
    });
    expect(applyRuleModifiers({ lives: null, seconds: 1 }, resolveModifiers(['hurry']))).toEqual({
      lives: null,
      seconds: 1,
    });
  });

  it('sets lives for sudden death', () => {
    expect(
      applyRuleModifiers({ lives: 3, seconds: null }, resolveModifiers(['sudden-death'])),
    ).toEqual({ lives: 1, seconds: null });
  });

  it('never adds a limit practice did not have', () => {
    expect(applyRuleModifiers(PRACTICE_RULES, resolveModifiers(['sudden-death', 'hurry']))).toEqual(
      PRACTICE_RULES,
    );
  });
});

describe('scoreMultiplierFor', () => {
  it('multiplies, and is 1 with nothing applied', () => {
    expect(scoreMultiplierFor([])).toBe(1);
    expect(scoreMultiplierFor(resolveModifiers(['double-or-nothing']))).toBe(2);
  });
});

describe('startRun', () => {
  it('is a plain run when nothing is modified', () => {
    const run = startRun(fakeGame(), arcadeConfig());
    expect(run.calibration).toEqual(fakeGame().calibrate(arcadeConfig().athlete, 'pro'));
  });

  it('applies the window, the rules, and the score multiplier together', () => {
    const run = startRun(
      fakeGame({
        scored: { lives: 3, seconds: null },
        onUpdate: (host) => host.attempt(madeAttempt(10)),
      }),
      arcadeConfig({ modifiers: ['double-or-nothing', 'sudden-death'] }),
    );

    const plain = startRun(fakeGame(), arcadeConfig());
    expect(run.calibration.windowSeconds).toBeLessThan(plain.calibration.windowSeconds);
    expect(run.view().livesMax).toBe(1);

    run.start();
    run.step(EMPTY_FRAME, 1 / 60);
    expect(run.view().score).toBe(20);
  });

  it('an unknown modifier changes nothing', () => {
    const run = startRun(fakeGame(), arcadeConfig({ modifiers: ['gravity'] }));
    expect(run.calibration).toEqual(startRun(fakeGame(), arcadeConfig()).calibration);
  });
});
