/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.5 — Key-moment detection → arcade invocation → result fed back into resolution
 * @story   US-15.4 — Play the big moments myself
 * @design  09-modes-and-arcade.md §2.4, §3.2, §7
 * @invariant INV-9 (one stream), INV-10 (the athlete decides the window), INV-12 (reward parity)
 *
 * Detection, the run, and the fold-back. The claim this suite exists to protect: a key moment
 * changes what happened, not how much the possession is worth twice over.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../../src/engine/rng.ts';
import { applyEvent, createBoxScore, teamLine } from '../../../../../src/modes/live/box-score.ts';
import {
  KEY_MOMENT_RULES,
  findAthlete,
  keyMomentConfig,
  outcomeOf,
  playKeyMoment,
  startKeyMoment,
} from '../../../../../src/modes/playbook/key-moment.ts';
import type {
  ArcadeInvocation,
  CallPair,
  KeyMomentOutcome,
  PlaybookState,
  TurnResolution,
} from '../../../../../src/modes/playbook/types.ts';
import { BASKETBALL_ARCADE } from '../../../../../src/sports/basketball/arcade/index.ts';
import {
  MOMENT_GAMES,
  basketballSquads,
  createBasketballPlaybook,
  detectKeyMoment,
  leverageFor,
} from '../../../../../src/sports/basketball/playbook/index.ts';
import { applyKeyMomentOutcome } from '../../../../../src/sports/basketball/playbook/key-moments.ts';
import {
  resolvePossession,
  type BasketballPlaybookState,
} from '../../../../../src/sports/basketball/playbook/resolution.ts';
import { evenRosters } from '../../../../../tools/playbook-rosters.ts';
import { pressFrame } from '../../../../helpers/arcade.ts';

type State = PlaybookState<BasketballPlaybookState>;

function stateFor(overrides: Partial<State> = {}): State {
  const [home, away] = evenRosters('km');
  const match = createBasketballPlaybook({
    seed: 'km',
    squads: basketballSquads(home, away),
    playerSide: 0,
  });
  Object.assign(match.state, { possession: 0 }, overrides);
  return match.state;
}

function pair(offence: string, defence: string): CallPair {
  return { offence: { side: 0, call: offence }, defence: { side: 1, call: defence } };
}

function turn(overrides: Partial<TurnResolution> = {}): TurnResolution {
  return {
    turn: 0,
    calls: pair('motion', 'man'),
    attacking: 0,
    outcome: 'made-two',
    actor: 0,
    target: 100,
    points: 2,
    seconds: 16,
    retainsPossession: false,
    events: [],
    expectation: { successChance: 0.5, expectedPoints: 1, because: 'An even look.' },
    ...overrides,
  };
}

function shot(value: 2 | 3, contest: number, made: boolean) {
  return {
    kind: 'shot' as const,
    step: 0,
    side: 0 as const,
    actor: 0,
    value,
    detail: { zone: value === 3 ? 'wingThree' : 'midRange', contest, made },
  };
}

function invocation(game: string, actor = 0): ArcadeInvocation {
  return { game, actor, leverage: 0.5, prompt: 'x' };
}

function outcome(game: string, made: boolean, actor = 0): KeyMomentOutcome {
  return {
    invocation: invocation(game, actor),
    made,
    quality: made ? 0.9 : 0.1,
    simWouldHave: !made,
    simPoints: made ? 0 : 2,
  };
}

describe('detection (`09` §2.4)', () => {
  it('maps every one of the five moments onto a game that exists (`09` §3.2)', () => {
    const ids = new Set(BASKETBALL_ARCADE.map((game) => game.id));
    for (const id of Object.values(MOMENT_GAMES)) expect(ids.has(id)).toBe(true);
    expect(new Set(Object.values(MOMENT_GAMES)).size).toBe(5);
  });

  it('offers nothing when nobody is at the controls', () => {
    const state = stateFor({ playerSide: -1 });
    expect(detectKeyMoment(state, turn({ events: [shot(3, 0.1, true)] }))).toBeNull();
  });

  it('offers a wide-open three, and only when it is actually open', () => {
    const state = stateFor();
    expect(detectKeyMoment(state, turn({ events: [shot(3, 0.1, true)] }))?.game).toBe(
      MOMENT_GAMES.wideOpenThree,
    );
    expect(detectKeyMoment(state, turn({ events: [shot(3, 0.8, true)] }))).toBeNull();
    expect(detectKeyMoment(state, turn({ events: [shot(2, 0.1, true)] }))).toBeNull();
  });

  it('offers the line on any trip to it', () => {
    const state = stateFor();
    for (const outcomeId of ['free-throws', 'missed-free-throws', 'and-one']) {
      expect(detectKeyMoment(state, turn({ outcome: outcomeId }))?.game).toBe(
        MOMENT_GAMES.clutchFreeThrow,
      );
    }
  });

  it('offers the fast break on a push and on a broken press', () => {
    const state = stateFor();
    expect(
      detectKeyMoment(state, turn({ calls: pair('push', 'man'), events: [shot(2, 0.4, true)] }))
        ?.game,
    ).toBe(MOMENT_GAMES.fastBreak);
    expect(
      detectKeyMoment(state, turn({ outcome: 'broken-press-layup', events: [shot(2, 0.05, true)] }))
        ?.game,
    ).toBe(MOMENT_GAMES.fastBreak);
  });

  it('lets the clock outrank the shot: a buzzer-beater is a buzzer-beater', () => {
    const late = stateFor({ period: 4, clock: 8 });
    expect(detectKeyMoment(late, turn({ events: [shot(3, 0.1, true)], seconds: 16 }))?.game).toBe(
      MOMENT_GAMES.buzzerBeater,
    );
  });

  it('offers the steal to the defending player, and nothing else', () => {
    const state = stateFor({ playerSide: 1, possession: 0 });
    const stolen = turn({ outcome: 'stolen', target: 100 });
    expect(detectKeyMoment(state, stolen)?.game).toBe(MOMENT_GAMES.steal);
    expect(detectKeyMoment(state, turn({ events: [shot(3, 0.1, true)] }))).toBeNull();
  });

  it('names the athlete whose moment it is', () => {
    const state = stateFor();
    const proposed = detectKeyMoment(state, turn({ actor: 3, events: [shot(3, 0.1, true)] }));
    expect(proposed?.actor).toBe(3);
  });

  it('offers nothing when there is nobody to name', () => {
    const state = stateFor();
    const anonymous = { ...turn({ events: [shot(3, 0.1, true)] }) } as Record<string, unknown>;
    delete anonymous['actor'];
    expect(detectKeyMoment(state, anonymous as never)).toBeNull();
  });

  it('says something short before the moment starts', () => {
    const state = stateFor();
    const proposed = detectKeyMoment(state, turn({ events: [shot(3, 0.1, true)] }));
    expect(proposed?.prompt.split(' ').length).toBeLessThanOrEqual(10);
  });
});

describe('leverage', () => {
  it('is the base early in a blowout', () => {
    expect(leverageFor(stateFor({ period: 1, clock: 700 }), 0.3)).toBeCloseTo(0.3, 5);
  });

  it('climbs towards one as the match gets late and close', () => {
    const late = stateFor({ period: 4, clock: 10, score: [88, 88] as never });
    expect(leverageFor(late, 0.3)).toBeGreaterThan(0.8);
  });

  it('stays low late in a blowout — a garbage-time three is not clutch', () => {
    const blowout = stateFor({ period: 4, clock: 10, score: [110, 70] as never });
    expect(leverageFor(blowout, 0.3)).toBeCloseTo(0.3, 5);
  });

  it('puts a buzzer-beater above the clutch threshold whenever it is close', () => {
    const state = stateFor({ period: 4, clock: 5, score: [90, 92] as never });
    expect(leverageFor(state, 0.82)).toBeGreaterThan(0.75);
  });

  it('never leaves the unit range', () => {
    for (const base of [0, 0.5, 1]) {
      const value = leverageFor(stateFor({ period: 4, clock: 0, score: [1, 1] as never }), base);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('the arcade run', () => {
  it('is one attempt, unrewarded, and calibrated for the athlete whose moment it is', () => {
    const state = stateFor();
    const config = keyMomentConfig(state, invocation(MOMENT_GAMES.wideOpenThree, 2), 'seed');
    expect(config).toMatchObject({ mode: 'practice', rules: KEY_MOMENT_RULES });
    expect(config?.athlete.id).toBe(findAthlete(state, 2)?.athlete.id);
  });

  it('seeds from the match and the turn, so a replay replays its moments', () => {
    const state = stateFor({ turn: 7 });
    expect(keyMomentConfig(state, invocation(MOMENT_GAMES.fastBreak), 'abc')?.seed).toBe(
      'abc:key-7',
    );
  });

  it('refuses to configure a moment for an athlete who is not on the floor', () => {
    expect(keyMomentConfig(stateFor(), invocation(MOMENT_GAMES.steal, 999), 's')).toBeNull();
  });

  it('starts through the shared arcade door, not around it', () => {
    const state = stateFor();
    const run = startKeyMoment(
      BASKETBALL_ARCADE,
      state,
      invocation(MOMENT_GAMES.clutchFreeThrow),
      'seed',
    );
    expect(run).not.toBeNull();
    expect(run?.view().calibration.windowSeconds).toBeGreaterThan(0);
  });

  it('returns null for a game the sport does not have', () => {
    expect(startKeyMoment(BASKETBALL_ARCADE, stateFor(), invocation('nope'), 's')).toBeNull();
  });

  it('reads an untouched run as a miss rather than throwing', () => {
    const run = startKeyMoment(
      BASKETBALL_ARCADE,
      stateFor(),
      invocation(MOMENT_GAMES.wideOpenThree),
      's',
    );
    expect(run).not.toBeNull();
    expect(outcomeOf(run as never)).toEqual({ made: false, quality: 0 });
  });

  it('plays to its single attempt and reports what happened', () => {
    const run = startKeyMoment(
      BASKETBALL_ARCADE,
      stateFor(),
      invocation(MOMENT_GAMES.clutchFreeThrow),
      's',
    );
    let previous = pressFrame();
    const result = playKeyMoment(run as never, (step) => {
      previous = step % 30 < 3 ? pressFrame(previous) : pressFrame();
      return previous;
    });
    expect(typeof result.made).toBe('boolean');
    expect(result.quality).toBeGreaterThanOrEqual(0);
    expect(result.quality).toBeLessThanOrEqual(1);
  });
});

describe('folding the result back in', () => {
  const state = stateFor();

  it('turns a made key-moment three into three points and one shot event', () => {
    const before = turn({ outcome: 'missed-three', points: 0, events: [shot(3, 0.1, false)] });
    const after = applyKeyMomentOutcome(state, before, outcome(MOMENT_GAMES.wideOpenThree, true));

    expect(after.outcome).toBe('made-three');
    expect(after.points).toBe(3);
    expect(after.scores).toEqual([{ points: 3, actor: 0 }]);
    expect(after.events.filter((entry) => entry.kind === 'shot')).toHaveLength(1);
    expect(after.events.find((entry) => entry.kind === 'shot')?.detail).toMatchObject({
      made: true,
      keyMoment: true,
    });
  });

  it('turns a missed one into nothing, and keeps the board the sim gave out', () => {
    const rebound = {
      kind: 'rebound' as const,
      step: 0,
      side: 0 as const,
      actor: 1,
      detail: { kind: 'offensive' },
    };
    const before = turn({
      outcome: 'made-three',
      points: 3,
      retainsPossession: true,
      events: [shot(3, 0.1, true), rebound],
    });
    const after = applyKeyMomentOutcome(state, before, outcome(MOMENT_GAMES.wideOpenThree, false));

    expect(after.points).toBe(0);
    expect(after.scores).toEqual([]);
    expect(after.retainsPossession).toBe(true);
    expect(after.events).toContain(rebound);
  });

  it('never leaves the sim’s own shot in the stream beside the player’s (INV-9)', () => {
    const before = turn({ events: [shot(2, 0.4, true)] });
    const after = applyKeyMomentOutcome(state, before, outcome(MOMENT_GAMES.fastBreak, false));
    expect(after.events.filter((entry) => entry.kind === 'shot')).toHaveLength(1);
  });

  it('shoots the first free throw and leaves the rest as the sim drew them', () => {
    const freeThrow = (made: boolean) => ({
      kind: 'shot' as const,
      step: 0,
      side: 0 as const,
      actor: 0,
      value: 1,
      detail: { zone: 'freeThrow', made },
    });
    const before = turn({
      outcome: 'free-throws',
      points: 1,
      events: [freeThrow(false), freeThrow(true)],
      scores: [{ points: 1, actor: 0 }],
    });
    const after = applyKeyMomentOutcome(state, before, outcome(MOMENT_GAMES.clutchFreeThrow, true));

    const attempts = after.events.filter((entry) => (entry.detail ?? {}).zone === 'freeThrow');
    expect(attempts).toHaveLength(2);
    expect(after.points).toBe(2);
    expect(after.scores?.every((score) => score.points === 1)).toBe(true);
  });

  it('takes the possession outright on a made steal', () => {
    const defending = stateFor({ playerSide: 1 });
    const before = turn({ outcome: 'made-two', points: 2, events: [shot(2, 0.4, true)] });
    const after = applyKeyMomentOutcome(defending, before, outcome(MOMENT_GAMES.steal, true, 100));

    expect(after.outcome).toBe('stolen');
    expect(after.points).toBe(0);
    expect(after.retainsPossession).toBe(false);
    expect(after.events.some((entry) => entry.kind === 'turnover')).toBe(true);
    expect(after.events.some((entry) => entry.sportKind === 'basketball.steal')).toBe(true);
    expect(after.seconds).toBeLessThan(before.seconds);
  });

  it('lets the play stand on a missed steal, minus the steal the sim had credited', () => {
    const defending = stateFor({ playerSide: 1 });
    const before = turn({
      outcome: 'stolen',
      points: 0,
      events: [
        { kind: 'turnover' as const, step: 0, side: 0 as const, actor: 0 },
        {
          kind: 'sport' as const,
          sportKind: 'basketball.steal',
          step: 0,
          side: 1 as const,
          actor: 100,
        },
      ],
    });
    const after = applyKeyMomentOutcome(defending, before, outcome(MOMENT_GAMES.steal, false, 100));
    expect(after.events.some((entry) => entry.sportKind === 'basketball.steal')).toBe(false);
    expect(after.events.some((entry) => entry.kind === 'turnover')).toBe(true);
  });

  it('always records what the sim would have done', () => {
    const before = turn({ events: [shot(3, 0.1, false)] });
    const after = applyKeyMomentOutcome(state, before, outcome(MOMENT_GAMES.wideOpenThree, true));
    expect(after.fromKeyMoment?.simWouldHave).toBe(false);
    expect(after.fromKeyMoment?.made).toBe(true);
  });
});

describe('through the match, end to end', () => {
  it('interrupts, settles, and books exactly the points the player earned', () => {
    const [home, away] = evenRosters('e2e');
    const match = createBasketballPlaybook({
      seed: 'e2e',
      squads: basketballSquads(home, away),
      playerSide: 0,
      keyMoments: 'every',
    });

    let settled = 0;
    let guard = 0;
    while (!match.finished && guard < 60) {
      for (const side of [0, 1] as const) {
        const call = match.autoCall(side);
        if (call !== null) match.submit(call);
      }
      match.resolve();
      if (match.phase === 'key-moment') {
        match.settleKeyMoment({ made: true, quality: 1 });
        settled += 1;
      }
      match.advance();
      guard += 1;
    }

    expect(settled).toBeGreaterThan(0);

    const box = createBoxScore();
    for (const entry of match.events) applyEvent(box, entry);
    expect(teamLine(box, 0).points).toBe(match.view().score[0]);
    expect(teamLine(box, 1).points).toBe(match.view().score[1]);
  });

  it('keeps the possession count honest — a key moment is one shot, not two', () => {
    const [home, away] = evenRosters('count');
    const match = createBasketballPlaybook({
      seed: 'count',
      squads: basketballSquads(home, away),
      playerSide: 0,
      keyMoments: 'every',
    });

    for (let i = 0; i < 40; i += 1) {
      for (const side of [0, 1] as const) {
        const call = match.autoCall(side);
        if (call !== null) match.submit(call);
      }
      match.resolve();
      if (match.phase === 'key-moment') match.settleKeyMoment({ made: false, quality: 0.2 });
      match.advance();
    }

    for (const resolved of match.turns) {
      const fieldGoals = resolved.events.filter(
        (entry) => entry.kind === 'shot' && (entry.detail ?? {}).zone !== 'freeThrow',
      );
      expect(fieldGoals.length).toBeLessThanOrEqual(1);
    }
  });

  it('resolves an unplayed possession with the sim’s own outcome when moments are off', () => {
    const state = stateFor();
    const resolution = resolvePossession({
      state,
      calls: pair('spot-up', 'man'),
      rng: createRng('off'),
    });
    expect(resolution.fromKeyMoment).toBeUndefined();
  });
});
