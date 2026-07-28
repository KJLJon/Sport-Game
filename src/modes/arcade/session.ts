/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.1 — Arcade framework: `ArcadeGameDef`, host, session lifecycle, scoring, star ratings
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.3 (structure of each arcade game), §5 (mode architecture)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-9 (one event stream)
 *
 * Purpose: a run of a mini-game, as a plain object anything can step and read. It owns the score,
 * the lives, the clock, the streaks, the star rating, and the collected events; the game it mounts
 * owns only its mechanic.
 *
 * **Headless on purpose.** There is no canvas and no DOM here. The screen (T-4.3) draws `view()`,
 * the party mode (T-4.11) runs several of these in turn, and the anti-farm tests (T-4.13) drive
 * hundreds of them with synthetic input and no renderer at all.
 *
 * **Determinism.** Everything random forks from `config.seed`, so a daily challenge is the same run
 * for everyone who plays it that day (`09` §3.3) and a challenge code reproduces a friend's exact
 * scenario. The clock advances by the `dt` the caller passes, never by wall time.
 */
import { createRng, type Rng } from '../../engine/rng.ts';
import { EMPTY_FRAME, type InputFrame } from '../../engine/input/types.ts';
import type { SportEvent } from '../../engine/match/events.ts';
import { starsFor, toNextStar } from './scoring.ts';
import {
  PRACTICE_RULES,
  type ArcadeAttempt,
  type ArcadeCalibration,
  type ArcadeConfig,
  type ArcadeEndReason,
  type ArcadeGameDef,
  type ArcadeGameView,
  type ArcadeHost,
  type ArcadeOutcome,
  type ArcadePhase,
  type ArcadeResult,
  type ArcadeRunRules,
  type ArcadeSession,
  type ArcadeView,
} from './types.ts';

/** Seconds of "get ready" before a run starts. Any button press skips it (`09` §3.1). */
export const READY_SECONDS = 1.5;

/** The view a game reports before it has done anything. */
const IDLE_GAME_VIEW: ArcadeGameView = { meter: null, target: null, caption: '' };

/** Which of the game's own rules apply, given the mode and any override. */
export function rulesFor(game: ArcadeGameDef, config: ArcadeConfig): ArcadeRunRules {
  if (config.rules !== undefined) return config.rules;
  // `09` §3.3 — practice is unlimited and unrewarded; scored and daily runs share one structure.
  return config.mode === 'practice' ? PRACTICE_RULES : game.scored;
}

/** Whether a run in this mode pays out. Practice never does (`09` §3.3). */
export function isRewarded(mode: ArcadeConfig['mode']): boolean {
  return mode !== 'practice';
}

function anyInput(frame: InputFrame): boolean {
  return frame.pressed !== 0 || Math.abs(frame.moveX) > 0.5 || Math.abs(frame.moveY) > 0.5;
}

/**
 * What the mode layer (T-4.4) may change about a run *after* the athlete has been calibrated.
 *
 * Daily modifiers live here rather than inside `calibrate()` on purpose: a modifier is part of the
 * scenario — the same for everyone who plays that day — and letting it reach the calibration call
 * would widen INV-10's signature to admit things that are not the athlete. Calibration answers "how
 * good is this athlete at this"; this answers "and what is different about today".
 */
export interface ArcadeRunOverrides {
  readonly calibration?: ArcadeCalibration;
  /** Multiplier on every point scored. `1` unless a modifier says otherwise. */
  readonly scoreMultiplier?: number;
}

/**
 * One run of one mini-game. Construct, `step()` until `finished`, read `view()` whenever you want
 * to draw, and take `result()` when it is over.
 */
export class ArcadeRun implements ArcadeHost {
  readonly game: ArcadeGameDef;
  readonly config: ArcadeConfig;
  readonly calibration: ArcadeCalibration;
  readonly rng: Rng;

  private readonly rules: ArcadeRunRules;
  private readonly session: ArcadeSession;
  private readonly collected: SportEvent[] = [];

  private phase: ArcadePhase = 'ready';
  private countdown = READY_SECONDS;
  private steps = 0;
  private runSeconds = 0;
  private scoreValue = 0;
  private livesLeft: number | null;
  private attemptCount = 0;
  private madeCount = 0;
  private streakValue = 0;
  private bestStreakValue = 0;
  private outcome: ArcadeOutcome | null = null;
  private endReason: ArcadeEndReason = 'complete';
  private readonly scoreMultiplier: number;

  constructor(game: ArcadeGameDef, config: ArcadeConfig, overrides: ArcadeRunOverrides = {}) {
    this.game = game;
    this.config = config;
    this.rules = rulesFor(game, config);
    this.livesLeft = this.rules.lives;
    this.calibration = overrides.calibration ?? game.calibrate(config.athlete, config.difficulty);
    this.scoreMultiplier = Math.max(0, overrides.scoreMultiplier ?? 1);

    // The session gets its own stream, forked by label rather than by position, so adding a draw
    // from the framework can never shift the game's own sequence (`engine/rng.ts`, INV-8).
    this.rng = createRng(config.seed).fork(`arcade:${game.id}`);
    this.session = game.mount(this, config);
  }

  // ── ArcadeHost ────────────────────────────────────────────────────────────

  get elapsed(): number {
    return this.runSeconds;
  }

  get remaining(): number | null {
    return this.rules.seconds === null ? null : Math.max(0, this.rules.seconds - this.runSeconds);
  }

  get lives(): number | null {
    return this.livesLeft;
  }

  attempt(attempt: ArcadeAttempt): void {
    if (this.phase !== 'running') return;

    const points = Math.round(Math.max(0, attempt.points) * this.scoreMultiplier);
    this.attemptCount++;
    this.scoreValue += points;

    if (attempt.made) {
      this.madeCount++;
      this.streakValue++;
      if (this.streakValue > this.bestStreakValue) this.bestStreakValue = this.streakValue;
    } else {
      this.streakValue = 0;
      if (attempt.costsLife !== false && this.livesLeft !== null) {
        this.livesLeft = Math.max(0, this.livesLeft - 1);
      }
    }

    this.outcome = {
      made: attempt.made,
      label: attempt.label,
      quality: attempt.quality,
      points,
    };

    // The framework stamps the step, so an arcade event is indistinguishable in shape from a Live
    // one and no consumer can tell which mode produced it (INV-9).
    for (const event of attempt.events ?? []) {
      this.collected.push({ ...event, step: this.steps });
    }

    if (this.livesLeft === 0) this.finish('lives');
  }

  bonus(points: number, label = 'Bonus'): void {
    if (this.phase !== 'running') return;
    const gained = Math.round(Math.max(0, points) * this.scoreMultiplier);
    this.scoreValue += gained;
    this.outcome = { made: true, label, quality: 1, points: gained };
  }

  finish(reason: ArcadeEndReason = 'complete'): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.endReason = reason;
    this.session.end?.();
  }

  // ── Run lifecycle ─────────────────────────────────────────────────────────

  get finished(): boolean {
    return this.phase === 'over';
  }

  /** Skips the countdown. The screen calls it when the player taps "Go". */
  start(): void {
    if (this.phase === 'ready') {
      this.phase = 'running';
      this.countdown = 0;
    }
  }

  /**
   * Advances the run by `dt` seconds. Returns the events produced *this step*, so a caller can feed
   * progression incrementally rather than waiting for the run to end.
   */
  step(input: InputFrame = EMPTY_FRAME, dt: number): readonly SportEvent[] {
    if (this.phase === 'over' || dt <= 0) return [];

    const before = this.collected.length;
    this.steps++;

    if (this.phase === 'ready') {
      this.countdown -= dt;
      // A press during the countdown starts the run rather than being swallowed — a player who is
      // already going should not be told to wait (`09` §3.1, ten seconds to fun).
      if (this.countdown <= 0 || anyInput(input)) this.start();
      return [];
    }

    this.runSeconds += dt;
    this.session.update(input, dt);

    // Checked after the update so an attempt landing on the buzzer still counts.
    if (this.phase === 'running' && this.rules.seconds !== null && this.remaining === 0) {
      this.finish('clock');
    }

    return this.collected.slice(before);
  }

  /** Ends the run because the player quit. Scored, but flagged as a quit. */
  quit(): void {
    this.finish('quit');
  }

  // ── Read models ───────────────────────────────────────────────────────────

  get score(): number {
    return this.scoreValue;
  }

  get stars(): ArcadeResult['stars'] {
    return starsFor(this.scoreValue, this.game.stars);
  }

  view(): ArcadeView {
    const gameView = this.phase === 'ready' ? IDLE_GAME_VIEW : this.session.view();
    return {
      phase: this.phase,
      prompt: this.session.prompt,
      score: this.scoreValue,
      stars: this.stars,
      toNextStar: toNextStar(this.scoreValue, this.game.stars),
      lives: this.livesLeft,
      livesMax: this.rules.lives,
      remaining: this.remaining,
      elapsed: this.runSeconds,
      attempts: this.attemptCount,
      made: this.madeCount,
      streak: this.streakValue,
      bestStreak: this.bestStreakValue,
      lastOutcome: this.outcome,
      countdown: Math.max(0, this.countdown),
      game: gameView,
      calibration: this.calibration,
    };
  }

  /** Everything collected so far. The run's contribution to progression (T-4.10). */
  events(): readonly SportEvent[] {
    return this.collected;
  }

  /** The finished run, or `null` while it is still going. */
  result(): ArcadeResult | null {
    if (this.phase !== 'over') return null;
    return {
      game: this.game.id,
      sport: this.game.sport,
      mode: this.config.mode,
      seed: this.config.seed,
      athleteId: this.config.athlete.id,
      difficulty: this.config.difficulty,
      score: this.scoreValue,
      stars: this.stars,
      attempts: this.attemptCount,
      made: this.madeCount,
      bestStreak: this.bestStreakValue,
      seconds: this.runSeconds,
      reason: this.endReason,
      events: this.collected,
      rewarded: isRewarded(this.config.mode),
    };
  }

  /** Draws the mounted game, if it knows how. */
  draw(...args: Parameters<NonNullable<ArcadeSession['draw']>>): void {
    this.session.draw?.(...args);
  }
}
