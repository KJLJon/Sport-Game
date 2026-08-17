/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.1 — Court geometry, zones, arc, key, hoop, boundaries
 * @story   US-3.1 — Play a 5v5 basketball match
 *
 * Purpose: a `Canvas2D` that records what was drawn, so drawing code can be asserted without a
 * real canvas. Calls are recorded as strings *and* as structured entries: the strings make an
 * ordering failure readable, the entries make a coordinate assertion possible.
 */
import type {
  Canvas2D,
  OffscreenFactory,
  OffscreenLayer,
} from '../../src/engine/render/renderer.ts';

export interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface RecordingCanvas extends Canvas2D {
  readonly calls: string[];
  readonly recorded: RecordedCall[];
  /** Every call of one kind, for asserting on the shapes that were drawn. */
  ofKind(name: string): RecordedCall[];
}

/**
 * An `ImageData` without a DOM (T-13.2). The atlas builder only ever writes into one and hands it
 * straight back to `putImageData`, so the shape it actually depends on is these three fields.
 */
export function fakeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: 'srgb',
  } as ImageData;
}

export function recordingCanvas(): RecordingCanvas {
  const calls: string[] = [];
  const recorded: RecordedCall[] = [];

  const record =
    (name: string) =>
    (...args: unknown[]) => {
      recorded.push({ name, args });
      calls.push(
        `${name}(${args.map((a) => (typeof a === 'object' ? 'obj' : String(a))).join(',')})`,
      );
    };

  const names = [
    'save',
    'restore',
    'scale',
    'translate',
    'rotate',
    'clearRect',
    'fillRect',
    'strokeRect',
    'beginPath',
    'closePath',
    'moveTo',
    'lineTo',
    'arc',
    'fill',
    'stroke',
    'fillText',
    'drawImage',
    'putImageData',
  ] as const;

  const createImageData = record('createImageData');

  const ctx: Record<string, unknown> = {
    calls,
    recorded,
    ofKind: (name: string) => recorded.filter((call) => call.name === name),
    createImageData: (width: number, height: number) => {
      createImageData(width, height);
      return fakeImageData(width, height);
    },
    imageSmoothingEnabled: true,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
  };
  for (const name of names) ctx[name] = record(name);

  return ctx as unknown as RecordingCanvas;
}

/**
 * An `OffscreenFactory` whose layers are recording canvases (T-13.2, T-13.3). Every layer gets its
 * own identity for `canvas`, so a test can assert *which* atlas a sprite was blitted from.
 */
export function recordingOffscreen(): {
  factory: OffscreenFactory;
  layers: RecordingCanvas[];
  images: CanvasImageSource[];
} {
  const layers: RecordingCanvas[] = [];
  const images: CanvasImageSource[] = [];

  const factory: OffscreenFactory = (width, height) => {
    const ctx = recordingCanvas();
    const canvas = {} as CanvasImageSource;
    layers.push(ctx);
    images.push(canvas);
    return { canvas, ctx, width, height } as OffscreenLayer;
  };

  return { factory, layers, images };
}
