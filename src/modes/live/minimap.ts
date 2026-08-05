/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.4 — Minimap rework: always-on, tap-to-look, readable at 44 px
 * @story   US-2.3 — See what is happening on a small screen
 * @design  06-game-design.md §4 (match presentation), 10-ui-ux.md §4 (safe areas, 44 px targets),
 *          §11 (colour is never the only signal)
 * @invariant INV-5 (no sport-specific branching outside the sport), INV-11 (44 px touch targets, no
 *            information by colour alone)
 *
 * Purpose: the whole field at a glance, and the one control that lets a player look somewhere the
 * camera has not taken them.
 *
 * **The minimap earns its space only now.** While the camera fitted the whole field it was a
 * smaller copy of what was already on screen. With a following camera it is the only place the far
 * end of the pitch exists, which is why this task moved it out of `hud.ts` and gave it three things
 * it did not have:
 *
 * 1. **The viewport rectangle.** Without it the minimap says where everyone is but not where *you*
 *    are looking, and those are different questions the moment the camera stops fitting the field.
 * 2. **Tap-to-look.** A minimap you cannot interrogate is a diagram; one you can tap is a control.
 * 3. **A 44 px floor and the field's own aspect.** `hudLayout` sized it at 28 × 15 — a basketball
 *    court, hardcoded in sport-generic code since T-2.10, which drew a soccer pitch squashed into
 *    a court's proportions. The aspect is now the field's, whatever the field is.
 */
import type { Canvas2D } from '../../engine/render/renderer.ts';
import type { EntityId, World } from '../../engine/world.ts';
import type { Side } from '../../engine/match/events.ts';
import { DEFAULT_HUD_THEME, type HudLayout, type HudTheme } from './hud.ts';
import type { MatchView } from './match.ts';

/** The ball's entity kind, as every sport module encodes it. */
const BALL_KIND = 1;

/**
 * The smallest a minimap may be drawn, in CSS pixels, on either axis.
 *
 * It is a touch target (INV-11) and it is also the point below which a dot for an athlete stops
 * being separable from the dot beside it.
 */
export const MIN_MINIMAP_PX = 44;

export interface MinimapFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the minimap goes: the area `hudLayout` reserved for it, re-shaped to the field's own aspect
 * ratio and never smaller than a touch target.
 *
 * Anchored to the *bottom* of the reserved area rather than the top, so a taller field grows the map
 * upwards into the screen instead of downwards through the safe-area inset `hudLayout` respected.
 */
export function minimapFrame(
  layout: HudLayout,
  fieldWidth: number,
  fieldHeight: number,
): MinimapFrame {
  const width = Math.max(layout.minimap.width, MIN_MINIMAP_PX);
  const height = Math.max((width * fieldHeight) / fieldWidth, MIN_MINIMAP_PX);
  const bottom = layout.minimap.y + layout.minimap.height;

  return {
    x: Math.round(layout.minimap.x + (layout.minimap.width - width) / 2),
    y: Math.round(bottom - height),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * The world point a tap on the minimap refers to, or `null` for a tap that missed it.
 *
 * The whole frame is the target, which is what makes it a 44 px one however small the field's
 * shortest axis is on screen.
 */
export function minimapPoint(
  frame: MinimapFrame,
  screenX: number,
  screenY: number,
  fieldWidth: number,
  fieldHeight: number,
): { x: number; y: number } | null {
  if (
    screenX < frame.x ||
    screenX > frame.x + frame.width ||
    screenY < frame.y ||
    screenY > frame.y + frame.height
  ) {
    return null;
  }

  return {
    x: ((screenX - frame.x) / frame.width) * fieldWidth,
    y: ((screenY - frame.y) / frame.height) * fieldHeight,
  };
}

export interface MinimapOptions {
  readonly theme?: HudTheme;
  /** The camera's visible world rectangle, drawn as the "you are here" box. */
  readonly viewport?: { x: number; y: number; width: number; height: number };
  /** Overrides `world.team` where a sport tracks sides separately. */
  readonly sides?: ReadonlyMap<EntityId, Side>;
  readonly ball?: EntityId;
}

/**
 * The whole field, both squads, the ball, and where the camera is looking.
 *
 * `10` §4 puts it bottom-centre for a reason — it is the one part of the HUD that has to survive
 * both thumbs being on the screen, and the middle is the only place neither of them reaches.
 */
export function drawMinimap(
  ctx: Canvas2D,
  frame: MinimapFrame,
  view: MatchView,
  world: World,
  fieldWidth: number,
  fieldHeight: number,
  options: MinimapOptions = {},
): void {
  const theme = options.theme ?? DEFAULT_HUD_THEME;
  const sx = frame.width / fieldWidth;
  const sy = frame.height / fieldHeight;

  ctx.fillStyle = theme.panel;
  ctx.fillRect(frame.x, frame.y, frame.width, frame.height);
  ctx.strokeStyle = theme.dim;
  ctx.lineWidth = 1;
  ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);

  // Halfway line, so which end you are attacking is readable without colour.
  ctx.beginPath();
  ctx.moveTo(frame.x + frame.width / 2, frame.y);
  ctx.lineTo(frame.x + frame.width / 2, frame.y + frame.height);
  ctx.stroke();

  // The viewport box, drawn under the dots so it never hides one. This is the part that makes a
  // minimap worth having once the camera has stopped showing the whole field.
  if (options.viewport !== undefined) {
    const box = options.viewport;
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      frame.x + Math.max(0, box.x) * sx,
      frame.y + Math.max(0, box.y) * sy,
      Math.min(box.width, fieldWidth) * sx,
      Math.min(box.height, fieldHeight) * sy,
    );
  }

  const controlled = view.status.controlled;
  world.forEach((id) => {
    const isBall = world.kind[id] === BALL_KIND;
    const x = frame.x + (world.x[id] as number) * sx;
    const y = frame.y + (world.y[id] as number) * sy;

    if (isBall) {
      // The ball is a ring with a dot in it — the only mark on the map drawn twice, because it is
      // the only one you look for rather than scan for.
      ctx.fillStyle = theme.text;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    const side = options.sides?.get(id) ?? (world.team[id] as Side);
    ctx.fillStyle = side === 1 ? theme.teams[1] : theme.teams[0];
    ctx.beginPath();
    ctx.arc(x, y, id === controlled ? 3.5 : 2, 0, Math.PI * 2);
    ctx.fill();

    // The controlled athlete gets a ring — a shape, not a shade (INV-11).
    if (id === controlled) {
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}
