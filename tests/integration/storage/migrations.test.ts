/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.13 — Schema versioning + migration runner with snapshot and rollback
 * @story   US-12.2 — My saves survive an update
 * @design  05-data-model.md §9
 *
 * Purpose: run against real IndexedDB, because the guarantee that matters — a failed migration
 * leaves the player's data exactly as it was — is about transactions and ordering, not about
 * whether a mock was called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import {
  CURRENT_SCHEMA_VERSION,
  describeOutcome,
  readSchemaVersion,
  restoreSnapshot,
  runMigrations,
  takeSnapshot,
  writeSchemaVersion,
  type Migration,
} from '../../../src/storage/migrations.ts';

interface Athlete {
  id: string;
  name: string;
  height?: number;
  heightCm?: number;
}

/** Renames `height` to `heightCm` — a representative, idempotent migration. */
const RENAME_HEIGHT: Migration = {
  to: 2,
  description: 'height → heightCm',
  async run({ db }) {
    const athletes = await db.getAll<Athlete>('athletes');
    for (const athlete of athletes) {
      if (athlete.height === undefined) continue;
      const { height, ...rest } = athlete;
      await db.put('athletes', { ...rest, heightCm: height });
    }
  },
};

const ADD_FLAG: Migration = {
  to: 3,
  description: 'add sandbox flag',
  async run({ db }) {
    for (const athlete of await db.getAll<Athlete>('athletes')) {
      await db.put('athletes', { ...athlete, sandbox: false });
    }
  },
};

const EXPLODES: Migration = {
  to: 2,
  description: 'always fails',
  async run({ db }) {
    // Write something first, so a rollback has to undo real work rather than nothing.
    await db.put('athletes', { id: 'partial', name: 'Half-migrated' });
    throw new Error('migration blew up');
  },
};

describe('migrations', () => {
  let db: Database;

  beforeEach(async () => {
    await deleteDatabase();
    db = await Database.open();
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase();
  });

  it('reports up-to-date when the version already matches', async () => {
    await writeSchemaVersion(db, CURRENT_SCHEMA_VERSION);
    await expect(runMigrations(db)).resolves.toEqual({
      status: 'up-to-date',
      version: CURRENT_SCHEMA_VERSION,
    });
  });

  it('assumes the current version for a fresh database', async () => {
    expect(await readSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('applies the chain in order and records the new version', async () => {
    await writeSchemaVersion(db, 1);
    await db.put('athletes', { id: 'a1', name: 'Ada', height: 180 });

    const outcome = await runMigrations(db, { migrations: [ADD_FLAG, RENAME_HEIGHT], target: 3 });

    expect(outcome).toMatchObject({ status: 'migrated', from: 1, to: 3, applied: [2, 3] });
    expect(await readSchemaVersion(db)).toBe(3);
    expect(await db.get<Athlete>('athletes', 'a1')).toMatchObject({
      heightCm: 180,
      sandbox: false,
    });
  });

  it('applies only the steps above the stored version', async () => {
    await writeSchemaVersion(db, 2);
    await db.put('athletes', { id: 'a1', name: 'Ada', heightCm: 180 });

    const outcome = await runMigrations(db, { migrations: [RENAME_HEIGHT, ADD_FLAG], target: 3 });

    expect(outcome).toMatchObject({ status: 'migrated', applied: [3] });
  });

  it('is idempotent: re-running the chain changes nothing', async () => {
    await writeSchemaVersion(db, 1);
    await db.put('athletes', { id: 'a1', name: 'Ada', height: 180 });

    await runMigrations(db, { migrations: [RENAME_HEIGHT], target: 2 });
    const first = await db.get<Athlete>('athletes', 'a1');

    await writeSchemaVersion(db, 1);
    await runMigrations(db, { migrations: [RENAME_HEIGHT], target: 2 });

    expect(await db.get<Athlete>('athletes', 'a1')).toEqual(first);
  });

  it('rolls back to the snapshot when a step throws, leaving data untouched', async () => {
    await writeSchemaVersion(db, 1);
    await db.putMany('athletes', [
      { value: { id: 'a1', name: 'Ada', height: 180 } },
      { value: { id: 'a2', name: 'Grace', height: 170 } },
    ]);
    await db.put('economy', { coins: 1250 }, 'economy');

    const outcome = await runMigrations(db, { migrations: [EXPLODES], target: 2 });

    expect(outcome).toMatchObject({ status: 'rolled-back', from: 1, failedAt: 2 });
    expect(await readSchemaVersion(db)).toBe(1);
    expect(await db.count('athletes')).toBe(2);
    expect(await db.get<Athlete>('athletes', 'a1')).toMatchObject({ height: 180 });
    // The partial write the failing migration made is gone.
    expect(await db.get('athletes', 'partial')).toBeUndefined();
    expect(await db.get<{ coins: number }>('economy', 'economy')).toMatchObject({ coins: 1250 });
  });

  it('rolls back the whole chain, not just the failing step', async () => {
    await writeSchemaVersion(db, 1);
    await db.put('athletes', { id: 'a1', name: 'Ada', height: 180 });

    const failsLater: Migration = {
      to: 3,
      description: 'fails after a successful step',
      run: async () => {
        throw new Error('later step failed');
      },
    };

    const outcome = await runMigrations(db, {
      migrations: [RENAME_HEIGHT, failsLater],
      target: 3,
    });

    expect(outcome).toMatchObject({ status: 'rolled-back', failedAt: 3 });
    // The successful step 2 was undone too — the chain commits as a unit.
    expect(await db.get<Athlete>('athletes', 'a1')).toMatchObject({ height: 180 });
    expect(await readSchemaVersion(db)).toBe(1);
  });

  it('rejects data from a newer build rather than partially applying (`05` §9 rule 4)', async () => {
    await writeSchemaVersion(db, 9);

    const outcome = await runMigrations(db, { migrations: [RENAME_HEIGHT], target: 2 });

    expect(outcome).toEqual({ status: 'too-new', dataVersion: 9, supported: 2 });
    expect(await readSchemaVersion(db)).toBe(9);
    expect(describeOutcome(outcome)).toMatch(/newer version/i);
  });

  it('snapshots and restores every store, singletons included', async () => {
    await db.put('athletes', { id: 'a1', name: 'Ada' });
    await db.put('economy', { coins: 900 }, 'economy');
    await db.put('settings', { theme: 'dark' }, 'settings');

    const snapshot = await takeSnapshot(db, 1000);
    expect(snapshot.takenAt).toBe(1000);

    await db.clear('athletes');
    await db.put('economy', { coins: 0 }, 'economy');

    await restoreSnapshot(db, snapshot);

    expect(await db.count('athletes')).toBe(1);
    expect(await db.get<{ coins: number }>('economy', 'economy')).toMatchObject({ coins: 900 });
    expect(await db.get<{ theme: string }>('settings', 'settings')).toMatchObject({
      theme: 'dark',
    });
  });

  it('moves the version forward even when the range holds no migrations', async () => {
    await writeSchemaVersion(db, 1);
    const outcome = await runMigrations(db, { migrations: [], target: 4 });
    expect(outcome).toMatchObject({ status: 'migrated', applied: [] });
    expect(await readSchemaVersion(db)).toBe(4);
  });

  it('never leaves the player without an explanation', () => {
    for (const outcome of [
      { status: 'up-to-date', version: 1 },
      { status: 'migrated', from: 1, to: 2, applied: [2] },
      { status: 'rolled-back', from: 1, failedAt: 2, error: new Error('x') },
      { status: 'too-new', dataVersion: 9, supported: 1 },
    ] as const) {
      expect(describeOutcome(outcome).length).toBeGreaterThan(0);
    }
  });

  it('takes the snapshot before the first step runs', async () => {
    await writeSchemaVersion(db, 1);
    await db.put('athletes', { id: 'a1', name: 'Ada', height: 180 });
    const now = vi.fn().mockReturnValue(5000);

    await runMigrations(db, { migrations: [EXPLODES], target: 2, now });

    expect(now).toHaveBeenCalled();
  });
});
