/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.15 — Soccer arcade: Penalty Shootout
 * @task    T-4.5 — Free Throw — release timing under mounting pressure
 * @story   US-16.1 — Play a quick skill game
 * @design  10-ui-ux.md §3 (tokens), §11 (never colour alone), 09-modes-and-arcade.md §3.3
 * @invariant INV-5 (nothing sport-specific here)
 *
 * Purpose: what every arcade canvas draws with — the palette, the release meter, a centred label,
 * and the left-handed mirror.
 *
 * **Why it moved here.** All of this was written for basketball's five games and lived in
 * `sports/basketball/arcade/shared.ts`, which was right while there was one arcade set. Soccer's is
 * the second, and none of it is about basketball: a release meter is a release meter, and the
 * mirroring rule (T-4.12) and the never-colour-alone rule (`10` §11) are app-wide promises that
 * should not hold in one sport because that sport happened to be written first.
 */
import type { Canvas2D } from '../../engine/render/renderer.ts';
import type { ArcadeLayout } from './types.ts';

/**
 * The palette. Read from `10` §3's token values rather than invented here, and paired with a shape
 * or a label at every call site — nothing in an arcade game is distinguished by colour alone
 * (`10` §11, T-4.12).
 */
export const ARCADE_COLOURS = {
  court: '#1d232b',
  line: '#5d6875',
  band: '#3f9d6a',
  bandEdge: '#7fd4a4',
  marker: '#f4f1ea',
  danger: '#c8553d',
  text: '#f4f1ea',
  dim: '#98a2b0',
} as const;

/** Mirrors an x coordinate for a left-handed layout (T-4.12). Presentation only. */
export function mirrorX(x: number, layout: ArcadeLayout): number {
  return layout.mirror ? layout.width - x : x;
}

/** A rounded-ish bar, drawn with the primitives `Canvas2D` actually exposes. */
export function bar(
  ctx: Canvas2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, width, height);
}

/** Centres a line of text. */
export function label(
  ctx: Canvas2D,
  text: string,
  x: number,
  y: number,
  options: { readonly size?: number; readonly colour?: string } = {},
): void {
  ctx.fillStyle = options.colour ?? ARCADE_COLOURS.text;
  ctx.font = `${options.size ?? 16}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

/** Where the meter sits across the stage, as a fraction of the width, for a right-handed player. */
export const METER_THUMB_SIDE = 0.66;

/**
 * The vertical release meter four of the games draw: a track, the athlete's band, and the marker.
 * The band is drawn *and* outlined, and the marker is a wide bar rather than a tint, so the meter
 * reads without colour (T-4.12).
 */
export function drawMeter(
  ctx: Canvas2D,
  layout: ArcadeLayout,
  options: {
    readonly position: number;
    readonly band: { readonly from: number; readonly to: number };
    readonly x?: number;
  },
): void {
  // Off-centre, on the side the thumb is. A centred meter would make left-hand mirroring a no-op —
  // which it was, until a test asked what mirroring actually changed and the answer was nothing.
  const x = mirrorX(options.x ?? layout.width * METER_THUMB_SIDE, layout);
  const width = Math.max(24, layout.width * 0.08);
  const top = layout.height * 0.15;
  const height = layout.height * 0.7;
  const at = (value: number): number => top + height * (1 - value);

  bar(ctx, x - width / 2, top, width, height, ARCADE_COLOURS.court);
  ctx.strokeStyle = ARCADE_COLOURS.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - width / 2, top, width, height);

  const bandTop = at(options.band.to);
  const bandHeight = Math.max(3, at(options.band.from) - bandTop);
  bar(ctx, x - width / 2, bandTop, width, bandHeight, ARCADE_COLOURS.band);
  ctx.strokeStyle = ARCADE_COLOURS.bandEdge;
  ctx.strokeRect(x - width / 2, bandTop, width, bandHeight);

  // A tick through the band's middle: the one place worth hitting, marked by a line rather than by
  // being "the greener part" (`10` §11, T-4.12).
  const centreY = at((options.band.from + options.band.to) / 2);
  ctx.strokeStyle = ARCADE_COLOURS.marker;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - width / 2, centreY);
  ctx.lineTo(x + width / 2, centreY);
  ctx.stroke();

  const markerY = at(options.position);
  bar(ctx, x - width / 2 - 8, markerY - 3, width + 16, 6, ARCADE_COLOURS.marker);
}
