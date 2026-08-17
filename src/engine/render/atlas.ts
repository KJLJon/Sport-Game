/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.2 — Asset pipeline: authored source → packed atlas → typed accessors
 * @story   US-1.3 — Keep everything inside the repository path
 * @design  13-visual-overhaul.md §2.1 (interfaces), §3 (the art itself), 07-decisions.md D-24
 * @invariant INV-2 (no unseeded randomness), INV-4 (no runtime network), INV-8 (determinism)
 *
 * Purpose: turns authored pixel grids — text, in TypeScript modules, in this repository — into one
 * packed off-screen atlas per (sheet × palette), and hands the renderer a frame lookup by key.
 *
 * **Why text grids and not image files** (D-24). There is no fetch, no decode, and no new build
 * step: art is ordinary code-split JS, so the service worker precaches it like everything else and
 * INV-4 holds by construction rather than by audit. The rasteriser is a pure function over strings,
 * so every frame is testable in node with no canvas anywhere near it, and a frame's diff in review
 * is the picture.
 *
 * **Why the tinting happens here rather than per draw.** A team's kit colours are bound to reserved
 * palette indices (`KIT`) at rasterise time, so an atlas comes out of `buildAtlas` fully baked —
 * one per team kit per theme, built once at match load. The per-frame cost of an athlete is then a
 * single `drawImage` of a pre-composited sprite, which is the cheapest thing a 2D canvas does, and
 * is what holds the `12` §6 frame budget at 22 entities (verified by T-13.9).
 *
 * Nothing here reads a clock or a random number: same grids and same palette, same bytes.
 */
import type { Canvas2D, OffscreenFactory } from './renderer.ts';

/** One authored frame: rows of palette indices. '.' = transparent, the rest index the palette. */
export interface SpriteGrid {
  /** Frame width in px (32 for athletes, `13` §3.1). */
  readonly w: number;
  /** Frame height in px (48 for athletes). */
  readonly h: number;
  /** Anchor x, px — where the feet touch the ground. */
  readonly ax: number;
  /** Anchor y, px. */
  readonly ay: number;
  /** `h` strings of length `w`. */
  readonly rows: readonly string[];
}

/**
 * A named animation: pose key → ordered frames. The key is `pose/facing` (see `poseKey`) for
 * directional art, or a bare name for art that does not turn, like the ball.
 */
export type SpriteSheet = Readonly<Record<string, readonly SpriteGrid[]>>;

/** A palette: index → `#rgb` / `#rrggbb` / `#rrggbbaa`, or `null` for "authored, draws nothing". */
export type Palette = readonly (string | null | undefined)[];

/** Facings: 8 compass directions. 0 = +x (east), counter-clockwise: 1=NE, 2=N … 7=SE. */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The five facings that are drawn by hand; W/NW/SW are these mirrored (`13` §3.1). */
export const AUTHORED_FACINGS = [0, 1, 2, 6, 7] as const satisfies readonly Facing[];

/**
 * Reserved palette characters on an athlete's `kit` layer (`13` §2.2). `buildAtlas` is called once
 * per team kit with these three bound to that kit's colours; every other index is shared.
 */
export const KIT = {
  /** The team colour. */
  fill: 'K',
  /** The ink kit markings draw in — numbers, collar, trim. */
  ink: 'k',
  /** The pattern region: stripes, hoops, halves are authored as *geometry* here, so team identity
   *  survives a colour-vision simulation (`10` §11, Gate 13). */
  pattern: 'P',
} as const;

/** Where one frame sits inside the packed atlas image, and where its anchor is within it. */
export interface AtlasFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly ax: number;
  readonly ay: number;
}

/** A packed atlas: one off-screen canvas, frame lookup by key. */
export interface SpriteAtlas {
  readonly image: CanvasImageSource;
  /** Key: `${pose}/${authoredFacing}/${frameIndex}` — see `frameKey`. */
  readonly frames: ReadonlyMap<string, AtlasFrame>;
  readonly width: number;
  readonly height: number;
}

export interface AtlasOptions {
  /** Shelf-packing width in px. Kept small enough for the oldest GPUs we care about. */
  readonly maxWidth?: number;
  /** Transparent gutter between frames, so a scaled blit cannot sample its neighbour. */
  readonly padding?: number;
}

const DEFAULT_MAX_WIDTH = 512;
const DEFAULT_PADDING = 1;

/** The sheet key for a directional pose. Non-directional art uses the bare pose name. */
export function poseKey(pose: string, facing: Facing): string {
  return `${pose}/${facing}`;
}

/** The atlas key for one frame of one pose. */
export function frameKey(pose: string, facing: Facing, index: number): string {
  return `${poseKey(pose, facing)}/${index}`;
}

/**
 * Palette index for an authored character. '.' is transparent (-1); '0'–'9' are 0–9, 'a'–'z' are
 * 10–35, 'A'–'Z' are 36–61 — 62 slots, which is more than any sheet has needed and leaves the
 * uppercase range free for the reserved `KIT` characters.
 */
export function paletteIndex(ch: string): number {
  if (ch === '.') return -1;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // '0'–'9'
  if (code >= 97 && code <= 122) return code - 97 + 10; // 'a'–'z'
  if (code >= 65 && code <= 90) return code - 65 + 36; // 'A'–'Z'
  throw new Error(`sprite grid: '${ch}' is not a palette character ('.', 0-9, a-z, A-Z)`);
}

/**
 * Builds the indexed palette an art module actually authors: a map from the character used in the
 * grid to its colour. Sparse by nature — writing `{ '1': '#eec', K: null }` is readable, writing
 * an array with a hole at index 46 is not.
 */
export function paletteFrom(map: Readonly<Record<string, string | null>>): Palette {
  const palette: (string | null | undefined)[] = [];
  for (const [ch, colour] of Object.entries(map)) {
    if (ch.length !== 1) throw new Error(`palette: '${ch}' is not a single character`);
    palette[paletteIndex(ch)] = colour;
  }
  return palette;
}

/**
 * `#rgb`, `#rrggbb`, `#rrggbbaa` → RGBA bytes. Throws on anything else, at build time, loudly.
 *
 * Exported for `tint.ts` (T-13.3), which measures the luminance contrast between a kit's fill and
 * its pattern in the same colour space the rasteriser will paint them in.
 */
export function parseColour(colour: string): [number, number, number, number] {
  const hex = colour.startsWith('#') ? colour.slice(1) : '';
  const valid = /^[0-9a-fA-F]+$/.test(hex);

  if (valid && hex.length === 3) {
    const [r, g, b] = [...hex].map((c) => Number.parseInt(c + c, 16));
    return [r ?? 0, g ?? 0, b ?? 0, 255];
  }
  if (valid && (hex.length === 6 || hex.length === 8)) {
    const byte = (i: number) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return [byte(0), byte(1), byte(2), hex.length === 8 ? byte(3) : 255];
  }
  throw new Error(`palette: '${colour}' is not #rgb, #rrggbb or #rrggbbaa`);
}

/**
 * Pure rasteriser: grid + palette → RGBA bytes, row-major, `w * h * 4` long.
 *
 * Every failure an art file can have is caught here rather than shown as a hole in a sprite: a row
 * of the wrong length, the wrong number of rows, a character with no palette entry.
 */
export function rasterise(grid: SpriteGrid, palette: Palette): Uint8ClampedArray {
  const { w, h, rows } = grid;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error(`sprite grid: size ${w}×${h} is not a positive integer size`);
  }
  if (rows.length !== h) {
    throw new Error(`sprite grid: ${rows.length} rows authored, ${h} declared`);
  }

  const out = new Uint8ClampedArray(w * h * 4);
  const cache = new Map<number, [number, number, number, number]>();

  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? '';
    if (row.length !== w) {
      throw new Error(`sprite grid: row ${y} is ${row.length} chars, width is ${w}`);
    }

    for (let x = 0; x < w; x++) {
      const index = paletteIndex(row[x] ?? '.');
      if (index < 0) continue;

      let rgba = cache.get(index);
      if (rgba === undefined) {
        const colour = palette[index];
        if (colour === undefined) {
          throw new Error(`sprite grid: '${row[x]}' (index ${index}) has no palette entry`);
        }
        if (colour === null) continue;
        rgba = parseColour(colour);
        cache.set(index, rgba);
      }

      const at = (y * w + x) * 4;
      out[at] = rgba[0];
      out[at + 1] = rgba[1];
      out[at + 2] = rgba[2];
      out[at + 3] = rgba[3];
    }
  }

  return out;
}

/** Source-over composite of one layer's bytes onto the accumulating frame. */
function over(dst: Uint8ClampedArray, src: Uint8ClampedArray): void {
  for (let i = 0; i < dst.length; i += 4) {
    const sa = (src[i + 3] ?? 0) / 255;
    if (sa === 0) continue;
    if (sa === 1) {
      dst[i] = src[i] ?? 0;
      dst[i + 1] = src[i + 1] ?? 0;
      dst[i + 2] = src[i + 2] ?? 0;
      dst[i + 3] = 255;
      continue;
    }
    const da = (dst[i + 3] ?? 0) / 255;
    const oa = sa + da * (1 - sa);
    for (let c = 0; c < 3; c++) {
      const s = (src[i + c] ?? 0) * sa;
      const d = (dst[i + c] ?? 0) * da * (1 - sa);
      dst[i + c] = oa === 0 ? 0 : (s + d) / oa;
    }
    dst[i + 3] = oa * 255;
  }
}

/**
 * Rasterises every frame of every layer into one atlas. Called once per (sheet × palette) — at
 * match load for each team's kit, and again if the theme changes.
 *
 * `sheets` is layer name → sheet, composited in the object's own key order (`body`, then `kit`,
 * then any `prop`); `palettes` binds each layer's characters, which is where a kit's colours enter.
 */
export function buildAtlas(
  sheets: Readonly<Record<string, SpriteSheet>>,
  palettes: Readonly<Record<string, Palette>>,
  createOffscreen: OffscreenFactory,
  options: AtlasOptions = {},
): SpriteAtlas {
  const padding = options.padding ?? DEFAULT_PADDING;
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  const layers = Object.keys(sheets);

  // Every frame the union of layers defines, in a fixed order: first appearance wins, so an atlas
  // packs the same way every time it is built. Determinism here is what makes T-13.12's snapshots
  // and T-13.9's command counts mean anything.
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const layer of layers) {
    for (const [pose, frames] of Object.entries(sheets[layer] ?? {})) {
      for (let i = 0; i < frames.length; i++) {
        const key = `${pose}/${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
      }
    }
  }

  const composited = new Map<string, { grid: SpriteGrid; bytes: Uint8ClampedArray }>();
  for (const key of keys) {
    const slash = key.lastIndexOf('/');
    const pose = key.slice(0, slash);
    const index = Number(key.slice(slash + 1));

    let grid: SpriteGrid | null = null;
    let bytes: Uint8ClampedArray | null = null;

    for (const layer of layers) {
      const frame = sheets[layer]?.[pose]?.[index];
      if (frame === undefined) continue;

      const palette = palettes[layer];
      if (palette === undefined) throw new Error(`atlas: layer '${layer}' has no palette`);

      if (grid === null) {
        grid = frame;
        bytes = rasterise(frame, palette);
        continue;
      }
      if (
        frame.w !== grid.w ||
        frame.h !== grid.h ||
        frame.ax !== grid.ax ||
        frame.ay !== grid.ay
      ) {
        throw new Error(
          `atlas: layer '${layer}' frame '${key}' disagrees with the layers under it`,
        );
      }
      over(bytes as Uint8ClampedArray, rasterise(frame, palette));
    }

    if (grid !== null && bytes !== null) composited.set(key, { grid, bytes });
  }

  // Shelf packing. Frames are all one size within a sheet, so a shelf is a row of frames and the
  // arithmetic stays a line of code rather than a bin-packing library that never earns its bytes.
  const frames = new Map<string, AtlasFrame>();
  let shelfX = padding;
  let shelfY = padding;
  let shelfH = 0;
  let width = 0;

  for (const [key, { grid }] of composited) {
    if (shelfX + grid.w + padding > maxWidth && shelfX > padding) {
      shelfX = padding;
      shelfY += shelfH + padding;
      shelfH = 0;
    }
    frames.set(key, { x: shelfX, y: shelfY, w: grid.w, h: grid.h, ax: grid.ax, ay: grid.ay });
    shelfX += grid.w + padding;
    shelfH = Math.max(shelfH, grid.h);
    width = Math.max(width, shelfX);
  }

  const height = shelfY + shelfH + padding;
  const layer = createOffscreen(Math.max(width, 1), Math.max(height, 1));

  for (const [key, { bytes }] of composited) {
    const frame = frames.get(key);
    if (frame === undefined) continue;
    const image = layer.ctx.createImageData(frame.w, frame.h);
    image.data.set(bytes);
    layer.ctx.putImageData(image, frame.x, frame.y);
  }

  return {
    image: layer.canvas,
    frames,
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
}

/**
 * Facing from a velocity. `previous` is held through the boundary between two facings by
 * `HYSTERESIS` of a sector, so an athlete jittering along a diagonal doesn't strobe between two
 * sprites — and held entirely when they are barely moving, because a velocity of nearly zero has
 * no direction worth believing.
 */
const HYSTERESIS = 0.2;
const STILL = 1e-4;

export function facingOf(vx: number, vy: number, previous: Facing): Facing {
  if (!Number.isFinite(vx) || !Number.isFinite(vy)) return previous;
  if (Math.abs(vx) < STILL && Math.abs(vy) < STILL) return previous;

  // Screen/world y grows downwards, so north is -y: negate to measure counter-clockwise from east.
  const sector = (Math.atan2(-vy, vx) / (Math.PI / 4) + 8) % 8;

  let delta = sector - previous;
  if (delta > 4) delta -= 8;
  if (delta < -4) delta += 8;
  if (Math.abs(delta) <= 0.5 + HYSTERESIS) return previous;

  return (Math.round(sector) % 8) as Facing;
}

/** Only E, NE, N, S, SE are authored; W, NW, SW mirror NE, E, SE about the anchor (`13` §3.1). */
export function authoredFacing(f: Facing): { facing: Facing; mirrored: boolean } {
  switch (f) {
    case 3:
      return { facing: 1, mirrored: true };
    case 4:
      return { facing: 0, mirrored: true };
    case 5:
      return { facing: 7, mirrored: true };
    default:
      return { facing: f, mirrored: false };
  }
}

export interface SpriteDraw {
  /** Where the anchor — the feet — lands, in the caller's current transform. */
  readonly x: number;
  readonly y: number;
  /** Units per sprite pixel. The sprite renderer draws in world units, so this is usually small. */
  readonly scale?: number;
  /** Draws the frame flipped about its anchor, for the three mirrored facings. */
  readonly mirrored?: boolean;
  readonly alpha?: number;
}

/**
 * Blits one frame with its anchor at `(x, y)`. Returns `false` for a key the atlas doesn't hold,
 * rather than throwing inside a render loop — T-13.7's property test is where a missing pose is
 * supposed to fail, not the fourth minute of a match.
 */
export function drawSprite(
  ctx: Canvas2D,
  atlas: SpriteAtlas,
  key: string,
  at: SpriteDraw,
): boolean {
  const frame = atlas.frames.get(key);
  if (frame === undefined) return false;

  const scale = at.scale ?? 1;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(at.mirrored === true ? -scale : scale, scale);
  if (at.alpha !== undefined) ctx.globalAlpha = at.alpha;
  ctx.drawImage(
    atlas.image,
    frame.x,
    frame.y,
    frame.w,
    frame.h,
    -frame.ax,
    -frame.ay,
    frame.w,
    frame.h,
  );
  ctx.restore();
  return true;
}
