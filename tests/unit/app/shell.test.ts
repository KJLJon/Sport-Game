/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  10-ui-ux.md §4 (layout), §7 (screen map), §11 (accessibility)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router, type RouteDefinition } from '../../../src/app/router.ts';
import { AppShell, type TabDefinition } from '../../../src/app/shell.ts';
import type { Screen, ScreenDefinition } from '../../../src/app/screen.ts';

const TABS: readonly TabDefinition[] = [
  { id: 'play', label: 'Play', path: '/play', icon: 'M0 0h1v1H0z' },
  { id: 'squad', label: 'Squad', path: '/squad', icon: 'M0 0h1v1H0z' },
];

function tracked(text: string): { screen: Screen; unmounted: () => number } {
  let unmounts = 0;
  return {
    screen: {
      mount({ host }) {
        const p = host.ownerDocument.createElement('p');
        p.textContent = text;
        host.replaceChildren(p);
      },
      unmount() {
        unmounts += 1;
      },
    },
    unmounted: () => unmounts,
  };
}

describe('AppShell', () => {
  let root: HTMLDivElement;
  let shell: AppShell | null = null;

  beforeEach(() => {
    window.location.hash = '#/';
    root = document.createElement('div');
    document.body.replaceChildren(root);
  });

  afterEach(() => {
    shell?.stop();
    shell = null;
  });

  function mountShell(routes: readonly RouteDefinition<ScreenDefinition>[]): AppShell {
    const router = new Router<ScreenDefinition>({ routes, fallbackPath: '/' });
    const instance = new AppShell({ root, router, tabs: TABS, window });
    instance.start();
    shell = instance;
    return instance;
  }

  it('renders the chrome: header, main, tabs, live region, and skip link', () => {
    mountShell([
      { pattern: '/', value: { id: 'home', title: 'Home', load: () => tracked('h').screen } },
    ]);

    expect(root.querySelector('.shell__header')).not.toBeNull();
    expect(root.querySelector('main.shell__main')).not.toBeNull();
    // The bar is the shared `.tab-bar` component (T-9.1); the shell only places it.
    expect(root.querySelector('.tab-bar.shell__tabs')).not.toBeNull();
    expect(root.querySelectorAll('.tab-bar__tab')).toHaveLength(2);
    expect(root.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(root.querySelector('.shell__skip')?.getAttribute('href')).toBe('#main');
  });

  it('mounts the matched screen and shows its title', async () => {
    mountShell([
      {
        pattern: '/',
        value: { id: 'home', title: 'Sport-Game', load: () => tracked('home').screen },
      },
    ]);
    await vi.waitFor(() => expect(root.querySelector('.shell__main')?.textContent).toBe('home'));
    expect(root.querySelector('.shell__title')?.textContent).toBe('Sport-Game');
  });

  it('unmounts the previous screen before mounting the next', async () => {
    const home = tracked('home');
    const play = tracked('play');
    mountShell([
      { pattern: '/', value: { id: 'home', title: 'Home', load: () => home.screen } },
      { pattern: '/play', value: { id: 'play', title: 'Play', load: () => play.screen } },
    ]);
    await vi.waitFor(() => expect(root.querySelector('.shell__main')?.textContent).toBe('home'));

    window.location.hash = '#/play';
    await vi.waitFor(() => expect(root.querySelector('.shell__main')?.textContent).toBe('play'));

    expect(home.unmounted()).toBe(1);
  });

  it('marks the active tab with aria-current, including nested paths', async () => {
    mountShell([
      { pattern: '/', value: { id: 'home', title: 'Home', load: () => tracked('h').screen } },
      {
        pattern: '/play/live',
        value: { id: 'live', title: 'Live', load: () => tracked('l').screen },
      },
    ]);

    window.location.hash = '#/play/live';
    await vi.waitFor(() => expect(root.querySelector('.shell__main')?.textContent).toBe('l'));

    const playTab = root.querySelector('a[data-path="/play"]');
    const squadTab = root.querySelector('a[data-path="/squad"]');
    expect(playTab?.getAttribute('aria-current')).toBe('page');
    expect(squadTab?.getAttribute('aria-current')).toBe('false');
  });

  it('applies bare chrome so a Live match owns the whole viewport', async () => {
    mountShell([
      { pattern: '/', value: { id: 'home', title: 'Home', load: () => tracked('h').screen } },
      {
        pattern: '/play/live',
        value: { id: 'live', title: 'Live', chrome: 'bare', load: () => tracked('l').screen },
      },
    ]);

    window.location.hash = '#/play/live';
    await vi.waitFor(() => expect(root.querySelector('.shell__main')?.textContent).toBe('l'));

    expect(root.querySelector('.shell')?.getAttribute('data-chrome')).toBe('bare');
  });

  it('drops a slow screen whose route was superseded while it loaded', async () => {
    let release: (screen: Screen) => void = () => {};
    const slow = new Promise<Screen>((resolve) => {
      release = resolve;
    });
    const fast = tracked('fast');

    mountShell([
      { pattern: '/', value: { id: 'slow', title: 'Slow', load: () => slow } },
      { pattern: '/play', value: { id: 'fast', title: 'Fast', load: () => fast.screen } },
    ]);

    window.location.hash = '#/play';
    await vi.waitFor(() => expect(root.querySelector('.shell__main')?.textContent).toBe('fast'));

    release(tracked('slow').screen);
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector('.shell__main')?.textContent).toBe('fast');
  });

  it('announces into the live region for screen readers', () => {
    const instance = mountShell([
      { pattern: '/', value: { id: 'home', title: 'Home', load: () => tracked('h').screen } },
    ]);

    instance.announce('Basket. 12 to 10.');

    expect(root.querySelector('[aria-live="polite"]')?.textContent).toBe('Basket. 12 to 10.');
  });

  it('shows the rotate prompt when a landscape screen opens on a portrait device', async () => {
    // jsdom reports 1024x768; force portrait for this assertion.
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(400);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(900);

    mountShell([
      { pattern: '/', value: { id: 'home', title: 'Home', load: () => tracked('h').screen } },
      {
        pattern: '/play/live',
        value: {
          id: 'live',
          title: 'Live',
          orientation: 'landscape',
          load: () => tracked('l').screen,
        },
      },
    ]);

    window.location.hash = '#/play/live';
    await vi.waitFor(() => expect(root.querySelector('.shell__main')?.textContent).toBe('l'));

    const rotate = root.querySelector<HTMLElement>('.shell__rotate');
    expect(rotate?.hidden).toBe(false);
    expect(rotate?.textContent).toMatch(/sideways/i);
    vi.restoreAllMocks();
  });

  it('offers a way home rather than a dead end on an unroutable hash', async () => {
    mountShell([
      { pattern: '/play', value: { id: 'play', title: 'Play', load: () => tracked('p').screen } },
    ]);

    await vi.waitFor(() => expect(root.querySelector('.empty-state')).not.toBeNull());
    expect(root.querySelector('.empty-state a')?.getAttribute('href')).toBe('#/');
  });
});
