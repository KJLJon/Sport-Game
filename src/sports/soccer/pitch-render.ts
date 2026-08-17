/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.10 — Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase
 * @task    T-13.5 — Field rendering: pitch, court, rink, and gridiron in the chosen style
 * @story   US-4.1 — Play an 11v11 soccer match
 * @story   US-2.3 — See the whole field on a small screen
 * @design  10-ui-ux.md §3.1 (palette tokens), 06-game-design.md §9 (art direction)
 * @design  13-visual-overhaul.md §3.2 (ball, fields, dressing)
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
 *
 * **T-13.5's sprite restyle, and the style vocabulary Phase 11 inherits.** `drawPitchSprite` below
 * is a second, additive pass over the same `PITCH` numbers: finer mow bands, a boundary apron, and
 * heavier line work with netted goals, none of it a new geometry literal. Two names are the ones a
 * rink or gridiron restyle (Phase 11) should reach for first: `SPRITE_STYLE.stripeCount` (the mow
 * band spacing — a rink's ice bays or a gridiron's yard bands are the same idea, and this file's
 * `bandWidth` counterpart lives in `basketball/court-render.ts`) and `PitchPalette.apron` (the
 * surround outside the touchline/goal line — a rink's kick boards or a gridiron's sideline turf are
 * the same idea, and it is deliberately the same `--border` token basketball's court apron uses, so
 * the two sports already agree on what "outside the field" looks like before a third sport exists).
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
  /**
   * T-13.5: the boundary apron — the surround outside the touchline and goal line. `--border`
   * (`10` §3.1), the one slot in this palette pulled straight from the token sheet rather than
   * mixed alongside `grass`: the apron is chrome, not turf, so it deliberately doesn't sit in the
   * same green family `grass`/`stripe`/`net` do — that's what keeps it from ever reading as one
   * more mow band. `basketball/court-render.ts`'s court apron uses the same token, on purpose (see
   * the file header).
   */
  readonly apron: string;
}

// `src/ui/tokens.css`, dark theme (the default root; `10` §3.1 is dark-first).
const DARK: PitchPalette = {
  grass: '#16281c',
  stripe: '#1a2f21',
  line: '#c8d6cc',
  net: '#93a89a',
  apron: '#263140', // --border
};

const LIGHT: PitchPalette = {
  grass: '#2f6b3d',
  stripe: '#357544',
  line: '#f2f7f3',
  net: '#dbe6de',
  apron: '#d6dce4', // --border
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

/**
 * Style vocabulary for the sprite restyle (`13` §3.2, §4 T-13.5) — spacing and weight, never a
 * geometry number. `stripeCount` and `PitchPalette.apron` are the two names Phase 11's rink and
 * gridiron restyle should reach for first; see the file header.
 */
const SPRITE_STYLE = {
  /** Mow bands across the sprite pitch — finer than the disc's `STRIPES` (9), still odd so the two
   *  halves aren't mirror images. 105 / 21 = 5 m a band, close to a real ground's mower width. */
  stripeCount: 21,
  /** How far outside the touchline/goal line the apron extends, in metres. */
  apronWidth: 3,
  /** Stroke weight for the sprite's line work — heavier than the disc's `LINE_WIDTH`. */
  lineWeight: 0.18,
  /** The low-alpha, over-width pass drawn under every crisp line — see `richStroke`. */
  shadowAlpha: 0.35,
  shadowScale: 2.4,
  /** Mesh divisions inside each goal's net box, both directions — the "reads as depth" T-13.5
   *  asks for, in place of the disc goal's bare outline. */
  netMeshLines: 5,
} as const;

/**
 * Strokes the *current path* twice: a wide, low-alpha pass first, then a crisp full-alpha pass at
 * `width` on top. Canvas re-strokes the same path on a second `stroke()` call with no path rebuild
 * needed, so this is one extra draw call per line, not a doubled path. The wide dim pass reads as
 * turf paint with a bit of bleed and depth rather than a bare vector stroke — the "richer line
 * work" `13` §4's T-13.5 entry asks for. Leaves `globalAlpha`/`lineWidth` at the crisp values.
 */
function richStroke(ctx: Canvas2D, width: number): void {
  ctx.globalAlpha = SPRITE_STYLE.shadowAlpha;
  ctx.lineWidth = width * SPRITE_STYLE.shadowScale;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** `richStroke`'s rectangle counterpart — `strokeRect` takes no path to re-stroke, so this issues
 *  the rect twice instead. */
function richStrokeRect(ctx: Canvas2D, x: number, y: number, w: number, h: number): void {
  const width = SPRITE_STYLE.lineWeight;
  ctx.globalAlpha = SPRITE_STYLE.shadowAlpha;
  ctx.lineWidth = width * SPRITE_STYLE.shadowScale;
  ctx.strokeRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.lineWidth = width;
  ctx.strokeRect(x, y, w, h);
}

/**
 * The apron: one fill covering the pitch rect and `SPRITE_STYLE.apronWidth` beyond it on every
 * side, drawn *before* the grass so only the margin stays visible once the grass is filled on top —
 * `field.width`/`field.height` are exactly `PITCH.length`/`PITCH.width` (`pitch.ts`'s "the world is
 * exactly the pitch"), so the apron has to reach past the field rect, not fill it. The one piece of
 * this file that draws outside `[0, PITCH.length] × [0, PITCH.width]` on purpose.
 */
function drawApron(ctx: Canvas2D, palette: PitchPalette): void {
  const w = SPRITE_STYLE.apronWidth;
  ctx.fillStyle = palette.apron;
  ctx.fillRect(-w, -w, PITCH.length + w * 2, PITCH.width + w * 2);
}

/** The grass, in mow bands finer than the disc's — legible as a surface even at the widest camera
 *  zoom (`13` §4's T-13.5 entry). */
function drawMowBands(ctx: Canvas2D, palette: PitchPalette): void {
  ctx.fillStyle = palette.grass;
  ctx.fillRect(0, 0, PITCH.length, PITCH.width);

  ctx.fillStyle = palette.stripe;
  const bandWidth = PITCH.length / SPRITE_STYLE.stripeCount;
  for (let i = 0; i < SPRITE_STYLE.stripeCount; i += 2) {
    ctx.fillRect(i * bandWidth, 0, bandWidth, PITCH.width);
  }
}

/**
 * The pitch as the sprite renderer draws it (`13` §4, T-13.5). Selected by `sprite-art.ts`'s
 * `drawField` and keyed separately in the static layer's cache, so the two styles can never blit
 * each other's cached field.
 *
 * Finer mow banding, a boundary apron, and heavier, netted line work over the same `PITCH` numbers
 * `drawPitch` reads — see the header for the style vocabulary this hands on to Phase 11's rink and
 * gridiron.
 */
export function drawPitchSprite(ctx: Canvas2D, _field: FieldGeometry, theme: Theme = 'dark'): void {
  const palette = paletteFor(theme);

  drawApron(ctx, palette);
  drawMowBands(ctx, palette);

  ctx.strokeStyle = palette.line;
  ctx.lineWidth = SPRITE_STYLE.lineWeight;

  // Touchlines and goal lines.
  richStrokeRect(ctx, 0, 0, PITCH.length, PITCH.width);

  // Halfway line and centre circle.
  ctx.beginPath();
  ctx.moveTo(CENTRE_X, 0);
  ctx.lineTo(CENTRE_X, PITCH.width);
  richStroke(ctx, SPRITE_STYLE.lineWeight);
  ctx.beginPath();
  ctx.arc(CENTRE_X, CENTRE_Y, PITCH.circleRadius, 0, Math.PI * 2);
  richStroke(ctx, SPRITE_STYLE.lineWeight);
  dot(ctx, palette, CENTRE_X, CENTRE_Y);

  drawEndSprite(ctx, palette, 0);
  drawEndSprite(ctx, palette, 1);
  drawCornerArcsSprite(ctx);
}

/** One end, sprite-styled — `drawEnd`'s markings with heavier, doubled line work and a netted
 *  goal box instead of a bare outline. */
function drawEndSprite(ctx: Canvas2D, palette: PitchPalette, side: Side): void {
  const line = defendedGoalLineX(side);
  const into = side === 0 ? 1 : -1;

  boxSprite(ctx, line, into, PITCH.penaltyAreaDepth, PITCH.penaltyAreaWidth);
  boxSprite(ctx, line, into, PITCH.goalAreaDepth, PITCH.goalAreaWidth);

  const spot = penaltySpot(side);
  dot(ctx, palette, spot.x, spot.y);

  // The D: the part of the arc from the penalty spot that falls outside the penalty area.
  const depth = PITCH.penaltyAreaDepth - PITCH.penaltySpotFromGoalLine;
  const half = Math.acos(clamp(depth / PITCH.circleRadius, -1, 1));
  const facing = side === 0 ? 0 : Math.PI;
  ctx.beginPath();
  ctx.arc(spot.x, spot.y, PITCH.circleRadius, facing - half, facing + half);
  richStroke(ctx, SPRITE_STYLE.lineWeight);

  drawGoalSprite(ctx, palette, side, line);
}

/** A rectangle of `depth` × `width`, hanging off the goal line into the pitch — `box`'s sprite
 *  twin, doubled for weight. */
function boxSprite(ctx: Canvas2D, line: number, into: number, depth: number, width: number): void {
  richStrokeRect(ctx, into > 0 ? line : line - depth, CENTRE_Y - width / 2, depth, width);
}

/**
 * The goal, netted: the outline `drawEnd` already draws, plus an interior mesh grid so the box
 * reads as a hollow volume behind the line rather than a bare rectangle — the "reads as depth"
 * `13` §4's T-13.5 entry asks for.
 */
function drawGoalSprite(ctx: Canvas2D, palette: PitchPalette, side: Side, line: number): void {
  const x = side === 0 ? -PITCH.goalDepth : line;
  const y = CENTRE_Y - PITCH.goalWidth / 2;
  const w = PITCH.goalDepth;
  const h = PITCH.goalWidth;

  ctx.strokeStyle = palette.net;
  ctx.strokeRect(x, y, w, h);

  const meshCount = SPRITE_STYLE.netMeshLines;
  for (let i = 1; i < meshCount; i++) {
    const ty = y + (h * i) / meshCount;
    ctx.beginPath();
    ctx.moveTo(x, ty);
    ctx.lineTo(x + w, ty);
    ctx.stroke();
  }
  for (let i = 1; i < meshCount; i++) {
    const tx = x + (w * i) / meshCount;
    ctx.beginPath();
    ctx.moveTo(tx, y);
    ctx.lineTo(tx, y + h);
    ctx.stroke();
  }
  ctx.strokeStyle = palette.line;
}

/** `drawCornerArcs`'s sprite twin, doubled for weight. */
function drawCornerArcsSprite(ctx: Canvas2D): void {
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
    richStroke(ctx, SPRITE_STYLE.lineWeight);
  }
}

/** Cache key for the static layer, so a theme or a resize redraws it and nothing else does. */
export function pitchKey(field: FieldGeometry, view: ViewTransform): string {
  return `soccer:${field.width}x${field.height}:${view.width}x${view.height}@${view.scale.toFixed(2)}`;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
