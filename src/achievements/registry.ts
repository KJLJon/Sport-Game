/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.6 — Achievement engine: declarative defs, event-stream evaluation, progress,
 *          once-only grants (INV-7)
 * @task    T-8.7 — Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode,
 *          hidden
 * @story   US-8.1 — Unlock achievements as I play
 * @story   US-8.2 — Browse my achievements
 * @design  05-data-model.md §6 (the table), 09-modes-and-arcade.md §3.2 (arcade unlocks)
 *
 * Purpose: every achievement in the build, in one list, and the checks that keep the list honest.
 *
 * **Ids are permanent.** A record in the `achievements` store is keyed by id, so renaming one
 * un-unlocks it for every existing save and re-pays it as a new achievement — a double grant that
 * INV-7 would be powerless against, because from storage's point of view they are two different
 * achievements. `validateRegistry` cannot catch a rename, but it does catch the mistake that
 * usually accompanies one: two defs sharing an id.
 */
import { onboardingAchievements } from './definitions/onboarding.ts';
import type { AchievementDef } from './types.ts';

export const ACHIEVEMENTS: readonly AchievementDef[] = [...onboardingAchievements];

const BY_ID: ReadonlyMap<string, AchievementDef> = new Map(
  ACHIEVEMENTS.map((def) => [def.id, def]),
);

export function achievementById(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

export function achievementsIn(category: AchievementDef['category']): AchievementDef[] {
  return ACHIEVEMENTS.filter((def) => def.category === category);
}

/**
 * Everything that can be wrong with a def list without a type error. Returns the problems rather
 * than throwing, so a test can print them all at once instead of one per run.
 */
export function validateRegistry(defs: readonly AchievementDef[] = ACHIEVEMENTS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const def of defs) {
    if (seen.has(def.id)) problems.push(`duplicate id: ${def.id}`);
    seen.add(def.id);

    if (def.id.trim() === '') problems.push('an achievement has an empty id');
    if (def.title.trim() === '') problems.push(`${def.id}: empty title`);
    if (def.description.trim() === '') problems.push(`${def.id}: empty description`);
    if (!Number.isInteger(def.target) || def.target < 1) {
      problems.push(`${def.id}: target must be a positive integer, got ${def.target}`);
    }
    // A def with no reward is an achievement that pays nothing, which US-8.3 does not allow.
    if ((def.reward.coins ?? 0) <= 0 && def.reward.pack === undefined) {
      problems.push(`${def.id}: no reward`);
    }
  }

  return problems;
}
