/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.5 — Stats store: match history, box scores, career stats per sport per mode
 * @story   US-10.4 — See my history and stats
 * @design  05-data-model.md §1 (the `matches` store and its indexes)
 * @invariant INV-3 (every store name comes from `storage/scope.ts` via `idb.ts`)
 *
 * Purpose: reading and writing the `matches` store. The store, its key, and its two indexes were
 * declared in `05` §1 and created by the Phase-0 schema; this is the first thing to use them.
 *
 * **History is capped.** A match record is small, but a store nothing ever prunes is a store that
 * grows for as long as the app is installed, on a device whose quota is not ours. The cap is
 * generous enough that no ordinary player reaches it and finite enough that nobody's save grows
 * without bound.
 */
import type { Database } from '../storage/idb.ts';
import type { SportId } from '../sports/types.ts';
import type { MatchRecord } from './types.ts';

/**
 * How many matches to keep. Beyond this the oldest are dropped.
 *
 * 500 is about a year of daily play. Career totals are derived from what is stored, so a pruned
 * match does leave a career line slightly short — which is the honest cost of not growing forever,
 * and is recorded on the screen rather than hidden.
 */
export const HISTORY_LIMIT = 500;

export class MatchRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  get(id: string): Promise<MatchRecord | undefined> {
    return this.#db.get<MatchRecord>('matches', id);
  }

  /** Every match, newest first. */
  async recent(limit = 50): Promise<MatchRecord[]> {
    const all = await this.#db.getAll<MatchRecord>('matches');
    return all.sort((a, b) => b.playedAt - a.playedAt).slice(0, limit);
  }

  /** Every match in one sport, newest first. Uses the `bySport` index `05` §1 declared. */
  async bySport(sportId: SportId): Promise<MatchRecord[]> {
    const all = await this.#db.getAllByIndex<MatchRecord>(
      'matches',
      'bySport',
      IDBKeyRange.only(sportId),
    );
    return all.sort((a, b) => b.playedAt - a.playedAt);
  }

  async all(): Promise<MatchRecord[]> {
    return this.#db.getAll<MatchRecord>('matches');
  }

  async count(): Promise<number> {
    return this.#db.count('matches');
  }

  /** Records a match and prunes anything past the cap. */
  async record(match: MatchRecord): Promise<void> {
    await this.#db.put('matches', match);
    await this.prune();
  }

  /**
   * Drops the oldest records beyond `HISTORY_LIMIT`.
   *
   * Reads only what it needs to decide: the count first, and the full list only when the cap is
   * actually exceeded, so the ordinary case is one cheap query.
   */
  async prune(limit = HISTORY_LIMIT): Promise<void> {
    if ((await this.count()) <= limit) return;

    const all = await this.all();
    const doomed = all.sort((a, b) => b.playedAt - a.playedAt).slice(limit);
    for (const record of doomed) await this.#db.delete('matches', record.id);
  }

  async clear(): Promise<void> {
    for (const record of await this.all()) await this.#db.delete('matches', record.id);
  }
}
