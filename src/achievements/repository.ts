/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.6 — Achievement engine: declarative defs, event-stream evaluation, progress,
 *          once-only grants (INV-7)
 * @story   US-8.1 — Unlock achievements as I play
 * @story   US-8.3 — Be rewarded for achievements
 * @design  05-data-model.md §1 (the `achievements` store and its `byUnlockedAt` index), §6
 * @invariant INV-3 (the store name comes from `idb.ts`), INV-7 (granted at most once)
 *
 * Purpose: the `achievements` store, and the one place a reward is paid.
 *
 * **`grantPending` is INV-7.** An unlock writes `unlockedAt`; paying writes `rewardedAt`. Between
 * those two writes the app can be killed, migrated, or reinstalled from a backup, and the state it
 * leaves — unlocked, unpaid — is unambiguous: the next call pays it. Nothing else in the app credits
 * an achievement, so "at most once" is a property of one function rather than a rule spread across
 * the callers.
 *
 * It is also idempotent by construction: it reads what is stored, pays only the records with a null
 * `rewardedAt`, and writes that field in the same pass. Calling it twice in a row pays nothing the
 * second time; calling it after a restore from an old backup pays exactly the unlocks that backup
 * had not yet been paid for.
 */
import type { Database } from '../storage/idb.ts';
import type { EconomyRepository } from '../economy/repository.ts';
import {
  lockedRecord,
  normaliseRecord,
  type AchievementDef,
  type AchievementRecord,
} from './types.ts';

export class AchievementRepository {
  readonly #db: Database;
  /** The tail of the write chain. See `run` — this is the other half of INV-7. */
  #chain: Promise<unknown> = Promise.resolve();

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Runs work with exclusive access to the store, queued behind every other such call.
   *
   * INV-7 is not only about *remembering* that a reward was paid; it is about two settlements in
   * the same tick not both reading "unpaid" before either writes. Two matches cannot finish at
   * once, but a match finishing while the bootstrap grant is still running can — and did, in the
   * test that made this method exist. Reads outside this queue are fine; anything that decides
   * something from what it read must be inside it.
   *
   * Not reentrant. `grantPending` queues itself, so a caller must never wrap a call to it.
   */
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#chain.then(work);
    // One rejection must not strand every later grant.
    this.#chain = next.catch(() => undefined);
    return next;
  }

  async get(id: string): Promise<AchievementRecord> {
    const stored = await this.#db.get<unknown>('achievements', id);
    return stored === undefined ? lockedRecord(id) : normaliseRecord(id, stored);
  }

  async all(): Promise<AchievementRecord[]> {
    const stored = await this.#db.getAll<AchievementRecord>('achievements');
    return stored.map((record) => normaliseRecord(record.id, record));
  }

  /** Records keyed by id, which is how the tracker and the gallery both want them. */
  async byId(): Promise<Map<string, AchievementRecord>> {
    return new Map((await this.all()).map((record) => [record.id, record]));
  }

  /** Unlocked ones, newest first. Uses the `byUnlockedAt` index `05` §1 declared. */
  async unlocked(): Promise<AchievementRecord[]> {
    return (await this.all())
      .filter((record) => record.unlockedAt !== null)
      .sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0));
  }

  async put(record: AchievementRecord): Promise<void> {
    await this.#db.put('achievements', record);
  }

  async putMany(records: readonly AchievementRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.#db.putMany(
      'achievements',
      records.map((record) => ({ value: record })),
    );
  }

  /** Clears every unlock. Used by erase-all-data; never by an update. */
  async clear(): Promise<void> {
    await this.#db.clear('achievements');
  }
}

/** What one grant paid. Returned so the UI can say "+400 coins" beside the achievement (US-8.3). */
export interface AchievementGrant {
  readonly def: AchievementDef;
  readonly coins: number;
  readonly pack: AchievementDef['reward']['pack'];
}

/**
 * Pays every unlocked-but-unpaid achievement, exactly once, ever.
 *
 * Order matters and is deliberate: credit first, then mark paid. A crash after the credit and
 * before the mark would pay twice on the next run, so the mark is written *per record* immediately
 * after its own credit rather than in one batch at the end — a batch would put every grant in the
 * session at risk of the same double-pay.
 *
 * A def that no longer exists in the build is skipped rather than paid blind: its record stays
 * unlocked and unpaid, and if the def comes back — a sport re-enabled, a content revert — it is
 * paid then. Paying for an achievement whose title and reward this build cannot read would be
 * inventing coins.
 */
export async function grantPending(
  achievements: AchievementRepository,
  economy: EconomyRepository,
  defs: readonly AchievementDef[],
  now: number = Date.now(),
): Promise<AchievementGrant[]> {
  const byId = new Map(defs.map((def) => [def.id, def]));

  // Queued: the read of "what is unpaid" and the write of "now it is paid" have to be one step, or
  // two callers in the same tick both see the same unpaid record and both pay it.
  return achievements.run(async () => {
    const granted: AchievementGrant[] = [];

    for (const record of await achievements.all()) {
      if (record.unlockedAt === null || record.rewardedAt !== null) continue;
      const def = byId.get(record.id);
      if (def === undefined) continue;

      const coins = def.reward.coins ?? 0;
      if (coins > 0) await economy.earn(coins, 'achievement', def.title, now);
      if (def.reward.pack !== undefined) await economy.owePack(def.reward.pack);

      await achievements.put({ ...record, rewardedAt: now });
      granted.push({ def, coins, pack: def.reward.pack });
    }

    return granted;
  });
}
