/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.2 — Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts
 * @story   US-3.1 — Play a 5v5 basketball match
 * @story   US-2.4 — See the state of the match at a glance
 * @design  06-game-design.md §3.1
 *
 * Purpose: the rule book, tested as the pure data it is — no world, no renderer, no clock. Every
 * count that can end a possession gets its own case, because "the shot clock never actually fired"
 * is the kind of bug a match-level test hides behind plausible-looking output.
 */
import { describe, expect, it } from 'vitest';
import { EventKind } from '@/engine/match/events.ts';
import { CENTRE_X, CENTRE_Y, COURT } from '@/sports/basketball/court.ts';
import {
  BASKETBALL_RULES,
  BasketballEvent,
  CLOCK_COMPRESSION,
  RestartKind,
  ShotClockReset,
  TIMING,
  awardRestart,
  checkBackcourt,
  checkOutOfBounds,
  completeRestart,
  createRulesState,
  formatClock,
  gameClockSeconds,
  gameSecondsToSteps,
  grantPossession,
  inboundAfterScoreSpot,
  markRestartReady,
  onBasketMade,
  onPeriodStart,
  registerTouch,
  shotClockSeconds,
  tickClocks,
  type RulesState,
} from '@/sports/basketball/rules.ts';

/** Runs the live-ball clocks for `steps`, collecting everything they produce. */
function run(state: RulesState, steps: number, ballX = CENTRE_X + 5) {
  const events = [];
  for (let i = 0; i < steps; i++) events.push(...tickClocks(state, ballX, i));
  return events;
}

function sportKinds(events: readonly { sportKind?: string; kind: string }[]): string[] {
  return events.map((e) => e.sportKind ?? e.kind);
}

describe('the clock', () => {
  it('compresses twelve game minutes into three real ones', () => {
    expect(CLOCK_COMPRESSION).toBe(4);
    expect(BASKETBALL_RULES.periods).toBe(4);
    expect(BASKETBALL_RULES.periodSteps).toBe(180 * 60);
    // Twelve game minutes of quarter, at 60 Hz, is the same 10 800 steps.
    expect(gameSecondsToSteps(TIMING.quarterGameSeconds)).toBe(BASKETBALL_RULES.periodSteps);
  });

  it('does not run through a stoppage', () => {
    expect(BASKETBALL_RULES.clockRunsInStoppage).toBe(false);
  });

  it('counts the quarter down in game seconds', () => {
    expect(gameClockSeconds(0, 1)).toBe(720);
    expect(gameClockSeconds(BASKETBALL_RULES.periodSteps / 2, 1)).toBe(360);
    expect(gameClockSeconds(BASKETBALL_RULES.periodSteps, 1)).toBe(0);
    // Never negative, and overtime is its own length.
    expect(gameClockSeconds(BASKETBALL_RULES.periodSteps + 500, 1)).toBe(0);
    expect(gameClockSeconds(0, 5)).toBe(TIMING.overtimeGameSeconds);
  });

  it('formats as a basketball clock does', () => {
    expect(formatClock(720)).toBe('12:00');
    expect(formatClock(65.4)).toBe('1:05');
    expect(formatClock(59.9)).toBe('59.9');
    expect(formatClock(4.25)).toBe('4.3');
    expect(formatClock(-3)).toBe('0.0');
  });
});

describe('the shot clock', () => {
  function livePossession(): RulesState {
    const state = createRulesState(0);
    grantPossession(state, 0, 0, ShotClockReset.FULL, CENTRE_X + 5);
    state.frontcourt = true;
    return state;
  }

  it('starts at 24 game seconds', () => {
    const state = livePossession();
    expect(shotClockSeconds(state)).toBeCloseTo(24, 6);
    expect(state.shotClock).toBe(gameSecondsToSteps(24));
  });

  it('expires into a turnover and a throw-in for the other side', () => {
    const state = livePossession();
    const quiet = run(state, state.shotClock - 1);
    expect(quiet).toEqual([]);

    const events = run(state, 1);
    expect(sportKinds(events)).toEqual([
      BasketballEvent.SHOT_CLOCK_VIOLATION,
      EventKind.TURNOVER,
      BasketballEvent.RESTART,
      BasketballEvent.SHOT_CLOCK_RESET,
    ]);
    expect(events[1]?.side).toBe(0);
    expect(state.restart).toMatchObject({ side: 1, kind: RestartKind.THROW_IN });
    expect(state.possession).toBe(-1);
  });

  it('resets to 14 after an offensive rebound, and never adds time', () => {
    const state = livePossession();
    run(state, gameSecondsToSteps(8));
    grantPossession(state, 0, 0, ShotClockReset.OFFENSIVE_REBOUND, CENTRE_X + 5);
    expect(shotClockSeconds(state)).toBeCloseTo(14, 6);

    // Now with less than 14 left: the rebound must not hand time back.
    run(state, gameSecondsToSteps(9));
    grantPossession(state, 0, 0, ShotClockReset.OFFENSIVE_REBOUND, CENTRE_X + 5);
    expect(shotClockSeconds(state)).toBeCloseTo(5, 6);
  });

  it('keeps running through a live touch that does not change possession', () => {
    const state = livePossession();
    run(state, gameSecondsToSteps(10));
    const before = state.shotClock;
    grantPossession(state, 0, 0, ShotClockReset.KEEP, CENTRE_X + 5);
    expect(state.shotClock).toBe(before);
  });

  it('is stopped while the ball is dead', () => {
    const state = livePossession();
    awardRestart(
      state,
      { kind: RestartKind.THROW_IN, side: 1, x: 0, y: CENTRE_Y, reason: 'test' },
      0,
    );
    expect(state.shotClockRunning).toBe(false);
    const before = state.shotClock;
    run(state, 100);
    expect(state.shotClock).toBe(before);
  });
});

describe('advancing the ball', () => {
  it('has no eight-second count — the compressed clock makes one unplayable', () => {
    const state = createRulesState(0);
    // Side 0 attacks high x, so x = 3 is deep in its own backcourt.
    grantPossession(state, 0, 0, ShotClockReset.FULL, 3);
    expect(state.frontcourt).toBe(false);

    // Dawdling in the backcourt costs the shot clock and nothing else.
    const events = run(state, gameSecondsToSteps(20), 3);
    expect(events).toEqual([]);
  });

  it('arms the over-and-back rule when the ball crosses the centre line', () => {
    const state = createRulesState(0);
    grantPossession(state, 0, 0, ShotClockReset.FULL, 3);
    run(state, 60, CENTRE_X + 2);
    expect(state.frontcourt).toBe(true);
  });

  it('turns the ball over if it goes back to the backcourt', () => {
    const state = createRulesState(0);
    grantPossession(state, 0, 0, ShotClockReset.FULL, CENTRE_X + 2);
    expect(state.frontcourt).toBe(true);

    expect(checkBackcourt(state, CENTRE_X + 1, 5)).toEqual([]);
    const events = checkBackcourt(state, CENTRE_X - 0.5, 5);
    expect(sportKinds(events)).toEqual([
      BasketballEvent.BACKCOURT_VIOLATION,
      EventKind.TURNOVER,
      BasketballEvent.RESTART,
      BasketballEvent.SHOT_CLOCK_RESET,
    ]);
    expect(state.restart?.side).toBe(1);
  });

  it('does not call a backcourt violation before the frontcourt was established', () => {
    const state = createRulesState(0);
    grantPossession(state, 0, 0, ShotClockReset.FULL, 3);
    expect(checkBackcourt(state, 2, 5)).toEqual([]);
  });
});

describe('out of bounds', () => {
  it('awards against whoever touched it last', () => {
    const state = createRulesState(0);
    grantPossession(state, 0, 0, ShotClockReset.FULL, CENTRE_X + 5);
    registerTouch(state, 0);

    const events = checkOutOfBounds(state, 9, -0.4, 12);
    expect(sportKinds(events)).toEqual([
      BasketballEvent.OUT_OF_BOUNDS,
      EventKind.TURNOVER,
      BasketballEvent.RESTART,
      BasketballEvent.SHOT_CLOCK_RESET,
    ]);
    expect(state.restart).toMatchObject({ side: 1, x: 9, y: 0 });
  });

  it('does nothing while the ball is on the court', () => {
    const state = createRulesState(0);
    grantPossession(state, 0, 0, ShotClockReset.FULL, CENTRE_X + 5);
    expect(checkOutOfBounds(state, CENTRE_X, CENTRE_Y, 5)).toEqual([]);
  });

  it('uses the arrow when nobody had touched it, and flips it', () => {
    const state = createRulesState(1);
    const events = checkOutOfBounds(state, -1, CENTRE_Y, 5);
    expect(state.restart?.side).toBe(1);
    expect(state.arrow).toBe(0);
    // No turnover: there was nobody to charge it to.
    expect(sportKinds(events)).not.toContain(EventKind.TURNOVER);
  });

  it('is not checked while a restart is already pending', () => {
    const state = createRulesState(0);
    awardRestart(
      state,
      { kind: RestartKind.THROW_IN, side: 0, x: 0, y: CENTRE_Y, reason: 'test' },
      0,
    );
    expect(checkOutOfBounds(state, -5, -5, 5)).toEqual([]);
  });
});

describe('restarts', () => {
  function pendingThrowIn(): RulesState {
    const state = createRulesState(0);
    awardRestart(
      state,
      { kind: RestartKind.THROW_IN, side: 0, x: 3, y: 0, reason: 'out of bounds' },
      0,
    );
    return state;
  }

  it('leaves the ball dead and the clocks stopped', () => {
    const state = pendingThrowIn();
    expect(state.possession).toBe(-1);
    expect(state.shotClockRunning).toBe(false);
    expect(state.restartReady).toBe(false);
  });

  it('does not start the five-second count until the inbounder has the ball', () => {
    const state = pendingThrowIn();
    // Walking to the spot takes as long as it takes.
    expect(run(state, 600)).toEqual([]);
    expect(state.restart).not.toBeNull();

    markRestartReady(state, 0);
    expect(run(state, state.restartClock - 1)).toEqual([]);
    const events = run(state, 1);
    expect(sportKinds(events)).toEqual([
      BasketballEvent.INBOUND_VIOLATION,
      EventKind.TURNOVER,
      BasketballEvent.RESTART,
      BasketballEvent.SHOT_CLOCK_RESET,
    ]);
    expect(state.restart?.side).toBe(1);
  });

  it('only arms the five-second count once', () => {
    const state = pendingThrowIn();
    expect(markRestartReady(state, 0)).toHaveLength(1);
    run(state, 30);
    expect(markRestartReady(state, 0)).toEqual([]);
    expect(state.restartClock).toBe(gameSecondsToSteps(TIMING.inboundGameSeconds) - 30);
  });

  it('makes the ball live again, with the frontcourt read from where it was inbounded', () => {
    const state = pendingThrowIn();
    const events = completeRestart(state, 7, 3);
    expect(sportKinds(events)).toEqual([BasketballEvent.RESTART_COMPLETE, EventKind.POSSESSION]);
    expect(state.possession).toBe(0);
    expect(state.restart).toBeNull();
    expect(state.shotClockRunning).toBe(true);
    // x = 3 is side 0's backcourt, so the eight-second count is on.
    expect(state.frontcourt).toBe(false);
  });

  it('starts no eight-second count on a frontcourt throw-in', () => {
    const state = pendingThrowIn();
    completeRestart(state, 7, COURT.length - 3);
    expect(state.frontcourt).toBe(true);
  });
});

describe('period starts and made baskets', () => {
  it('opens the match with a tip-off owned by nobody', () => {
    const state = createRulesState(0);
    onPeriodStart(state, 1, 0);
    expect(state.restart).toMatchObject({ kind: RestartKind.TIP_OFF, side: -1 });
    expect(state.possession).toBe(-1);
    // A tip-off has no five-second count to run out of.
    expect(run(state, 1000)).toEqual([]);
  });

  it('starts later periods with the arrow, then flips it', () => {
    const state = createRulesState(1);
    onPeriodStart(state, 2, 0);
    expect(state.restart?.side).toBe(1);
    expect(state.arrow).toBe(0);

    onPeriodStart(state, 3, 0);
    expect(state.restart?.side).toBe(0);
    expect(state.arrow).toBe(1);
  });

  it('gives the conceding side the ball on its own baseline', () => {
    const state = createRulesState(0);
    const events = onBasketMade(state, 0, 40);
    expect(sportKinds(events)).toEqual([BasketballEvent.RESTART, BasketballEvent.SHOT_CLOCK_RESET]);
    expect(state.restart).toMatchObject({ kind: RestartKind.AFTER_SCORE, side: 1 });
    // Side 1 defends the high-x basket, so it inbounds from that baseline.
    expect(state.restart?.x).toBe(COURT.length);
    expect(inboundAfterScoreSpot(1)).toEqual({ x: COURT.length, y: CENTRE_Y + 3 });
    expect(inboundAfterScoreSpot(0)).toEqual({ x: 0, y: CENTRE_Y + 3 });
  });

  it('ignores a score attributed to nobody', () => {
    const state = createRulesState(0);
    expect(onBasketMade(state, -1, 40)).toEqual([]);
    expect(state.restart).toBeNull();
  });
});
