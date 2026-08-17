/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.4 — Ball rendering with height, spin, and a shadow that reads as altitude
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §3.2 (ball, fields, dressing), src/art/README.md (authoring format)
 * @invariant INV-2 (no unseeded randomness), INV-8 (determinism)
 *
 * Purpose: the basketball's authored spin sheet — 8×8, four frames, the seam lines rotating through
 * them — and the palette that binds its two authored characters to this sport's ball colours.
 *
 * The ball has one skin, not two kits, so unlike an athlete pose file there is no `body`/`kit` split
 * here: one layer, one sheet, bound directly to `BasketballPalette.ball` / `.ballSeam` (`art.ts`) so
 * the sprite ball and the disc ball it falls back to never disagree about colour.
 */
import {
  paletteFrom,
  type Palette,
  type SpriteGrid,
  type SpriteSheet,
} from '../../engine/render/atlas.ts';

/** `13` §3.2: the ball is 8×8, anchored at its centre — a ball's anchor is its centre, not its feet. */
export const BASKETBALL_BALL_FRAME = { w: 8, h: 8, ax: 4, ay: 4 } as const;

/**
 * Four frames of one spin cycle. The seam cross (`2`) is always visible — a basketball shows some
 * seam from any angle — and one seam segment (also `2`) orbits the centre a quarter turn per frame,
 * so the four frames read as the ball turning over rather than four unrelated poses.
 */
const FRAME_0: SpriteGrid = {
  ...BASKETBALL_BALL_FRAME,
  rows: [
    '..1111..',
    '.112211.',
    '11122211',
    '12222221',
    '12222221',
    '11122111',
    '.112211.',
    '..1111..',
  ],
};

const FRAME_1: SpriteGrid = {
  ...BASKETBALL_BALL_FRAME,
  rows: [
    '..1111..',
    '.112211.',
    '11222111',
    '12222221',
    '12222221',
    '11122111',
    '.112211.',
    '..1111..',
  ],
};

const FRAME_2: SpriteGrid = {
  ...BASKETBALL_BALL_FRAME,
  rows: [
    '..1111..',
    '.112211.',
    '11122111',
    '12222221',
    '12222221',
    '11222111',
    '.112211.',
    '..1111..',
  ],
};

const FRAME_3: SpriteGrid = {
  ...BASKETBALL_BALL_FRAME,
  rows: [
    '..1111..',
    '.112211.',
    '11122111',
    '12222221',
    '12222221',
    '11122211',
    '.112211.',
    '..1111..',
  ],
};

/** The ball has no facings, so its sheet key is the bare pose name (`src/art/README.md` §5). */
export const BASKETBALL_BALL: SpriteSheet = {
  spin: [FRAME_0, FRAME_1, FRAME_2, FRAME_3],
};

export interface BasketballBallColors {
  readonly ball: string;
  readonly seam: string;
}

/** Binds the sheet's two authored characters to this theme's ball colours (`BasketballPalette`). */
export function basketballBallPalette(colors: BasketballBallColors): Palette {
  return paletteFrom({ '1': colors.ball, '2': colors.seam });
}
