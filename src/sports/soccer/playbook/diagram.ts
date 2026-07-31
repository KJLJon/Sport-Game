/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.21 — Soccer Playbook: narration and animated pitch diagram for turn outcomes
 * @story   US-15.3 — See what happened, not read about it
 * @design  09-modes-and-arcade.md §2.1 (a short animated diagram: moving markers, passing lines,
 *          a shot arc), §2.3 (phase turns), 10-ui-ux.md §8.4 (turn screen)
 * @invariant INV-5 (no sport branching outside the sport module), INV-8 (determinism)
 *
 * Purpose: turns a resolved phase turn into the timeline `modes/playbook/diagram.ts` draws — where
 * the shape started, where the phase pushed it, the ball that moved it, and the shot at the end.
 *
 * **The shape comes from the formation, not from a table.** Basketball's diagram lists five hand-
 * placed spots per call because a half-court set is a drawing. Soccer already has eleven positions
 * written down — `formations.ts` gives every role an `x` and a `y` — so the diagram reads them, and
 * a squad set up in 4-3-3 draws as a 4-3-3. A hand-placed table here would have been a second
 * formation definition that nothing keeps in step with the first.
 *
 * **A phase is a block moving up the pitch.** `PHASE_X_FRACTION` (via `phaseBallX`) says where the
 * ball is; every marker follows it by a share of the distance, and the share grows with how far
 * forward the role already plays. That is what makes the five phases *look* different: a build-up
 * draws a back four with the strikers dropping in, and a chance draws the same eleven squeezed into
 * the last twenty-five metres. A player who has seen two build-ups should recognise the third
 * without reading the caption.
 *
 * **Attacking is always left-to-right**, whichever side has the ball, and the shot coordinates on
 * the events are mirrored into that frame. One orientation, so the diagram never asks the player
 * which way their team is kicking.
 */
import type { Side } from '../../../engine/match/events.ts';
import {
  markerLabel,
  type DiagramMarker,
  type DiagramPoint,
  type DiagramShape,
  type TurnDiagram,
} from '../../../modes/playbook/diagram.ts';
import type {
  PlaybookAthlete,
  PlaybookState,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import { FORMATIONS } from '../formations.ts';
import { PITCH } from '../pitch.ts';
import { phaseBallX, type SoccerPhase } from './phases.ts';
import type { SoccerPlaybookState } from './resolution.ts';
import { turnFacts, type TurnFacts } from './turn-facts.ts';

/** The goal being attacked. The `x` is inside the net, so a scored shot's line finishes past it. */
export const GOAL: DiagramPoint = { x: 0.985, y: 0.5 };

/**
 * `09` §2.1 — 4–8 seconds of resolution. A goal is given the longest look and a lost ball the
 * shortest, because less happened and the player wants the next call.
 */
export const SECONDS: Readonly<Record<string, number>> = {
  goal: 6.5,
  saved: 5.5,
  'off-target': 5,
  blocked: 5,
  corner: 5,
  chance: 5.5,
  advance: 5,
  lost: 4,
};

const DEFAULT_SECONDS = 5;

/**
 * How far the block follows the ball.
 *
 * `base` is what everybody moves; `forward` is the extra share a role already playing high up the
 * pitch takes, so the shape stretches towards the ball rather than collapsing onto it. A striker
 * (x ≈ 0.72) follows about 60% of the way to the ball line and a centre back (x ≈ 0.16) about a
 * third — which is roughly what a real block does, and, more to the point, keeps eleven markers
 * from landing on top of each other in the `chance` phase.
 */
export const BLOCK = { base: 0.25, forward: 0.5 } as const;

/** How the width intent spreads the shape across the pitch (T-6.19's second dimension). */
const WIDTH_SPREAD: Readonly<Record<string, number>> = {
  narrow: 0.78,
  'balanced-width': 1,
  wide: 1.2,
};

/** Nobody is drawn on the touchline itself; a marker there would be half off the diagram. */
const ACROSS_MARGIN = 0.05;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * Where a formation role stands, averaged across every formation that names it.
 *
 * Averaging rather than reading one formation is the same choice `squad.ts`'s `channelOf` makes and
 * for the same reason: a `PlaybookSquad` carries role ids, not the formation they came from. The
 * spread between formations for one role is a few percent of the pitch, which is smaller than the
 * phase shift applied on top of it.
 */
export function rolePoint(roleId: string): DiagramPoint {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const shape of FORMATIONS) {
    for (const role of shape.roles) {
      if (role.id !== roleId) continue;
      x += role.x;
      y += role.y;
      count += 1;
    }
  }
  return count === 0 ? { x: 0.5, y: 0.5 } : { x: x / count, y: y / count };
}

/** Where the ball is for this phase, as a fraction along the attacking direction. */
export function ballLine(phase: SoccerPhase): number {
  return clamp01(phaseBallX(phase, 0) / PITCH.length);
}

/** Pitch metres into the diagram's frame, with the attacking side always going left-to-right. */
export function toDiagram(x: number, y: number, attacking: Side): DiagramPoint {
  const along = x / PITCH.length;
  const across = y / PITCH.width;
  return attacking === 0
    ? { x: clamp01(along), y: clamp01(across) }
    : { x: clamp01(1 - along), y: clamp01(1 - across) };
}

/** Where the phase sends a role that starts at `base`. */
export function pushed(base: DiagramPoint, line: number, spread: number): DiagramPoint {
  const share = BLOCK.base + BLOCK.forward * base.x;
  return {
    x: clamp01(base.x + (line - base.x) * share),
    y: clamp(0.5 + (base.y - 0.5) * spread, ACROSS_MARGIN, 1 - ACROSS_MARGIN),
  };
}

function marker(
  player: PlaybookAthlete,
  side: Side,
  from: DiagramPoint,
  to: DiagramPoint,
  primary = false,
): DiagramMarker {
  return {
    id: player.id,
    side,
    label: markerLabel(player),
    from,
    to,
    ...(primary ? { primary: true } : {}),
  };
}

/**
 * The turn, as a timeline.
 *
 * Order matters and is the order the possession happened in: the block moves, then the ball is
 * played, then — if there was one — the shot. `diagramAt()` finishes the markers at 55% of the
 * run, so a pass beginning at 0.5 is drawn into a picture that has almost settled.
 */
export function buildDiagram(
  state: PlaybookState<SoccerPlaybookState>,
  resolution: TurnResolution,
): TurnDiagram {
  const facts = turnFacts(resolution);
  const attacking: Side = resolution.attacking === 1 ? 1 : 0;
  const defending: Side = attacking === 1 ? 0 : 1;
  const line = ballLine(facts.phase);
  const spread = WIDTH_SPREAD[facts.width] ?? 1;

  const attackers = state.squads[attacking].players;
  const defenders = state.squads[defending].players;

  // Everybody but the goalkeeper: eleven markers on a phone-sized diagram is a crowd, and the
  // attacking keeper is never the point of a phase turn. The one defender who is — the athlete the
  // turn was resolved against — is drawn in their own colour so the contest is visible.
  const markers: DiagramMarker[] = [];
  for (const player of attackers.slice(1)) {
    const base = rolePoint(player.role);
    const isActor = player.id === resolution.actor;
    markers.push(
      marker(
        player,
        attacking,
        base,
        isActor ? { x: line, y: pushed(base, line, spread).y } : pushed(base, line, spread),
        isActor,
      ),
    );
  }

  const opponent = defenders.find((player) => player.id === resolution.target);
  if (opponent !== undefined) {
    // Mirrored into the attacking frame: the defender's own formation `x` is measured from *their*
    // goal line, which is the far end of this diagram.
    const own = rolePoint(opponent.role);
    const base = { x: clamp01(1 - own.x), y: clamp01(1 - own.y) };
    const closing = { x: clamp01(line + 0.05), y: markers.find((m) => m.primary)?.to.y ?? 0.5 };
    markers.push(marker(opponent, defending, base, base.x > 0.9 ? base : closing));
  }

  const primary = markers.find((entry) => entry.primary);
  const ball = primary?.to ?? { x: line, y: 0.5 };

  return {
    seconds: SECONDS[resolution.outcome] ?? DEFAULT_SECONDS,
    markers,
    shapes: shapesFor(resolution.outcome, facts, attacking, markers, ball),
    basket: GOAL,
    caption: resolution.expectation.because,
  };
}

/**
 * What is drawn on top of the markers.
 *
 * One shape per thing that actually happened, and nothing for anything that did not: a turn with no
 * shot draws no arc, and a turn that lost the ball draws a carry that stops where it was lost. The
 * alternative — a generic line on every turn — would make the diagram decorative, and `09` §2.1
 * wants it to be the *record*.
 */
function shapesFor(
  outcome: string,
  facts: TurnFacts,
  attacking: Side,
  markers: readonly DiagramMarker[],
  ball: DiagramPoint,
): readonly DiagramShape[] {
  const shapes: DiagramShape[] = [];

  // The ball arriving: from the deepest teammate, which is where a phase of possession starts.
  const supply = markers
    .filter((entry) => entry.side === attacking && entry.primary !== true)
    .reduce<DiagramMarker | null>(
      (deepest, entry) => (deepest === null || entry.to.x < deepest.to.x ? entry : deepest),
      null,
    );
  if (facts.pass !== null && supply !== null) {
    shapes.push({ kind: 'pass', from: supply.to, to: ball, at: 0.45, until: 0.66 });
  }

  if (outcome === 'chance' && facts.pass !== null) {
    // The ball that opened them up, played on into the space it created.
    shapes.push({ kind: 'pass', from: ball, to: { x: 0.88, y: 0.5 }, at: 0.66, until: 0.86 });
  }

  if (outcome === 'lost') {
    // A lost ball is a carry that goes nowhere: the marker moves and then the line stops.
    shapes.push({
      kind: 'drive',
      from: ball,
      to: { x: ball.x + 0.05, y: ball.y },
      at: 0.5,
      until: 0.75,
    });
  }

  // Every attempt gets its own arc, staggered, so a phase of pressure reads as three shots rather
  // than one. The last one is the one whose outcome the turn carries.
  const shots = facts.shots.slice(0, 3);
  shots.forEach((shot, index) => {
    const at = 0.6 + index * 0.12;
    shapes.push({
      kind: 'shot',
      from: toDiagram(shot.x, shot.y, attacking),
      to: GOAL,
      at,
      until: Math.min(0.98, at + 0.24),
      made: shot.made,
    });
  });

  if (facts.corner) {
    // Behind for a corner: the ball leaves over the by-line, on the side the move was on.
    shapes.push({
      kind: 'pass',
      from: ball,
      to: { x: 0.99, y: ball.y < 0.5 ? 0.02 : 0.98 },
      at: shots.length > 0 ? 0.82 : 0.6,
      until: 0.96,
    });
  }

  return shapes;
}
