/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.10 — Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators
 * @task    T-2.11 — Pause menu, quit, in-match settings, post-match summary with box score
 * @story   US-2.3 — See what is happening
 * @story   US-2.4 — See the state of the match at a glance
 * @design  06-game-design.md §4 (match presentation), 04-architecture.md §5 (one event stream)
 * @invariant INV-9 (every mode emits the same `SportEvent` stream)
 *
 * Purpose: the box score, built by folding the event stream. Nothing here knows what sport it is
 * watching or which mode produced the events — which is the point of INV-9, and what makes the same
 * code serve Live, Playbook, and Arcade without a line of mode-specific branching.
 *
 * **Assists are inferred, not emitted.** No sport says "that was an assist"; a pass followed shortly
 * by a made basket from the receiver *is* one. Doing it here rather than in the sport keeps the
 * definition in one place for every sport that has the concept, and keeps sports from having to
 * carry a stat rule they do not own.
 */
import { EventKind, type Side, type SportEvent } from '../../engine/match/events.ts';
import type { EntityId } from '../../engine/world.ts';

/** How long after a pass a made basket still counts as assisted, in simulation steps. */
const ASSIST_WINDOW_STEPS = 150;

/** One athlete's line. Every counting stat a basketball box score has. */
export interface PlayerLine {
  readonly athlete: EntityId;
  readonly side: Side;
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threesMade: number;
  threesAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  rebounds: number;
  offensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
}

/** A side's totals. Derived, never accumulated separately — two counters always drift apart. */
export interface TeamLine extends Omit<PlayerLine, 'athlete' | 'side'> {
  readonly side: Side;
  readonly players: readonly PlayerLine[];
}

export interface BoxScore {
  /** Per-athlete lines, in entity order so the display is stable between frames. */
  readonly lines: Map<EntityId, PlayerLine>;
  /**
   * Turnovers the sport could not pin on anybody — a shot-clock violation, a bad inbound. They are
   * still the team's, and a box score whose team turnovers do not match the events it was built
   * from is a box score nobody trusts.
   */
  readonly teamTurnovers: [number, number];
  /** The last pass, for attributing an assist. */
  lastPass: { readonly actor: EntityId; readonly side: Side; readonly step: number } | null;
}

export function createBoxScore(): BoxScore {
  return { lines: new Map(), teamTurnovers: [0, 0], lastPass: null };
}

function lineFor(box: BoxScore, athlete: EntityId, side: Side): PlayerLine {
  const existing = box.lines.get(athlete);
  if (existing !== undefined) return existing;

  const line: PlayerLine = {
    athlete,
    side,
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
  box.lines.set(athlete, line);
  return line;
}

/**
 * Folds one event in.
 *
 * Deliberately tolerant: an event with no actor still counts towards the team where it can, because
 * a box score that silently drops a basket is worse than one that cannot attribute it.
 */
export function applyEvent(box: BoxScore, event: SportEvent): void {
  const actor = event.actor;
  const side = event.side;

  switch (event.kind) {
    case EventKind.SHOT: {
      if (actor === undefined) return;
      const line = lineFor(box, actor, side);
      const isFreeThrow = (event.detail ?? {}).zone === 'freeThrow';
      if (isFreeThrow) {
        line.freeThrowsAttempted++;
      } else {
        line.fieldGoalsAttempted++;
        if ((event.value ?? 2) === 3) line.threesAttempted++;
      }
      return;
    }

    case EventKind.SCORE: {
      if (actor === undefined) return;
      const line = lineFor(box, actor, side);
      const value = event.value ?? 2;
      line.points += value;

      if (value === 1) {
        line.freeThrowsMade++;
        return;
      }

      line.fieldGoalsMade++;
      if (value === 3) line.threesMade++;
      creditAssist(box, actor, side, event.step);
      return;
    }

    case EventKind.PASS:
      if (actor === undefined) return;
      box.lastPass = { actor, side, step: event.step };
      return;

    case EventKind.REBOUND: {
      if (actor === undefined) return;
      const line = lineFor(box, actor, side);
      line.rebounds++;
      if ((event.detail ?? {}).kind === 'offensive') line.offensiveRebounds++;
      return;
    }

    case EventKind.TURNOVER: {
      // A turnover always names the side that lost it; `actor` is set only when somebody is to
      // blame. A violation belongs to the team and to nobody in particular.
      if (actor !== undefined) lineFor(box, actor, side).turnovers++;
      else if (side === 0 || side === 1) box.teamTurnovers[side]++;
      return;
    }

    case EventKind.FOUL:
      if (actor === undefined) return;
      lineFor(box, actor, side).fouls++;
      return;

    case EventKind.SPORT: {
      if (actor === undefined) return;
      if (event.sportKind === 'basketball.steal') lineFor(box, actor, side).steals++;
      if (event.sportKind === 'basketball.block') lineFor(box, actor, side).blocks++;
      return;
    }

    default:
      return;
  }
}

/** A made basket credits the last passer, if the pass was recent and from the same side. */
function creditAssist(box: BoxScore, scorer: EntityId, side: Side, step: number): void {
  const pass = box.lastPass;
  box.lastPass = null;
  if (pass === null || pass.side !== side || pass.actor === scorer) return;
  if (step - pass.step > ASSIST_WINDOW_STEPS) return;
  lineFor(box, pass.actor, side).assists++;
}

/** Every line for a side, in entity order. */
export function linesFor(box: BoxScore, side: Side): PlayerLine[] {
  return [...box.lines.values()]
    .filter((line) => line.side === side)
    .sort((a, b) => a.athlete - b.athlete);
}

/** A side's totals, summed from its lines so the two can never disagree. */
export function teamLine(box: BoxScore, side: Side): TeamLine {
  const players = linesFor(box, side);
  const total = <K extends keyof PlayerLine>(key: K): number =>
    players.reduce((sum, line) => sum + (line[key] as number), 0);

  return {
    side,
    players,
    points: total('points'),
    fieldGoalsMade: total('fieldGoalsMade'),
    fieldGoalsAttempted: total('fieldGoalsAttempted'),
    threesMade: total('threesMade'),
    threesAttempted: total('threesAttempted'),
    freeThrowsMade: total('freeThrowsMade'),
    freeThrowsAttempted: total('freeThrowsAttempted'),
    rebounds: total('rebounds'),
    offensiveRebounds: total('offensiveRebounds'),
    assists: total('assists'),
    steals: total('steals'),
    blocks: total('blocks'),
    turnovers: total('turnovers') + (side === 0 || side === 1 ? box.teamTurnovers[side] : 0),
    fouls: total('fouls'),
  };
}

/** `made/attempted` with a percentage, or a dash when nothing was attempted. */
export function shootingLine(made: number, attempted: number): string {
  if (attempted === 0) return '0-0';
  return `${made}-${attempted} (${Math.round((made / attempted) * 100)}%)`;
}
