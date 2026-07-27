/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.2 — Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts
 * @story   US-3.1 — Play a 5v5 basketball match
 * @story   US-2.4 — See the state of the match at a glance
 * @design  06-game-design.md §3.1 (format and rules), 04-architecture.md §5 (the sport module seam)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-9 (one event stream)
 *
 * Purpose: the rule book. Who has the ball, how long they have it for, what ends a possession, and
 * where play restarts. Everything here is plain data and pure-ish functions over it, so the whole
 * rule book can be tested without a world, a renderer, or a clock — and so it serialises straight
 * into a replay or across the P2P wire.
 *
 * **Clock compression.** A quarter is three real minutes showing twelve game minutes (`06` §3.1), a
 * 4× compression. Every duration is authored in *game* seconds — the number the player sees on the
 * HUD — and converted to simulation steps in one place. That way "24" is 24 on the HUD and the
 * arithmetic that makes it six real seconds lives here rather than being sprinkled through the sport.
 *
 * The compression is why there is no eight-second backcourt count: two real seconds to cover
 * fourteen real metres is not a rule, it is a guaranteed turnover. `06` §3.1 asks for the backcourt
 * violation, which is the over-and-back rule, and that is what `checkBackcourt` implements.
 *
 * Nothing in this file emits events itself; every function returns them for the module's `step()` to
 * order against the match clock's own. Same reason the `SportModule` seam works that way (INV-9).
 */
import { EventKind, event, type Side, type SportEvent } from '../../engine/match/events.ts';
import type { MatchRules } from '../../engine/match/state-machine.ts';
import type { EntityId } from '../../engine/world.ts';
import {
  CENTRE_Y,
  COURT,
  crossedBoundary,
  defendedBasket,
  isInFrontcourt,
  throwInSpot,
  type Side as CourtSide,
  type Spot,
} from './court.ts';

/** Simulation rate. Matches the engine loop's fixed step. */
const TICK_RATE = 60;

/**
 * Every duration basketball cares about, in the units the player reads them in.
 *
 * @spec-ref 06-game-design.md §3.1 — 4 quarters, 3 real minutes each, compressed game clock
 */
export const TIMING = {
  /** Real seconds a quarter lasts. */
  quarterRealSeconds: 180,
  /** Game seconds a quarter shows — 12:00, as basketball does. */
  quarterGameSeconds: 720,
  /** Game seconds an overtime period shows (`06` §3.1: "2-minute periods until a winner"). */
  overtimeGameSeconds: 120,

  shotClockGameSeconds: 24,
  /** The shorter reset after an offensive rebound. */
  offensiveReboundGameSeconds: 14,
  /** Time to release an inbound pass. */
  inboundGameSeconds: 5,
  /** Time an offensive player may stand in the key (T-2.7). */
  paintGameSeconds: 3,
} as const;

/** Game seconds per real second. Derived, never authored — the two quarter figures define it. */
export const CLOCK_COMPRESSION = TIMING.quarterGameSeconds / TIMING.quarterRealSeconds;

/** Game seconds → simulation steps. The single place compression is applied. */
export function gameSecondsToSteps(gameSeconds: number): number {
  return Math.round((gameSeconds / CLOCK_COMPRESSION) * TICK_RATE);
}

/** Simulation steps → the game seconds a HUD should show, rounded up as a real clock does. */
export function stepsToGameSeconds(steps: number): number {
  return (steps / TICK_RATE) * CLOCK_COMPRESSION;
}

export const BASKETBALL_RULES: MatchRules = {
  periods: 4,
  periodSteps: TIMING.quarterRealSeconds * TICK_RATE,
  overtimeSteps: gameSecondsToSteps(TIMING.overtimeGameSeconds),
  // A stopped clock is stopped: out-of-bounds, fouls, and timeouts do not burn the quarter.
  clockRunsInStoppage: false,
};

const SHOT_CLOCK_STEPS = gameSecondsToSteps(TIMING.shotClockGameSeconds);
const OFFENSIVE_REBOUND_STEPS = gameSecondsToSteps(TIMING.offensiveReboundGameSeconds);
const INBOUND_STEPS = gameSecondsToSteps(TIMING.inboundGameSeconds);

/**
 * Foul limits.
 *
 * @spec-ref 06-game-design.md §3.1 — "personal and team fouls with bonus"
 */
export const FOULS = {
  /** Personal fouls before an athlete is disqualified (FIBA's five, not the NBA's six). */
  personalLimit: 5,
  /** Team fouls in a period before every subsequent foul is two shots. */
  teamLimitPerPeriod: 5,
  /** Shots a shooting foul is worth, by where the shot was from. */
  shootingShots: { 2: 2, 3: 3 } as Readonly<Record<number, number>>,
  /** And when the shot went in anyway. */
  andOneShots: 1,
  /** Shots a non-shooting foul is worth once the fouling team is in the bonus. */
  bonusShots: 2,
} as const;

/** Why play is stopped and how it starts again. */
export const RestartKind = {
  TIP_OFF: 'tipOff',
  THROW_IN: 'throwIn',
  AFTER_SCORE: 'afterScore',
  FREE_THROW: 'freeThrow',
} as const;
export type RestartKindName = (typeof RestartKind)[keyof typeof RestartKind];

/** Sport-specific event names, carried on `EventKind.SPORT` as `sportKind` (INV-9). */
export const BasketballEvent = {
  SHOT_CLOCK_VIOLATION: 'basketball.violation.shotClock',
  BACKCOURT_VIOLATION: 'basketball.violation.backcourt',
  INBOUND_VIOLATION: 'basketball.violation.inbound',
  OUT_OF_BOUNDS: 'basketball.outOfBounds',
  FUMBLE: 'basketball.fumble',
  CONTACT: 'basketball.contact',
  BLOW_BY: 'basketball.blowBy',
  PASS_DEFLECTED: 'basketball.passDeflected',
  INTERCEPTION: 'basketball.interception',
  RESTART: 'basketball.restart',
  RESTART_READY: 'basketball.restartReady',
  RESTART_COMPLETE: 'basketball.restartComplete',
  SHOT_CLOCK_RESET: 'basketball.shotClockReset',
  STEAL: 'basketball.steal',
  BLOCK: 'basketball.block',
  BONUS: 'basketball.bonus',
  FOUL_OUT: 'basketball.fouledOut',
  FREE_THROW: 'basketball.freeThrow',
  FREE_THROWS_DONE: 'basketball.freeThrowsDone',
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
 */
export interface RulesState {
  /** Who has the ball, or `-1` while it is loose or dead. */
  possession: Side;
  /** Alternating-possession arrow — who gets the next held ball and the next period. */
  arrow: CourtSide;
  /** Steps left on the shot clock. */
  shotClock: number;
  /** False during a restart and while the ball is loose after a made basket. */
  shotClockRunning: boolean;
  /** True once the offence has established the frontcourt this possession. */
  frontcourt: boolean;
  /** Pending restart, or `null` while the ball is live. */
  restart: Restart | null;
  /**
   * True once the inbounder has the ball at the spot. The five-second count does not start until
   * then — an official hands the ball over and *then* starts counting, which matters here because
   * the inbounder may have to run the length of the court to take it.
   */
  restartReady: boolean;
  /** Steps left to release the inbound pass. */
  restartClock: number;
  /** Last side to touch the ball — decides who gets it when it goes out. */
  lastTouch: Side;

  /**
   * Personal fouls per athlete, keyed by entity id. A record rather than a `Map` because this goes
   * into snapshots and replays, and a `Map` does not survive `JSON.stringify`.
   */
  personalFouls: Record<number, number>;
  /** Team fouls this period, which is what puts a team in the bonus. */
  teamFouls: [number, number];
  /** Athletes disqualified for the rest of the match. */
  fouledOut: EntityId[];
  /** The free throws being shot, or `null`. */
  freeThrows: FreeThrowSet | null;
}

/** A trip to the line. */
export interface FreeThrowSet {
  readonly shooter: EntityId;
  readonly side: CourtSide;
  readonly total: number;
  remaining: number;
  made: number;
}

export function createRulesState(arrow: CourtSide = 0): RulesState {
  return {
    possession: -1,
    arrow,
    shotClock: SHOT_CLOCK_STEPS,
    shotClockRunning: false,
    frontcourt: false,
    restart: null,
    restartReady: false,
    restartClock: 0,
    lastTouch: -1,
    personalFouls: {},
    teamFouls: [0, 0],
    fouledOut: [],
    freeThrows: null,
  };
}

/** Whether a side has fouled enough this period that every further foul is two shots. */
export function inBonus(state: RulesState, side: CourtSide): boolean {
  return state.teamFouls[side] >= FOULS.teamLimitPerPeriod;
}

export function personalFouls(state: RulesState, athlete: EntityId): number {
  return state.personalFouls[athlete] ?? 0;
}

export function isFouledOut(state: RulesState, athlete: EntityId): boolean {
  return state.fouledOut.includes(athlete);
}

/**
 * Records a foul and decides what it costs.
 *
 * The three outcomes are the real ones: free throws for a shooting foul, free throws for a
 * non-shooting foul once the fouling team is in the bonus, and otherwise the ball back out of
 * bounds. An and-one — fouled on a shot that went in — is one shot, not a fresh set.
 */
export function recordFoul(
  state: RulesState,
  offender: EntityId,
  offenderSide: CourtSide,
  fouled: EntityId,
  step: number,
  options: { shooting?: boolean; shotValue?: number; made?: boolean; ballX?: number } = {},
): SportEvent[] {
  const victimSide: CourtSide = offenderSide === 0 ? 1 : 0;
  state.personalFouls[offender] = personalFouls(state, offender) + 1;
  state.teamFouls[offenderSide]++;

  const events: SportEvent[] = [
    event(EventKind.FOUL, step, offenderSide, {
      actor: offender,
      target: fouled,
      detail: {
        personal: personalFouls(state, offender),
        team: state.teamFouls[offenderSide],
        shooting: options.shooting === true,
      },
    }),
  ];

  if (personalFouls(state, offender) >= FOULS.personalLimit && !isFouledOut(state, offender)) {
    state.fouledOut.push(offender);
    events.push(sportEvent(step, offenderSide, BasketballEvent.FOUL_OUT, { actor: offender }));
  }

  if (state.teamFouls[offenderSide] === FOULS.teamLimitPerPeriod) {
    events.push(sportEvent(step, offenderSide, BasketballEvent.BONUS, { side: offenderSide }));
  }

  const shots = shotsFor(state, offenderSide, options);
  if (shots > 0) {
    events.push(...awardFreeThrows(state, fouled, victimSide, shots, step));
    return events;
  }

  const spot = throwInSpot(options.ballX ?? COURT.length / 2, -1);
  events.push(
    ...awardRestart(
      state,
      { kind: RestartKind.THROW_IN, side: victimSide, x: spot.x, y: spot.y, reason: 'foul' },
      step,
    ),
  );
  return events;
}

function shotsFor(
  state: RulesState,
  offenderSide: CourtSide,
  options: { shooting?: boolean; shotValue?: number; made?: boolean },
): number {
  if (options.shooting === true) {
    if (options.made === true) return FOULS.andOneShots;
    return FOULS.shootingShots[options.shotValue ?? 2] ?? 2;
  }
  return inBonus(state, offenderSide) ? FOULS.bonusShots : 0;
}

/** Sends a shooter to the line. The clock is stopped and stays stopped until the last one lands. */
export function awardFreeThrows(
  state: RulesState,
  shooter: EntityId,
  side: CourtSide,
  count: number,
  step: number,
): SportEvent[] {
  state.freeThrows = { shooter, side, total: count, remaining: count, made: 0 };
  state.shotClockRunning = false;
  state.restart = null;
  state.restartReady = false;
  state.possession = side;

  return [sportEvent(step, side, BasketballEvent.FREE_THROW, { actor: shooter, count })];
}

/**
 * Resolves one free throw. The last one is what decides how play restarts: a make is inbounded by
 * the other side, a miss is a live rebound.
 */
export function resolveFreeThrow(state: RulesState, made: boolean, step: number): SportEvent[] {
  const set = state.freeThrows;
  if (set === null) return [];

  set.remaining--;
  if (made) set.made++;

  const events: SportEvent[] = [];
  if (made) {
    events.push(event(EventKind.SCORE, step, set.side, { value: 1, actor: set.shooter }));
  }

  if (set.remaining > 0) return events;

  state.freeThrows = null;
  events.push(
    sportEvent(step, set.side, BasketballEvent.FREE_THROWS_DONE, {
      made: set.made,
      of: set.total,
    }),
  );

  if (made) {
    events.push(...onBasketMade(state, set.side, step));
  } else {
    // A missed last free throw is live. The caller puts the ball on the rim.
    state.possession = -1;
    state.shotClockRunning = false;
  }
  return events;
}

/** Shot clock as the HUD shows it: seconds remaining, one decimal under five. */
export function shotClockSeconds(state: RulesState): number {
  return Math.max(0, stepsToGameSeconds(state.shotClock));
}

/** Game clock remaining in the period, in game seconds, from the engine's step-in-period. */
export function gameClockSeconds(stepInPeriod: number, period: number): number {
  const total =
    period > BASKETBALL_RULES.periods ? TIMING.overtimeGameSeconds : TIMING.quarterGameSeconds;
  const elapsed = stepsToGameSeconds(stepInPeriod);
  return Math.max(0, total - elapsed);
}

/** `M:SS`, or `S.T` inside the last minute — the convention every basketball clock uses. */
export function formatClock(gameSeconds: number): string {
  const clamped = Math.max(0, gameSeconds);
  if (clamped < 60) return clamped.toFixed(1);
  const minutes = Math.floor(clamped / 60);
  const seconds = Math.floor(clamped - minutes * 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** How much shot clock a new possession starts with. */
export const ShotClockReset = {
  /** A fresh 24 — a change of possession, or a period start. */
  FULL: 'full',
  /** 14, after an offensive rebound. */
  OFFENSIVE_REBOUND: 'offensiveRebound',
  /** Leave it running — a deflection the offence recovers, a live-ball touch. */
  KEEP: 'keep',
} as const;
export type ShotClockResetName = (typeof ShotClockReset)[keyof typeof ShotClockReset];

function resetSteps(reset: ShotClockResetName, current: number): number {
  if (reset === ShotClockReset.FULL) return SHOT_CLOCK_STEPS;
  // Never *adds* time: an offensive rebound with 18 left leaves 18, not 14.
  if (reset === ShotClockReset.OFFENSIVE_REBOUND) return Math.min(current, OFFENSIVE_REBOUND_STEPS);
  return current;
}

/**
 * Hands the ball to a side with the ball live — a rebound, a steal, a completed inbound.
 *
 * The backcourt count starts only when the ball is in the backcourt, so a steal in the frontcourt
 * does not immediately owe eight seconds it cannot use.
 */
export function grantPossession(
  state: RulesState,
  side: CourtSide,
  step: number,
  reset: ShotClockResetName = ShotClockReset.FULL,
  ballX = 0,
  actor?: EntityId,
): SportEvent[] {
  const changed = state.possession !== side;
  state.possession = side;
  state.lastTouch = side;
  state.shotClock = resetSteps(reset, state.shotClock);
  state.shotClockRunning = true;

  if (changed) state.frontcourt = isInFrontcourt(ballX, CENTRE_Y, side);

  const events: SportEvent[] = [];
  if (changed) {
    events.push(
      actor === undefined
        ? event(EventKind.POSSESSION, step, side)
        : event(EventKind.POSSESSION, step, side, { actor }),
    );
  }
  if (reset !== ShotClockReset.KEEP) {
    events.push(
      event(EventKind.SPORT, step, side, {
        sportKind: BasketballEvent.SHOT_CLOCK_RESET,
        value: Math.round(stepsToGameSeconds(state.shotClock)),
      }),
    );
  }
  return events;
}

/** Records who touched the ball last, which is what decides an out-of-bounds award. */
export function registerTouch(state: RulesState, side: Side): void {
  state.lastTouch = side;
}

/**
 * Advances every count that runs while the ball is live, and returns whatever they caused.
 *
 * There is deliberately no eight-second backcourt count. At 4× clock compression it would give a
 * ball-handler two real seconds to cover fourteen real metres, which is not a rule so much as a
 * guaranteed turnover — and `06` §3.1 asks only for the backcourt violation, which is the
 * over-and-back rule in `checkBackcourt`.
 */
export function tickClocks(state: RulesState, ballX: number, step: number): SportEvent[] {
  if (state.restart !== null) return tickRestart(state, step);
  if (state.possession === -1) return [];

  const offence: CourtSide = state.possession;

  if (state.shotClockRunning && state.shotClock > 0) {
    state.shotClock--;
    if (state.shotClock === 0) {
      return violation(
        state,
        offence,
        step,
        BasketballEvent.SHOT_CLOCK_VIOLATION,
        'shot clock',
        ballX,
      );
    }
  }

  // Crossing the centre line arms the over-and-back rule for the rest of the possession.
  if (!state.frontcourt && isInFrontcourt(ballX, CENTRE_Y, offence)) state.frontcourt = true;

  return [];
}

/** The five-second inbound count, which is the only clock that runs during a restart. */
function tickRestart(state: RulesState, step: number): SportEvent[] {
  const restart = state.restart;
  if (restart === null || restart.kind === RestartKind.TIP_OFF) return [];
  if (!state.restartReady || state.restartClock <= 0) return [];

  state.restartClock--;
  if (state.restartClock > 0) return [];

  if (restart.side === -1) return [];
  const inbounder: CourtSide = restart.side;
  const other: CourtSide = inbounder === 0 ? 1 : 0;
  const events: SportEvent[] = [
    sportEvent(step, inbounder, BasketballEvent.INBOUND_VIOLATION, { reason: 'five seconds' }),
    event(EventKind.TURNOVER, step, inbounder, { detail: { reason: 'five seconds' } }),
  ];
  events.push(
    ...awardRestart(
      state,
      {
        kind: RestartKind.THROW_IN,
        side: other,
        x: restart.x,
        y: restart.y,
        reason: 'five seconds',
      },
      step,
    ),
  );
  return events;
}

/**
 * Whether the ball has left the court, and what to do about it. The award goes *against* whoever
 * touched it last, which is the whole rule — the ball's own trajectory is irrelevant.
 */
export function checkOutOfBounds(
  state: RulesState,
  ballX: number,
  ballY: number,
  step: number,
): SportEvent[] {
  if (state.restart !== null) return [];
  if (crossedBoundary(ballX, ballY) === null) return [];

  const offender = state.lastTouch;
  const awarded: CourtSide = offender === 0 ? 1 : offender === 1 ? 0 : state.arrow;
  const spot = throwInSpot(ballX, ballY);

  const events: SportEvent[] = [
    sportEvent(step, offender, BasketballEvent.OUT_OF_BOUNDS, { x: spot.x, y: spot.y }),
  ];
  if (offender !== -1) {
    events.push(event(EventKind.TURNOVER, step, offender, { detail: { reason: 'out of bounds' } }));
  } else {
    // Nobody had touched it: the arrow decides, and then flips.
    state.arrow = state.arrow === 0 ? 1 : 0;
  }

  events.push(
    ...awardRestart(
      state,
      {
        kind: RestartKind.THROW_IN,
        side: awarded,
        x: spot.x,
        y: spot.y,
        reason: 'out of bounds',
      },
      step,
    ),
  );
  return events;
}

/**
 * The backcourt violation: once the offence has established the frontcourt, the ball may not go
 * back over the centre line.
 *
 * @spec-ref 06-game-design.md §3.1 — backcourt violation
 */
export function checkBackcourt(state: RulesState, ballX: number, step: number): SportEvent[] {
  if (state.restart !== null || state.possession === -1 || !state.frontcourt) return [];
  const offence: CourtSide = state.possession;
  if (isInFrontcourt(ballX, CENTRE_Y, offence)) return [];

  return violation(state, offence, step, BasketballEvent.BACKCOURT_VIOLATION, 'backcourt', ballX);
}

/** A made basket: the conceding side inbounds from its own baseline. */
export function onBasketMade(state: RulesState, scoringSide: Side, step: number): SportEvent[] {
  if (scoringSide !== 0 && scoringSide !== 1) return [];
  const conceding: CourtSide = scoringSide === 0 ? 1 : 0;
  const spot = inboundAfterScoreSpot(conceding);

  return awardRestart(
    state,
    {
      kind: RestartKind.AFTER_SCORE,
      side: conceding,
      x: spot.x,
      y: spot.y,
      reason: 'made basket',
    },
    step,
  );
}

/** The opening tip, and the start of every subsequent period. */
export function onPeriodStart(state: RulesState, period: number, step: number): SportEvent[] {
  // Team fouls are per period; personal fouls are not. `06` §3.1's bonus depends on the difference.
  state.teamFouls = [0, 0];
  state.freeThrows = null;
  state.frontcourt = false;
  state.shotClock = SHOT_CLOCK_STEPS;
  state.shotClockRunning = false;
  state.lastTouch = -1;

  if (period === 1) {
    state.restart = {
      kind: RestartKind.TIP_OFF,
      side: -1,
      x: COURT.length / 2,
      y: CENTRE_Y,
      reason: 'tip-off',
    };
    state.restartReady = false;
    state.restartClock = 0;
    state.possession = -1;
    return [sportEvent(step, -1, BasketballEvent.RESTART, { reason: 'tip-off' })];
  }

  // Later periods start with the arrow, which then flips.
  const side = state.arrow;
  state.arrow = side === 0 ? 1 : 0;
  const spot = throwInSpot(COURT.length / 2, -1);
  return awardRestart(
    state,
    {
      kind: RestartKind.THROW_IN,
      side,
      x: spot.x,
      y: spot.y,
      reason: 'period start',
    },
    step,
  );
}

/** Puts a restart in place, stopping the clocks that should not run through it. */
export function awardRestart(state: RulesState, restart: Restart, step: number): SportEvent[] {
  state.restart = restart;
  state.restartReady = false;
  state.restartClock = INBOUND_STEPS;
  // A dead ball has no possession; `restart.side` records who will put it in play.
  state.possession = -1;
  state.lastTouch = restart.side;
  state.shotClockRunning = false;
  state.shotClock = SHOT_CLOCK_STEPS;
  state.frontcourt = false;

  return [
    sportEvent(step, restart.side, BasketballEvent.RESTART, {
      reason: restart.reason,
      kind: restart.kind,
      x: restart.x,
      y: restart.y,
    }),
    // A restart resets the shot clock, and the HUD has to be told so — a dead ball that comes back
    // showing the old count is the kind of bug players notice before any test does.
    sportEvent(step, restart.side, BasketballEvent.SHOT_CLOCK_RESET, {
      value: Math.round(stepsToGameSeconds(state.shotClock)),
    }),
  ];
}

/**
 * The inbounder has the ball at the spot: start the five-second count.
 *
 * Idempotent, because the module calls it every step the inbounder is in position and re-arming
 * the count each time would make it impossible to run out.
 */
export function markRestartReady(state: RulesState, step: number): SportEvent[] {
  if (state.restart === null || state.restartReady) return [];
  state.restartReady = true;
  state.restartClock = INBOUND_STEPS;
  return [
    sportEvent(step, state.restart.side, BasketballEvent.RESTART_READY, {
      kind: state.restart.kind,
    }),
  ];
}

/**
 * The inbound pass has been released — the ball is live again.
 *
 * After a made basket the inbounder gets the full eight seconds to advance; after a frontcourt
 * throw-in there is nothing to advance, so the count never starts.
 */
export function completeRestart(state: RulesState, step: number, ballX: number): SportEvent[] {
  const restart = state.restart;
  if (restart === null) return [];

  state.restart = null;
  state.restartReady = false;
  state.restartClock = 0;

  if (restart.side === -1) {
    // A tip-off has no owner until someone catches it.
    state.possession = -1;
    state.shotClockRunning = false;
    return [sportEvent(step, -1, BasketballEvent.RESTART_COMPLETE, { kind: restart.kind })];
  }

  state.frontcourt = isInFrontcourt(ballX, CENTRE_Y, restart.side);
  state.shotClockRunning = true;
  state.possession = restart.side;

  return [
    sportEvent(step, restart.side, BasketballEvent.RESTART_COMPLETE, { kind: restart.kind }),
    // The possession event belongs here rather than to the award: a dead ball is nobody's.
    event(EventKind.POSSESSION, step, restart.side),
  ];
}

/** Where the conceding side inbounds after giving up a basket — beside the backboard, not behind it. */
export function inboundAfterScoreSpot(concedingSide: CourtSide): Spot {
  const basket = defendedBasket(concedingSide);
  return { x: basket.x < COURT.length / 2 ? 0 : COURT.length, y: CENTRE_Y + 3 };
}

/** A violation: turnover, then a throw-in for the other side from the nearest sideline. */
function violation(
  state: RulesState,
  offence: CourtSide,
  step: number,
  kind: string,
  reason: string,
  ballX: number,
): SportEvent[] {
  const other: CourtSide = offence === 0 ? 1 : 0;
  const spot = throwInSpot(ballX, -1);

  return [
    sportEvent(step, offence, kind, { reason }),
    event(EventKind.TURNOVER, step, offence, { detail: { reason } }),
    ...awardRestart(
      state,
      { kind: RestartKind.THROW_IN, side: other, x: spot.x, y: spot.y, reason },
      step,
    ),
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
