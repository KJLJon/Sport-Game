/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.16 — Soccer art & audio pass
 * @story   US-2.3 — See the whole field on a small screen
 * @story   US-2.2 — Switch which athlete I am controlling
 * @design  10-ui-ux.md §3.1 (palette tokens), §11 (accessibility — colour is never the only signal),
 *          06-game-design.md §9 (art and audio direction)
 *
 * Purpose: the soccer look — kit palettes, an athlete, and a ball, as pure draw functions over
 * `Canvas2D`. The counterpart to `basketball/art.ts`, and it exists because a soccer match was being
 * drawn with basketball's.
 *
 * **This file is fixing a bug, not adding polish.** `modes/live/screen.ts` imported
 * `sports/basketball/art.ts` by name and drew every athlete and every ball with it, so a soccer
 * match was eleven basketball players chasing an orange ball with seams on it. The screen's own
 * comment said entities were drawn "generically… because a top-down athlete is not sport-specific",
 * which is the assumption that made it invisible: the *body* is generic, the **kit** is not.
 *
 * **The keeper is the reason the seam takes the sport's state.** Soccer's goalkeeper wears a
 * different kit from the ten in front of them — it is a rule of the game, not a decoration — and it
 * is genuinely useful information at a glance: on a 105 m pitch shrunk to a phone, "which of those
 * dots is the keeper" is a question you ask constantly. Only soccer knows which entity that is
 * (`SoccerState.keepers`), which is why `drawAthletes` gets the state rather than a colour.
 *
 * **Not shared with basketball's art, on purpose.** The two draw a similar body and will not stay
 * similar: this one has a third kit and a ball with no seams. Two implementations of a hundred lines
 * is not duplication worth an abstraction; a third sport wanting the same body is, and **T-6.17 owns
 * that call** when hockey and football arrive in Phase 11.
 *
 * **Why the tokens are copied here as hex, not read from CSS**, and **why colour is never the only
 * signal**: both for the reasons `basketball/art.ts` states at length. The two teams differ in kit
 * *pattern* as well as hue — a hooped shirt against a solid one, which is soccer's own version of
 * `10` §3.1's list — the keeper differs in shape as well as kit, and the controlled-athlete marker
 * is a ring drawn *around* the athlete rather than a brighter fill on top of them.
 */
import { Detail, type Canvas2D, type DetailLevel } from '../../engine/render/renderer.ts';

export type Theme = 'dark' | 'light';

/** A team's fill, and the ink its kit marking and facing tick draw in on top of that fill. */
export interface KitPalette {
  readonly fill: string;
  readonly onFill: string;
}

export interface SoccerPalette {
  /** Indexed by `Side` (0/1). */
  readonly teams: readonly [KitPalette, KitPalette];
  /** The goalkeeper's kit. One for both sides: a keeper is told apart from the ten, not from theirs. */
  readonly keeper: KitPalette;
  readonly ball: string;
  /** The dark panels on the ball — a football's marking, where a basketball has seams. */
  readonly ballPanel: string;
}

// `src/ui/tokens.css`, dark theme (the default root; `10` §3.1 is dark-first).
const DARK: SoccerPalette = {
  teams: [
    { fill: '#e8eef5', onFill: '#12181f' }, // --ui-team-home on --ui-ink-inverse
    { fill: '#2f6fb8', onFill: '#f4f1ea' }, // --ui-team-away on --ui-ink
  ],
  keeper: { fill: '#e3b23c', onFill: '#12181f' }, // --ui-accent-warm
  ball: '#f4f1ea', // --ui-ink
  ballPanel: '#1d232b', // --ui-surface
};

// The light theme's kits, darkened enough to hold their own against grass rather than against ink.
const LIGHT: SoccerPalette = {
  teams: [
    { fill: '#1f2933', onFill: '#f4f1ea' },
    { fill: '#2f6fb8', onFill: '#f4f1ea' },
  ],
  keeper: { fill: '#c98a1e', onFill: '#12181f' },
  ball: '#ffffff',
  ballPanel: '#2b333d',
};

/** Picks the palette for a theme. Defaults dark, per `10` §3.1's dark-first. */
export function paletteFor(theme: Theme = 'dark'): SoccerPalette {
  return theme === 'light' ? LIGHT : DARK;
}

/** World-space radii, for a caller without an entity of its own (a fixture, the gallery). */
export const ATHLETE_RADIUS = 0.45;
export const BALL_RADIUS = 0.11;

/** The controlled-athlete ring: a dark halo under a light ring, so it reads on grass of any shade. */
const MARKER_HALO = 'rgba(10, 14, 18, 0.55)';
const MARKER_RING = 'rgba(244, 241, 234, 0.95)';
const SHADOW = 'rgba(8, 12, 16, 0.3)';

const TAU = Math.PI * 2;

export interface AthleteDrawOptions {
  /** Which side, for the kit pattern. */
  readonly team: 0 | 1;
  readonly controlled: boolean;
  readonly radius: number;
  /** Goalkeepers wear the keeper kit and are drawn with a squarer silhouette. */
  readonly keeper: boolean;
}

/**
 * One athlete, seen from above.
 *
 * `detail` trims decoration first: `FULL` is the shadow, the kit marking, and the facing tick;
 * `REDUCED` is the body and the marking; `MINIMAL` is a shape — a disc for side 0, a diamond for
 * side 1 — because at that size hue is the first thing to become unreadable and the last thing that
 * should be carrying which team somebody is on (`10` §11).
 */
export function drawAthlete(
  ctx: Canvas2D,
  x: number,
  y: number,
  facing: number,
  kit: KitPalette,
  detail: DetailLevel,
  options: AthleteDrawOptions,
): void {
  const radius = options.radius;

  if (detail === Detail.MINIMAL) {
    ctx.fillStyle = kit.fill;
    ctx.beginPath();
    if (options.team === 1) {
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
    } else {
      ctx.arc(x, y, radius, 0, TAU);
    }
    ctx.fill();
    return;
  }

  if (detail === Detail.FULL) {
    // A round shadow rather than an ellipse: `Canvas2D` is the slice of the real context the
    // renderer actually uses, and `ellipse` is not in it (T-1.7 — the slice is what makes layer
    // policy unit-testable without a browser). At this size the difference is invisible.
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.arc(x, y + radius * 0.3, radius, 0, TAU);
    ctx.fill();
  }

  if (options.controlled) {
    ctx.strokeStyle = MARKER_HALO;
    ctx.lineWidth = radius * 0.42;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.42, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = MARKER_RING;
    ctx.lineWidth = radius * 0.22;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.42, 0, TAU);
    ctx.stroke();
  }

  ctx.fillStyle = kit.fill;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();

  // The kit marking, which is what tells the teams apart without hue: side 1 wears hoops, side 0 is
  // solid, and the keeper wears a band across the shoulders that neither outfield kit has.
  ctx.strokeStyle = kit.onFill;
  ctx.lineWidth = radius * 0.22;
  if (options.keeper) {
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.8, y - radius * 0.25);
    ctx.lineTo(x + radius * 0.8, y - radius * 0.25);
    ctx.stroke();
  } else if (options.team === 1) {
    for (const offset of [-0.4, 0.25]) {
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.9, y + radius * offset);
      ctx.lineTo(x + radius * 0.9, y + radius * offset);
      ctx.stroke();
    }
  }

  if (detail === Detail.FULL) {
    // Which way they are facing, as a tick out of the body — a direction you can see at a glance.
    ctx.strokeStyle = kit.onFill;
    ctx.lineWidth = radius * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(facing) * radius * 1.25, y + Math.sin(facing) * radius * 1.25);
    ctx.stroke();
  }
}

export interface BallDrawOptions {
  readonly radius: number;
}

/**
 * The ball. A football: white, with dark panels, and **no seam line** — the seam is the one thing
 * that made the borrowed basketball unmistakably the wrong ball.
 *
 * Height has no direct picture on a top-down view, so it reads the way basketball's does: the ball
 * grows a little as it rises and its shadow stays on the grass beneath it and shrinks. A ball in the
 * air is therefore a ball with a gap under it, which is legible without a number.
 */
export function drawBall(
  ctx: Canvas2D,
  x: number,
  y: number,
  z: number,
  palette: SoccerPalette,
  detail: DetailLevel,
  options: BallDrawOptions = { radius: BALL_RADIUS },
): void {
  const radius = options.radius;
  const height = Math.max(0, z);
  const lift = Math.min(1, height / 6);

  if (detail === Detail.FULL) {
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.arc(x, y, radius * (1 - lift * 0.45), 0, TAU);
    ctx.fill();
  }

  const drawn = radius * (1 + lift * 0.35);
  const cy = y - height * 0.35;

  ctx.fillStyle = palette.ball;
  ctx.beginPath();
  ctx.arc(x, cy, drawn, 0, TAU);
  ctx.fill();

  if (detail === Detail.MINIMAL) return;

  // Three panels, spaced round the ball. Enough to read as a football at the size a phone draws it,
  // and cheap enough that eleven of them per frame is not a decision anybody has to think about.
  ctx.fillStyle = palette.ballPanel;
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * TAU + 0.4;
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(angle) * drawn * 0.45,
      cy + Math.sin(angle) * drawn * 0.45,
      drawn * 0.3,
      0,
      TAU,
    );
    ctx.fill();
  }
}
