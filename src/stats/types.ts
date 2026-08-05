/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.5 — Stats store: match history, box scores, career stats per sport per mode
 * @story   US-10.4 — See my history and stats
 * @design  05-data-model.md §1 (the `matches` store), 09-modes-and-arcade.md §7
 * @invariant INV-9 (one event stream; the mode is data, never a branch), INV-3 (keys via
 *            `storage/scope.ts`)
 *
 * Purpose: what a played match leaves behind.
 *
 * **The mode is a field, not a fork.** `09` §7 and INV-9 both say every mode emits the same
 * `SportEvent` stream, and the payoff is here: one function builds a record from that stream and
 * neither it nor anything downstream asks which mode produced it. `mode` is stored so history can
 * *say* how a match was played and so a career line can be filtered — never so that stats are
 * computed differently. A `if (mode === 'playbook')` anywhere in this directory is a bug.
 *
 * **Lines are keyed by athlete id, not by entity.** An entity id is meaningful for the length of one
 * match; an athlete id is the thing a career is about. A match played by anonymous athletes — a
 * rosterless harness run, the Phase-1 fixture — records its box score with no athlete ids at all
 * rather than inventing them, and simply contributes nothing to anybody's career.
 */
import type { SportId } from '../sports/types.ts';
import type { Difficulty } from '../modes/difficulty.ts';
import type { Side } from '../engine/match/events.ts';

export const MATCH_RECORD_VERSION = 1;

/** How a match was played. Data about the record, never a branch inside it. */
export const STAT_MODES = ['live', 'playbook'] as const;
export type StatMode = (typeof STAT_MODES)[number];

/** One athlete's line in one match. The same fields both modes' events produce. */
export interface StatLine {
  /** The athlete who played it, or `null` for an anonymous entity. */
  readonly athleteId: string | null;
  readonly side: Side;
  readonly points: number;
  readonly fieldGoalsMade: number;
  readonly fieldGoalsAttempted: number;
  readonly threesMade: number;
  readonly threesAttempted: number;
  readonly freeThrowsMade: number;
  readonly freeThrowsAttempted: number;
  readonly rebounds: number;
  readonly offensiveRebounds: number;
  readonly assists: number;
  readonly steals: number;
  readonly blocks: number;
  readonly turnovers: number;
  readonly fouls: number;
}

export interface MatchRecord {
  readonly id: string;
  readonly schemaVersion: number;
  /** Indexed. Milliseconds since the epoch, so history sorts without parsing anything. */
  readonly playedAt: number;
  /** Indexed. */
  readonly sportId: SportId;
  readonly mode: StatMode;
  readonly difficulty: Difficulty;
  readonly score: readonly [number, number];
  /** Which side the player was, or `-1` for a match nobody played. */
  readonly playerSide: Side;
  /** Team names as they were at the time. Stored, not referenced: a team can be renamed or deleted. */
  readonly teamNames: readonly [string, string];
  readonly periodsPlayed: number;
  readonly lines: readonly StatLine[];
}

/** What a match was, from the player's point of view. `null` when they were not in it. */
export type MatchResultKind = 'win' | 'loss' | 'draw' | null;

export function resultOf(record: MatchRecord): MatchResultKind {
  if (record.playerSide !== 0 && record.playerSide !== 1) return null;
  const mine = record.score[record.playerSide];
  const theirs = record.score[record.playerSide === 0 ? 1 : 0];
  if (mine === theirs) return 'draw';
  return mine > theirs ? 'win' : 'loss';
}

/**
 * An athlete's totals in one sport.
 *
 * Per sport because `05` §3 makes ratings per sport, so a career total that mixed them would be
 * answering a question nobody asks. `byMode` is kept alongside rather than instead of the total:
 * "how do I do in Playbook" is a real question, and it is a *filter* on one set of numbers rather
 * than a second set computed differently.
 */
export interface CareerLine {
  readonly athleteId: string;
  readonly sportId: SportId;
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly totals: StatTotals;
  readonly byMode: Readonly<Record<StatMode, StatTotals>>;
}

export type StatTotals = Omit<StatLine, 'athleteId' | 'side'>;

export const EMPTY_TOTALS: StatTotals = {
  points: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  threesMade: 0,
  threesAttempted: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  rebounds: 0,
  offensiveRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  fouls: 0,
};
