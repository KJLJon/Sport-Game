/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.15 — Local player names and party flows for hot-seat across Playbook and Arcade
 * @story   US-17.3 — Be recognised by name
 * @design  10-ui-ux.md §9 (settings), §11 (labels)
 * @invariant INV-11 (every control has a real label)
 *
 * Purpose: the half of `US-17.3` that was missing — that a name can be changed and, crucially,
 * *removed*. `forgetPlayers()` existed from T-4.11 with no caller, so a name typed once could never
 * be taken back out of the app.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenContext } from '@/app/screen.ts';
import { playersScreen } from '@/ui/screens/players.ts';
import { forgetPlayers, loadPlayers, savePlayers } from '@/modes/local-players.ts';

function context(): ScreenContext & { host: HTMLElement } {
  const host = document.createElement('main');
  return { host, params: {}, query: {}, navigate: vi.fn() } as ScreenContext & {
    host: HTMLElement;
  };
}

function mount() {
  const ctx = context();
  playersScreen().mount(ctx);
  return ctx;
}

beforeEach(() => {
  forgetPlayers();
});

describe('the People screen', () => {
  it('gives every seat a real label pointing at its field (INV-11)', () => {
    const ctx = mount();

    const inputs = [...ctx.host.querySelectorAll<HTMLInputElement>('.party-seats__input')];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(ctx.host.querySelector(`label[for="${input.id}"]`)?.textContent).toBeTruthy();
    }
  });

  it('saves a name as it is typed, with no Save button to forget to press', () => {
    const ctx = mount();

    const first = ctx.host.querySelector<HTMLInputElement>('.party-seats__input');
    first!.value = 'Ana';
    first!.dispatchEvent(new Event('input'));

    expect(loadPlayers()[0]?.name).toBe('Ana');
  });

  it('removes every name when asked, which nothing could do before', () => {
    savePlayers([
      { id: 'seat-1', name: 'Dad' },
      { id: 'seat-2', name: 'Ana' },
    ]);
    const ctx = mount();

    // A name lives in a field's value, not in the page's text.
    const values = () =>
      [...ctx.host.querySelectorAll<HTMLInputElement>('.party-seats__input')].map((i) => i.value);
    expect(values()).toContain('Dad');

    const remove = [...ctx.host.querySelectorAll('button')].find(
      (node) => node.textContent === 'Remove all names',
    );
    remove?.click();

    // Gone from storage, not merely from the screen.
    expect(loadPlayers()).toEqual([]);
    expect(values()).not.toContain('Dad');
  });

  it('offers nothing to remove when there is nothing stored', () => {
    const ctx = mount();
    const remove = [...ctx.host.querySelectorAll('button')].find(
      (node) => node.textContent === 'Remove all names',
    );
    // A destructive button that does nothing is a button that teaches the player not to trust them.
    expect(remove?.hasAttribute('disabled') || remove?.getAttribute('aria-disabled')).toBeTruthy();
  });

  it('does not invent stored people just because the screen was opened', () => {
    mount();
    // The seats are defaulted for display; writing them would record four people who do not exist.
    expect(loadPlayers()).toEqual([]);
  });

  it('says plainly where the names go, because "local only" is a promise', () => {
    const ctx = mount();
    expect(ctx.host.textContent).toContain('stay on this device');
    expect(ctx.host.textContent).toContain('never sent');
  });
});
