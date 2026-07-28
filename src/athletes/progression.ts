/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.5 — Sport skill XP: levels, sub-skills, event-driven awards, diminishing returns
 * @story   US-5.3 — Watch an athlete learn a new sport
 * @design  05-data-model.md §3.3 (familiarity growth, XP, sub-skills)
 * @invariant INV-6 (no mode-specific branching — every mode emits the same `SportEvent` stream)
 *
 * Purpose: one session of play → the athlete's new state. This is the door: Live matches (T-3.17),
 * arcade rounds (T-4.10), and Playbook games all come through here, handing over minutes and an
 * event stream and getting back a record to store and a report to show.
 *
 * Nothing below asks which mode it was. That is the point of CLAUDE.md §8.5 — a mode that needed
 * its own progression path would be a mode whose rewards could drift from every other mode's, and
 * `05` §5.5's anti-farm rule would then have to be re-proved for each one. Modes differ only in the
 * minutes and events they hand in; T-4.10's reduced arcade rate is a scale on the way in, not a
 * branch in here.
 */
import type { SportEvent } from '../engine/match/events.ts';
import type { EntityId } from '../engine/world.ts';
import type { SportId, XpAwardTable } from '../sports/types.ts';
import { applyMinutes, type FamiliarityChange } from './familiarity.ts';
import {
  applySessionTo,
  collectSession,
  emptySession,
  type SkillChange,
  type SkillSession,
} from './xp.ts';
import { sportSkillFor, type Athlete, type SportSkill } from './types.ts';

/** What one athlete's session did, in the terms the post-match screen reports it (US-5.3). */
export interface ProgressionReport {
  readonly sport: SportId;
  readonly familiarity: FamiliarityChange;
  readonly skill: SkillChange;
  readonly minutes: number;
}

export interface ProgressionResult {
  readonly athlete: Athlete;
  readonly skill: SportSkill;
  readonly report: ProgressionReport;
}

/**
 * Applies a session to one athlete. Pure: it returns a new athlete rather than mutating, so the
 * caller writes it once and the report it shows is the record it stored.
 *
 * Order matters. Familiarity is applied first and banks the minutes; XP is applied to the record
 * that comes back. Reversing them would award XP against a stale familiarity and, worse, let both
 * halves bank the same minutes.
 */
export function applyPlay(
  athlete: Athlete,
  sport: SportId,
  session: SkillSession,
): ProgressionResult {
  const familiarity = applyMinutes(athlete, sport, session.minutes);
  const withMinutes: Athlete = {
    ...athlete,
    sportSkills: { ...athlete.sportSkills, [sport]: familiarity.skill },
  };

  const xp = applySessionTo(withMinutes, sport, session);
  const skill = xp.skill;

  return {
    athlete: { ...athlete, sportSkills: { ...athlete.sportSkills, [sport]: skill } },
    skill,
    report: {
      sport,
      familiarity: familiarity.change,
      skill: xp.change,
      minutes: session.minutes,
    },
  };
}

/**
 * The whole squad after a match: who played, for how long, and what the match's events were worth.
 *
 * `entities` maps an entity in the finished world to the athlete that occupied it. Anyone in the
 * map gets a result, including athletes who never touched the ball — minutes alone are worth
 * familiarity and XP (`05` §3.3), and a bench player with zero minutes correctly gets zero.
 */
export function applyMatch(options: {
  readonly sport: SportId;
  readonly events: readonly SportEvent[];
  readonly awards: XpAwardTable;
  /** Entity → the athlete who played it. */
  readonly entities: ReadonlyMap<EntityId, Athlete>;
  /** Entity → real minutes played (`05` §3.3's unit; see `familiarity.learningMinutes`). */
  readonly minutes: ReadonlyMap<EntityId, number>;
  /** Scales every award — T-4.10's reduced arcade rate, as a number rather than a branch. */
  readonly rate?: number;
}): Map<EntityId, ProgressionResult> {
  const rate = options.rate ?? 1;
  const sessions = collectSession(options.events, options.awards, options.minutes);
  const results = new Map<EntityId, ProgressionResult>();

  for (const [entity, athlete] of options.entities) {
    const raw = sessions.get(entity) ?? emptySession(options.minutes.get(entity) ?? 0);
    const session: SkillSession =
      rate === 1 ? raw : { ...raw, minutes: raw.minutes * rate, xp: raw.xp * rate };
    results.set(entity, applyPlay(athlete, options.sport, session));
  }

  return results;
}

/** The sub-skills an athlete has actually learned in a sport, largest first (US-5.3, T-3.8). */
export function learnedSubSkills(
  athlete: Athlete,
  sport: SportId,
): readonly { readonly rating: string; readonly points: number }[] {
  return Object.entries(sportSkillFor(athlete, sport).subSkills)
    .filter(([, points]) => points > 0)
    .map(([rating, points]) => ({ rating, points }))
    .sort((a, b) => b.points - a.points || a.rating.localeCompare(b.rating));
}
