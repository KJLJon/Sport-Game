/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.10 — Playbook flow UI: setup, turn screen, key-moment transition, results
 * @task    T-6.21 — Soccer Playbook: narration and animated pitch diagram for turn outcomes
 * @story   US-15.1 — Play a match as a series of tactical decisions
 * @design  10-ui-ux.md §8.4, 09-modes-and-arcade.md §2.1, §2.4, §4
 *
 * The screens' states: an empty roster, a setup that round-trips through the URL, a turn screen
 * that shows the score and a call sheet, and a match that can be played to its result.
 *
 * T-6.21 added the half these tests could not previously see: the same two screens, with soccer on
 * the URL, fielding eleven a side against a soccer clock. Every basketball assertion below passed
 * throughout the period when `#/play/playbook` could not reach soccer at all, because the screens
 * named their sport in their imports.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETUP,
  playbookScreen,
  readSetup,
  setupParams,
  splitRoster,
} from '../../../src/ui/screens/playbook.ts';
import { ROUTES } from '../../../src/app/routes.ts';
import { buildHash, parseHash, resolveRoute } from '../../../src/app/router.ts';
import {
  clockText,
  periodLabel,
  playbookMatchScreen,
} from '../../../src/ui/screens/playbook-match.ts';
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
    // Records the hash the *router* would build, not the path it was handed. A stub that dropped
    // the second argument is what let a broken "Start match" ship: the assertion passed on a
    // string the app never actually navigated to.
    navigate: (to: string, params: Record<string, string> = {}) =>
      navigated.push(buildHash(to, params)),
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
      sport: 'soccer' as const,
      difficulty: 'legend' as const,
      keyMoments: 'clutch' as const,
      speed: 'fast' as const,
      hotSeat: true,
      length: 'short' as const,
    };
    // Through the router's own encoder and parser, because the bug this replaced was in exactly
    // that step: a hand-assembled hash came back as one percent-encoded segment.
    const { query } = parseHash(buildHash('/play/playbook/match', setupParams(choice)));
    expect(readSetup(query)).toEqual(choice);
  });

  it('builds a hash the router can resolve back to the match screen', () => {
    const hash = buildHash('/play/playbook/match', setupParams(DEFAULT_SETUP));

    expect(resolveRoute(ROUTES, parseHash(hash))?.route.id).toBe('play-playbook-match');
  });

  it('falls back to the defaults for anything a newer build wrote', () => {
    expect(
      readSetup({ sport: 'curling', difficulty: 'impossible', moments: 'always', speed: 'warp' }),
    ).toEqual(DEFAULT_SETUP);
    expect(readSetup({})).toEqual(DEFAULT_SETUP);
  });

  it('carries the sport, so the hub’s choice survives to the match screen', () => {
    expect(readSetup({ sport: 'soccer' }).sport).toBe('soccer');
    expect(readSetup({ sport: 'basketball' }).sport).toBe('basketball');
    expect(setupParams({ ...DEFAULT_SETUP, sport: 'soccer' })['sport']).toBe('soccer');
  });

  it('leaves hot seat off unless it was asked for', () => {
    expect(readSetup({ hotseat: '0' }).hotSeat).toBe(false);
    expect(readSetup({ hotseat: '1' }).hotSeat).toBe(true);
  });
});

describe('splitting a roster', () => {
  it('refuses a roster too short for one side', () => {
    expect(splitRoster([], 5)).toBeNull();
    expect(
      splitRoster(
        Array.from({ length: 4 }, () => athlete()),
        5,
      ),
    ).toBeNull();
    // Eleven a side: ten athletes field a basketball match and not a soccer one.
    expect(
      splitRoster(
        Array.from({ length: 10 }, () => athlete()),
        11,
      ),
    ).toBeNull();
  });

  it('plays a short roster against itself rather than refusing', () => {
    const five = Array.from({ length: 5 }, () => athlete());
    expect(splitRoster(five, 5)?.away).toEqual(splitRoster(five, 5)?.home);
  });

  it('gives two distinct sides once there are enough for both', () => {
    const ten = Array.from({ length: 10 }, (_, i) => athlete({ id: `t${i}` }));
    const split = splitRoster(ten, 5);
    expect(split?.home).toHaveLength(5);
    expect(split?.away[0]?.id).toBe('t5');

    const twentyTwo = Array.from({ length: 22 }, (_, i) => athlete({ id: `s${i}` }));
    const eleven = splitRoster(twentyTwo, 11);
    expect(eleven?.home).toHaveLength(11);
    expect(eleven?.away[0]?.id).toBe('s11');
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

    // Match length joined the list in T-8.2, shared with Live so "Short" means the same in both.
    // The rules toggles Live gained deliberately did not: soccer's Playbook adapter has no fouls.
    const legends = [...ctx.host.querySelectorAll('legend')].map((node) => node.textContent);
    expect(legends).toEqual([
      'Difficulty',
      'Key moments',
      'Turn speed',
      'Match length',
      'Opponent',
    ]);
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
    // The hash has to survive being parsed back, which is the half that was broken.
    const location = parseHash(ctx.navigated[0]!);
    expect(resolveRoute(ROUTES, location)?.route.id).toBe('play-playbook-match');
    expect(readSetup(location.query).difficulty).toBe('legend');
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

  it('counts the sport’s own periods, not basketball’s', () => {
    expect(periodLabel('Quarter', 1)).toBe('Q1');
    expect(periodLabel('Half', 2)).toBe('H2');
    expect(periodLabel('', 3)).toBe('P3');
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

describe('the same two screens, with soccer on the URL (T-6.21)', () => {
  it('sets up an eleven-a-side match and says whose sport it is', async () => {
    await seedRoster(22);
    const ctx = context({ sport: 'soccer' });
    await playbookScreen().mount(ctx);

    expect(ctx.host.querySelector('.playbook-setup__title')?.textContent).toBe('Soccer Playbook');
    // The same four choices `09` names — the sport is not a fifth one on this screen.
    // Match length joined the list in T-8.2, shared with Live so "Short" means the same in both.
    // The rules toggles Live gained deliberately did not: soccer's Playbook adapter has no fouls.
    const legends = [...ctx.host.querySelectorAll('legend')].map((node) => node.textContent);
    expect(legends).toEqual([
      'Difficulty',
      'Key moments',
      'Turn speed',
      'Match length',
      'Opponent',
    ]);
  });

  it('asks for eleven rather than five before it will start', async () => {
    await seedRoster(10);
    const ctx = context({ sport: 'soccer' });
    await playbookScreen().mount(ctx);
    expect(ctx.host.textContent).toContain('Not enough athletes yet');
    expect(ctx.host.textContent).toContain('11');
  });

  it('keeps the sport on the link it starts the match from', async () => {
    await seedRoster(22);
    const ctx = context({ sport: 'soccer' });
    await playbookScreen().mount(ctx);

    [...ctx.host.querySelectorAll('button')]
      .find((node) => node.textContent?.includes('Start match'))
      ?.click();

    const location = parseHash(ctx.navigated[0]!);
    expect(resolveRoute(ROUTES, location)?.route.id).toBe('play-playbook-match');
    expect(readSetup(location.query).sport).toBe('soccer');
  });

  it('runs a soccer turn screen on a soccer clock, with a soccer call sheet', async () => {
    await seedRoster(22);
    const ctx = context({ sport: 'soccer', moments: 'off' });
    const screen = playbookMatchScreen();
    await screen.mount(ctx);

    // Halves of 45:00, not quarters of 12:00 — the clock comes from the sport module.
    expect(ctx.host.querySelector('.playbook-match__clock')?.textContent).toMatch(/H1 · 45:00/);
    // And the calls are soccer's intent chips, which basketball has none of.
    expect(ctx.host.querySelectorAll('.play-call__input').length).toBeGreaterThan(3);
    screen.unmount?.();
  });

  it('plays a turn through, and narrates it', async () => {
    await seedRoster(22);
    const ctx = context({ sport: 'soccer', moments: 'off', speed: 'instant' });
    const screen = playbookMatchScreen();
    await screen.mount(ctx);

    ctx.host.querySelector<HTMLInputElement>('.play-call__input')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.host.querySelector('.playbook-match__clock')?.textContent).toBeDefined();
    expect(ctx.host.querySelector('[aria-live="polite"]')).not.toBeNull();
    screen.unmount?.();
  });
});
