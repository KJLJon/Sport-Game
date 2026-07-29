/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.2 — Soccer Live rules: halves, clock, stoppage, throw-ins, corners, goal kicks
 * @story   US-4.1 — Play an 11v11 soccer match
 * @story   US-2.4 — See the state of the match at a glance
 * @design  06-game-design.md §3.2 (format and rules), 04-architecture.md §5 (the sport module seam)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-9 (one event stream)
 *
 * Purpose: the rule book. Two halves, a clock that never stops, added time, and the four ways play
 * restarts when the ball leaves the pitch. Plain data and pure functions over it, so the whole rule
 * book tests without a world, a renderer, or a clock — and serialises straight into a replay or
 * across the P2P wire.
 *
 * **Clock compression.** A half is four real minutes showing forty-five game minutes (`06` §3.2), an
 * 11.25× compression. Every duration is authored in *game* seconds — the number on the HUD — and
 * converted to steps in one place, so "45:00" is 45:00 on the HUD and the arithmetic that makes it
 * four real minutes lives here.
 *
 * **The clock never stops, and that is the whole difference from basketball.** `MatchRules` already
 * had `clockRunsInStoppage` waiting for exactly this. A throw-in, a goal kick, a quick free kick —
 * the clock runs through all of them, and the player never gets the time back. That is soccer, and
 * it is why added time exists at all.
 *
 * **Added time is a subset of stoppages, not all of them.** Only the long ones buy time back: a
 * goal celebration, a card, a penalty, an injury, a substitution. A throw-in does not, however long
 * the thrower dawdles. Each qualifying stoppage accrues its allowance; the board shows the accrual
 * rounded *up* to whole minutes, and the half is extended by exactly what the board shows — so the
 * half really does last as long as the fourth official said, which is the one thing about added
 * time that everybody notices.
 *
 * Extending the half is the one thing this module cannot do on its own: the period's length belongs
 * to `MatchStateMachine`, so T-6.2 added a generic `extendPeriod()` there. See the Phase 6 notes for
 * why that is a core improvement rather than soccer leaking into the engine.
 *
 * **Ends do not swap at half time.** Real teams change ends; this game keeps side 0 attacking high
 * x for the whole match, exactly as `court.ts` does for basketball. Swapping would move every
 * goal, every formation, and every camera anchor twice a match to buy nothing a player would
 * notice on a phone. Recorded in the Phase 6 notes as a deliberate simplification.
 *
 * Nothing here emits events itself; every function returns them for the module's `step()` to order
 * against the match clock's own (INV-9).
 */
import { EventKind, event, type Side, type SportEvent } from '../../engine/match/events.ts';
import type { MatchRules } from '../../engine/match/state-machine.ts';
import {
  cornerSpot,
  crossedBoundary,
  goalKickSpot,
  kickOffSpot,
  throwInSpot,
  type Side as PitchSide,
} from './pitch.ts';

/** Simulation rate. Matches the engine loop's fixed step. */
const TICK_RATE = 60;

/**
 * Every duration soccer cares about, in the units the player reads them in.
 *
 * @spec-ref 06-game-design.md §3.2 — 2 halves, 4 real minutes each, compressed clock, stoppage time
 */
export const TIMING = {
  /** Real seconds a half lasts, before added time. */
  halfRealSeconds: 240,
  /** Game seconds a half shows — 45:00, as soccer does. */
  halfGameSeconds: 45 * 60,
  /** Game seconds an extra-time half shows (`06` §3.2: "extra time then penalties"). */
  extraTimeGameSeconds: 15 * 60,

  /** Game seconds to take a throw-in, corner, goal kick, or free kick before it is given away. */
  restartGameSeconds: 30,
  /** Game seconds after a goal before the restart is available — the celebration. */
  celebrationGameSeconds: 20,
} as const;

/** Game seconds per real second. Derived, never authored — the two half figures define it. */
export const CLOCK_COMPRESSION = TIMING.halfGameSeconds / TIMING.halfRealSeconds;

/** Game seconds → simulation steps. The single place compression is applied. */
export function gameSecondsToSteps(gameSeconds: number): number {
  return Math.round((gameSeconds / CLOCK_COMPRESSION) * TICK_RATE);
}

/** Simulation steps → the game seconds a HUD should show. */
export function stepsToGameSeconds(steps: number): number {
  return (steps / TICK_RATE) * CLOCK_COMPRESSION;
}

export const SOCCER_RULES: MatchRules = {
  periods: 2,
  periodSteps: TIMING.halfRealSeconds * TICK_RATE,
  overtimeSteps: gameSecondsToSteps(TIMING.extraTimeGameSeconds),
  // The clock does not stop for a throw-in, and the player does not get the time back.
  clockRunsInStoppage: true,
};

const RESTART_STEPS = gameSecondsToSteps(TIMING.restartGameSeconds);
const CELEBRATION_STEPS = gameSecondsToSteps(TIMING.celebrationGameSeconds);

/**
 * How much added time each kind of stoppage buys back, in game seconds, and the ceiling on the
 * total.
 *
 * @spec-ref 06-game-design.md §3.2 — "plus stoppage time"
 */
export const ADDED_TIME = {
  goal: 30,
  card: 30,
  penalty: 60,
  injury: 60,
  substitution: 30,
  /** Whole minutes the board will never exceed, however chaotic the half. */
  maxBoardMinutes: 6,
} as const;

/** The stoppages that buy time back. A throw-in is deliberately not one of them. */
export type AddedTimeCause = 'goal' | 'card' | 'penalty' | 'injury' | 'substitution';

/** Why play is stopped and how it starts again. */
export const RestartKind = {
  KICK_OFF: 'kickOff',
  THROW_IN: 'throwIn',
  CORNER_KICK: 'cornerKick',
  GOAL_KICK: 'goalKick',
  FREE_KICK: 'freeKick',
  PENALTY: 'penalty',
  DROP_BALL: 'dropBall',
} as const;
export type RestartKindName = (typeof RestartKind)[keyof typeof RestartKind];

/** Sport-specific event names, carried on `EventKind.SPORT` as `sportKind` (INV-9). */
export const SoccerEvent = {
  OUT_OF_PLAY: 'soccer.outOfPlay',
  RESTART: 'soccer.restart',
  RESTART_READY: 'soccer.restartReady',
  RESTART_COMPLETE: 'soccer.restartComplete',
  RESTART_FORFEIT: 'soccer.restartForfeit',
  ADDED_TIME: 'soccer.addedTime',
  KICK_OFF: 'soccer.kickOff',
} as const;

export interface Restart {
  readonly kind: RestartKindName;
  /** The side putting the ball in play. */
  readonly side: Side;
  readonly x: number;
  readonly y: number;
  /** Human-readable cause, for the HUD and the replay log. */
  readonly reason: string;
}

/**
 * The whole rule book's state. Deliberately flat and JSON-shaped: it goes into snapshots and
 * replays, and a class with methods would not.
 *
 * Fouls, cards, and advantage are T-6.4 and are not here yet — the restart *kinds* they produce
 * (`freeKick`, `penalty`) already are, so T-6.4 adds a cause rather than a new mechanism.
 */
export interface RulesState {
  /** Who has the ball, or `-1` while it is loose or dead. */
  possession: Side;
  /** Last side to touch the ball — decides every out-of-play award. */
  lastTouch: Side;
  /** Pending restart, or `null` while the ball is live. */
  restart: Restart | null;
  /** True once the taker is at the spot with the ball; the count starts only then. */
  restartReady: boolean;
  /** Steps left to take the restart. */
  restartClock: number;
  /** Steps of enforced pause before a restart can be readied — a goal celebration. */
  restartDelay: number;

  /** Game seconds of added time accrued this half, before rounding. */
  addedGameSeconds: number;
  /** Whole minutes currently on the board. Monotone within a half. */
  boardAddedMinutes: number;
  /**
   * The side that kicked off the *first* half — the coin toss, in effect. Every other kick-off is
   * derived from it rather than stored, so the alternation cannot drift: the second half is the
   * other side's, and a kick-off after a goal belongs to whoever conceded and changes nothing.
   */
  kickOffSide: PitchSide;
}

export function createRulesState(kickOffSide: PitchSide = 0): RulesState {
  return {
    possession: -1,
    lastTouch: -1,
    restart: null,
    restartReady: false,
    restartClock: 0,
    restartDelay: 0,
    addedGameSeconds: 0,
    boardAddedMinutes: 0,
    kickOffSide,
  };
}

/** The other side. Soccer asks this constantly. */
export function opponent(side: PitchSide): PitchSide {
  return side === 0 ? 1 : 0;
}

/** Records who touched the ball last, which is what decides every out-of-play award. */
export function registerTouch(state: RulesState, side: Side): void {
  if (side === 0 || side === 1) state.lastTouch = side;
}

/**
 * Hands the ball to a side with play live.
 *
 * Soccer has no shot clock and no backcourt rule, so this is the whole of granting possession —
 * which is why it is four lines where basketball's is thirty. The absence is the point: `09` §5's
 * seam does not require a sport to have an action clock, and soccer is the first sport to prove it
 * by not having one.
 */
export function grantPossession(
  state: RulesState,
  side: PitchSide,
  step: number,
  actor?: number,
): SportEvent[] {
  const changed = state.possession !== side;
  state.possession = side;
  state.lastTouch = side;
  if (!changed) return [];
  return [
    actor === undefined
      ? event(EventKind.POSSESSION, step, side)
      : event(EventKind.POSSESSION, step, side, { actor }),
  ];
}

function sportEvent(
  step: number,
  side: Side,
  sportKind: string,
  detail: Record<string, number | string | boolean>,
): SportEvent {
  return { kind: EventKind.SPORT, sportKind, step, side, detail };
}

/**
 * What the restart is when the ball leaves the pitch, given who touched it last.
 *
 * The three-way split on the goal line is the rule everyone knows and nobody writes down: out off
 * the *attacker* is a goal kick, out off the *defender* is a corner. Over a touchline it is always
 * a throw-in to the side that did not touch it last, whichever line it was.
 *
 * Returns `null` when the ball is still on the pitch, or when nobody has touched it yet — an
 * untouched ball leaving the field is a drop ball, and that is the caller's call, not geometry's.
 */
export function restartFor(x: number, y: number, lastTouch: Side): Restart | null {
  const boundary = crossedBoundary(x, y);
  if (boundary === null) return null;
  if (lastTouch !== 0 && lastTouch !== 1) return null;

  const other = opponent(lastTouch);

  if (boundary === 'touchlineLow' || boundary === 'touchlineHigh') {
    const spot = throwInSpot(x, y);
    return { kind: RestartKind.THROW_IN, side: other, x: spot.x, y: spot.y, reason: 'touchline' };
  }

  const defendingSide: PitchSide = boundary === 'goalLine0' ? 0 : 1;

  if (lastTouch === defendingSide) {
    const spot = cornerSpot(defendingSide, y);
    return {
      kind: RestartKind.CORNER_KICK,
      side: other,
      x: spot.x,
      y: spot.y,
      reason: 'behind off the defence',
    };
  }

  const spot = goalKickSpot(defendingSide, y);
  return {
    kind: RestartKind.GOAL_KICK,
    side: defendingSide,
    x: spot.x,
    y: spot.y,
    reason: 'behind off the attack',
  };
}

/**
 * Puts a restart on. Play is dead from here until `completeRestart`.
 *
 * `delaySteps` covers the pause a restart cannot be taken during — a goal celebration. The taker
 * cannot even be *ready* until it elapses, which is what stops a quick restart from cutting a
 * celebration short.
 */
export function awardRestart(
  state: RulesState,
  restart: Restart,
  step: number,
  delaySteps = 0,
): SportEvent[] {
  state.restart = restart;
  state.restartReady = false;
  state.restartClock = RESTART_STEPS;
  state.restartDelay = delaySteps;
  state.possession = restart.side;

  return [
    sportEvent(step, restart.side, SoccerEvent.RESTART, {
      kind: restart.kind,
      reason: restart.reason,
      x: restart.x,
      y: restart.y,
    }),
  ];
}

/** The taker has the ball at the spot. The count to take it starts now, and not before. */
export function readyRestart(state: RulesState, step: number): SportEvent[] {
  if (state.restart === null || state.restartReady || state.restartDelay > 0) return [];
  state.restartReady = true;
  state.restartClock = RESTART_STEPS;
  return [
    sportEvent(step, state.restart.side, SoccerEvent.RESTART_READY, {
      kind: state.restart.kind,
    }),
  ];
}

/** The restart has been taken; play is live again. */
export function completeRestart(state: RulesState, step: number): SportEvent[] {
  const restart = state.restart;
  if (restart === null) return [];

  state.restart = null;
  state.restartReady = false;
  state.restartClock = 0;
  state.restartDelay = 0;

  const events: SportEvent[] = [
    sportEvent(step, restart.side, SoccerEvent.RESTART_COMPLETE, { kind: restart.kind }),
  ];
  events.push(...grantPossession(state, restart.side as PitchSide, step));
  return events;
}

/**
 * The restart every half and every goal begins with.
 *
 * A kick-off is the one restart that is *awarded* rather than caused, so it takes the side
 * explicitly instead of deriving one from where the ball went.
 */
export function awardKickOff(
  state: RulesState,
  side: PitchSide,
  step: number,
  reason: string,
  delaySteps = 0,
): SportEvent[] {
  const spot = kickOffSpot();
  return awardRestart(
    state,
    { kind: RestartKind.KICK_OFF, side, x: spot.x, y: spot.y, reason },
    step,
    delaySteps,
  );
}

/**
 * What a period starts with: the ball on the centre spot, and the side that did not kick off the
 * first half kicking off the second.
 */
export function startHalf(state: RulesState, period: number, step: number): SportEvent[] {
  state.addedGameSeconds = 0;
  state.boardAddedMinutes = 0;
  state.lastTouch = -1;
  // Odd halves are the coin toss's, even halves the other side's. Extra time carries the same
  // alternation on rather than tossing again — one fewer random draw for a replay to reproduce.
  const side: PitchSide = period % 2 === 1 ? state.kickOffSide : opponent(state.kickOffSide);
  return awardKickOff(state, side, step, period === 1 ? 'kick-off' : 'second half');
}

/** The restart after a goal: the side that conceded kicks off, once the celebration is over. */
export function onGoalScored(
  state: RulesState,
  scoringSide: PitchSide,
  step: number,
): SportEvent[] {
  const events = accrueAddedTime(state, 'goal', step);
  events.push(
    ...awardKickOff(state, opponent(scoringSide), step, 'after a goal', CELEBRATION_STEPS),
  );
  return events;
}

/**
 * Buys time back for a long stoppage, and returns the events plus — when the board figure moves —
 * how many steps the half should be extended by.
 *
 * The board is whole minutes, rounded up, and monotone: it can rise during a half and never falls.
 * `extraSteps` is what the caller passes to `MatchStateMachine.extendPeriod`, and it is the
 * *difference* since the last rise, so extending on every call totals exactly the board figure.
 */
export function accrueAddedTime(
  state: RulesState,
  cause: AddedTimeCause,
  step: number,
): SportEvent[] {
  const before = state.boardAddedMinutes;
  state.addedGameSeconds += ADDED_TIME[cause];

  const board = Math.min(ADDED_TIME.maxBoardMinutes, Math.ceil(state.addedGameSeconds / 60));
  if (board === before) return [];

  state.boardAddedMinutes = board;
  return [sportEvent(step, -1, SoccerEvent.ADDED_TIME, { minutes: board, cause })];
}

/**
 * Steps the half should be extended by right now, given what the board says and what has already
 * been added. Zero unless the board has just risen.
 *
 * Kept separate from `accrueAddedTime` so the rule book stays pure data: the module's `step()`
 * owns the one call into the match clock, and this is the number it passes.
 */
export function pendingExtensionSteps(state: RulesState, alreadyExtended: number): number {
  const owed = gameSecondsToSteps(state.boardAddedMinutes * 60);
  return Math.max(0, owed - alreadyExtended);
}

/**
 * Advances the counts that run while play is dead, and returns whatever they caused.
 *
 * A restart not taken inside thirty game seconds is given to the other side. That is not a Law —
 * the Laws say the referee cautions for time-wasting — but a restart that can be sat on for ever
 * is an exploit, and giving the ball away is the version of the punishment that needs no cards.
 */
export function tickRestart(state: RulesState, step: number): SportEvent[] {
  if (state.restart === null) return [];

  if (state.restartDelay > 0) {
    state.restartDelay--;
    return [];
  }
  if (!state.restartReady) return [];

  if (state.restartClock > 0) {
    state.restartClock--;
    if (state.restartClock > 0) return [];
  }

  const restart = state.restart;
  const other = opponent(restart.side as PitchSide);
  const events: SportEvent[] = [
    sportEvent(step, restart.side, SoccerEvent.RESTART_FORFEIT, { kind: restart.kind }),
    event(EventKind.TURNOVER, step, restart.side, { detail: { reason: 'time-wasting' } }),
  ];
  events.push(...awardRestart(state, { ...restart, side: other, reason: 'time-wasting' }, step));
  return events;
}

/** Whether play is dead — the one check the module's `step()` needs. */
export function isBallDead(state: RulesState): boolean {
  return state.restart !== null;
}

/** Total game seconds a period runs for, including whatever the board has added. */
export function periodGameSeconds(state: RulesState, period: number): number {
  const base = period > SOCCER_RULES.periods ? TIMING.extraTimeGameSeconds : TIMING.halfGameSeconds;
  return base + state.boardAddedMinutes * 60;
}

/**
 * The clock as soccer shows it: game seconds *elapsed* in this half, counting up, and continuing
 * past 45:00 into added time. Soccer is the first sport here whose clock counts up, which is why
 * this is not `gameClockSeconds`.
 */
export function elapsedGameSeconds(stepInPeriod: number, period: number): number {
  const offset = period > SOCCER_RULES.periods ? 0 : (period - 1) * TIMING.halfGameSeconds;
  return offset + stepsToGameSeconds(stepInPeriod);
}

/** Game seconds left in the period, for the seam's `SportStatus.periodClock`. */
export function remainingGameSeconds(
  state: RulesState,
  stepInPeriod: number,
  period: number,
): number {
  return Math.max(0, periodGameSeconds(state, period) - stepsToGameSeconds(stepInPeriod));
}

/** `M:SS`, counting up, as every soccer clock in the world does. */
export function formatClock(gameSeconds: number): string {
  const clamped = Math.max(0, Math.floor(gameSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped - minutes * 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
