/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.3 — Narration + animated court-diagram renderer for turn outcomes
 * @story   US-15.3 — See what happened, not read about it
 * @design  09-modes-and-arcade.md §2.1, 10-ui-ux.md §6 (reduced motion), §8.4
 *
 * The timeline is a pure function, so everything worth asserting about the animation is asserted
 * here with no canvas. The drawing gets the recording double the renderer already provides.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE,
  diagramAt,
  drawDiagram,
  finalFrame,
  type TurnDiagram,
} from '../../../../src/modes/playbook/diagram.ts';
import { recordingCanvas } from '../../../helpers/canvas.ts';

const DIAGRAM: TurnDiagram = {
  seconds: 5,
  basket: { x: 0.9, y: 0.5 },
  caption: 'Wide open.',
  markers: [
    { id: 1, side: 0, label: '7', from: { x: 0.4, y: 0.5 }, to: { x: 0.7, y: 0.5 }, primary: true },
    { id: 2, side: 0, label: '3', from: { x: 0.5, y: 0.2 }, to: { x: 0.5, y: 0.3 } },
    { id: 101, side: 1, label: '9', from: { x: 0.6, y: 0.5 }, to: { x: 0.72, y: 0.5 } },
  ],
  shapes: [
    { kind: 'pass', from: { x: 0.5, y: 0.3 }, to: { x: 0.7, y: 0.5 }, at: 0.5, until: 0.68 },
    {
      kind: 'shot',
      from: { x: 0.7, y: 0.5 },
      to: { x: 0.9, y: 0.5 },
      at: 0.68,
      until: 0.95,
      made: true,
    },
  ],
};

const LAYOUT = { x: 0, y: 0, width: 300, height: 200 };

describe('diagramAt', () => {
  it('starts with every marker where it began and nothing drawn', () => {
    const frame = diagramAt(DIAGRAM, 0);
    expect(frame.progress).toBe(0);
    expect(frame.finished).toBe(false);
    expect(frame.shapes).toEqual([]);
    expect(frame.markers[0]?.at).toEqual({ x: 0.4, y: 0.5 });
  });

  it('finishes every marker where it was sent, well before the diagram ends', () => {
    const frame = diagramAt(DIAGRAM, 5 * 0.55);
    for (const [index, marker] of frame.markers.entries()) {
      expect(marker.at.x).toBeCloseTo(DIAGRAM.markers[index]?.to.x ?? 0, 5);
      expect(marker.at.y).toBeCloseTo(DIAGRAM.markers[index]?.to.y ?? 0, 5);
    }
  });

  it('never lets a marker overshoot where it was sent', () => {
    for (let t = 0; t <= 5; t += 0.1) {
      const marker = diagramAt(DIAGRAM, t).markers[0];
      expect(marker?.at.x).toBeGreaterThanOrEqual(0.4 - 1e-9);
      expect(marker?.at.x).toBeLessThanOrEqual(0.7 + 1e-9);
    }
  });

  it('draws the pass before the shot, and neither before its beat', () => {
    expect(diagramAt(DIAGRAM, 5 * 0.4).shapes.map((s) => s.kind)).toEqual([]);
    expect(diagramAt(DIAGRAM, 5 * 0.6).shapes.map((s) => s.kind)).toEqual(['pass']);
    expect(diagramAt(DIAGRAM, 5 * 0.8).shapes.map((s) => s.kind)).toEqual(['pass', 'shot']);
  });

  it('reports how far through a shape is, and caps it at drawn', () => {
    const midway = diagramAt(DIAGRAM, 5 * 0.59).shapes[0];
    expect(midway?.progress).toBeGreaterThan(0.4);
    expect(midway?.progress).toBeLessThan(0.6);
    expect(diagramAt(DIAGRAM, 5).shapes[0]?.progress).toBe(1);
  });

  it('clamps past the end rather than emptying the court', () => {
    const over = diagramAt(DIAGRAM, 99);
    expect(over.finished).toBe(true);
    expect(over.progress).toBe(1);
    expect(over.shapes).toHaveLength(2);
  });

  it('treats a zero-length diagram as already finished', () => {
    expect(diagramAt({ ...DIAGRAM, seconds: 0 }, 0).finished).toBe(true);
  });

  it('gives reduced motion the finished picture, not a faster one (`10` §6)', () => {
    expect(finalFrame(DIAGRAM)).toEqual(diagramAt(DIAGRAM, 5));
    expect(finalFrame(DIAGRAM).shapes.every((shape) => shape.progress === 1)).toBe(true);
  });
});

describe('drawDiagram', () => {
  it('draws a marker for every athlete, with its label', () => {
    const canvas = recordingCanvas();
    drawDiagram(canvas, finalFrame(DIAGRAM), LAYOUT);
    const labels = canvas.ofKind('fillText').map((call) => call.args[0]);
    expect(labels).toEqual(['7', '3', '9']);
  });

  it('projects field fractions into the layout it was given', () => {
    const canvas = recordingCanvas();
    drawDiagram(canvas, finalFrame(DIAGRAM), { x: 10, y: 20, width: 100, height: 50 });
    const arcs = canvas.ofKind('arc');
    // The primary marker ends at 0.7, 0.5 → 10 + 70, 20 + 25.
    expect(arcs.some((call) => call.args[0] === 80 && call.args[1] === 45)).toBe(true);
  });

  it('mirrors for a left-handed layout, exactly as the arcade does (T-4.12)', () => {
    const plain = recordingCanvas();
    const mirrored = recordingCanvas();
    drawDiagram(plain, finalFrame(DIAGRAM), LAYOUT);
    drawDiagram(mirrored, finalFrame(DIAGRAM), { ...LAYOUT, mirror: true });

    const firstArc = (canvas: typeof plain): number =>
      (canvas.ofKind('arc')[0]?.args[0] as number) ?? 0;
    expect(firstArc(mirrored)).toBeCloseTo(LAYOUT.width - firstArc(plain), 5);
  });

  it('rings the rim once the shot has landed, so the outcome is a shape and not a colour', () => {
    const landed = recordingCanvas();
    const inFlight = recordingCanvas();
    drawDiagram(landed, finalFrame(DIAGRAM), LAYOUT);
    drawDiagram(inFlight, diagramAt(DIAGRAM, 5 * 0.7), LAYOUT);
    expect(landed.ofKind('arc').length).toBeGreaterThan(inFlight.ofKind('arc').length);
  });

  it('inks a made shot differently from a missed one, on top of the ring', () => {
    const made = recordingCanvas();
    const missed = recordingCanvas();
    drawDiagram(made, finalFrame(DIAGRAM), LAYOUT);
    drawDiagram(
      missed,
      finalFrame({
        ...DIAGRAM,
        shapes: DIAGRAM.shapes.map((shape) =>
          shape.kind === 'shot' ? { ...shape, made: false } : shape,
        ),
      }),
      LAYOUT,
    );
    expect(made.strokeStyle === missed.strokeStyle).toBe(false);
    expect([DEFAULT_PALETTE.made, DEFAULT_PALETTE.missed]).toContain(made.strokeStyle);
  });

  it('leaves the context balanced', () => {
    const canvas = recordingCanvas();
    drawDiagram(canvas, finalFrame(DIAGRAM), LAYOUT);
    const saves = canvas.ofKind('save').length;
    const restores = canvas.ofKind('restore').length;
    expect(saves).toBe(restores);
  });
});
