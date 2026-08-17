/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.1 — Court geometry, zones, arc, key, hoop, boundaries
 * @task    T-2.12 — Basketball art & audio pass
 * @task    T-13.5 — Field rendering: pitch, court, rink, and gridiron in the chosen style
 * @story   US-3.1 — Play a 5v5 basketball match
 * @story   US-2.3 — See the whole field on a small screen
 * @design  10-ui-ux.md §3.1 (tokens), 04-architecture.md §5 (the sport module seam)
 * @design  13-visual-overhaul.md §3.2 (ball, fields, dressing)
 *
 * Purpose: draws the court's line art from the same numbers the rules use. Every mark here reads
 * `COURT`, so a court that plays differently from how it looks is not a bug this file can have.
 *
 * The art pass (T-2.12) supplies the palette — `art.ts`'s copy of `10` §3.1's tokens — and nothing
 * else changes: not one literal here is a geometry number, so restyling this file can never quietly
 * move a line the rules disagree with.
 *
 * **T-13.5's sprite restyle, and the style vocabulary Phase 11 inherits.** `drawCourtSprite` below
 * is a second, additive pass over the same `COURT` numbers: parquet bands, a boundary apron, and
 * heavier line work, none of it a new geometry literal — every position is `COURT`'s own value, a
 * fraction of it, or offset by a new *style* constant (`SPRITE_STYLE`, just below the palette). Two
 * names in there are the ones a rink or gridiron restyle (Phase 11) should reach for first:
 * `SPRITE_STYLE.bandWidth` (the plank/stripe band spacing — a rink's ice bays or a gridiron's yard
 * bands are the same idea) and the `apron` palette slot (the surround outside the boundary line —
 * a rink's kick boards or a gridiron's sideline turf are the same idea). Both are named generically
 * for exactly that reason.
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

/**
 * Sprite-only palette slots `art.ts`'s `CourtPalette` doesn't carry — `art.ts` belongs to the
 * athlete/ball art pass (T-2.12) and this restyle doesn't touch it (it isn't a file this task
 * owns). Same rule as `art.ts`'s own header: mirrored from `10` §3.1's tokens as hex, never
 * invented, each literal carrying the token name it came from.
 *
 * `floorAlt` is the parquet band's alternate plank shade: the adjacent surface step from `floor`
 * (one level darker in dark, one level lighter in light), so banding differs in *luminance* and
 * not only in hue (`10` §11) — it still reads as "the same floor, a different plank" rather than a
 * chessboard, the same restraint `PitchPalette.stripe`'s doc comment calls out for the pitch.
 * `apron` is the boundary surround, `--border` in both themes — a full step away from `floor` and
 * `floorAlt` alike, so the apron reads as *outside* the floor rather than one more plank of it.
 */
interface CourtSpritePalette {
  readonly floorAlt: string;
  readonly apron: string;
}

// `src/ui/tokens.css`, dark theme.
const SPRITE_DARK: CourtSpritePalette = {
  floorAlt: '#0B0F14', // --surface-0
  apron: '#263140', // --border
};

// `src/ui/tokens.css`, `:root[data-theme='light']`.
const SPRITE_LIGHT: CourtSpritePalette = {
  floorAlt: '#FFFFFF', // --surface-1
  apron: '#D6DCE4', // --border
};

function spritePaletteFor(theme: Theme): CourtSpritePalette {
  return theme === 'light' ? SPRITE_LIGHT : SPRITE_DARK;
}

/**
 * Style vocabulary for the sprite restyle (`13` §3.2, §4 T-13.5) — spacing and weight, never a
 * geometry number. `bandWidth` and `apron` (the palette slot above) are the two names Phase 11's
 * rink and gridiron restyle should reach for first; see the file header.
 */
const SPRITE_STYLE = {
  /** Width, in metres, of one parquet plank band. 28 / 1.4 = 20 whole bands, so the last band at
   *  the far baseline is full width too — no sliver plank. */
  bandWidth: 1.4,
  /** How far outside the boundary line the apron extends, in metres. */
  apronWidth: 2.4,
  /** Stroke weight for the sprite's line work — heavier than the disc's `LINE_WIDTH`: a
   *  sprite-scale court can carry more ink before it reads as clutter. */
  lineWeight: 0.09,
  /** Inset, in metres, of the key's inner border — the second stroke that keys the paint as a
   *  distinct painted panel instead of a flat fill. */
  paintBorder: 0.22,
  /** How far behind the baseline the backboard's drawn panel reaches, in metres — a thickness for
   *  the panel to read as a standing board, not a bare line. */
  backboardThickness: 0.08,
  /** The rim's inner ring, as a fraction of `COURT.rimRadius` — draws the hoop as a hollow band
   *  rather than a single stroked circle. */
  rimInnerScale: 0.72,
} as const;

/**
 * The court as the sprite renderer draws it (`13` §4, T-13.5). Selected by
 * `sprite-art.ts`'s `drawField`, and keyed separately in the static layer's cache, so the two
 * styles can never blit each other's cached field.
 *
 * Parquet bands, a boundary apron, and heavier line work over the same `COURT` numbers `drawCourt`
 * reads — see the header for the style vocabulary this hands on to Phase 11's rink and gridiron.
 */
export function drawCourtSprite(ctx: Canvas2D, _field: FieldGeometry, theme: Theme = 'dark'): void {
  const palette = paletteFor(theme).court;
  const sprite = spritePaletteFor(theme);

  drawApron(ctx, sprite);
  drawParquet(ctx, palette, sprite);

  ctx.strokeStyle = palette.line;
  ctx.lineWidth = SPRITE_STYLE.lineWeight;

  ctx.strokeRect(0, 0, COURT.length, COURT.width);

  // Centre line and circle.
  ctx.beginPath();
  ctx.moveTo(CENTRE_X, 0);
  ctx.lineTo(CENTRE_X, COURT.width);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(CENTRE_X, CENTRE_Y, COURT.centreCircleRadius, 0, Math.PI * 2);
  ctx.stroke();

  drawHalfSprite(ctx, 0, palette);
  drawHalfSprite(ctx, 1, palette);
}

/**
 * The apron: one fill that covers the court rect and `SPRITE_STYLE.apronWidth` beyond it on every
 * side, drawn *before* the floor so only the margin stays visible once the floor is filled on top.
 * `field.width`/`field.height` are exactly `COURT.length`/`COURT.width` (`court.ts`'s "the world is
 * exactly the court"), so the apron has to reach past the field rect, not fill it — the one piece
 * of this file that draws outside `[0, COURT.length] × [0, COURT.width]` on purpose.
 */
function drawApron(ctx: Canvas2D, sprite: CourtSpritePalette): void {
  const w = SPRITE_STYLE.apronWidth;
  ctx.fillStyle = sprite.apron;
  ctx.fillRect(-w, -w, COURT.length + w * 2, COURT.width + w * 2);
}

/**
 * The floor, as plank bands rather than a flat fill — banding that stays legible zoomed all the way
 * out, per `13` §4's T-13.5 entry. `bandWidth` divides `COURT.length` evenly (28 / 1.4 = 20), so
 * every band is full width; the `Math.min` below is a guard for a future `bandWidth` change, not
 * something this one exercises.
 */
function drawParquet(
  ctx: Canvas2D,
  court: ReturnType<typeof paletteFor>['court'],
  sprite: CourtSpritePalette,
): void {
  const bandWidth = SPRITE_STYLE.bandWidth;
  const bandCount = Math.ceil(COURT.length / bandWidth);
  for (let i = 0; i < bandCount; i++) {
    const x = i * bandWidth;
    const width = Math.min(bandWidth, COURT.length - x);
    ctx.fillStyle = i % 2 === 0 ? court.floor : sprite.floorAlt;
    ctx.fillRect(x, 0, width, COURT.width);
  }
}

/**
 * One end of the sprite court — `drawHalf`'s markings, with the extra weight a sprite-scale court
 * can carry: a keyed inner border on the paint, a backboard drawn as a standing panel instead of a
 * bare line, and a two-ring rim.
 */
function drawHalfSprite(
  ctx: Canvas2D,
  side: Side,
  palette: ReturnType<typeof paletteFor>['court'],
): void {
  const basket = attackedBasket(side);
  const inward = side === 0 ? -1 : 1;
  const baseline = side === 0 ? COURT.length : 0;

  const keyX = Math.min(baseline, baseline + inward * COURT.freeThrowFromBaseline);
  ctx.fillStyle = palette.paint;
  ctx.fillRect(keyX, CENTRE_Y - COURT.keyWidth / 2, COURT.freeThrowFromBaseline, COURT.keyWidth);
  ctx.strokeRect(keyX, CENTRE_Y - COURT.keyWidth / 2, COURT.freeThrowFromBaseline, COURT.keyWidth);

  // A keyed inner border — the second stroke that reads as painted floor rather than a flat panel.
  const inset = SPRITE_STYLE.paintBorder;
  ctx.strokeRect(
    keyX + inset,
    CENTRE_Y - COURT.keyWidth / 2 + inset,
    COURT.freeThrowFromBaseline - inset * 2,
    COURT.keyWidth - inset * 2,
  );

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

  // Backboard, drawn as a standing panel (fill + outline) with a support arm back to the baseline,
  // instead of the disc court's bare line — the "reads as depth" T-13.5 asks for.
  const boardX = baseline + inward * COURT.backboardFromBaseline;
  const boardBack = boardX + inward * SPRITE_STYLE.backboardThickness;
  const panelX = Math.min(boardX, boardBack);
  const panelWidth = Math.abs(boardBack - boardX);
  ctx.fillStyle = palette.line;
  ctx.fillRect(panelX, CENTRE_Y - COURT.backboardWidth / 2, panelWidth, COURT.backboardWidth);
  ctx.strokeRect(panelX, CENTRE_Y - COURT.backboardWidth / 2, panelWidth, COURT.backboardWidth);

  ctx.beginPath();
  ctx.moveTo(baseline, CENTRE_Y);
  ctx.lineTo(boardX, CENTRE_Y);
  ctx.stroke();

  // Rim: an outer ring plus a smaller inner one, so the hoop reads as a hollow band rather than a
  // single stroked circle.
  ctx.strokeStyle = palette.rim;
  ctx.beginPath();
  ctx.arc(basket.x, basket.y, COURT.rimRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(basket.x, basket.y, COURT.rimRadius * SPRITE_STYLE.rimInnerScale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = palette.line;
}

/** Cache key for the static field layer — the court is fixed, so only the viewport can change it. */
export function courtKey(field: FieldGeometry, view: ViewTransform): string {
  return `basketball:${field.width}x${field.height}:${view.width}x${view.height}@${view.scale.toFixed(2)}`;
}
