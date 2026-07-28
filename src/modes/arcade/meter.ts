/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.5 — Free Throw — release timing under mounting pressure
 * @task    T-4.6 — Three-Point Contest — five racks, rhythm and timing, 60 s
 * @task    T-4.7 — Buzzer Beater — contested shot, shrinking window
 * @task    T-4.8 — Fast Break — finish past a recovering defender
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §2.4 (the fairness rule), 06-game-design.md §2 (release window)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: the sweeping release meter four of the five basketball games are built on, and the one
 * place a calibration becomes a band you can actually hit.
 *
 * **Why it is shared.** "Release timing on a moving meter" is the same mechanic in Free Throw, the
 * Three-Point Contest, Buzzer Beater, and Fast Break; what differs between them is the pressure
 * around it. Four copies of a sweep would be four places for the athlete's window to stop meaning
 * the same thing, and the fairness rule is only credible if it means one thing everywhere.
 *
 * **Seconds, not pixels.** A calibration is stated in seconds of forgiveness, so the band's width in
 * meter units is derived from the sweep rate. Speeding the meter up therefore *narrows* the band in
 * screen terms while leaving the athlete's window in seconds exactly what it was — which is what
 * makes "mounting pressure" harder without quietly rewriting who the athlete is.
 */
import type { Rng } from '../../engine/rng.ts';
import type { ArcadeBand, ArcadeCalibration } from './types.ts';

/** Seconds for one full sweep, up and back, at speed 1. */
export const BASE_SWEEP_SECONDS = 1.6;

/** The band never shrinks past this or grows past this, in meter units. */
export const BAND_LIMITS = { min: 0.02, max: 0.34 } as const;

export interface MeterOptions {
  readonly calibration: ArcadeCalibration;
  /** Where the band sits, `0–1`. Defaults to the middle. */
  readonly centre?: number;
  /** Extra speed on top of the calibration's — how a game ramps pressure. */
  readonly speedScale?: number;
  /** Extra tightening on top of the calibration's window, `0–1`. */
  readonly windowScale?: number;
  /** Drives the band's wander. Omit for a meter that does not drift. */
  readonly rng?: Rng;
}

/**
 * A marker sweeping up and down past a target band. Deterministic: it advances only by the `dt` it
 * is given, and its wander comes from the run's own generator.
 */
export class ReleaseMeter {
  private readonly calibration: ArcadeCalibration;
  private readonly baseCentre: number;
  private readonly driftPhase: number;
  private readonly driftRate: number;

  /** Marker position, `0–1`. */
  position = 0;
  /** Extra speed a game applies as it ramps up. */
  speedScale: number;
  /** Extra tightening a game applies. */
  windowScale: number;

  private direction: 1 | -1 = 1;
  private time = 0;

  constructor(options: MeterOptions) {
    this.calibration = options.calibration;
    this.baseCentre = options.centre ?? 0.5;
    this.speedScale = options.speedScale ?? 1;
    this.windowScale = options.windowScale ?? 1;
    // Two draws, always, whether or not the meter drifts — so a game that adds drift later does not
    // shift the run's PRNG stream and break every golden-seed expectation with it.
    this.driftPhase = (options.rng?.next() ?? 0) * Math.PI * 2;
    this.driftRate = 0.7 + (options.rng?.next() ?? 0.5) * 0.9;
  }

  /** Sweeps per second, both directions counted. */
  get sweepRate(): number {
    return this.calibration.speed * this.speedScale;
  }

  /** How far the marker travels per second, in meter units. */
  get travelRate(): number {
    return this.sweepRate / BASE_SWEEP_SECONDS;
  }

  /** Half-width of the target band, in meter units. */
  get halfWidth(): number {
    const seconds = this.calibration.windowSeconds * this.windowScale;
    const units = seconds * this.travelRate;
    return Math.min(BAND_LIMITS.max, Math.max(BAND_LIMITS.min, units));
  }

  /** Where the band sits right now — the drift is what makes an unfamiliar sport feel unsteady. */
  get centre(): number {
    const wander = Math.sin(this.time * this.driftRate + this.driftPhase) * this.calibration.drift;
    const half = this.halfWidth;
    // Clamped so a drifting band never leaves the meter, which would be unwinnable rather than hard.
    return Math.min(1 - half, Math.max(half, this.baseCentre + wander * 0.25));
  }

  band(): ArcadeBand {
    const half = this.halfWidth;
    const centre = this.centre;
    return { from: centre - half, to: centre + half };
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    let remaining = this.position + this.direction * this.travelRate * dt;
    // Bounce, rather than wrap: the marker must come back past the band, which is what makes the
    // second chance in a sweep feel earned instead of arbitrary.
    while (remaining < 0 || remaining > 1) {
      if (remaining > 1) {
        remaining = 2 - remaining;
        this.direction = -1;
      } else {
        remaining = -remaining;
        this.direction = 1;
      }
    }
    this.position = remaining;
  }

  /** Puts the marker back at the bottom for the next attempt. */
  reset(): void {
    this.position = 0;
    this.direction = 1;
  }

  /**
   * How good a release at the current position is. `1` is dead centre, `0` is anywhere outside the
   * band — the input decides where in the athlete's outcome band the result lands, and outside the
   * window there is no band to land in (`09` §2.4).
   */
  judge(): { readonly quality: number; readonly inBand: boolean; readonly early: boolean } {
    const centre = this.centre;
    const half = this.halfWidth;
    const offset = this.position - centre;
    const distance = Math.abs(offset);
    return {
      quality: distance >= half ? 0 : 1 - distance / half,
      inBand: distance < half,
      early: offset < 0,
    };
  }
}

/**
 * Maps a release quality onto the athlete's outcome band. A perfect release from a novice is still
 * not a certainty, and a poor one from a specialist is still not a disaster — which is the whole of
 * `09` §2.4 in one line of arithmetic.
 */
export function outcomeChance(calibration: ArcadeCalibration, quality: number): number {
  const clamped = quality < 0 ? 0 : quality > 1 ? 1 : quality;
  return calibration.floor + (calibration.ceiling - calibration.floor) * clamped;
}

/** Whether a release goes in, drawn from the run's generator. */
export function resolveShot(calibration: ArcadeCalibration, quality: number, rng: Rng): boolean {
  return rng.next() < outcomeChance(calibration, quality);
}
