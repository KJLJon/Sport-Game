/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.17 — Wire real athletes into basketball Live — lineups drive the sim
 * @story   US-5.2 — Play any athlete in any sport
 * @design  05-data-model.md §3 (derivation), §3.3 (familiarity), 04-architecture.md §5 (the seam)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: turns real athletes into the numbers basketball's models read. This is what T-2.x's
 * `rollRatings()` placeholder was standing in for, and wiring it is the whole point of the
 * cross-sport system — from here, a soccer player you created is a basketball player who is
 * visibly out of their depth, because every model downstream is reading their real derived
 * ratings and their real familiarity.
 *
 * Two things it deliberately keeps.
 *
 * **The seeded fallback stays.** A match handed no roster still fills itself from the match seed,
 * exactly as before. The balance harness runs 500 games with no save file, the determinism tests
 * replay from `(seed, setup, inputs)` alone, and a test that wanted to check the shot clock should
 * not have to build ten athletes first. Real rosters are an *input*, not a prerequisite.
 *
 * **Five of the fourteen numbers are attributes, not derived ratings.** `composure`, `agility`,
 * `strength`, `vertical`, and `discipline` are read by the models as themselves — they are what a
 * body does, not what a sport teaches — so they come straight off `attributes` and are *not* gated
 * by familiarity. A novice does not become weaker or shorter for being in the wrong sport; they
 * become worse at basketball, which is exactly the distinction `05` §3 draws.
 */
import { couplingFor, type Coupling } from '../../athletes/coupling.ts';
import { deriveRatings } from '../../athletes/derivation.ts';
import { fatigueMultiplier } from '../../athletes/condition.ts';
import { sportSkillFor, type Athlete } from '../../athletes/types.ts';
import { movementProfile, type MovementProfile } from '../../engine/physics/movement.ts';
import { BASKETBALL_PHYSICAL, BASKETBALL_POSITION_WEIGHTS, BASKETBALL_WEIGHTS } from './weights.ts';

export const BASKETBALL_TABLES = {
  weights: BASKETBALL_WEIGHTS,
  physicalModifiers: BASKETBALL_PHYSICAL,
  positionWeights: BASKETBALL_POSITION_WEIGHTS,
} as const;

export const BASKETBALL_SPORT_ID = 'basketball';

/** Everything basketball's models read off one athlete. Mirrors the module's `AthleteRatings`. */
export interface BasketballRatings {
  readonly finishing: number;
  readonly midRange: number;
  readonly threePoint: number;
  readonly freeThrow: number;
  readonly composure: number;
  readonly passing: number;
  readonly ballHandling: number;
  readonly perimeterD: number;
  readonly interiorD: number;
  readonly agility: number;
  readonly strength: number;
  readonly vertical: number;
  readonly rebounding: number;
  readonly discipline: number;
}

/**
 * One athlete's basketball numbers, with fatigue applied.
 *
 * Fatigue scales the *learned* ratings and leaves the body alone: a tired athlete's shot goes
 * first, and they do not shrink. At full stamina the multiplier is exactly 1 and every number is
 * the athlete's own, so nothing changes for a fresh side (T-3.13).
 */
export function basketballRatings(athlete: Athlete): BasketballRatings {
  const derived = deriveRatings(athlete, BASKETBALL_SPORT_ID, BASKETBALL_TABLES);
  const fatigue = fatigueMultiplier(athlete.condition.stamina);
  const tire = (value: number): number => Math.max(1, Math.round(value * fatigue));

  return {
    finishing: tire(derived.finishing ?? 1),
    midRange: tire(derived.midRange ?? 1),
    threePoint: tire(derived.threePoint ?? 1),
    freeThrow: tire(derived.freeThrow ?? 1),
    passing: tire(derived.passing ?? 1),
    ballHandling: tire(derived.ballHandling ?? 1),
    perimeterD: tire(derived.perimeterD ?? 1),
    interiorD: tire(derived.interiorD ?? 1),
    rebounding: tire(derived.rebounding ?? 1),

    // Body, not sport. Ungated by familiarity, and untouched by fatigue except through movement.
    composure: athlete.attributes.composure,
    agility: athlete.attributes.agility,
    strength: athlete.attributes.strength,
    vertical: athlete.attributes.vertical,
    discipline: athlete.attributes.discipline,
  };
}

/**
 * How this athlete moves. `courtSpeed` is a *derived* rating — it already folds speed,
 * acceleration, and agility through the basketball weights — so a novice is slower on a court
 * than they are on a track, which is the familiarity penalty made physical.
 */
export function basketballMovement(athlete: Athlete): MovementProfile {
  const derived = deriveRatings(athlete, BASKETBALL_SPORT_ID, BASKETBALL_TABLES);
  const fatigue = fatigueMultiplier(athlete.condition.stamina);
  const courtSpeed = (derived.courtSpeed ?? 50) * fatigue;

  return movementProfile({
    speed: courtSpeed,
    acceleration: courtSpeed,
    agility: athlete.attributes.agility * fatigue,
  });
}

/** How lost this athlete is in basketball (T-3.6). `NO_COUPLING`-equal for anyone at home. */
export function basketballCoupling(athlete: Athlete): Coupling {
  return couplingFor(sportSkillFor(athlete, BASKETBALL_SPORT_ID).familiarity);
}

/** One side's athletes, in the order they fill the role table. */
export type SideRoster = readonly Athlete[];

/**
 * The rosters a match is played with. Absent, or short, and the module fills the rest from the
 * match seed — so a partially-filled lineup still starts a match rather than refusing to.
 */
export interface MatchRosters {
  readonly home?: SideRoster;
  readonly away?: SideRoster;
}

/** Everything the module needs about one athlete, computed once at spawn. */
export interface RosterEntry {
  readonly athleteId: string;
  readonly ratings: BasketballRatings;
  readonly movement: MovementProfile;
  readonly coupling: Coupling;
}

export function rosterEntry(athlete: Athlete): RosterEntry {
  return {
    athleteId: athlete.id,
    ratings: basketballRatings(athlete),
    movement: basketballMovement(athlete),
    coupling: basketballCoupling(athlete),
  };
}
