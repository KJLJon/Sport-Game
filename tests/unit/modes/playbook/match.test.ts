/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.1 — `PlaybookAdapter` interface + turn engine: turn loop, state, seeded resolution
 * @story   US-15.1 — Play a match as a series of tactical decisions
 * @design  09-modes-and-arcade.md §2.1, §2.4, §5
 * @invariant INV-8 (determinism), INV-9 (one event stream)
 *
 * The engine's contract, against an adapter that is not a sport — so a failure here is the turn
 * loop's and not basketball's.
 */
import { describe, expect, it } from 'vitest';
import { PlaybookMatch, simulatePlaybookMatch } from '../../../../src/modes/playbook/match.ts';
import type { PlaybookCall } from '../../../../src/modes/playbook/types.ts';
import { FAKE_RULES, fakeAdapter, squads, type FakeDetail } from '../../../helpers/playbook.ts';

function match(
  overrides: Partial<Parameters<typeof makeOptions>[0]> = {},
): PlaybookMatch<FakeDetail> {
  return new PlaybookMatch(makeOptions(overrides));
}

function makeOptions(overrides: {
  seed?: string;
  adapter?: ReturnType<typeof fakeAdapter>;
  keyMoments?: 'off' | 'clutch' | 'standard' | 'every';
}) {
  return {
    seed: overrides.seed ?? 'seed-1',
    adapter: overrides.adapter ?? fakeAdapter(),
    sport: 'testsport',
    rules: FAKE_RULES,
    squads: squads(),
    ...(overrides.keyMoments === undefined ? {} : { keyMoments: overrides.keyMoments }),
  };
}

/** Submits for both sides and takes the turn all the way through. */
function playTurn(game: PlaybookMatch<FakeDetail>, offence = 'attack', defence = 'press'): void {
  const attacking = game.view().possession === 1 ? 1 : 0;
  const defending = attacking === 1 ? 0 : 1;
  game.submit({ side: attacking, call: offence });
  game.submit({ side: defending, call: defence });
  game.resolve();
  if (game.phase === 'key-moment') game.settleKeyMoment({ made: true, quality: 1 });
  game.advance();
}

describe('the turn cycle', () => {
  it('starts awaiting calls, with the clock full and nothing scored', () => {
    const view = match().view();
    expect(view).toMatchObject({
      phase: 'awaiting-calls',
      turn: 0,
      period: 1,
      periodClock: 72,
      score: [0, 0],
      lastTurn: null,
      keyMoment: null,
    });
  });

  it('offers the offensive catalogue to whoever has the ball and the defensive one to the other', () => {
    const game = match();
    const attacking = game.view().possession === 1 ? 1 : 0;
    const defending = attacking === 1 ? 0 : 1;
    expect(game.calls(attacking).every((call) => call.side === 'offence')).toBe(true);
    expect(game.calls(defending).every((call) => call.side === 'defence')).toBe(true);
  });

  it('refuses to resolve until both sides have called', () => {
    const game = match();
    expect(() => game.resolve()).toThrow(/both sides/);
    game.submit({ side: 0, call: 'attack' });
    expect(() => game.resolve()).toThrow(/both sides/);
  });

  it('lets a side change its call before the turn resolves', () => {
    const game = match();
    const attacking = game.view().possession === 1 ? 1 : 0;
    const defending = attacking === 1 ? 0 : 1;
    game.submit({ side: attacking, call: 'attack' });
    game.submit({ side: attacking, call: 'settle' });
    game.submit({ side: defending, call: 'press' });
    expect(game.resolve().calls.offence.call).toBe('settle');
  });

  it('rejects a call for the neutral side', () => {
    expect(() => match().submit({ side: -1, call: 'attack' } as PlaybookCall)).toThrow(/real side/);
  });

  it('refuses to advance a turn that has not been resolved', () => {
    expect(() => match().advance()).toThrow(/resolved turn/);
  });

  it('refuses to submit once a turn is resolved', () => {
    const game = match();
    game.submit({ side: 0, call: 'attack' });
    game.submit({ side: 1, call: 'press' });
    game.resolve();
    expect(() => game.submit({ side: 0, call: 'settle' })).toThrow(/awaiting-calls/);
  });

  it('advances the turn counter, spends the clock, and hands over possession', () => {
    const game = match();
    const first = game.view().possession;
    playTurn(game);
    expect(game.view()).toMatchObject({ turn: 1, periodClock: 66, phase: 'awaiting-calls' });
    expect(game.view().possession).not.toBe(first);
  });

  it('keeps possession when the resolution says the attacking side retained it', () => {
    const adapter = fakeAdapter();
    const inner = adapter.resolve.bind(adapter);
    adapter.resolve = (state, calls, rng) => ({
      ...inner(state, calls, rng),
      retainsPossession: true,
    });

    const game = match({ adapter });
    const before = game.view().possession;
    playTurn(game);
    expect(game.view().possession).toBe(before);
  });

  it('records every committed turn in order', () => {
    const game = match();
    playTurn(game);
    playTurn(game);
    expect(game.turns.map((turn) => turn.turn)).toEqual([0, 1]);
  });
});

describe('score and events', () => {
  it('emits the turn events with the match-start events, on one stream', () => {
    const game = match();
    playTurn(game);
    const kinds = game.events.map((entry) => entry.kind);
    expect(kinds.slice(0, 2)).toEqual(['match.start', 'period.start']);
    expect(kinds).toContain('shot');
  });

  it('carries no mode field on any event (INV-9)', () => {
    const game = match();
    playTurn(game);
    for (const entry of game.events) {
      expect(Object.keys(entry)).not.toContain('mode');
      expect(JSON.stringify(entry)).not.toContain('playbook');
    }
  });

  it('stamps every turn event with the match step, not the adapter’s zero', () => {
    const game = match();
    playTurn(game);
    playTurn(game);
    const shots = game.events.filter((entry) => entry.kind === 'shot');
    expect(shots).toHaveLength(2);
    expect(shots[0]?.step).toBe(0);
    expect(shots[1]?.step).toBeGreaterThan(0);
  });

  it('scores through the state machine, so a score event always accompanies the points', () => {
    const game = match();
    let scored = 0;
    while (scored === 0 && game.view().turn < 20) {
      playTurn(game);
      scored = game.view().score[0] + game.view().score[1];
    }
    expect(scored).toBeGreaterThan(0);
    expect(game.events.filter((entry) => entry.kind === 'score')).not.toHaveLength(0);
    expect(game.machine.homeScore + game.machine.awayScore).toBe(scored);
  });

  it('emits the shot before the score it produced', () => {
    const game = match();
    while (game.view().score[0] + game.view().score[1] === 0 && game.view().turn < 20) {
      playTurn(game);
    }
    const kinds = game.events.map((entry) => entry.kind);
    expect(kinds.indexOf('shot')).toBeLessThan(kinds.indexOf('score'));
  });
});

describe('periods and the end of a match', () => {
  it('rolls into the next period when the clock runs out', () => {
    const game = match();
    while (game.view().period === 1 && !game.finished) playTurn(game);
    expect(game.view().period).toBe(2);
    expect(game.view().periodClock).toBe(72);
  });

  it('ends the match after the last period, and reports a result', () => {
    const game = match();
    let guard = 0;
    while (!game.finished && guard < 200) {
      playTurn(game);
      guard += 1;
    }
    expect(game.finished).toBe(true);
    expect(game.phase).toBe('over');
    expect(game.result()).not.toBeNull();
    expect(game.calls(0)).toEqual([]);
  });

  it('stops when the adapter says the sport is finished, even with clock left', () => {
    const game = match({ adapter: fakeAdapter({ finishAfter: 3 }) });
    let guard = 0;
    while (!game.finished && guard < 50) {
      playTurn(game);
      guard += 1;
    }
    expect(game.view().turn).toBe(3);
    expect(game.view().periodClock).toBeGreaterThan(0);
  });

  it('abandons cleanly and does not abandon twice', () => {
    const game = match();
    game.abandon();
    expect(game.finished).toBe(true);
    expect(() => game.abandon()).not.toThrow();
  });
});

describe('key moments', () => {
  it('hands over a high-leverage moment on the standard setting', () => {
    const game = match({ adapter: fakeAdapter({ keyMoments: true, leverage: 0.9 }) });
    game.submit({ side: game.view().possession === 1 ? 1 : 0, call: 'attack' });
    game.submit({ side: game.view().possession === 1 ? 0 : 1, call: 'press' });
    game.resolve();
    expect(game.phase).toBe('key-moment');
    expect(game.keyMoment()).toMatchObject({ game: 'fake-game', leverage: 0.9 });
  });

  it('never hands one over when the setting is off', () => {
    const game = match({
      adapter: fakeAdapter({ keyMoments: true, leverage: 1 }),
      keyMoments: 'off',
    });
    playTurn(game);
    expect(game.turns[0]?.fromKeyMoment).toBeUndefined();
  });

  it('takes only the top of the range on the clutch setting', () => {
    const low = match({
      adapter: fakeAdapter({ keyMoments: true, leverage: 0.5 }),
      keyMoments: 'clutch',
    });
    low.submit({ side: low.view().possession === 1 ? 1 : 0, call: 'attack' });
    low.submit({ side: low.view().possession === 1 ? 0 : 1, call: 'press' });
    low.resolve();
    expect(low.phase).toBe('resolved');

    const high = match({
      adapter: fakeAdapter({ keyMoments: true, leverage: 0.8 }),
      keyMoments: 'clutch',
    });
    high.submit({ side: high.view().possession === 1 ? 1 : 0, call: 'attack' });
    high.submit({ side: high.view().possession === 1 ? 0 : 1, call: 'press' });
    high.resolve();
    expect(high.phase).toBe('key-moment');
  });

  it('takes anything at all on the every-chance setting', () => {
    const game = match({
      adapter: fakeAdapter({ keyMoments: true, leverage: 0 }),
      keyMoments: 'every',
    });
    game.submit({ side: game.view().possession === 1 ? 1 : 0, call: 'attack' });
    game.submit({ side: game.view().possession === 1 ? 0 : 1, call: 'press' });
    game.resolve();
    expect(game.phase).toBe('key-moment');
  });

  it('records what the sim would have done before the player touched it (`09` §2.4)', () => {
    const game = match({
      seed: 'counterfactual',
      adapter: fakeAdapter({ keyMoments: true, appliesKeyMoment: true }),
    });

    // Drive to a turn the sim itself missed, so `simWouldHave` cannot be an echo of the input.
    let drawnPoints = -1;
    while (drawnPoints !== 0 && game.view().turn < 20) {
      game.submit({ side: game.view().possession === 1 ? 1 : 0, call: 'attack' });
      game.submit({ side: game.view().possession === 1 ? 0 : 1, call: 'press' });
      drawnPoints = game.resolve().points;
      if (drawnPoints !== 0) {
        game.settleKeyMoment({ made: true, quality: 1 });
        game.advance();
      }
    }
    expect(drawnPoints).toBe(0);

    const settled = game.settleKeyMoment({ made: true, quality: 0.95 });
    expect(settled.fromKeyMoment).toMatchObject({ made: true, simWouldHave: false, quality: 0.95 });
    expect(settled.points).toBe(3);
  });

  it('replaces the turn events, so a missed sim shot does not reach the box score', () => {
    const game = match({
      seed: 'replacement',
      adapter: fakeAdapter({ keyMoments: true, appliesKeyMoment: true }),
    });
    game.submit({ side: game.view().possession === 1 ? 1 : 0, call: 'attack' });
    game.submit({ side: game.view().possession === 1 ? 0 : 1, call: 'press' });
    game.resolve();
    game.settleKeyMoment({ made: true, quality: 1 });
    game.advance();

    const shots = game.events.filter((entry) => entry.kind === 'shot');
    expect(shots).toHaveLength(1);
    expect(shots[0]?.detail).toMatchObject({ arcade: true, made: true });
  });

  it('keeps the sim outcome when the adapter has no applyKeyMoment, rather than guessing', () => {
    const game = match({ adapter: fakeAdapter({ keyMoments: true }) });
    game.submit({ side: game.view().possession === 1 ? 1 : 0, call: 'attack' });
    game.submit({ side: game.view().possession === 1 ? 0 : 1, call: 'press' });
    const drawn = game.resolve();
    const settled = game.settleKeyMoment({ made: !(drawn.points > 0), quality: 1 });
    expect(settled.points).toBe(drawn.points);
    expect(settled.fromKeyMoment?.made).toBe(!(drawn.points > 0));
  });

  it('refuses to settle a moment that is not pending', () => {
    const game = match();
    expect(() => game.settleKeyMoment({ made: true, quality: 1 })).toThrow(/pending key moment/);
  });
});

describe('determinism (INV-8)', () => {
  it('two matches with one seed and the same calls are the same match', () => {
    const a = match({ seed: 'twin' });
    const b = match({ seed: 'twin' });
    for (let i = 0; i < 12; i += 1) {
      playTurn(a);
      playTurn(b);
    }
    expect(a.view()).toEqual(b.view());
    expect(a.events).toEqual(b.events);
  });

  it('a different seed produces a different match', () => {
    const a = match({ seed: 'one' });
    const b = match({ seed: 'two' });
    for (let i = 0; i < 24; i += 1) {
      playTurn(a);
      playTurn(b);
    }
    expect(a.turns.map((turn) => turn.outcome)).not.toEqual(b.turns.map((turn) => turn.outcome));
  });

  it('forks the turn generator by turn number, so a turn cannot shift its neighbours', () => {
    // Taking a key moment on turn 0 consumes nothing from turn 1's stream, because turn 1 forks
    // its own. Two runs that differ only in what happened on turn 0 agree from turn 1 onwards.
    const plain = match({ seed: 'fork', adapter: fakeAdapter({ keyMoments: false }) });
    const withMoment = match({
      seed: 'fork',
      adapter: fakeAdapter({ keyMoments: true, appliesKeyMoment: true }),
      keyMoments: 'every',
    });

    playTurn(plain);
    playTurn(withMoment);
    playTurn(plain, 'settle', 'drop');
    playTurn(withMoment, 'settle', 'drop');

    expect(withMoment.turns[1]?.outcome).toBe(plain.turns[1]?.outcome);
  });
});

describe('adapter plumbing', () => {
  it('gives the adapter its own seeded state at kick-off', () => {
    const game = match();
    expect(game.state.detail).toEqual({ resolutions: 0, lastCall: '' });
  });

  it('calls apply() once per committed turn, and not for one merely resolved', () => {
    const game = match();
    game.submit({ side: game.view().possession === 1 ? 1 : 0, call: 'attack' });
    game.submit({ side: game.view().possession === 1 ? 0 : 1, call: 'press' });
    game.resolve();
    expect(game.state.detail.resolutions).toBe(0);
    game.advance();
    expect(game.state.detail).toEqual({ resolutions: 1, lastCall: 'attack' });
  });

  it('asks the adapter to narrate, and passes the resolution through unchanged', () => {
    const game = match();
    playTurn(game);
    const turn = game.turns[0];
    expect(turn).toBeDefined();
    const line = game.narrate(turn as never);
    expect(line.tone).toBe(turn?.points === 0 ? 'bad' : 'good');
  });

  it('returns null from autoCall when the adapter offers none', () => {
    const adapter = fakeAdapter();
    delete adapter.autoCall;
    expect(match({ adapter }).autoCall(0)).toBeNull();
  });
});

describe('simulatePlaybookMatch', () => {
  it('plays a whole match headlessly and finishes it', () => {
    const game = simulatePlaybookMatch(makeOptions({ seed: 'headless' }));
    expect(game.finished).toBe(true);
    expect(game.turns.length).toBeGreaterThan(10);
    expect(game.result()).not.toBeNull();
  });

  it('is deterministic for a seed', () => {
    const a = simulatePlaybookMatch(makeOptions({ seed: 'batch' }));
    const b = simulatePlaybookMatch(makeOptions({ seed: 'batch' }));
    expect(a.view().score).toEqual(b.view().score);
    expect(a.turns.length).toBe(b.turns.length);
  });

  it('never hands a headless run a key moment it has nobody to play', () => {
    const game = simulatePlaybookMatch(
      makeOptions({ seed: 'batch', adapter: fakeAdapter({ keyMoments: true, leverage: 1 }) }),
    );
    expect(game.turns.some((turn) => turn.fromKeyMoment !== undefined)).toBe(false);
  });

  it('says so rather than hanging when the adapter cannot call for itself', () => {
    const adapter = fakeAdapter();
    delete adapter.autoCall;
    expect(() => simulatePlaybookMatch(makeOptions({ adapter }))).toThrow(/autoCall/);
  });
});
