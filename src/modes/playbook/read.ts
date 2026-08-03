/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.6 — Playbook AI depth for both sports: tendency modelling, counter-calling
 * @story   US-15.7 — Face a Playbook CPU that reads you
 * @design  06-game-design.md §7 (the "exploits mismatches" row), 09-modes.md §7
 * @invariant INV-1 (difficulty never touches a rating), INV-5 (no sport-specific branching)
 *
 * Purpose: the two halves of "reads you" that both sports need and neither should own — how hard a
 * level counter-calls what it has seen, and how hard it works at not being read itself.
 *
 * **Counter-calling was a constant, and `06` §7 says it is a level.** Both sports already modelled
 * the opponent's tendencies and adjusted their scores by a fixed `READ_WEIGHT`, so a Rookie CPU
 * punished a repeated call exactly as ruthlessly as a Legend one. The table has a row for this —
 * *exploits mismatches and low familiarity: no · rarely · often · consistently* — and `exploits`
 * had no reader anywhere in the project until now.
 *
 * **Not being read is the other half, and it is the one the ladder found.** T-7.10 measured Playbook
 * soccer's Legend as no better than its All-Star, and the reason is that the only difficulty channel
 * in Playbook was the sampling temperature: at `decisionNoise: 0.04` the CPU takes the top-scored
 * call nearly every turn. Against an opponent that reads tendencies — which is exactly what the
 * *other* half of this file builds — playing the argmax every turn is the most exploitable thing a
 * CPU can do. So a level that reads well also varies well: `repeatPenalty()` discounts a call the
 * CPU has been leaning on itself, by the same measure it uses against the opponent.
 *
 * The symmetry is the point. A CPU that punishes your patterns and has none of its own is what
 * "reads you" should mean, and it is the only way minimal decision noise makes a *better* opponent
 * rather than a more predictable one.
 */
import { difficultyProfile, type Difficulty } from '../difficulty.ts';

/**
 * How hard this level counter-calls, `0–1`. Straight off `06` §7's exploits row: Rookie never reads
 * you, Legend always does.
 */
export function readStrength(level: Difficulty): number {
  return difficultyProfile(level).exploits;
}

/**
 * How hard this level works at not being read, `0–1`.
 *
 * The same row, because they are the same skill: an opponent who knows patterns can be punished
 * knows that its own can be too. Deliberately *not* keyed to `decisionNoise` — noise is being bad
 * at choosing, and this is being good at choosing *differently*, which is the distinction that was
 * missing when Legend was the most predictable level in the game.
 */
export function varietyStrength(level: Difficulty): number {
  return difficultyProfile(level).exploits;
}

/** One call the CPU has made, as `repeatPenalty()` needs to see it. */
export interface OwnCall {
  readonly call: string;
}

/**
 * How much to discount a call because the CPU keeps making it.
 *
 * Zero for a call it has not leaned on, rising with the share of its recent calls that were this
 * one. Subtracted from the call's score before sampling, in the same units the sport scores in, so
 * a sport passes its own `weight` — a tenth of a point per possession means something different in
 * basketball and soccer.
 *
 * **Share, not count**, so a short match and a long one behave the same. And it is a *discount*
 * rather than a ban: a genuinely dominant call should still get called, just not every turn.
 */
export function repeatPenalty(
  own: readonly OwnCall[],
  call: string,
  weight: number,
  variety: number,
  /**
   * How many calls were available to choose from. The baseline is an even spread across *these*,
   * not across the ones actually played — measuring against what the CPU did is circular, and a CPU
   * that has called one thing ten times would come out perfectly balanced.
   */
  options: number,
): number {
  if (own.length === 0 || weight <= 0 || variety <= 0 || options <= 1) return 0;

  let times = 0;
  for (const entry of own) if (entry.call === call) times += 1;
  if (times === 0) return 0;

  // Nothing is owed for calling something its fair share of the time; what is penalised is the
  // excess, so a CPU spreading evenly across the sheet pays nothing on any of it.
  const excess = times / own.length - 1 / options;
  return excess <= 0 ? 0 : excess * weight * variety;
}

/**
 * Scales a sport's read adjustment by the level. `06` §7's row applied at the one place it belongs:
 * *after* the sport has worked out what the read is worth, so no sport has to know what a level is.
 */
export function scaleRead(adjustment: number, level: Difficulty): number {
  return adjustment * readStrength(level);
}
