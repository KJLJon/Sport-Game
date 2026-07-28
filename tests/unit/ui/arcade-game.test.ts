/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.3 — Arcade hub and the run screen
 * @task    T-4.12 — Arcade accessibility: left-hand mirroring, colour-independent meters, reduced motion
 * @story   US-16.1 — Play a quick skill game
 * @design  10-ui-ux.md §7 (screen map), §11 (accessibility)
 *
 * Purpose: the run screen's own job — mounting a run, delivering one button to it, saying what is
 * happening in words, and filing the result. jsdom has no canvas context and no animation frames,
 * so this asserts on the DOM the screen builds rather than on pixels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arcadeGameScreen } from '../../../src/ui/screens/arcade-game.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { deleteDatabase } from '../../../src/storage/idb.ts';
import { athlete } from '../../helpers/athletes.ts';

// jsdom has no 2D context and logs loudly when asked for one. The screen already treats `null` as
// "draw nothing"; stubbing it here keeps the suite's output about failures rather than about jsdom.
HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext'];

function context(params: Record<string, string>, query: Record<string, string> = {}) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  return { host, params, query, navigate: vi.fn() };
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
  const { athletes } = await appDatabase();
  await athletes.put(athlete({ id: 'a1', displayName: 'Ada' }));
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('the run screen', () => {
  it('opens on the prompt, the window hint, and one thing to do', async () => {
    const ctx = context({ id: 'bball.free-throw' }, { athlete: 'a1' });
    const screen = arcadeGameScreen();
    await screen.mount(ctx);

    const overlay = ctx.host.querySelector('.arcade-run__overlay');
    expect(overlay?.textContent).toContain('Tap when the marker hits the band');
    expect(overlay?.textContent).toMatch(/window —/);
    expect(overlay?.textContent).toContain('Tap anywhere to start');
    screen.unmount?.();
  });

  it('gives the whole stage a labelled button rather than a bare canvas (10 §11)', async () => {
    const ctx = context({ id: 'bball.pickpocket' }, { athlete: 'a1' });
    const screen = arcadeGameScreen();
    await screen.mount(ctx);

    const tap = ctx.host.querySelector('.arcade-run__tap');
    expect(tap?.tagName).toBe('BUTTON');
    expect(tap?.getAttribute('aria-label')).toContain('Pickpocket');
    screen.unmount?.();
  });

  it('says the score, the lives, and the streak in words', async () => {
    const ctx = context({ id: 'bball.free-throw' }, { athlete: 'a1' });
    const screen = arcadeGameScreen();
    await screen.mount(ctx);

    const hud = ctx.host.querySelector('.arcade-run__hud');
    expect(hud?.textContent).toContain('Score');
    expect(hud?.textContent).toContain('Lives');
    expect(hud?.textContent).toContain('Streak');
    expect(hud?.querySelector('.star-rating')).not.toBeNull();
    screen.unmount?.();
  });

  it('announces the last outcome politely rather than only drawing it', async () => {
    const ctx = context({ id: 'bball.free-throw' }, { athlete: 'a1' });
    const screen = arcadeGameScreen();
    await screen.mount(ctx);

    // A tap starts the run, which swaps the overlay for the live-region outcome line.
    ctx.host.querySelector('.arcade-run__tap')?.dispatchEvent(new Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 40));

    const live = ctx.host.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    screen.unmount?.();
  });

  it('refuses a game this build does not have, rather than a blank screen', async () => {
    const ctx = context({ id: 'hockey.shootout' });
    await arcadeGameScreen().mount(ctx);
    expect(ctx.host.textContent).toContain('No such game');
  });

  it('explains an empty roster instead of throwing', async () => {
    const { athletes } = await appDatabase();
    await athletes.delete('a1');

    const ctx = context({ id: 'bball.free-throw' });
    await arcadeGameScreen().mount(ctx);
    expect(ctx.host.textContent).toContain('That run could not be set up');
  });

  it('falls back to a scored run for an unrecognised mode', async () => {
    const ctx = context({ id: 'bball.free-throw' }, { athlete: 'a1', mode: 'chaos' });
    const screen = arcadeGameScreen();
    await screen.mount(ctx);
    expect(ctx.host.querySelector('.arcade-run__hud')?.textContent).toContain('Lives');
    screen.unmount?.();
  });

  it('plays the daily challenge from the day, not from the query string', async () => {
    // Whichever game is today's, asking for a *different* one in daily mode must not produce a
    // daily-shaped run of the wrong game — it falls back to a plain scored run.
    const ctx = context({ id: 'bball.free-throw' }, { mode: 'daily' });
    const screen = arcadeGameScreen();
    await screen.mount(ctx);
    expect(ctx.host.querySelector('.arcade-run')).not.toBeNull();
    screen.unmount?.();
  });

  it('unmounts cleanly, twice if asked', async () => {
    const ctx = context({ id: 'bball.three-point' }, { athlete: 'a1' });
    const screen = arcadeGameScreen();
    await screen.mount(ctx);
    expect(() => {
      screen.unmount?.();
      screen.unmount?.();
    }).not.toThrow();
  });
});
