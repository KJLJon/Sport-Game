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
import type { Canvas2D } from '../../src/engine/render/renderer.ts';

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
  ] as const;

  const ctx: Record<string, unknown> = {
    calls,
    recorded,
    ofKind: (name: string) => recorded.filter((call) => call.name === name),
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
