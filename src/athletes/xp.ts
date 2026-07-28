/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.5 — Sport skill XP: levels, sub-skills, event-driven awards, diminishing returns
 * @story   US-5.3 — Watch an athlete learn a new sport
 * @design  05-data-model.md §3.3 (XP, levels, sub-skills)
 * @invariant INV-5 (no sport-specific branching), INV-6 (no mode-specific branching)
 *
 * Purpose: how an athlete develops into what you actually use them for. `05` §3.3: "XP comes from
 * minutes plus events… Each level grants sub-skill points auto-allocated toward the actions the
 * athlete actually performed."
 *
 * That last clause is the whole design. Nothing here asks *what mode* produced the events or *what
 * sport* they came from: a match, an arcade round, and a Playbook turn all emit the same
 * `SportEvent` stream (CLAUDE.md §8.5), and which event trains which sub-skill is a table the sport
 * module owns — only basketball knows that a shot from `cornerThree` is a three-pointer.
 *
 * **Diminishing returns**, which `05` §3.3 asks for, come from two places and they do different
 * jobs. The level curve `100 × level^1.6` makes each level cost more than the last, so the twentieth
 * is roughly a hundred times the first. And within one session, repeated identical actions decay,
 * so an athlete who takes forty threes learns less from the fortieth than the first — without that,
 * the fastest way to a maxed sub-skill would be to stop playing basketball and start farming one
 * action, which is the same shape of problem as `05` §5.5's anti-farm rule.
 */
import type { SportEvent } from '../engine/match/events.ts';
import type { EntityId } from '../engine/world.ts';
import type { SportId, XpAwardTable, XpRule } from '../sports/types.ts';
import { XP } from './tuning.ts';
import { ATHLETE_BOUNDS, clamp, sportSkillFor, type Athlete, type SportSkill } from './types.ts';

/**
 * XP to advance *from* `level` to the next one — so level 1 → 2 costs exactly 100, and 19 → 20
 * costs a little over ten thousand.
 *
 * `05` §3.3 writes `xpFor(level) = 100 × level^1.6` and calls it a "level threshold" without saying
 * whether that is a per-level cost or a cumulative total. Read as a cost it gives a round 100-XP
 * on-ramp and a ~102× span across the twenty levels, which is the shape "diminishing returns"
 * describes; read as a cumulative total the span is the same but the first level is free.
 * Recorded as a decision rather than assumed silently.
 *
 * @spec-ref 05-data-model.md §3.3
 */
export function xpForLevel(level: number): number {
  if (level >= ATHLETE_BOUNDS.level.max) return Infinity;
  return XP.levelBase * Math.max(1, level) ** XP.levelExponent;
}

/** Total XP to go from level 1 to `level`. What a progress bar's "career" mode would show. */
export function cumulativeXpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, ATHLETE_BOUNDS.level.max); l++) total += xpForLevel(l);
  return total;
}

/** Where an athlete sits within their current level, for the progress bar (US-5.3). */
export interface LevelProgress {
  readonly level: number;
  readonly xp: number;
  /** XP into the current level. */
  readonly intoLevel: number;
  /** XP the current level costs, or `Infinity` at the cap. */
  readonly levelCost: number;
  /** 0–1, and 1 at the cap rather than `NaN`. */
  readonly fraction: number;
  readonly atCap: boolean;
}

export function levelProgress(skill: SportSkill): LevelProgress {
  const level = clamp(Math.floor(skill.level), ATHLETE_BOUNDS.level.min, ATHLETE_BOUNDS.level.max);
  const atCap = level >= ATHLETE_BOUNDS.level.max;
  const cost = xpForLevel(level);
  const intoLevel = Math.max(0, skill.xp);

  return {
    level,
    xp: skill.xp,
    intoLevel,
    levelCost: cost,
    fraction: atCap ? 1 : clamp(intoLevel / cost, 0, 1),
    atCap,
  };
}

/** XP from minutes on the field, the half of `05` §3.3 that does not depend on doing anything. */
export function xpFromMinutes(minutes: number): number {
  return Math.max(0, minutes) * XP.perMinute;
}

/** One award, before it is banked. */
export interface XpAward {
  readonly entity: EntityId;
  /** The sub-skill this trains, if any. */
  readonly rating?: string;
  readonly xp: number;
}

function matches(rule: XpRule, sportEvent: SportEvent): boolean {
  if (rule.kind !== sportEvent.kind) return false;
  if (rule.sportKind !== undefined && rule.sportKind !== sportEvent.sportKind) return false;

  for (const [key, expected] of Object.entries(rule.when ?? {})) {
    if ((sportEvent.detail ?? {})[key] !== expected) return false;
  }
  return true;
}

/**
 * What one event is worth, to whom. An event can pay two athletes: the rule's `rating`/`xp` go to
 * the actor and `targetRating`/`targetXp` to whoever it happened to, which is how a contested shot
 * trains the contester as well as the shooter.
 */
export function awardsForEvent(sportEvent: SportEvent, table: XpAwardTable): XpAward[] {
  const awards: XpAward[] = [];

  for (const rule of table) {
    if (!matches(rule, sportEvent)) continue;

    if (sportEvent.actor !== undefined && rule.xp > 0) {
      awards.push({
        entity: sportEvent.actor,
        ...(rule.rating === undefined ? {} : { rating: rule.rating }),
        xp: rule.xp,
      });
    }

    const targetXp = rule.targetXp ?? 0;
    if (sportEvent.target !== undefined && targetXp > 0) {
      awards.push({
        entity: sportEvent.target,
        ...(rule.targetRating === undefined ? {} : { rating: rule.targetRating }),
        xp: targetXp,
      });
    }
  }

  return awards;
}

/** One athlete's share of a session: what they did, and what it was worth. */
export interface SkillSession {
  /** Real minutes of play (`05` §3.3's unit — see `familiarity.ts`). */
  readonly minutes: number;
  /** Sub-skill → how many times the athlete performed an action training it. */
  readonly actions: Readonly<Record<string, number>>;
  /** Total XP, decay and minutes included. */
  readonly xp: number;
}

export function emptySession(minutes = 0): SkillSession {
  return { minutes, actions: {}, xp: xpFromMinutes(minutes) };
}

/**
 * Folds a session's events into per-entity totals.
 *
 * The repeat decay is applied here rather than at award time because it is a property of the
 * session: the fortieth three of a match is worth `decay^39` of the first, floored, so grinding one
 * action has a ceiling while playing a varied match does not.
 */
export function collectSession(
  events: readonly SportEvent[],
  table: XpAwardTable,
  minutesByEntity: ReadonlyMap<EntityId, number>,
): Map<EntityId, SkillSession> {
  const actions = new Map<EntityId, Record<string, number>>();
  const earned = new Map<EntityId, number>();
  // Counts every award, including the ones with no sub-skill, so decay is per action *type*.
  const seen = new Map<EntityId, Map<string, number>>();

  for (const sportEvent of events) {
    for (const award of awardsForEvent(sportEvent, table)) {
      const key = award.rating ?? '';
      const perEntity = seen.get(award.entity) ?? new Map<string, number>();
      const repeats = perEntity.get(key) ?? 0;
      perEntity.set(key, repeats + 1);
      seen.set(award.entity, perEntity);

      const decay = Math.max(XP.repeatFloor, XP.repeatDecay ** repeats);
      earned.set(award.entity, (earned.get(award.entity) ?? 0) + award.xp * decay);

      if (award.rating !== undefined) {
        const tally = actions.get(award.entity) ?? {};
        tally[award.rating] = (tally[award.rating] ?? 0) + 1;
        actions.set(award.entity, tally);
      }
    }
  }

  const sessions = new Map<EntityId, SkillSession>();
  const entities = new Set<EntityId>([...minutesByEntity.keys(), ...earned.keys()]);
  for (const entity of entities) {
    const minutes = minutesByEntity.get(entity) ?? 0;
    sessions.set(entity, {
      minutes,
      actions: actions.get(entity) ?? {},
      xp: xpFromMinutes(minutes) + (earned.get(entity) ?? 0),
    });
  }

  return sessions;
}

/** What a session did to one athlete's skill, in the terms the post-match screen reports it. */
export interface SkillChange {
  readonly xpGained: number;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly levelsGained: number;
  /** Sub-skill → points added by the level-ups. Empty when nothing levelled. */
  readonly subSkillsGained: Readonly<Record<string, number>>;
  /** True when every sub-skill the athlete trained is already maxed, so points had nowhere to go. */
  readonly pointsWasted: number;
}

/**
 * Applies a session to one sport's skill record. Pure — it returns the new record and the change,
 * so the screen that reports "what improved after a match" (US-5.3) shows exactly what was stored.
 *
 * Sub-skill points go to what the athlete actually did, most-used first, one point at a time so a
 * varied match spreads them and a specialised one concentrates them. When a trained sub-skill is
 * already at its cap the point moves to the next-most-used; when *everything* trained is capped it
 * is reported as wasted rather than silently dropped, because "nothing improved" is a real answer
 * the card should be able to give.
 */
export function applySession(
  skill: SportSkill,
  session: SkillSession,
): { readonly skill: SportSkill; readonly change: SkillChange } {
  const levelBefore = clamp(
    Math.floor(skill.level),
    ATHLETE_BOUNDS.level.min,
    ATHLETE_BOUNDS.level.max,
  );

  let level = levelBefore;
  let xp = Math.max(0, skill.xp) + Math.max(0, session.xp);
  let levelsGained = 0;

  while (level < ATHLETE_BOUNDS.level.max && xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
    levelsGained += 1;
  }
  if (level >= ATHLETE_BOUNDS.level.max) xp = 0;

  const subSkills = { ...skill.subSkills };
  const gained: Record<string, number> = {};
  let wasted = 0;

  // Most-used first; ties by name, so two athletes with the same match get the same allocation
  // rather than one depending on object key order.
  const ranked = Object.entries(session.actions)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([rating]) => rating);

  for (let point = 0; point < levelsGained * XP.pointsPerLevel; point++) {
    const rating = ranked.find((id) => (subSkills[id] ?? 0) < ATHLETE_BOUNDS.subSkill.max);
    if (rating === undefined) {
      wasted += 1;
      continue;
    }
    subSkills[rating] = (subSkills[rating] ?? 0) + 1;
    gained[rating] = (gained[rating] ?? 0) + 1;
  }

  return {
    // `minutesPlayed` is deliberately untouched: T-3.4's `applyMinutes` banks it, and having two
    // functions each add the same minutes is exactly the kind of double-count that only shows up
    // fifty matches later. `progression.ts` composes the two.
    skill: { ...skill, level, xp, subSkills },
    change: {
      xpGained: Math.max(0, session.xp),
      levelBefore,
      levelAfter: level,
      levelsGained,
      subSkillsGained: gained,
      pointsWasted: wasted,
    },
  };
}

/** Reads the athlete's record for a sport and applies a session to it. */
export function applySessionTo(
  athlete: Athlete,
  sport: SportId,
  session: SkillSession,
): { readonly skill: SportSkill; readonly change: SkillChange } {
  return applySession(sportSkillFor(athlete, sport), session);
}
