/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
 * @story   US-2.3 — See the whole field on a small screen
 * @story   US-13.4 — Tell the two teams apart without relying on colour
 * @design  13-visual-overhaul.md §2.2 (kit tinting), §3.1 (athlete sheet), 10-ui-ux.md §3.1, §11
 * @invariant INV-2 (no unseeded randomness), INV-8 (determinism), INV-11 (never colour alone)
 *
 * Purpose: turns a team's kit — a fill, an ink, and a pattern name — into the two things
 * `buildAtlas` needs: a palette that binds the reserved `KIT` characters, and a kit sheet whose
 * pattern regions have been resolved into *geometry* for that pattern.
 *
 * **Why the pattern is resolved into the grid rather than into the palette.** An art file authors
 * one kit layer per frame and marks the whole shirt as a pattern region (`P`); which of those
 * pixels are actually inked is a property of the *kit*, not of the drawing — a striped away kit and
 * a solid home kit share every frame in the repository. Resolving it here means one authored sheet
 * serves all four patterns, and the atlas still comes out fully baked, so an athlete costs one
 * `drawImage` (§2.2).
 *
 * **Why a stripe is a shape and not a second colour.** `10` §11 and Gate 13: team identity has to
 * survive protanopia, deuteranopia and tritanopia. Two hues of the same lightness are the exact
 * failure mode, so `patternInk` guarantees the pattern differs from the fill in *luminance* by at
 * least `PATTERN_CONTRAST`, deriving a shade of its own when a team's own ink is too close.
 *
 * **Why the bands are measured from the anchor.** Three of the eight facings are drawn mirrored
 * about the anchor (`13` §3.1), so a stripe keyed to anything else would jump sideways the moment
 * an athlete turned west. Vertical bands are keyed to distance from the anchor's column, which is
 * invariant under that flip; horizontal bands and halves are keyed to the region's own extent,
 * which a horizontal flip cannot move.
 *
 * Pure and clock-free: same kit in, same sheet and palette out, every build (INV-8).
 */
import {
  KIT,
  paletteFrom,
  parseColour,
  type Palette,
  type SpriteGrid,
  type SpriteSheet,
} from './atlas.ts';

/** The kit patterns `10` §3.1 names. Authored once as `P` regions; resolved here per kit. */
export const KIT_PATTERNS = ['solid', 'stripes', 'hoops', 'halves'] as const;
export type KitPattern = (typeof KIT_PATTERNS)[number];

export interface KitSpec {
  /** The team colour. */
  readonly fill: string;
  /** The marking ink — the existing `TeamPalette.onFill` vocabulary from each sport's `art.ts`. */
  readonly onFill: string;
  readonly pattern: KitPattern;
}

/**
 * The floor for how far the pattern must sit from the fill in luminance contrast. Low on purpose:
 * this is "two tones of one kit", not "text on a background", and anything above about 3:1 stops
 * reading as one shirt. It is enough that a greyscale — which is what the three colour-vision
 * simulations approximate for the worst case — still shows the geometry.
 */
export const PATTERN_CONTRAST = 1.5;

/** Vertical band width in sprite px, and horizontal band height. Tuned against the 32×48 frame. */
const STRIPE_WIDTH = 3;
const HOOP_HEIGHT = 4;

/** WCAG relative luminance of a `#rgb` / `#rrggbb` / `#rrggbbaa` colour. Alpha is ignored. */
export function relativeLuminance(colour: string): number {
  const [r, g, b] = parseColour(colour);
  const channel = (byte: number): number => {
    const c = byte / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1:1 to 21:1. Symmetric. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mixes `colour` toward `target` by `amount` (0–1) and returns `#rrggbb`. */
function mix(colour: string, target: string, amount: number): string {
  const from = parseColour(colour);
  const to = parseColour(target);
  const byte = (i: number): string => {
    const value = Math.round((from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * amount);
    return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
  };
  return `#${byte(0)}${byte(1)}${byte(2)}`;
}

/**
 * The colour a pattern region is inked in.
 *
 * A team's own `onFill` is used when it is already far enough from the fill in luminance, so a kit
 * looks like the sport's palette designed it. When it is not — a pale ink on a pale fill — the
 * shade is derived by walking the fill toward black or white, whichever direction has room, until
 * it clears `PATTERN_CONTRAST`. Deriving rather than falling back to a fixed grey keeps the kit
 * recognisably the team's own colour while making the geometry survive a greyscale.
 */
export function patternInk(fill: string, onFill: string): string {
  if (contrastRatio(fill, onFill) >= PATTERN_CONTRAST) return onFill;

  // Dark fills have headroom upward, light fills downward. A fill in the middle has both; going
  // darker is the safer read on a bright field, so the test is a light one.
  const target = relativeLuminance(fill) > 0.4 ? '#000000' : '#ffffff';
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(fill, target, step * 0.05);
    if (contrastRatio(fill, candidate) >= PATTERN_CONTRAST) return candidate;
  }
  return target;
}

/**
 * The palette for an athlete's `kit` layer: the three reserved characters bound to this kit.
 * `extra` is for whatever else the layer's art uses — the athlete sheet's outline index, which is
 * shared with the body layer underneath it.
 */
export function kitPalette(
  kit: KitSpec,
  extra: Readonly<Record<string, string | null>> = {},
): Palette {
  return paletteFrom({
    [KIT.fill]: kit.fill,
    [KIT.ink]: kit.onFill,
    // A solid kit has no pattern to draw; `tintKitSheet` has already turned its `P` pixels into
    // fill, so this entry only matters for the frames a pattern kit keeps.
    [KIT.pattern]: kit.pattern === 'solid' ? kit.fill : patternInk(kit.fill, kit.onFill),
    ...extra,
  });
}

/** The rows and columns one grid's pattern region actually occupies. `null` when it has none. */
function patternBounds(grid: SpriteGrid): { top: number; bottom: number } | null {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < grid.rows.length; y++) {
    if ((grid.rows[y] ?? '').includes(KIT.pattern)) {
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return bottom < top ? null : { top, bottom };
}

/**
 * Whether the pattern inks the pixel at `(x, y)` of this grid, for this pattern.
 *
 * Exported because the tests assert the geometry directly — that a stripe survives the mirror, and
 * that hoops and halves band the region rather than the frame.
 */
export function patternMask(
  pattern: KitPattern,
  grid: SpriteGrid,
  x: number,
  y: number,
  bounds: { top: number; bottom: number },
): boolean {
  switch (pattern) {
    case 'solid':
      return false;
    // Distance from the anchor's column, so the flip that draws W from E maps a stripe onto a
    // stripe rather than into the gap between two.
    case 'stripes':
      return Math.floor(Math.abs(x - grid.ax + 0.5) / STRIPE_WIDTH) % 2 === 0;
    case 'hoops':
      return Math.floor((y - bounds.top) / HOOP_HEIGHT) % 2 === 0;
    // Upper body inked, lower body plain — never left/right, which a mirrored facing would swap.
    case 'halves':
      return y - bounds.top <= (bounds.bottom - bounds.top) / 2;
  }
}

/**
 * Resolves one authored kit frame's pattern regions for a pattern: every `P` pixel becomes either
 * the pattern ink it was authored as, or the team's fill.
 */
export function tintKitGrid(grid: SpriteGrid, pattern: KitPattern): SpriteGrid {
  const bounds = patternBounds(grid);
  if (bounds === null) return grid;

  const rows = grid.rows.map((row, y) => {
    if (!row.includes(KIT.pattern)) return row;
    let out = '';
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as string;
      out += ch === KIT.pattern && !patternMask(pattern, grid, x, y, bounds) ? KIT.fill : ch;
    }
    return out;
  });

  return { ...grid, rows };
}

/**
 * The authored kit sheet, resolved for one kit's pattern. Called once per atlas build — twice a
 * match, plus once more if the theme changes — never per frame.
 */
export function tintKitSheet(sheet: SpriteSheet, pattern: KitPattern): SpriteSheet {
  const out: Record<string, readonly SpriteGrid[]> = {};
  for (const [key, frames] of Object.entries(sheet)) {
    out[key] = frames.map((grid) => tintKitGrid(grid, pattern));
  }
  return out;
}
