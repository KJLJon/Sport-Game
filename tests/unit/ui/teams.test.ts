/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.11 — Teams: create/edit, name, colours, generic crests
 * @story   US-6.1 — Build a team
 * @design  10-ui-ux.md §7 (screen map), §10 (states that are usually forgotten), §11 (accessibility)
 *
 * Purpose: the team list and the team editor. The cases that matter are the ones `10` §10 calls
 * out by name — empty, loading, and an unreadable database — plus the two things this task is
 * actually about: deleting a team takes its squads with it and offers a real undo, and a CPU team
 * is refused rather than silently opened for editing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { teamsScreen } from '../../../src/ui/screens/teams.ts';
import { teamEditorScreen } from '../../../src/ui/screens/team-editor.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../src/storage/migrations.ts';
import {
  CREST_IDS,
  TEAM_PALETTES,
  newSquad,
  squadKey,
  type Squad,
  type Team,
} from '../../../src/teams/types.ts';

function team(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    schemaVersion: 1,
    name: `Team ${id}`,
    shortName: id.slice(0, 3).toUpperCase(),
    colours: TEAM_PALETTES[0]!.colours,
    crestId: 'shield',
    createdAt: 1,
    editable: true,
    ...overrides,
  };
}

function squad(teamId: string, sportId: string, overrides: Partial<Squad> = {}): Squad {
  return { ...newSquad(teamId, sportId, 1), ...overrides, id: squadKey(teamId, sportId) };
}

function context(params: Record<string, string> = {}, navigate = vi.fn()) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  return { host, params, query: {}, navigate };
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('the teams screen', () => {
  it('offers exactly one action when there are no teams yet (`10` §10)', async () => {
    await appDatabase();
    const navigate = vi.fn();
    const ctx = context({}, navigate);
    await teamsScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('No teams yet');
    const actions = ctx.host.querySelectorAll('.empty-state button, .empty-state a');
    expect(actions.length).toBe(1);
    (actions[0] as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith('/squad/teams/new');
  });

  it('shows a team with its crest, short name, and "no lineup yet" for an empty squad', async () => {
    const { teams } = await appDatabase();
    await teams.put(team('t1', { name: 'River City', shortName: 'RVR' }));

    const ctx = context();
    await teamsScreen().mount(ctx);

    expect(ctx.host.querySelector('.teams-list__item svg[role="img"]')).not.toBeNull();
    expect(ctx.host.textContent).toContain('River City');
    expect(ctx.host.textContent).toContain('RVR');
    expect(ctx.host.textContent).toContain('Basketball: No lineup yet');
  });

  it('reports a full, valid lineup as ready', async () => {
    const { teams } = await appDatabase();
    await teams.put(team('t1'));
    await teams.putSquad(
      squad('t1', 'basketball', {
        starters: { PG: 'a', SG: 'b', SF: 'c', PF: 'd', C: 'e' },
      }),
    );

    const ctx = context();
    await teamsScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('Basketball: 5 of 5 — ready');
  });

  it('marks a CPU team so it reads differently from one the player can edit', async () => {
    const { teams } = await appDatabase();
    await teams.put(team('cpu1', { editable: false }));

    const ctx = context();
    await teamsScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('CPU team');
  });

  it('navigates to the editor for the tapped team', async () => {
    const { teams } = await appDatabase();
    await teams.put(team('t1', { name: 'River City' }));

    const navigate = vi.fn();
    const ctx = context({}, navigate);
    await teamsScreen().mount(ctx);

    const editButton = [...ctx.host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Edit'),
    );
    editButton?.click();
    expect(navigate).toHaveBeenCalledWith('/squad/teams/t1');
  });

  it('deletes a team and its squads together, and undo brings both back', async () => {
    const { teams } = await appDatabase();
    await teams.put(team('t1', { name: 'River City' }));
    await teams.putSquad(squad('t1', 'basketball', { starters: { PG: 'a' } }));

    const ctx = context();
    await teamsScreen().mount(ctx);

    const deleteButton = [...ctx.host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Delete'),
    );
    deleteButton?.click();

    const confirm = [...ctx.host.querySelectorAll<HTMLButtonElement>('.dialog button')].find(
      (b) => b.textContent === 'Delete',
    );
    expect(confirm).toBeDefined();
    confirm?.click();

    await vi.waitFor(() => expect(ctx.host.textContent).toContain('No teams yet'));
    expect(await teams.get('t1')).toBeUndefined();
    expect(await teams.squad('t1', 'basketball')).toBeUndefined();

    const undo = await vi.waitFor(() => {
      const found = [...ctx.host.querySelectorAll('button')].find((b) => b.textContent === 'Undo');
      if (found === undefined) throw new Error('undo button not rendered yet');
      return found;
    });
    undo.click();

    await vi.waitFor(() => expect(ctx.host.textContent).toContain('River City'));
    expect(await teams.get('t1')).toBeDefined();
    expect(await teams.squad('t1', 'basketball')).toBeDefined();
  });

  it('says the database could not be opened, and that nothing was lost', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    const ctx = context();
    await teamsScreen().mount(ctx);

    const alert = ctx.host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('Nothing has been changed or lost');
  });
});

describe('the team editor', () => {
  it('offers every palette by name, not just a swatch (`10` §11)', async () => {
    await appDatabase();
    const ctx = context();
    await teamEditorScreen().mount(ctx);

    const options = ctx.host.querySelectorAll('.palette-option');
    expect(options.length).toBe(TEAM_PALETTES.length);
    for (const palette of TEAM_PALETTES) {
      expect(ctx.host.textContent).toContain(palette.name);
    }
  });

  it('offers every crest shape, rendered live', async () => {
    await appDatabase();
    const ctx = context();
    await teamEditorScreen().mount(ctx);

    const options = ctx.host.querySelectorAll('.crest-option');
    expect(options.length).toBe(CREST_IDS.length);
    expect(ctx.host.querySelectorAll('.crest-option svg[role="img"]').length).toBe(
      CREST_IDS.length,
    );
  });

  it('refuses to save a short name outside 2–4 characters', async () => {
    await appDatabase();
    const ctx = context();
    await teamEditorScreen().mount(ctx);

    const shortName = ctx.host.querySelector('#team-editor-short-name') as HTMLInputElement;
    shortName.value = 'X';
    shortName.dispatchEvent(new Event('input'));

    const save = [...ctx.host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Create team'),
    );
    save?.click();
    await Promise.resolve();

    expect(ctx.host.querySelector('[role="alert"]')?.textContent).toContain('2 to 4');
  });

  it('creates a team from the form and returns to the list', async () => {
    const { teams } = await appDatabase();
    const navigate = vi.fn();
    const ctx = context({}, navigate);
    await teamEditorScreen().mount(ctx);

    const name = ctx.host.querySelector('#team-editor-name') as HTMLInputElement;
    name.value = 'River City';
    name.dispatchEvent(new Event('input'));

    const shortName = ctx.host.querySelector('#team-editor-short-name') as HTMLInputElement;
    shortName.value = 'rvr';
    shortName.dispatchEvent(new Event('input'));

    const starOption = ctx.host.querySelector(
      '.crest-option__input[value="star"]',
    ) as HTMLInputElement;
    starOption.click();

    const save = [...ctx.host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Create team'),
    );
    save?.click();
    await Promise.resolve();
    await Promise.resolve();

    const saved = (await teams.getAll())[0];
    expect(saved?.name).toBe('River City');
    expect(saved?.shortName).toBe('RVR');
    expect(saved?.crestId).toBe('star');
    expect(saved?.editable).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/squad/teams');
  });

  it('loads an existing editable team and saves over the same id', async () => {
    const { teams } = await appDatabase();
    await teams.put(team('t1', { name: 'River City', shortName: 'RVR', crestId: 'circle' }));

    const navigate = vi.fn();
    const ctx = context({ id: 't1' }, navigate);
    await teamEditorScreen().mount(ctx);

    expect((ctx.host.querySelector('#team-editor-name') as HTMLInputElement).value).toBe(
      'River City',
    );

    const save = [...ctx.host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Save team'),
    );
    save?.click();
    await Promise.resolve();
    await Promise.resolve();

    const all = await teams.getAll();
    expect(all.length).toBe(1);
    expect(all[0]?.id).toBe('t1');
    expect(navigate).toHaveBeenCalledWith('/squad/teams');
  });

  it('offers a way back when the team is gone rather than a blank screen (`10` §10)', async () => {
    await appDatabase();
    const navigate = vi.fn();
    const ctx = context({ id: 'missing' }, navigate);
    await teamEditorScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('No such team');
    (ctx.host.querySelector('button, a') as HTMLElement | null)?.click();
    expect(navigate).toHaveBeenCalledWith('/squad/teams');
  });

  it('refuses to open a CPU team for editing, in plain language', async () => {
    const { teams } = await appDatabase();
    await teams.put(team('cpu1', { name: 'The Comets', editable: false }));

    const ctx = context({ id: 'cpu1' });
    await teamEditorScreen().mount(ctx);

    expect(ctx.host.textContent).toContain("can't be edited");
    expect(ctx.host.querySelector('#team-editor-name')).toBeNull();
  });

  it('says the database could not be opened, and that nothing was lost', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    const ctx = context();
    await teamEditorScreen().mount(ctx);

    const alert = ctx.host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('Nothing has been changed or lost');
  });
});
