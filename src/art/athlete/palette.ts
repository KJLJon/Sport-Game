/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.2 — Asset pipeline: authored source → packed atlas → typed accessors
 * @story   US-1.3 — Keep everything inside the repository path
 * @design  13-visual-overhaul.md §2.2 (kit tinting), §3.1 (athlete sheet), 10-ui-ux.md §3.1
 *
 * Purpose: the two palettes an athlete frame is rasterised with — the shared body palette, and a
 * per-team kit palette built from that team's colours.
 *
 * The characters here are the contract between an art file and the rasteriser: `src/art/README.md`
 * §2–3 documents them, and changing one means re-reading every pose file, so they are named
 * constants rather than a table anyone can extend by accident.
 *
 * T-13.3 owns `engine/render/tint.ts` and the `KitSpec`/pattern-geometry work that sits on top of
 * this; what lives here is only the palette binding the pipeline needs to build an atlas at all.
 */
import { paletteFrom, type Palette } from '../../engine/render/atlas.ts';
import { kitPalette as tintPalette, type KitSpec } from '../../engine/render/tint.ts';

/**
 * Shared across every athlete, every sport. Skin and hair are one tone each for now — T-13.3
 * binds them per athlete, and the only change that needs is a second argument here, because the
 * atlas is rebuilt per (sheet × palette) anyway.
 */
export const ATHLETE_BODY_PALETTE: Palette = paletteFrom({
  '1': '#c98a5e', // skin
  '2': '#96643f', // skin in shade, and the torso under the jersey
  '3': '#2b2118', // hair
  '4': '#e9eaee', // shoe
  '5': '#14161a', // outline — darker than any court or pitch in either theme
  '6': '#f4f5f7', // sock
});

/** The outline, shared with the body layer so a kit edge reads against the fill either way. */
export const OUTLINE = '#14161a';

/**
 * A team's kit palette. `fill` and `onFill` come from the sport's existing `TeamPalette`, so the
 * sprite renderer and the disc renderer agree on which side is which colour without a second source
 * of team colour anywhere.
 *
 * The pattern ink is `tint.ts`'s (T-13.3): a *shape* in a tone far enough from the fill to survive
 * a greyscale, because a pattern that differed from the fill only in hue would be exactly the
 * failure Gate 13 checks for (`10` §11).
 */
export function kitPalette(kit: KitSpec): Palette {
  return tintPalette(kit, { '5': OUTLINE });
}
