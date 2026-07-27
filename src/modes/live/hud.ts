/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.10 — Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators
 * @story   US-2.3 — See what is happening
 * @story   US-2.4 — See the state of the match at a glance
 * @design  06-game-design.md §4 (in-match HUD), 10-ui-ux.md §3 (tokens), §4 (safe areas),
 *          §6 (accessibility)
 * @invariant INV-5 (no sport-specific branching outside the sport), INV-11 (no information by
 *            colour alone; 44 px touch targets)
 *
 * Purpose: draws the match state a player has to be able to read at a glance while their thumbs are
 * busy. Everything it draws comes from `MatchView` and nothing else — it never sees a `World`, a
 * `RulesState`, or the word "basketball".
 *
 * **Why the layout is computed rather than hard-coded.** A phone's safe area is not a constant: a
 * notch, a rotation, and the browser's own chrome all move it, and a HUD that assumes otherwise puts
 * the shot clock under a camera cut-out. `hudLayout()` is a pure function of viewport and insets, so
 * every position in this file is testable without a screen.
 *
 * **Colour is never the only signal (INV-11).** The side in possession is marked by a caret, not a
 * tint; the bonus is the word BONUS, not a red number; the controlled athlete is a ring, not a
 * brighter shade. Each of those has a test.
 */
import type { Canvas2D } from '../../engine/render/renderer.ts';
import type { World } from '../../engine/world.ts';
import { NO_ENTITY, type EntityId } from '../../engine/world.ts';
import type { Side } from '../../engine/match/events.ts';
import { linesFor, teamLine } from './box-score.ts';
import type { MatchView } from './match.ts';

/** Safe-area insets in CSS pixels, as the shell reads them from the environment. */
export interface SafeArea {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_INSETS: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

export interface HudLayout {
  readonly width: number;
  readonly height: number;
  /** The scoreboard strip across the top. */
  readonly board: { x: number; y: number; width: number; height: number };
  /** The minimap, bottom-centre where neither thumb covers it. */
  readonly minimap: { x: number; y: number; width: number; height: number };
  /** The release meter, above the right thumb. */
  readonly meter: { x: number; y: number; width: number; height: number };
  /** Font sizes, scaled with the viewport so a small phone is not unreadable. */
  readonly scale: number;
}

/** Reference viewport the type scale is authored against. */
const REFERENCE_WIDTH = 780;

/**
 * The whole layout, from a viewport and its insets.
 *
 * Pure, so the awkward cases — a notch on the left in landscape, a very short viewport — are unit
 * tests rather than things you find out on a device.
 */
export function hudLayout(
  width: number,
  height: number,
  insets: SafeArea = NO_INSETS,
  uiScale = 1,
): HudLayout {
  const scale = Math.min(1.4, Math.max(0.75, (width / REFERENCE_WIDTH) * uiScale));

  const boardHeight = Math.round(34 * scale);
  const boardWidth = Math.min(width - insets.left - insets.right - 16, Math.round(340 * scale));
  const board = {
    x: Math.round(insets.left + (width - insets.left - insets.right - boardWidth) / 2),
    y: Math.round(insets.top + 8),
    width: boardWidth,
    height: boardHeight,
  };

  const minimapWidth = Math.round(132 * scale);
  const minimapHeight = Math.round((minimapWidth * 15) / 28);
  const minimap = {
    x: Math.round(insets.left + (width - insets.left - insets.right - minimapWidth) / 2),
    y: Math.round(height - insets.bottom - minimapHeight - 8),
    width: minimapWidth,
    height: minimapHeight,
  };

  const meterWidth = Math.round(120 * scale);
  const meter = {
    x: Math.round(width - insets.right - meterWidth - 16),
    y: Math.round(height - insets.bottom - Math.round(150 * scale)),
    width: meterWidth,
    height: Math.round(10 * scale),
  };

  return { width, height, board, minimap, meter, scale };
}

/** Colours the HUD draws in. Supplied by the caller so the theme lives in one place. */
export interface HudTheme {
  readonly panel: string;
  readonly text: string;
  readonly dim: string;
  readonly accent: string;
  readonly warn: string;
  readonly teams: readonly [string, string];
}

export const DEFAULT_HUD_THEME: HudTheme = {
  panel: 'rgba(10, 12, 16, 0.72)',
  text: '#f2ede4',
  dim: '#9aa3ad',
  accent: '#5ec8f2',
  warn: '#f2a03d',
  teams: ['#4d8ef7', '#f26d4d'],
};

/** `M:SS`, or one decimal inside the last minute — the convention every match clock uses. */
export function formatClock(seconds: number): string {
  const clamped = Math.max(0, seconds);
  if (clamped < 60) return clamped.toFixed(1);
  const minutes = Math.floor(clamped / 60);
  const rest = Math.floor(clamped - minutes * 60);
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

/** The action clock, which is always whole seconds and always rounded *up*. */
export function formatActionClock(seconds: number): string {
  return String(Math.max(0, Math.ceil(seconds)));
}

/**
 * The whole HUD, in one call.
 *
 * Drawn in screen space, not world space: the caller submits this to the renderer's `hud` layer
 * after resetting the view transform.
 */
export function drawHud(
  ctx: Canvas2D,
  view: MatchView,
  layout: HudLayout,
  theme: HudTheme = DEFAULT_HUD_THEME,
): void {
  drawScoreboard(ctx, view, layout, theme);
  if (view.status.stoppage !== null) drawStoppage(ctx, view, layout, theme);
  if (view.status.meter !== null) drawMeter(ctx, view.status.meter, layout, theme);
}

function drawScoreboard(ctx: Canvas2D, view: MatchView, layout: HudLayout, theme: HudTheme): void {
  const { board, scale } = layout;

  ctx.fillStyle = theme.panel;
  ctx.fillRect(board.x, board.y, board.width, board.height);

  const mid = board.y + board.height * 0.62;
  const font = Math.round(17 * scale);
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  ctx.textAlign = 'left';

  // Home, then away, with possession marked by a caret rather than a highlight (INV-11).
  ctx.fillStyle = theme.teams[0];
  ctx.fillText(possessionMark(view.status.possession, 0), board.x + 8, mid);
  ctx.fillStyle = theme.text;
  ctx.fillText(String(view.score[0]), board.x + 8 + font, mid);

  ctx.textAlign = 'right';
  ctx.fillStyle = theme.teams[1];
  ctx.fillText(possessionMark(view.status.possession, 1), board.x + board.width - 8, mid);
  ctx.fillStyle = theme.text;
  ctx.fillText(String(view.score[1]), board.x + board.width - 8 - font, mid);

  // Period and game clock, centred.
  ctx.textAlign = 'center';
  const centre = board.x + board.width / 2;
  ctx.fillStyle = theme.text;
  ctx.font = `600 ${Math.round(15 * scale)}px system-ui, sans-serif`;
  ctx.fillText(formatClock(view.status.periodClock), centre, mid);

  ctx.fillStyle = theme.dim;
  ctx.font = `500 ${Math.round(10 * scale)}px system-ui, sans-serif`;
  ctx.fillText(`${view.periodName} ${view.period}`, centre, board.y + board.height * 0.26);

  drawActionClock(ctx, view, layout, theme);
  drawFouls(ctx, view, layout, theme);
}

/** The action clock sits under the board and turns amber when it is nearly out. */
function drawActionClock(ctx: Canvas2D, view: MatchView, layout: HudLayout, theme: HudTheme): void {
  const clock = view.status.actionClock;
  if (clock === null) return;

  const { board, scale } = layout;
  const urgent = clock <= 5;

  ctx.textAlign = 'center';
  ctx.fillStyle = urgent ? theme.warn : theme.text;
  ctx.font = `700 ${Math.round((urgent ? 20 : 16) * scale)}px system-ui, sans-serif`;
  ctx.fillText(
    formatActionClock(clock),
    board.x + board.width / 2,
    board.y + board.height + Math.round(18 * scale),
  );
}

/** Team fouls, with the bonus spelled out rather than implied by a colour (INV-11). */
function drawFouls(ctx: Canvas2D, view: MatchView, layout: HudLayout, theme: HudTheme): void {
  const fouls = view.status.teamFouls;
  if (fouls === null) return;

  const bonus = view.status.bonus ?? [false, false];
  const { board, scale } = layout;
  const y = board.y + board.height + Math.round(12 * scale);
  ctx.font = `500 ${Math.round(10 * scale)}px system-ui, sans-serif`;

  ctx.textAlign = 'left';
  ctx.fillStyle = bonus[0] === true ? theme.warn : theme.dim;
  ctx.fillText(foulLabel(fouls[0], bonus[0] === true), board.x + 8, y);

  ctx.textAlign = 'right';
  ctx.fillStyle = bonus[1] === true ? theme.warn : theme.dim;
  ctx.fillText(foulLabel(fouls[1], bonus[1] === true), board.x + board.width - 8, y);
}

export function foulLabel(fouls: number, bonus: boolean): string {
  return bonus ? `${fouls} PF · BONUS` : `${fouls} PF`;
}

/** Why play has stopped (`06` §4: "brief, skippable, with the reason stated"). */
function drawStoppage(ctx: Canvas2D, view: MatchView, layout: HudLayout, theme: HudTheme): void {
  const reason = view.status.stoppage;
  if (reason === null) return;

  const { board, scale } = layout;
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.accent;
  ctx.font = `600 ${Math.round(12 * scale)}px system-ui, sans-serif`;
  ctx.fillText(
    reason.toUpperCase(),
    board.x + board.width / 2,
    board.y + board.height + Math.round(38 * scale),
  );
}

/**
 * The release meter. The ideal release is marked, so the window is something you can see rather
 * than something you learn — a timing mechanic the HUD lies about is worse than none.
 */
function drawMeter(ctx: Canvas2D, charge: number, layout: HudLayout, theme: HudTheme): void {
  const { meter } = layout;

  ctx.fillStyle = theme.panel;
  ctx.fillRect(meter.x, meter.y, meter.width, meter.height);

  ctx.fillStyle = theme.accent;
  ctx.fillRect(meter.x, meter.y, meter.width * clamp01(charge), meter.height);

  // The target notch, at the top of the bar.
  ctx.fillStyle = theme.text;
  ctx.fillRect(meter.x + meter.width - 3, meter.y - 3, 3, meter.height + 6);
}

/**
 * The minimap: the whole court, both squads, and the ball, at a glance.
 *
 * `10` §4 puts it bottom-centre for a reason — it is the one part of the HUD that has to survive
 * both thumbs being on the screen, and the middle is the only place neither of them reaches.
 */
export function drawMinimap(
  ctx: Canvas2D,
  view: MatchView,
  world: World,
  fieldWidth: number,
  fieldHeight: number,
  layout: HudLayout,
  theme: HudTheme = DEFAULT_HUD_THEME,
  sides?: ReadonlyMap<EntityId, Side>,
): void {
  const { minimap } = layout;
  const sx = minimap.width / fieldWidth;
  const sy = minimap.height / fieldHeight;

  ctx.fillStyle = theme.panel;
  ctx.fillRect(minimap.x, minimap.y, minimap.width, minimap.height);
  ctx.strokeStyle = theme.dim;
  ctx.lineWidth = 1;
  ctx.strokeRect(minimap.x, minimap.y, minimap.width, minimap.height);

  // Halfway line, so which end you are attacking is readable without colour.
  ctx.beginPath();
  ctx.moveTo(minimap.x + minimap.width / 2, minimap.y);
  ctx.lineTo(minimap.x + minimap.width / 2, minimap.y + minimap.height);
  ctx.stroke();

  const controlled = view.status.controlled;
  world.forEach((id) => {
    if (world.kind[id] === 1) return;
    const side = sides?.get(id) ?? (world.team[id] as Side);
    const x = minimap.x + (world.x[id] as number) * sx;
    const y = minimap.y + (world.y[id] as number) * sy;

    ctx.fillStyle = side === 1 ? theme.teams[1] : theme.teams[0];
    ctx.beginPath();
    ctx.arc(x, y, id === controlled ? 3.5 : 2, 0, Math.PI * 2);
    ctx.fill();

    // The controlled athlete gets a ring — a shape, not a shade (INV-11).
    if (id === controlled) {
      ctx.strokeStyle = theme.text;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/** An off-screen teammate, as an arrow on the viewport edge. */
export interface EdgeIndicator {
  readonly athlete: EntityId;
  readonly x: number;
  readonly y: number;
  /** Radians, pointing from the edge towards the athlete. */
  readonly angle: number;
  /** How far off-screen they are, in world units — a caller may fade distant ones. */
  readonly distance: number;
}

/**
 * Where to put arrows for athletes the camera cannot see (`06` §4, US-2.3).
 *
 * Clamped to a margin inside the viewport rather than exactly on the edge, because an arrow drawn
 * at `x = 0` is half off the screen and reads as a rendering glitch rather than as information.
 */
export function offScreenIndicators(
  world: World,
  view: MatchView,
  toScreen: (worldX: number, worldY: number) => { x: number; y: number },
  layout: HudLayout,
  margin = 26,
  athletes?: readonly EntityId[],
): EdgeIndicator[] {
  const out: EdgeIndicator[] = [];
  const centreX = layout.width / 2;
  const centreY = layout.height / 2;

  const consider = (id: EntityId): void => {
    if (world.kind[id] === 1) return;
    if ((world.team[id] as Side) !== view.playerSide) return;
    if (id === view.status.controlled) return;

    const screen = toScreen(world.x[id] as number, world.y[id] as number);
    const onScreen =
      screen.x >= margin &&
      screen.x <= layout.width - margin &&
      screen.y >= margin &&
      screen.y <= layout.height - margin;
    if (onScreen) return;

    out.push({
      athlete: id,
      x: clamp(screen.x, margin, layout.width - margin),
      y: clamp(screen.y, margin, layout.height - margin),
      angle: Math.atan2(screen.y - centreY, screen.x - centreX),
      distance: Math.hypot(screen.x - centreX, screen.y - centreY),
    });
  };

  if (athletes !== undefined) for (const id of athletes) consider(id);
  else world.forEach(consider);

  return out;
}

/** Draws the arrows `offScreenIndicators` located. */
export function drawEdgeIndicators(
  ctx: Canvas2D,
  indicators: readonly EdgeIndicator[],
  theme: HudTheme = DEFAULT_HUD_THEME,
): void {
  for (const indicator of indicators) {
    ctx.save();
    ctx.translate(indicator.x, indicator.y);
    ctx.rotate(indicator.angle);
    ctx.fillStyle = theme.teams[0];
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** The live box score, as rows of plain strings for whoever is drawing it. */
export interface BoxRow {
  readonly label: string;
  readonly points: string;
  readonly shooting: string;
  readonly rebounds: string;
  readonly assists: string;
}

/**
 * The live box score as text rows, so the same data serves the in-match panel (T-2.10) and the
 * post-match summary (T-2.11) without either of them formatting numbers a second time.
 */
export function boxRows(view: MatchView, side: Side): BoxRow[] {
  const team = teamLine(view.box, side);
  const rows = linesFor(view.box, side).map((line) => ({
    label: `#${line.athlete}`,
    points: String(line.points),
    shooting: `${line.fieldGoalsMade}-${line.fieldGoalsAttempted}`,
    rebounds: String(line.rebounds),
    assists: String(line.assists),
  }));

  rows.push({
    label: 'Team',
    points: String(team.points),
    shooting: `${team.fieldGoalsMade}-${team.fieldGoalsAttempted}`,
    rebounds: String(team.rebounds),
    assists: String(team.assists),
  });
  return rows;
}

function possessionMark(possession: Side, side: Side): string {
  return possession === side ? '▸' : ' ';
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Exported for the screen: nothing is controlled before the first step. */
export const NO_CONTROLLED = NO_ENTITY;
