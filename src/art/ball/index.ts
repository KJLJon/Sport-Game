/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.4 — Ball rendering with height, spin, and a shadow that reads as altitude
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §3.2 (ball, fields, dressing), src/art/athlete/index.ts (the
 *          pattern this mirrors)
 * @invariant INV-2 (no unseeded randomness), INV-8 (determinism)
 *
 * Purpose: mirrors `art/athlete/index.ts` for the ball — one place that knows how a sport's
 * authored spin sheet and palette become the one atlas its renderer blits from.
 *
 * **Why this is thinner than the athlete builder.** An athlete atlas is rebuilt once per team kit
 * because the `kit` layer's `K`/`k`/`P` characters are tinted per team (`tint.ts`). The ball has one
 * skin, not two — there is no second team to tint for — so `buildBallAtlas` is `buildAtlas` with a
 * single untinted layer, built once per (sport × theme) at match load, exactly like the athlete
 * atlas and never per frame.
 */
import {
  buildAtlas,
  type Palette,
  type SpriteAtlas,
  type SpriteSheet,
} from '../../engine/render/atlas.ts';
import type { OffscreenFactory } from '../../engine/render/renderer.ts';

/** The ball's sheet key (`src/art/README.md` §5): a bare name, because the ball never turns. */
export const BALL_ANIM_KEY = 'spin';

export {
  BASKETBALL_BALL,
  BASKETBALL_BALL_FRAME,
  basketballBallPalette,
  type BasketballBallColors,
} from './basketball.ts';
export {
  SOCCER_BALL,
  SOCCER_BALL_FRAME,
  soccerBallPalette,
  type SoccerBallColors,
} from './soccer.ts';

/**
 * Builds one sport's ball atlas from its authored sheet and palette. Called once at match load,
 * beside the team atlases (`13` §2.2) — never per frame, and never per ball, since a match only
 * ever has one.
 */
export function buildBallAtlas(
  sheet: SpriteSheet,
  palette: Palette,
  createOffscreen: OffscreenFactory,
): SpriteAtlas {
  return buildAtlas({ ball: sheet }, { ball: palette }, createOffscreen);
}
