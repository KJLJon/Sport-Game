/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.5 — Web app manifest and full icon set including maskable
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  04-architecture.md §2
 * @invariant INV-4
 */
import { describe, expect, it } from 'vitest';
import { buildManifest, serialiseManifest } from '../../../tools/manifest.ts';
import { ICON_SIZES, MASKABLE_SIZES, renderIcon } from '../../../tools/icons.ts';

const BASE = '/Some-Repo/';

describe('buildManifest', () => {
  it('ties identity to the base path, so the install is distinct from a sibling PWA', () => {
    const manifest = buildManifest(BASE);
    expect(manifest.id).toBe(BASE);
    expect(manifest.scope).toBe(BASE);
    expect(manifest.start_url).toBe(BASE);
  });

  it('follows a repository rename with no code change', () => {
    expect(buildManifest('/Renamed/').id).toBe('/Renamed/');
    expect(buildManifest('/').scope).toBe('/');
  });

  it('prefixes every icon and shortcut URL with the base path', () => {
    const manifest = buildManifest(BASE);
    for (const icon of manifest.icons) expect(icon.src.startsWith(BASE)).toBe(true);
    for (const shortcut of manifest.shortcuts) expect(shortcut.url.startsWith(BASE)).toBe(true);
  });

  it('ships the two sizes an install prompt requires, plus a maskable pair', () => {
    const manifest = buildManifest(BASE);
    const any = manifest.icons.filter((icon) => icon.purpose === 'any');
    const maskable = manifest.icons.filter((icon) => icon.purpose === 'maskable');

    expect(any.map((icon) => icon.sizes)).toContain('192x192');
    expect(any.map((icon) => icon.sizes)).toContain('512x512');
    expect(maskable.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512']);
  });

  it('declares standalone display and leaves orientation to the match screen', () => {
    const manifest = buildManifest(BASE);
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBe('any');
  });

  it('serialises to valid JSON', () => {
    expect(() => JSON.parse(serialiseManifest(BASE))).not.toThrow();
    expect(JSON.parse(serialiseManifest(BASE))).toEqual(buildManifest(BASE));
  });
});

describe('renderIcon', () => {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // Rendering the 512 px icons is the slowest thing in the unit suite, so render each once.
  const rendered = new Map(ICON_SIZES.map((size) => [size, renderIcon(size, 'any')]));

  it('emits a valid PNG at every declared size', () => {
    for (const [size, png] of rendered) {
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      // IHDR width and height live at bytes 16–23.
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
    for (const size of MASKABLE_SIZES) {
      expect(renderIcon(size, 'maskable').readUInt32BE(16)).toBe(size);
    }
  });

  it('declares 8-bit RGBA', () => {
    const png = rendered.get(192)!;
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // colour type: RGBA
  });

  it('is deterministic, so a rebuild produces byte-identical icons', () => {
    expect(renderIcon(96, 'any').equals(renderIcon(96, 'any'))).toBe(true);
  });

  it('draws the maskable variant differently — it must survive the adaptive-icon crop', () => {
    expect(renderIcon(192, 'maskable').equals(rendered.get(192)!)).toBe(false);
  });

  it('stays well inside the total install-size budget (`12` §6)', () => {
    const total = [...rendered.values()].reduce((sum, png) => sum + png.length, 0);
    expect(total).toBeLessThan(200 * 1024);
  });
});
