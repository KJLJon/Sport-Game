/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.4 — Familiarity model: per-sport familiarity, penalty curve, growth from minutes
 * @story   US-5.2 — Play any athlete in any sport
 * @story   US-5.3 — Watch an athlete learn a new sport
 * @design  05-data-model.md §3.3 (familiarity growth, caps, age factor, sport complexity)
 * @invariant INV-5 (no sport-specific branching — complexity arrives as a table)
 *
 * Purpose: how familiarity moves. The penalty curve it feeds — `famMult` — lives in
 * `derivation.ts` with the arithmetic that uses it; this file is the other half: growth from
 * minutes actually played, the caps, and the answer to "what did this match do for them?".
 *
 * `05` §3.3, verbatim:
 *
 *     gain = 0.9 × minutes × (1 − familiarity/100)^1.3 × ageFactor / sportComplexity
 *     cap  = 100 for the primary sport, 95 for any other
 *     ageFactor = clamp(1.25 − (age − 22) × 0.02, 0.55, 1.25)
 *
 * **What `minutes` means.** The formula and `05` §3.3's own stated pace — "~15 full matches to go
 * from novice to competent, ~50 to approach the cap" — only agree if `minutes` is minutes of play
 * in *real* time, not game-clock minutes: a full basketball match is 48 game minutes but twelve
 * real ones at `06` §3.1's 4× compression, and a starter plays about eight of them. Read as game
 * minutes, the same formula reaches competent in a single match. So real minutes it is, the box
 * score keeps showing game minutes, and `learningMinutes()` below is the one place the two meet.
 * Recorded as a decision rather than assumed silently.
 */
import type { SportId } from '../sports/types.ts';
import { FAMILIARITY } from './tuning.ts';
import {
  ATHLETE_BOUNDS,
  STARTING_FAMILIARITY,
  clamp,
  sportSkillFor,
  type Athlete,
  type SportSkill,
} from './types.ts';

/** The ceiling for a sport: the primary sport alone can reach 100 (`05` §3.3). */
export function familiarityCap(athlete: Athlete, sport: SportId): number {
  return sport === athlete.primarySport ? FAMILIARITY.primaryCap : FAMILIARITY.secondaryCap;
}

/**
 * How quickly this athlete picks things up, by age (`05` §3.3). A 22-year-old learns at the full
 * rate; it decays either side of nothing — only downward with age — and bottoms out at 0.55, so a
 * veteran learns slowly rather than not at all.
 */
export function ageFactor(age: number): number {
  return clamp(
    FAMILIARITY.ageBase - (age - FAMILIARITY.ageReference) * FAMILIARITY.agePerYear,
    FAMILIARITY.ageFactorMin,
    FAMILIARITY.ageFactorMax,
  );
}

/** How hard a sport is to pick up (`05` §3.3). Unknown sports learn at basketball's rate. */
export function sportComplexity(sport: SportId): number {
  return FAMILIARITY.complexity[sport] ?? FAMILIARITY.defaultComplexity;
}

/**
 * Real minutes of play from a box-score figure. `05` §3.3's growth is per real minute; the athlete
 * card and every stat line show game minutes, because that is what a box score means.
 *
 * @spec-ref 06-game-design.md §3.1 — clock compression
 */
export function learningMinutes(gameMinutes: number, clockCompression: number): number {
  return clockCompression <= 0 ? gameMinutes : gameMinutes / clockCompression;
}

/**
 * The gain from one stint. Diminishing in current familiarity, so the first matches move the
 * number most — which is where the feature has to sell itself (`05` §3.3).
 */
export function familiarityGain(options: {
  readonly familiarity: number;
  readonly minutes: number;
  readonly age: number;
  readonly sport: SportId;
}): number {
  const familiarity = clamp(
    options.familiarity,
    ATHLETE_BOUNDS.familiarity.min,
    ATHLETE_BOUNDS.familiarity.max,
  );
  const minutes = Math.max(0, options.minutes);
  const headroom = (1 - familiarity / 100) ** FAMILIARITY.headroomExponent;

  return (
    (FAMILIARITY.rate * minutes * headroom * ageFactor(options.age)) /
    sportComplexity(options.sport)
  );
}

/** What a stint did, in the terms the post-match screen reports it (US-5.3). */
export interface FamiliarityChange {
  readonly before: number;
  readonly after: number;
  readonly gained: number;
  readonly cap: number;
  /** True when the cap is what stopped it, so the UI can say so instead of showing +0.0. */
  readonly atCap: boolean;
}

/**
 * Applies minutes to an athlete's familiarity in one sport. Pure: it returns the change and the
 * new skill record rather than mutating, so the caller decides what to persist — and so the
 * post-match screen can show the same numbers it stored.
 */
export function applyMinutes(
  athlete: Athlete,
  sport: SportId,
  minutes: number,
): { readonly skill: SportSkill; readonly change: FamiliarityChange } {
  const current = sportSkillFor(athlete, sport);
  const cap = familiarityCap(athlete, sport);
  const before = current.familiarity;

  const gain = familiarityGain({ familiarity: before, minutes, age: athlete.age, sport });
  const after = Math.min(cap, before + gain);

  return {
    skill: {
      ...current,
      familiarity: after,
      minutesPlayed: current.minutesPlayed + Math.max(0, minutes),
    },
    change: { before, after, gained: after - before, cap, atCap: after >= cap },
  };
}

/**
 * The same athlete after `matches` identical stints. Used by the compare view to answer "how long
 * until they are good at this?" (US-5.3) and by the tests that pin `05` §3.3's stated pace.
 */
export function projectFamiliarity(options: {
  readonly familiarity: number;
  readonly minutesPerMatch: number;
  readonly age: number;
  readonly sport: SportId;
  readonly cap: number;
  readonly matches: number;
}): number {
  let familiarity = options.familiarity;
  for (let match = 0; match < options.matches; match++) {
    familiarity = Math.min(
      options.cap,
      familiarity +
        familiarityGain({
          familiarity,
          minutes: options.minutesPerMatch,
          age: options.age,
          sport: options.sport,
        }),
    );
  }
  return familiarity;
}

/** How many matches of `minutesPerMatch` it takes to reach `target`, or `null` if never. */
export function matchesToReach(options: {
  readonly familiarity: number;
  readonly minutesPerMatch: number;
  readonly age: number;
  readonly sport: SportId;
  readonly cap: number;
  readonly target: number;
}): number | null {
  if (options.familiarity >= options.target) return 0;
  if (options.target > options.cap) return null;

  let familiarity = options.familiarity;
  for (let match = 1; match <= FAMILIARITY.projectionLimit; match++) {
    const gain = familiarityGain({
      familiarity,
      minutes: options.minutesPerMatch,
      age: options.age,
      sport: options.sport,
    });
    if (gain <= 0) return null;
    familiarity = Math.min(options.cap, familiarity + gain);
    if (familiarity >= options.target) return match;
  }
  return null;
}

/**
 * Plain-language bands for the familiarity badge (US-5.2). Colour alone must never carry this
 * (CLAUDE.md §8.11), so the band has a word.
 */
export type FamiliarityBand = 'novice' | 'learning' | 'competent' | 'comfortable' | 'natural';

export function familiarityBand(familiarity: number): FamiliarityBand {
  if (familiarity < 25) return 'novice';
  if (familiarity < 50) return 'learning';
  if (familiarity < 70) return 'competent';
  if (familiarity < 88) return 'comfortable';
  return 'natural';
}

/** The starting familiarity a sport gets for an athlete who has never played it (`05` §3.3). */
export function startingFamiliarity(athlete: Athlete, sport: SportId): number {
  return sport === athlete.primarySport ? STARTING_FAMILIARITY.primary : STARTING_FAMILIARITY.other;
}
