/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.13 — Stamina, injury, suspension, availability
 * @story   US-6.3 — See fatigue and availability
 * @design  05-data-model.md §2 (condition), §3.3, 06-game-design.md §3.1
 * @invariant INV-2 (seeded PRNG only), INV-7 (difficulty never touches attributes or ratings)
 *
 * Purpose: whether an athlete can play, and how well they are holding up. US-6.3 asks for three
 * things — stamina that drains across a match and recovers between them, injuries and suspensions
 * that block selection for a set duration, and a *visible* degradation when stamina is low.
 *
 * That last word is the one that shapes this file. A tired athlete whose only symptom is a smaller
 * number reads as arbitrary; one who is visibly a step slow reads as tired. So fatigue produces a
 * multiplier the sim applies to movement and to the ratings that depend on holding form, in the
 * same shape as T-3.6's familiarity coupling — and, like that one, it is exactly 1.0 for a fresh
 * athlete, so nothing changes for anyone who is not actually tired.
 *
 * **Not difficulty** (CLAUDE.md §8.6). Fatigue is a property of the athlete and the match so far,
 * never of the settings, and it modifies neither attributes nor derived ratings — it scales the
 * output at the point of use, and the athlete card still shows who they are when rested.
 */
import type { Rng } from '../engine/rng.ts';
import { CONDITION } from './tuning.ts';
import { ATHLETE_BOUNDS, clamp, type Athlete, type AthleteCondition } from './types.ts';

/** Why an athlete cannot be selected, or `null` when they can. */
export type UnavailableReason = 'injured' | 'suspended';

export interface Availability {
  readonly available: boolean;
  readonly reason: UnavailableReason | null;
  /** Plain language for the lineup editor — never a bare flag (`10` §11). */
  readonly label: string;
  /** Matches or milliseconds remaining, depending on the reason. */
  readonly remaining: number;
}

/**
 * Whether this athlete can be picked, and why not. Suspension outranks injury in the message when
 * both apply: a suspension is a fixed number of matches and an injury is a date, and telling
 * someone "back in 2 matches" when they are also injured until Friday would be a lie.
 */
export function availability(athlete: Athlete, now: number): Availability {
  const { injuredUntil, suspendedGames } = athlete.condition;

  if (injuredUntil !== undefined && injuredUntil > now) {
    const days = Math.ceil((injuredUntil - now) / CONDITION.dayMs);
    return {
      available: false,
      reason: 'injured',
      label: days <= 1 ? 'Injured — back tomorrow' : `Injured — back in ${days} days`,
      remaining: injuredUntil - now,
    };
  }

  if (suspendedGames !== undefined && suspendedGames > 0) {
    return {
      available: false,
      reason: 'suspended',
      label:
        suspendedGames === 1
          ? 'Suspended — one match left'
          : `Suspended — ${suspendedGames} matches left`,
      remaining: suspendedGames,
    };
  }

  return { available: true, reason: null, label: 'Available', remaining: 0 };
}

/** Plain-language stamina bands, so the bar is never colour alone (`10` §11). */
export type StaminaBand = 'fresh' | 'working' | 'tiring' | 'spent';

export function staminaBand(stamina: number): StaminaBand {
  if (stamina >= CONDITION.bands.fresh) return 'fresh';
  if (stamina >= CONDITION.bands.working) return 'working';
  if (stamina >= CONDITION.bands.tiring) return 'tiring';
  return 'spent';
}

/**
 * How much of themselves a tired athlete still has, `0`–`1`.
 *
 * Exactly 1.0 above the fatigue threshold, so a fresh athlete costs nothing anywhere and the sim's
 * behaviour — and its PRNG stream — is unchanged for anyone who has not actually tired. Below it,
 * it falls to a floor rather than to zero: an exhausted athlete is markedly worse, not useless,
 * because a player who cannot substitute should still be able to finish the match.
 */
export function fatigueMultiplier(stamina: number): number {
  const level = clamp(stamina, ATHLETE_BOUNDS.stamina.min, ATHLETE_BOUNDS.stamina.max);
  if (level >= CONDITION.fatigueFrom) return 1;

  const fallen = (CONDITION.fatigueFrom - level) / CONDITION.fatigueFrom;
  return 1 - fallen * (1 - CONDITION.fatigueFloor);
}

/**
 * Stamina drained by playing. The athlete's own `stamina` attribute is what makes this personal:
 * a high-endurance athlete drains at roughly half the rate of a low-endurance one over the same
 * minutes, which is the whole reason `stamina` is one of the eleven.
 *
 * `intensity` scales it — a full-court press costs more than a walk-up offence. Modes hand it in
 * rather than this file knowing which mode is running (CLAUDE.md §8.5).
 */
export function staminaDrain(options: {
  readonly minutes: number;
  readonly enduranceAttribute: number;
  readonly intensity?: number;
}): number {
  const minutes = Math.max(0, options.minutes);
  const endurance = clamp(options.enduranceAttribute, 1, 99);
  const intensity = Math.max(0, options.intensity ?? 1);

  // Endurance 1 pays the full rate; endurance 99 pays `enduranceFloor` of it.
  const relief = (endurance / 99) * (1 - CONDITION.enduranceFloor);
  return minutes * CONDITION.drainPerMinute * intensity * (1 - relief);
}

/** Stamina recovered between matches. Recovery is faster than drain, so a squad is not a treadmill. */
export function staminaRecovery(options: {
  readonly matchesRested: number;
  readonly enduranceAttribute: number;
  readonly age: number;
}): number {
  const rested = Math.max(0, options.matchesRested);
  const endurance = clamp(options.enduranceAttribute, 1, 99);
  const ageFactor = clamp(
    1 - Math.max(0, options.age - CONDITION.recoveryAgeFrom) * CONDITION.recoveryAgePerYear,
    CONDITION.recoveryAgeFloor,
    1,
  );

  return rested * CONDITION.recoveryPerMatch * (0.6 + (endurance / 99) * 0.4) * ageFactor;
}

/** The condition after playing `minutes`, plus the suspension that a served match works off. */
export function afterMatch(
  athlete: Athlete,
  options: { readonly minutes: number; readonly intensity?: number; readonly played: boolean },
): AthleteCondition {
  const drain = options.played
    ? staminaDrain({
        minutes: options.minutes,
        enduranceAttribute: athlete.attributes.stamina,
        ...(options.intensity === undefined ? {} : { intensity: options.intensity }),
      })
    : 0;

  const stamina = clamp(
    athlete.condition.stamina - drain,
    ATHLETE_BOUNDS.stamina.min,
    ATHLETE_BOUNDS.stamina.max,
  );

  // A suspension is served by the *team's* match going ahead, whether or not this athlete could
  // have played — which is what makes it a suspension rather than a benching.
  const served = Math.max(0, (athlete.condition.suspendedGames ?? 0) - 1);

  return {
    ...athlete.condition,
    stamina,
    ...(served > 0 ? { suspendedGames: served } : {}),
    ...(served === 0 && athlete.condition.suspendedGames !== undefined
      ? { suspendedGames: 0 }
      : {}),
  };
}

/** The condition after resting through `matchesRested` matches. */
export function afterRest(athlete: Athlete, matchesRested: number, now: number): AthleteCondition {
  const recovered = clamp(
    athlete.condition.stamina +
      staminaRecovery({
        matchesRested,
        enduranceAttribute: athlete.attributes.stamina,
        age: athlete.age,
      }),
    ATHLETE_BOUNDS.stamina.min,
    ATHLETE_BOUNDS.stamina.max,
  );

  const next: AthleteCondition = { ...athlete.condition, stamina: recovered };
  // A lapsed injury is cleared rather than left in the record as a date in the past.
  if (next.injuredUntil !== undefined && next.injuredUntil <= now) {
    const { injuredUntil: _lapsed, ...rest } = next;
    return rest;
  }
  return next;
}

export interface Injury {
  readonly until: number;
  readonly days: number;
}

/**
 * Whether this contact injured the athlete, and for how long.
 *
 * Deliberately rare: `05` gives no injury rate, and an injury system that fires often turns a game
 * about playing into a game about squad admin. The roll is seeded (INV-2), risk rises as stamina
 * falls — which is what makes substitutions a real decision rather than a formality — and the
 * duration is short at this severity because nothing yet exists to make a long absence interesting.
 */
export function rollInjury(
  rng: Rng,
  options: { readonly stamina: number; readonly severity: number; readonly now: number },
): Injury | null {
  const tiredness = 1 - clamp(options.stamina, 0, 100) / 100;
  const chance =
    CONDITION.injuryBaseChance *
    Math.max(0, options.severity) *
    (1 + tiredness * CONDITION.injuryTirednessFactor);

  if (!rng.bool(Math.min(chance, CONDITION.injuryMaxChance))) return null;

  const days = rng.int(CONDITION.injuryDays.min, CONDITION.injuryDays.max + 1);
  return { until: options.now + days * CONDITION.dayMs, days };
}

/** Applies an injury to a condition. Never shortens one already running. */
export function withInjury(condition: AthleteCondition, injury: Injury): AthleteCondition {
  const existing = condition.injuredUntil ?? 0;
  return { ...condition, injuredUntil: Math.max(existing, injury.until) };
}

/** Applies a suspension. Suspensions accumulate — two red cards is not one suspension. */
export function withSuspension(condition: AthleteCondition, matches: number): AthleteCondition {
  return {
    ...condition,
    suspendedGames: Math.max(0, (condition.suspendedGames ?? 0) + Math.max(0, matches)),
  };
}
