/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.1 — Athlete schema, IndexedDB store, indexes, repository
 * @task    T-3.7 — Profile editor
 * @story   US-5.1 — Create an athlete profile
 * @story   US-12.2 — My saves survive an update
 * @design  05-data-model.md §1 (storage overview), §9 (migrations), 04-architecture.md §7
 * @invariant INV-3 (all storage through src/storage/)
 *
 * Purpose: the app's one database handle. Screens ask for a repository; they never open a
 * connection, never learn a store name, and never think about the migration chain.
 *
 * Opening is deferred to first use and shared, because a screen that opens its own connection is
 * a screen that can be holding an old version open while another tab upgrades — the exact case
 * `11` §9's PWA-14 is about. It is also memoised on the *promise*, not the result: two screens
 * mounting in the same tick must not race two `open` calls.
 *
 * The migration chain runs once, on that first open, before any caller sees the handle. A build
 * that cannot read the stored data has to say so rather than serve a screen full of wrong numbers,
 * so a failed or too-new migration is surfaced as a rejected open, not swallowed.
 */
import { AthleteRepository } from '../athletes/repository.ts';
import { Database } from './idb.ts';
import { describeOutcome, runMigrations, type MigrationOutcome } from './migrations.ts';

export interface AppDatabase {
  readonly db: Database;
  readonly athletes: AthleteRepository;
  /** What the migration chain did on open. Shown by the data screens (`10` §10). */
  readonly migration: MigrationOutcome;
}

let pending: Promise<AppDatabase> | null = null;

/** A rejected open: the build cannot safely read what is stored (`05` §9 rules 2 and 4). */
export class DatabaseUnavailableError extends Error {
  readonly outcome: MigrationOutcome;

  constructor(outcome: MigrationOutcome) {
    super(describeOutcome(outcome));
    this.name = 'DatabaseUnavailableError';
    this.outcome = outcome;
  }
}

async function open(onBlocked?: () => void): Promise<AppDatabase> {
  const db = await Database.open(onBlocked === undefined ? {} : { onBlocked });
  const migration = await runMigrations(db);

  if (migration.status === 'rolled-back' || migration.status === 'too-new') {
    db.close();
    throw new DatabaseUnavailableError(migration);
  }

  return { db, athletes: new AthleteRepository(db), migration };
}

/**
 * The shared handle, opening it if this is the first ask. A failed open is not cached, so a
 * transient failure — another tab mid-upgrade, storage momentarily unavailable — can be retried
 * by asking again rather than by reloading the app.
 */
export function appDatabase(onBlocked?: () => void): Promise<AppDatabase> {
  pending ??= open(onBlocked).catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

/** Closes the shared handle. Used by erase-all-data and by tests between cases. */
export async function closeAppDatabase(): Promise<void> {
  const current = pending;
  pending = null;
  if (current === null) return;
  try {
    (await current).db.close();
  } catch {
    // An open that never succeeded has nothing to close.
  }
}
