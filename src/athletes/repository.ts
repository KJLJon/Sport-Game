/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.1 — Athlete schema, IndexedDB store, indexes, repository
 * @story   US-5.1 — Create an athlete profile
 * @story   US-5.5 — Edit and delete profiles
 * @design  05-data-model.md §1 (storage overview), §2 (athlete)
 * @invariant INV-3 (all storage through src/storage/)
 *
 * Purpose: the only way the app reads or writes athletes. Everything above it — the roster
 * browser, the profile editor, importers, the lineup editor, and eventually the sim's squad
 * loader — goes through this, so there is exactly one place where an athlete's persisted shape is
 * known.
 *
 * Two things it deliberately does *not* do. It does not validate: a record that reaches here is
 * already a valid `Athlete`, and the validating front door is T-3.2 for created athletes and
 * T-3.15 for imported ones. And it does not cache: IndexedDB reads of a personal-sized roster are
 * fast, and a stale roster in front of the editor would be a much worse bug than a re-read.
 */
import type { Database } from '../storage/idb.ts';
import type { SportId } from '../sports/types.ts';
import type { Athlete, Rarity } from './types.ts';

/** The store's indexes, named so a caller never spells one wrong. `05` §1, T-0.11. */
export const ATHLETE_INDEX = {
  primarySport: 'byPrimarySport',
  rarity: 'byRarity',
  displayName: 'byDisplayName',
  createdAt: 'byCreatedAt',
} as const;

/** Undo for a deletion (US-5.5) — the record, so restoring it is a `put` of exactly what was there. */
export interface DeletedAthlete {
  readonly athlete: Athlete;
  readonly deletedAt: number;
}

export class AthleteRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  get(id: string): Promise<Athlete | undefined> {
    return this.#db.get<Athlete>('athletes', id);
  }

  /** Every athlete, in whatever order the store returns — the browser sorts (T-3.10). */
  getAll(): Promise<Athlete[]> {
    return this.#db.getAll<Athlete>('athletes');
  }

  count(): Promise<number> {
    return this.#db.count('athletes');
  }

  /** Reads several by id, preserving the caller's order and dropping ids that are gone. */
  async getMany(ids: readonly string[]): Promise<Athlete[]> {
    const found: Athlete[] = [];
    for (const id of ids) {
      const athlete = await this.get(id);
      if (athlete !== undefined) found.push(athlete);
    }
    return found;
  }

  byPrimarySport(sport: SportId): Promise<Athlete[]> {
    return this.#db.getAllByIndex<Athlete>(
      'athletes',
      ATHLETE_INDEX.primarySport,
      IDBKeyRange.only(sport),
    );
  }

  byRarity(rarity: Rarity): Promise<Athlete[]> {
    return this.#db.getAllByIndex<Athlete>(
      'athletes',
      ATHLETE_INDEX.rarity,
      IDBKeyRange.only(rarity),
    );
  }

  /** Newest first — what an empty roster browser and the post-import summary both want. */
  async recent(limit: number): Promise<Athlete[]> {
    const ascending = await this.#db.getAllByIndex<Athlete>('athletes', ATHLETE_INDEX.createdAt);
    return ascending.reverse().slice(0, Math.max(0, limit));
  }

  put(athlete: Athlete): Promise<void> {
    return this.#db.put('athletes', athlete);
  }

  /** One transaction, so a half-written import can never be committed (T-3.15). */
  putMany(athletes: readonly Athlete[]): Promise<void> {
    return this.#db.putMany(
      'athletes',
      athletes.map((athlete) => ({ value: athlete })),
    );
  }

  /**
   * Deletes, returning what was removed so the caller can offer undo (US-5.5). A missing id is
   * `undefined` rather than an error — deleting twice is not a failure worth surfacing.
   */
  async delete(id: string): Promise<DeletedAthlete | undefined> {
    const athlete = await this.get(id);
    if (athlete === undefined) return undefined;
    await this.#db.delete('athletes', id);
    return { athlete, deletedAt: Date.now() };
  }

  /** Restores a deletion. The record is written back exactly as it was, id included. */
  restore(deleted: DeletedAthlete): Promise<void> {
    return this.put(deleted.athlete);
  }

  /** Bulk delete for the roster browser's multi-select. Returns the records, for one undo. */
  async deleteMany(ids: readonly string[]): Promise<DeletedAthlete[]> {
    const removed: DeletedAthlete[] = [];
    for (const id of ids) {
      const deleted = await this.delete(id);
      if (deleted !== undefined) removed.push(deleted);
    }
    return removed;
  }

  /** Erase-all for the roster, used by import-replace and by the data-safety screens. */
  clear(): Promise<void> {
    return this.#db.clear('athletes');
  }
}

/**
 * Case- and accent-insensitive substring match on the display name. Lives here rather than in the
 * browser so search means the same thing everywhere it is offered, and so an accented name is
 * findable by someone typing the unaccented spelling — which is most people, most of the time.
 */
export function matchesQuery(athlete: Athlete, query: string): boolean {
  const needle = normaliseForSearch(query);
  if (needle === '') return true;
  return normaliseForSearch(athlete.displayName).includes(needle);
}

export function normaliseForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}
