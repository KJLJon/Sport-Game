/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.5 — Web app manifest and full icon set including maskable
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  10-ui-ux.md §3.1 (palette), 04-architecture.md §12
 *
 * Purpose: draws the app mark at every size the install flow needs. Two variants: `any`, which
 * fills the tile edge to edge, and `maskable`, which keeps the mark inside the 80% safe zone so
 * Android's adaptive-icon crop never clips it.
 */
import {
  circleSdf,
  createBitmap,
  encodePng,
  fillSdf,
  intersectSdf,
  roundedRectSdf,
  segmentSdf,
  type Rgba,
} from './png.ts';

/** From `10` §3.1 — surface-0 and accent, so the icon matches the app it opens. */
const BACKGROUND: Rgba = { r: 0x0b, g: 0x0f, b: 0x14, a: 255 };
const BALL: Rgba = { r: 0x3d, g: 0xdc, b: 0x91, a: 255 };
const SEAM: Rgba = { r: 0x0b, g: 0x0f, b: 0x14, a: 255 };

export type IconPurpose = 'any' | 'maskable';

/** Icon sizes: the PWA minimum (192, 512), plus the platform-specific ones browsers ask for. */
export const ICON_SIZES = [48, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512] as const;
export const MASKABLE_SIZES = [192, 512] as const;

/**
 * Renders the mark: a rounded tile with a ball on it. Deliberately a generic ball with seams
 * rather than any real league's marks — the app ships with no licensed identity anywhere.
 */
export function renderIcon(size: number, purpose: IconPurpose): Buffer {
  const bitmap = createBitmap(size, size);

  // Maskable icons are cropped to a circle inscribed in the middle 80%, so the mark shrinks and
  // the background runs to the edge.
  const tileInset = purpose === 'maskable' ? 0 : size * 0.04;
  const tileRadius = purpose === 'maskable' ? 0 : size * 0.22;
  const ballScale = purpose === 'maskable' ? 0.3 : 0.36;

  fillSdf(bitmap, BACKGROUND, roundedRectSdf(size, tileInset, tileRadius));

  const centre = size / 2;
  const ballRadius = size * ballScale;
  const ball = circleSdf(centre, centre, ballRadius);
  fillSdf(bitmap, BALL, ball);

  // Seams, clipped to the ball so they never run off its edge.
  const seamWidth = Math.max(1.5, size * 0.035);
  const arcOffset = ballRadius * 1.35;

  const seams = [
    segmentSdf(centre, centre - ballRadius, centre, centre + ballRadius, seamWidth),
    segmentSdf(centre - ballRadius, centre, centre + ballRadius, centre, seamWidth),
    // Two curved seams approximated as circles of a larger radius, intersected with the ball.
    circleSdfRing(centre - arcOffset, centre, arcOffset, seamWidth),
    circleSdfRing(centre + arcOffset, centre, arcOffset, seamWidth),
  ];

  for (const seam of seams) {
    fillSdf(bitmap, SEAM, intersectSdf(seam, ball));
  }

  return encodePng(bitmap);
}

/** A ring: the shell of a circle, `thickness` wide. */
function circleSdfRing(cx: number, cy: number, radius: number, thickness: number) {
  return (x: number, y: number): number =>
    Math.abs(Math.hypot(x - cx, y - cy) - radius) - thickness / 2;
}

export interface GeneratedIcon {
  readonly fileName: string;
  readonly size: number;
  readonly purpose: IconPurpose;
  readonly source: Buffer;
}

/** The full set, ready to be emitted as build assets. */
export function generateIcons(): GeneratedIcon[] {
  const icons: GeneratedIcon[] = [];

  for (const size of ICON_SIZES) {
    icons.push({
      fileName: `icons/icon-${size}.png`,
      size,
      purpose: 'any',
      source: renderIcon(size, 'any'),
    });
  }

  for (const size of MASKABLE_SIZES) {
    icons.push({
      fileName: `icons/maskable-${size}.png`,
      size,
      purpose: 'maskable',
      source: renderIcon(size, 'maskable'),
    });
  }

  return icons;
}
