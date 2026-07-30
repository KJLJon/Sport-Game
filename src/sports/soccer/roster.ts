/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.10 — Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase
 * @task    T-6.13 — Soccer derivation weights, sub-skills, familiarity tuning
 * @story   US-5.2 — Play any athlete in any sport
 * @design  05-data-model.md §3 (derivation), §3.3 (familiarity), 04-architecture.md §5 (the seam)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: turns real athletes into the numbers soccer's five models read. Basketball's
 * `roster.ts` twin, and deliberately the same shape — the second one is what proves the athlete
 * layer was not written for basketball.
 *
 * **Two attributes are read as themselves.** `coordination` (for shot curve, `06` §3.2) and
 * `strength` are what a body does, not what a sport teaches, so they come straight off `attributes`
 * and are *not* gated by familiarity. A novice does not become weaker for being in the wrong sport;
 * they become worse at soccer. Same distinction `05` §3 draws, and the same one basketball's roster
 * makes for its five.
 *
 * **The seeded fallback stays.** A match handed no roster fills itself from the match seed, exactly
 * as basketball's does — the balance harness and the determinism tests both depend on a match
 * starting with no save file.
 */
import { couplingFor, type Coupling } from '../../athletes/coupling.ts';
import { deriveRatings } from '../../athletes/derivation.ts';
import { fatigueMultiplier } from '../../athletes/condition.ts';
import { sportSkillFor, type Athlete } from '../../athletes/types.ts';
import { movementProfile, type MovementProfile } from '../../engine/physics/movement.ts';
import type { Rng } from '../../engine/rng.ts';
import { SOCCER_PHYSICAL, SOCCER_WEIGHTS } from './weights.ts';

export const SOCCER_TABLES = {
  weights: SOCCER_WEIGHTS,
  physicalModifiers: SOCCER_PHYSICAL,
} as const;

export const SOCCER_SPORT_ID = 'soccer';

/** Everything soccer's models read off one athlete. */
export interface SoccerRatings {
  readonly finishing: number;
  readonly shotPower: number;
  readonly shortPass: number;
  readonly longPass: number;
  readonly crossing: number;
  readonly dribbling: number;
  readonly heading: number;
  readonly tackling: number;
  readonly marking: number;
  readonly offBall: number;
  readonly pace: number;
  readonly goalkeeping: number;

  /** Body, not sport. Ungated by familiarity. `06` §3.2 names `coordination` for shot curve. */
  readonly coordination: number;
  readonly strength: number;
}

/**
 * One athlete's soccer numbers, with fatigue applied.
 *
 * Fatigue scales the *learned* ratings and leaves the body alone — a tired player's finishing goes
 * before their strength does.
 */
export function soccerRatings(athlete: Athlete): SoccerRatings {
  const derived = deriveRatings(athlete, SOCCER_SPORT_ID, SOCCER_TABLES);
  const fatigue = fatigueMultiplier(athlete.condition.stamina);
  const tire = (value: number): number => Math.max(1, Math.round(value * fatigue));

  return {
    finishing: tire(derived.finishing ?? 1),
    shotPower: tire(derived.shotPower ?? 1),
    shortPass: tire(derived.shortPass ?? 1),
    longPass: tire(derived.longPass ?? 1),
    crossing: tire(derived.crossing ?? 1),
    dribbling: tire(derived.dribbling ?? 1),
    heading: tire(derived.heading ?? 1),
    tackling: tire(derived.tackling ?? 1),
    marking: tire(derived.marking ?? 1),
    offBall: tire(derived.offBall ?? 1),
    pace: tire(derived.pace ?? 1),
    goalkeeping: tire(derived.goalkeeping ?? 1),

    coordination: athlete.attributes.coordination,
    strength: athlete.attributes.strength,
  };
}

/**
 * How this athlete moves on a pitch. `pace` is a *derived* rating, so it already folds speed and
 * acceleration through the soccer weights — a novice is slower on a pitch than on a track, which is
 * the familiarity penalty made physical.
 */
export function soccerMovement(athlete: Athlete): MovementProfile {
  const derived = deriveRatings(athlete, SOCCER_SPORT_ID, SOCCER_TABLES);
  const fatigue = fatigueMultiplier(athlete.condition.stamina);
  const pace = (derived.pace ?? 50) * fatigue;

  return movementProfile({
    speed: pace,
    acceleration: pace,
    agility: (derived.dribbling ?? 50) * fatigue,
  });
}

export function soccerCoupling(athlete: Athlete): Coupling {
  return couplingFor(sportSkillFor(athlete, SOCCER_SPORT_ID).familiarity);
}

export interface RosterEntry {
  readonly athleteId: string;
  readonly ratings: SoccerRatings;
  readonly movement: MovementProfile;
  readonly coupling: Coupling;
}

export function rosterEntry(athlete: Athlete): RosterEntry {
  return {
    athleteId: athlete.id,
    ratings: soccerRatings(athlete),
    movement: soccerMovement(athlete),
    coupling: soccerCoupling(athlete),
  };
}

/**
 * A seeded stand-in, for a match started with no roster.
 *
 * `roleIndex` shapes the draw so a goalkeeper is a goalkeeper: role 0 gets its `goalkeeping` from
 * the top of the band and everything else from the bottom, which is what stops a rosterless match
 * fielding eleven identical midfielders and a keeper who cannot catch.
 */
export function rollRatings(rng: Rng, roleIndex: number): SoccerRatings {
  const base = rng.int(45, 82);
  const spread = (): number => Math.max(1, Math.min(99, base + rng.int(-8, 8)));
  const keeper = roleIndex === 0;

  return {
    finishing: keeper ? rng.int(10, 30) : spread(),
    shotPower: keeper ? rng.int(30, 55) : spread(),
    shortPass: spread(),
    longPass: spread(),
    crossing: keeper ? rng.int(20, 45) : spread(),
    dribbling: keeper ? rng.int(15, 35) : spread(),
    heading: spread(),
    tackling: keeper ? rng.int(10, 30) : spread(),
    marking: keeper ? rng.int(10, 30) : spread(),
    offBall: keeper ? rng.int(10, 30) : spread(),
    pace: spread(),
    goalkeeping: keeper ? Math.max(50, spread()) : rng.int(5, 20),

    coordination: spread(),
    strength: spread(),
  };
}
