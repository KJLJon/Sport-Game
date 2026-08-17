/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.2 — Asset pipeline: authored source → packed atlas → typed accessors
 * @story   US-1.3 — Keep everything inside the repository path
 * @design  13-visual-overhaul.md §2.1, §3.1
 *
 * Purpose: the rasteriser is pixel-exact against grids small enough to read in the assertion, the
 * atlas packs and keys frames the way the renderer looks them up, and every grid actually authored
 * in `src/art/**` is well-formed — the property that stops a mistyped row reaching a match.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  AUTHORED_FACINGS,
  KIT,
  authoredFacing,
  buildAtlas,
  drawSprite,
  facingOf,
  frameKey,
  paletteFrom,
  paletteIndex,
  poseKey,
  rasterise,
  type Facing,
  type Palette,
  type SpriteGrid,
  type SpriteSheet,
} from '@/engine/render/atlas.ts';
import type { OffscreenFactory, OffscreenLayer } from '@/engine/render/renderer.ts';
import { recordingCanvas, type RecordingCanvas } from '../../helpers/canvas.ts';
import { ATHLETE_BODY, ATHLETE_KIT, buildAthleteAtlas, mergeSheets } from '@/art/athlete/index.ts';
import { ATHLETE_BODY_PALETTE, kitPalette } from '@/art/athlete/palette.ts';

/** A 2×2 grid: one red pixel, one transparent, one from a `null` slot, one from a hex with alpha. */
const TINY: SpriteGrid = {
  w: 2,
  h: 2,
  ax: 1,
  ay: 1,
  rows: ['1.', '23'],
};

const TINY_PALETTE: Palette = paletteFrom({
  '1': '#ff0000',
  '2': null,
  '3': '#0000ff80',
});

function offscreen(): { factory: OffscreenFactory; layers: RecordingCanvas[] } {
  const layers: RecordingCanvas[] = [];
  const factory: OffscreenFactory = (width, height) => {
    const ctx = recordingCanvas();
    layers.push(ctx);
    return { canvas: {} as CanvasImageSource, ctx, width, height } as OffscreenLayer;
  };
  return { factory, layers };
}

describe('palette characters', () => {
  it('maps digits, lower case and upper case into one 62-slot space', () => {
    expect(paletteIndex('.')).toBe(-1);
    expect(paletteIndex('0')).toBe(0);
    expect(paletteIndex('9')).toBe(9);
    expect(paletteIndex('a')).toBe(10);
    expect(paletteIndex('z')).toBe(35);
    expect(paletteIndex('A')).toBe(36);
    expect(paletteIndex('Z')).toBe(61);
  });

  it('rejects a character that is not a palette index', () => {
    expect(() => paletteIndex('#')).toThrow(/not a palette character/);
  });

  it('gives the reserved kit characters distinct slots', () => {
    const indices = [KIT.fill, KIT.ink, KIT.pattern].map(paletteIndex);
    expect(new Set(indices).size).toBe(3);
  });

  it('builds a sparse palette from a character map', () => {
    const palette = paletteFrom({ '1': '#fff', K: '#000' });
    expect(palette[1]).toBe('#fff');
    expect(palette[paletteIndex('K')]).toBe('#000');
    expect(palette[2]).toBeUndefined();
  });

  it('rejects a multi-character palette key', () => {
    expect(() => paletteFrom({ ab: '#fff' })).toThrow(/single character/);
  });
});

describe('rasterise', () => {
  it('writes RGBA row-major, transparent where the grid is', () => {
    const bytes = rasterise(TINY, TINY_PALETTE);

    expect(bytes.length).toBe(2 * 2 * 4);
    expect([...bytes.slice(0, 4)]).toEqual([255, 0, 0, 255]); // '1'
    expect([...bytes.slice(4, 8)]).toEqual([0, 0, 0, 0]); // '.'
    expect([...bytes.slice(8, 12)]).toEqual([0, 0, 0, 0]); // '2' → null
    expect([...bytes.slice(12, 16)]).toEqual([0, 0, 255, 128]); // '3' → #0000ff80
  });

  it('expands #rgb shorthand', () => {
    const bytes = rasterise(
      { w: 1, h: 1, ax: 0, ay: 0, rows: ['1'] },
      paletteFrom({ '1': '#4a8' }),
    );
    expect([...bytes]).toEqual([0x44, 0xaa, 0x88, 255]);
  });

  it('rejects a row of the wrong length', () => {
    const grid: SpriteGrid = { w: 2, h: 1, ax: 0, ay: 0, rows: ['111'] };
    expect(() => rasterise(grid, TINY_PALETTE)).toThrow(/row 0 is 3 chars/);
  });

  it('rejects the wrong number of rows', () => {
    const grid: SpriteGrid = { w: 1, h: 2, ax: 0, ay: 0, rows: ['1'] };
    expect(() => rasterise(grid, TINY_PALETTE)).toThrow(/1 rows authored, 2 declared/);
  });

  it('rejects a character with no palette entry', () => {
    const grid: SpriteGrid = { w: 1, h: 1, ax: 0, ay: 0, rows: ['7'] };
    expect(() => rasterise(grid, TINY_PALETTE)).toThrow(/has no palette entry/);
  });

  it('rejects a malformed colour', () => {
    const grid: SpriteGrid = { w: 1, h: 1, ax: 0, ay: 0, rows: ['1'] };
    expect(() => rasterise(grid, paletteFrom({ '1': 'red' }))).toThrow(/is not #rgb/);
  });

  it('rejects a nonsense frame size', () => {
    const grid: SpriteGrid = { w: 0, h: 1, ax: 0, ay: 0, rows: [''] };
    expect(() => rasterise(grid, TINY_PALETTE)).toThrow(/positive integer size/);
  });

  it('is deterministic — same grid and palette, same bytes (INV-8)', () => {
    expect([...rasterise(TINY, TINY_PALETTE)]).toEqual([...rasterise(TINY, TINY_PALETTE)]);
  });
});

describe('buildAtlas', () => {
  const body: SpriteSheet = {
    [poseKey('idle', 6)]: [{ w: 2, h: 2, ax: 1, ay: 1, rows: ['11', '11'] }],
    [poseKey('idle', 0)]: [{ w: 2, h: 2, ax: 1, ay: 1, rows: ['1.', '.1'] }],
  };
  const kit: SpriteSheet = {
    [poseKey('idle', 6)]: [{ w: 2, h: 2, ax: 1, ay: 1, rows: ['KK', '..'] }],
  };
  const palettes = {
    body: paletteFrom({ '1': '#102030' }),
    kit: paletteFrom({ [KIT.fill]: '#ff0000' }),
  };

  it('keys frames by pose, facing and frame index', () => {
    const atlas = buildAtlas({ body, kit }, palettes, offscreen().factory);

    expect([...atlas.frames.keys()]).toEqual([frameKey('idle', 6, 0), frameKey('idle', 0, 0)]);
  });

  it('packs frames without overlapping, inside the shelf width', () => {
    const atlas = buildAtlas({ body }, palettes, offscreen().factory, {
      maxWidth: 5,
      padding: 1,
    });

    const [a, b] = [...atlas.frames.values()];
    expect(a).toMatchObject({ x: 1, y: 1, w: 2, h: 2, ax: 1, ay: 1 });
    // 1 + 2 + 1 = 4, and another 2-wide frame would pass maxWidth 5, so it shelves.
    expect(b).toMatchObject({ x: 1, y: 4 });
    expect(atlas.width).toBeLessThanOrEqual(5);
  });

  it('composites the layers in key order, kit over body', () => {
    const { factory, layers } = offscreen();
    buildAtlas({ body, kit }, palettes, factory);

    const put = layers[0]?.ofKind('putImageData') ?? [];
    expect(put).toHaveLength(2);

    const first = put[0]?.args[0] as ImageData;
    // Top-left of `idle/6`: body '1' (#102030) with kit 'K' (#ff0000) over it.
    expect([...first.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    // Bottom-left: body only, because the kit row is transparent there.
    expect([...first.data.slice(8, 12)]).toEqual([0x10, 0x20, 0x30, 255]);
  });

  it('creates one image per frame, at the frame size', () => {
    const { factory, layers } = offscreen();
    buildAtlas({ body }, palettes, factory);

    expect(layers[0]?.ofKind('createImageData').map((c) => c.args)).toEqual([
      [2, 2],
      [2, 2],
    ]);
  });

  it('rejects a layer with no palette', () => {
    expect(() => buildAtlas({ body }, {}, offscreen().factory)).toThrow(/has no palette/);
  });

  it('rejects layers that disagree about a frame', () => {
    const mismatched: SpriteSheet = {
      [poseKey('idle', 6)]: [{ w: 3, h: 2, ax: 1, ay: 1, rows: ['KKK', '...'] }],
    };
    expect(() => buildAtlas({ body, kit: mismatched }, palettes, offscreen().factory)).toThrow(
      /disagrees with the layers under it/,
    );
  });

  it('survives an empty sheet rather than asking for a zero-sized canvas', () => {
    const atlas = buildAtlas({ body: {} }, palettes, offscreen().factory);
    expect(atlas.frames.size).toBe(0);
    expect(atlas.width).toBeGreaterThan(0);
    expect(atlas.height).toBeGreaterThan(0);
  });

  it('packs identically every time it is built (INV-8)', () => {
    const once = buildAtlas({ body, kit }, palettes, offscreen().factory);
    const twice = buildAtlas({ body, kit }, palettes, offscreen().factory);
    expect([...twice.frames]).toEqual([...once.frames]);
  });
});

describe('drawSprite', () => {
  const atlas = buildAtlas(
    { body: { [poseKey('idle', 6)]: [{ w: 4, h: 6, ax: 2, ay: 5, rows: Array(6).fill('1111') }] } },
    { body: paletteFrom({ '1': '#fff' }) },
    offscreen().factory,
  );
  const key = frameKey('idle', 6, 0);

  it('blits the frame with its anchor at the requested point', () => {
    const ctx = recordingCanvas();
    expect(drawSprite(ctx, atlas, key, { x: 10, y: 20 })).toBe(true);

    const [call] = ctx.ofKind('drawImage');
    expect(call?.args.slice(1)).toEqual([1, 1, 4, 6, -2, -5, 4, 6]);
    expect(ctx.ofKind('translate')[0]?.args).toEqual([10, 20]);
    expect(ctx.ofKind('scale')[0]?.args).toEqual([1, 1]);
  });

  it('mirrors about the anchor by negating x scale only', () => {
    const ctx = recordingCanvas();
    drawSprite(ctx, atlas, key, { x: 0, y: 0, scale: 0.05, mirrored: true });
    expect(ctx.ofKind('scale')[0]?.args).toEqual([-0.05, 0.05]);
  });

  it('saves and restores around the draw, and never leaks alpha', () => {
    const ctx = recordingCanvas();
    drawSprite(ctx, atlas, key, { x: 0, y: 0, alpha: 0.5 });
    expect(ctx.calls[0]).toBe('save()');
    expect(ctx.calls.at(-1)).toBe('restore()');
  });

  it('returns false for a key the atlas does not hold, and draws nothing', () => {
    const ctx = recordingCanvas();
    expect(drawSprite(ctx, atlas, frameKey('run', 2, 3), { x: 0, y: 0 })).toBe(false);
    expect(ctx.ofKind('drawImage')).toHaveLength(0);
  });
});

describe('facings', () => {
  it('mirrors exactly the three unauthored facings', () => {
    const facings = [0, 1, 2, 3, 4, 5, 6, 7] as const;
    const mirrored = facings.filter((f) => authoredFacing(f).mirrored);
    expect(mirrored).toEqual([3, 4, 5]);
    expect(authoredFacing(3)).toEqual({ facing: 1, mirrored: true });
    expect(authoredFacing(4)).toEqual({ facing: 0, mirrored: true });
    expect(authoredFacing(5)).toEqual({ facing: 7, mirrored: true });
  });

  it('always resolves to a facing that is actually authored', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 7 }), (f) => {
        const resolved = authoredFacing(f as Facing).facing;
        expect(AUTHORED_FACINGS).toContain(resolved);
      }),
    );
  });
});

describe('facingOf', () => {
  // y grows downwards, so north is -y (13 §2.1).
  it.each([
    ['east', 1, 0, 0],
    ['north-east', 1, -1, 1],
    ['north', 0, -1, 2],
    ['north-west', -1, -1, 3],
    ['west', -1, 0, 4],
    ['south-west', -1, 1, 5],
    ['south', 0, 1, 6],
    ['south-east', 1, 1, 7],
  ])('reads %s from a velocity', (_name, vx, vy, expected) => {
    // Started from the opposite facing, so hysteresis cannot be what produced the answer.
    expect(facingOf(vx, vy, ((expected + 4) % 8) as Facing)).toBe(expected);
  });

  it('holds the previous facing through a boundary rather than strobing', () => {
    // Just past the E/NE boundary (22.5°): a body wobbling across it keeps its facing.
    const wobble = Math.tan((Math.PI / 8) * 1.05);
    expect(facingOf(1, -wobble, 0)).toBe(0);
    // Well past it, it commits.
    expect(facingOf(1, -1, 0)).toBe(1);
  });

  it('holds the previous facing when standing still or given nonsense', () => {
    expect(facingOf(0, 0, 3)).toBe(3);
    expect(facingOf(1e-9, -1e-9, 7)).toBe(7);
    expect(facingOf(Number.NaN, 0, 2)).toBe(2);
    expect(facingOf(Number.POSITIVE_INFINITY, 0, 2)).toBe(2);
  });

  it('never returns anything but a facing, from any velocity', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.integer({ min: 0, max: 7 }),
        (vx, vy, previous) => {
          const facing = facingOf(vx, vy, previous as Facing);
          expect(Number.isInteger(facing)).toBe(true);
          expect(facing).toBeGreaterThanOrEqual(0);
          expect(facing).toBeLessThanOrEqual(7);
        },
      ),
    );
  });

  it('is a pure function of its inputs (INV-8)', () => {
    expect(facingOf(0.3, -0.7, 4)).toBe(facingOf(0.3, -0.7, 4));
  });
});

describe('the art actually in the repository', () => {
  const sheets: readonly [string, SpriteSheet, Palette][] = [
    ['body', ATHLETE_BODY, ATHLETE_BODY_PALETTE],
    ['kit', ATHLETE_KIT, kitPalette({ fill: '#4EA8FF', onFill: '#04121F', pattern: 'solid' })],
  ];

  it.each(sheets.map(([name]) => name))(
    '%s: every row is w chars and every index resolves',
    (name) => {
      const entry = sheets.find(([sheet]) => sheet === name);
      const [, sheet, palette] = entry as [string, SpriteSheet, Palette];

      const frames = Object.values(sheet).flat();
      expect(frames.length).toBeGreaterThan(0);

      for (const grid of frames) {
        expect(grid.rows).toHaveLength(grid.h);
        for (const row of grid.rows) expect(row).toHaveLength(grid.w);
        // Throws on an unresolvable index, which is the assertion.
        expect(rasterise(grid, palette).length).toBe(grid.w * grid.h * 4);
      }
    },
  );

  it('anchors athlete frames where 13 §3.1 says the feet are', () => {
    for (const grid of Object.values(ATHLETE_BODY).flat()) {
      expect([grid.w, grid.h, grid.ax, grid.ay]).toEqual([32, 48, 16, 46]);
    }
  });

  it('authors the body and kit layers of the same poses', () => {
    expect(Object.keys(ATHLETE_KIT)).toEqual(Object.keys(ATHLETE_BODY));
  });

  it('only authors facings that exist, and never a mirrored one', () => {
    for (const key of Object.keys(ATHLETE_BODY)) {
      const facing = Number(key.slice(key.lastIndexOf('/') + 1)) as Facing;
      expect(AUTHORED_FACINGS).toContain(facing);
    }
  });

  it('refuses to merge two pose files that claim the same key', () => {
    expect(() => mergeSheets([ATHLETE_BODY, ATHLETE_BODY])).toThrow(/authored in two pose files/);
  });

  it('builds a team atlas holding the idle frame', () => {
    const atlas = buildAthleteAtlas({ fill: '#4EA8FF', onFill: '#04121F' }, offscreen().factory);
    expect(atlas.frames.get(frameKey('idle', 6, 0))).toMatchObject({
      w: 32,
      h: 48,
      ax: 16,
      ay: 46,
    });
  });

  it('paints the two kits differently — the whole point of a tinted atlas', () => {
    const { factory: homeFactory, layers: home } = offscreen();
    const { factory: awayFactory, layers: away } = offscreen();
    buildAthleteAtlas({ fill: '#4EA8FF', onFill: '#04121F' }, homeFactory);
    buildAthleteAtlas({ fill: '#3DDC91', onFill: '#06210F' }, awayFactory);

    const homeBytes = (home[0]?.ofKind('putImageData')[0]?.args[0] as ImageData).data;
    const awayBytes = (away[0]?.ofKind('putImageData')[0]?.args[0] as ImageData).data;
    expect([...homeBytes]).not.toEqual([...awayBytes]);
  });
});
