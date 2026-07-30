/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.10 — Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase
 * @story   US-4.1 — Play an 11v11 soccer match
 * @story   US-2.3 — See the whole field on a small screen
 * @design  10-ui-ux.md §3.1 (palette tokens), 06-game-design.md §9 (art direction)
 * @invariant INV-5 (no sport logic in the engine)
 *
 * Purpose: the pitch markings, so the soccer `SportModule` has a `SportRenderer` to hand the seam.
 *
 * **Scope is deliberately the lines and nothing else.** T-6.16 is the art and audio pass; this is
 * what the assembly needs in order to exist at all — a green rectangle with the Laws' markings on
 * it. Athletes and the ball are drawn by the shared art layer, and the kit palettes, crowd, and
 * effects arrive with T-6.16.
 *
 * The palette is mirrored from `10` §3.1's tokens as hex constants for the same reason
 * `basketball/art.ts` mirrors them: `Canvas2D` paints pixels and does not cascade, so a CSS custom
 * property cannot reach it. Dark-first, matching that file's default.
 */
import type { Canvas2D, ViewTransform } from '../../engine/render/renderer.ts';
import type { FieldGeometry } from '../types.ts';
import { CENTRE_X, CENTRE_Y, PITCH, defendedGoalLineX, penaltySpot, type Side } from './pitch.ts';

export type Theme = 'dark' | 'light';

export interface PitchPalette {
  readonly grass: string;
  /** The alternate mow stripe. Deliberately close to `grass`: a pitch, not a chessboard. */
  readonly stripe: string;
  readonly line: string;
  readonly net: string;
}

// `src/ui/tokens.css`, dark theme (the default root; `10` §3.1 is dark-first).
const DARK: PitchPalette = {
  grass: '#16281c',
  stripe: '#1a2f21',
  line: '#c8d6cc',
  net: '#93a89a',
};

const LIGHT: PitchPalette = {
  grass: '#2f6b3d',
  stripe: '#357544',
  line: '#f2f7f3',
  net: '#dbe6de',
};

export function paletteFor(theme: Theme): PitchPalette {
  return theme === 'light' ? LIGHT : DARK;
}

const LINE_WIDTH = 0.12;
/** Mow stripes across the pitch. Odd count so the two halves are not mirror images. */
const STRIPES = 9;

/**
 * `theme` defaults dark for the same reason `drawCourt`'s does: the current call site is
 * `sport.render.drawField(ctx, field)`, and threading a live theme through needs a
 * `SportRenderer.drawField` signature change, which is `sports/types.ts`'s call, not this file's.
 */
export function drawPitch(ctx: Canvas2D, field: FieldGeometry, theme: Theme = 'dark'): void {
  const palette = paletteFor(theme);

  ctx.fillStyle = palette.grass;
  ctx.fillRect(0, 0, field.width, field.height);

  // Mow stripes. Purely cosmetic, and the one thing that makes a large empty rectangle readable as
  // a pitch when the camera is zoomed out far enough that no markings are near the middle.
  ctx.fillStyle = palette.stripe;
  const stripeWidth = PITCH.length / STRIPES;
  for (let i = 0; i < STRIPES; i += 2) {
    ctx.fillRect(i * stripeWidth, 0, stripeWidth, PITCH.width);
  }

  ctx.strokeStyle = palette.line;
  ctx.lineWidth = LINE_WIDTH;

  // Touchlines and goal lines.
  ctx.strokeRect(0, 0, PITCH.length, PITCH.width);

  // Halfway line and centre circle.
  ctx.beginPath();
  ctx.moveTo(CENTRE_X, 0);
  ctx.lineTo(CENTRE_X, PITCH.width);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(CENTRE_X, CENTRE_Y, PITCH.circleRadius, 0, Math.PI * 2);
  ctx.stroke();
  dot(ctx, palette, CENTRE_X, CENTRE_Y);

  drawEnd(ctx, palette, 0);
  drawEnd(ctx, palette, 1);
  drawCornerArcs(ctx);
}

/** One end. `side` is the side that *defends* it, matching `pitch.ts`. */
function drawEnd(ctx: Canvas2D, palette: PitchPalette, side: Side): void {
  const line = defendedGoalLineX(side);
  // +1 when this end is at low x, so every offset below reads as "into the pitch from this line".
  const into = side === 0 ? 1 : -1;

  box(ctx, line, into, PITCH.penaltyAreaDepth, PITCH.penaltyAreaWidth);
  box(ctx, line, into, PITCH.goalAreaDepth, PITCH.goalAreaWidth);

  const spot = penaltySpot(side);
  dot(ctx, palette, spot.x, spot.y);

  // The D: the part of the arc from the penalty spot that falls outside the penalty area. Drawn as
  // the arc segment between the two angles at which it crosses the box's leading edge.
  const depth = PITCH.penaltyAreaDepth - PITCH.penaltySpotFromGoalLine;
  const half = Math.acos(clamp(depth / PITCH.circleRadius, -1, 1));
  const facing = side === 0 ? 0 : Math.PI;
  ctx.beginPath();
  ctx.arc(spot.x, spot.y, PITCH.circleRadius, facing - half, facing + half);
  ctx.stroke();

  // The goal itself, behind the line.
  ctx.strokeStyle = palette.net;
  ctx.strokeRect(
    side === 0 ? -PITCH.goalDepth : line,
    CENTRE_Y - PITCH.goalWidth / 2,
    PITCH.goalDepth,
    PITCH.goalWidth,
  );
  ctx.strokeStyle = palette.line;
}

/** A rectangle of `depth` × `width`, hanging off the goal line into the pitch. */
function box(ctx: Canvas2D, line: number, into: number, depth: number, width: number): void {
  ctx.strokeRect(into > 0 ? line : line - depth, CENTRE_Y - width / 2, depth, width);
}

function drawCornerArcs(ctx: Canvas2D): void {
  const r = PITCH.cornerArcRadius;
  const corners: readonly [number, number, number][] = [
    [0, 0, 0],
    [PITCH.length, 0, Math.PI / 2],
    [PITCH.length, PITCH.width, Math.PI],
    [0, PITCH.width, -Math.PI / 2],
  ];
  for (const [x, y, start] of corners) {
    ctx.beginPath();
    ctx.arc(x, y, r, start, start + Math.PI / 2);
    ctx.stroke();
  }
}

function dot(ctx: Canvas2D, palette: PitchPalette, x: number, y: number): void {
  ctx.fillStyle = palette.line;
  ctx.beginPath();
  ctx.arc(x, y, 0.15, 0, Math.PI * 2);
  ctx.fill();
}

/** Cache key for the static layer, so a theme or a resize redraws it and nothing else does. */
export function pitchKey(field: FieldGeometry, view: ViewTransform): string {
  return `soccer:${field.width}x${field.height}:${view.width}x${view.height}@${view.scale.toFixed(2)}`;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
