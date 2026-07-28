/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.3 — Derivation engine: weight matrix, physical modifiers, unit-tested invariants
 * @story   US-5.2 — Play any athlete in any sport
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @design  05-data-model.md §3.2 (soccer weights), §2.1 (physical modifiers)
 *
 * Purpose: how the eleven attributes become the twelve soccer ratings.
 *
 * **Why this exists before the soccer module (Phase 6).** Two reasons, both about Phase 3. The
 * compare view (T-3.9) projects an athlete's ratings for sports they have never played, and with
 * only basketball in the build there is nothing to compare *to* — the headline feature would
 * demo against itself. And a derivation engine tested against exactly one table is a derivation
 * engine that has quietly been written for that table; the soccer rows have a different shape
 * (twelve ratings, a different set of attributes carrying them), which is what proves otherwise.
 *
 * This file is data. There is no soccer `SportModule` here, and Phase 6 adds one around it.
 */
import type { PhysicalModifiers, RatingWeightTable } from '../types.ts';

/**
 * Rows sum to 1.0.
 *
 * @spec-ref 05-data-model.md §3.2
 */
export const SOCCER_WEIGHTS: RatingWeightTable = {
  finishing: { strength: 0.1, coordination: 0.25, accuracy: 0.35, composure: 0.3 },
  shotPower: { strength: 0.45, coordination: 0.3, accuracy: 0.25 },
  shortPass: { coordination: 0.3, accuracy: 0.4, awareness: 0.3 },
  longPass: { strength: 0.3, coordination: 0.1, accuracy: 0.35, awareness: 0.25 },
  dribbling: { acceleration: 0.2, agility: 0.3, coordination: 0.35, awareness: 0.15 },
  crossing: { strength: 0.1, coordination: 0.3, accuracy: 0.4, awareness: 0.2 },
  heading: { strength: 0.25, vertical: 0.4, coordination: 0.1, accuracy: 0.15, awareness: 0.1 },
  tackling: { agility: 0.2, strength: 0.3, awareness: 0.25, discipline: 0.25 },
  marking: { speed: 0.2, agility: 0.25, awareness: 0.35, discipline: 0.2 },
  offBall: { speed: 0.3, acceleration: 0.3, awareness: 0.4 },
  pace: { speed: 0.6, acceleration: 0.4 },
  goalkeeping: {
    acceleration: 0.1,
    agility: 0.35,
    vertical: 0.2,
    coordination: 0.25,
    awareness: 0.1,
  },
};

/** The height the modifiers are measured from — roughly a senior outfield average. */
export const SOCCER_REFERENCE_HEIGHT_CM = 180;

/**
 * `05` §3.2 gives no physical modifier table, so these are read off `05` §2.1's prose: "height
 * helps rebounding, interior defence, and goalkeeping and hurts low centre-of-gravity agility".
 * In soccer that is heading and goalkeeping up, dribbling down. Magnitudes are borrowed from
 * basketball's and halved, because soccer's height spread is narrower and the same per-cm figure
 * would swamp the weighted sum. Starting values for a balance pass, like everything else in `05`
 * — flagged in `PROGRESS.md` as a judgement call rather than a spec quotation.
 */
export const SOCCER_PHYSICAL: PhysicalModifiers = {
  heightCm: {
    reference: SOCCER_REFERENCE_HEIGHT_CM,
    perUnit: { heading: 0.35, goalkeeping: 0.3, dribbling: -0.15, pace: -0.05 },
  },
};
