/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.6 — Achievement engine: declarative defs, event-stream evaluation, progress,
 *          once-only grants (INV-7)
 * @story   US-8.1 — Unlock achievements as I play
 * @story   US-8.3 — Be rewarded for achievements
 * @design  05-data-model.md §6 (the def shape and the table), §1 (the `achievements` store)
 * @invariant INV-7 (a reward is granted at most once, across any migration path),
 *            INV-9 (evaluated from the one event stream; no mode to branch on)
 *
 * Purpose: what an achievement is, what it is evaluated against, and what is stored about it.
 *
 * **A def is data with one function on it.** `05` §6 specifies `evaluate(event, ctx) → number | null`
 * — a *progress delta*, not a boolean — and that one choice is what makes "make 5 threes in one
 * game" and "sell 20 athletes" the same kind of object. A def never reads storage, never looks at
 * another def, and never knows whether it has already fired; the tracker owns all of that.
 *
 * **There is no mode anywhere in this file.** `SportEvent` has no `mode` field by construction
 * (INV-9), and nothing here adds one back. An achievement earned in Playbook is the same
 * achievement.
 *
 * **`unlockedAt` and `rewardedAt` are separate on purpose.** That is INV-7's implementation: meeting
 * the condition and being paid for it are two writes, and a crash between them must leave a state
 * that resolves to *paid exactly once* on the next boot. One flag could not express "unlocked, not
 * yet paid", so a retry would either double-pay or never pay.
 */
import type { SportEvent, Side } from '../engine/match/events.ts';
import type { EntityId } from '../engine/world.ts';
import type { Athlete } from '../athletes/types.ts';
import type { SportId } from '../sports/types.ts';
import type { Difficulty } from '../modes/difficulty.ts';
import type { AssistSettings } from '../modes/assists.ts';
import type { BoxScore } from '../modes/live/box-score.ts';
import type { PackTier } from '../economy/types.ts';

/** `05` §6's categories, unchanged. Hockey and football are declared before their sports exist. */
export const ACHIEVEMENT_CATEGORIES = [
  'onboarding',
  'basketball',
  'soccer',
  'hockey',
  'football',
  'crossSport',
  'difficulty',
  'collection',
  'economy',
  'p2p',
] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

/**
 * Whether progress accumulates forever or resets when a match does.
 *
 * `05` §6's table needs both — "5 threes in one game" against "10 career free kicks" — and the
 * difference cannot be expressed inside `evaluate`, which sees one event at a time and has nowhere
 * to keep a counter. So it is declared, and the tracker keeps the counter.
 */
export const ACHIEVEMENT_SCOPES = ['career', 'match'] as const;
export type AchievementScope = (typeof ACHIEVEMENT_SCOPES)[number];

export interface AchievementReward {
  readonly coins?: number;
  readonly pack?: PackTier;
}

/**
 * Things that happen outside a match. `05` §6's `MetaEvent`.
 *
 * Kinds are prefixed `meta.` so that one union can be narrowed by looking at the string, and so a
 * meta kind can never collide with a sport's own `sportKind`.
 */
export const MetaKind = {
  /** A match was filed. `detail` carries the result, difficulty, and whether assists were off. */
  MATCH_FINISHED: 'meta.match-finished',
  ATHLETE_CREATED: 'meta.athlete-created',
  /** An athlete arrived from a pack or the market. `detail.rarity` names which. */
  ATHLETE_ACQUIRED: 'meta.athlete-acquired',
  ATHLETE_SOLD: 'meta.athlete-sold',
  PACK_OPENED: 'meta.pack-opened',
  MARKET_PURCHASE: 'meta.market-purchase',
  ARCADE_RUN: 'meta.arcade-run',
  /** How many athletes the save holds, emitted when the roster changes. */
  ROSTER_SIZE: 'meta.roster-size',
  /** An athlete's familiarity in some sport reached its cap. */
  FAMILIARITY_CAPPED: 'meta.familiarity-capped',
  /** An athlete played a sport — one event per sport per athlete, for "Decathlete". */
  SPORT_PLAYED: 'meta.sport-played',
  /** A secondary sport's overall passed the primary's. */
  CONVERTED: 'meta.converted',
  TOURNAMENT_WON: 'meta.tournament-won',
  P2P_MATCH: 'meta.p2p-match',
  P2P_TRADE: 'meta.p2p-trade',
} as const;
export type MetaKindName = (typeof MetaKind)[keyof typeof MetaKind];

export interface MetaEvent {
  readonly kind: MetaKindName;
  readonly at: number;
  /** Whose it was, when that is a question worth asking. */
  readonly athleteId?: string;
  readonly detail?: Readonly<Record<string, number | string | boolean>>;
}

export type AchievementEvent = SportEvent | MetaEvent;

export function isMetaEvent(event: AchievementEvent): event is MetaEvent {
  return event.kind.startsWith('meta.');
}

/**
 * What an evaluator is allowed to know beyond the event itself.
 *
 * Deliberately small, and deliberately without a mode. `box` is the current match's running box
 * score, maintained by the tracker from the same events — that is what lets a def ask "how many
 * threes has this athlete made *in this match*" without keeping state of its own.
 */
export interface EvalContext {
  readonly at: number;
  readonly sport: SportId;
  readonly difficulty: Difficulty;
  /** Which side the player is, or `-1` outside a match and in one nobody played. */
  readonly playerSide: Side;
  readonly assists: AssistSettings;
  /** Entity → athlete for the current match, from `SportModule.lineup()`. */
  readonly athleteOf: (entity: EntityId) => Athlete | undefined;
  /** The match so far. Empty outside a match. */
  readonly box: BoxScore;
}

export interface AchievementDef {
  readonly id: string;
  readonly category: AchievementCategory;
  readonly title: string;
  /** What earns it, imperative and checkable. Shown on a locked row, so never a spoiler. */
  readonly description: string;
  /** Shown as "???" until unlocked (US-8.2). */
  readonly hidden: boolean;
  /** `1` for one-shot, `N` for cumulative. */
  readonly target: number;
  readonly scope: AchievementScope;
  readonly reward: AchievementReward;
  /**
   * Progress this event contributes, or `null` for "not about me". Called for every event of every
   * match, so it must be cheap and must not allocate.
   */
  readonly evaluate: (event: AchievementEvent, ctx: EvalContext) => number | null;
}

/** What is stored per achievement. One record per def, in the `achievements` store (`05` §1). */
export interface AchievementRecord {
  readonly id: string;
  /** Career progress, or the best a single match has reached for a match-scoped def. */
  readonly progress: number;
  /** When the condition was met. Indexed by `byUnlockedAt`. `null` while still locked. */
  readonly unlockedAt: number | null;
  /** When the reward was actually paid. Lags `unlockedAt` by one write; see INV-7 above. */
  readonly rewardedAt: number | null;
}

export function lockedRecord(id: string): AchievementRecord {
  return { id, progress: 0, unlockedAt: null, rewardedAt: null };
}

export function isUnlocked(record: AchievementRecord): boolean {
  return record.unlockedAt !== null;
}

/** An achievement that just unlocked — what a toast and the post-match summary are built from. */
export interface AchievementUnlock {
  readonly def: AchievementDef;
  readonly record: AchievementRecord;
}

/** Repairs a record read out of storage; an unreadable one reads as locked rather than as broken. */
export function normaliseRecord(id: string, value: unknown): AchievementRecord {
  if (value === null || typeof value !== 'object') return lockedRecord(id);
  const raw = value as Partial<AchievementRecord>;
  const number = (input: unknown): number | null =>
    typeof input === 'number' && Number.isFinite(input) ? input : null;

  return {
    id,
    progress: Math.max(0, number(raw.progress) ?? 0),
    unlockedAt: number(raw.unlockedAt),
    // A record that claims to be paid but was never unlocked is not paid: the unlock is the
    // evidence, and INV-7 is about not paying twice, never about not paying at all.
    rewardedAt: number(raw.unlockedAt) === null ? null : number(raw.rewardedAt),
  };
}
