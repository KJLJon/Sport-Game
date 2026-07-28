/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.16 — Roster and full-backup export/import with version checks and change preview
 * @story   US-12.1 — Back up and restore everything
 * @design  10-ui-ux.md §10, §11
 *
 * Purpose: the promise US-12.1 makes is that an import shows what will change and asks first. That
 * is a UI promise, so it is tested here — nothing may be written before the confirmation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupScreen } from '../../../src/ui/screens/backup.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../src/storage/migrations.ts';
import { exportBackup, serialiseBackup } from '../../../src/storage/backup.ts';
import { athlete } from '../../helpers/athletes.ts';

function context() {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  return { host, params: {}, query: {}, navigate: vi.fn() };
}

/** jsdom has no real file picker; this is the same shape the screen reads. */
function chooseFile(host: HTMLElement, text: string): void {
  const input = host.querySelector('.backup__file') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ text: () => Promise.resolve(text) }],
  });
  input.dispatchEvent(new Event('change'));
}

/** The change handler chains `file.text()` then an async preview, so one turn is not enough. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function click(host: HTMLElement, label: string): void {
  const target = [...host.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (target === undefined) throw new Error(`no button labelled ${label}`);
  target.click();
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
  globalThis.URL.createObjectURL ??= () => 'blob:test';
  globalThis.URL.revokeObjectURL ??= () => undefined;
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('the backup screen', () => {
  it('offers both exports and says nothing is uploaded', async () => {
    await appDatabase();
    const ctx = context();
    await backupScreen().mount(ctx);

    const labels = [...ctx.host.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Export everything');
    expect(labels).toContain('Export roster only');
    expect(ctx.host.textContent).toContain('nothing is ever uploaded');
  });

  it('previews an import and writes nothing until it is confirmed (US-12.1)', async () => {
    const { db, athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1', displayName: 'Existing' }));

    // A backup holding a different athlete entirely.
    await athletes.clear();
    await athletes.put(athlete({ id: 'a2', displayName: 'From the backup' }));
    const text = serialiseBackup(await exportBackup(db));
    await athletes.clear();
    await athletes.put(athlete({ id: 'a1', displayName: 'Existing' }));

    const ctx = context();
    await backupScreen().mount(ctx);
    chooseFile(ctx.host, text);
    await flush();

    expect(ctx.host.textContent).toContain('What this would change');
    expect(ctx.host.textContent).toContain('Nothing has been changed yet');
    // Still untouched at this point — that is the whole promise.
    expect(await athletes.count()).toBe(1);
    expect(await athletes.get('a2')).toBeUndefined();

    click(ctx.host, 'Restore this backup');
    await flush();

    expect(await athletes.get('a2')).toBeDefined();
  });

  it('cancels without writing anything', async () => {
    const { db, athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a2', displayName: 'From the backup' }));
    const text = serialiseBackup(await exportBackup(db));
    await athletes.clear();

    const ctx = context();
    await backupScreen().mount(ctx);
    chooseFile(ctx.host, text);
    await flush();

    click(ctx.host, 'Cancel');
    await flush();

    expect(ctx.host.textContent).toContain('Nothing was changed');
    expect(await athletes.count()).toBe(0);
  });

  it('refuses a backup from a newer build in plain language (`05` §9 rule 4)', async () => {
    const { db } = await appDatabase();
    const backup = await exportBackup(db);
    const text = serialiseBackup({ ...backup, schemaVersion: CURRENT_SCHEMA_VERSION + 4 });

    const ctx = context();
    await backupScreen().mount(ctx);
    chooseFile(ctx.host, text);
    await flush();

    expect(ctx.host.textContent).toContain('newer version of the app');
    expect(ctx.host.textContent).not.toContain('What this would change');
  });

  it('says so when a file is not a backup at all, rather than throwing', async () => {
    await appDatabase();
    const ctx = context();
    await backupScreen().mount(ctx);
    chooseFile(ctx.host, 'this is not json');
    await flush();

    expect(ctx.host.textContent).toContain('not readable as JSON');
  });

  it('offers merge and replace as a radio group, each explained in words', async () => {
    const { db } = await appDatabase();
    const text = serialiseBackup(await exportBackup(db));

    const ctx = context();
    await backupScreen().mount(ctx);
    chooseFile(ctx.host, text);
    await flush();

    const modes = [
      ...ctx.host.querySelectorAll('input[name="restore-mode"]'),
    ] as HTMLInputElement[];
    expect(modes.map((m) => m.value)).toEqual(['merge', 'replace']);
    expect(modes[0]?.checked).toBe(true);
    expect(ctx.host.textContent).toContain('keep anything the backup does not mention');
    expect(ctx.host.textContent).toContain('remove anything the backup does not mention');
  });

  it('says the data could not be opened when this build cannot read it', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    const ctx = context();
    await backupScreen().mount(ctx);
    expect(ctx.host.querySelector('[role="alert"]')?.textContent).toContain(
      'Nothing has been changed or lost',
    );
  });
});
