/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.2 — Soccer Live rules: halves, clock, stoppage, throw-ins, corners, goal kicks
 * @story   US-4.1 — Play an 11v11 soccer match
 * @design  06-game-design.md §3.2
 *
 * Purpose: pins the two rules a soccer game gets wrong most often — the three-way split on the
 * goal line (out off the attacker is a goal kick, out off the defender is a corner) and added
 * time, which has to end up matching the board rather than approximating it.
 */
import { describe, expect, it } from 'vitest';
import { EventKind } from '@/engine/match/events.ts';
import { MatchStateMachine } from '@/engine/match/state-machine.ts';
import { CENTRE_X, CENTRE_Y, PITCH } from '@/sports/soccer/pitch.ts';
import {
  ADDED_TIME,
  CLOCK_COMPRESSION,
  RestartKind,
  SOCCER_RULES,
  SoccerEvent,
  TIMING,
  accrueAddedTime,
  awardRestart,
  completeRestart,
  createRulesState,
  elapsedGameSeconds,
  formatClock,
  gameSecondsToSteps,
  grantPossession,
  isBallDead,
  onGoalScored,
  opponent,
  pendingExtensionSteps,
  periodGameSeconds,
  readyRestart,
  registerTouch,
  remainingGameSeconds,
  restartFor,
  startHalf,
  stepsToGameSeconds,
  tickRestart,
} from '@/sports/soccer/rules.ts';

function sportKinds(events: readonly { sportKind?: string }[]): string[] {
  return events.map((e) => e.sportKind ?? '').filter((k) => k !== '');
}

describe('format and clock', () => {
  it('is two halves with the clock running through stoppages', () => {
    expect(SOCCER_RULES.periods).toBe(2);
    expect(SOCCER_RULES.clockRunsInStoppage).toBe(true);
    expect(SOCCER_RULES.periodSteps).toBe(TIMING.halfRealSeconds * 60);
  });

  it('compresses four real minutes into forty-five game minutes', () => {
    expect(CLOCK_COMPRESSION).toBeCloseTo(11.25, 6);
    expect(stepsToGameSeconds(SOCCER_RULES.periodSteps)).toBeCloseTo(TIMING.halfGameSeconds, 6);
    expect(gameSecondsToSteps(TIMING.halfGameSeconds)).toBe(SOCCER_RULES.periodSteps);
  });

  it('round-trips game seconds through steps', () => {
    for (const seconds of [0, 30, 60, 2700]) {
      expect(stepsToGameSeconds(gameSecondsToSteps(seconds))).toBeCloseTo(seconds, 3);
    }
  });

  it('counts up, and keeps counting into the second half', () => {
    expect(elapsedGameSeconds(0, 1)).toBe(0);
    expect(elapsedGameSeconds(SOCCER_RULES.periodSteps, 1)).toBeCloseTo(2700, 3);
    // The second half starts at 45:00, not at 0:00.
    expect(elapsedGameSeconds(0, 2)).toBe(2700);
    expect(elapsedGameSeconds(SOCCER_RULES.periodSteps, 2)).toBeCloseTo(5400, 3);
  });

  it('formats as a soccer clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(2700)).toBe('45:00');
    expect(formatClock(-5)).toBe('0:00');
  });

  it('reports the seam remaining seconds even though the sport counts up', () => {
    const state = createRulesState();
    expect(remainingGameSeconds(state, 0, 1)).toBeCloseTo(2700, 3);
    expect(remainingGameSeconds(state, SOCCER_RULES.periodSteps, 1)).toBe(0);
    // Never negative, however far past the whistle.
    expect(remainingGameSeconds(state, SOCCER_RULES.periodSteps * 2, 1)).toBe(0);
  });
});

describe('restarts from the boundary', () => {
  it('gives a throw-in to the side that did not put it out', () => {
    const restart = restartFor(40, PITCH.width + 0.5, 0);
    expect(restart).toMatchObject({ kind: RestartKind.THROW_IN, side: 1, y: PITCH.width });
    expect(restartFor(40, -0.5, 1)).toMatchObject({ kind: RestartKind.THROW_IN, side: 0, y: 0 });
  });

  it('gives a corner when the defence put it behind', () => {
    // Side 0 defends the low goal line; side 0 touched it last.
    const restart = restartFor(-0.5, 60, 0);
    expect(restart).toMatchObject({ kind: RestartKind.CORNER_KICK, side: 1 });
    expect(restart?.y).toBeGreaterThan(CENTRE_Y);
  });

  it('gives a goal kick when the attack put it behind', () => {
    // Over side 0's goal line, last touched by side 1 — the attacking side.
    const restart = restartFor(-0.5, 60, 1);
    expect(restart).toMatchObject({ kind: RestartKind.GOAL_KICK, side: 0 });
    expect(restart?.x).toBeGreaterThan(0);
    expect(restart?.x).toBeLessThan(PITCH.goalAreaDepth);
  });

  it('is the same rule at the other end', () => {
    expect(restartFor(PITCH.length + 0.5, 20, 1)).toMatchObject({
      kind: RestartKind.CORNER_KICK,
      side: 0,
    });
    expect(restartFor(PITCH.length + 0.5, 20, 0)).toMatchObject({
      kind: RestartKind.GOAL_KICK,
      side: 1,
    });
  });

  it('is nothing at all for a ball still on the pitch, or one nobody has touched', () => {
    expect(restartFor(CENTRE_X, CENTRE_Y, 0)).toBeNull();
    expect(restartFor(-1, CENTRE_Y, -1)).toBeNull();
  });

  it('attributes a ball over the corner to the line it went furthest past', () => {
    // Barely behind, well over the touchline: a throw-in, not a corner.
    expect(restartFor(-0.1, PITCH.width + 2, 0)?.kind).toBe(RestartKind.THROW_IN);
    expect(restartFor(-2, PITCH.width + 0.1, 0)?.kind).toBe(RestartKind.CORNER_KICK);
  });
});

describe('taking a restart', () => {
  it('kills the ball, hands it over, and brings it back on completion', () => {
    const state = createRulesState();
    const restart = restartFor(40, -0.5, 1);
    expect(restart).not.toBeNull();

    const awarded = awardRestart(state, restart!, 100);
    expect(sportKinds(awarded)).toEqual([SoccerEvent.RESTART]);
    expect(isBallDead(state)).toBe(true);
    expect(state.possession).toBe(0);

    expect(sportKinds(readyRestart(state, 110))).toEqual([SoccerEvent.RESTART_READY]);
    const done = completeRestart(state, 120);
    expect(sportKinds(done)).toEqual([SoccerEvent.RESTART_COMPLETE]);
    expect(isBallDead(state)).toBe(false);
    expect(state.lastTouch).toBe(0);
  });

  it('does not start the count until the taker is at the spot', () => {
    const state = createRulesState();
    awardRestart(state, restartFor(40, -0.5, 1)!, 0);
    // Never readied: the clock does not run, so it can never be forfeited.
    for (let i = 0; i < gameSecondsToSteps(TIMING.restartGameSeconds) * 2; i++) {
      expect(tickRestart(state, i)).toEqual([]);
    }
    expect(state.restart?.side).toBe(0);
  });

  it('cannot be readied during a celebration, and can be once it ends', () => {
    const state = createRulesState();
    onGoalScored(state, 0, 0);
    expect(readyRestart(state, 1)).toEqual([]);

    const delay = gameSecondsToSteps(TIMING.celebrationGameSeconds);
    for (let i = 0; i < delay; i++) tickRestart(state, i);
    expect(sportKinds(readyRestart(state, delay))).toEqual([SoccerEvent.RESTART_READY]);
  });

  it('gives the restart away to the other side when it is sat on', () => {
    const state = createRulesState();
    awardRestart(state, restartFor(40, -0.5, 1)!, 0);
    readyRestart(state, 0);

    const limit = gameSecondsToSteps(TIMING.restartGameSeconds);
    let events: readonly { kind: string; sportKind?: string }[] = [];
    for (let i = 0; i < limit; i++) {
      events = tickRestart(state, i);
      if (events.length > 0) break;
    }
    expect(sportKinds(events)).toEqual([SoccerEvent.RESTART_FORFEIT, SoccerEvent.RESTART]);
    expect(events.some((e) => e.kind === EventKind.TURNOVER)).toBe(true);
    expect(state.restart?.side).toBe(1);
    expect(state.restart?.reason).toBe('time-wasting');
  });

  it('does nothing when there is no restart to tick', () => {
    const state = createRulesState();
    expect(tickRestart(state, 0)).toEqual([]);
    expect(completeRestart(state, 0)).toEqual([]);
    expect(readyRestart(state, 0)).toEqual([]);
  });
});

describe('kick-off and possession', () => {
  it('alternates halves off the coin toss, and never drifts', () => {
    const state = createRulesState(1);
    startHalf(state, 1, 0);
    expect(state.restart).toMatchObject({ kind: RestartKind.KICK_OFF, side: 1, x: CENTRE_X });

    startHalf(state, 2, 0);
    expect(state.restart?.side).toBe(0);

    // Extra time carries the alternation on rather than tossing again.
    startHalf(state, 3, 0);
    expect(state.restart?.side).toBe(1);
  });

  it('has the side that conceded kick off, and does not disturb the half alternation', () => {
    const state = createRulesState(0);
    startHalf(state, 1, 0);
    onGoalScored(state, 0, 500);
    expect(state.restart).toMatchObject({ kind: RestartKind.KICK_OFF, side: 1 });

    startHalf(state, 2, 1000);
    expect(state.restart?.side).toBe(1);
  });

  it('emits possession only when it actually changes', () => {
    const state = createRulesState();
    expect(grantPossession(state, 0, 0)).toHaveLength(1);
    expect(grantPossession(state, 0, 1)).toEqual([]);
    expect(grantPossession(state, 1, 2)).toHaveLength(1);
  });

  it('ignores a touch by nobody', () => {
    const state = createRulesState();
    registerTouch(state, 1);
    registerTouch(state, -1);
    expect(state.lastTouch).toBe(1);
  });

  it('names the other side', () => {
    expect(opponent(0)).toBe(1);
    expect(opponent(1)).toBe(0);
  });
});

describe('added time', () => {
  it('buys nothing back for a throw-in and something for a goal', () => {
    const state = createRulesState();
    // A restart on its own accrues nothing — only the listed causes do.
    awardRestart(state, restartFor(40, -0.5, 1)!, 0);
    expect(state.boardAddedMinutes).toBe(0);

    accrueAddedTime(state, 'goal', 10);
    expect(state.addedGameSeconds).toBe(ADDED_TIME.goal);
    expect(state.boardAddedMinutes).toBe(1);
  });

  it('rounds the board up to whole minutes and only announces a rise', () => {
    const state = createRulesState();
    expect(sportKinds(accrueAddedTime(state, 'card', 0))).toEqual([SoccerEvent.ADDED_TIME]);
    expect(state.boardAddedMinutes).toBe(1);
    // 30 + 30 = 60s: still one minute, so nothing new to announce.
    expect(accrueAddedTime(state, 'card', 1)).toEqual([]);
    expect(state.boardAddedMinutes).toBe(1);
    // 60 + 60 = 120s: two minutes, announced.
    expect(sportKinds(accrueAddedTime(state, 'penalty', 2))).toEqual([SoccerEvent.ADDED_TIME]);
    expect(state.boardAddedMinutes).toBe(2);
  });

  it('caps the board however chaotic the half gets', () => {
    const state = createRulesState();
    for (let i = 0; i < 40; i++) accrueAddedTime(state, 'injury', i);
    expect(state.boardAddedMinutes).toBe(ADDED_TIME.maxBoardMinutes);
  });

  it('resets at the start of a half', () => {
    const state = createRulesState();
    accrueAddedTime(state, 'injury', 0);
    startHalf(state, 2, 100);
    expect(state.addedGameSeconds).toBe(0);
    expect(state.boardAddedMinutes).toBe(0);
  });

  it('lengthens the period by exactly what the board says', () => {
    const state = createRulesState();
    accrueAddedTime(state, 'penalty', 0);
    accrueAddedTime(state, 'goal', 1);
    expect(state.boardAddedMinutes).toBe(2);

    // Paid in instalments, the total is the board figure and no more.
    let extended = 0;
    extended += pendingExtensionSteps(state, extended);
    expect(extended).toBe(gameSecondsToSteps(2 * 60));
    expect(pendingExtensionSteps(state, extended)).toBe(0);

    expect(periodGameSeconds(state, 1)).toBe(TIMING.halfGameSeconds + 120);
    expect(periodGameSeconds(state, 3)).toBe(TIMING.extraTimeGameSeconds + 120);
  });
});

describe('against the match clock', () => {
  it('runs the period clock through a stoppage, unlike basketball', () => {
    const machine = new MatchStateMachine(SOCCER_RULES);
    machine.start();
    machine.step();
    machine.stoppage('throw-in');
    const before = machine.stepInPeriod;
    machine.step();
    machine.step();
    expect(machine.stepInPeriod).toBe(before + 2);
    machine.resume();
  });

  it('ends the half later when the board has added time to it', () => {
    const state = createRulesState();
    const machine = new MatchStateMachine(SOCCER_RULES);
    machine.start();

    accrueAddedTime(state, 'goal', 0);
    machine.extendPeriod(pendingExtensionSteps(state, machine.extension));
    expect(machine.extension).toBe(gameSecondsToSteps(60));

    // Run out the nominal half: it is not over, because a minute was added.
    for (let i = 0; i < SOCCER_RULES.periodSteps; i++) machine.step();
    expect(machine.currentPhase).toBe('live');
    expect(machine.stepsRemaining).toBe(machine.extension);

    for (let i = 0; i < machine.extension; i++) machine.step();
    expect(machine.currentPhase).toBe('periodBreak');
  });

  it('clears the extension when the next half begins', () => {
    const machine = new MatchStateMachine(SOCCER_RULES);
    machine.start();
    machine.extendPeriod(600);
    for (let i = 0; i < SOCCER_RULES.periodSteps + 600; i++) machine.step();
    machine.nextPeriod();
    expect(machine.extension).toBe(0);
    expect(machine.stepsRemaining).toBe(SOCCER_RULES.periodSteps);
  });
});
