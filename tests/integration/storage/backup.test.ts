/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.16 — Roster and full-backup export/import with version checks and change preview
 * @story   US-12.1 — Back up and restore everything
 * @design  05-data-model.md §1, §9
 *
 * Purpose: the data-safety feature, against real IndexedDB. The two things worth being certain of
 * are that a round trip loses nothing, and that a backup this build cannot read is refused whole
 * rather than partially applied — `05` §9 rule 4, which is the difference between a clear message
 * and a corrupted save.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  backupFilename,
  exportBackup,
  exportRoster,
  parseBackup,
  previewBackup,
  restoreBackup,
  serialiseBackup,
} from '../../../src/storage/backup.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../src/storage/migrations.ts';
import { athlete } from '../../helpers/athletes.ts';

describe('backup', () => {
  let db: Database;

  beforeEach(async () => {
    await deleteDatabase();
    db = await Database.open();
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase();
  });

  async function seed(): Promise<void> {
    await db.put('athletes', athlete({ id: 'a1', displayName: 'Kept' }));
    await db.put('athletes', athlete({ id: 'a2', displayName: 'Also kept' }));
    await db.put('teams', { id: 't1', name: 'Riverside' });
    await db.put('settings', { theme: 'dark' }, 'settings');
  }

  it('carries its schema version, so the chain can be run on import (`05` §9)', async () => {
    const backup = await exportBackup(db, { now: 1234 });
    expect(backup.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.createdAt).toBe(1234);
  });

  it("round-trips everything through a wipe (US-12.1, and Gate 3's own criterion)", async () => {
    await seed();
    const text = serialiseBackup(await exportBackup(db));

    // Wipe exactly as "erase all data" would.
    for (const store of ['athletes', 'teams', 'settings'] as const) await db.clear(store);
    expect(await db.count('athletes')).toBe(0);

    const parsed = parseBackup(text);
    expect('backup' in parsed).toBe(true);
    if (!('backup' in parsed)) return;

    await restoreBackup(db, parsed.backup);

    expect(await db.count('athletes')).toBe(2);
    expect((await db.get<{ displayName: string }>('athletes', 'a1'))?.displayName).toBe('Kept');
    expect(await db.get<{ theme: string }>('settings', 'settings')).toEqual({ theme: 'dark' });
  });

  it('exports the roster alone when that is what was asked for (US-5.8)', async () => {
    await seed();
    const roster = await exportRoster(db);
    expect(Object.keys(roster.stores).sort()).toEqual(['athletes', 'squads', 'teams']);
    expect(roster.stores.settings).toBeUndefined();
  });

  it('previews exactly what a restore would do, before it does any of it', async () => {
    await seed();
    const backup = await exportBackup(db);

    // Change one, delete one, add one the backup does not know about.
    await db.put('athletes', athlete({ id: 'a1', displayName: 'Renamed' }));
    await db.delete('athletes', 'a2');
    await db.put('athletes', athlete({ id: 'a3', displayName: 'New here' }));

    const preview = await previewBackup(db, backup);
    const athletes = preview.changes.find((c) => c.store === 'athletes');

    expect(athletes).toMatchObject({ added: 1, replaced: 1, notInBackup: 1 });
    expect(preview.totalAdded).toBeGreaterThanOrEqual(1);
    expect(preview.noOp).toBe(false);
  });

  it('says plainly when a backup would change nothing', async () => {
    await seed();
    const preview = await previewBackup(db, await exportBackup(db));
    expect(preview.noOp).toBe(true);
    expect(preview.totalReplaced).toBe(0);
  });

  it('gives the same numbers whether previewed or applied — one code path', async () => {
    await seed();
    const backup = await exportBackup(db);
    await db.delete('athletes', 'a2');

    const preview = await previewBackup(db, backup);
    const applied = await restoreBackup(db, backup);
    expect(applied).toEqual(preview);
  });

  it('merges by default, leaving records the backup never mentioned', async () => {
    await seed();
    const backup = await exportBackup(db);
    await db.put('athletes', athlete({ id: 'a9', displayName: 'Made later' }));

    await restoreBackup(db, backup, 'merge');
    expect(await db.count('athletes')).toBe(3);
  });

  it('replaces when asked, clearing each store the backup covers', async () => {
    await seed();
    const backup = await exportBackup(db);
    await db.put('athletes', athlete({ id: 'a9', displayName: 'Made later' }));

    await restoreBackup(db, backup, 'replace');
    expect(await db.count('athletes')).toBe(2);
    expect(await db.get('athletes', 'a9')).toBeUndefined();
  });

  it('refuses a backup from a newer build outright, changing nothing (`05` §9 rule 4)', async () => {
    await seed();
    const backup = await exportBackup(db);
    const future = serialiseBackup({ ...backup, schemaVersion: CURRENT_SCHEMA_VERSION + 3 });

    const parsed = parseBackup(future);
    expect('problem' in parsed).toBe(true);
    if (!('problem' in parsed)) return;

    expect(parsed.problem.kind).toBe('too-new');
    expect(parsed.problem.message).toContain('nothing has been changed');
    expect(await db.count('athletes')).toBe(2);
  });

  it('refuses a newer envelope format too', () => {
    const parsed = parseBackup(JSON.stringify({ formatVersion: 99, schemaVersion: 1, stores: {} }));
    expect('problem' in parsed && parsed.problem.kind).toBe('too-new');
  });

  it('turns unreadable input into a message rather than an exception', () => {
    for (const text of ['not json at all', '{ "nope": true }', '[]', 'null', '"a string"']) {
      const parsed = parseBackup(text);
      expect('problem' in parsed).toBe(true);
      if ('problem' in parsed) expect(parsed.problem.message.length).toBeGreaterThan(10);
    }
  });

  it('accepts a backup from an older schema, which is what the chain is for', () => {
    const parsed = parseBackup(
      JSON.stringify({
        formatVersion: 1,
        schemaVersion: 1,
        createdAt: 1,
        stores: { athletes: [] },
      }),
    );
    expect('backup' in parsed).toBe(true);
  });

  it('skips records with no usable key rather than writing rubbish', async () => {
    const parsed = parseBackup(
      JSON.stringify({
        formatVersion: 1,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        createdAt: 1,
        stores: { athletes: [{ noIdHere: true }, athlete({ id: 'ok' })] },
      }),
    );
    if (!('backup' in parsed)) throw new Error('expected a parsed backup');

    await restoreBackup(db, parsed.backup);
    expect(await db.count('athletes')).toBe(1);
    expect(await db.get('athletes', 'ok')).toBeDefined();
  });

  it('names the file so backups sort by date', () => {
    expect(backupFilename(Date.UTC(2026, 6, 28, 9, 5, 3))).toBe(
      'sport-game-backup-2026-07-28-09-05-03.json',
    );
  });
});
