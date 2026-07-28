/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.2 — Calibration: ratings + familiarity → window sizes and speeds (INV-10)
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  06-game-design.md §7 (the four levels), 09-modes-and-arcade.md §7 (one ladder)
 * @invariant INV-1 (difficulty never modifies an attribute or a derived rating)
 *
 * Purpose: the four difficulty levels as data, and the one place their numbers live. Arcade is the
 * first mode that needs them, so they land here rather than being invented twice.
 *
 * **Why these fields and no others.** Every row of `06` §7 is something difficulty is *allowed* to
 * change: how well the CPU decides, how hard it presses, and how much help the player gets. There is
 * deliberately no field a rating could be multiplied by — INV-1 is enforced by the shape of this
 * record before any test looks at it. Arcade reads exactly one field, `timingWindow`, and reads it
 * *after* the athlete's own window has been computed (T-4.2), so difficulty scales the challenge
 * without ever touching who the athlete is.
 *
 * T-7.7 owns the full model across all three modes and will extend this record with the CPU-side
 * knobs it needs; the values here are `06` §7's table read straight across, and T-7.11 tunes them.
 */

export const DIFFICULTIES = ['rookie', 'pro', 'allStar', 'legend'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export interface DifficultyProfile {
  readonly id: Difficulty;
  readonly label: string;
  /** How long the CPU takes to react to what it sees, in milliseconds. */
  readonly cpuLatencyMs: number;
  /** Jitter added to option scores, `0–1`. High noise is how Rookie makes readable mistakes. */
  readonly decisionNoise: number;
  /** Deviation applied to CPU passes and shots, `0–1`. */
  readonly executionError: number;
  /** Pressing and defensive intensity, `0–1`. */
  readonly aggression: number;
  /** Strength of the player's aim/pass assist, `0–1`. Legend ships with it off. */
  readonly assist: number;
  /**
   * Multiplier on the *player's* timing windows — `06` §7's "your shot-timing window" row, and the
   * only field arcade reads. Above 1 is generous.
   */
  readonly timingWindow: number;
  /** Coin and XP multiplier. */
  readonly rewardMultiplier: number;
}

/**
 * `06` §7's table, one row per level. The word-valued rows ("high", "passive", "generous") become
 * numbers here once, so no call site has to decide what "moderate" means.
 *
 * @spec-ref 06-game-design.md §7 — All-Star and Legend share the same "tight" window; they differ
 * in assistance, not in forgiveness, which is why `timingWindow` is equal across the two.
 */
export const DIFFICULTY_PROFILES: Readonly<Record<Difficulty, DifficultyProfile>> = {
  rookie: {
    id: 'rookie',
    label: 'Rookie',
    cpuLatencyMs: 420,
    decisionNoise: 0.35,
    executionError: 0.35,
    aggression: 0.35,
    assist: 1,
    timingWindow: 1.35,
    rewardMultiplier: 0.75,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    cpuLatencyMs: 280,
    decisionNoise: 0.2,
    executionError: 0.2,
    aggression: 0.55,
    assist: 0.65,
    timingWindow: 1,
    rewardMultiplier: 1,
  },
  allStar: {
    id: 'allStar',
    label: 'All-Star',
    cpuLatencyMs: 170,
    decisionNoise: 0.1,
    executionError: 0.1,
    aggression: 0.8,
    assist: 0.3,
    timingWindow: 0.8,
    rewardMultiplier: 1.4,
  },
  legend: {
    id: 'legend',
    label: 'Legend',
    cpuLatencyMs: 90,
    decisionNoise: 0.04,
    executionError: 0.05,
    aggression: 1,
    assist: 0,
    timingWindow: 0.8,
    rewardMultiplier: 2,
  },
};

export const DEFAULT_DIFFICULTY: Difficulty = 'pro';

export function isDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value);
}

/** The profile for a level, falling back to Pro for anything unrecognised out of storage. */
export function difficultyProfile(difficulty: Difficulty | string): DifficultyProfile {
  return isDifficulty(difficulty)
    ? DIFFICULTY_PROFILES[difficulty]
    : DIFFICULTY_PROFILES[DEFAULT_DIFFICULTY];
}
