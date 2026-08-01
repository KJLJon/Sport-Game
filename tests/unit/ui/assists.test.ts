/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.8 — Assist system: aim, pass, auto-switch, timing forgiveness
 * @story   US-7.3 — Get help without being carried
 * @design  06-game-design.md §2, 10-ui-ux.md §11 (accessibility)
 *
 * Purpose: the screen is the only place `06` §2's "tunable independently of difficulty" is visible
 * to a player, so what is asserted is that each dial reaches storage, that the bonus state is
 * stated as a sentence rather than implied, and that the reset really hands the dials back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenContext } from '../../../src/app/screen.ts';
import { assistsScreen, bonusText, strengthOf, windowOf } from '../../../src/ui/screens/assists.ts';
import { NO_ASSISTS, defaultAssists } from '../../../src/modes/assists.ts';
import {
  assistsAreCustom,
  forgetPlay,
  loadAssists,
  rememberDifficulty,
  saveAssists,
} from '../../../src/modes/last-played.ts';

function mount(): HTMLElement {
  const host = document.createElement('main');
  assistsScreen().mount({
    host,
    params: {},
    query: {},
    navigate: vi.fn(),
  } as unknown as ScreenContext);
  return host;
}

function radio(host: HTMLElement, name: string, value: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (input === null) throw new Error(`no ${name} option ${value}`);
  return input;
}

/**
 * Picks an option. `click()` is not enough: jsdom only runs a radio's activation behaviour for an
 * element in the document, and these screens are mounted into a detached host.
 */
function choose(host: HTMLElement, name: string, value: string): void {
  const input = radio(host, name, value);
  input.checked = true;
  input.dispatchEvent(new Event('change'));
}

beforeEach(() => {
  forgetPlay();
});

describe('the assists screen', () => {
  it('shows the level’s defaults until the player changes something', () => {
    rememberDifficulty('rookie');
    const host = mount();
    expect(radio(host, 'assist-aim', 'strong').checked).toBe(true);
    expect(host.textContent).toContain('Rookie');
  });

  it('stores each dial as it moves', () => {
    rememberDifficulty('pro');
    const host = mount();

    choose(host, 'assist-aim', 'off');
    expect(loadAssists().aim).toBe(0);

    choose(host, 'assist-pass', 'light');
    expect(loadAssists().pass).toBeCloseTo(0.3, 5);

    choose(host, 'assist-timing', 'tight');
    expect(loadAssists().timing).toBeCloseTo(0.8, 5);

    const auto = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (auto === null) throw new Error('no auto-switch');
    auto.checked = false;
    auto.dispatchEvent(new Event('change'));
    expect(loadAssists().autoSwitch).toBe(false);
    expect(assistsAreCustom()).toBe(true);
  });

  it('says whether the bonus is live, in words rather than in colour (`10` §11)', () => {
    saveAssists(NO_ASSISTS);
    expect(mount().textContent).toContain('No assists: you are earning');

    saveAssists({ ...NO_ASSISTS, aim: 1 });
    expect(mount().textContent).toContain('Turn all four off');
  });

  it('hands the dials back to the level and redraws to prove it', () => {
    rememberDifficulty('rookie');
    saveAssists(NO_ASSISTS);
    const host = mount();
    expect(radio(host, 'assist-aim', 'off').checked).toBe(true);

    const reset = [...host.querySelectorAll('button')].find((element) =>
      element.textContent?.includes('Follow my difficulty'),
    );
    reset?.click();

    expect(assistsAreCustom()).toBe(false);
    expect(loadAssists()).toEqual(defaultAssists('rookie'));
    // The redraw is the point: a reset that leaves "Off" selected is lying about what is stored.
    expect(radio(host, 'assist-aim', 'strong').checked).toBe(true);
  });

  it('labels every group for a screen reader', () => {
    const host = mount();
    const legends = [...host.querySelectorAll('legend')].map((element) => element.textContent);
    expect(legends).toEqual(
      expect.arrayContaining(['Aim assist', 'Pass assist', 'Shot-timing window']),
    );
  });
});

describe('naming a stored amount', () => {
  it('picks the nearest named strength, so old storage still shows something true', () => {
    expect(strengthOf(0)).toBe('off');
    expect(strengthOf(0.28)).toBe('light');
    expect(strengthOf(0.7)).toBe('moderate');
    expect(strengthOf(1)).toBe('strong');
  });

  it('does the same for the window', () => {
    expect(windowOf(0.8)).toBe('tight');
    expect(windowOf(1.02)).toBe('normal');
    expect(windowOf(1.35)).toBe('generous');
  });

  it('states the bonus as a percentage either way', () => {
    expect(bonusText(NO_ASSISTS)).toMatch(/\d+% more coins/);
    expect(bonusText({ ...NO_ASSISTS, pass: 1 })).toMatch(/Turn all four off/);
  });
});
