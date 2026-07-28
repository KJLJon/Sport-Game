/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.1 — Arcade framework: `ArcadeGameDef`, host, session lifecycle, scoring, star ratings
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §3 (arcade mode), §5 (mode architecture)
 * @invariant INV-9 (all modes emit the same event stream), INV-10 (window size comes from the
 *            athlete, never from the player's past scores)
 *
 * Purpose: the arcade seam. A mini-game is one `ArcadeGameDef`: it says how it is unlocked, how a
 * scored run ends, what a star is worth, how the athlete's ratings become a difficulty window, and
 * how to mount an interactive session. Everything else — lives, clock, score, streaks, star rating,
 * event collection — belongs to the framework and is written once (`session.ts`).
 *
 * **The split that matters.** A game implements a *mechanic*: it reads input, decides when an
 * attempt happened, and reports it. It does not own the score, the lives, or the clock, because five
 * games owning those five times is five places for the rules of a scored run to drift. `09` §3.3
 * describes one structure for every game, so one object implements it.
 *
 * **The fairness contract.** `calibrate()` takes an athlete and a difficulty and nothing else. There
 * is no parameter through which a personal best, a streak, or a session history could reach it —
 * INV-10 is a signature, not a convention (`09` §2.4).
 */
import type { InputFrame } from '../../engine/input/types.ts';
import type { Rng } from '../../engine/rng.ts';
import type { SportEvent } from '../../engine/match/events.ts';
import type { Canvas2D } from '../../engine/render/renderer.ts';
import type { Athlete } from '../../athletes/types.ts';
import type { SportId } from '../../sports/types.ts';
import type { AchievementId } from '../../achievements/ids.ts';
import type { Difficulty } from '../difficulty.ts';

export type ArcadeGameId = string;

/** `09` §3.3 — the three ways a game is played. */
export const ARCADE_MODES = ['practice', 'scored', 'daily'] as const;
export type ArcadeMode = (typeof ARCADE_MODES)[number];

export function isArcadeMode(value: string): value is ArcadeMode {
  return (ARCADE_MODES as readonly string[]).includes(value);
}

/** A daily-challenge twist (T-4.4). Games apply the ones they understand and ignore the rest. */
export type ArcadeModifierId = string;

/**
 * How the athlete's ability shows up in the mechanic. Produced by `calibrate()` (T-4.2) and handed
 * to the session; every number a game uses to decide how hard it is comes from here, so there is
 * exactly one place where "who is playing" enters the difficulty of a run.
 */
export interface ArcadeCalibration {
  /** The athlete's ability at this game, 1–99. Familiarity is already inside it (`05` §3). */
  readonly rating: number;
  /** Half-width of the forgiving timing band, in seconds. Wide is kind. */
  readonly windowSeconds: number;
  /** Multiplier on the game's base marker speed. Below 1 is slower, and therefore easier. */
  readonly speed: number;
  /** Wobble amplitude, `0–1`. A novice's meter wanders; a specialist's runs true. */
  readonly drift: number;
  /** Reaction allowance in seconds, for the reaction-test games. */
  readonly reactionSeconds: number;
  /** A perfect input lands at `ceiling`, the worst possible one at `floor`; both `0–1`. */
  readonly floor: number;
  readonly ceiling: number;
  /** Plain-language width, for the athlete picker's honest hint (US-16.3). */
  readonly label: ArcadeWindowLabel;
  /** One sentence the picker shows, e.g. "Wide window — this is her sport." */
  readonly hint: string;
}

export const ARCADE_WINDOW_LABELS = ['narrow', 'tight', 'fair', 'wide', 'very wide'] as const;
export type ArcadeWindowLabel = (typeof ARCADE_WINDOW_LABELS)[number];

/** How a scored run ends. Exactly one of the two is set; practice sets neither. */
export interface ArcadeRunRules {
  /** Lives before the run ends, or `null` for a clock-limited game. */
  readonly lives: number | null;
  /** Seconds on the clock, or `null` for a lives-limited game. */
  readonly seconds: number | null;
}

export const PRACTICE_RULES: ArcadeRunRules = { lives: null, seconds: null };

/** Everything a session needs to know about the run it is part of. */
export interface ArcadeConfig {
  readonly mode: ArcadeMode;
  /** The run's seed. Two runs with the same seed and the same inputs are the same run (INV-8). */
  readonly seed: string;
  readonly athlete: Athlete;
  readonly difficulty: Difficulty;
  /** Daily modifiers (T-4.4). */
  readonly modifiers?: readonly ArcadeModifierId[];
  /** Overrides the game's own rules — practice removes both limits. */
  readonly rules?: ArcadeRunRules;
  /** Mirrors the layout for a left-handed player (T-4.12). Presentation only. */
  readonly mirror?: boolean;
}

/** One discrete thing the player attempted, reported by the game as it happens. */
export interface ArcadeAttempt {
  readonly made: boolean;
  /** Points to add. Never negative — a bad attempt scores zero, it does not take points away. */
  readonly points: number;
  /** Where in the outcome band the input landed, `0–1`. Drives the feedback wording. */
  readonly quality: number;
  /** Short, colour-independent feedback: "Swish", "Rimmed out", "Too early" (T-4.12). */
  readonly label: string;
  /** Whether a miss costs a life. Defaults to `true`. */
  readonly costsLife?: boolean;
  /** Events for progression (T-4.10). The framework stamps the step number. */
  readonly events?: readonly SportEvent[];
}

/** The last attempt, as the HUD shows it. */
export interface ArcadeOutcome {
  readonly made: boolean;
  readonly label: string;
  readonly quality: number;
  readonly points: number;
}

export const ARCADE_END_REASONS = ['clock', 'lives', 'complete', 'quit'] as const;
export type ArcadeEndReason = (typeof ARCADE_END_REASONS)[number];

/**
 * What the framework gives a running session. Deliberately push-shaped: the game tells the host what
 * happened and never reads or writes the run's score, so a game cannot invent its own scoring rules.
 */
export interface ArcadeHost {
  readonly rng: Rng;
  readonly calibration: ArcadeCalibration;
  readonly config: ArcadeConfig;
  /** Seconds since the run started. */
  readonly elapsed: number;
  /** Seconds left, or `null` when the run has no clock. */
  readonly remaining: number | null;
  /** Lives left, or `null` when the run has no lives. */
  readonly lives: number | null;
  /** Records one attempt: score, streak, life, and events all follow from it. */
  attempt(attempt: ArcadeAttempt): void;
  /** Points with no attempt semantics — a rhythm bonus, a time bonus. */
  bonus(points: number, label?: string): void;
  /** Ends the run early, because the game decided it is over. */
  finish(reason?: ArcadeEndReason): void;
}

/** A mounted, running mini-game. */
export interface ArcadeSession {
  /** The one line shown before the run starts. Ten words or fewer (US-16.1: no reading required). */
  readonly prompt: string;
  /** Advances the mechanic. Called only while the run is actually running. */
  update(input: InputFrame, dt: number): void;
  /** The game's own read model, for the shared HUD and its renderer. */
  view(): ArcadeGameView;
  /** Draws the game. Optional so a headless test never needs a canvas. */
  draw?(ctx: Canvas2D, layout: ArcadeLayout): void;
  /** Called once when the run ends. */
  end?(): void;
}

/**
 * What every game exposes to the shared HUD. Generic on purpose: a HUD that understood "rack" or
 * "defender" would carry one game's vocabulary into shared UI, and the fifth game would break it.
 */
export interface ArcadeGameView {
  /** Meter position, `0–1`, or `null` when nothing is charging. */
  readonly meter: number | null;
  /** The band on the meter that counts, in the same `0–1` units, or `null`. */
  readonly target: ArcadeBand | null;
  /** Short caption: "Rack 3", "Release!". */
  readonly caption: string;
  /** How much of the current phase is left, `0–1`, for a shrinking-window ring. */
  readonly urgency?: number;
}

export interface ArcadeBand {
  readonly from: number;
  readonly to: number;
}

/** The canvas rectangle a game draws into, in device-independent pixels. */
export interface ArcadeLayout {
  readonly width: number;
  readonly height: number;
  /** True when the layout is mirrored for a left-handed player (T-4.12). */
  readonly mirror: boolean;
  /** `true` when the player has asked for reduced motion (T-4.12). */
  readonly reducedMotion: boolean;
}

/**
 * One mini-game. This is the whole of the arcade seam — adding a game means adding one of these to
 * a sport module's `arcade` array and nothing else.
 */
export interface ArcadeGameDef {
  readonly id: ArcadeGameId;
  readonly sport: SportId;
  readonly name: string;
  /** One line for the hub tile. */
  readonly blurb: string;
  /** How long a run takes, in seconds, for the tile. `09` §3.1 — 20–90 s. */
  readonly durationSeconds: number;
  readonly unlockAchievement: AchievementId;
  /** How a scored run ends. */
  readonly scored: ArcadeRunRules;
  /** Score thresholds for 1, 2, and 3 stars, ascending. */
  readonly stars: readonly [number, number, number];
  /** The derived ratings this game reads, in the order the picker explains them. */
  readonly ratings: readonly string[];
  /**
   * Ratings and familiarity → the difficulty window (INV-10). Takes the athlete and the difficulty,
   * and nothing else, ever.
   */
  calibrate(athlete: Athlete, difficulty: Difficulty): ArcadeCalibration;
  mount(host: ArcadeHost, config: ArcadeConfig): ArcadeSession;
}

/** The result of a finished run. Plain data: it is stored, ranked, and shared as a code. */
export interface ArcadeResult {
  readonly game: ArcadeGameId;
  readonly sport: SportId;
  readonly mode: ArcadeMode;
  readonly seed: string;
  readonly athleteId: string;
  readonly difficulty: Difficulty;
  readonly score: number;
  readonly stars: StarCount;
  readonly attempts: number;
  readonly made: number;
  readonly bestStreak: number;
  /** Seconds the run lasted. */
  readonly seconds: number;
  readonly reason: ArcadeEndReason;
  /** The run's events, for progression (T-4.10). */
  readonly events: readonly SportEvent[];
  /** Practice runs are unrewarded (`09` §3.3), and say so here rather than at every consumer. */
  readonly rewarded: boolean;
}

export type StarCount = 0 | 1 | 2 | 3;

export const ARCADE_PHASES = ['ready', 'running', 'over'] as const;
export type ArcadePhase = (typeof ARCADE_PHASES)[number];

/** What the shared arcade HUD draws. Rebuilt each frame; plain data. */
export interface ArcadeView {
  readonly phase: ArcadePhase;
  readonly prompt: string;
  readonly score: number;
  readonly stars: StarCount;
  /** Points still needed for the next star, or `null` at three stars. */
  readonly toNextStar: number | null;
  readonly lives: number | null;
  readonly livesMax: number | null;
  readonly remaining: number | null;
  readonly elapsed: number;
  readonly attempts: number;
  readonly made: number;
  readonly streak: number;
  readonly bestStreak: number;
  readonly lastOutcome: ArcadeOutcome | null;
  /** Seconds left on the pre-run countdown, while `phase` is `ready`. */
  readonly countdown: number;
  readonly game: ArcadeGameView;
  readonly calibration: ArcadeCalibration;
}
