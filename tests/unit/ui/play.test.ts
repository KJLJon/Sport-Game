/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.1 — Home screen, mode selector, Quick Play (two taps from cold launch)
 * @story   US-10.1 — Jump straight into a game
 * @design  10-ui-ux.md §8.1 (first launch), §10 (states), §11 (accessibility)
 *
 * Purpose: the second tap. This screen is the only route from the Play tab into a match, so what
 * is asserted here is reachability — every available mode is a real link to a real route, and
 * every unavailable one says why rather than vanishing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenContext } from '../../../src/app/screen.ts';
import { ROUTES } from '../../../src/app/routes.ts';
import { parseHash, resolveRoute } from '../../../src/app/router.ts';
import { PLAY_MODE_CATALOGUE } from '../../../src/modes/catalogue.ts';
import { forgetPlay, lastMode, lastSport } from '../../../src/modes/last-played.ts';
import { playScreen } from '../../../src/ui/screens/play.ts';

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

function mount(overrides: Partial<ScreenContext> = {}): ScreenContext & { host: HTMLElement } {
  const ctx = context(overrides);
  playScreen().mount(ctx);
  return ctx;
}

beforeEach(() => {
  forgetPlay();
});

describe('the play hub', () => {
  it('offers both sports as a labelled radio group (`10` §11)', () => {
    const ctx = mount();

    const inputs = [...ctx.host.querySelectorAll<HTMLInputElement>('.play-sports__input')];
    expect(inputs.map((input) => input.value)).toEqual(['basketball', 'soccer']);
    expect(inputs.every((input) => input.type === 'radio')).toBe(true);
    expect(ctx.host.querySelector('.play-sports legend')?.textContent).toBe('Pick a sport');
  });

  it('shows all three modes, available or not (`10` §10)', () => {
    const ctx = mount();

    expect(ctx.host.querySelectorAll('.play-modes > li')).toHaveLength(PLAY_MODE_CATALOGUE.length);
  });

  it('starts basketball in Live, Playbook, and the arcade', () => {
    const ctx = mount();

    const links = [...ctx.host.querySelectorAll<HTMLAnchorElement>('a.play-mode--ready')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#/play/live/basketball',
      '#/play/playbook',
      '#/play/arcade',
    ]);
  });

  it('switches the mode list when the sport changes', () => {
    const ctx = mount();

    const soccer = ctx.host.querySelector<HTMLInputElement>('#play-sport-soccer');
    soccer!.checked = true;
    soccer!.dispatchEvent(new Event('change'));

    const links = [...ctx.host.querySelectorAll<HTMLAnchorElement>('a.play-mode--ready')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#/play/live/soccer']);

    const pending = [...ctx.host.querySelectorAll('.play-mode__pending')];
    expect(pending).toHaveLength(2);
    expect(pending.every((node) => (node.textContent ?? '').length > 0)).toBe(true);
  });

  it('honours a sport named in the query, so the picker is linkable', () => {
    const ctx = mount({ query: { sport: 'soccer' } });

    expect(ctx.host.querySelector<HTMLInputElement>('#play-sport-soccer')?.checked).toBe(true);
    expect(
      ctx.host.querySelector<HTMLAnchorElement>('a.play-mode--ready')?.getAttribute('href'),
    ).toBe('#/play/live/soccer');
  });

  it('ignores a sport in the query that is not playable', () => {
    const ctx = mount({ query: { sport: 'underwater-hockey' } });

    expect(ctx.host.querySelector<HTMLInputElement>('#play-sport-basketball')?.checked).toBe(true);
  });

  it('records the choice when a mode is started, so Quick Play resumes it', () => {
    const ctx = mount();

    ctx.host.querySelector<HTMLAnchorElement>('a.play-mode--ready')?.click();

    expect(lastSport()).toBe('basketball');
    expect(lastMode('basketball')?.id).toBe('live');
  });

  it('replaces whatever was in the host', () => {
    const ctx = context();
    ctx.host.appendChild(document.createElement('p'));
    playScreen().mount(ctx);

    expect(ctx.host.children).toHaveLength(1);
    expect(ctx.host.firstElementChild?.className).toBe('play-screen');
  });
});

/**
 * The regression this task exists for: the Play tab used to land on a placeholder, so every mode
 * the build had shipped was unreachable without typing a hash by hand. This asserts the property
 * rather than the screen — every route the hub advertises must be one the router can resolve.
 */
describe('every advertised route resolves', () => {
  it('matches a real route for each available sport and mode', () => {
    for (const mode of PLAY_MODE_CATALOGUE) {
      for (const sport of mode.sports) {
        const hash = mode.route(sport);
        const match = resolveRoute(ROUTES, parseHash(hash));
        expect(match, `${mode.id} · ${sport} → ${hash}`).not.toBeNull();
        // A route that falls through to a placeholder is a dead end wearing a link's clothes.
        expect(match?.route.id).not.toBe('play');
      }
    }
  });
});
