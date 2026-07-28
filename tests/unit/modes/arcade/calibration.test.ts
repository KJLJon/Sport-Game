/**
 * T-4.2 — ratings and familiarity become window sizes and speeds. The behavioural half of INV-10;
 * the structural half is in `tests/invariants/inv-10-arcade-calibration.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_SHAPE,
  arcadeRating,
  calibrateForAthlete,
  calibrateWindow,
  windowHint,
  windowLabel,
} from '../../../../src/modes/arcade/calibration.ts';
import { DIFFICULTIES, DIFFICULTY_PROFILES } from '../../../../src/modes/difficulty.ts';
import {
  BASKETBALL_WEIGHTS,
  BASKETBALL_PHYSICAL,
} from '../../../../src/sports/basketball/weights.ts';
import { newSportSkill } from '../../../../src/athletes/types.ts';
import { athlete, attributes } from '../../../helpers/athletes.ts';

const TABLES = { weights: BASKETBALL_WEIGHTS, physicalModifiers: BASKETBALL_PHYSICAL };

describe('arcadeRating', () => {
  it('is the mean of the ratings a game reads', () => {
    expect(arcadeRating({ freeThrow: 80, composure: 60 }, ['freeThrow', 'composure'])).toBe(70);
  });

  it('ignores ratings the sport does not define, and falls back to average', () => {
    expect(arcadeRating({ freeThrow: 80 }, ['freeThrow', 'nope'])).toBe(80);
    expect(arcadeRating({}, ['nope'])).toBe(50);
    expect(arcadeRating({ freeThrow: 80 }, [])).toBe(50);
  });
});

describe('the fairness rule (09 §2.4)', () => {
  it('a specialist gets a wide, slow, steady window; a novice a narrow, fast, drifting one', () => {
    const star = calibrateWindow({ rating: 92, familiarity: 90, difficulty: 'pro' });
    const novice = calibrateWindow({ rating: 22, familiarity: 10, difficulty: 'pro' });

    expect(star.windowSeconds).toBeGreaterThan(novice.windowSeconds);
    expect(star.speed).toBeLessThan(novice.speed);
    expect(star.drift).toBeLessThan(novice.drift);
    expect(star.reactionSeconds).toBeGreaterThan(novice.reactionSeconds);
    expect(star.floor).toBeGreaterThan(novice.floor);
    expect(star.ceiling).toBeGreaterThan(novice.ceiling);
  });

  it('every window number moves monotonically with the rating', () => {
    let previous = calibrateWindow({ rating: 1, familiarity: 50, difficulty: 'pro' });
    for (let rating = 5; rating <= 99; rating += 5) {
      const next = calibrateWindow({ rating, familiarity: 50, difficulty: 'pro' });
      expect(next.windowSeconds).toBeGreaterThanOrEqual(previous.windowSeconds);
      expect(next.speed).toBeLessThanOrEqual(previous.speed);
      expect(next.drift).toBeLessThanOrEqual(previous.drift);
      expect(next.ceiling).toBeGreaterThanOrEqual(previous.ceiling);
      previous = next;
    }
  });

  it('clamps a rating outside the scale rather than extrapolating', () => {
    const low = calibrateWindow({ rating: -40, familiarity: 0, difficulty: 'pro' });
    const high = calibrateWindow({ rating: 400, familiarity: 100, difficulty: 'pro' });
    expect(low.rating).toBe(1);
    expect(high.rating).toBe(99);
    expect(high.windowSeconds).toBeLessThanOrEqual(DEFAULT_WINDOW_SHAPE.window[1]);
  });

  it('a game may reshape the mapping without changing its direction', () => {
    const shape = { ...DEFAULT_WINDOW_SHAPE, window: [0.4, 0.9] as const };
    const wide = calibrateWindow({ rating: 50, familiarity: 50, difficulty: 'pro', shape });
    const standard = calibrateWindow({ rating: 50, familiarity: 50, difficulty: 'pro' });
    expect(wide.windowSeconds).toBeGreaterThan(standard.windowSeconds);
  });
});

describe('difficulty (INV-1)', () => {
  it('scales the forgiveness numbers and nothing that describes the athlete', () => {
    const base = calibrateWindow({ rating: 70, familiarity: 60, difficulty: 'pro' });
    for (const difficulty of DIFFICULTIES) {
      const scaled = calibrateWindow({ rating: 70, familiarity: 60, difficulty });
      const factor = DIFFICULTY_PROFILES[difficulty].timingWindow;

      expect(scaled.rating).toBe(base.rating);
      expect(scaled.speed).toBe(base.speed);
      expect(scaled.drift).toBe(base.drift);
      expect(scaled.floor).toBe(base.floor);
      expect(scaled.ceiling).toBe(base.ceiling);
      expect(scaled.windowSeconds).toBeCloseTo(base.windowSeconds * factor, 3);
      expect(scaled.reactionSeconds).toBeCloseTo(base.reactionSeconds * factor, 3);
    }
  });

  it('Rookie is more forgiving than Legend', () => {
    const rookie = calibrateWindow({ rating: 70, familiarity: 60, difficulty: 'rookie' });
    const legend = calibrateWindow({ rating: 70, familiarity: 60, difficulty: 'legend' });
    expect(rookie.windowSeconds).toBeGreaterThan(legend.windowSeconds);
  });
});

describe('the picker’s hint (US-16.3)', () => {
  it('labels the width in plain language', () => {
    expect(windowLabel(20)).toBe('narrow');
    expect(windowLabel(40)).toBe('tight');
    expect(windowLabel(55)).toBe('fair');
    expect(windowLabel(70)).toBe('wide');
    expect(windowLabel(90)).toBe('very wide');
  });

  it('names the familiarity behind the window, so narrow reads as fixable', () => {
    expect(windowHint('narrow', 5)).toBe('Narrow window — new to this sport.');
    expect(windowHint('very wide', 95)).toBe('Very wide window — a natural at this.');
    expect(windowHint('fair', 55)).toContain('Fair window —');
  });
});

describe('calibrateForAthlete', () => {
  it('runs the athlete through the same derivation the athlete card uses', () => {
    const shooter = athlete({
      attributes: attributes(50, { accuracy: 95, coordination: 90, composure: 90 }),
    });
    const clumsy = athlete({
      attributes: attributes(50, { accuracy: 20, coordination: 20, composure: 20 }),
    });

    const good = calibrateForAthlete({
      athlete: shooter,
      sport: 'basketball',
      tables: TABLES,
      ratings: ['freeThrow'],
      difficulty: 'pro',
    });
    const bad = calibrateForAthlete({
      athlete: clumsy,
      sport: 'basketball',
      tables: TABLES,
      ratings: ['freeThrow'],
      difficulty: 'pro',
    });

    expect(good.rating).toBeGreaterThan(bad.rating);
    expect(good.windowSeconds).toBeGreaterThan(bad.windowSeconds);
  });

  it('practising a second sport visibly widens the window (US-16.3)', () => {
    const base = athlete({ primarySport: 'soccer' });
    const learning = athlete({
      ...base,
      sportSkills: { ...base.sportSkills, basketball: { ...newSportSkill(75) } },
    });

    const cold = calibrateForAthlete({
      athlete: base,
      sport: 'basketball',
      tables: TABLES,
      ratings: ['freeThrow'],
      difficulty: 'pro',
    });
    const warm = calibrateForAthlete({
      athlete: learning,
      sport: 'basketball',
      tables: TABLES,
      ratings: ['freeThrow'],
      difficulty: 'pro',
    });

    expect(cold.rating).toBeLessThan(warm.rating);
    expect(cold.windowSeconds).toBeLessThan(warm.windowSeconds);
    expect(cold.hint).toContain('new to this sport');
  });

  it('passes a game’s own shape through', () => {
    const shape = { ...DEFAULT_WINDOW_SHAPE, reaction: [1, 2] as const };
    const calibration = calibrateForAthlete({
      athlete: athlete(),
      sport: 'basketball',
      tables: TABLES,
      ratings: ['perimeterD'],
      difficulty: 'pro',
      shape,
    });
    expect(calibration.reactionSeconds).toBeGreaterThanOrEqual(1);
  });
});
