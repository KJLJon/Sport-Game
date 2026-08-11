/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.6 — Achievement engine: declarative defs, event-stream evaluation, progress,
 *          once-only grants (INV-7)
 * @task    T-8.7 — Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode,
 *          hidden
 * @story   US-8.1 — Unlock achievements as I play
 * @design  05-data-model.md §6 (First Whistle, Architect and the rest of the onboarding row)
 *
 * Purpose: the achievements a player earns without trying — the ones that teach what an achievement
 * is by handing them one in the first five minutes.
 *
 * They are all `career`-scoped one-shots, which makes this the file that proves the shape before
 * the interesting content (T-8.7) is written against it.
 */
import { MetaKind } from '../types.ts';
import { def, detailNumber, onMeta, wonIt } from '../conditions.ts';
import type { AchievementDef } from '../types.ts';

export const onboardingAchievements: readonly AchievementDef[] = [
  def({
    id: 'onboarding.first-whistle',
    category: 'onboarding',
    title: 'First Whistle',
    description: 'Finish your first match.',
    reward: { coins: 200 },
    evaluate: onMeta(MetaKind.MATCH_FINISHED),
  }),
  def({
    id: 'onboarding.architect',
    category: 'onboarding',
    title: 'Architect',
    description: 'Create your first athlete.',
    reward: { coins: 300 },
    evaluate: onMeta(MetaKind.ATHLETE_CREATED),
  }),
  def({
    id: 'onboarding.first-win',
    category: 'onboarding',
    title: 'On the Board',
    description: 'Win a match.',
    reward: { coins: 250 },
    evaluate: onMeta(MetaKind.MATCH_FINISHED, (event) => wonIt(event)),
  }),
  def({
    id: 'onboarding.ten-matches',
    category: 'onboarding',
    title: 'Regular',
    description: 'Finish 10 matches.',
    target: 10,
    reward: { coins: 500 },
    evaluate: onMeta(MetaKind.MATCH_FINISHED),
  }),
  def({
    id: 'onboarding.first-arcade',
    category: 'onboarding',
    title: 'Warm-Up',
    description: 'Finish a scored arcade run.',
    reward: { coins: 200 },
    // Practice runs are `rewarded: false` and do not count — `09` §3.3's "unlimited and
    // unrewarded" would not be unlimited if it also handed out achievements.
    evaluate: onMeta(MetaKind.ARCADE_RUN, (event) => (detailNumber(event, 'stars') ?? 0) >= 1),
  }),
  def({
    id: 'onboarding.first-squad',
    category: 'onboarding',
    title: 'Team Sheet',
    description: 'Own 10 athletes.',
    reward: { coins: 250 },
    // A level, not a count: `ROSTER_SIZE` reports how many there are, so the delta is 1 the first
    // time it is high enough rather than one per athlete, which would double-count a re-import.
    evaluate: onMeta(MetaKind.ROSTER_SIZE, (event) => (detailNumber(event, 'size') ?? 0) >= 10),
  }),
];
