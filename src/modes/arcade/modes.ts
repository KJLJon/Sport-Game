/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.4 — Practice / scored / daily modes; seeded daily challenge
 * @story   US-16.4 — Take a daily challenge
 * @design  09-modes-and-arcade.md §3.3 (structure of each arcade game)
 * @invariant INV-10 (window size comes from the athlete), INV-8 (determinism)
 *
 * Purpose: the one door every arcade run comes through, and the modifier vocabulary the daily
 * challenge draws from.
 *
 * **Why modifiers are applied here and not inside `calibrate()`.** A modifier is a fact about
 * *today's scenario* — the same for everyone who plays it — while calibration is a fact about the
 * athlete. Folding them together would widen INV-10's signature to admit something that is not the
 * athlete, and the next thing through that door would be a personal best. So calibration runs first
 * and answers "how good is this athlete at this", and `startRun()` then applies what is different
 * about today on top of the answer.
 */
import { ArcadeRun, rulesFor } from './session.ts';
import {
  type ArcadeCalibration,
  type ArcadeConfig,
  type ArcadeGameDef,
  type ArcadeModifierId,
  type ArcadeRunRules,
} from './types.ts';

/**
 * One twist the daily challenge can apply. Every field is optional, and a game that understands
 * none of them still plays the modified run correctly — the framework applies all of these, so a
 * modifier never needs a game to opt in.
 */
export interface ArcadeModifier {
  readonly id: ArcadeModifierId;
  readonly name: string;
  /** One line, shown on the daily card. */
  readonly description: string;
  /** Multiplier on the calibrated timing window and reaction allowance. */
  readonly window?: number;
  /** Multiplier on marker speed. */
  readonly speed?: number;
  /** Added to the calibrated drift, then clamped to `0–1`. */
  readonly drift?: number;
  /** Multiplier on a clock-limited run's seconds. */
  readonly clock?: number;
  /** Absolute override of a lives-limited run's lives. */
  readonly lives?: number;
  /** Multiplier on every point scored. */
  readonly scoreMultiplier?: number;
}

/**
 * The vocabulary. Small on purpose: a daily challenge is meant to be legible in one line, and five
 * twists that each change one thing are more readable than twenty that each change three.
 */
export const ARCADE_MODIFIERS: readonly ArcadeModifier[] = [
  {
    id: 'hurry',
    name: 'Hurry up',
    description: 'A quarter less time on the clock.',
    clock: 0.75,
  },
  {
    id: 'pressure',
    name: 'Under pressure',
    description: 'A tighter window than your athlete has earned.',
    window: 0.75,
  },
  {
    id: 'jitters',
    name: 'Jitters',
    description: 'The meter wanders more than usual.',
    drift: 0.25,
  },
  {
    id: 'sudden-death',
    name: 'Sudden death',
    description: 'One life. That is the whole challenge.',
    lives: 1,
  },
  {
    id: 'double-or-nothing',
    name: 'Double or nothing',
    description: 'Every point counts double, and the window is tighter.',
    window: 0.85,
    scoreMultiplier: 2,
  },
] as const;

export const ARCADE_MODIFIERS_BY_ID: ReadonlyMap<ArcadeModifierId, ArcadeModifier> = new Map(
  ARCADE_MODIFIERS.map((modifier) => [modifier.id, modifier]),
);

/** Resolves ids to modifiers, silently dropping any this build does not know. */
export function resolveModifiers(ids: readonly ArcadeModifierId[]): readonly ArcadeModifier[] {
  const out: ArcadeModifier[] = [];
  for (const id of ids) {
    const modifier = ARCADE_MODIFIERS_BY_ID.get(id);
    // An unknown id comes from a challenge code made by a newer build. Dropping it is the honest
    // failure: the run is still playable, and the daily card shows what it actually applied.
    if (modifier !== undefined) out.push(modifier);
  }
  return out;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The calibrated window with today's twists on top. Order-independent: every effect is a product. */
export function applyModifiers(
  calibration: ArcadeCalibration,
  modifiers: readonly ArcadeModifier[],
): ArcadeCalibration {
  if (modifiers.length === 0) return calibration;

  let window = 1;
  let speed = 1;
  let drift = 0;
  for (const modifier of modifiers) {
    window *= modifier.window ?? 1;
    speed *= modifier.speed ?? 1;
    drift += modifier.drift ?? 0;
  }

  return {
    ...calibration,
    windowSeconds: calibration.windowSeconds * window,
    reactionSeconds: calibration.reactionSeconds * window,
    speed: calibration.speed * speed,
    drift: clamp01(calibration.drift + drift),
  };
}

/** The run rules with today's twists on top. A modifier never adds a limit a mode did not have. */
export function applyRuleModifiers(
  rules: ArcadeRunRules,
  modifiers: readonly ArcadeModifier[],
): ArcadeRunRules {
  let seconds = rules.seconds;
  let lives = rules.lives;

  for (const modifier of modifiers) {
    if (seconds !== null && modifier.clock !== undefined) {
      seconds = Math.max(1, Math.round(seconds * modifier.clock));
    }
    // Practice has no lives to take away, and "sudden death" must not quietly end an unlimited run.
    if (lives !== null && modifier.lives !== undefined) lives = Math.max(1, modifier.lives);
  }

  return { lives, seconds };
}

export function scoreMultiplierFor(modifiers: readonly ArcadeModifier[]): number {
  let multiplier = 1;
  for (const modifier of modifiers) multiplier *= modifier.scoreMultiplier ?? 1;
  return multiplier;
}

/**
 * Starts a run. Every arcade entry point — the hub, the daily card, a party round, and Phase 5's key
 * moments — goes through here, so a modifier applied in one place is applied in all of them.
 */
export function startRun(game: ArcadeGameDef, config: ArcadeConfig): ArcadeRun {
  const modifiers = resolveModifiers(config.modifiers ?? []);
  if (modifiers.length === 0) return new ArcadeRun(game, config);

  const rules = applyRuleModifiers(rulesFor(game, config), modifiers);
  const calibration = applyModifiers(game.calibrate(config.athlete, config.difficulty), modifiers);

  return new ArcadeRun(
    game,
    { ...config, rules },
    { calibration, scoreMultiplier: scoreMultiplierFor(modifiers) },
  );
}

/** What the mode selector says about each choice (`09` §3.3). */
export const ARCADE_MODE_BLURBS = {
  practice: 'Unlimited, unscored, no pressure. Try any athlete.',
  scored: 'One run. Lives or a clock, a score, and up to three stars.',
  daily: "Today's challenge — the same run for everybody, everywhere.",
} as const;
