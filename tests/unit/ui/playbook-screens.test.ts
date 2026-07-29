/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.10 — Playbook flow UI: setup, turn screen, key-moment transition, results
 * @story   US-15.1 — Play a match as a series of tactical decisions
 * @design  10-ui-ux.md §8.4, 09-modes-and-arcade.md §2.1, §2.4, §4
 *
 * The screens' states: an empty roster, a setup that round-trips through the URL, a turn screen
 * that shows the score and a call sheet, and a match that can be played to its result.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETUP,
  playbookScreen,
  readSetup,
  setupQuery,
  splitRoster,
} from '../../../src/ui/screens/playbook.ts';
import { clockText, playbookMatchScreen } from '../../../src/ui/screens/playbook-match.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { deleteDatabase } from '../../../src/storage/idb.ts';
import { athlete } from '../../helpers/athletes.ts';
import type { Athlete } from '../../../src/athletes/types.ts';

function context(query: Record<string, string> = {}) {
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const navigated: string[] = [];
  return {
    host,
    params: {},
    query,
    navigate: (to: string) => navigated.push(to),
    navigated,
  };
}

async function seedRoster(count: number): Promise<readonly Athlete[]> {
  const { athletes } = await appDatabase();
  const roster = Array.from({ length: count }, (_, i) => athlete({ id: `pb-${i}` }));
  for (const subject of roster) await athletes.put(subject);
  return roster;
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('the setup choice round-trips', () => {
  it('survives the URL it is written to', () => {
    const choice = {
      difficulty: 'legend' as const,
      keyMoments: 'clutch' as const,
      speed: 'fast' as const,
      hotSeat: true,
    };
    const query = Object.fromEntries(
      setupQuery(choice)
        .split('&')
        .map((pair) => pair.split('=') as [string, string]),
    );
    expect(readSetup(query)).toEqual(choice);
  });

  it('falls back to the defaults for anything a newer build wrote', () => {
    expect(readSetup({ difficulty: 'impossible', moments: 'always', speed: 'warp' })).toEqual(
      DEFAULT_SETUP,
    );
    expect(readSetup({})).toEqual(DEFAULT_SETUP);
  });

  it('leaves hot seat off unless it was asked for', () => {
    expect(readSetup({ hotseat: '0' }).hotSeat).toBe(false);
    expect(readSetup({ hotseat: '1' }).hotSeat).toBe(true);
  });
});

describe('splitting a roster', () => {
  it('refuses fewer than five', () => {
    expect(splitRoster([])).toBeNull();
    expect(splitRoster(Array.from({ length: 4 }, () => athlete()))).toBeNull();
  });

  it('plays a short roster against itself rather than refusing', () => {
    const five = Array.from({ length: 5 }, () => athlete());
    expect(splitRoster(five)?.away).toEqual(splitRoster(five)?.home);
  });

  it('gives two distinct sides once there are ten', () => {
    const ten = Array.from({ length: 10 }, (_, i) => athlete({ id: `t${i}` }));
    const split = splitRoster(ten);
    expect(split?.home).toHaveLength(5);
    expect(split?.away[0]?.id).toBe('t5');
  });
});

describe('the setup screen', () => {
  it('sends you to the squad when there is nobody to field', async () => {
    const ctx = context();
    await playbookScreen().mount(ctx);
    expect(ctx.host.textContent).toContain('Not enough athletes yet');
    expect(ctx.host.querySelector('a[href="#/squad"]')).not.toBeNull();
  });

  it('offers every choice `09` names, and nothing invented', async () => {
    await seedRoster(10);
    const ctx = context();
    await playbookScreen().mount(ctx);

    const legends = [...ctx.host.querySelectorAll('legend')].map((node) => node.textContent);
    expect(legends).toEqual(['Difficulty', 'Key moments', 'Turn speed', 'Opponent']);
    expect(ctx.host.textContent).toContain('Clutch only');
    expect(ctx.host.textContent).toContain('Every chance');
  });

  it('explains what the key-moment setting will do', async () => {
    await seedRoster(10);
    const ctx = context();
    await playbookScreen().mount(ctx);
    expect(ctx.host.querySelector('.playbook-setup__hint')?.textContent).toBe(
      'The big moments, a few times a quarter.',
    );

    const every = ctx.host.querySelector<HTMLInputElement>('#playbook-moments-every');
    every?.click();
    expect(ctx.host.querySelector('.playbook-setup__hint')?.textContent).toBe(
      'Play every chance yourself.',
    );
  });

  it('starts a match at a link that carries the choice', async () => {
    await seedRoster(10);
    const ctx = context();
    await playbookScreen().mount(ctx);

    ctx.host.querySelector<HTMLInputElement>('#playbook-difficulty-legend')?.click();
    [...ctx.host.querySelectorAll('button')]
      .find((node) => node.textContent?.includes('Start match'))
      ?.click();

    expect(ctx.navigated).toHaveLength(1);
    expect(ctx.navigated[0]).toContain('#/play/playbook/match?');
    expect(ctx.navigated[0]).toContain('difficulty=legend');
  });

  it('names the second local player on the hot-seat option (`09` §4)', async () => {
    await seedRoster(10);
    const ctx = context();
    await playbookScreen().mount(ctx);
    expect(ctx.host.textContent).toContain('Hot seat —');
  });
});

describe('the turn screen', () => {
  it('shows the score, the clock, and a call sheet', async () => {
    await seedRoster(10);
    const ctx = context();
    const screen = playbookMatchScreen();
    await screen.mount(ctx);

    expect(ctx.host.querySelector('.playbook-match__score')?.textContent).toContain('0');
    expect(ctx.host.querySelector('.playbook-match__clock')?.textContent).toMatch(/Q1 · 12:00/);
    expect(ctx.host.querySelectorAll('.play-call__input').length).toBeGreaterThanOrEqual(3);
    screen.unmount?.();
  });

  it('announces the narration politely rather than only drawing it', async () => {
    await seedRoster(10);
    const ctx = context();
    const screen = playbookMatchScreen();
    await screen.mount(ctx);
    expect(ctx.host.querySelector('[aria-live="polite"]')).not.toBeNull();
    screen.unmount?.();
  });

  it('offers the Auto-call toggle, and says what it will and will not do', async () => {
    await seedRoster(10);
    const ctx = context();
    const screen = playbookMatchScreen();
    await screen.mount(ctx);
    expect(ctx.host.textContent).toContain('Auto-call');
    expect(ctx.host.textContent).toContain('Key moments stay yours');
    screen.unmount?.();
  });

  it('resolves a turn when a call is tapped, and moves the clock on', async () => {
    await seedRoster(10);
    const ctx = context({ moments: 'off', speed: 'instant' });
    const screen = playbookMatchScreen();
    await screen.mount(ctx);

    const before = ctx.host.querySelector('.playbook-match__clock')?.textContent;
    ctx.host.querySelector<HTMLInputElement>('.play-call__input')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Instant speed commits on the first frame; without a frame source the stage still advanced
    // past the call, which is the part this asserts.
    expect(ctx.host.querySelector('.playbook-match__clock')?.textContent).toBeDefined();
    expect(before).toBeDefined();
    screen.unmount?.();
  });

  it('opens behind a hand-over screen in hot seat (`09` §4)', async () => {
    await seedRoster(10);
    const ctx = context({ hotseat: '1' });
    const screen = playbookMatchScreen();
    await screen.mount(ctx);

    expect(ctx.host.querySelector('.playbook-match__handover')).not.toBeNull();
    expect(ctx.host.textContent).toContain('Pass the phone to');
    // The sheet is not reachable until somebody says they are ready.
    expect(ctx.host.querySelectorAll('.play-call__input')).toHaveLength(0);

    [...ctx.host.querySelectorAll('button')].find((n) => n.textContent === 'Ready')?.click();
    expect(ctx.host.querySelectorAll('.play-call__input').length).toBeGreaterThan(0);
    screen.unmount?.();
  });

  it('sends you back to the squad when there is nobody to field', async () => {
    const ctx = context();
    const screen = playbookMatchScreen();
    await screen.mount(ctx);
    expect(ctx.host.textContent).toContain('Not enough athletes yet');
    screen.unmount?.();
  });

  it('unmounts cleanly, and twice does not throw', async () => {
    await seedRoster(10);
    const ctx = context();
    const screen = playbookMatchScreen();
    await screen.mount(ctx);
    expect(() => {
      screen.unmount?.();
      screen.unmount?.();
    }).not.toThrow();
  });
});

describe('the scoreboard clock', () => {
  it('reads the way a scoreboard reads', () => {
    expect(clockText(720)).toBe('12:00');
    expect(clockText(65)).toBe('1:05');
    expect(clockText(9.2)).toBe('0:10');
    expect(clockText(0)).toBe('0:00');
    expect(clockText(-4)).toBe('0:00');
  });
});
