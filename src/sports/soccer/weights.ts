/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.3 — Derivation engine: weight matrix, physical modifiers, unit-tested invariants
 * @task    T-6.13 — Soccer derivation weights, sub-skills, familiarity tuning
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
import type { PhysicalModifiers, PositionWeightTable, RatingWeightTable } from '../types.ts';

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

/**
 * Position → weights over soccer's derived ratings, for overall and position fit (`05` §3.4). Rows
 * sum to 1.0, so an overall lands on the same 1–99 scale as the ratings it is built from.
 *
 * Keyed on `formations.ts`'s role ids. A keeper's row is the whole point of the table: `goalkeeping`
 * at 0.6 means an outfielder's overall *as a goalkeeper* is correctly dreadful, which is what makes
 * playing someone out of position visibly a choice rather than a rounding error.
 *
 * Roles that share a job share a row — the two centre backs, the two strikers — because a position
 * table is about the job, not the shirt number. `formation()` role ids that are not listed fall back
 * to the generic outfield row, so adding 4-2-3-1 does not require touching this file.
 *
 * @spec-ref 05-data-model.md §3.4
 */
export const SOCCER_POSITION_WEIGHTS: PositionWeightTable = {
  gk: { goalkeeping: 0.6, longPass: 0.15, marking: 0.1, shortPass: 0.1, pace: 0.05 },

  // Full backs and wing-backs: get up and down the flank, defend, and put a ball in.
  lb: { marking: 0.25, tackling: 0.2, pace: 0.2, crossing: 0.15, shortPass: 0.1, offBall: 0.1 },
  rb: { marking: 0.25, tackling: 0.2, pace: 0.2, crossing: 0.15, shortPass: 0.1, offBall: 0.1 },
  lwb: { pace: 0.25, crossing: 0.2, marking: 0.18, tackling: 0.15, offBall: 0.12, shortPass: 0.1 },
  rwb: { pace: 0.25, crossing: 0.2, marking: 0.18, tackling: 0.15, offBall: 0.12, shortPass: 0.1 },

  // Centre backs: head it, win it, and start the move.
  lcb: { marking: 0.3, tackling: 0.28, heading: 0.22, shortPass: 0.12, longPass: 0.08 },
  rcb: { marking: 0.3, tackling: 0.28, heading: 0.22, shortPass: 0.12, longPass: 0.08 },
  cb: { marking: 0.3, tackling: 0.28, heading: 0.22, shortPass: 0.12, longPass: 0.08 },

  // Midfield. The holding role is weighted towards winning it back, the centres towards using it.
  dm: { tackling: 0.25, marking: 0.22, shortPass: 0.25, longPass: 0.15, offBall: 0.13 },
  lcm: {
    shortPass: 0.28,
    longPass: 0.2,
    offBall: 0.18,
    tackling: 0.14,
    dribbling: 0.12,
    pace: 0.08,
  },
  rcm: {
    shortPass: 0.28,
    longPass: 0.2,
    offBall: 0.18,
    tackling: 0.14,
    dribbling: 0.12,
    pace: 0.08,
  },
  cm: {
    shortPass: 0.28,
    longPass: 0.2,
    offBall: 0.18,
    tackling: 0.14,
    dribbling: 0.12,
    pace: 0.08,
  },
  lm: { shortPass: 0.22, crossing: 0.2, pace: 0.18, offBall: 0.15, dribbling: 0.15, tackling: 0.1 },
  rm: { shortPass: 0.22, crossing: 0.2, pace: 0.18, offBall: 0.15, dribbling: 0.15, tackling: 0.1 },

  // Wide forwards: beat someone, then finish or cross.
  lw: { dribbling: 0.25, pace: 0.22, crossing: 0.18, finishing: 0.17, offBall: 0.18 },
  rw: { dribbling: 0.25, pace: 0.22, crossing: 0.18, finishing: 0.17, offBall: 0.18 },

  // Strikers.
  ls: { finishing: 0.34, offBall: 0.22, shotPower: 0.14, heading: 0.14, pace: 0.16 },
  rs: { finishing: 0.34, offBall: 0.22, shotPower: 0.14, heading: 0.14, pace: 0.16 },
  cf: { finishing: 0.34, offBall: 0.2, heading: 0.16, shotPower: 0.14, pace: 0.16 },
};

/** The row used for a role id the table does not name — a generic outfielder. */
export const SOCCER_DEFAULT_POSITION = 'cm';
