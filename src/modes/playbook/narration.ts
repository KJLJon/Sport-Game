/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.21 — Soccer Playbook: narration and animated pitch diagram for turn outcomes
 * @task    T-5.3 — Narration + animated court-diagram renderer for turn outcomes
 * @story   US-15.3 — See what happened, not read about it
 * @design  09-modes-and-arcade.md §2.1 (a one-line narration, not a wall of text)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-5 (nothing sport-specific here)
 *
 * Purpose: the two things every sport's narration needs and neither should re-implement — how a
 * line is chosen from several, and how an athlete is named in one.
 *
 * **Why this is shared and the lines are not.** The lines are the sport: "buries it from deep" is
 * basketball and nothing else. Picking one of them is not — it is a stability property, and a
 * property implemented twice is a property that will eventually hold in one place and not the other.
 * T-5.3 wrote both of these for basketball; T-6.21 needed exactly the same two functions for soccer,
 * which is the second caller that turns a helper into a module.
 *
 * **Variety is seeded, not random.** A line is chosen by a hash of the turn number and a key, so a
 * replay of a match says the same things in the same order, and narration consumes nothing from the
 * match's own generator — it cannot shift a resolution by existing (INV-2, INV-8).
 */
import type { PlaybookAthlete } from './types.ts';

/** What a line falls back to when a sport has no template for an outcome. */
const NOBODY = 'the ball-carrier';

/**
 * Family name where there is one, so a line reads like commentary rather than like a database.
 */
export function shortName(athlete: PlaybookAthlete | undefined, fallback = NOBODY): string {
  if (athlete === undefined) return fallback;
  const parts = athlete.athlete.displayName.trim().split(/\s+/);
  return parts.length > 1 ? (parts.at(-1) as string) : (parts[0] ?? fallback);
}

/**
 * Stable pick: the same turn always reads the same way.
 *
 * A hash rather than a draw — `key` is whatever else distinguishes this turn from the one before
 * it (the outcome, usually, plus the phase where a sport has one), and the FNV-ish mix below is
 * chosen only for spreading short strings across a handful of buckets.
 */
export function pickLine(options: readonly string[], turn: number, key: string): string {
  if (options.length === 0) return '';
  let hash = turn * 2654435761;
  for (let i = 0; i < key.length; i += 1) hash = (hash ^ key.charCodeAt(i)) * 16777619;
  return options[Math.abs(hash) % options.length] as string;
}

/** Fills `{a}`, `{d}`, and any extra placeholders a sport defines, all occurrences of each. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  let text = template;
  for (const [token, value] of Object.entries(values)) {
    text = text.split(`{${token}}`).join(value);
  }
  return text;
}
