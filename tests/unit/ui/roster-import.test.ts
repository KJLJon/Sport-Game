/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.15 — Roster import: file + URL, schema validation, per-record errors, merge/conflict,
 *          responsibility notice
 * @story   US-5.7 — Import a roster file
 * @design  10-ui-ux.md §10 (states usually forgotten), §11 (accessibility)
 *
 * Purpose: the import screen's own job — wiring the file and URL pickers, the preview, the
 * conflict prompt, and the write to the DOM and to `AthleteRepository`. The validation arithmetic
 * itself is `roster-import.test.ts`'s job (the pure module); this file only has to prove the
 * screen calls it correctly, shows the responsibility notice, and never writes before "Import" is
 * pressed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rosterImportScreen } from '../../../src/ui/screens/roster-import.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../src/storage/migrations.ts';
import { athlete } from '../../helpers/athletes.ts';

function context(navigate = vi.fn()) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  return { host, params: {}, query: {}, navigate };
}

const FULL_ATTRIBUTES = {
  speed: 84,
  acceleration: 91,
  agility: 95,
  strength: 68,
  vertical: 70,
  stamina: 78,
  coordination: 96,
  accuracy: 92,
  awareness: 94,
  composure: 93,
  discipline: 74,
};

function validAthleteRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayName: 'A. Example',
    primarySport: 'soccer',
    attributes: FULL_ATTRIBUTES,
    ...overrides,
  };
}

function rosterFile(...athletes: unknown[]): string {
  return JSON.stringify({ formatVersion: 1, name: 'Import test', athletes });
}

function chooseFile(host: HTMLElement, contents: string, name = 'roster.json'): void {
  const input = host.querySelector<HTMLInputElement>('#roster-import-file')!;
  const file = new File([contents], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
  vi.unstubAllGlobals();
});

describe('the roster import screen', () => {
  it('says the roster could not be opened when the database cannot open', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    const ctx = context();
    await rosterImportScreen().mount(ctx);

    expect(ctx.host.querySelector('[role="alert"]')).not.toBeNull();
    expect(ctx.host.textContent).toContain('could not be opened');
  });

  it('always shows the responsibility notice before anything is imported', async () => {
    await appDatabase();
    const ctx = context();
    await rosterImportScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('is your responsibility');
    expect(ctx.host.textContent).toContain('ships no roster files');
  });

  it('reports malformed JSON from a file as a plain-language error, not a crash', async () => {
    await appDatabase();
    const ctx = context();
    await rosterImportScreen().mount(ctx);

    chooseFile(ctx.host, '{ not json');
    await vi.waitFor(() => {
      expect(ctx.host.textContent).toContain('That file could not be imported');
    });
  });

  it('previews a valid file, listing accepted and rejected counts, before writing anything', async () => {
    const { athletes } = await appDatabase();
    const ctx = context();
    await rosterImportScreen().mount(ctx);

    chooseFile(
      ctx.host,
      rosterFile(validAthleteRecord({ displayName: 'Good One' }), { displayName: 'Bad One' }),
    );

    await vi.waitFor(() => {
      expect(ctx.host.textContent).toContain('Preview');
    });

    expect(ctx.host.textContent).toContain('1 record parsed');
    expect(ctx.host.textContent).toContain('1 rejected');
    expect(await athletes.getAll()).toEqual([]);
  });

  it('shows each issue with its severity as readable text, not colour alone', async () => {
    await appDatabase();
    const ctx = context();
    await rosterImportScreen().mount(ctx);

    chooseFile(
      ctx.host,
      rosterFile(validAthleteRecord({ attributes: undefined }), validAthleteRecord({})),
    );

    await vi.waitFor(() => {
      expect(ctx.host.querySelector('.roster-import__issue')).not.toBeNull();
    });

    const issue = ctx.host.querySelector('.roster-import__issue')!;
    expect(issue.getAttribute('data-severity')).toBe('error');
    expect(issue.querySelector('.roster-import__issue-severity')?.textContent).toBe('Error');
  });

  it('shows a clamp warning as text when an attribute is out of range', async () => {
    await appDatabase();
    const ctx = context();
    await rosterImportScreen().mount(ctx);

    chooseFile(
      ctx.host,
      rosterFile(validAthleteRecord({ attributes: { ...FULL_ATTRIBUTES, speed: 500 } })),
    );

    await vi.waitFor(() => {
      expect(ctx.host.querySelector('.roster-import__issue')).not.toBeNull();
    });

    const issue = ctx.host.querySelector('.roster-import__issue')!;
    expect(issue.getAttribute('data-severity')).toBe('warning');
    expect(issue.querySelector('.roster-import__issue-severity')?.textContent).toBe('Warning');
  });

  it('writes nothing until Import is pressed, then writes exactly the previewed records', async () => {
    const { athletes } = await appDatabase();
    const ctx = context();
    await rosterImportScreen().mount(ctx);

    chooseFile(ctx.host, rosterFile(validAthleteRecord({ displayName: 'New Athlete' })));
    await vi.waitFor(() => expect(ctx.host.textContent).toContain('Preview'));
    expect(await athletes.getAll()).toEqual([]);

    const importButton = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Import',
    )!;
    expect(importButton.hasAttribute('disabled')).toBe(false);
    importButton.click();

    await vi.waitFor(async () => {
      expect(await athletes.getAll()).toHaveLength(1);
    });
    const [saved] = await athletes.getAll();
    expect(saved?.displayName).toBe('New Athlete');
    expect(saved?.source).toBe('import');

    await vi.waitFor(() => {
      expect(ctx.host.textContent).toContain('Import complete');
    });
  });

  it('disables Import when nothing parsed is left to write', async () => {
    await appDatabase();
    const ctx = context();
    await rosterImportScreen().mount(ctx);

    chooseFile(ctx.host, rosterFile({ displayName: 'Missing everything else' }));
    await vi.waitFor(() => expect(ctx.host.textContent).toContain('1 rejected'));

    const importButton = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Import',
    )!;
    expect(importButton.hasAttribute('disabled')).toBe(true);
  });

  it('prompts on a conflicting custodyId and defaults to skipping it', async () => {
    const { athletes } = await appDatabase();
    const existing = athlete({
      id: 'existing-1',
      custodyId: 'shared-custody',
      displayName: 'Original',
    });
    await athletes.put(existing);

    const ctx = context();
    await rosterImportScreen().mount(ctx);

    // The file cannot spell out a custodyId (`05` §8 does not expose one), so this exercises the
    // other conflict path instead: identical displayName + primarySport.
    chooseFile(
      ctx.host,
      rosterFile(
        validAthleteRecord({ displayName: 'Original', primarySport: existing.primarySport }),
      ),
    );

    await vi.waitFor(() => {
      expect(ctx.host.textContent).toContain('Resolve conflicts');
    });
    expect(ctx.host.textContent).toContain('0 will be written');

    const importButton = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Import',
    )!;
    expect(importButton.hasAttribute('disabled')).toBe(true);
  });

  it('replaces the existing record in place when the conflict is resolved to Replace', async () => {
    const { athletes } = await appDatabase();
    const existing = athlete({
      id: 'existing-1',
      custodyId: 'existing-custody',
      displayName: 'Original',
      primarySport: 'basketball',
    });
    await athletes.put(existing);

    const ctx = context();
    await rosterImportScreen().mount(ctx);

    chooseFile(
      ctx.host,
      rosterFile(validAthleteRecord({ displayName: 'Original', primarySport: 'basketball' })),
    );
    await vi.waitFor(() => expect(ctx.host.textContent).toContain('Resolve conflicts'));

    const replaceInput = [
      ...ctx.host.querySelectorAll<HTMLInputElement>('input[type="radio"][value="replace"]'),
    ][0]!;
    replaceInput.checked = true;
    replaceInput.dispatchEvent(new Event('change'));

    expect(ctx.host.textContent).toContain('1 will be written');

    const importButton = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Import',
    )!;
    importButton.click();

    await vi.waitFor(async () => {
      const all = await athletes.getAll();
      expect(all).toHaveLength(1);
    });
    const [saved] = await athletes.getAll();
    expect(saved?.id).toBe('existing-1');
    expect(saved?.source).toBe('import');
  });

  it('fetches a typed URL and previews what it returns', async () => {
    await appDatabase();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(rosterFile(validAthleteRecord({ displayName: 'From URL' }))),
      }),
    );

    const ctx = context();
    await rosterImportScreen().mount(ctx);

    const urlInput = ctx.host.querySelector<HTMLInputElement>('#roster-import-url')!;
    urlInput.value = 'https://example.com/roster.json';
    urlInput.dispatchEvent(new Event('input'));

    const fetchButton = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Fetch',
    )!;
    fetchButton.click();

    await vi.waitFor(() => expect(ctx.host.textContent).toContain('Preview'));
    expect(fetch).toHaveBeenCalledWith('https://example.com/roster.json');
  });

  it('shows a plain message when fetching a URL fails outright (offline, bad address, or CORS)', async () => {
    await appDatabase();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const ctx = context();
    await rosterImportScreen().mount(ctx);

    const urlInput = ctx.host.querySelector<HTMLInputElement>('#roster-import-url')!;
    urlInput.value = 'https://example.com/roster.json';
    urlInput.dispatchEvent(new Event('input'));
    [...ctx.host.querySelectorAll('button')].find((b) => b.textContent === 'Fetch')!.click();

    await vi.waitFor(() => {
      expect(ctx.host.textContent).toContain('Could not reach that URL');
    });
  });

  it('shows a plain message when the URL responds with an HTTP error', async () => {
    await appDatabase();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') }),
    );

    const ctx = context();
    await rosterImportScreen().mount(ctx);

    const urlInput = ctx.host.querySelector<HTMLInputElement>('#roster-import-url')!;
    urlInput.value = 'https://example.com/missing.json';
    urlInput.dispatchEvent(new Event('input'));
    [...ctx.host.querySelectorAll('button')].find((b) => b.textContent === 'Fetch')!.click();

    await vi.waitFor(() => {
      expect(ctx.host.textContent).toContain('HTTP 404');
    });
  });

  it('asks for a URL before trying to fetch nothing', async () => {
    await appDatabase();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const ctx = context();
    await rosterImportScreen().mount(ctx);

    [...ctx.host.querySelectorAll('button')].find((b) => b.textContent === 'Fetch')!.click();

    expect(ctx.host.textContent).toContain('Type a URL first');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('navigates to the squad from the "Import complete" state', async () => {
    await appDatabase();
    const navigate = vi.fn();
    const ctx = context(navigate);
    await rosterImportScreen().mount(ctx);

    chooseFile(ctx.host, rosterFile(validAthleteRecord()));
    await vi.waitFor(() => expect(ctx.host.textContent).toContain('Preview'));
    [...ctx.host.querySelectorAll('button')].find((b) => b.textContent === 'Import')!.click();
    await vi.waitFor(() => expect(ctx.host.textContent).toContain('Import complete'));

    [...ctx.host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Go to your squad')!
      .click();
    expect(navigate).toHaveBeenCalledWith('/squad');
  });
});
