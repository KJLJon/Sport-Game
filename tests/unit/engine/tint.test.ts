/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
 * @story   US-13.4 — Tell the two teams apart without relying on colour
 * @design  13-visual-overhaul.md §2.2, 10-ui-ux.md §11
 *
 * Purpose: the assertions Gate 13's colour-vision check rests on — that a kit's pattern differs
 * from its fill in *luminance* and not only in hue, that the pattern is geometry a greyscale can
 * still see, and that the geometry survives the horizontal flip three of the eight facings are
 * drawn with.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { KIT, paletteIndex, type SpriteGrid, type SpriteSheet } from '@/engine/render/atlas.ts';
import {
  KIT_PATTERNS,
  PATTERN_CONTRAST,
  contrastRatio,
  kitPalette,
  patternInk,
  patternMask,
  relativeLuminance,
  tintKitGrid,
  tintKitSheet,
  type KitPattern,
} from '@/engine/render/tint.ts';
import { kitsFor as basketballKits } from '@/sports/basketball/sprite-art.ts';
import { kitsFor as soccerKits } from '@/sports/soccer/sprite-art.ts';

/** A shirt: eight rows of pattern region, with a collar of ink and a border of fill. */
const SHIRT: SpriteGrid = {
  w: 16,
  h: 8,
  ax: 8,
  ay: 7,
  rows: [
    '.....kkkkkk.....',
    '..PPPPPPPPPPPP..',
    '..PPPPPPPPPPPP..',
    '..PPPPPPPPPPPP..',
    '..PPPPPPPPPPPP..',
    '..PPPPPPPPPPPP..',
    '..PPPPPPPPPPPP..',
    '.....KKKKKK.....',
  ],
};

function countOf(grid: SpriteGrid, ch: string): number {
  return grid.rows.join('').split(ch).length - 1;
}

describe('luminance and contrast', () => {
  it('puts black at 0 and white at 1', () => {
    expect(relativeLuminance('#000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
  });

  it('is the WCAG ratio, symmetric, and 21:1 at the extremes', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#4EA8FF', '#4EA8FF')).toBeCloseTo(1, 6);
  });

  it('ignores alpha — a kit is painted opaque', () => {
    expect(relativeLuminance('#ffffff00')).toBeCloseTo(relativeLuminance('#ffffff'), 6);
  });
});

describe('patternInk', () => {
  it("keeps the team's own ink when it is already far enough from the fill", () => {
    expect(patternInk('#4EA8FF', '#04121F')).toBe('#04121F');
  });

  it('derives a shade when the ink is too close to the fill to survive a greyscale', () => {
    const ink = patternInk('#4EA8FF', '#55AAFF');
    expect(ink).not.toBe('#55AAFF');
    expect(contrastRatio('#4EA8FF', ink)).toBeGreaterThanOrEqual(PATTERN_CONTRAST);
  });

  it('clears the contrast floor for any fill and any ink at all (INV-11)', () => {
    const hex = fc
      .tuple(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
      )
      .map(([r, g, b]) => `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`);

    fc.assert(
      fc.property(hex, hex, (fill, onFill) => {
        expect(contrastRatio(fill, patternInk(fill, onFill))).toBeGreaterThanOrEqual(
          PATTERN_CONTRAST - 1e-9,
        );
      }),
      { numRuns: 200 },
    );
  });

  it('is a pure function of its inputs (INV-8)', () => {
    expect(patternInk('#808080', '#7f7f7f')).toBe(patternInk('#808080', '#7f7f7f'));
  });
});

describe('kitPalette', () => {
  it('binds the three reserved characters and whatever extra the layer uses', () => {
    const palette = kitPalette(
      { fill: '#4EA8FF', onFill: '#04121F', pattern: 'stripes' },
      { '5': '#14161a' },
    );
    expect(palette[paletteIndex(KIT.fill)]).toBe('#4EA8FF');
    expect(palette[paletteIndex(KIT.ink)]).toBe('#04121F');
    expect(palette[paletteIndex(KIT.pattern)]).toBe('#04121F');
    expect(palette[paletteIndex('5')]).toBe('#14161a');
  });

  it('paints a solid kit’s pattern slot in the fill, so nothing shows through', () => {
    const palette = kitPalette({ fill: '#4EA8FF', onFill: '#04121F', pattern: 'solid' });
    expect(palette[paletteIndex(KIT.pattern)]).toBe('#4EA8FF');
  });
});

describe('patternMask geometry', () => {
  const bounds = { top: 1, bottom: 6 };

  it('inks nothing for a solid kit', () => {
    for (let x = 0; x < SHIRT.w; x++) {
      expect(patternMask('solid', SHIRT, x, 3, bounds)).toBe(false);
    }
  });

  it('bands stripes vertically and hoops horizontally', () => {
    const row = (y: number, pattern: KitPattern): string =>
      [...Array(SHIRT.w).keys()]
        .map((x) => (patternMask(pattern, SHIRT, x, y, bounds) ? '#' : '.'))
        .join('');

    expect(new Set([row(1, 'stripes'), row(4, 'stripes')]).size).toBe(1);
    expect(new Set([row(1, 'hoops'), row(5, 'hoops')]).size).toBe(2);
  });

  it('survives the mirror the three unauthored facings are drawn with', () => {
    // A pixel at column x lands where 2*ax - 1 - x would land when the sprite is flipped about its
    // anchor, so a stripe that is not symmetric about that would jump sideways on turning west.
    for (const pattern of KIT_PATTERNS) {
      for (let x = 0; x < SHIRT.w; x++) {
        const mirrored = 2 * SHIRT.ax - 1 - x;
        if (mirrored < 0 || mirrored >= SHIRT.w) continue;
        expect(patternMask(pattern, SHIRT, x, 3, bounds)).toBe(
          patternMask(pattern, SHIRT, mirrored, 3, bounds),
        );
      }
    }
  });

  it('never splits halves left from right, which a mirror would swap', () => {
    const top = patternMask('halves', SHIRT, 2, 1, bounds);
    const bottom = patternMask('halves', SHIRT, 2, 6, bounds);
    expect([top, bottom]).toEqual([true, false]);
  });
});

describe('tintKitGrid', () => {
  it('resolves every pattern pixel of a solid kit into fill', () => {
    const solid = tintKitGrid(SHIRT, 'solid');
    expect(countOf(solid, KIT.pattern)).toBe(0);
    expect(countOf(solid, KIT.fill)).toBe(countOf(SHIRT, KIT.fill) + countOf(SHIRT, KIT.pattern));
  });

  it('keeps some pattern and fills the rest for a patterned kit', () => {
    for (const pattern of ['stripes', 'hoops', 'halves'] as const) {
      const tinted = tintKitGrid(SHIRT, pattern);
      expect(countOf(tinted, KIT.pattern)).toBeGreaterThan(0);
      expect(countOf(tinted, KIT.pattern)).toBeLessThan(countOf(SHIRT, KIT.pattern));
    }
  });

  it('touches nothing but the pattern region', () => {
    const tinted = tintKitGrid(SHIRT, 'hoops');
    expect(countOf(tinted, KIT.ink)).toBe(countOf(SHIRT, KIT.ink));
    expect(tinted.rows[0]).toBe(SHIRT.rows[0]);
    expect([tinted.w, tinted.h, tinted.ax, tinted.ay]).toEqual([
      SHIRT.w,
      SHIRT.h,
      SHIRT.ax,
      SHIRT.ay,
    ]);
  });

  it('leaves a grid with no pattern region exactly as authored', () => {
    const plain: SpriteGrid = { w: 2, h: 2, ax: 1, ay: 1, rows: ['KK', 'kk'] };
    expect(tintKitGrid(plain, 'stripes')).toBe(plain);
  });

  it('is deterministic — same grid and pattern, same rows (INV-8)', () => {
    expect(tintKitGrid(SHIRT, 'stripes').rows).toEqual(tintKitGrid(SHIRT, 'stripes').rows);
  });
});

describe('tintKitSheet', () => {
  const sheet: SpriteSheet = { 'idle/6': [SHIRT, SHIRT] };

  it('resolves every frame of every pose and keeps the keys', () => {
    const tinted = tintKitSheet(sheet, 'hoops');
    expect(Object.keys(tinted)).toEqual(Object.keys(sheet));
    expect(tinted['idle/6']).toHaveLength(2);
    for (const grid of tinted['idle/6'] ?? []) {
      expect(countOf(grid, KIT.pattern)).toBeLessThan(countOf(SHIRT, KIT.pattern));
    }
  });
});

describe('the kits the two sports actually ship', () => {
  const kits = [
    ['basketball 0', basketballKits()[0]],
    ['basketball 1', basketballKits()[1]],
    ['soccer 0', soccerKits().teams[0]],
    ['soccer 1', soccerKits().teams[1]],
    ['soccer keeper', soccerKits().keeper],
  ] as const;

  it.each(kits.map(([name]) => name))('%s: pattern reads in luminance, not only in hue', (name) => {
    const kit = kits.find(([label]) => label === name)?.[1];
    const ink = patternInk(kit?.fill ?? '', kit?.onFill ?? '');
    expect(contrastRatio(kit?.fill ?? '', ink)).toBeGreaterThanOrEqual(PATTERN_CONTRAST);
  });

  it('gives the two sides different patterns, in both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      expect(basketballKits(theme)[0].pattern).not.toBe(basketballKits(theme)[1].pattern);
      expect(soccerKits(theme).teams[0].pattern).not.toBe(soccerKits(theme).teams[1].pattern);
      expect(soccerKits(theme).keeper.pattern).not.toBe(soccerKits(theme).teams[0].pattern);
    }
  });
});
