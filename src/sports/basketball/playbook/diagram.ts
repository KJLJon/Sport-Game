/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.3 — Narration + animated court-diagram renderer for turn outcomes
 * @story   US-15.3 — See what happened, not read about it
 * @design  09-modes-and-arcade.md §2.1, §2.2 (the six plays), 10-ui-ux.md §8.4
 *
 * Purpose: turns a resolved possession into the timeline `modes/playbook/diagram.ts` draws — where
 * the five markers start, where the play sent them, the pass, and the shot.
 *
 * **The shape of a play is part of the play.** Isolation clears out; Motion moves everyone; Post Up
 * sends one body to the block; Spot-Up spreads to the arc. These are the same six calls `09` §2.2
 * lists, drawn rather than described, and it is the whole reason the diagram is worth animating: a
 * player who has called Motion twice should be able to recognise it a third time without reading.
 */
import type {
  TurnDiagram,
  DiagramMarker,
  DiagramPoint,
  DiagramShape,
} from '../../../modes/playbook/diagram.ts';
import type {
  PlaybookAthlete,
  PlaybookState,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import { offensiveProfile } from './calls.ts';
import type { BasketballPlaybookState } from './resolution.ts';

/** The attacking side always plays left-to-right on the diagram: one court, one orientation. */
const BASKET: DiagramPoint = { x: 0.9, y: 0.5 };

/** Where the five stand before the call. Roughly a half-court set, in field fractions. */
const START: readonly DiagramPoint[] = [
  { x: 0.42, y: 0.5 },
  { x: 0.5, y: 0.16 },
  { x: 0.5, y: 0.84 },
  { x: 0.68, y: 0.3 },
  { x: 0.72, y: 0.62 },
];

/**
 * Where each play sends them. Index 0 is the primary option, and the rest follow the shape of the
 * set — which is what makes the six calls recognisable at a glance.
 *
 * @spec-ref 09-modes-and-arcade.md §2.2 — the six offensive calls
 */
const SHAPES: Readonly<Record<string, readonly DiagramPoint[]>> = {
  isolation: [
    { x: 0.68, y: 0.5 },
    { x: 0.46, y: 0.08 },
    { x: 0.46, y: 0.92 },
    { x: 0.58, y: 0.14 },
    { x: 0.58, y: 0.86 },
  ],
  'pick-roll': [
    { x: 0.74, y: 0.44 },
    { x: 0.68, y: 0.56 },
    { x: 0.48, y: 0.86 },
    { x: 0.5, y: 0.14 },
    { x: 0.62, y: 0.74 },
  ],
  'post-up': [
    { x: 0.84, y: 0.56 },
    { x: 0.56, y: 0.14 },
    { x: 0.56, y: 0.86 },
    { x: 0.46, y: 0.5 },
    { x: 0.7, y: 0.24 },
  ],
  motion: [
    { x: 0.66, y: 0.5 },
    { x: 0.6, y: 0.26 },
    { x: 0.6, y: 0.74 },
    { x: 0.78, y: 0.38 },
    { x: 0.78, y: 0.64 },
  ],
  'spot-up': [
    { x: 0.6, y: 0.24 },
    { x: 0.58, y: 0.78 },
    { x: 0.5, y: 0.5 },
    { x: 0.74, y: 0.12 },
    { x: 0.74, y: 0.88 },
  ],
  push: [
    { x: 0.86, y: 0.5 },
    { x: 0.72, y: 0.2 },
    { x: 0.72, y: 0.8 },
    { x: 0.52, y: 0.42 },
    { x: 0.5, y: 0.6 },
  ],
};

/** `09` §2.1 — 4–8 seconds of resolution. A turnover is quicker because less happened. */
const SECONDS = { normal: 5.5, quick: 4 } as const;

function jerseyLabel(player: PlaybookAthlete): string {
  const number = player.athlete.jerseyNumber;
  if (typeof number === 'number') return String(number);
  const parts = player.athlete.displayName.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

function at(points: readonly DiagramPoint[], index: number): DiagramPoint {
  return points[index % points.length] ?? { x: 0.5, y: 0.5 };
}

/**
 * The turn, as a timeline. Markers move first, then the pass, then the shot — the order `09` §2.1
 * asks for, and the order a possession actually happens in.
 */
export function buildDiagram(
  state: PlaybookState<BasketballPlaybookState>,
  resolution: TurnResolution,
): TurnDiagram {
  const attacking = resolution.attacking === 1 ? 1 : 0;
  const players = state.squads[attacking].players;
  const profile = offensiveProfile(resolution.calls.offence.call);
  const destinations = SHAPES[profile.id] ?? (SHAPES['motion'] as readonly DiagramPoint[]);

  // The primary option leads the shape; everyone else fills the remaining slots in squad order, so
  // the same call always draws the same set.
  const ordered = [
    ...players.filter((player) => player.id === resolution.actor),
    ...players.filter((player) => player.id !== resolution.actor),
  ];

  const markers: DiagramMarker[] = ordered.map((player, index) => ({
    id: player.id,
    side: attacking,
    label: jerseyLabel(player),
    from: at(START, index),
    to: at(destinations, index),
    ...(player.id === resolution.actor ? { primary: true } : {}),
  }));

  const primary = markers[0];
  const shapes: DiagramShape[] = [];

  const turnedOver = resolution.outcome === 'stolen' || resolution.outcome === 'turnover';
  const passer = resolution.events.find((entry) => entry.kind === 'pass');
  if (passer !== undefined && primary !== undefined) {
    const from = markers.find((marker) => marker.id === passer.actor)?.to ?? at(START, 1);
    shapes.push({ kind: 'pass', from, to: primary.to, at: 0.5, until: 0.68 });
  }

  if (primary !== undefined && !turnedOver) {
    shapes.push({
      kind: 'shot',
      from: primary.to,
      to: BASKET,
      at: 0.68,
      until: 0.95,
      made: resolution.points > 0,
    });
  }

  if (turnedOver && primary !== undefined) {
    // A lost ball is drawn as a drive that goes nowhere: the marker moves and then the line stops.
    shapes.push({ kind: 'drive', from: primary.from, to: primary.to, at: 0.4, until: 0.7 });
  }

  return {
    seconds: turnedOver ? SECONDS.quick : SECONDS.normal,
    markers,
    shapes,
    basket: BASKET,
    caption: resolution.expectation.because,
  };
}
