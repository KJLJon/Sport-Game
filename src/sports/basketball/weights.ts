/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.2 — Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts
 * @story   US-3.1 — Play a 5v5 basketball match
 * @story   US-5.2 — Play an athlete out of their sport
 * @design  05-data-model.md §3.1 (basketball weights and physical modifiers)
 *
 * Purpose: how the eleven attributes become the ten basketball ratings. The table lives on the sport
 * module rather than in the athlete layer, because that is what makes "adding a sport adds its
 * ratings too" true (`04` §5).
 *
 * The derivation engine that consumes this is T-3.3; the physical modifiers are declared here for
 * the same reason the weights are, and applied there.
 */
import type { PhysicalModifiers, PositionWeightTable, RatingWeightTable } from '../types.ts';

/**
 * Rows sum to 1.0. A missing attribute is a zero — written out rather than implied, so a row that
 * has drifted off 1.0 is visible in the diff.
 *
 * @spec-ref 05-data-model.md §3.1
 */
export const BASKETBALL_WEIGHTS: RatingWeightTable = {
  finishing: {
    acceleration: 0.1,
    agility: 0.15,
    strength: 0.2,
    vertical: 0.2,
    coordination: 0.2,
    accuracy: 0.1,
    composure: 0.05,
  },
  midRange: { vertical: 0.05, coordination: 0.25, accuracy: 0.4, awareness: 0.1, composure: 0.2 },
  threePoint: {
    vertical: 0.05,
    coordination: 0.25,
    accuracy: 0.45,
    awareness: 0.05,
    composure: 0.2,
  },
  freeThrow: { coordination: 0.15, accuracy: 0.5, composure: 0.35 },
  ballHandling: {
    acceleration: 0.1,
    agility: 0.3,
    coordination: 0.35,
    accuracy: 0.1,
    awareness: 0.15,
  },
  passing: { coordination: 0.2, accuracy: 0.3, awareness: 0.4, composure: 0.1 },
  perimeterD: {
    speed: 0.2,
    acceleration: 0.15,
    agility: 0.25,
    strength: 0.05,
    awareness: 0.2,
    discipline: 0.15,
  },
  interiorD: { agility: 0.05, strength: 0.3, vertical: 0.25, awareness: 0.2, discipline: 0.2 },
  rebounding: { agility: 0.05, strength: 0.25, vertical: 0.35, coordination: 0.1, awareness: 0.25 },
  courtSpeed: { speed: 0.5, acceleration: 0.3, agility: 0.1, coordination: 0.1 },
};

/**
 * Height adjustments applied after the weighted sum, per centimetre away from 195 cm.
 *
 * @spec-ref 05-data-model.md §3.1 — "rebounding and interiorD + (heightCm − 195) × 0.35;
 * ballHandling and perimeterD − (heightCm − 195) × 0.15"
 */
export const BASKETBALL_HEIGHT_MODIFIERS: Readonly<Record<string, number>> = {
  rebounding: 0.35,
  interiorD: 0.35,
  ballHandling: -0.15,
  perimeterD: -0.15,
};

/** The height the modifiers are measured from. */
export const BASKETBALL_REFERENCE_HEIGHT_CM = 195;

/** The same table in the shape the derivation engine consumes (T-3.3). */
export const BASKETBALL_PHYSICAL: PhysicalModifiers = {
  heightCm: {
    reference: BASKETBALL_REFERENCE_HEIGHT_CM,
    perUnit: BASKETBALL_HEIGHT_MODIFIERS,
  },
};

/**
 * Position → derived-rating weights, for overall and position fit (`05` §3.4). Rows sum to 1.0.
 *
 * `05` gives the formula but not this table, so these are starting values in the same sense as
 * everything else in `05`: a point guard is judged mostly on handling, passing, and the perimeter;
 * a centre almost entirely on the paint. What matters for the feature is that the *shape* differs
 * enough between positions that a fit warning means something — a centre played at point guard
 * should fall well under the 0.85 threshold, and there is a test that says so.
 *
 * @spec-ref 05-data-model.md §3.4
 */
export const BASKETBALL_POSITION_WEIGHTS: PositionWeightTable = {
  PG: {
    ballHandling: 0.25,
    passing: 0.25,
    threePoint: 0.15,
    midRange: 0.1,
    perimeterD: 0.15,
    courtSpeed: 0.1,
  },
  SG: {
    threePoint: 0.25,
    midRange: 0.2,
    ballHandling: 0.12,
    passing: 0.08,
    perimeterD: 0.18,
    courtSpeed: 0.1,
    finishing: 0.07,
  },
  SF: {
    finishing: 0.18,
    threePoint: 0.18,
    midRange: 0.12,
    perimeterD: 0.18,
    rebounding: 0.12,
    ballHandling: 0.08,
    courtSpeed: 0.07,
    passing: 0.07,
  },
  PF: {
    finishing: 0.2,
    interiorD: 0.22,
    rebounding: 0.25,
    midRange: 0.1,
    threePoint: 0.08,
    passing: 0.05,
    courtSpeed: 0.05,
    perimeterD: 0.05,
  },
  C: {
    finishing: 0.22,
    interiorD: 0.28,
    rebounding: 0.3,
    midRange: 0.05,
    passing: 0.05,
    courtSpeed: 0.05,
    freeThrow: 0.05,
  },
};
