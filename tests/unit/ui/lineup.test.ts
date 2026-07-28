/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.12 — Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best
 * @story   US-6.2 — Set a lineup
 * @design  10-ui-ux.md §10, §11
 *
 * Purpose: the screen's own behaviour — tap-to-place, auto-fill, persistence, and the states `10`
 * §10 says are usually forgotten. The fit arithmetic is tested in `tests/unit/teams/lineup.test.ts`;
 * this is about whether a person can actually set a lineup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lineupScreen } from '../../../src/ui/screens/lineup.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../src/storage/migrations.ts';
import type { Team } from '../../../src/teams/types.ts';
import { athlete, attributes } from '../../helpers/athletes.ts';

const NOW = Date.UTC(2026, 6, 28);

function team(id = 't1'): Team {
  return {
    id,
    schemaVersion: 1,
    name: 'Riverside',
    shortName: 'RIV',
    colours: { primary: '#2f4858', secondary: '#f2ede4' },
    crestId: 'shield',
    createdAt: 1,
    editable: true,
  };
}

function context(teamId = 't1', sport = 'basketball', navigate = vi.fn()) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  return { host, params: { id: teamId, sport }, query: {}, navigate };
}

async function seed(): Promise<void> {
  const db = await appDatabase();
  await db.teams.put(team());
  await db.athletes.putMany([
    athlete({
      id: 'g1',
      displayName: 'Guard One',
      heightCm: 183,
      attributes: attributes(45, { coordination: 92, accuracy: 88, awareness: 88, agility: 90 }),
    }),
    athlete({
      id: 'g2',
      displayName: 'Guard Two',
      heightCm: 185,
      attributes: attributes(45, { coordination: 88, accuracy: 86, awareness: 84, agility: 86 }),
    }),
    athlete({ id: 'g3', displayName: 'Wing', heightCm: 198, attributes: attributes(50) }),
    athlete({
      id: 'b1',
      displayName: 'Forward',
      heightCm: 206,
      attributes: attributes(45, { strength: 88, vertical: 86 }),
    }),
    athlete({
      id: 'b2',
      displayName: 'Centre',
      heightCm: 214,
      weightKg: 118,
      attributes: attributes(45, { strength: 94, vertical: 92 }),
    }),
  ]);
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('the lineup editor', () => {
  it('draws a slot for every position the sport declares', async () => {
    await seed();
    const ctx = context();
    await lineupScreen().mount(ctx);

    const slots = ctx.host.querySelectorAll('.lineup__slot');
    expect(slots).toHaveLength(5);
    expect([...slots].map((s) => (s as HTMLElement).dataset.slot)).toEqual([
      'PG',
      'SG',
      'SF',
      'PF',
      'C',
    ]);
  });

  it('makes every slot a real button, so a keyboard and a screen reader both work', async () => {
    await seed();
    const ctx = context();
    await lineupScreen().mount(ctx);

    for (const slot of ctx.host.querySelectorAll('.lineup__slot')) {
      expect(slot.tagName).toBe('BUTTON');
      expect(slot.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('fills the lineup with the strongest legal side and persists it (US-6.2)', async () => {
    await seed();
    const ctx = context();
    await lineupScreen().mount(ctx);

    const autofill = [...ctx.host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Auto-fill best',
    );
    autofill?.click();
    await Promise.resolve();

    const filled = [...ctx.host.querySelectorAll('.lineup__slot')].filter(
      (s) => (s as HTMLElement).dataset.empty === 'false',
    );
    expect(filled).toHaveLength(5);
    expect(ctx.host.textContent).toContain('Centre');

    const db = await appDatabase();
    const squad = await db.teams.squad('t1', 'basketball');
    expect(Object.keys(squad?.starters ?? {})).toHaveLength(5);
  });

  it('places an athlete by tapping them and then tapping a slot', async () => {
    await seed();
    const ctx = context();
    await lineupScreen().mount(ctx);

    const pick = [...ctx.host.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Centre'),
    );
    pick?.click();

    const slot = ctx.host.querySelector('.lineup__slot[data-slot="C"]') as HTMLElement;
    slot.click();
    await Promise.resolve();

    const filled = ctx.host.querySelector('.lineup__slot[data-slot="C"]') as HTMLElement;
    expect(filled.dataset.empty).toBe('false');
    expect(filled.textContent).toContain('Centre');
  });

  it('warns when someone is out of position without blocking it (`05` §3.4)', async () => {
    await seed();
    const ctx = context();
    await lineupScreen().mount(ctx);

    // Put the centre at point guard, which is exactly what the warning exists for.
    const pick = [...ctx.host.querySelectorAll('button')].find((b) =>
      b.textContent?.startsWith('Centre'),
    );
    pick?.click();
    (ctx.host.querySelector('.lineup__slot[data-slot="PG"]') as HTMLElement).click();
    await Promise.resolve();

    const slot = ctx.host.querySelector('.lineup__slot[data-slot="PG"]') as HTMLElement;
    expect(slot.dataset.warn).toBe('true');
    // Words, not only a colour (`10` §11).
    expect(slot.textContent).toContain('Out of position');
  });

  it('reports how many slots are still empty', async () => {
    await seed();
    const ctx = context();
    await lineupScreen().mount(ctx);
    expect(ctx.host.querySelector('[role="status"]')?.textContent).toContain('5 slots still empty');
  });

  it('clears the lineup', async () => {
    await seed();
    const ctx = context();
    await lineupScreen().mount(ctx);

    [...ctx.host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Auto-fill best')
      ?.click();
    await Promise.resolve();

    [...ctx.host.querySelectorAll('button')].find((b) => b.textContent === 'Clear lineup')?.click();
    await Promise.resolve();

    expect(ctx.host.querySelector('[role="status"]')?.textContent).toContain('5 slots still empty');
  });

  it('says plainly that an unavailable athlete cannot play (US-6.3)', async () => {
    await seed();
    const db = await appDatabase();
    const hurt = await db.athletes.get('b2');
    await db.athletes.put({
      ...hurt!,
      condition: { stamina: 100, injuredUntil: Date.now() + 3 * 24 * 60 * 60 * 1000 },
    });

    const ctx = context();
    await lineupScreen().mount(ctx);
    expect(ctx.host.textContent).toContain('Injured');
  });

  it('offers a way out for a sport that cannot be played yet', async () => {
    await seed();
    const navigate = vi.fn();
    const ctx = context('t1', 'soccer', navigate);
    await lineupScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('No lineups for that sport yet');
    (ctx.host.querySelector('button, a') as HTMLElement | null)?.click();
    expect(navigate).toHaveBeenCalledWith('/squad/teams');
  });

  it('offers a way out when the team is gone (`10` §10)', async () => {
    await appDatabase();
    const navigate = vi.fn();
    const ctx = context('ghost', 'basketball', navigate);
    await lineupScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('No such team');
    (ctx.host.querySelector('button, a') as HTMLElement | null)?.click();
    expect(navigate).toHaveBeenCalledWith('/squad/teams');
  });

  it('points at athlete creation when there is nobody to pick (`10` §10)', async () => {
    const db = await appDatabase();
    await db.teams.put(team());

    const navigate = vi.fn();
    const ctx = context('t1', 'basketball', navigate);
    await lineupScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('No athletes to pick from');
    (ctx.host.querySelector('button, a') as HTMLElement | null)?.click();
    expect(navigate).toHaveBeenCalledWith('/squad/athlete/new');
  });

  it('says the roster could not be opened, and that nothing was lost', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    const ctx = context();
    await lineupScreen().mount(ctx);
    expect(ctx.host.querySelector('[role="alert"]')?.textContent).toContain(
      'Nothing has been changed or lost',
    );
  });

  it('reloads a lineup that was already saved', async () => {
    await seed();
    const db = await appDatabase();
    await db.teams.putSquad({
      id: 't1:basketball',
      teamId: 't1',
      sportId: 'basketball',
      starters: { PG: 'g1', SG: 'g2', SF: 'g3', PF: 'b1', C: 'b2' },
      bench: [],
      updatedAt: NOW,
    });

    const ctx = context();
    await lineupScreen().mount(ctx);
    expect(ctx.host.querySelector('[role="status"]')?.textContent).toContain('Ready');
  });
});
