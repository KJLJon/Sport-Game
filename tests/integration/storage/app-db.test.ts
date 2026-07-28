/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.1 — Athlete schema, IndexedDB store, indexes, repository
 * @design  05-data-model.md §1, §9
 *
 * Purpose: the shared handle. The interesting cases are the ones that only appear under
 * concurrency or failure — two screens mounting in the same tick, and a build that cannot read
 * what is stored.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DatabaseUnavailableError,
  appDatabase,
  closeAppDatabase,
} from '../../../src/storage/app-db.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../src/storage/migrations.ts';
import { athlete } from '../../helpers/athletes.ts';

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('appDatabase', () => {
  it('opens once and hands the same handle to everyone', async () => {
    const [first, second] = await Promise.all([appDatabase(), appDatabase()]);
    expect(first).toBe(second);
  });

  it('does not race two opens when two screens mount in the same tick', async () => {
    const handles = await Promise.all(Array.from({ length: 8 }, () => appDatabase()));
    expect(new Set(handles).size).toBe(1);
  });

  it('runs the migration chain before anyone sees the handle', async () => {
    const { migration } = await appDatabase();
    expect(['up-to-date', 'migrated']).toContain(migration.status);
  });

  it('serves a working athlete repository', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1', displayName: 'Stored' }));
    expect((await athletes.get('a1'))?.displayName).toBe('Stored');
  });

  it('refuses to open over data from a newer build rather than half-reading it', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    await expect(appDatabase()).rejects.toBeInstanceOf(DatabaseUnavailableError);
  });

  it('lets a failed open be retried rather than caching the failure', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    await expect(appDatabase()).rejects.toThrow();

    const repaired = await Database.open();
    await repaired.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION }, 'meta');
    repaired.close();

    await expect(appDatabase()).resolves.toBeDefined();
  });

  it('closing an unopened database is not an error', async () => {
    await expect(closeAppDatabase()).resolves.toBeUndefined();
  });
});
