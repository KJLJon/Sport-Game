/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.10 — Roster browser: search, sort, filter, bulk select
 * @story   US-5.5 — Edit and delete profiles
 * @design  10-ui-ux.md §7 (screen map), §10 (states that are usually forgotten), §11 (accessibility)
 *
 * Purpose: the roster screen's own job — wiring search, sort, filters, and bulk selection to the
 * DOM, and the `10` §10 states around it (empty roster, no-search-results, unreadable database).
 * The filtering and sorting arithmetic itself is `roster-query.test.ts`'s job; this file only has
 * to prove the screen calls it correctly and reacts to what comes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rosterScreen } from '../../../src/ui/screens/roster.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../src/storage/migrations.ts';
import { athlete } from '../../helpers/athletes.ts';

function context(navigate = vi.fn()) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  return { host, params: {}, query: {}, navigate };
}

function rowNames(host: HTMLElement): string[] {
  return [...host.querySelectorAll('.roster__row .athlete-card__name')].map(
    (node) => node.textContent ?? '',
  );
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('the roster screen', () => {
  it('shows a loading state before the roster resolves', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1', displayName: 'Ada' }));

    const ctx = context();
    const mounted = rosterScreen().mount(ctx);
    expect(ctx.host.querySelector('.skeleton')).not.toBeNull();
    await mounted;
  });

  it('says the roster could not be opened, and that nothing was lost', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    const ctx = context();
    await rosterScreen().mount(ctx);

    const alert = ctx.host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('Nothing has been changed or lost');
  });

  it('offers to create an athlete on an empty roster, distinct from a no-results empty state', async () => {
    await appDatabase();
    const navigate = vi.fn();
    const ctx = context(navigate);
    await rosterScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('No athletes yet');
    (ctx.host.querySelector('.empty-state button, .empty-state a') as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith('/squad/athlete/new');
  });

  it('lists every athlete, each linking to its card', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1', displayName: 'Ada' }));
    await athletes.put(athlete({ id: 'b1', displayName: 'Bea' }));

    const ctx = context();
    await rosterScreen().mount(ctx);

    expect(rowNames(ctx.host)).toEqual(['Ada', 'Bea']);
    const link = ctx.host.querySelector('.roster__row a.roster__card-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#/squad/athlete/a1');
  });

  it('filters as you search, and offers a distinct empty state for no matches', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1', displayName: 'Ada' }));
    await athletes.put(athlete({ id: 'b1', displayName: 'Bea' }));

    const ctx = context();
    await rosterScreen().mount(ctx);

    const search = ctx.host.querySelector('#roster-search') as HTMLInputElement;
    search.value = 'ada';
    search.dispatchEvent(new Event('input'));
    expect(rowNames(ctx.host)).toEqual(['Ada']);

    search.value = 'nobody-in-here';
    search.dispatchEvent(new Event('input'));
    expect(ctx.host.textContent).toContain('No matches');
    expect(ctx.host.textContent).not.toContain('No athletes yet');

    // Clearing filters from the no-results state gets the roster back.
    (ctx.host.querySelector('.empty-state button') as HTMLElement).click();
    expect(rowNames(ctx.host)).toEqual(['Ada', 'Bea']);
    expect(search.value).toBe('');
  });

  it('sorts by the chosen key and direction', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'z', displayName: 'Zed', createdAt: 1 }));
    await athletes.put(athlete({ id: 'a', displayName: 'Alba', createdAt: 3 }));
    await athletes.put(athlete({ id: 'm', displayName: 'Mona', createdAt: 2 }));

    const ctx = context();
    await rosterScreen().mount(ctx);

    // Default is name, ascending.
    expect(rowNames(ctx.host)).toEqual(['Alba', 'Mona', 'Zed']);

    const sortSelect = ctx.host.querySelector('#roster-sort') as HTMLSelectElement;
    sortSelect.value = 'recent';
    sortSelect.dispatchEvent(new Event('change'));
    expect(rowNames(ctx.host)).toEqual(['Zed', 'Mona', 'Alba']);

    const directionButton = [...ctx.host.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Sort'),
    ) as HTMLButtonElement;
    directionButton.click();
    expect(rowNames(ctx.host)).toEqual(['Alba', 'Mona', 'Zed']);
  });

  it('filters by primary sport', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'b1', displayName: 'Baller', primarySport: 'basketball' }));
    await athletes.put(athlete({ id: 's1', displayName: 'Kicker', primarySport: 'soccer' }));

    const ctx = context();
    await rosterScreen().mount(ctx);

    const soccerCheckbox = ctx.host.querySelector(
      '#roster-filter-sport-soccer',
    ) as HTMLInputElement;
    soccerCheckbox.checked = true;
    soccerCheckbox.dispatchEvent(new Event('change'));

    expect(rowNames(ctx.host)).toEqual(['Kicker']);
  });

  it('filters by rarity', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'c1', displayName: 'Common One', rarity: 'common' }));
    await athletes.put(athlete({ id: 'l1', displayName: 'Legend One', rarity: 'legendary' }));

    const ctx = context();
    await rosterScreen().mount(ctx);

    const legendaryCheckbox = ctx.host.querySelector(
      '#roster-filter-rarity-legendary',
    ) as HTMLInputElement;
    legendaryCheckbox.checked = true;
    legendaryCheckbox.dispatchEvent(new Event('change'));

    expect(rowNames(ctx.host)).toEqual(['Legend One']);
  });

  it('has an accessible name on every control', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1', displayName: 'Ada' }));

    const ctx = context();
    await rosterScreen().mount(ctx);

    const search = ctx.host.querySelector('#roster-search') as HTMLInputElement;
    expect(ctx.host.querySelector('label[for="roster-search"]')).not.toBeNull();
    expect(search).not.toBeNull();

    const sortSelect = ctx.host.querySelector('#roster-sort') as HTMLSelectElement;
    expect(ctx.host.querySelector('label[for="roster-sort"]')).not.toBeNull();
    expect(sortSelect).not.toBeNull();
  });

  describe('bulk select and delete', () => {
    it('selects athletes, deletes them after confirmation, and offers undo', async () => {
      const { athletes } = await appDatabase();
      await athletes.put(athlete({ id: 'a1', displayName: 'Ada' }));
      await athletes.put(athlete({ id: 'b1', displayName: 'Bea' }));

      const ctx = context();
      await rosterScreen().mount(ctx);

      // Enter selection mode.
      const selectButton = [...ctx.host.querySelectorAll('button')].find(
        (b) => b.textContent === 'Select',
      ) as HTMLButtonElement;
      selectButton.click();

      const rowCheckbox = ctx.host.querySelector(
        '.roster__row input[aria-label="Select Ada"]',
      ) as HTMLInputElement;
      expect(rowCheckbox).not.toBeNull();
      rowCheckbox.checked = true;
      rowCheckbox.dispatchEvent(new Event('change'));

      const liveCount = ctx.host.querySelector('.roster__selection-count') as HTMLElement;
      expect(liveCount.getAttribute('aria-live')).toBe('polite');
      expect(liveCount.textContent).toContain('1 selected');

      const deleteButton = [...ctx.host.querySelectorAll('.roster__selection-bar button')].find(
        (b) => (b.textContent ?? '').includes('Delete'),
      ) as HTMLButtonElement;
      expect(deleteButton.disabled).toBe(false);
      deleteButton.click();

      // Confirmation dialog appears, naming what will happen; cancel changes nothing.
      const dialogNode = document.querySelector('dialog') as HTMLDialogElement;
      expect(dialogNode).not.toBeNull();
      expect(dialogNode.textContent).toContain('Delete this athlete?');
      const cancelButton = [...dialogNode.querySelectorAll('button')].find(
        (b) => b.textContent === 'Cancel',
      ) as HTMLButtonElement;
      cancelButton.click();
      expect(rowNames(ctx.host)).toEqual(['Ada', 'Bea']);

      // Re-select and actually delete.
      const rowCheckboxAgain = ctx.host.querySelector(
        '.roster__row input[aria-label="Select Ada"]',
      ) as HTMLInputElement;
      rowCheckboxAgain.checked = true;
      rowCheckboxAgain.dispatchEvent(new Event('change'));
      const deleteButtonAgain = [
        ...ctx.host.querySelectorAll('.roster__selection-bar button'),
      ].find((b) => (b.textContent ?? '').includes('Delete')) as HTMLButtonElement;
      deleteButtonAgain.click();

      const confirmDialog = document.querySelector('dialog') as HTMLDialogElement;
      const confirmButton = [...confirmDialog.querySelectorAll('button')].find(
        (b) => b.textContent === 'Delete',
      ) as HTMLButtonElement;
      confirmButton.click();

      await vi.waitFor(() => {
        expect(rowNames(ctx.host)).toEqual(['Bea']);
      });
      expect(await athletes.get('a1')).toBeUndefined();

      // Undo restores it.
      const undoButton = [...ctx.host.querySelectorAll('.roster__toast-host button')].find(
        (b) => b.textContent === 'Undo',
      ) as HTMLButtonElement;
      expect(undoButton).not.toBeUndefined();
      undoButton.click();

      await vi.waitFor(() => {
        expect(rowNames(ctx.host)).toEqual(['Ada', 'Bea']);
      });
      expect(await athletes.get('a1')).not.toBeUndefined();
    });

    it('leaving selection mode clears the selection', async () => {
      const { athletes } = await appDatabase();
      await athletes.put(athlete({ id: 'a1', displayName: 'Ada' }));

      const ctx = context();
      await rosterScreen().mount(ctx);

      const selectButton = [...ctx.host.querySelectorAll('button')].find(
        (b) => b.textContent === 'Select',
      ) as HTMLButtonElement;
      selectButton.click();

      const rowCheckbox = ctx.host.querySelector(
        '.roster__row input[aria-label="Select Ada"]',
      ) as HTMLInputElement;
      rowCheckbox.checked = true;
      rowCheckbox.dispatchEvent(new Event('change'));
      expect(ctx.host.querySelector('.roster__selection-count')?.textContent).toContain('1');

      const cancelButton = [...ctx.host.querySelectorAll('button')].find(
        (b) => b.textContent === 'Cancel selection',
      ) as HTMLButtonElement;
      cancelButton.click();

      expect(ctx.host.querySelector('.roster__selection-bar')?.hasAttribute('hidden')).toBe(true);
      expect(ctx.host.querySelector('.roster__row input[type="checkbox"]')).toBeNull();
    });
  });
});
