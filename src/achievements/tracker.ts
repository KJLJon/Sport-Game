/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.6 — Achievement engine: declarative defs, event-stream evaluation, progress,
 *          once-only grants (INV-7)
 * @story   US-8.1 — Unlock achievements as I play
 * @design  05-data-model.md §6 (evaluated against the same event stream), 09-modes-and-arcade.md §7
 * @invariant INV-7 (once-only), INV-8 (a run over the same events gives the same unlocks),
 *            INV-9 (one stream, no mode branch), INV-2 (nothing here draws)
 *
 * Purpose: runs the defs over an event stream and says what just unlocked.
 *
 * **Deterministic and side-effect free.** The tracker holds records in memory, folds events in, and
 * returns unlocks. It does not touch storage, does not pay anything, and does not know a wallet
 * exists — `grants.ts` does that, once, afterwards. So the same events always produce the same
 * unlocks (INV-8), and a test needs no database.
 *
 * **Match-scoped counters live here, not in the defs.** `evaluate` sees one event and has nowhere
 * to keep a tally, so "5 threes in one game" is expressed as a def with `scope: 'match'` returning
 * `1` per three, and this class resets its counter at `beginMatch()`. The stored progress for such
 * a def is the *best* match so far, which is what a progress bar should show: "3/5 — your best is
 * three in one game" is true, where a career total of 40 threes would be a lie about a per-match
 * achievement.
 *
 * **A broken def cannot break a match.** `evaluate` runs inside a try: an achievement rule that
 * throws is skipped and the match carries on, for the same reason `EventBus` contains listener
 * errors. Losing an unlock is bad; losing the match somebody is playing is worse.
 */
import { applyEvent, createBoxScore, type BoxScore } from '../modes/live/box-score.ts';
import type { SportEvent } from '../engine/match/events.ts';
import {
  isMetaEvent,
  lockedRecord,
  type AchievementDef,
  type AchievementEvent,
  type AchievementRecord,
  type AchievementUnlock,
  type EvalContext,
} from './types.ts';

export class AchievementTracker {
  readonly #defs: readonly AchievementDef[];
  readonly #records = new Map<string, AchievementRecord>();
  /** Ids whose record has changed since construction — exactly what needs writing back. */
  readonly #dirty = new Set<string>();
  /** Per-match progress for `scope: 'match'` defs, cleared by `beginMatch`. */
  readonly #matchProgress = new Map<string, number>();
  #box: BoxScore = createBoxScore();

  constructor(defs: readonly AchievementDef[], records: Iterable<AchievementRecord> = []) {
    this.#defs = defs;
    for (const record of records) this.#records.set(record.id, record);
  }

  /** The record for a def, locked and empty if it has never progressed. */
  record(id: string): AchievementRecord {
    return this.#records.get(id) ?? lockedRecord(id);
  }

  /** Every record the tracker knows about, including untouched ones it was handed. */
  records(): AchievementRecord[] {
    return [...this.#records.values()];
  }

  /** Only what changed. A save that writes 75 records on every match is a save that stutters. */
  changed(): AchievementRecord[] {
    return [...this.#dirty].map((id) => this.record(id));
  }

  /** The running box score, which the eval context exposes to the defs. */
  get box(): BoxScore {
    return this.#box;
  }

  /** Starts a fresh match: per-match counters and the box score both reset. */
  beginMatch(): void {
    this.#matchProgress.clear();
    this.#box = createBoxScore();
  }

  /**
   * Folds one event in and returns whatever unlocked because of it.
   *
   * The box score is updated *before* the defs run, so a def evaluating a `score` event can already
   * see that basket in the totals — "20 rebounds in a game" should fire on the twentieth rebound,
   * not on the next event after it.
   */
  consume(event: AchievementEvent, ctx: Omit<EvalContext, 'box'>): AchievementUnlock[] {
    if (!isMetaEvent(event)) applyEvent(this.#box, event as SportEvent);

    const context: EvalContext = { ...ctx, box: this.#box };
    const unlocked: AchievementUnlock[] = [];

    for (const def of this.#defs) {
      const current = this.record(def.id);
      // Once only, and cheaply: an unlocked def is not evaluated again for the rest of the install.
      if (current.unlockedAt !== null) continue;

      let delta: number | null;
      try {
        delta = def.evaluate(event, context);
      } catch {
        continue;
      }
      if (delta === null || !Number.isFinite(delta) || delta <= 0) continue;

      const progress =
        def.scope === 'match'
          ? this.#advanceMatch(def.id, delta)
          : Math.min(def.target, current.progress + delta);

      const next: AchievementRecord = {
        id: def.id,
        // A match-scoped def keeps its best attempt; a career one keeps its running total.
        progress: def.scope === 'match' ? Math.max(current.progress, progress) : progress,
        unlockedAt: progress >= def.target ? context.at : null,
        rewardedAt: null,
      };

      this.#records.set(def.id, next);
      this.#dirty.add(def.id);
      if (next.unlockedAt !== null) unlocked.push({ def, record: next });
    }

    return unlocked;
  }

  /** Folds a whole stream in — a finished match, replayed through the defs in one call. */
  consumeAll(
    events: Iterable<AchievementEvent>,
    ctx: Omit<EvalContext, 'box'>,
  ): AchievementUnlock[] {
    const unlocked: AchievementUnlock[] = [];
    for (const event of events) unlocked.push(...this.consume(event, ctx));
    return unlocked;
  }

  #advanceMatch(id: string, delta: number): number {
    const next = (this.#matchProgress.get(id) ?? 0) + delta;
    this.#matchProgress.set(id, next);
    return next;
  }
}

/** How far along a def is, as a fraction — what a progress bar is drawn from (US-8.2). */
export function progressFraction(def: AchievementDef, record: AchievementRecord): number {
  if (record.unlockedAt !== null) return 1;
  if (def.target <= 0) return 0;
  return Math.min(1, Math.max(0, record.progress / def.target));
}

/** "3 / 5", or the empty string for a one-shot, where a bar would say nothing a tick does not. */
export function progressText(def: AchievementDef, record: AchievementRecord): string {
  if (def.target <= 1) return '';
  return `${Math.min(record.progress, def.target)} / ${def.target}`;
}
