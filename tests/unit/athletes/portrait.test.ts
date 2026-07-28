/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.7 — Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale
 * @design  05-data-model.md §2 (local blob, never uploaded), 10-ui-ux.md §8.3
 *
 * Purpose: `fittedSize` is pure arithmetic and is pinned exhaustively; `downscalePortrait` is
 * exercised against fakes for `createImageBitmap`, `OffscreenCanvas`, and the `<canvas>` element
 * fallback, since jsdom implements neither for real — the point of the test is that the module
 * orchestrates them correctly, not that a real image gets encoded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PORTRAIT_MAX_EDGE,
  downscalePortrait,
  fittedSize,
} from '../../../src/athletes/portrait.ts';

describe('fittedSize', () => {
  it('leaves an image already at or under the cap alone', () => {
    expect(fittedSize(300, 200, 512)).toEqual({ width: 300, height: 200 });
    expect(fittedSize(512, 512, 512)).toEqual({ width: 512, height: 512 });
  });

  it('never upscales', () => {
    expect(fittedSize(100, 50, 512)).toEqual({ width: 100, height: 50 });
  });

  it('caps a landscape image on its width', () => {
    expect(fittedSize(2048, 1024, 512)).toEqual({ width: 512, height: 256 });
  });

  it('caps a portrait image on its height', () => {
    expect(fittedSize(1024, 2048, 512)).toEqual({ width: 256, height: 512 });
  });

  it('caps a square image on either edge identically', () => {
    expect(fittedSize(2000, 2000, 512)).toEqual({ width: 512, height: 512 });
  });

  it('defaults to the shared max edge in the module constant', () => {
    expect(PORTRAIT_MAX_EDGE).toBe(512);
  });

  it('rounds to whole pixels', () => {
    const result = fittedSize(1000, 333, 512);
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
  });

  it('never produces a zero edge for a valid non-square input', () => {
    const result = fittedSize(10_000, 1, 512);
    expect(result.width).toBe(512);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('treats degenerate input as an empty image rather than dividing by zero', () => {
    expect(fittedSize(0, 100, 512)).toEqual({ width: 0, height: 0 });
    expect(fittedSize(100, 0, 512)).toEqual({ width: 0, height: 0 });
    expect(fittedSize(-5, 100, 512)).toEqual({ width: 0, height: 0 });
    expect(fittedSize(100, 100, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('downscalePortrait', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws through OffscreenCanvas when the engine has one, at the fitted size', async () => {
    const drawImage = vi.fn((..._args: unknown[]) => {});
    const convertToBlob = vi.fn(async () => new Blob(['fake'], { type: 'image/webp' }));
    let sizeAtDraw: { width: number; height: number } | null = null;

    class FakeOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext(_type: string) {
        return {
          drawImage: (...args: unknown[]) => {
            sizeAtDraw = { width: this.width, height: this.height };
            drawImage(...args);
          },
        };
      }
      convertToBlob(options: { type: string; quality?: number }) {
        return convertToBlob(options);
      }
    }

    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 2048,
        height: 1024,
        close: vi.fn(),
      })),
    );

    const result = await downscalePortrait(new Blob(['source']));

    expect(result).toBeInstanceOf(Blob);
    expect(sizeAtDraw).toEqual({ width: 512, height: 256 });
    expect(convertToBlob).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'image/webp', quality: 0.85 }),
    );
  });

  it('closes the source bitmap even when encoding throws', async () => {
    const close = vi.fn();
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 10, height: 10, close })),
    );

    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        if (tag !== 'canvas') return document.createElement(tag);
        return {
          width: 0,
          height: 0,
          getContext: () => null,
        } as unknown as HTMLCanvasElement;
      });

    await expect(downscalePortrait(new Blob(['source']))).rejects.toThrow(
      '2D canvas context is unavailable',
    );
    expect(close).toHaveBeenCalled();

    createElementSpy.mockRestore();
  });

  it('falls back to a <canvas> element when OffscreenCanvas is unavailable', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 100,
        height: 100,
        close: vi.fn(),
      })),
    );

    const drawImage = vi.fn((..._args: unknown[]) => {});
    const fakeBlob = new Blob(['fallback'], { type: 'image/jpeg' });
    const toBlob = vi.fn(
      (callback: (blob: Blob | null) => void, _type?: string, _quality?: number) => {
        callback(fakeBlob);
      },
    );

    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        if (tag !== 'canvas') return document.createElement(tag);
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage }),
          toBlob,
        } as unknown as HTMLCanvasElement;
      });

    const result = await downscalePortrait(new Blob(['source']), { mimeType: 'image/jpeg' });

    expect(result).toBe(fakeBlob);
    expect(drawImage).toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);

    createElementSpy.mockRestore();
  });

  it('rejects when the <canvas> fallback produces no blob', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 100,
        height: 100,
        close: vi.fn(),
      })),
    );

    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        if (tag !== 'canvas') return document.createElement(tag);
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
          toBlob: (callback: (blob: Blob | null) => void) => callback(null),
        } as unknown as HTMLCanvasElement;
      });

    await expect(downscalePortrait(new Blob(['source']))).rejects.toThrow(
      'canvas.toBlob produced no blob',
    );

    createElementSpy.mockRestore();
  });

  it('honours custom maxEdge and quality options', async () => {
    const convertToBlob = vi.fn(async () => new Blob(['x'], { type: 'image/webp' }));
    let sawSize: { width: number; height: number } | null = null;

    class FakeOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        sawSize = { width, height };
      }
      getContext(_type: string) {
        return { drawImage: vi.fn() };
      }
      convertToBlob(options: { type: string; quality?: number }) {
        return convertToBlob(options);
      }
    }

    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({
        width: 800,
        height: 800,
        close: vi.fn(),
      })),
    );

    await downscalePortrait(new Blob(['source']), { maxEdge: 128, quality: 0.5 });

    expect(sawSize).toEqual({ width: 128, height: 128 });
    expect(convertToBlob).toHaveBeenCalledWith(expect.objectContaining({ quality: 0.5 }));
  });
});
