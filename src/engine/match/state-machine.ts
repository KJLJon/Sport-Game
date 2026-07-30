/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.10 — Match state machine + `SportEvent` bus
 * @story   US-2.4 — Play a match that feels like the sport
 * @design  04-architecture.md §6 (match state machine), 09-modes-and-arcade.md §5
 * @invariant INV-8 (deterministic), INV-9 (mode-agnostic events)
 *
 * Purpose: `PreMatch → Live → Stoppage → PeriodBreak → Final`, and the clock that goes with it.
 * All three modes run this same machine — Playbook advances it a turn at a time instead of a tick
 * at a time, and an arcade session drives a single-period instance of it. One machine means the
 * period, score, and event bookkeeping every mode needs exists once.
 *
 * Time is counted in *simulation steps*, never in wall-clock milliseconds. A replay and a live
 * match must produce identical clocks, and only a step count does that (INV-8).
 */
import { EventBus, EventKind, event, type Side, type SportEvent } from './events.ts';

export const MatchPhase = {
  PRE_MATCH: 'preMatch',
  LIVE: 'live',
  STOPPAGE: 'stoppage',
  PERIOD_BREAK: 'periodBreak',
  FINAL: 'final',
} as const;
export type MatchPhaseName = (typeof MatchPhase)[keyof typeof MatchPhase];

export interface MatchRules {
  /** Quarters, halves, periods — whatever the sport calls them. */
  readonly periods: number;
  /** Length of one period, in simulation steps. */
  readonly periodSteps: number;
  /** Extra periods when tied at the end. `0` means draws are allowed. */
  readonly overtimeSteps?: number;
  /** Whether the clock keeps running during a stoppage. Basketball: no. Soccer: yes. */
  readonly clockRunsInStoppage?: boolean;
}

export interface MatchResult {
  readonly homeScore: number;
  readonly awayScore: number;
  /** `0` home, `1` away, `-1` a draw. */
  readonly winner: Side;
  readonly periodsPlayed: number;
  readonly steps: number;
}

/** The transitions the machine allows. Anything else is a bug worth throwing over. */
const ALLOWED: Readonly<Record<MatchPhaseName, readonly MatchPhaseName[]>> = {
  [MatchPhase.PRE_MATCH]: [MatchPhase.LIVE, MatchPhase.FINAL],
  [MatchPhase.LIVE]: [MatchPhase.STOPPAGE, MatchPhase.PERIOD_BREAK, MatchPhase.FINAL],
  [MatchPhase.STOPPAGE]: [MatchPhase.LIVE, MatchPhase.PERIOD_BREAK, MatchPhase.FINAL],
  [MatchPhase.PERIOD_BREAK]: [MatchPhase.LIVE, MatchPhase.FINAL],
  [MatchPhase.FINAL]: [],
};

export class MatchStateMachine {
  private phase: MatchPhaseName = MatchPhase.PRE_MATCH;
  private period = 0;
  private periodStep = 0;
  private totalSteps = 0;
  private readonly score: [number, number] = [0, 0];
  private overtimePeriods = 0;
  private periodExtension = 0;

  constructor(
    readonly rules: MatchRules,
    readonly bus: EventBus = new EventBus(),
  ) {}

  get currentPhase(): MatchPhaseName {
    return this.phase;
  }

  /** 1-based; `0` before the match starts. Overtime keeps counting up. */
  get currentPeriod(): number {
    return this.period;
  }

  /** Steps elapsed in the current period. */
  get stepInPeriod(): number {
    return this.periodStep;
  }

  /** Steps remaining in the current period. */
  get stepsRemaining(): number {
    return Math.max(0, this.periodLength() - this.periodStep);
  }

  get steps(): number {
    return this.totalSteps;
  }

  get homeScore(): number {
    return this.score[0];
  }

  get awayScore(): number {
    return this.score[1];
  }

  get isFinished(): boolean {
    return this.phase === MatchPhase.FINAL;
  }

  /** True while the simulation should be integrating — the one check the mode host needs. */
  get isRunning(): boolean {
    return this.phase === MatchPhase.LIVE;
  }

  private periodLength(): number {
    const base =
      this.overtimePeriods > 0
        ? (this.rules.overtimeSteps ?? this.rules.periodSteps)
        : this.rules.periodSteps;
    return base + this.periodExtension;
  }

  /** Steps added to the current period beyond its nominal length. */
  get extension(): number {
    return this.periodExtension;
  }

  /**
   * Lengthens the current period. Cleared automatically when the next period starts.
   *
   * The clock is the engine's, but *how long a period turns out to be* is not always the engine's
   * to know: soccer's added time is the referee's arithmetic over the stoppages that happened, and
   * there is no way to express "this half runs longer than the whistle said" from outside. A
   * fixed-length period is the common case and stays the default; this is the escape hatch, and it
   * is deliberately generic — nothing here knows what a stoppage was for.
   *
   * Call it *before* the nominal end: a period that has already ended cannot be reopened, and
   * asking to is a bug rather than a no-op worth swallowing.
   */
  extendPeriod(steps: number): void {
    if (steps <= 0) return;
    if (this.phase !== MatchPhase.LIVE && this.phase !== MatchPhase.STOPPAGE) {
      throw new Error(`extendPeriod() requires a period in progress, not ${this.phase}`);
    }
    this.periodExtension += Math.round(steps);
  }

  /** Kicks off. Emits `match.start` and the first `period.start`. */
  start(): void {
    this.transition(MatchPhase.LIVE);
    this.bus.emit(event(EventKind.MATCH_START, this.totalSteps));
    this.period = 1;
    this.periodStep = 0;
    this.bus.emit(event(EventKind.PERIOD_START, this.totalSteps, -1, { value: this.period }));
  }

  /**
   * Advances one simulation step. Returns the events the clock itself produced — period ends,
   * the match end — which the caller emits alongside the sport's own events for that step.
   *
   * A stoppage still consumes a step of *total* time (so replays line up) but only advances the
   * period clock when the sport says the clock runs through stoppages.
   */
  step(): readonly SportEvent[] {
    if (this.phase === MatchPhase.FINAL || this.phase === MatchPhase.PRE_MATCH) return [];

    this.totalSteps++;

    const clockRuns =
      this.phase === MatchPhase.LIVE ||
      (this.phase === MatchPhase.STOPPAGE && this.rules.clockRunsInStoppage === true);

    if (!clockRuns) return [];

    this.periodStep++;
    if (this.periodStep < this.periodLength()) return [];

    return this.endPeriod();
  }

  /** Ends the current period, and the match if that was the last one. */
  private endPeriod(): readonly SportEvent[] {
    const events: SportEvent[] = [
      event(EventKind.PERIOD_END, this.totalSteps, -1, { value: this.period }),
    ];

    const regulationDone = this.period >= this.rules.periods;
    const tied = this.score[0] === this.score[1];
    const overtimeAvailable = (this.rules.overtimeSteps ?? 0) > 0;

    if (regulationDone && (!tied || !overtimeAvailable)) {
      this.transition(MatchPhase.FINAL);
      events.push(event(EventKind.MATCH_END, this.totalSteps, this.winner()));
      this.bus.emitAll(events);
      return events;
    }

    this.transition(MatchPhase.PERIOD_BREAK);
    this.bus.emitAll(events);
    return events;
  }

  /**
   * Starts the next period from a break. Overtime is just a period with its own length.
   *
   * Guarded on the *method*, not only the transition: `preMatch → live` is a legal edge (it is
   * how `start()` works), so without this a mistaken `nextPeriod()` before kick-off would quietly
   * begin the match at period 2.
   */
  nextPeriod(): void {
    if (this.phase !== MatchPhase.PERIOD_BREAK) {
      throw new Error(`nextPeriod() requires a period break, not ${this.phase}`);
    }
    this.transition(MatchPhase.LIVE);
    if (this.period >= this.rules.periods) this.overtimePeriods++;
    this.period++;
    this.periodStep = 0;
    this.periodExtension = 0;
    this.bus.emit(event(EventKind.PERIOD_START, this.totalSteps, -1, { value: this.period }));
  }

  /** Pauses play — a foul, a ball out of bounds, a timeout. */
  stoppage(reason: string): void {
    this.transition(MatchPhase.STOPPAGE);
    this.bus.emit(event(EventKind.STOPPAGE, this.totalSteps, -1, { detail: { reason } }));
  }

  /** Restarts play after a stoppage. */
  resume(): void {
    if (this.phase !== MatchPhase.STOPPAGE) {
      throw new Error(`resume() requires a stoppage, not ${this.phase}`);
    }
    this.transition(MatchPhase.LIVE);
  }

  /**
   * Adds to a side's score and emits `score`. The only way the score moves, so a stat consumer
   * that misses a `score` event has a bug rather than a missing code path.
   */
  addScore(side: Side, points: number, actor?: number): void {
    if (side !== 0 && side !== 1) return;
    this.score[side] += points;
    this.bus.emit(
      actor === undefined
        ? event(EventKind.SCORE, this.totalSteps, side, { value: points })
        : event(EventKind.SCORE, this.totalSteps, side, { value: points, actor }),
    );
  }

  /** Ends the match early — a forfeit, a quit, a mercy rule. */
  abandon(): void {
    if (this.phase === MatchPhase.FINAL) return;
    this.transition(MatchPhase.FINAL);
    this.bus.emit(event(EventKind.MATCH_END, this.totalSteps, this.winner()));
  }

  result(): MatchResult | null {
    if (this.phase !== MatchPhase.FINAL) return null;
    return {
      homeScore: this.score[0],
      awayScore: this.score[1],
      winner: this.winner(),
      periodsPlayed: this.period,
      steps: this.totalSteps,
    };
  }

  private winner(): Side {
    if (this.score[0] > this.score[1]) return 0;
    if (this.score[1] > this.score[0]) return 1;
    return -1;
  }

  private transition(to: MatchPhaseName): void {
    if (this.phase === to) return;
    if (!(ALLOWED[this.phase] as readonly MatchPhaseName[]).includes(to)) {
      throw new Error(`Illegal match transition: ${this.phase} → ${to}`);
    }
    this.phase = to;
  }

  /**
   * A snapshot sufficient to resume — the machine's half of the `(seed, setup, inputs)` triple in
   * `04` §7. Deliberately plain data.
   */
  snapshot(): MatchSnapshot {
    return {
      phase: this.phase,
      period: this.period,
      periodStep: this.periodStep,
      totalSteps: this.totalSteps,
      homeScore: this.score[0],
      awayScore: this.score[1],
      overtimePeriods: this.overtimePeriods,
      periodExtension: this.periodExtension,
    };
  }

  restore(snapshot: MatchSnapshot): void {
    this.phase = snapshot.phase;
    this.period = snapshot.period;
    this.periodStep = snapshot.periodStep;
    this.totalSteps = snapshot.totalSteps;
    this.score[0] = snapshot.homeScore;
    this.score[1] = snapshot.awayScore;
    this.overtimePeriods = snapshot.overtimePeriods;
    this.periodExtension = snapshot.periodExtension ?? 0;
  }
}

export interface MatchSnapshot {
  readonly phase: MatchPhaseName;
  readonly period: number;
  readonly periodStep: number;
  readonly totalSteps: number;
  readonly homeScore: number;
  readonly awayScore: number;
  readonly overtimePeriods: number;
  /**
   * Steps added to the current period. Optional so a snapshot taken before extensions existed —
   * a stored replay, a P2P peer on an older build — restores as an unextended period rather than
   * failing to restore at all.
   */
  readonly periodExtension?: number;
}
