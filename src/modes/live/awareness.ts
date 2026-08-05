/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.3 — Off-screen awareness: edge indicators for teammates, opponents, and the ball,
 *          with distance
 * @story   US-2.3 — See what is happening on a small screen
 * @story   US-4.3 — Know where the pressure is coming from
 * @design  06-game-design.md §4 (match presentation), 10-ui-ux.md §4 (safe areas), §11 (colour is
 *          never the only signal)
 * @invariant INV-5 (no sport-specific branching outside the sport), INV-11 (no information by
 *            colour alone)
 *
 * Purpose: answers "where is everything I cannot see". A camera that shows a phase of play instead
 * of the whole field is only an improvement if that question has an answer every frame — otherwise
 * the player has traded three-pixel athletes for a smaller field they cannot see the edges of.
 *
 * **This replaces T-2.10's teammate arrows, which pointed at the wrong half of the problem.** They
 * showed teammates only — never the ball, never an opponent — which was defensible when the camera
 * fitted the whole field and the arrows were for a teammate at the far end. With a following camera
 * the ball leaves the frame, and a ball you cannot find is a game you cannot play.
 *
 * **Four things are worth an arrow, in this order:** the ball, your own athlete, the opponents
 * nearest you, and the teammates nearest you. The order is the priority when there is not room for
 * all of them, and there rarely is: a screen edged with eleven arrows conveys less than one edged
 * with three.
 *
 * **Every kind is a different shape (INV-11).** Not a different colour with the same triangle — a
 * player who cannot distinguish the two kits is exactly the player who needs to know which of these
 * is chasing them.
 */
import type { Canvas2D } from '../../engine/render/renderer.ts';
import type { EntityId, World } from '../../engine/world.ts';
import type { Side } from '../../engine/match/events.ts';
import { DEFAULT_HUD_THEME, type HudLayout, type HudTheme } from './hud.ts';
import type { MatchView } from './match.ts';

/** The ball's entity kind, as every sport module encodes it. */
const BALL_KIND = 1;

export const MARKER_KINDS = ['ball', 'controlled', 'opponent', 'teammate'] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number];

export interface EdgeMarker {
  readonly entity: EntityId;
  readonly kind: MarkerKind;
  /** Screen position, clamped to sit fully inside the viewport rather than half over its edge. */
  readonly x: number;
  readonly y: number;
  /** Radians, pointing from the marker outwards towards the thing it stands for. */
  readonly angle: number;
  /** How far away it is **in world units**, measured from `origin`. */
  readonly distance: number;
  /** The distance as it should be read aloud, or `null` for a marker that is not labelled. */
  readonly label: string | null;
}

export interface AwarenessOptions {
  /** Pixels in from the viewport edge that a marker sits. */
  readonly margin?: number;
  /** Most opponents to show. Beyond about two this stops being information and becomes a border. */
  readonly maxOpponents?: number;
  readonly maxTeammates?: number;
  /**
   * The world point distances are measured from. The athlete you are controlling, when there is
   * one — "18 m" means eighteen metres from *me*, which is the only reading a player can act on.
   * Defaults to the centre of the frame.
   */
  readonly origin?: { readonly x: number; readonly y: number };
}

/**
 * Every off-screen thing worth an arrow, most important first.
 *
 * `toScreen` is the camera's own projection, passed in rather than imported, so this stays a pure
 * function of numbers and can be tested without a camera at all.
 */
export function edgeMarkers(
  world: World,
  view: MatchView,
  ball: EntityId,
  toScreen: (worldX: number, worldY: number) => { x: number; y: number },
  layout: HudLayout,
  options: AwarenessOptions = {},
): EdgeMarker[] {
  const margin = options.margin ?? 26;
  const maxOpponents = options.maxOpponents ?? 2;
  const maxTeammates = options.maxTeammates ?? 3;

  const controlled = view.status.controlled;
  const origin =
    options.origin ??
    (controlled >= 0
      ? { x: world.x[controlled] as number, y: world.y[controlled] as number }
      : { x: world.x[ball] as number, y: world.y[ball] as number });

  const centreX = layout.width / 2;
  const centreY = layout.height / 2;

  const place = (id: EntityId, kind: MarkerKind): EdgeMarker | null => {
    const worldX = world.x[id] as number;
    const worldY = world.y[id] as number;
    const screen = toScreen(worldX, worldY);

    const onScreen =
      screen.x >= margin &&
      screen.x <= layout.width - margin &&
      screen.y >= margin &&
      screen.y <= layout.height - margin;
    if (onScreen) return null;

    const distance = Math.hypot(worldX - origin.x, worldY - origin.y);
    return {
      entity: id,
      kind,
      distance,
      x: clamp(screen.x, margin, layout.width - margin),
      y: clamp(screen.y, margin, layout.height - margin),
      angle: Math.atan2(screen.y - centreY, screen.x - centreX),
      // Only the two singular things are labelled. A distance on every arrow is six numbers to read
      // while both thumbs are busy, which is none of them read.
      label: kind === 'ball' || kind === 'controlled' ? `${Math.round(distance)} m` : null,
    };
  };

  const out: EdgeMarker[] = [];

  const ballMarker = place(ball, 'ball');
  if (ballMarker !== null) out.push(ballMarker);

  if (controlled >= 0 && controlled !== ball) {
    const own = place(controlled, 'controlled');
    if (own !== null) out.push(own);
  }

  // Opponents before teammates: the thing about to take the ball off you outranks the thing you
  // might pass to.
  const opponents: EdgeMarker[] = [];
  const teammates: EdgeMarker[] = [];

  world.forEach((id) => {
    if (id === ball || id === controlled) return;
    if (world.kind[id] === BALL_KIND) return;

    const side = world.team[id] as Side;
    if (side === -1) return;

    const marker = place(id, side === view.playerSide ? 'teammate' : 'opponent');
    if (marker === null) return;
    (marker.kind === 'opponent' ? opponents : teammates).push(marker);
  });

  byDistance(opponents);
  byDistance(teammates);
  out.push(...opponents.slice(0, maxOpponents), ...teammates.slice(0, maxTeammates));
  return out;
}

function byDistance(markers: EdgeMarker[]): void {
  markers.sort((a, b) => a.distance - b.distance);
}

/**
 * Draws the markers, each as its own silhouette.
 *
 * - **ball** — a disc with a tail, the only round marker, and the only one that is filled and
 *   outlined at once. It is the thing you look for first, so it is the thing that looks least like
 *   the others.
 * - **your athlete** — a hollow ring. Hollow because it is not urgent: it is where you left it.
 * - **an opponent** — an open chevron, a shape that reads as pointing *at you*.
 * - **a teammate** — a solid triangle, the arrow this file inherited.
 *
 * The size of every marker rises as its subject gets closer, which is a second, redundant channel
 * for the same fact — and the only one that works at a glance.
 */
export function drawEdgeMarkers(
  ctx: Canvas2D,
  markers: readonly EdgeMarker[],
  layout: HudLayout,
  theme: HudTheme = DEFAULT_HUD_THEME,
  playerSide: Side = 0,
): void {
  const base = 7 * layout.scale;

  for (const marker of markers) {
    // Nearer is bigger, between 1× and 1.6×, saturating at 30 m so a marker for something on the
    // far touchline is still a marker rather than a speck.
    const nearness = 1 + 0.6 * (1 - Math.min(marker.distance, 30) / 30);
    const size = base * nearness;

    ctx.save();
    ctx.translate(marker.x, marker.y);
    ctx.rotate(marker.angle);

    const teamColour = theme.teams[playerSide === 1 ? 1 : 0] as string;
    const opponentColour = theme.teams[playerSide === 1 ? 0 : 1] as string;

    switch (marker.kind) {
      case 'ball':
        ctx.fillStyle = theme.text;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(size * 0.55, 0);
        ctx.lineTo(size * 1.5, 0);
        ctx.stroke();
        break;

      case 'controlled':
        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.6, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'opponent':
        ctx.strokeStyle = opponentColour;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(-size * 0.6, size * 0.8);
        ctx.moveTo(size, 0);
        ctx.lineTo(-size * 0.6, -size * 0.8);
        ctx.stroke();
        break;

      case 'teammate':
        ctx.fillStyle = teamColour;
        ctx.beginPath();
        ctx.moveTo(size, 0);
        ctx.lineTo(-size * 0.7, size * 0.7);
        ctx.lineTo(-size * 0.7, -size * 0.7);
        ctx.closePath();
        ctx.fill();
        break;
    }

    ctx.restore();

    if (marker.label === null) continue;

    // The label is drawn unrotated: a distance printed at 140° is not a distance anybody reads.
    ctx.fillStyle = theme.text;
    ctx.font = `600 ${Math.round(11 * layout.scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(marker.label, marker.x, marker.y + size * 2.1);
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
