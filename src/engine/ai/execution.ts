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
  // Balanced aggression (Pro's 0.55) is exactly 1×, so a sport's tuned base rate keeps meaning what
  // its balance pass measured and the four levels spread around it rather than away from it.
  const scaled = base * (0.45 + aggression);
  return scaled < 0 ? 0 : scaled > 1 ? 1 : scaled;
}

/**
 * Whether a CPU defender goes in for *this* challenge — aggression, and then judgement.
 *
 * `contestChance()` on its own answers "how willing is this level to commit", and for four phases
 * of this project that was the only question asked. It produced a difficulty model that punished
 * the levels that tried hardest: `relentless` lunged from the edge of its reach as often as it
 * lunged when it was on the ball, so Legend conceded 53.6 fouls a match against Pro's 47.5 and lost
 * the ladder to a level it outclasses in every other channel (T-7.11).
 *
 * The missing half is that a good defender declines a challenge it is going to mistime. `quality`
 * is how well placed this particular one is, `0–1` — the sport's own measure, `tackleTiming()` in
 * soccer and closeness-to-reach in basketball — and `judgement` is how reliably this level can tell
 * a good one from a bad one, which is `1 - decisionNoise`. A level that reads the situation well
 * therefore commits *less often overall* and *better every time*, which is what being a harder
 * opponent should mean.
 *
 * Nothing here touches a rating: whether the challenge is won remains `resolveTackle`'s and
 * `resolveSteal`'s business, decided by the two athletes (INV-1).
 *
 * @spec-ref 06-game-design.md §7 — defensive aggression / pressing, and decision noise
 */
export function commitChance(
  base: number,
  aggression: number,
  quality: number,
  judgement: number,
): number {
  const willing = contestChance(base, aggression);
  const seen = judgement < 0 ? 0 : judgement > 1 ? 1 : judgement;
  const placed = quality < 0 ? 0 : quality > 1 ? 1 : quality;

  // **Mean-preserving, and that is the whole design.** The obvious version of this — scale the
  // willingness down by how badly placed the challenge is — makes judgement a second aggression
  // dial: every level commits *less*, defending gets weaker across the board, and a balance pass
  // tuned against the old rate is invalidated. (Measured: soccer went from 3.25 goals a match to
  // 4.85 and broke its cross-mode ratio.) So the gate is normalised at a neutral challenge: a level
  // commits exactly as often *on average* as `aggression` alone said it would, and judgement only
  // decides *which* ones — up on the good ones, down on the hopeless. Aggression stays the one
  // channel that changes how much a level competes, which is what `06` §7 says it is.
  const gate = (1 - seen * (1 - placed)) / (1 - seen * (1 - NEUTRAL_QUALITY));
  const chance = willing * gate;
  return chance < 0 ? 0 : chance > 1 ? 1 : chance;
}

/**
 * The challenge a level is neither eager for nor shy of — the one the gate is normalised at.
 *
 * Half, because a sport's `quality` is a distance across the reach it already refused to act
 * outside of, so the challenges actually offered are spread either side of the middle of it.
 */
const NEUTRAL_QUALITY = 0.5;
