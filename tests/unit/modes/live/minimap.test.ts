/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.4 — Minimap rework: always-on, tap-to-look, readable at 44 px
 * @story   US-2.3 — See what is happening on a small screen
 * @design  10-ui-ux.md §4 (safe areas, 44 px targets), §11
 * @invariant INV-11 (44 px touch targets, no information by colour alone)
 *
 * Purpose: the three things the rework added — the field's own shape, a viewport box, and a tap
 * that means something — plus the 44 px floor, which is a promise about a physical thumb.
 */
import { describe, expect, it } from 'vitest';
import { recordingCanvas } from '../../../helpers/canvas.ts';
import { World } from '@/engine/world.ts';
import { MIN_MINIMAP_PX, drawMinimap, minimapFrame, minimapPoint } from '@/modes/live/minimap.ts';
import { hudLayout } from '@/modes/live/hud.ts';
import { createBoxScore } from '@/modes/live/box-score.ts';
import type { MatchView } from '@/modes/live/match.ts';

const COURT = { width: 28, height: 15 };
const PITCH = { width: 105, height: 68 };

function view(controlled = -1): MatchView {
  return {
    phase: 'live',
    period: 1,
    periodName: 'Quarter',
    finished: false,
    score: [0, 0],
    playerSide: 0,
    steps: 0,
    box: createBoxScore(),
    status: {
      actionClock: null,
      teamFouls: null,
      bonus: null,
      possession: 0,
      controlled,
      stoppage: null,
      meter: null,
      periodClock: 600,
    },
  };
}

describe('the frame', () => {
  it('takes the field s aspect ratio, not a court s', () => {
    const layout = hudLayout(800, 400);

    const court = minimapFrame(layout, COURT.width, COURT.height);
    const pitch = minimapFrame(layout, PITCH.width, PITCH.height);

    expect(court.width / court.height).toBeCloseTo(28 / 15, 1);
    expect(pitch.width / pitch.height).toBeCloseTo(105 / 68, 1);
  });

  it('is never smaller than a touch target on either axis', () => {
    // A very small viewport, of the kind a 320 px phone in landscape with a notch produces.
    const frame = minimapFrame(hudLayout(320, 180), PITCH.width, PITCH.height);

    expect(frame.width).toBeGreaterThanOrEqual(MIN_MINIMAP_PX);
    expect(frame.height).toBeGreaterThanOrEqual(MIN_MINIMAP_PX);
  });

  it('grows upwards, so a tall field never pushes it through the bottom inset', () => {
    const insets = { top: 0, right: 0, bottom: 30, left: 0 };
    const layout = hudLayout(800, 400, insets);

    const wide = minimapFrame(layout, 105, 30);
    const tall = minimapFrame(layout, 105, 100);

    const bottom = layout.minimap.y + layout.minimap.height;
    expect(wide.y + wide.height).toBe(bottom);
    expect(tall.y + tall.height).toBe(bottom);
    expect(tall.y).toBeLessThan(wide.y);
    expect(bottom).toBeLessThanOrEqual(400 - insets.bottom);
  });
});

describe('tap to look', () => {
  const frame = minimapFrame(hudLayout(800, 400), PITCH.width, PITCH.height);

  it('turns a tap into the world point under it', () => {
    const centre = minimapPoint(
      frame,
      frame.x + frame.width / 2,
      frame.y + frame.height / 2,
      PITCH.width,
      PITCH.height,
    );

    expect(centre?.x).toBeCloseTo(52.5, 1);
    expect(centre?.y).toBeCloseTo(34, 1);
  });

  it('maps the corners to the corners', () => {
    const topLeft = minimapPoint(frame, frame.x, frame.y, PITCH.width, PITCH.height);
    const bottomRight = minimapPoint(
      frame,
      frame.x + frame.width,
      frame.y + frame.height,
      PITCH.width,
      PITCH.height,
    );

    expect(topLeft?.x).toBeCloseTo(0, 6);
    expect(bottomRight?.x).toBeCloseTo(PITCH.width, 6);
    expect(bottomRight?.y).toBeCloseTo(PITCH.height, 6);
  });

  it('ignores a tap that missed', () => {
    expect(minimapPoint(frame, 10, 10, PITCH.width, PITCH.height)).toBeNull();
    expect(
      minimapPoint(frame, frame.x + frame.width + 5, frame.y, PITCH.width, PITCH.height),
    ).toBeNull();
  });
});

describe('drawing', () => {
  function world() {
    const w = new World({ width: 105, height: 68, cellSize: 8, capacity: 32 });
    return w;
  }

  it('draws the camera s viewport as a box, so the map says where you are looking', () => {
    const w = world();
    const frame = minimapFrame(hudLayout(800, 400), PITCH.width, PITCH.height);

    const without = recordingCanvas();
    drawMinimap(without, frame, view(), w, PITCH.width, PITCH.height);

    const with_ = recordingCanvas();
    drawMinimap(with_, frame, view(), w, PITCH.width, PITCH.height, {
      viewport: { x: 20, y: 10, width: 45, height: 23 },
    });

    // Without it the map says where everyone is but not which part of it you can see, and those are
    // different questions the moment the camera stops fitting the field.
    expect(with_.ofKind('strokeRect').length).toBe(without.ofKind('strokeRect').length + 1);
  });

  it('keeps the viewport box inside the map when the camera overhangs the field', () => {
    const w = world();
    const frame = minimapFrame(hudLayout(800, 400), PITCH.width, PITCH.height);
    const ctx = recordingCanvas();

    drawMinimap(ctx, frame, view(), w, PITCH.width, PITCH.height, {
      viewport: { x: -30, y: -20, width: 200, height: 150 },
    });

    const box = ctx.ofKind('strokeRect')[1];
    expect(box?.args[0] as number).toBeGreaterThanOrEqual(frame.x);
    expect(box?.args[2] as number).toBeLessThanOrEqual(frame.width);
  });

  it('draws the ball as its own mark rather than as another athlete', () => {
    const w = world();
    const ball = w.spawn({ x: 52, y: 34, kind: 1, team: -1 });
    w.spawn({ x: 20, y: 20, team: 0 });

    const ctx = recordingCanvas();
    drawMinimap(
      ctx,
      minimapFrame(hudLayout(800, 400), PITCH.width, PITCH.height),
      view(),
      w,
      105,
      68,
      {
        ball,
      },
    );

    // One dot for the athlete, two marks for the ball: it is the thing you look for rather than
    // scan for, so it is drawn twice.
    expect(ctx.ofKind('arc')).toHaveLength(3);
  });

  it('rings the controlled athlete instead of tinting them (INV-11)', () => {
    const w = world();
    const a = w.spawn({ x: 20, y: 20, team: 0 });
    w.spawn({ x: 80, y: 40, team: 1 });

    const ctx = recordingCanvas();
    drawMinimap(ctx, minimapFrame(hudLayout(800, 400), 105, 68), view(a), w, 105, 68);

    // Two dots plus one ring: the ring is the extra arc, and it is a shape.
    expect(ctx.ofKind('arc')).toHaveLength(3);
    expect(ctx.ofKind('stroke').length).toBeGreaterThan(0);
  });
});
