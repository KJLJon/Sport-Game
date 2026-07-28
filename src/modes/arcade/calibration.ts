/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.2 — Calibration: ratings + familiarity → window sizes and speeds (INV-10)
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §2.4 (the fairness rule), §3.3, 05-data-model.md §3 (derivation)
 * @invariant INV-10 (window size is a function of the athlete's ratings, never of the player's past
 *            scores), INV-1 (difficulty never modifies an attribute or a derived rating)
 *
 * Purpose: turns an athlete into a difficulty window. This is the single most important rule in the
 * mode (`09` §2.4): a great shooter gets a wide, slow, forgiving window; a soccer player taking a
 * basketball free throw gets a narrow, fast, drifting one. Your input decides *where in the outcome
 * band* you land; the athlete decides *how wide that band is*.
 *
 * **How INV-10 is enforced.** `calibrate()` takes derived ratings and a difficulty. It has no
 * parameter — and this module has no import — through which a personal best, a streak, a session
 * count, or anything else about the player's history could reach it. The invariant test asserts both
 * the behaviour and the absence of those imports, because a signature is easier to keep honest than
 * a convention.
 *
 * **How INV-1 is kept.** Difficulty enters once, at the very end, as a multiplier on the *window*
 * — never on the rating that produced it. The rating that goes in is the rating the athlete card
 * shows, on every level.
 */
import { deriveRatings, type SportRatingTables } from '../../athletes/derivation.ts';
import { familiarityBand } from '../../athletes/familiarity.ts';
import { clamp, sportSkillFor, type Athlete } from '../../athletes/types.ts';
import type { SportId } from '../../sports/types.ts';
import { difficultyProfile, type Difficulty } from '../difficulty.ts';
import { ARCADE_WINDOW_LABELS, type ArcadeCalibration, type ArcadeWindowLabel } from './types.ts';

/**
 * The endpoints every calibrated number is interpolated between: the value at rating 0 and the value
 * at rating 100. A game that wants a different feel overrides the pair rather than reimplementing
 * the mapping, so every game's difficulty still moves with the athlete in the same direction.
 *
 * @spec-ref 09-modes-and-arcade.md §2.4 — "wide, slow, forgiving" against "narrow, fast, drifting"
 * is literally these six pairs.
 */
export interface ArcadeWindowShape {
  /** Timing-window half-width in seconds, at rating 0 and at rating 100. */
  readonly window: readonly [number, number];
  /** Marker-speed multiplier. A novice's meter runs *faster*, so this pair descends. */
  readonly speed: readonly [number, number];
  /** Wobble amplitude, `0–1`. Descends: a specialist's meter runs true. */
  readonly drift: readonly [number, number];
  /** Reaction allowance in seconds. */
  readonly reaction: readonly [number, number];
  /** Worst possible outcome, `0–1`. A novice can whiff completely; a star cannot. */
  readonly floor: readonly [number, number];
  /** Best possible outcome, `0–1`. Perfect input from a novice is still not a certainty. */
  readonly ceiling: readonly [number, number];
}

export const DEFAULT_WINDOW_SHAPE: ArcadeWindowShape = {
  window: [0.07, 0.3],
  speed: [1.45, 0.72],
  drift: [0.85, 0.04],
  reaction: [0.2, 0.58],
  floor: [0, 0.42],
  ceiling: [0.52, 0.98],
};

function lerp(pair: readonly [number, number], t: number): number {
  return pair[0] + (pair[1] - pair[0]) * t;
}

/** Rounds to 4 decimals, so two identical calibrations compare equal after a JSON round-trip. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The athlete's ability at one game: the mean of the derived ratings the game reads. A mean rather
 * than a weighted sum because a game names two or three ratings that are all genuinely part of the
 * same skill — weighting them would be a second, invisible tuning surface on top of `05` §3's.
 */
export function arcadeRating(
  ratings: Readonly<Record<string, number>>,
  names: readonly string[],
): number {
  if (names.length === 0) return 50;
  let total = 0;
  let counted = 0;
  for (const name of names) {
    const value = ratings[name];
    if (value === undefined) continue;
    total += value;
    counted++;
  }
  return counted === 0 ? 50 : total / counted;
}

/** Plain-language width for the athlete picker (US-16.3: "states plainly whether it is wide"). */
export function windowLabel(rating: number): ArcadeWindowLabel {
  if (rating < 30) return ARCADE_WINDOW_LABELS[0];
  if (rating < 45) return ARCADE_WINDOW_LABELS[1];
  if (rating < 60) return ARCADE_WINDOW_LABELS[2];
  if (rating < 78) return ARCADE_WINDOW_LABELS[3];
  return ARCADE_WINDOW_LABELS[4];
}

/** How the picker describes the familiarity behind the window. */
const BAND_PHRASES = {
  novice: 'new to this sport',
  learning: 'still learning it',
  competent: 'getting the hang of it',
  comfortable: 'comfortable here',
  natural: 'a natural at this',
} as const;

/**
 * The one sentence the athlete picker shows. Names both halves of the reason — the window and the
 * familiarity behind it — because "narrow" without "new to this sport" reads as a punishment rather
 * than as the thing practice fixes.
 */
export function windowHint(label: ArcadeWindowLabel, familiarity: number): string {
  const width = label === 'very wide' ? 'Very wide' : label[0]?.toUpperCase() + label.slice(1);
  return `${width} window — ${BAND_PHRASES[familiarityBand(familiarity)]}.`;
}

export interface CalibrateOptions {
  /** The ability, 1–99, that every window is derived from. */
  readonly rating: number;
  /** The athlete's familiarity with this sport, for the hint only. */
  readonly familiarity: number;
  readonly difficulty: Difficulty;
  readonly shape?: ArcadeWindowShape;
}

/**
 * The calibration for one rating at one difficulty. Difficulty scales only the two forgiveness
 * numbers — the window and the reaction allowance — and nothing that describes the athlete (INV-1).
 */
export function calibrateWindow(options: CalibrateOptions): ArcadeCalibration {
  const shape = options.shape ?? DEFAULT_WINDOW_SHAPE;
  const rating = clamp(options.rating, 1, 99);
  const t = rating / 100;
  const forgiveness = difficultyProfile(options.difficulty).timingWindow;
  const label = windowLabel(rating);

  return {
    rating: round(rating),
    windowSeconds: round(lerp(shape.window, t) * forgiveness),
    speed: round(lerp(shape.speed, t)),
    drift: round(lerp(shape.drift, t)),
    reactionSeconds: round(lerp(shape.reaction, t) * forgiveness),
    floor: round(lerp(shape.floor, t)),
    ceiling: round(lerp(shape.ceiling, t)),
    label,
    hint: windowHint(label, options.familiarity),
  };
}

export interface AthleteCalibrationOptions {
  readonly athlete: Athlete;
  readonly sport: SportId;
  readonly tables: SportRatingTables;
  /** The derived ratings this game reads. */
  readonly ratings: readonly string[];
  readonly difficulty: Difficulty;
  readonly shape?: ArcadeWindowShape;
}

/**
 * What every `ArcadeGameDef.calibrate()` calls. Runs the athlete through the *same* derivation the
 * athlete card and the Live simulation use — familiarity gate, sub-skill bonus, physical modifiers
 * and all — so tuning an athlete's basketball ability tunes their arcade window with it (`09` §7,
 * "ratings are the constant").
 */
export function calibrateForAthlete(options: AthleteCalibrationOptions): ArcadeCalibration {
  const derived = deriveRatings(options.athlete, options.sport, options.tables);
  const skill = sportSkillFor(options.athlete, options.sport);
  return calibrateWindow({
    rating: arcadeRating(derived, options.ratings),
    familiarity: skill.familiarity,
    difficulty: options.difficulty,
    ...(options.shape === undefined ? {} : { shape: options.shape }),
  });
}
