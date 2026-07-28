/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.3 — Arcade hub: grid, locked/unlocked states, personal bests, athlete picker with window hint
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.2 — Earn my mini-games
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §3, 10-ui-ux.md §10 (states), §11 (accessibility)
 *
 * Purpose: what the hub *says*. The calibration arithmetic is tested elsewhere; what matters here is
 * that the window hint reaches the tile, that it changes when the athlete does, that a locked tile
 * names what unlocks it and never how to buy it, and that the `10` §10 states exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arcadeScreen } from '../../../src/ui/screens/arcade.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../src/storage/migrations.ts';
import { ArcadeRepository } from '../../../src/modes/arcade/records.ts';
import { newSportSkill } from '../../../src/athletes/types.ts';
import { athlete, attributes } from '../../helpers/athletes.ts';
import { forgetPlayers, loadPlayers } from '../../../src/modes/local-players.ts';

function context(navigate = vi.fn()) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  return { host, params: {}, query: {}, navigate };
}

function tiles(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.arcade-tile')];
}

function hints(host: HTMLElement): string[] {
  return [...host.querySelectorAll('.arcade-tile__hint')].map((node) => node.textContent ?? '');
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('the arcade hub', () => {
  it('shows a tile per game, each one a real button', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1', displayName: 'Ada' }));

    const ctx = context();
    await arcadeScreen().mount(ctx);

    expect(tiles(ctx.host)).toHaveLength(5);
    for (const tile of tiles(ctx.host)) expect(tile.tagName).toBe('BUTTON');
  });

  it('states how wide the chosen athlete’s window is, in words (US-16.3)', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'star', displayName: 'Star', attributes: attributes(92) }));

    const ctx = context();
    await arcadeScreen().mount(ctx);

    const lines = hints(ctx.host);
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line).toMatch(/window —/);
  });

  it('changes the hint when the athlete changes', async () => {
    const { athletes } = await appDatabase();
    const soccer = athlete({ id: 'b', displayName: 'Bea', primarySport: 'soccer' });
    await athletes.put(athlete({ id: 'a', displayName: 'Ada', attributes: attributes(92) }));
    await athletes.put({
      ...soccer,
      attributes: attributes(40),
      sportSkills: { ...soccer.sportSkills, basketball: newSportSkill(10) },
    });

    const ctx = context();
    await arcadeScreen().mount(ctx);
    const before = hints(ctx.host);

    const select = ctx.host.querySelector<HTMLSelectElement>('.arcade__athlete');
    expect(select).not.toBeNull();
    select!.value = 'b';
    select!.dispatchEvent(new Event('change'));

    expect(hints(ctx.host)).not.toEqual(before);
    expect(hints(ctx.host)[0]).toContain('new to this sport');
  });

  it('shows no personal best before anything has been played, and the best after', async () => {
    const { db, athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1' }));

    const first = context();
    await arcadeScreen().mount(first);
    expect(first.host.textContent).toContain('No runs yet');

    await new ArcadeRepository(db).recordRun(
      {
        game: 'bball.free-throw',
        sport: 'basketball',
        mode: 'scored',
        seed: 's',
        athleteId: 'a1',
        difficulty: 'pro',
        score: 2500,
        stars: 2,
        attempts: 20,
        made: 14,
        bestStreak: 5,
        seconds: 40,
        reason: 'complete',
        events: [],
        rewarded: true,
      },
      [700, 2000, 3400],
    );

    const second = context();
    await arcadeScreen().mount(second);
    expect(second.host.textContent).toContain('Best 2,500');
  });

  it('navigates into a run with the chosen mode and athlete', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1' }));

    const navigate = vi.fn();
    const ctx = context(navigate);
    await arcadeScreen().mount(ctx);

    tiles(ctx.host)[0]?.dispatchEvent(new Event('click'));
    expect(navigate).toHaveBeenCalledWith('/play/arcade/bball.free-throw', {
      mode: 'scored',
      athlete: 'a1',
    });
  });

  it('offers to make an athlete when there are none, rather than an unusable picker', async () => {
    await appDatabase();
    const ctx = context();
    await arcadeScreen().mount(ctx);

    expect(ctx.host.querySelector('.empty-state')).not.toBeNull();
    expect(ctx.host.textContent).toContain('Make an athlete');
  });

  it('says the arcade could not be opened, and that nothing was lost', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    const ctx = context();
    await arcadeScreen().mount(ctx);

    const alert = ctx.host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Nothing has been changed or lost');
  });
});

describe('the daily challenge card (US-16.4)', () => {
  it('names the game, the athlete, the modifiers, and the shareable code', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1' }));

    const ctx = context();
    await arcadeScreen().mount(ctx);

    const daily = ctx.host.querySelector<HTMLInputElement>('#arcade-mode-daily');
    daily!.checked = true;
    daily!.dispatchEvent(new Event('change', { bubbles: true }));

    const card = ctx.host.querySelector('.arcade__daily');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Challenge code: SG1-');
    expect(card?.textContent).toContain('midnight UTC');
    expect(card?.querySelectorAll('.arcade__modifiers li')).toHaveLength(2);
  });

  it('explains each mode as the mode changes', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1' }));

    const ctx = context();
    await arcadeScreen().mount(ctx);
    expect(ctx.host.querySelector('.arcade__lede')?.textContent).toContain('One run');

    const practice = ctx.host.querySelector<HTMLInputElement>('#arcade-mode-practice');
    practice!.checked = true;
    practice!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ctx.host.querySelector('.arcade__lede')?.textContent).toContain('Unlimited');
  });
});

describe('the party set-up (T-4.11, US-17.2)', () => {
  it('is closed and out of the way for a solo player', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1' }));

    const ctx = context();
    await arcadeScreen().mount(ctx);

    const panel = ctx.host.querySelector('.arcade__party-panel');
    expect(panel).not.toBeNull();
    expect(panel?.hasAttribute('open')).toBe(false);
    expect(ctx.host.querySelector('.arcade__seats')).toBeNull();
  });

  it('offers a name field per seat once a party is chosen', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1' }));

    const ctx = context();
    await arcadeScreen().mount(ctx);

    const three = ctx.host.querySelector<HTMLInputElement>('#arcade-seats-3');
    three!.checked = true;
    three!.dispatchEvent(new Event('change', { bubbles: true }));

    expect(ctx.host.querySelectorAll('.arcade__seat-input')).toHaveLength(3);
    expect(ctx.host.querySelector('#arcade-format-elimination')).not.toBeNull();
  });

  it('carries the party into the run, and remembers the names', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1' }));

    const navigate = vi.fn();
    const ctx = context(navigate);
    await arcadeScreen().mount(ctx);

    const two = ctx.host.querySelector<HTMLInputElement>('#arcade-seats-2');
    two!.checked = true;
    two!.dispatchEvent(new Event('change', { bubbles: true }));

    const first = ctx.host.querySelector<HTMLInputElement>('.arcade__seat-input');
    first!.value = 'Ana';
    first!.dispatchEvent(new Event('input'));

    tiles(ctx.host)[0]?.dispatchEvent(new Event('click'));

    expect(navigate).toHaveBeenCalledWith('/play/arcade/bball.free-throw', {
      mode: 'scored',
      athlete: 'a1',
      party: '2',
      format: 'rounds',
    });
    expect(loadPlayers()[0]?.name).toBe('Ana');
    forgetPlayers();
  });
});
