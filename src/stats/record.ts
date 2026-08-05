/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.5 — Stats store: match history, box scores, career stats per sport per mode
 * @story   US-10.4 — See my history and stats
 * @design  09-modes-and-arcade.md §7 (the same numbers in every mode), 05-data-model.md §1
 * @invariant INV-9 (one event stream, no mode branch), INV-8 (a record is a function of its events)
 *
 * Purpose: turns a finished match into the record that outlives it, and aggregates records into
 * careers.
 *
 * **One builder for both modes, and that is the whole point.** Live steps a simulation and Playbook
 * resolves turns, and both push the same `SportEvent`s onto the same bus, so both arrive here as an
 * array of events and a final score. `buildRecord` never asks which mode it is looking at — the
 * `mode` it stores comes from its caller and is used only to label the record. That is INV-9 being
 * worth something rather than being a rule nobody could point at.
 */
import { applyEvent, createBoxScore, type BoxScore } from '../modes/live/box-score.ts';
import type { SportEvent, Side } from '../engine/match/events.ts';
import type { EntityId } from '../engine/world.ts';
import type { SportId } from '../sports/types.ts';
import type { Difficulty } from '../modes/difficulty.ts';
import {
  EMPTY_TOTALS,
  MATCH_RECORD_VERSION,
  STAT_MODES,
  resultOf,
  type CareerLine,
  type MatchRecord,
  type StatLine,
  type StatMode,
  type StatTotals,
} from './types.ts';

export interface BuildRecordOptions {
  readonly id: string;
  readonly playedAt: number;
  readonly sportId: SportId;
  readonly mode: StatMode;
  readonly difficulty: Difficulty;
  readonly score: readonly [number, number];
  readonly playerSide: Side;
  readonly teamNames: readonly [string, string];
  readonly periodsPlayed: number;
  /** The match's own event history — the same array in both modes. */
  readonly events: readonly SportEvent[];
  /** Entity → athlete id, from `SportModule.lineup`. Absent for an anonymous match. */
  readonly lineup?: ReadonlyMap<EntityId, string>;
  /**
   * A box score already accumulated by the match, if it has one.
   *
   * Live keeps one live for the HUD, so re-deriving it here would do the work twice and — worse —
   * risk two answers. Playbook has none, so its record is built from the events. Passing it in when
   * it exists is not a mode branch: it is a caller handing over work it already did.
   */
  readonly box?: BoxScore;
}

export function buildRecord(options: BuildRecordOptions): MatchRecord {
  const box = options.box ?? boxFromEvents(options.events);

  const lines: StatLine[] = [];
  for (const [entity, line] of box.lines) {
    lines.push({
      athleteId: options.lineup?.get(entity) ?? null,
      side: line.side,
      points: line.points,
      fieldGoalsMade: line.fieldGoalsMade,
      fieldGoalsAttempted: line.fieldGoalsAttempted,
      threesMade: line.threesMade,
      threesAttempted: line.threesAttempted,
      freeThrowsMade: line.freeThrowsMade,
      freeThrowsAttempted: line.freeThrowsAttempted,
      rebounds: line.rebounds,
      offensiveRebounds: line.offensiveRebounds,
      assists: line.assists,
      steals: line.steals,
      blocks: line.blocks,
      turnovers: line.turnovers,
      fouls: line.fouls,
    });
  }

  return {
    id: options.id,
    schemaVersion: MATCH_RECORD_VERSION,
    playedAt: options.playedAt,
    sportId: options.sportId,
    mode: options.mode,
    difficulty: options.difficulty,
    score: [options.score[0], options.score[1]],
    playerSide: options.playerSide,
    teamNames: [options.teamNames[0], options.teamNames[1]],
    periodsPlayed: options.periodsPlayed,
    lines,
  };
}

/** A box score built from an event history, for a mode that did not keep one as it went. */
export function boxFromEvents(events: readonly SportEvent[]): BoxScore {
  const box = createBoxScore();
  for (const event of events) applyEvent(box, event);
  return box;
}

/**
 * Career lines, one per athlete per sport, from every match they appear in.
 *
 * Anonymous lines are skipped rather than pooled under a placeholder id: a match played by rolled
 * athletes belongs to nobody, and inventing an "unknown athlete" whose career grew every harness run
 * would make the whole screen untrustworthy.
 */
export function buildCareers(records: readonly MatchRecord[]): CareerLine[] {
  const byKey = new Map<string, Mutable>();

  for (const record of records) {
    const result = resultOf(record);

    for (const line of record.lines) {
      if (line.athleteId === null) continue;

      const key = `${line.athleteId}:${record.sportId}`;
      const career = byKey.get(key) ?? blank(line.athleteId, record.sportId);
      byKey.set(key, career);

      career.matches += 1;
      // Only counted for the side the player was on: a CPU athlete's line is real, and calling a
      // match it happened to be in "a win for them" would be recording the player's result twice.
      if (result !== null && line.side === record.playerSide) {
        if (result === 'win') career.wins += 1;
        else if (result === 'loss') career.losses += 1;
        else career.draws += 1;
      }

      add(career.totals, line);
      add(career.byMode[record.mode], line);
    }
  }

  return [...byKey.values()].map((career) => ({
    athleteId: career.athleteId,
    sportId: career.sportId,
    matches: career.matches,
    wins: career.wins,
    losses: career.losses,
    draws: career.draws,
    totals: career.totals,
    byMode: career.byMode,
  }));
}

interface Mutable {
  athleteId: string;
  sportId: SportId;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  totals: StatTotals;
  byMode: Record<StatMode, StatTotals>;
}

function blank(athleteId: string, sportId: SportId): Mutable {
  const byMode = {} as Record<StatMode, StatTotals>;
  for (const mode of STAT_MODES) byMode[mode] = { ...EMPTY_TOTALS };
  return {
    athleteId,
    sportId,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    totals: { ...EMPTY_TOTALS },
    byMode,
  };
}

/** Adds a line into a totals bucket. Written once so a new stat cannot be added to only one path. */
function add(totals: StatTotals, line: StatLine): void {
  const target = totals as Record<string, number>;
  for (const key of Object.keys(EMPTY_TOTALS)) {
    target[key] = (target[key] ?? 0) + ((line as unknown as Record<string, number>)[key] ?? 0);
  }
}

/** Shooting percentage as a whole number, or `null` when nothing was attempted. */
export function percentage(made: number, attempted: number): number | null {
  return attempted === 0 ? null : Math.round((made / attempted) * 100);
}
