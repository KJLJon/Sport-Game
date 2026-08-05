/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.4 — Match checkpointing and resume-after-kill, all three modes
 * @story   US-10.3 — Resume an interrupted match
 * @design  05-data-model.md §1 (stores), 10-ui-ux.md §8.2 (home), §10 (states),
 *          11-pwa-lifecycle.md §4 (a match is not interrupted by an update)
 * @invariant INV-3 (every key goes through `storage/scope.ts`), INV-9 (no mode-specific branching
 *            in what a checkpoint *is* — the shape is one shape)
 *
 * Purpose: remembers that a match was in progress, and enough about it to put the player back.
 *
 * ## What a checkpoint honestly contains, and what it does not
 *
 * **It is not a snapshot of the simulation.** It cannot be, without a change this task is not the
 * place to make: `SportState` is opaque to the engine by design (INV-5) — the whole point of the
 * seam is that the engine never looks inside it — so serialising a live match would mean every
 * sport growing a `serialize`/`restore` pair, and every future sport owing one before it could be
 * played. That is a seam decision, not a checkpointing detail.
 *
 * So a checkpoint stores the **public state of the match**: the setup that started it, the score,
 * the period, and how far into that period the clock had run. Resuming replays that setup and puts
 * the clock and the scoreboard back where they were.
 *
 * **What survives:** which sport, which mode, your team, the opponent, the difficulty, the length,
 * the rules, the score, the period, the clock.
 *
 * **What does not:** where everybody was standing, who had the ball, the box score, team fouls,
 * stamina. Those come back reset.
 *
 * That is a real limit and the UI says so in words rather than implying a perfect restore — "back
 * at 42–38, 3rd quarter" promises exactly what it delivers. It is also, for the case this exists
 * for, most of what a player wanted: a phone that died with two minutes left in a close game gives
 * back a close game with two minutes left.
 *
 * ## Why one record rather than a store
 *
 * There is exactly one interrupted match at a time — starting a second replaces the first — so this
 * is a single key in `progress`, a key-value store that already exists. A new store would mean a
 * schema bump and a migration for a value that is never queried, only fetched whole.
 */
import type { Database } from '../storage/idb.ts';
import type { SportId } from '../sports/types.ts';

/** The key this record lives under in `progress`. */
export const CHECKPOINT_KEY = 'match.checkpoint';

/**
 * Bumped when the shape changes. A checkpoint from an older build is **discarded rather than
 * migrated**: it describes a match that is at most one session old, and a wrong resume is worse
 * than no resume. This is the one kind of persisted data where dropping it is the right answer.
 */
export const CHECKPOINT_VERSION = 1;

export const CHECKPOINT_MODES = ['live', 'playbook', 'arcade'] as const;
export type CheckpointMode = (typeof CHECKPOINT_MODES)[number];

export interface MatchCheckpoint {
  readonly schemaVersion: number;
  readonly mode: CheckpointMode;
  readonly sport: SportId;
  /**
   * The hash that re-opens this match, setup and all.
   *
   * Resuming is *navigation*, which is what makes this work across all three modes without the
   * checkpoint knowing how any of them start a match. It is also why T-8.2's "a setup is a link"
   * mattered: without it there would be nothing to write here.
   */
  readonly href: string;
  /** "Basketball · Live". Shown as the resume card's title. */
  readonly label: string;
  /** "42–38, Quarter 3". What the player is being offered, in the numbers they remember. */
  readonly detail: string;
  readonly savedAt: number;
  /**
   * Where to put the clock and the scoreboard back. Absent for a mode that has no such thing to
   * restore — an arcade run is scored, not clocked, and resumes at its own start.
   */
  readonly resume?: MatchResumeState;
}

export interface MatchResumeState {
  readonly score: readonly [number, number];
  /** 1-based, and it keeps counting through overtime, exactly as the match clock reports it. */
  readonly period: number;
  /** Steps already run in that period. */
  readonly periodStep: number;
}

/**
 * Writes the checkpoint, replacing whatever was there.
 *
 * Failures are swallowed on purpose. This is called from a running match — on a timer and on the
 * way to the background — and a full or denied database must never be allowed to interrupt play.
 * The cost of failing silently is a resume that is not offered; the cost of throwing is a match
 * that stops.
 */
export async function saveCheckpoint(db: Database, checkpoint: MatchCheckpoint): Promise<void> {
  try {
    await db.put('progress', checkpoint, CHECKPOINT_KEY);
  } catch {
    // A match in progress outranks a record of one.
  }
}

/** The interrupted match, or `null` — including when the stored one is from an older build. */
export async function readCheckpoint(db: Database): Promise<MatchCheckpoint | null> {
  let stored: unknown;
  try {
    stored = await db.get<MatchCheckpoint>('progress', CHECKPOINT_KEY);
  } catch {
    return null;
  }
  return isCurrentCheckpoint(stored) ? stored : null;
}

export async function clearCheckpoint(db: Database): Promise<void> {
  try {
    await db.delete('progress', CHECKPOINT_KEY);
  } catch {
    // Nothing to do: an un-cleared checkpoint offers a resume for a match that is over, and the
    // resume screen tolerates that by starting it again rather than by breaking.
  }
}

/**
 * Whether a stored value is a checkpoint this build understands.
 *
 * Deliberately strict about every field it will later read. A checkpoint is the one record written
 * by a previous *version* of the app and read by this one with no migration in between, so it is
 * the one place where trusting the shape would actually bite.
 */
export function isCurrentCheckpoint(value: unknown): value is MatchCheckpoint {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<MatchCheckpoint>;
  return (
    record.schemaVersion === CHECKPOINT_VERSION &&
    typeof record.href === 'string' &&
    typeof record.label === 'string' &&
    typeof record.detail === 'string' &&
    typeof record.sport === 'string' &&
    typeof record.savedAt === 'number' &&
    CHECKPOINT_MODES.includes(record.mode as CheckpointMode)
  );
}

/**
 * Resume state as a query parameter: `42-38:3:1200`.
 *
 * Compact and readable rather than JSON, because it goes in a URL a person might look at. The
 * separators cannot appear in any of the three numbers, so parsing it back is unambiguous.
 */
export function formatResume(resume: MatchResumeState): string {
  return `${resume.score[0]}-${resume.score[1]}:${resume.period}:${resume.periodStep}`;
}

/** Reads it back, or `undefined` for anything malformed. A bad link starts a fresh match. */
export function parseResume(value: string | undefined): MatchResumeState | undefined {
  if (value === undefined) return undefined;

  const match = /^(\d+)-(\d+):(\d+):(\d+)$/.exec(value);
  if (match === null) return undefined;

  return {
    score: [Number(match[1]), Number(match[2])],
    period: Number(match[3]),
    periodStep: Number(match[4]),
  };
}

/**
 * The link that resumes a checkpoint: its own href, with the resume state appended.
 *
 * Built here rather than stored, so a checkpoint's `href` stays the plain match link and the two
 * cannot drift apart.
 */
export function resumeHref(checkpoint: MatchCheckpoint): string {
  if (checkpoint.resume === undefined) return checkpoint.href;
  const separator = checkpoint.href.includes('?') ? '&' : '?';
  return `${checkpoint.href}${separator}resume=${formatResume(checkpoint.resume)}`;
}

/**
 * How a resumable match reads on the home screen.
 *
 * Score first because it is what the player remembers, and the period after it because it is what
 * tells them how much is left. Ordered home–away to match the scoreboard they were looking at.
 */
export function describeMatch(
  score: readonly [number, number],
  periodName: string,
  period: number,
): string {
  return `${score[0]}–${score[1]}, ${periodName} ${period}`;
}
