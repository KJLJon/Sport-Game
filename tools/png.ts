/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.5 — Web app manifest and full icon set including maskable
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  04-architecture.md §12 (no third-party scripts), 12-quality-and-testing.md §6
 *
 * Purpose: a minimal PNG encoder. The app ships no image-processing dependency and fetches
 * nothing at build time (`04` §12), so icons are rasterised here from an RGBA buffer — about
 * eighty lines against a dependency tree, for an asset class that never changes shape.
 */
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 table, built once. PNG requires a CRC over each chunk's type and data. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = (CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** An RGBA image buffer, four bytes per pixel, row-major. */
export interface Bitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Encodes RGBA8 as a PNG. Filter type 0 on every row — the images are small and flat. */
export function encodePng(bitmap: Bitmap): Buffer {
  const { width, height, data } = bitmap;

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width * 4; x += 1) {
      raw[rowStart + 1 + x] = data[y * width * 4 + x]!;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Source-over composite of `colour` onto the pixel at `(x, y)`, with `coverage` as alpha. */
export function blend(bitmap: Bitmap, x: number, y: number, colour: Rgba, coverage: number): void {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;
  const alpha = (colour.a / 255) * Math.min(1, Math.max(0, coverage));
  if (alpha <= 0) return;

  const index = (y * bitmap.width + x) * 4;
  const dstA = bitmap.data[index + 3]! / 255;
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;

  for (let channel = 0; channel < 3; channel += 1) {
    const src = [colour.r, colour.g, colour.b][channel]!;
    const dst = bitmap.data[index + channel]!;
    bitmap.data[index + channel] = (src * alpha + dst * dstA * (1 - alpha)) / outA;
  }
  bitmap.data[index + 3] = outA * 255;
}

/**
 * Fills a signed-distance shape with 2×2 supersampling. `sdf` returns the distance in pixels
 * from the shape's edge — negative inside — which gives clean antialiased curves without a
 * rasteriser.
 */
export function fillSdf(bitmap: Bitmap, colour: Rgba, sdf: (x: number, y: number) => number): void {
  const offsets = [0.25, 0.75];

  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      let coverage = 0;
      for (const dy of offsets) {
        for (const dx of offsets) {
          if (sdf(x + dx, y + dy) <= 0) coverage += 0.25;
        }
      }
      if (coverage > 0) blend(bitmap, x, y, colour, coverage);
    }
  }
}

/** Signed distance to a rounded rectangle centred in a `size`×`size` box. */
export function roundedRectSdf(size: number, inset: number, radius: number) {
  const half = size / 2;
  const extent = half - inset - radius;
  return (x: number, y: number): number => {
    const dx = Math.abs(x - half) - extent;
    const dy = Math.abs(y - half) - extent;
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    return outside + Math.min(Math.max(dx, dy), 0) - radius;
  };
}

/** Signed distance to a circle. */
export function circleSdf(cx: number, cy: number, radius: number) {
  return (x: number, y: number): number => Math.hypot(x - cx, y - cy) - radius;
}

/** Signed distance to a line segment of a given thickness — used for the ball's seams. */
export function segmentSdf(x1: number, y1: number, x2: number, y2: number, thickness: number) {
  return (x: number, y: number): number => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) - thickness / 2;
  };
}

/** Intersection of two shapes: inside both. */
export function intersectSdf(
  a: (x: number, y: number) => number,
  b: (x: number, y: number) => number,
) {
  return (x: number, y: number): number => Math.max(a(x, y), b(x, y));
}
