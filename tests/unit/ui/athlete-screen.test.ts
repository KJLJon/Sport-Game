/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.8 — Athlete card component: compact + full, sport switcher, familiarity ring, "why this rating"
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @design  10-ui-ux.md §6, §10 (states that are usually forgotten)
 *
 * Purpose: the screen owns the three things the card does not — loading, the sport selection, and
 * `10` §10's usually-forgotten states. Those states are the point of this file: an athlete who is
 * not there, and a database this build cannot read, both have to say something useful.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { athleteScreen } from '../../../src/ui/screens/athlete.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../src/storage/migrations.ts';
import { athlete } from '../../helpers/athletes.ts';

function context(id: string, navigate = vi.fn()) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  return { host, params: { id }, query: {}, navigate };
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('the athlete screen', () => {
  it('shows the full card for an athlete that exists', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1', displayName: 'R. Example' }));

    const ctx = context('a1');
    await athleteScreen().mount(ctx);

    expect(ctx.host.querySelector('.athlete-card--full')).not.toBeNull();
    expect(ctx.host.textContent).toContain('R. Example');
  });

  it('re-renders to the chosen sport when the switcher changes (`10` §6)', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1', primarySport: 'basketball' }));

    const ctx = context('a1');
    await athleteScreen().mount(ctx);
    expect(ctx.host.querySelector('.athlete-card')?.getAttribute('data-sport')).toBe('basketball');

    const soccer = ctx.host.querySelector('input[value="soccer"]') as HTMLInputElement;
    soccer.click();

    expect(ctx.host.querySelector('.athlete-card')?.getAttribute('data-sport')).toBe('soccer');
    expect(ctx.host.textContent).toContain('Goalkeeping');
  });

  it('offers a way out when the athlete is gone rather than a blank screen (`10` §10)', async () => {
    await appDatabase();
    const navigate = vi.fn();
    const ctx = context('missing', navigate);
    await athleteScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('No such athlete');
    (ctx.host.querySelector('button, a') as HTMLElement | null)?.click();
    expect(navigate).toHaveBeenCalledWith('/squad');
  });

  it('says the roster could not be opened, and that nothing was lost', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    const ctx = context('a1');
    await athleteScreen().mount(ctx);

    const alert = ctx.host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('Nothing has been changed or lost');
  });
});
