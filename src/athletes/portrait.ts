/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.7 — Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale
 * @story   US-5.1 — Create an athlete profile
 * @design  05-data-model.md §2 (`portraitBlobId` — a local blob, never uploaded),
 *          10-ui-ux.md §8.3 (create-an-athlete flow: "photo (camera / library / skip)")
 * @invariant INV-14 (no runtime network request — a portrait never leaves the device)
 *
 * Purpose: turns whatever the file picker or camera hands back into a small, local portrait blob.
 * `05` §2 stores only `portraitBlobId` — a key into a local blob store — never image bytes inline
 * and never anything sent anywhere, so this module has no network path at all: it reads a `Blob`,
 * draws it into a canvas at a capped size, and re-encodes it.
 *
 * Kept deliberately pure where it can be: `fittedSize` is plain arithmetic and is tested
 * exhaustively; `downscalePortrait` is the only async, canvas-touching part, and it exists solely to
 * turn that arithmetic into pixels. Writing the resulting blob into IndexedDB is a different
 * module's job — the profile editor does that, with a `TODO(T-3.16)` marking exactly where.
 */

/** A pixel size. Always integers — a canvas cannot be sized in fractions of a pixel. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The longest edge a stored portrait may have. Big enough to look sharp in the full athlete card, small enough that two hundred of them do not eat the device's storage quota. */
export const PORTRAIT_MAX_EDGE = 512;

/** Re-encode target. WebP first — smaller for the same look — with JPEG as the universal fallback. */
export const PORTRAIT_MIME = 'image/webp';
export const PORTRAIT_FALLBACK_MIME = 'image/jpeg';
export const PORTRAIT_QUALITY = 0.85;

/**
 * The size a `width × height` image lands at once its longest edge is capped to `maxEdge`,
 * aspect ratio preserved. Never upscales — a photo already smaller than the cap is left alone,
 * because enlarging it would spend storage on pixels the source never had.
 *
 * Degenerate input (zero or negative on either edge, which a corrupt or empty image can produce)
 * returns `{ width: 0, height: 0 }` rather than dividing by zero or handing back a nonsense size.
 */
export function fittedSize(width: number, height: number, maxEdge: number): Size {
  if (!(width > 0) || !(height > 0) || !(maxEdge > 0)) return { width: 0, height: 0 };

  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface DownscaleOptions {
  /** Longest edge of the result, in pixels. Defaults to `PORTRAIT_MAX_EDGE`. */
  readonly maxEdge?: number;
  /** Re-encode target. Defaults to `PORTRAIT_MIME`. */
  readonly mimeType?: string;
  readonly quality?: number;
}

/**
 * Reads `source` — whatever `<input type="file" accept="image/*">` or a camera capture handed
 * back — and returns a downscaled, re-encoded copy. Never touches the network and never writes
 * anywhere: the caller decides what to do with the returned blob.
 *
 * `OffscreenCanvas` renders it when the engine has one (every evergreen browser); the `<canvas>`
 * element fallback below covers Safari builds old enough to lack it. Both paths draw through the
 * same `createImageBitmap`, so the two only differ in how the pixels are read back out.
 */
export async function downscalePortrait(
  source: Blob,
  options: DownscaleOptions = {},
): Promise<Blob> {
  const maxEdge = options.maxEdge ?? PORTRAIT_MAX_EDGE;
  const mimeType = options.mimeType ?? PORTRAIT_MIME;
  const quality = options.quality ?? PORTRAIT_QUALITY;

  const bitmap = await createImageBitmap(source);
  try {
    const { width, height } = fittedSize(bitmap.width, bitmap.height, maxEdge);
    return await renderToBlob(bitmap, width, height, mimeType, quality);
  } finally {
    bitmap.close();
  }
}

/** Draws `bitmap` at `width × height` and re-encodes it, picking whichever canvas the engine has. */
async function renderToBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('2D canvas context is unavailable');
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: mimeType, quality });
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('2D canvas context is unavailable');
  context.drawImage(bitmap, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error('canvas.toBlob produced no blob'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}
