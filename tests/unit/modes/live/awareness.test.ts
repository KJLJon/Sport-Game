/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.3 — Off-screen awareness: edge indicators for teammates, opponents, and the ball,
 *          with distance
 * @story   US-2.3 — See what is happening on a small screen
 * @story   US-4.3 — Know where the pressure is coming from
 * @design  06-game-design.md §4, 10-ui-ux.md §11
 * @invariant INV-11 (no information by colour alone)
 *
 * Purpose: which off-screen things get an arrow, in what order, and the promise that the four kinds
 * are told apart by shape rather than by colour.
 *
 * The first three cases are inherited from T-2.10's teammate arrows, which these replaced — the
 * behaviour they checked is still required, it simply now applies to more than teammates.
 */
import { describe, expect, it } from 'vitest';
import { recordingCanvas } from '../../../helpers/canvas.ts';
import { World } from '@/engine/world.ts';
import { drawEdgeMarkers, edgeMarkers, type EdgeMarker } from '@/modes/live/awareness.ts';
import { DEFAULT_HUD_THEME, hudLayout } from '@/modes/live/hud.ts';
import { createBoxScore } from '@/modes/live/box-score.ts';
import type { MatchView } from '@/modes/live/match.ts';

const LAYOUT = hudLayout(800, 400);

/** A projection zoomed in enough that the far half of a 28 × 15 court is off the edge. */
const toScreen = (x: number, y: number) => ({ x: x * 40, y: y * 40 });

function view(overrides: Partial<MatchView['status']> = {}): MatchView {
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
      controlled: -1,
      stoppage: null,
      meter: null,
      periodClock: 600,
      ...overrides,
    },
  };
}

function world() {
  return new World({ width: 28, height: 15, cellSize: 3, capacity: 32 });
}

describe('what gets an arrow', () => {
  it('points at what the camera cannot see, and not at what it can', () => {
    const w = world();
    const ball = w.spawn({ x: 2, y: 2, kind: 1, team: -1 });
    const near = w.spawn({ x: 4, y: 4, team: 0 });
    const far = w.spawn({ x: 26, y: 14, team: 0 });

    const markers = edgeMarkers(w, view(), ball, toScreen, LAYOUT);
    const entities = markers.map((m) => m.entity);

    expect(entities).toContain(far);
    expect(entities).not.toContain(near);
  });

  it('points at the ball, which the arrows it replaced never did', () => {
    const w = world();
    const ball = w.spawn({ x: 27, y: 14, kind: 1, team: -1 });
    w.spawn({ x: 2, y: 2, team: 0 });

    const markers = edgeMarkers(w, view(), ball, toScreen, LAYOUT);

    // The whole reason this replaced `offScreenIndicators`: with a following camera the ball is the
    // thing that leaves the frame, and it had no arrow at all.
    expect(markers[0]?.kind).toBe('ball');
    expect(markers[0]?.entity).toBe(ball);
  });

  it('points at opponents too, and labels them as such', () => {
    const w = world();
    const ball = w.spawn({ x: 2, y: 2, kind: 1, team: -1 });
    w.spawn({ x: 27, y: 14, team: 1 });

    const markers = edgeMarkers(w, view(), ball, toScreen, LAYOUT);
    expect(markers.map((m) => m.kind)).toContain('opponent');
  });

  it('does not point at the athlete you are already controlling when it is on screen', () => {
    const w = world();
    const ball = w.spawn({ x: 2, y: 2, kind: 1, team: -1 });
    const controlled = w.spawn({ x: 3, y: 3, team: 0 });

    const markers = edgeMarkers(w, view({ controlled }), ball, toScreen, LAYOUT);
    expect(markers.map((m) => m.entity)).not.toContain(controlled);
  });

  it('does point at it when the ball has taken the camera away from it', () => {
    const w = world();
    const ball = w.spawn({ x: 2, y: 2, kind: 1, team: -1 });
    const controlled = w.spawn({ x: 27, y: 14, team: 0 });

    const markers = edgeMarkers(w, view({ controlled }), ball, toScreen, LAYOUT);
    const own = markers.find((m) => m.entity === controlled);

    expect(own?.kind).toBe('controlled');
  });

  it('keeps every arrow inside the viewport, not half over the edge', () => {
    const w = world();
    const ball = w.spawn({ x: 27, y: 14, kind: 1, team: -1 });
    const margin = 26;

    const markers = edgeMarkers(w, view(), ball, () => ({ x: 5000, y: -3000 }), LAYOUT, { margin });

    expect(markers).not.toHaveLength(0);
    for (const marker of markers) {
      expect(marker.x).toBeLessThanOrEqual(LAYOUT.width - margin);
      expect(marker.x).toBeGreaterThanOrEqual(margin);
      expect(marker.y).toBeGreaterThanOrEqual(margin);
      expect(marker.y).toBeLessThanOrEqual(LAYOUT.height - margin);
    }
  });
});

describe('priority and volume', () => {
  it('shows the ball first, then your athlete, then opponents, then teammates', () => {
    const w = world();
    const ball = w.spawn({ x: 27, y: 14, kind: 1, team: -1 });
    const controlled = w.spawn({ x: 26, y: 13, team: 0 });
    w.spawn({ x: 25, y: 14, team: 1 });
    w.spawn({ x: 24, y: 14, team: 0 });

    const kinds = edgeMarkers(w, view({ controlled }), ball, toScreen, LAYOUT).map((m) => m.kind);
    expect(kinds.slice(0, 2)).toEqual(['ball', 'controlled']);
    expect(kinds.indexOf('opponent')).toBeLessThan(kinds.indexOf('teammate'));
  });

  it('caps how many of each it will draw', () => {
    const w = world();
    const ball = w.spawn({ x: 2, y: 2, kind: 1, team: -1 });
    for (let i = 0; i < 6; i++) w.spawn({ x: 20 + i * 0.5, y: 14, team: 1 });
    for (let i = 0; i < 6; i++) w.spawn({ x: 20 + i * 0.5, y: 13, team: 0 });

    const markers = edgeMarkers(w, view(), ball, toScreen, LAYOUT);
    const opponents = markers.filter((m) => m.kind === 'opponent');
    const teammates = markers.filter((m) => m.kind === 'teammate');

    // A screen edged with twelve arrows conveys less than one edged with five.
    expect(opponents).toHaveLength(2);
    expect(teammates).toHaveLength(3);
  });

  it('keeps the nearest ones when it has to choose', () => {
    const w = world();
    const ball = w.spawn({ x: 2, y: 2, kind: 1, team: -1 });
    const controlled = w.spawn({ x: 2, y: 3, team: 0 });
    const close = w.spawn({ x: 20, y: 14, team: 1 });
    const closer = w.spawn({ x: 19, y: 13, team: 1 });
    w.spawn({ x: 27, y: 14, team: 1 });

    const markers = edgeMarkers(w, view({ controlled }), ball, toScreen, LAYOUT);
    const opponents = markers.filter((m) => m.kind === 'opponent').map((m) => m.entity);

    expect(opponents).toEqual([closer, close]);
  });
});

describe('distance', () => {
  it('is measured in world units from the athlete you are controlling', () => {
    const w = world();
    // The ball off the bottom of the frame, the athlete you are steering still in it.
    const ball = w.spawn({ x: 2, y: 14, kind: 1, team: -1 });
    const controlled = w.spawn({ x: 2, y: 2, team: 0 });

    const markers = edgeMarkers(w, view({ controlled }), ball, toScreen, LAYOUT);
    const ballMarker = markers.find((m) => m.kind === 'ball');

    // Twelve metres up the court, whatever the arrow's screen position ended up being.
    expect(ballMarker?.distance).toBeCloseTo(12, 6);
  });

  it('falls back to the ball when nobody is being controlled', () => {
    const w = world();
    const ball = w.spawn({ x: 2, y: 2, kind: 1, team: -1 });
    w.spawn({ x: 2, y: 14, team: 0 });

    const markers = edgeMarkers(w, view(), ball, toScreen, LAYOUT);
    expect(markers.find((m) => m.kind === 'teammate')?.distance).toBeCloseTo(12, 6);
  });

  it('is labelled on the ball and on your athlete, and on nothing else', () => {
    const w = world();
    const ball = w.spawn({ x: 27, y: 14, kind: 1, team: -1 });
    const controlled = w.spawn({ x: 26, y: 13, team: 0 });
    w.spawn({ x: 25, y: 14, team: 1 });

    const markers = edgeMarkers(w, view({ controlled }), ball, toScreen, LAYOUT);
    for (const marker of markers) {
      if (marker.kind === 'ball' || marker.kind === 'controlled') {
        expect(marker.label).toMatch(/^\d+ m$/);
      } else {
        expect(marker.label).toBeNull();
      }
    }
  });
});

describe('drawing', () => {
  function marker(overrides: Partial<EdgeMarker> = {}): EdgeMarker {
    return {
      entity: 1,
      kind: 'teammate',
      x: 100,
      y: 100,
      angle: 0,
      distance: 10,
      label: null,
      ...overrides,
    };
  }

  it('draws one silhouette per marker', () => {
    const ctx = recordingCanvas();
    drawEdgeMarkers(ctx, [marker(), marker({ entity: 2, x: 200 })], LAYOUT, DEFAULT_HUD_THEME);

    expect(ctx.ofKind('save')).toHaveLength(2);
    expect(ctx.ofKind('restore')).toHaveLength(2);
  });

  it('tells the four kinds apart by shape, not only by colour (INV-11)', () => {
    const shapes = new Map<string, string>();

    for (const kind of ['ball', 'controlled', 'opponent', 'teammate'] as const) {
      const ctx = recordingCanvas();
      drawEdgeMarkers(ctx, [marker({ kind })], LAYOUT, DEFAULT_HUD_THEME);
      // The sequence of path calls *is* the silhouette. Two kinds drawing the same sequence would
      // be two kinds distinguished by colour alone, which is the thing INV-11 forbids.
      shapes.set(
        kind,
        ctx.recorded
          .map((call) => call.name)
          .filter((k) => k !== 'save' && k !== 'restore' && k !== 'translate' && k !== 'rotate')
          .join(','),
      );
    }

    expect(new Set(shapes.values()).size).toBe(4);
  });

  it('draws the label horizontally, whatever angle the arrow sits at', () => {
    const ctx = recordingCanvas();
    drawEdgeMarkers(
      ctx,
      [marker({ kind: 'ball', angle: 2.4, label: '18 m' })],
      LAYOUT,
      DEFAULT_HUD_THEME,
    );

    const text = ctx.ofKind('fillText');
    expect(text).toHaveLength(1);
    // Outside the save/restore that rotated the arrow — a distance printed at 140° is not a
    // distance anybody reads.
    const restoreIndex = ctx.recorded.findIndex((call) => call.name === 'restore');
    const textIndex = ctx.recorded.findIndex((call) => call.name === 'fillText');
    expect(textIndex).toBeGreaterThan(restoreIndex);
  });

  it('draws a nearer marker larger than a distant one', () => {
    const near = recordingCanvas();
    const far = recordingCanvas();
    drawEdgeMarkers(near, [marker({ kind: 'ball', distance: 2 })], LAYOUT, DEFAULT_HUD_THEME);
    drawEdgeMarkers(far, [marker({ kind: 'ball', distance: 60 })], LAYOUT, DEFAULT_HUD_THEME);

    const radius = (ctx: ReturnType<typeof recordingCanvas>) =>
      (ctx.ofKind('arc')[0]?.args[2] as number) ?? 0;

    expect(radius(near)).toBeGreaterThan(radius(far));
  });
});
