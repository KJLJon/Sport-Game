/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell and screens, T-0.4 — Design tokens and primitives
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  10-ui-ux.md §2 (two taps to play), §7 (screen map), §11 (accessibility)
 *
 * Purpose: the component-state coverage `12` §2 requires of `src/ui/`, which the Phase-0 screens
 * never got — they were verified by E2E only, which left the coverage gate failing from Gate 0
 * onwards. Each screen is mounted into a detached host and checked for the structure the design
 * calls for, including the accessibility properties a screenshot cannot assert.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenContext } from '../../../src/app/screen.ts';
import { forgetPlay, rememberPlay } from '../../../src/modes/last-played.ts';
import { playMode } from '../../../src/modes/catalogue.ts';
import { homeScreen } from '../../../src/ui/screens/home.ts';
import { placeholderScreen } from '../../../src/ui/screens/placeholder.ts';
import { settingsScreen } from '../../../src/ui/screens/settings.ts';

function context(overrides: Partial<ScreenContext> = {}): ScreenContext & { host: HTMLElement } {
  const host = document.createElement('main');
  return {
    host,
    params: {},
    query: {},
    navigate: vi.fn(),
    ...overrides,
  } as ScreenContext & { host: HTMLElement };
}

describe('home screen', () => {
  beforeEach(() => {
    forgetPlay();
  });

  it('leads with a single primary action (`10` §2)', () => {
    const ctx = context();
    homeScreen().mount(ctx);

    const primaries = ctx.host.querySelectorAll('button.button--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toBe('Play');
  });

  it('navigates to the match flow rather than changing the hash itself', () => {
    const ctx = context();
    homeScreen().mount(ctx);

    ctx.host.querySelector<HTMLButtonElement>('.home__play')?.click();
    expect(ctx.navigate).toHaveBeenCalledWith('/play');
  });

  it('offers the secondary destinations as labelled navigation', () => {
    const ctx = context();
    homeScreen().mount(ctx);

    const nav = ctx.host.querySelector('nav.home__links');
    expect(nav?.getAttribute('aria-label')).toBe('More');

    const links = [...(nav?.querySelectorAll('a') ?? [])];
    expect(links.map((a) => a.textContent)).toEqual(['Squad', 'Settings']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/squad', '#/settings']);
  });

  // ── Quick Play (T-8.1, `10` §8.2) ──────────────────────────────────────────

  it('names the remembered match on the button, so one tap is never a surprise', () => {
    rememberPlay('soccer', playMode('live')!);

    const ctx = context();
    homeScreen().mount(ctx);

    expect(ctx.host.querySelector('.home__play')?.textContent).toBe('Quick Play · Live Soccer');
  });

  it('goes straight into the remembered match rather than back to the picker', () => {
    rememberPlay('soccer', playMode('live')!);

    const ctx = context();
    homeScreen().mount(ctx);
    ctx.host.querySelector<HTMLButtonElement>('.home__play')?.click();

    // Router paths carry no `#`; that is the shell's business, not the screen's.
    expect(ctx.navigate).toHaveBeenCalledWith('/play/live/soccer');
  });

  it('keeps a route to a different match once Quick Play has taken the primary slot', () => {
    rememberPlay('basketball', playMode('arcade')!);

    const ctx = context();
    homeScreen().mount(ctx);

    const links = [...ctx.host.querySelectorAll('nav.home__links a')];
    expect(links.map((a) => a.textContent)).toEqual(['Choose a game', 'Squad', 'Settings']);
    expect(links[0]?.getAttribute('href')).toBe('#/play');
  });

  it('says what the game is, so a cold install is not a blank page', () => {
    const ctx = context();
    homeScreen().mount(ctx);

    expect(ctx.host.querySelector('.home__lede')?.textContent).toMatch(/every sport/i);
  });

  it('replaces whatever was in the host', () => {
    const ctx = context();
    ctx.host.appendChild(document.createElement('p'));
    homeScreen().mount(ctx);

    expect(ctx.host.children).toHaveLength(1);
    expect(ctx.host.firstElementChild?.className).toBe('home');
  });
});

describe('placeholder screen', () => {
  const spec = {
    heading: 'Squad',
    body: 'Your athletes will live here.',
    arrivesIn: 'Phase 3',
  };

  it('is an honest empty state rather than a blank page', () => {
    const ctx = context();
    placeholderScreen(spec).mount(ctx);

    expect(ctx.host.querySelector('h2')?.textContent).toBe('Squad');
    expect(ctx.host.querySelector('p')?.textContent).toBe('Your athletes will live here.');
  });

  /**
   * T-6.30. This used to assert the note read "Arrives in Phase 3." — a sentence about the build
   * plan, shown to a player who has never read it. The user hit the two remaining stubs on the
   * deployed build and reported that those screens "don't seem to work".
   */
  it('says it is unbuilt in words a player understands, not in phase numbers', () => {
    const ctx = context();
    placeholderScreen(spec).mount(ctx);

    const note = ctx.host.querySelector('.empty-state__note')?.textContent ?? '';
    expect(note).toContain('Still being built');
    expect(note).not.toMatch(/phase/i);
    expect(ctx.host.textContent ?? '').not.toMatch(/phase \d/i);
  });

  it('keeps the phase for whoever is debugging, off the screen and on the element', () => {
    const ctx = context();
    placeholderScreen(spec).mount(ctx);

    expect(ctx.host.querySelector('.empty-state')?.getAttribute('data-arrives-in')).toBe('Phase 3');
  });

  it('is never a dead end — there is always a way back to a match (`10` §10)', () => {
    const ctx = context();
    placeholderScreen(spec).mount(ctx);

    const out = ctx.host.querySelector('a[href="#/play"]');
    expect(out, 'a stub with no way out is a dead end').not.toBeNull();
    expect(out?.textContent).toBe('Play a match');
  });

  it('renders each spec independently', () => {
    const first = context();
    const second = context();
    placeholderScreen(spec).mount(first);
    placeholderScreen({ ...spec, heading: 'Playbook', arrivesIn: 'Phase 5' }).mount(second);

    expect(first.host.querySelector('h2')?.textContent).toBe('Squad');
    expect(second.host.querySelector('h2')?.textContent).toBe('Playbook');
  });
});

describe('settings screen', () => {
  it('lists every settings section', () => {
    const ctx = context();
    settingsScreen().mount(ctx);

    const items = ctx.host.querySelectorAll('.settings-list__item');
    expect(items).toHaveLength(7);
    expect([...items].map((item) => item.id)).toEqual([
      'settings-controls',
      'settings-display',
      'settings-audio',
      // People arrived with T-8.15, which gave local names somewhere to be removed from.
      'settings-players',
      'settings-data',
      'settings-updates',
      'settings-about',
    ]);
  });

  it('links only the sections that have their own screen', () => {
    const ctx = context();
    settingsScreen().mount(ctx);

    // Sections arrive with the features they configure, so this asserts the *rule* rather than a
    // count — a new linked section is expected growth, not a regression.
    const links = [...ctx.host.querySelectorAll('.settings-list__link')];
    expect(links.map((link) => link.getAttribute('href')).sort()).toEqual([
      '#/settings/app',
      '#/settings/controls',
      '#/settings/data',
      '#/settings/players',
    ]);

    const unlinked = [...ctx.host.querySelectorAll('.settings-list__title')].filter(
      (title) => title.querySelector('a') === null,
    );
    expect(unlinked.length).toBeGreaterThan(0);
  });

  it('gives every section a summary, so nothing is a bare label', () => {
    const ctx = context();
    settingsScreen().mount(ctx);

    const summaries = ctx.host.querySelectorAll('.settings-list__summary');
    expect(summaries).toHaveLength(7);
    for (const summary of summaries) {
      expect(summary.textContent?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it('uses a list, so a screen reader announces how many sections there are', () => {
    const ctx = context();
    settingsScreen().mount(ctx);

    expect(ctx.host.firstElementChild?.tagName).toBe('UL');
  });

  it('is idempotent across remounts', () => {
    const ctx = context();
    const screen = settingsScreen();
    screen.mount(ctx);
    screen.mount(ctx);

    expect(ctx.host.querySelectorAll('.settings-list__item')).toHaveLength(7);
  });
});
