/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.3 — Narration + animated court-diagram renderer for turn outcomes
 * @story   US-15.3 — See what happened, not read about it
 * @design  09-modes-and-arcade.md §2.1 (short animated diagram), 10-ui-ux.md §8.4 (turn screen),
 *          10-ui-ux.md §6 (reduced motion)
 * @invariant INV-5 (nothing sport-specific here)
 *
 * Purpose: the turn diagram — `09` §2.1's "moving markers, passing lines, a shot arc". A sport
 * describes what happened as a small timeline in *field fractions*; this file turns a timeline plus
 * a clock into a frame, and a frame plus a canvas into a picture.
 *
 * **Why the timeline is data and the drawing is separate.** `diagramAt()` is a pure function of
 * `(diagram, seconds)`, so every claim worth making about the animation — the pass line appears
 * before the shot, the markers finish where they were sent, nothing is drawn before its beat — is a
 * unit test with no canvas in it. `drawDiagram()` is the only part that needs one, and it is tested
 * against the recording double the renderer already provides.
 *
 * **Field fractions, not metres.** A diagram is drawn into whatever rectangle the turn screen has,
 * on a phone in portrait (`10` §8.4 puts the court up top). Positions are `0–1` across the field's
 * own extent, so the sport does not have to know the size of the box and the box does not have to
 * know the sport.
 *
 * **Reduced motion is a different picture, not a faster one** (`10` §6). Asked for it, the diagram
 * renders its final frame: markers where they ended, the shot line drawn, the outcome shown. There
 * is nothing to watch, which is the point.
 */
import type { EntityId } from '../../engine/world.ts';
import type { Side } from '../../engine/match/events.ts';
import type { Canvas2D } from '../../engine/render/renderer.ts';
import type { PlaybookAthlete } from './types.ts';

/** A point in field fractions: `0–1` along the field, `0–1` across it. */
export interface DiagramPoint {
  readonly x: number;
  readonly y: number;
}

/** One athlete on the diagram. Markers always exist; they simply may not move. */
export interface DiagramMarker {
  readonly id: EntityId;
  readonly side: Side;
  /** Two or three characters — a jersey number or initials. Never a full name at this size. */
  readonly label: string;
  readonly from: DiagramPoint;
  readonly to: DiagramPoint;
  /** The athlete the turn was about. Drawn larger, and named in the narration. */
  readonly primary?: boolean;
}

/**
 * What goes inside a marker: the jersey number, or two initials when there is none.
 *
 * Shared because every sport's diagram wants the same answer and the constraint is the marker's
 * size rather than the sport — three characters is what fits at 28 px on a phone, whether it is a
 * point guard or a left back.
 */
export function markerLabel(player: PlaybookAthlete): string {
  const number = player.athlete.jerseyNumber;
  if (typeof number === 'number') return String(number);
  const parts = player.athlete.displayName.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

export const DIAGRAM_SHAPES = ['pass', 'shot', 'screen', 'drive'] as const;
export type DiagramShapeKind = (typeof DIAGRAM_SHAPES)[number];

/**
 * One drawn beat. `at`/`until` are fractions of the diagram's own duration, so a sport describes
 * *order* rather than milliseconds and the turn-speed control (T-5.7) is one multiplier.
 */
export interface DiagramShape {
  readonly kind: DiagramShapeKind;
  readonly from: DiagramPoint;
  readonly to: DiagramPoint;
  readonly at: number;
  readonly until: number;
  /** A shot that went in is drawn differently from one that did not — and labelled, not coloured. */
  readonly made?: boolean;
}

export interface TurnDiagram {
  /** How long the animation runs. `09` §2.1 — 4–8 seconds of resolution. */
  readonly seconds: number;
  readonly markers: readonly DiagramMarker[];
  readonly shapes: readonly DiagramShape[];
  /** Where the attacking side is going, for the arc's target and the court's orientation. */
  readonly basket: DiagramPoint;
  /** The one line shown under the diagram. */
  readonly caption: string;
}

/** A shape being drawn right now, with how much of it has been drawn. */
export interface ShapeFrame extends DiagramShape {
  /** `0–1` along the shape. `1` means fully drawn. */
  readonly progress: number;
}

export interface MarkerFrame extends DiagramMarker {
  readonly at: DiagramPoint;
}

export interface DiagramFrame {
  readonly markers: readonly MarkerFrame[];
  readonly shapes: readonly ShapeFrame[];
  /** `0–1` through the whole diagram. */
  readonly progress: number;
  readonly finished: boolean;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Ease-out: markers arrive rather than stop dead, which is the whole difference in how it reads. */
function ease(t: number): number {
  const clamped = clamp01(t);
  return 1 - (1 - clamped) * (1 - clamped);
}

function lerp(from: DiagramPoint, to: DiagramPoint, t: number): DiagramPoint {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Markers finish moving before the shot goes up, so the picture settles before the point of it. */
const MOVE_UNTIL = 0.55;

/**
 * The diagram at a moment. `seconds` past the end clamps to the final frame, so a caller that
 * over-runs shows the result rather than an empty court.
 */
export function diagramAt(diagram: TurnDiagram, seconds: number): DiagramFrame {
  const progress = diagram.seconds <= 0 ? 1 : clamp01(seconds / diagram.seconds);
  const moved = ease(progress / MOVE_UNTIL);

  const markers = diagram.markers.map((marker) => ({
    ...marker,
    at: lerp(marker.from, marker.to, moved),
  }));

  const shapes: ShapeFrame[] = [];
  for (const shape of diagram.shapes) {
    if (progress < shape.at) continue;
    const span = Math.max(1e-6, shape.until - shape.at);
    shapes.push({ ...shape, progress: clamp01((progress - shape.at) / span) });
  }

  return { markers, shapes, progress, finished: progress >= 1 };
}

/** The last frame, for reduced motion and for a diagram the player skipped. */
export function finalFrame(diagram: TurnDiagram): DiagramFrame {
  return diagramAt(diagram, diagram.seconds);
}

/** Where the diagram is drawn, in device-independent pixels. */
export interface DiagramLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Mirrors the diagram for a left-handed player, exactly as the arcade layout does (T-4.12). */
  readonly mirror?: boolean;
}

/** The two team colours plus the ink. Supplied by the screen from the design tokens (`10` §3). */
export interface DiagramPalette {
  readonly home: string;
  readonly away: string;
  readonly line: string;
  readonly made: string;
  readonly missed: string;
}

export const DEFAULT_PALETTE: DiagramPalette = {
  home: '#4f8cff',
  away: '#ff8a4f',
  line: '#8b93a7',
  made: '#39d98a',
  missed: '#8b93a7',
};

function project(point: DiagramPoint, layout: DiagramLayout): DiagramPoint {
  const x = layout.mirror === true ? 1 - point.x : point.x;
  return { x: layout.x + x * layout.width, y: layout.y + point.y * layout.height };
}

const MARKER_RADIUS = 0.028;

/**
 * Draws one frame. Deliberately dumb: it renders exactly what `diagramAt` produced and makes no
 * decisions of its own, so what you can test without a canvas is what you actually see.
 */
export function drawDiagram(
  ctx: Canvas2D,
  frame: DiagramFrame,
  layout: DiagramLayout,
  palette: DiagramPalette = DEFAULT_PALETTE,
): void {
  const radius = MARKER_RADIUS * Math.min(layout.width, layout.height);

  ctx.save();

  for (const shape of frame.shapes) {
    const from = project(shape.from, layout);
    const to = project(lerp(shape.from, shape.to, shape.progress), layout);
    ctx.strokeStyle = shape.kind === 'shot' ? shotInk(shape, palette) : palette.line;
    ctx.lineWidth = shape.kind === 'shot' ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // A finished shot gets a ring at the rim — the outcome, stated by shape rather than by colour
    // alone (`10` §11).
    if (shape.kind === 'shot' && shape.progress >= 1) {
      const rim = project(shape.to, layout);
      ctx.beginPath();
      ctx.arc(rim.x, rim.y, radius * (shape.made === true ? 0.9 : 0.6), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  for (const marker of frame.markers) {
    const at = project(marker.at, layout);
    const size = marker.primary === true ? radius * 1.35 : radius;
    ctx.fillStyle = marker.side === 1 ? palette.away : palette.home;
    ctx.beginPath();
    ctx.arc(at.x, at.y, size, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0b0d12';
    ctx.font = `${Math.round(size)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(marker.label, at.x, at.y + size * 0.35);
  }

  ctx.restore();
}

function shotInk(shape: ShapeFrame, palette: DiagramPalette): string {
  if (shape.progress < 1) return palette.line;
  return shape.made === true ? palette.made : palette.missed;
}
