/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.4 — Ball rendering with height, spin, and a shadow that reads as altitude
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §3.2 (ball, fields, dressing), src/art/README.md (authoring format)
 * @invariant INV-2 (no unseeded randomness), INV-8 (determinism)
 *
 * Purpose: the football's authored spin sheet — 8×8, four frames, its dark panels rotating through
 * them — and the palette that binds its two authored characters to this sport's ball colours.
 *
 * Deliberately **no seam line** — `art.ts`'s disc ball carries the same note: a seam is what made
 * the borrowed basketball read as the wrong ball, so the panels here are isolated blobs, never a
 * cross through the centre.
 */
import {
  paletteFrom,
  type Palette,
  type SpriteGrid,
  type SpriteSheet,
} from '../../engine/render/atlas.ts';

/** `13` §3.2: the ball is 8×8, anchored at its centre — a ball's anchor is its centre, not its feet. */
export const SOCCER_BALL_FRAME = { w: 8, h: 8, ax: 4, ay: 4 } as const;

/**
 * Four frames of one spin cycle. Two panel blobs (`2`) chase each other a quarter turn round the
 * ball each frame, so the sequence reads as panels rotating rather than four unrelated marks.
 */
const FRAME_0: SpriteGrid = {
  ...SOCCER_BALL_FRAME,
  rows: [
    '..1111..',
    '.111111.',
    '11211211',
    '11111111',
    '11111111',
    '11111111',
    '.111111.',
    '..1111..',
  ],
};

const FRAME_1: SpriteGrid = {
  ...SOCCER_BALL_FRAME,
  rows: [
    '..1111..',
    '.111111.',
    '11211111',
    '11111111',
    '11111111',
    '11211111',
    '.111111.',
    '..1111..',
  ],
};

const FRAME_2: SpriteGrid = {
  ...SOCCER_BALL_FRAME,
  rows: [
    '..1111..',
    '.111111.',
    '11111111',
    '11111111',
    '11111111',
    '11211211',
    '.111111.',
    '..1111..',
  ],
};

const FRAME_3: SpriteGrid = {
  ...SOCCER_BALL_FRAME,
  rows: [
    '..1111..',
    '.111111.',
    '11111211',
    '11111111',
    '11111111',
    '11111211',
    '.111111.',
    '..1111..',
  ],
};

/** The ball has no facings, so its sheet key is the bare pose name (`src/art/README.md` §5). */
export const SOCCER_BALL: SpriteSheet = {
  spin: [FRAME_0, FRAME_1, FRAME_2, FRAME_3],
};

export interface SoccerBallColors {
  readonly ball: string;
  readonly panel: string;
}

/** Binds the sheet's two authored characters to this theme's ball colours (`SoccerPalette`). */
export function soccerBallPalette(colors: SoccerBallColors): Palette {
  return paletteFrom({ '1': colors.ball, '2': colors.panel });
}
