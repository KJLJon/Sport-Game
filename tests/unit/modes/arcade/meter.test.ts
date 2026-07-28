/**
 * T-4.5–4.8 — the shared release meter: the band is the athlete's window expressed in seconds, and
 * speeding the meter up must not change that.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../src/engine/rng.ts';
import { calibrateWindow } from '../../../../src/modes/arcade/calibration.ts';
import {
  BAND_LIMITS,
  BASE_SWEEP_SECONDS,
  ReleaseMeter,
  outcomeChance,
  resolveShot,
} from '../../../../src/modes/arcade/meter.ts';

const STAR = calibrateWindow({ rating: 90, familiarity: 90, difficulty: 'pro' });
const NOVICE = calibrateWindow({ rating: 20, familiarity: 10, difficulty: 'pro' });

describe('the sweep', () => {
  it('travels at the calibrated speed and bounces at both ends', () => {
    const meter = new ReleaseMeter({ calibration: STAR });
    const seconds = BASE_SWEEP_SECONDS / STAR.speed;

    meter.update(seconds * 0.5);
    expect(meter.position).toBeCloseTo(0.5, 4);

    meter.update(seconds * 0.75);
    // Past the top and coming back down, never outside the track.
    expect(meter.position).toBeGreaterThanOrEqual(0);
    expect(meter.position).toBeLessThanOrEqual(1);
  });

  it('stays on the track however large the step', () => {
    const meter = new ReleaseMeter({ calibration: NOVICE });
    for (let i = 0; i < 50; i++) {
      meter.update(3.7);
      expect(meter.position).toBeGreaterThanOrEqual(0);
      expect(meter.position).toBeLessThanOrEqual(1);
    }
  });

  it('ignores a non-positive step', () => {
    const meter = new ReleaseMeter({ calibration: STAR });
    meter.update(0);
    meter.update(-1);
    expect(meter.position).toBe(0);
  });

  it('resets to the bottom, travelling up', () => {
    const meter = new ReleaseMeter({ calibration: STAR });
    meter.update(10);
    meter.reset();
    expect(meter.position).toBe(0);
    meter.update(0.01);
    expect(meter.position).toBeGreaterThan(0);
  });
});

describe('the band', () => {
  it('is wider for a better athlete', () => {
    expect(new ReleaseMeter({ calibration: STAR }).halfWidth).toBeGreaterThan(
      new ReleaseMeter({ calibration: NOVICE }).halfWidth,
    );
  });

  it('is clamped, so it is never invisible and never the whole track', () => {
    const tiny = calibrateWindow({ rating: 1, familiarity: 0, difficulty: 'legend' });
    const huge = calibrateWindow({ rating: 99, familiarity: 100, difficulty: 'rookie' });
    expect(new ReleaseMeter({ calibration: tiny, speedScale: 4 }).halfWidth).toBeGreaterThanOrEqual(
      BAND_LIMITS.min,
    );
    expect(new ReleaseMeter({ calibration: huge }).halfWidth).toBeLessThanOrEqual(BAND_LIMITS.max);
  });

  it('keeps the athlete’s window in *seconds* when the meter speeds up', () => {
    const slow = new ReleaseMeter({ calibration: STAR });
    const fast = new ReleaseMeter({ calibration: STAR, speedScale: 2 });

    // Twice the travel rate over the same seconds of forgiveness is twice the band in track units —
    // which is exactly why the faster meter feels harder without the window having changed.
    expect(fast.halfWidth / slow.halfWidth).toBeCloseTo(2, 4);
    expect(fast.halfWidth / fast.travelRate).toBeCloseTo(slow.halfWidth / slow.travelRate, 6);
  });

  it('never leaves the track when it drifts', () => {
    const meter = new ReleaseMeter({ calibration: NOVICE, rng: createRng('drift') });
    for (let i = 0; i < 400; i++) {
      meter.update(0.05);
      const band = meter.band();
      expect(band.from).toBeGreaterThanOrEqual(-1e-9);
      expect(band.to).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('does not move for an athlete with no drift left to give', () => {
    const meter = new ReleaseMeter({ calibration: { ...STAR, drift: 0 }, rng: createRng('x') });
    const centre = meter.centre;
    meter.update(2);
    expect(meter.centre).toBe(centre);
  });

  it('wanders more for a novice than for a specialist', () => {
    const spread = (calibration: typeof STAR): number => {
      const meter = new ReleaseMeter({ calibration, rng: createRng('drift') });
      let low = 1;
      let high = 0;
      for (let i = 0; i < 400; i++) {
        meter.update(0.05);
        low = Math.min(low, meter.centre);
        high = Math.max(high, meter.centre);
      }
      return high - low;
    };
    expect(spread(NOVICE)).toBeGreaterThan(spread(STAR));
  });
});

describe('judging a release', () => {
  it('is perfect at the centre and zero outside the band', () => {
    const meter = new ReleaseMeter({ calibration: STAR });
    meter.position = meter.centre;
    expect(meter.judge().quality).toBeCloseTo(1, 6);
    expect(meter.judge().inBand).toBe(true);

    meter.position = 0;
    expect(meter.judge().quality).toBe(0);
    expect(meter.judge().inBand).toBe(false);
    expect(meter.judge().early).toBe(true);
  });

  it('reports which side of the band a miss was on', () => {
    const meter = new ReleaseMeter({ calibration: STAR });
    meter.position = 1;
    expect(meter.judge().early).toBe(false);
  });
});

describe('the outcome band (09 §2.4)', () => {
  it('a perfect release from a novice is still not a certainty', () => {
    expect(outcomeChance(NOVICE, 1)).toBeLessThan(1);
    expect(outcomeChance(NOVICE, 1)).toBe(NOVICE.ceiling);
  });

  it('a poor release from a specialist is still not a disaster', () => {
    expect(outcomeChance(STAR, 0)).toBeGreaterThan(outcomeChance(NOVICE, 0));
  });

  it('clamps a quality outside the scale', () => {
    expect(outcomeChance(STAR, -3)).toBe(STAR.floor);
    expect(outcomeChance(STAR, 9)).toBe(STAR.ceiling);
  });

  it('resolves through the run’s generator, so the same seed gives the same result', () => {
    const a = resolveShot(STAR, 0.5, createRng('shot'));
    const b = resolveShot(STAR, 0.5, createRng('shot'));
    expect(a).toBe(b);
  });

  it('a specialist makes more of the same releases than a novice', () => {
    const count = (calibration: typeof STAR): number => {
      const rng = createRng('many');
      let made = 0;
      for (let i = 0; i < 500; i++) if (resolveShot(calibration, 0.7, rng)) made++;
      return made;
    };
    expect(count(STAR)).toBeGreaterThan(count(NOVICE));
  });
});
