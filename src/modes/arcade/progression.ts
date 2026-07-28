/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.10 — Arcade → progression: XP, familiarity, `SportEvent` emission at reduced rate
 * @story   US-16.5 — Have practice count
 * @design  09-modes-and-arcade.md §3.4 (why arcade also serves the roster), §7 (balance across
 *          modes), 05-data-model.md §3.3 (familiarity growth, XP)
 * @invariant INV-6 (no mode-specific branching in progression), INV-12 (reward rate per minute is
 *            comparable across modes)
 *
 * Purpose: a finished arcade run becomes the same thing a match becomes — minutes and an event
 * stream — and goes through the same door.
 *
 * **The reduced rate is a number, not a branch.** `applyMatch` takes a `rate` scalar precisely so
 * that arcade can pay less without progression ever learning that arcade exists (`CLAUDE.md` §8.5,
 * INV-6). If this module disappeared, nothing in `athletes/` would need to change.
 *
 * **Why 0.8, and why it is not lower.** A run is already about a twentieth of a match in wall time,
 * so the rate multiplies something small: a rate low enough to make practising take five hundred
 * runs would satisfy `09` §7's "least per minute" and quietly break §3.4's promise that practice
 * genuinely helps. And INV-12 puts a floor under it — reward rate per minute must stay within ±25%
 * across modes, so anything below 0.75 fails the invariant outright. 0.8 is the honest reading of
 * both: arcade pays least per minute, by a margin a player would notice and the invariant allows,
 * and what actually stops grinding is T-4.13's daily cap rather than a crushed rate.
 *
 * **Practice pays nothing at all** (`09` §3.3), and that is checked here rather than trusted to the
 * caller, because "unlimited and unrewarded" is the sentence that makes unlimited safe.
 */
import { applyMatch, type ProgressionResult } from '../../athletes/progression.ts';
import type { Athlete } from '../../athletes/types.ts';
import type { SportId, XpAwardTable } from '../../sports/types.ts';
import type { ArcadeResult } from './types.ts';

/**
 * Arcade's share of a match's learning, per minute played.
 *
 * @spec-ref 09-modes-and-arcade.md §3.4 ("at a reduced rate versus a real match"), §7 ("Arcade
 * least per minute and capped daily").
 */
export const ARCADE_LEARNING_RATE = 0.8;

/** The entity arcade events are attributed to. Matches the sport modules' `ARCADE_ACTOR`. */
export const ARCADE_ENTITY = 0;

export interface ArcadeProgressionOptions {
  readonly result: ArcadeResult;
  readonly athlete: Athlete;
  readonly awards: XpAwardTable;
  /** Overrides the rate. The balance harness sweeps it; nothing in the app passes it. */
  readonly rate?: number;
}

/**
 * What a finished run did to the athlete who played it, or `null` when it did nothing — a practice
 * run, or a run by an athlete other than the one handed in.
 */
export function arcadeProgression(options: ArcadeProgressionOptions): ProgressionResult | null {
  const { result, athlete } = options;
  if (!result.rewarded) return null;
  if (result.athleteId !== athlete.id) return null;

  const minutes = result.seconds / 60;
  const results = applyMatch({
    sport: result.sport as SportId,
    events: result.events,
    awards: options.awards,
    entities: new Map([[ARCADE_ENTITY, athlete]]),
    minutes: new Map([[ARCADE_ENTITY, minutes]]),
    rate: options.rate ?? ARCADE_LEARNING_RATE,
  });

  return results.get(ARCADE_ENTITY) ?? null;
}

/** The one line the run-over screen shows about learning (US-16.5). */
export function progressionSummary(progress: ProgressionResult | null): string {
  if (progress === null) return 'Practice runs are not scored or rewarded.';

  const { familiarity, skill } = progress.report;
  const parts: string[] = [`+${Math.round(skill.xpGained)} XP`];

  // A minute of arcade is a fraction of a familiarity point, so it is shown to one decimal rather
  // than rounded to "+0" — the honest small number beats a number that reads as nothing happening.
  if (familiarity.gained > 0) {
    const shown =
      familiarity.gained < 1 ? familiarity.gained.toFixed(1) : Math.round(familiarity.gained);
    parts.push(`+${shown} familiarity`);
  } else if (familiarity.atCap) {
    parts.push('familiarity at its cap');
  }

  if (skill.levelsGained > 0) parts.push(`level ${skill.levelAfter}`);
  return parts.join(' · ');
}
