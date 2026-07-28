/**
 * T-4.1 — star ratings and the small vocabulary around a score.
 */
import { describe, expect, it } from 'vitest';
import {
  accuracy,
  nextStarTarget,
  qualityLabel,
  starLine,
  starProgress,
  starsFor,
  toNextStar,
} from '../../../../src/modes/arcade/scoring.ts';
import { fakeGame } from '../../../helpers/arcade.ts';

const THRESHOLDS: readonly [number, number, number] = [10, 20, 30];

describe('starsFor', () => {
  it('awards a star at the threshold, not one point past it', () => {
    expect(starsFor(9, THRESHOLDS)).toBe(0);
    expect(starsFor(10, THRESHOLDS)).toBe(1);
    expect(starsFor(20, THRESHOLDS)).toBe(2);
    expect(starsFor(30, THRESHOLDS)).toBe(3);
    expect(starsFor(1000, THRESHOLDS)).toBe(3);
  });
});

describe('progress towards the next star', () => {
  it('reports the points and the target still to come', () => {
    expect(toNextStar(0, THRESHOLDS)).toBe(10);
    expect(nextStarTarget(0, THRESHOLDS)).toBe(10);
    expect(toNextStar(15, THRESHOLDS)).toBe(5);
    expect(nextStarTarget(15, THRESHOLDS)).toBe(20);
  });

  it('reports null at three stars, so the UI can say "maxed" rather than "0 to go"', () => {
    expect(toNextStar(30, THRESHOLDS)).toBeNull();
    expect(nextStarTarget(30, THRESHOLDS)).toBeNull();
    expect(starProgress(30, THRESHOLDS)).toBe(1);
  });

  it('measures progress within the current band', () => {
    expect(starProgress(0, THRESHOLDS)).toBe(0);
    expect(starProgress(5, THRESHOLDS)).toBeCloseTo(0.5, 5);
    expect(starProgress(15, THRESHOLDS)).toBeCloseTo(0.5, 5);
    expect(starProgress(25, THRESHOLDS)).toBeCloseTo(0.5, 5);
  });

  it('clamps a score below zero rather than reporting negative progress', () => {
    expect(starProgress(-50, THRESHOLDS)).toBe(0);
    expect(starProgress(10, [10, 10, 10])).toBe(1);
  });
});

describe('accuracy', () => {
  it('is a percentage, and zero attempts is zero', () => {
    expect(accuracy(0, 0)).toBe(0);
    expect(accuracy(3, 4)).toBe(75);
  });
});

describe('qualityLabel', () => {
  it('describes an attempt in words rather than in colour', () => {
    expect(qualityLabel(1)).toBe('Perfect');
    expect(qualityLabel(0.8)).toBe('Great');
    expect(qualityLabel(0.5)).toBe('Good');
    expect(qualityLabel(0.2)).toBe('Off');
    expect(qualityLabel(0)).toBe('Missed');
  });
});

describe('starLine', () => {
  it('formats a tile’s three thresholds', () => {
    expect(starLine(fakeGame({ stars: [800, 1400, 2000] }))).toBe('800 · 1,400 · 2,000');
  });
});
