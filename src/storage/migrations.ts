/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.13 — Schema versioning + migration runner with snapshot and rollback
 * @story   US-12.2 — My saves survive an update
 * @design  05-data-model.md §9 (migrations), 04-architecture.md §7
 * @invariant INV-3 (namespaced storage)
 *
 * Purpose: the forward-only migration chain. `05` §9 sets the rules: every schema change ships
 * with its migration, a snapshot is written before the chain runs and restored if any step
 * throws, and a backup from a newer version is rejected rather than partially applied. Data loss
 * is the worst outcome this app can have, so nothing here is best-effort.
 */
import { STORES, type Database, type StoreName } from './idb.ts';

/** The schema version this build understands. Bumped only alongside a migration. */
export const CURRENT_SCHEMA_VERSION = 1;

export interface MigrationContext {
  readonly db: Database;
  readonly from: number;
  readonly to: number;
}

export interface Migration {
  /** Applies to data at version `to - 1`, producing version `to`. */
  readonly to: number;
  readonly description: string;
  run(context: MigrationContext): Promise<void>;
}

/**
 * The chain, in order. Version 1 is the initial schema, so it has no migration — the first entry
 * here will be `to: 2`.
 */
export const MIGRATIONS: readonly Migration[] = [];

/** A full copy of every store, used as the pre-migration snapshot (`05` §9 rule 2). */
export interface Snapshot {
  readonly schemaVersion: number;
  readonly takenAt: number;
  readonly stores: Readonly<Record<string, readonly { key?: IDBValidKey; value: unknown }[]>>;
}

export interface MetaRecord {
  readonly schemaVersion: number;
}

/** Stores keyed by an explicit key rather than a keyPath (`05` §1). */
const KEYLESS: ReadonlySet<string> = new Set(
  STORES.filter((store) => store.keyPath === null).map((store) => store.name),
);

export async function readSchemaVersion(db: Database): Promise<number> {
  const meta = await db.get<MetaRecord>('meta', 'meta');
  return meta?.schemaVersion ?? CURRENT_SCHEMA_VERSION;
}

export async function writeSchemaVersion(db: Database, version: number): Promise<void> {
  const meta = (await db.get<Record<string, unknown>>('meta', 'meta')) ?? {};
  await db.put('meta', { ...meta, schemaVersion: version }, 'meta');
}

/** Reads every store into memory. Sized for a personal roster, not a warehouse. */
export async function takeSnapshot(db: Database, now: number = Date.now()): Promise<Snapshot> {
  const stores: Record<string, { key?: IDBValidKey; value: unknown }[]> = {};

  for (const spec of STORES) {
    const name = spec.name as StoreName;
    if (KEYLESS.has(name)) {
      // Singleton stores are keyed by their own name.
      const value = await db.get<unknown>(name, name);
      stores[name] = value === undefined ? [] : [{ key: name, value }];
    } else {
      stores[name] = (await db.getAll<unknown>(name)).map((value) => ({ value }));
    }
  }

  return { schemaVersion: await readSchemaVersion(db), takenAt: now, stores };
}

/** Restores a snapshot, replacing current contents store by store. */
export async function restoreSnapshot(db: Database, snapshot: Snapshot): Promise<void> {
  for (const spec of STORES) {
    const name = spec.name as StoreName;
    const entries = snapshot.stores[name] ?? [];
    await db.clear(name);
    if (entries.length > 0) {
      await db.putMany(
        name,
        entries.map((entry) => (entry.key === undefined ? { value: entry.value } : entry)),
      );
    }
  }
  await writeSchemaVersion(db, snapshot.schemaVersion);
}

export type MigrationOutcome =
  | { readonly status: 'up-to-date'; readonly version: number }
  | {
      readonly status: 'migrated';
      readonly from: number;
      readonly to: number;
      readonly applied: readonly number[];
    }
  /** Restored from the snapshot. The app runs on the old version rather than on broken data. */
  | {
      readonly status: 'rolled-back';
      readonly from: number;
      readonly failedAt: number;
      readonly error: unknown;
    }
  /**
   * Data written by a newer build. `05` §9 rule 4: reject clearly, never partially apply — a
   * forward-only chain cannot undo what it does not know about.
   */
  | { readonly status: 'too-new'; readonly dataVersion: number; readonly supported: number };

export interface RunOptions {
  readonly migrations?: readonly Migration[];
  readonly target?: number;
  readonly now?: () => number;
}

/**
 * Runs the chain from the stored version to the target. Pure per step, idempotent, and rolled
 * back as a whole if any step throws.
 */
export async function runMigrations(
  db: Database,
  options: RunOptions = {},
): Promise<MigrationOutcome> {
  const target = options.target ?? CURRENT_SCHEMA_VERSION;
  const chain = [...(options.migrations ?? MIGRATIONS)].sort((a, b) => a.to - b.to);
  const from = await readSchemaVersion(db);

  if (from > target) return { status: 'too-new', dataVersion: from, supported: target };
  if (from === target) return { status: 'up-to-date', version: target };

  const pending = chain.filter((migration) => migration.to > from && migration.to <= target);
  if (pending.length === 0) {
    // Nothing to do but the number moved — record it so the check is cheap next launch.
    await writeSchemaVersion(db, target);
    return { status: 'migrated', from, to: target, applied: [] };
  }

  const snapshot = await takeSnapshot(db, options.now?.() ?? Date.now());
  const applied: number[] = [];

  for (const migration of pending) {
    try {
      await migration.run({ db, from: migration.to - 1, to: migration.to });
      await writeSchemaVersion(db, migration.to);
      applied.push(migration.to);
    } catch (error) {
      await restoreSnapshot(db, snapshot);
      return { status: 'rolled-back', from, failedAt: migration.to, error };
    }
  }

  await writeSchemaVersion(db, target);
  return { status: 'migrated', from, to: target, applied };
}

/** Plain-language copy for each outcome (`10` §10 — migration in progress, corrupt save). */
export function describeOutcome(outcome: MigrationOutcome): string {
  switch (outcome.status) {
    case 'up-to-date':
      return 'Your data is ready.';
    case 'migrated':
      return 'Your data has been updated for this version.';
    case 'rolled-back':
      return 'Updating your data did not finish, so nothing was changed. Your previous data is intact.';
    case 'too-new':
      return 'This data was saved by a newer version of the game. Update first, then try again.';
  }
}
