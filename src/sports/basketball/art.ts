/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.12 — Basketball art & audio pass
 * @story   US-2.3 — See the whole field on a small screen
 * @story   US-2.2 — Switch which athlete I am controlling
 * @design  10-ui-ux.md §3.1 (palette tokens), §11 (accessibility — colour is never the only signal),
 *          06-game-design.md §9 (art and audio direction)
 *
 * Purpose: the basketball look. A palette mirrored from `10` §3.1's tokens, and pure draw functions
 * for an athlete and the ball over `Canvas2D`. Nothing here owns a canvas, a theme, or a camera — it
 * draws whatever it is told to at whatever coordinates it is given, which is what keeps it
 * unit-testable against the recording double in `tests/helpers/canvas.ts`.
 *
 * **Why the tokens are copied here as hex, not read from CSS.** `Canvas2D` has no notion of a CSS
 * custom property — a canvas paints pixels, it does not cascade — so `10` §3.1's palette is mirrored
 * as constants, each carrying the token name it came from in a comment. `art.test.ts` is the
 * tripwire for the two drifting apart.
 *
 * **Colour is never the only signal** (`10` §11, CLAUDE.md §8.11 — no critical information by colour
 * alone). The two teams differ in kit pattern (a
 * cross-body stripe vs solid, from `10` §3.1's "solid, stripes, hoops, halves") as well as hue, all
 * the way down to the minimal dot, which is a circle for one side and a diamond for the other. The
 * controlled-athlete marker is a two-tone ring drawn *around* the athlete — a shape, never a
 * brighter fill on top of them — so "which one is mine" survives a team recolour and reads the same
 * regardless of a player's colour vision.
 *
 * **Why the marker and the shadow don't take a theme.** A halo dark ring behind a light one reads on
 * any floor colour without knowing which theme is active, and a shadow is definitionally darker than
 * whatever it falls on — so both are theme-agnostic constants rather than palette entries, which
 * keeps `drawAthlete` callable without threading a theme through every marker.
 */
import { Detail, type Canvas2D, type DetailLevel } from '../../engine/render/renderer.ts';
import { DEFAULT_BALL_PHYSICS } from '../../engine/physics/ball.ts';

export type Theme = 'dark' | 'light';

export interface CourtPalette {
  readonly floor: string;
  readonly paint: string;
  readonly line: string;
  readonly rim: string;
}

/** A team's fill, and the ink its kit marking and facing tick draw in on top of that fill. */
export interface TeamPalette {
  readonly fill: string;
  readonly onFill: string;
}

export interface BasketballPalette {
  readonly court: CourtPalette;
  /** Indexed by `Side` (0/1) from `court.ts`. */
  readonly teams: readonly [TeamPalette, TeamPalette];
  readonly ball: string;
  readonly ballSeam: string;
}

// `src/ui/tokens.css`, dark theme (the default root, `10` §3.1 is dark-first).
const DARK: BasketballPalette = {
  court: {
    floor: '#131A22', // --surface-1
    paint: '#1C2530', // --surface-2
    line: '#F2F6FA', // --text-hi
    rim: '#FFB020', // --accent-alt
  },
  teams: [
    { fill: '#4EA8FF', onFill: '#04121F' }, // --info / --on-info
    { fill: '#3DDC91', onFill: '#06210F' }, // --accent / --on-accent
  ],
  ball: '#FFB020', // --accent-alt
  ballSeam: '#241700', // --on-accent-alt
};

// `src/ui/tokens.css`, `:root[data-theme='light']`.
const LIGHT: BasketballPalette = {
  court: {
    floor: '#F7F8FA', // --surface-0
    paint: '#EEF1F5', // --surface-2
    line: '#0D1319', // --text-hi
    rim: '#E08600', // --accent-alt
  },
  teams: [
    { fill: '#0F5AAB', onFill: '#FFFFFF' }, // --info / --on-info
    { fill: '#0B7A43', onFill: '#FFFFFF' }, // --accent / --on-accent
  ],
  ball: '#E08600', // --accent-alt
  ballSeam: '#241700', // --on-accent-alt
};

/** Picks the palette for a theme. Defaults dark, per `10` §3.1's "dark-first". */
export function paletteFor(theme: Theme = 'dark'): BasketballPalette {
  return theme === 'light' ? LIGHT : DARK;
}

/** World-space radii for callers that don't have the entity's own (e.g. a test fixture). */
export const ATHLETE_RADIUS = 0.42;
export const BALL_RADIUS = DEFAULT_BALL_PHYSICS.radius;

// Theme-agnostic by design — see header.
const SHADOW = 'rgba(6, 10, 14, 0.4)';
const CONTROLLED_OUTER = 'rgba(6, 10, 14, 0.55)';
const CONTROLLED_INNER = '#F5F7FA';

export interface AthleteDrawOptions {
  /**
   * Which side's kit pattern to draw — kept independent of `teamColour` so a user's team-colour
   * choice (`10` §3.1) never has to remember to also swap the pattern; the pattern is tied to the
   * side, the colour to preference.
   */
  readonly team: 0 | 1;
  readonly controlled?: boolean;
  readonly radius?: number;
}

/**
 * One athlete. `detail` trims what's drawn, decoration first: `FULL` adds a shadow and a facing
 * tick to the body and its kit marking; `REDUCED` is the body and marking only; `MINIMAL` is a dot
 * whose *shape* still carries the team, because kit marking is accessibility, not decoration, and
 * INV-11 does not get to drop out at distance.
 */
export function drawAthlete(
  ctx: Canvas2D,
  x: number,
  y: number,
  facing: number,
  teamColour: TeamPalette,
  detail: DetailLevel,
  options: AthleteDrawOptions,
): void {
  const radius = options.radius ?? ATHLETE_RADIUS;

  if (detail === Detail.MINIMAL) {
    drawMinimalAthlete(ctx, x, y, radius, teamColour, options);
    return;
  }

  if (detail === Detail.FULL) {
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.arc(x, y + radius * 0.3, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = teamColour.fill;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  drawKitMarking(ctx, x, y, radius, teamColour, options.team);

  if (detail === Detail.FULL) {
    ctx.strokeStyle = teamColour.onFill;
    ctx.lineWidth = radius * 0.16;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(facing) * radius, y + Math.sin(facing) * radius);
    ctx.stroke();
  }

  if (options.controlled === true) drawControlledMarker(ctx, x, y, radius, detail);
}

/**
 * Team 1's stripe. Team 0 is left solid — a "home" kit needs no marking of its own, since a
 * two-team match only has to distinguish one from the other.
 *
 * @spec-ref 10-ui-ux.md §3.1 — kit patterns as the non-colour team signal
 */
function drawKitMarking(
  ctx: Canvas2D,
  x: number,
  y: number,
  radius: number,
  teamColour: TeamPalette,
  team: 0 | 1,
): void {
  if (team !== 1) return;

  ctx.strokeStyle = teamColour.onFill;
  ctx.lineWidth = radius * 0.32;
  ctx.beginPath();
  ctx.moveTo(x - radius * 0.75, y);
  ctx.lineTo(x + radius * 0.75, y);
  ctx.stroke();
}

/** The far-LOD dot. Team 0 stays a circle; team 1 becomes a diamond, so the shape carries the team
 * even where there is no room left to draw a marking on top of a fill. */
function drawMinimalAthlete(
  ctx: Canvas2D,
  x: number,
  y: number,
  radius: number,
  teamColour: TeamPalette,
  options: AthleteDrawOptions,
): void {
  const dotRadius = radius * 0.6;
  ctx.fillStyle = teamColour.fill;

  if (options.team === 1) {
    ctx.beginPath();
    ctx.moveTo(x, y - dotRadius);
    ctx.lineTo(x + dotRadius, y);
    ctx.lineTo(x, y + dotRadius);
    ctx.lineTo(x - dotRadius, y);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (options.controlled === true) drawControlledMarker(ctx, x, y, dotRadius, Detail.MINIMAL);
}

/**
 * The controlled-athlete marker: a two-tone ring around the athlete, not a tint on it. A dark halo
 * behind a light ring reads against both a light and a dark floor without the caller telling this
 * function which theme is active.
 */
export function drawControlledMarker(
  ctx: Canvas2D,
  x: number,
  y: number,
  radius: number,
  detail: DetailLevel,
): void {
  const ringRadius = radius + (detail === Detail.MINIMAL ? radius * 0.35 : radius * 0.4);

  ctx.strokeStyle = CONTROLLED_OUTER;
  ctx.lineWidth = radius * 0.34;
  ctx.beginPath();
  ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = CONTROLLED_INNER;
  ctx.lineWidth = radius * 0.16;
  ctx.beginPath();
  ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
  ctx.stroke();
}

export interface BallDrawOptions {
  readonly radius?: number;
}

/**
 * The ball. `z` (height off the floor) has no direct picture on a top-down view, so height is
 * carried by its shadow instead: the shadow shrinks as the ball climbs and returns to full size as
 * it lands, which is the one height cue this camera angle has room for.
 *
 * @spec-ref 06-game-design.md §9 — "a distinct ball with a shadow that communicates height"
 */
export function drawBall(
  ctx: Canvas2D,
  x: number,
  y: number,
  z: number,
  palette: BasketballPalette,
  detail: DetailLevel,
  options: BallDrawOptions = {},
): void {
  const radius = options.radius ?? BALL_RADIUS;

  if (detail !== Detail.MINIMAL) {
    // Never fully vanishes: MIN_SCALE keeps the shadow legible even at the top of a lob, which is
    // exactly the moment a player most needs to judge where the ball is going to come down.
    const MIN_SCALE = 0.3;
    const RISE_FOR_MIN_SHADOW = 3.5; // metres; a shot near the rim (3.05 m) is near the floor of it
    const t = clamp01(z / RISE_FOR_MIN_SHADOW);
    const shadowRadius = radius * (1 - t * (1 - MIN_SCALE));

    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.arc(x, y, shadowRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  const ballRadius = detail === Detail.MINIMAL ? radius * 0.7 : radius;
  ctx.fillStyle = palette.ball;
  ctx.beginPath();
  ctx.arc(x, y, ballRadius, 0, Math.PI * 2);
  ctx.fill();

  if (detail === Detail.FULL) {
    ctx.strokeStyle = palette.ballSeam;
    ctx.lineWidth = ballRadius * 0.18;
    ctx.beginPath();
    ctx.moveTo(x - ballRadius, y);
    ctx.lineTo(x + ballRadius, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - ballRadius);
    ctx.lineTo(x, y + ballRadius);
    ctx.stroke();
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
