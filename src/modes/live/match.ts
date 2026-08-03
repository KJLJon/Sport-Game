/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.10 — Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators
 * @task    T-2.11 — Pause menu, quit, in-match settings, post-match summary with box score
 * @story   US-2.3 — See what is happening
 * @story   US-2.4 — See the state of the match at a glance
 * @design  04-architecture.md §5 (the sport module seam), §7 (seed + setup + inputs),
 *          06-game-design.md §4 (match presentation)
 * @invariant INV-5 (no sport-specific branching outside the sport), INV-8 (determinism),
 *            INV-9 (one event stream)
 *
 * Purpose: a running match, as a plain object anything can step and read. It owns the world, the
 * sport module, the match clock, and the box score, and it exposes exactly one read model —
 * `MatchView` — for the HUD, the pause screen, and the post-match summary to share.
 *
 * **Why a view object rather than direct access.** The HUD needs the shot clock in game seconds, the
 * bonus flags, and who is being controlled. Letting it reach into `sport.state.rules` would put
 * basketball's field names in the HUD and break INV-5 the first time a second sport arrives. The
 * sport publishes what a HUD can use; the HUD reads only that.
 *
 * There is no rendering and no input here. This module is headless on purpose: the balance harness
 * (T-2.13) runs five hundred games through it with no canvas in sight.
 */
import type { Athlete } from '../../athletes/types.ts';
import type { Difficulty } from '../difficulty.ts';
import type { AssistSettings } from '../assists.ts';
import { createRng, type Rng } from '../../engine/rng.ts';
import { EventBus, EventKind, type Side, type SportEvent } from '../../engine/match/events.ts';
import {
  MatchPhase,
  MatchStateMachine,
  type MatchPhaseName,
} from '../../engine/match/state-machine.ts';
import { World } from '../../engine/world.ts';
import { EMPTY_FRAME, type InputFrame } from '../../engine/input/types.ts';
import type { EntityId } from '../../engine/world.ts';
import type { SportModule, SportStatus } from '../../sports/types.ts';
import { applyEvent, createBoxScore, teamLine, type BoxScore, type TeamLine } from './box-score.ts';

/** Everything the HUD, the pause menu, and the summary read. Plain data, rebuilt each frame. */
export interface MatchView {
  readonly phase: MatchPhaseName;
  readonly period: number;
  readonly periodName: string;
  readonly finished: boolean;
  readonly score: readonly [number, number];
  readonly status: SportStatus;
  readonly box: BoxScore;
  readonly playerSide: Side;
  readonly steps: number;
}

export interface MatchOptions {
  readonly seed: string;
  readonly sport: SportModule;
  readonly playerSide?: 0 | 1 | -1;
  /** Overrides the sport's squad size — the balance harness and practice modes use it. */
  readonly squadSize?: number;
  /**
   * The actual athletes, per side. Absent means the sport rolls anonymous ones, which is what the
   * Live balance harness wants; INV-11's parity batch supplies real rosters so that the two modes
   * are being asked about the same players.
   */
  readonly rosters?: readonly (readonly Athlete[])[];
  /** The CPU's level (T-7.7). Absent means Pro — the balance harness runs at Pro by default. */
  readonly difficulty?: Difficulty;
  /**
   * A level per side, for the AI regression harness (T-7.10). Absent means both sides play at
   * `difficulty`, which is every match a player actually plays.
   */
  readonly difficulties?: readonly [Difficulty, Difficulty];
  /** The player's assists (T-7.8). Absent means none — a headless match has no player. */
  readonly assists?: AssistSettings;
}

/**
 * One match. Construct, `step()` until `finished`, read `view()` whenever you want to draw.
 *
 * Everything random forks from the one seed, so `(seed, setup, inputs)` reconstructs the match
 * exactly (`04` §7, INV-8).
 */
export class LiveMatch {
  readonly world: World;
  readonly sport: SportModule;
  readonly bus = new EventBus();
  readonly machine: MatchStateMachine;
  readonly box: BoxScore = createBoxScore();
  readonly playerSide: Side;

  /** The sport's own state. Opaque here; only the sport and its status reporter read it. */
  readonly sportState: unknown;

  private readonly rng: Rng;
  private readonly inputs = new Map<EntityId, InputFrame>();
  private breakSteps = 0;

  constructor(options: MatchOptions) {
    this.sport = options.sport;
    this.playerSide = options.playerSide ?? -1;

    this.world = new World({
      width: this.sport.field.width,
      height: this.sport.field.height,
      cellSize: 3,
      capacity: Math.max(32, this.sport.meta.squadSize * 2 + 8),
    });

    const rng = createRng(options.seed);
    this.sportState = this.sport.createState(
      {
        seed: options.seed,
        playerSide: this.playerSide as 0 | 1 | -1,
        ...(options.squadSize === undefined ? {} : { squadSize: options.squadSize }),
        ...(options.rosters === undefined ? {} : { rosters: options.rosters }),
        ...(options.difficulty === undefined ? {} : { difficulty: options.difficulty }),
        ...(options.difficulties === undefined ? {} : { difficulties: options.difficulties }),
        ...(options.assists === undefined ? {} : { assists: options.assists }),
      },
      this.world,
      rng,
    );
    this.rng = rng.fork('sim');

    this.machine = new MatchStateMachine(this.sport.rules, this.bus);
    this.bus.on((event) => applyEvent(this.box, event));
    this.machine.start();
  }

  /** The athlete the local player's input is delivered to. */
  get controlled(): EntityId {
    return this.status().controlled;
  }

  /** Hands this step's input to whoever the sport says is being controlled. */
  setInput(frame: InputFrame): void {
    this.inputs.clear();
    const controlled = this.controlled;
    if (controlled >= 0) this.inputs.set(controlled, frame);
  }

  /**
   * One simulation step: the sport, then the clock.
   *
   * That order matters. A basket scored on the buzzer counts, so the sport's events for the step are
   * emitted before the clock is allowed to end the period.
   */
  step(): void {
    if (this.machine.isFinished) return;

    if (this.machine.currentPhase === MatchPhase.PERIOD_BREAK) {
      // A short, skippable break (`06` §4) rather than an instant cut to the next period.
      this.breakSteps++;
      if (this.breakSteps >= BREAK_STEPS) {
        this.breakSteps = 0;
        this.machine.nextPeriod();
        this.startPeriod();
      }
      return;
    }

    const events = this.sport.step(
      this.sportState as never,
      this.world,
      this.inputs,
      1 / 60,
      this.rng,
    );

    // The sport's `score` is a *request*; the machine's is the record, and it is the only one that
    // reaches the bus. Emitting both would count every basket twice in the box score, and having
    // two sources of the scoreline is how a HUD and a summary end up disagreeing.
    for (const event of events) {
      if (event.kind === EventKind.SCORE) this.applyScore(event);
      else this.bus.emit(event);
    }

    this.machine.step();
  }

  /** Skips the rest of a period break immediately. */
  skipBreak(): void {
    if (this.machine.currentPhase !== MatchPhase.PERIOD_BREAK) return;
    this.breakSteps = 0;
    this.machine.nextPeriod();
    this.startPeriod();
  }

  get finished(): boolean {
    return this.machine.isFinished;
  }

  /** The read model. Rebuilt per call; it is a handful of field reads, not a copy of the world. */
  view(): MatchView {
    return {
      phase: this.machine.currentPhase,
      period: this.machine.currentPeriod,
      periodName: this.sport.meta.periodName,
      finished: this.machine.isFinished,
      score: [this.machine.homeScore, this.machine.awayScore],
      status: this.status(),
      box: this.box,
      playerSide: this.playerSide,
      steps: this.machine.steps,
    };
  }

  teamLine(side: Side): TeamLine {
    return teamLine(this.box, side);
  }

  private status(): SportStatus {
    const reporter = this.sport.status?.bind(this.sport);
    if (reporter !== undefined) return reporter(this.sportState as never);
    return {
      actionClock: null,
      teamFouls: null,
      bonus: null,
      possession: -1,
      controlled: -1,
      stoppage: null,
      meter: null,
      periodClock: 0,
    };
  }

  /**
   * The score lives on the match clock, not in the sport, so every mode reports it the same way.
   * The sport says a basket happened; the machine is what makes it a scoreline.
   */
  private applyScore(event: SportEvent): void {
    if (event.side !== 0 && event.side !== 1) return;
    if (event.actor === undefined) this.machine.addScore(event.side, event.value ?? 0);
    else this.machine.addScore(event.side, event.value ?? 0, event.actor);
  }

  private startPeriod(): void {
    this.sport.startPeriod?.(this.sportState as never, this.machine.currentPeriod);
  }
}

/** Steps of period break before the next period starts on its own. Two real seconds. */
const BREAK_STEPS = 120;

/** Runs a whole match with no input — the balance harness (T-2.13) and the determinism tests. */
export function simulateMatch(options: MatchOptions): LiveMatch {
  const match = new LiveMatch(options);
  match.setInput(EMPTY_FRAME);
  let guard = 0;
  while (!match.finished && guard++ < MAX_STEPS) match.step();
  return match;
}

/** A hard ceiling, so a sport that never finishes fails a test rather than hanging one. */
const MAX_STEPS = 60 * 60 * 60;
