/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.7 — Difficulty model across all three modes
 * @story   US-7.2 — Choose a difficulty
 * @design  06-game-design.md §7 (reaction latency, execution error, aggression)
 * @invariant INV-1 (difficulty never modifies an attribute or a derived rating), INV-2, INV-8
 *
 * Purpose: the three ways a difficulty level is allowed to reach the simulation — how long the CPU
 * takes to react, how accurately it executes what it decided, and how hard it competes. All three
 * are applied *after* a rating has done its work, never to the rating, which is what makes INV-1
 * structural rather than a promise: there is no function here that takes a rating.
 *
 * Sports call these; the engine does not know what a pass is.
 */
import type { Rng } from '../rng.ts';

/**
 * The chance, per simulation step, that a CPU athlete acts on something it has decided — so that
 * the average wait is the level's reaction time.
 *
 * Modelled as memoryless decay rather than a countdown because a countdown makes every athlete on
 * the team react at exactly the same moment after a turnover, which reads as a hive mind. The mean
 * delay is `latencyMs`; the spread around it is what makes five defenders look like five people.
 *
 * @spec-ref 06-game-design.md §7 — Rookie 420 ms → Legend 90 ms
 */
export function reactionChance(latencyMs: number, dtMs: number): number {
  if (dtMs <= 0) return 0;
  if (latencyMs <= 0) return 1;
  return 1 - Math.exp(-dtMs / latencyMs);
}

/** Rolls `reactionChance()`. Sports call this once per step per athlete waiting to act. */
export function reacted(rng: Rng, latencyMs: number, dtMs: number): boolean {
  return rng.next() < reactionChance(latencyMs, dtMs);
}

/**
 * Angular error on an executed action, in radians. `error` is the level's `executionError` (`0–1`);
 * `spread` is the sport's own worst-case deviation, so a basketball pass and a soccer shot can be
 * wrong by different amounts at the same difficulty.
 *
 * Gaussian, so most attempts are nearly right and the occasional one is badly wrong — a uniform
 * error makes the CPU miss by the same amount every time, which reads as a mechanic rather than a
 * mistake. Clamped at three sigma so a single tail draw cannot pass the ball backwards.
 */
export function aimError(rng: Rng, error: number, spread: number): number {
  if (error <= 0 || spread <= 0) return 0;
  const sigma = error * spread;
  const draw = rng.gaussian() * sigma;
  const limit = 3 * sigma;
  return draw < -limit ? -limit : draw > limit ? limit : draw;
}

/** Scalar error on a magnitude — a pass hit too hard, a shot released short. Multiplicative. */
export function powerError(rng: Rng, error: number, spread: number): number {
  return 1 + aimError(rng, error, spread);
}

/**
 * Scales a per-step chance to compete for the ball by the level's aggression. `06` §7's row is
 * passive → relentless, and this is the whole of it: a relentless defender lunges more often, not
 * more successfully. Whether the challenge is *won* stays a matter of ratings (INV-1).
 */
export function contestChance(base: number, aggression: number): number {
  const scaled = base * (0.4 + 1.2 * aggression);
  return scaled < 0 ? 0 : scaled > 1 ? 1 : scaled;
}
