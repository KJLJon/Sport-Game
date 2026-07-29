/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.1 — `PlaybookAdapter` interface + turn engine: turn loop, state, seeded resolution
 * @story   US-15.1 — Play a match as a series of tactical decisions
 * @design  09-modes-and-arcade.md §2.1 (shape of a match), §2.4 (key moments), §5 (architecture)
 * @invariant INV-8 (determinism), INV-9 (one event stream, no mode field), INV-2 (seeded PRNG only)
 *
 * Purpose: runs a Playbook match. Both sides submit a call, the turn resolves, a key moment may be
 * handed to the player, and the turn commits — clock, score, possession, events. The sport supplies
 * the `PlaybookAdapter`; everything in this file is true of every sport.
 *
 * **Why the state machine is the Live one.** Periods, overtime, the score, and `SportEvent.step`
 * all have to mean the same thing in both modes or the box score, the achievements, and INV-11's
 * parity test are comparing two different things. So a turn consumes *steps* — the same steps Live
 * integrates — and `MatchStateMachine` decides when a period ends. Playbook does not get its own
 * clock; it gets a coarser way of spending the same one.
 *
 * **The turn cycle.**
 * ```
 * awaiting-calls ──submit×2──▶ resolve() ──┬──▶ resolved ──advance()──▶ awaiting-calls | over
 *                                          └──▶ key-moment ──settleKeyMoment()──▶ resolved
 * ```
 * The sim resolves *first* and the arcade result replaces the outcome afterwards, which is what
 * lets `09` §2.4's "the sim also computes what would have happened" be true rather than aspirational
 * — the counterfactual is not reconstructed later, it is the thing that was actually drawn.
 *
 * **Why events are held until `advance()`.** A turn's events are not the match's until the turn is
 * committed, and a key moment can replace them wholesale. Emitting at resolution time would put a
 * missed three into the box score and then have to take it out again.
 */
import { createRng, type Rng } from '../../engine/rng.ts';
import type { Side, SportEvent } from '../../engine/match/events.ts';
import type { TurnDiagram } from './diagram.ts';
import {
  MatchPhase,
  MatchStateMachine,
  type MatchResult,
  type MatchRules,
} from '../../engine/match/state-machine.ts';
import { DEFAULT_DIFFICULTY, type Difficulty } from '../difficulty.ts';
import {
  type ArcadeInvocation,
  type CallOption,
  type CallPair,
  type KeyMomentFrequency,
  type KeyMomentOutcome,
  type NarrationLine,
  type PlaybookAdapter,
  type PlaybookCall,
  type PlaybookClock,
  type PlaybookSquad,
  type PlaybookState,
  type TurnResolution,
  type TurnScore,
} from './types.ts';

export const PLAYBOOK_PHASES = ['awaiting-calls', 'key-moment', 'resolved', 'over'] as const;
export type PlaybookPhase = (typeof PLAYBOOK_PHASES)[number];

export interface PlaybookMatchOptions<S = unknown> {
  readonly seed: string;
  readonly adapter: PlaybookAdapter<S>;
  readonly sport: string;
  readonly rules: MatchRules;
  readonly squads: readonly [PlaybookSquad, PlaybookSquad];
  /** Which side the human plays, or `-1` for CPU-vs-CPU (the balance harness). */
  readonly playerSide?: Side;
  readonly difficulty?: Difficulty;
  /** `09` §2.4's frequency setting. Defaults to `standard`. */
  readonly keyMoments?: KeyMomentFrequency;
}

/** Leverage a moment needs to reach before each setting hands it over (`09` §2.4). */
const LEVERAGE_FLOOR: Readonly<Record<KeyMomentFrequency, number>> = {
  off: Infinity,
  clutch: 0.75,
  standard: 0.4,
  every: 0,
};

/** Hard stop on turns, so a misbehaving adapter cannot hang a match. Far above any real match. */
const MAX_TURNS = 500;

/** A turn's scoring plays. The common case — one score for the whole turn — needs no `scores`. */
function scoresOf(resolution: TurnResolution): readonly TurnScore[] {
  if (resolution.scores !== undefined) return resolution.scores.filter((score) => score.points > 0);
  return resolution.points > 0 ? [{ points: resolution.points }] : [];
}

/**
 * One Playbook match. Construct, drive the turn cycle, read `view()` whenever you want to draw.
 * Headless: nothing here touches the DOM, so the balance harness and the parity tests use the same
 * object the screen does.
 */
export class PlaybookMatch<S = unknown> {
  readonly state: PlaybookState<S>;
  readonly machine: MatchStateMachine;

  private readonly adapter: PlaybookAdapter<S>;
  private readonly rng: Rng;
  private readonly frequency: KeyMomentFrequency;
  private readonly clock: PlaybookClock;
  private readonly regulationPeriods: number;

  private phaseName: PlaybookPhase = 'awaiting-calls';
  private submitted: [PlaybookCall | null, PlaybookCall | null] = [null, null];
  private pending: TurnResolution | null = null;
  private invocation: ArcadeInvocation | null = null;
  private readonly history: TurnResolution[] = [];

  constructor(options: PlaybookMatchOptions<S>) {
    this.adapter = options.adapter;
    this.frequency = options.keyMoments ?? 'standard';
    this.clock = options.adapter.clock;
    this.regulationPeriods = options.rules.periods;
    this.rng = createRng(options.seed);
    this.machine = new MatchStateMachine(options.rules);

    const playerSide = options.playerSide ?? 0;
    const difficulty = options.difficulty ?? DEFAULT_DIFFICULTY;
    const setup = {
      seed: options.seed,
      difficulty,
      playerSide,
      squads: options.squads,
    };

    this.state = {
      sport: options.sport,
      turnKind: options.adapter.turnKind,
      difficulty,
      playerSide,
      turn: 0,
      period: 1,
      clock: options.adapter.clock.periodSeconds,
      // The opening possession is a coin toss, forked by label so adding a draw elsewhere in setup
      // cannot change who starts with the ball (INV-8).
      possession: this.rng.fork('tip').bool() ? 1 : 0,
      score: [0, 0],
      squads: options.squads,
      detail: options.adapter.createState(setup, this.rng.fork('sport')),
    };

    this.machine.start();
  }

  get phase(): PlaybookPhase {
    return this.phaseName;
  }

  get finished(): boolean {
    return this.phaseName === 'over';
  }

  /** Every turn that has been committed, oldest first. */
  get turns(): readonly TurnResolution[] {
    return this.history;
  }

  /** The event stream this match has emitted so far — the same one Live emits (INV-9). */
  get events(): readonly SportEvent[] {
    return this.machine.bus.history();
  }

  /** What this side may call. Empty once the match is over. */
  calls(side: Side): readonly CallOption[] {
    if (this.phaseName === 'over') return [];
    return this.adapter.calls(this.state, side);
  }

  /**
   * Records a side's decision. Both sides must submit before the turn can resolve; a side may
   * change its mind until then, which is what makes T-5.9's hot-seat hand-over safe.
   */
  submit(call: PlaybookCall): void {
    if (this.phaseName !== 'awaiting-calls') {
      throw new Error(`submit() requires awaiting-calls, not ${this.phaseName}`);
    }
    if (call.side !== 0 && call.side !== 1) throw new Error('a call needs a real side');
    this.submitted[call.side] = call;
  }

  /** The CPU's call for a side, when the adapter offers one (T-5.8). */
  autoCall(side: Side): PlaybookCall | null {
    if (this.adapter.autoCall === undefined || (side !== 0 && side !== 1)) return null;
    return this.adapter.autoCall(this.state, side, this.turnRng(`auto-${side}`), this.history);
  }

  /**
   * The assistant coach's call, for the Auto-call toggle (T-5.7). Falls back to the CPU's when a
   * sport has no coach of its own, which is a worse answer than a coach and a much better one than
   * leaving the player's side without a call.
   */
  coachCall(side: Side): PlaybookCall | null {
    if (side !== 0 && side !== 1) return null;
    if (this.adapter.coach === undefined) return this.autoCall(side);
    return this.adapter.coach(this.state, side, this.turnRng(`coach-${side}`));
  }

  get callsSubmitted(): boolean {
    return this.submitted[0] !== null && this.submitted[1] !== null;
  }

  /**
   * Draws the turn. Leaves the match in `key-moment` when the moment is worth playing and in
   * `resolved` otherwise. Nothing is emitted or scored until `advance()`.
   */
  resolve(): TurnResolution {
    if (this.phaseName !== 'awaiting-calls') {
      throw new Error(`resolve() requires awaiting-calls, not ${this.phaseName}`);
    }
    const offence = this.submitted[this.state.possession === 1 ? 1 : 0];
    const defence = this.submitted[this.state.possession === 1 ? 0 : 1];
    if (offence === null || defence === null)
      throw new Error('both sides must call before resolving');

    const pair: CallPair = { offence, defence };
    const resolution = this.adapter.resolve(this.state, pair, this.turnRng('resolve'));
    this.pending = resolution;

    const proposed = this.adapter.keyMoment(this.state, resolution);
    if (proposed !== null && this.wantsKeyMoment(proposed)) {
      this.invocation = proposed;
      this.phaseName = 'key-moment';
      return resolution;
    }

    this.phaseName = 'resolved';
    return resolution;
  }

  /** The moment awaiting the player, or `null`. */
  keyMoment(): ArcadeInvocation | null {
    return this.phaseName === 'key-moment' ? this.invocation : null;
  }

  /**
   * Feeds an arcade result back into the pending turn. The adapter decides what the result means;
   * an adapter that does not implement `applyKeyMoment` keeps the sim's own outcome, which is the
   * honest fallback rather than a silent guess at what the player earned.
   */
  settleKeyMoment(
    outcome: Omit<KeyMomentOutcome, 'invocation' | 'simWouldHave' | 'simPoints'>,
  ): TurnResolution {
    if (this.phaseName !== 'key-moment' || this.invocation === null || this.pending === null) {
      throw new Error(`settleKeyMoment() requires a pending key moment, not ${this.phaseName}`);
    }

    const full: KeyMomentOutcome = {
      ...outcome,
      invocation: this.invocation,
      // What the sim drew before the player touched it — `09` §2.4's counterfactual, recorded at
      // the only moment it is knowable.
      simWouldHave: this.pending.points > 0,
      simPoints: this.pending.points,
    };

    this.pending =
      this.adapter.applyKeyMoment?.(this.state, this.pending, full) ??
      ({ ...this.pending, fromKeyMoment: full } satisfies TurnResolution);
    this.invocation = null;
    this.phaseName = 'resolved';
    return this.pending;
  }

  /** The line the turn screen shows. */
  narrate(resolution: TurnResolution): NarrationLine {
    return this.adapter.narrate(this.state, resolution);
  }

  /** The turn as an animated diagram, or `null` when the sport has none (`09` §2.1). */
  diagram(resolution: TurnResolution): TurnDiagram | null {
    return this.adapter.diagram?.(this.state, resolution) ?? null;
  }

  /**
   * Commits the resolved turn: emits its events, moves the score, spends the clock, hands over
   * possession, and sets up the next turn. Returns the committed resolution.
   */
  advance(): TurnResolution {
    if (this.phaseName !== 'resolved' || this.pending === null) {
      throw new Error(`advance() requires a resolved turn, not ${this.phaseName}`);
    }
    const resolution = this.pending;

    // Order matters and is the same as Live's: the sport's events first, then the score, then the
    // clock. A `score` event that arrived before the shot it came from would read as a bug in every
    // consumer that folds the stream in order.
    for (const turnEvent of resolution.events) {
      this.machine.bus.emit({ ...turnEvent, step: this.machine.steps });
    }
    for (const score of scoresOf(resolution)) {
      this.machine.addScore(resolution.attacking, score.points, score.actor ?? resolution.actor);
      this.state.score[resolution.attacking === 1 ? 1 : 0] += score.points;
    }

    this.adapter.apply?.(this.state, resolution);
    this.history.push(resolution);
    this.pending = null;
    this.submitted = [null, null];

    this.spend(resolution.seconds);
    this.state.turn += 1;
    if (!resolution.retainsPossession) {
      this.state.possession = this.state.possession === 1 ? 0 : 1;
    }

    this.settleClock();
    return resolution;
  }

  /** Ends the match early — a quit, a forfeit, a mercy rule. */
  abandon(): void {
    if (this.phaseName === 'over') return;
    this.machine.abandon();
    this.phaseName = 'over';
  }

  result(): MatchResult | null {
    return this.machine.result();
  }

  view(): PlaybookView {
    return {
      phase: this.phaseName,
      turn: this.state.turn,
      turnKind: this.state.turnKind,
      period: this.state.period,
      periodClock: this.state.clock,
      possession: this.state.possession,
      score: [this.state.score[0], this.state.score[1]],
      playerSide: this.state.playerSide,
      finished: this.phaseName === 'over',
      lastTurn: this.history.at(-1) ?? null,
      keyMoment: this.keyMoment(),
    };
  }

  /**
   * The generator for this turn. Forked by turn number and purpose, never taken from a running
   * stream: a resolution model that grows a draw next month must not shift the turn after it
   * (`engine/rng.ts` — fork by label, not by position).
   */
  private turnRng(purpose: string): Rng {
    return this.rng.fork(`turn-${this.state.turn}:${purpose}`);
  }

  /** Whether this proposal clears the frequency setting's bar. */
  private wantsKeyMoment(proposed: ArcadeInvocation): boolean {
    return proposed.leverage >= LEVERAGE_FLOOR[this.frequency];
  }

  /** Spends game seconds as simulation steps, so Playbook and Live burn the same clock. */
  private spend(gameSeconds: number): void {
    const steps = Math.max(1, Math.round(gameSeconds / this.clock.secondsPerStep));
    for (let i = 0; i < steps; i += 1) {
      if (this.machine.isFinished || !this.machine.isRunning) break;
      this.machine.step();
    }
    this.state.clock = Math.max(0, this.state.clock - gameSeconds);
  }

  /** Reads the clock back off the state machine and decides what the match does next. */
  private settleClock(): void {
    if (this.machine.isFinished) {
      this.phaseName = 'over';
      return;
    }

    if (this.machine.currentPhase === MatchPhase.PERIOD_BREAK) {
      this.machine.nextPeriod();
      this.state.period = this.machine.currentPeriod;
      this.state.clock =
        this.state.period > this.regulationPeriods
          ? (this.clock.overtimeSeconds ?? this.clock.periodSeconds)
          : this.clock.periodSeconds;
      // A new period starts with a fresh jump ball in basketball and a kick-off in soccer; either
      // way the sport decides, and until one does the alternating possession is the fair default.
    }

    if (this.adapter.isFinished?.(this.state) === true || this.state.turn >= MAX_TURNS) {
      this.machine.abandon();
      this.phaseName = 'over';
      return;
    }

    this.phaseName = 'awaiting-calls';
  }
}

/** What the turn screen, the hot-seat hand-over, and the balance harness all read. */
export interface PlaybookView {
  readonly phase: PlaybookPhase;
  readonly turn: number;
  readonly turnKind: PlaybookState['turnKind'];
  readonly period: number;
  readonly periodClock: number;
  readonly possession: Side;
  readonly score: readonly [number, number];
  readonly playerSide: Side;
  readonly finished: boolean;
  readonly lastTurn: TurnResolution | null;
  readonly keyMoment: ArcadeInvocation | null;
}

/**
 * Plays a whole match with both sides on auto-call — the balance harness (T-5.11) and the
 * determinism tests. Key moments are off: a headless batch has nobody to play them, and taking the
 * sim's own outcome is what makes the comparison against Live a comparison of the two *models*.
 */
export function simulatePlaybookMatch<S>(
  options: Omit<PlaybookMatchOptions<S>, 'keyMoments'>,
): PlaybookMatch<S> {
  const match = new PlaybookMatch<S>({ ...options, keyMoments: 'off' });

  while (!match.finished) {
    for (const side of [0, 1] as const) {
      const call = match.autoCall(side);
      if (call === null) throw new Error('simulatePlaybookMatch needs an adapter with autoCall');
      match.submit(call);
    }
    match.resolve();
    match.advance();
  }

  return match;
}
