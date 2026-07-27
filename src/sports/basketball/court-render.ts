/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.1 — Court geometry, zones, arc, key, hoop, boundaries
 * @task    T-2.12 — Basketball art & audio pass
 * @story   US-3.1 — Play a 5v5 basketball match
 * @story   US-2.3 — See the whole field on a small screen
 * @design  10-ui-ux.md §3.1 (tokens), 04-architecture.md §5 (the sport module seam)
 *
 * Purpose: draws the court's line art from the same numbers the rules use. Every mark here reads
 * `COURT`, so a court that plays differently from how it looks is not a bug this file can have.
 *
 * The art pass (T-2.12) supplies the palette — `art.ts`'s copy of `10` §3.1's tokens — and nothing
 * else changes: not one literal here is a geometry number, so restyling this file can never quietly
 * move a line the rules disagree with.
 */
import type { Canvas2D, ViewTransform } from '../../engine/render/renderer.ts';
import type { FieldGeometry } from '../types.ts';
import { CENTRE_X, CENTRE_Y, COURT, CORNER_ARC_X, attackedBasket, type Side } from './court.ts';
import { paletteFor, type Theme } from './art.ts';

const LINE_WIDTH = 0.05;

/**
 * `theme` defaults dark (`10` §3.1's dark-first default) so the current call site —
 * `sport.render.drawField(ctx, field)`, which does not yet thread a theme through
 * `SportRenderer` — keeps compiling and painting correctly. Wiring a live theme through requires a
 * `SportRenderer.drawField` signature change, which is `sports/types.ts`'s call, not this file's.
 */
export function drawCourt(ctx: Canvas2D, field: FieldGeometry, theme: Theme = 'dark'): void {
  const palette = paletteFor(theme).court;

  ctx.fillStyle = palette.floor;
  ctx.fillRect(0, 0, field.width, field.height);

  ctx.strokeStyle = palette.line;
  ctx.fillStyle = palette.paint;
  ctx.lineWidth = LINE_WIDTH;

  ctx.strokeRect(0, 0, COURT.length, COURT.width);

  // Centre line and circle.
  ctx.beginPath();
  ctx.moveTo(CENTRE_X, 0);
  ctx.lineTo(CENTRE_X, COURT.width);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(CENTRE_X, CENTRE_Y, COURT.centreCircleRadius, 0, Math.PI * 2);
  ctx.stroke();

  drawHalf(ctx, 0, palette);
  drawHalf(ctx, 1, palette);
}

/** One end of the court. `side` here is the side that *attacks* this end, per `court.ts`. */
function drawHalf(
  ctx: Canvas2D,
  side: Side,
  palette: ReturnType<typeof paletteFor>['court'],
): void {
  const basket = attackedBasket(side);
  // +1 when this end is at low x, so every offset below is "into the court from this baseline".
  const inward = side === 0 ? -1 : 1;
  const baseline = side === 0 ? COURT.length : 0;

  const keyX = Math.min(baseline, baseline + inward * COURT.freeThrowFromBaseline);
  ctx.fillStyle = palette.paint;
  ctx.fillRect(keyX, CENTRE_Y - COURT.keyWidth / 2, COURT.freeThrowFromBaseline, COURT.keyWidth);
  ctx.strokeRect(keyX, CENTRE_Y - COURT.keyWidth / 2, COURT.freeThrowFromBaseline, COURT.keyWidth);

  // Free-throw circle. The far half is dashed in the real thing; a full circle reads better small.
  ctx.beginPath();
  ctx.arc(
    baseline + inward * COURT.freeThrowFromBaseline,
    CENTRE_Y,
    COURT.freeThrowCircleRadius,
    0,
    Math.PI * 2,
  );
  ctx.stroke();

  // Corner lines, from the baseline out to where they meet the arc.
  const cornerEnd = baseline + inward * CORNER_ARC_X;
  for (const y of [COURT.threeCornerInset, COURT.width - COURT.threeCornerInset]) {
    ctx.beginPath();
    ctx.moveTo(baseline, y);
    ctx.lineTo(cornerEnd, y);
    ctx.stroke();
  }

  // The arc itself, swept between the two corner-line meeting points.
  const spread = Math.acos((CORNER_ARC_X - COURT.basketFromBaseline) / COURT.threeArcRadius);
  const facing = inward > 0 ? 0 : Math.PI;
  ctx.beginPath();
  ctx.arc(basket.x, basket.y, COURT.threeArcRadius, facing - spread, facing + spread);
  ctx.stroke();

  // Restricted-area semicircle.
  ctx.beginPath();
  ctx.arc(
    basket.x,
    basket.y,
    COURT.restrictedAreaRadius,
    facing - Math.PI / 2,
    facing + Math.PI / 2,
  );
  ctx.stroke();

  // Backboard and rim.
  const boardX = baseline + inward * COURT.backboardFromBaseline;
  ctx.beginPath();
  ctx.moveTo(boardX, CENTRE_Y - COURT.backboardWidth / 2);
  ctx.lineTo(boardX, CENTRE_Y + COURT.backboardWidth / 2);
  ctx.stroke();

  ctx.strokeStyle = palette.rim;
  ctx.beginPath();
  ctx.arc(basket.x, basket.y, COURT.rimRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = palette.line;
}

/** Cache key for the static field layer — the court is fixed, so only the viewport can change it. */
export function courtKey(field: FieldGeometry, view: ViewTransform): string {
  return `basketball:${field.width}x${field.height}:${view.width}x${view.height}@${view.scale.toFixed(2)}`;
}
