/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.10 — Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators
 * @story   US-2.3 — See what is happening
 * @story   US-2.4 — See the state of the match at a glance
 * @design  10-ui-ux.md §4 (safe areas), §6 (accessibility)
 * @invariant INV-11 (no information by colour alone)
 *
 * Purpose: the layout maths and the accessibility promises. The safe-area cases are the ones worth
 * having, because a notch is not something you can check without a device — unless the layout is a
 * pure function, which is why it is one.
 */
import { describe, expect, it } from 'vitest';
import { recordingCanvas } from '../../../helpers/canvas.ts';
import { World } from '@/engine/world.ts';
import {
  DEFAULT_HUD_THEME,
  boxRows,
  drawEdgeIndicators,
  drawHud,
  drawMinimap,
  foulLabel,
  formatActionClock,
  formatClock,
  hudLayout,
  offScreenIndicators,
  type SafeArea,
} from '@/modes/live/hud.ts';
import { applyEvent, createBoxScore } from '@/modes/live/box-score.ts';
import { EventKind, event } from '@/engine/match/events.ts';
import type { MatchView } from '@/modes/live/match.ts';

const NOTCH: SafeArea = { top: 12, right: 44, bottom: 10, left: 44 };

function view(overrides: Partial<MatchView> = {}): MatchView {
  const box = createBoxScore();
  applyEvent(box, event(EventKind.SCORE, 10, 0, { actor: 1, value: 3 }));
  applyEvent(box, event(EventKind.SHOT, 9, 0, { actor: 1, value: 3 }));

  return {
    phase: 'live',
    period: 2,
    periodName: 'Quarter',
    finished: false,
    score: [42, 38],
    playerSide: 0,
    steps: 1000,
    box,
    status: {
      actionClock: 18,
      teamFouls: [3, 5],
      bonus: [false, true],
      possession: 0,
      controlled: 2,
      stoppage: null,
      meter: null,
      periodClock: 415,
    },
    ...overrides,
  };
}

describe('layout', () => {
  it('centres the board and the minimap in the safe area, not the viewport', () => {
    const plain = hudLayout(800, 400);
    const notched = hudLayout(800, 400, NOTCH);

    // A notch on the left only pushes the centre right; a symmetric one leaves it where it was.
    const lopsided = hudLayout(800, 400, { ...NOTCH, right: 0 });
    expect(lopsided.board.x + lopsided.board.width / 2).toBeGreaterThan(
      plain.board.x + plain.board.width / 2,
    );
    expect(notched.board.x + notched.board.width / 2).toBeCloseTo(
      plain.board.x + plain.board.width / 2,
      0,
    );
  });

  it('never puts anything under an inset', () => {
    const layout = hudLayout(760, 380, NOTCH);
    expect(layout.board.y).toBeGreaterThanOrEqual(NOTCH.top);
    expect(layout.board.x).toBeGreaterThanOrEqual(NOTCH.left);
    expect(layout.board.x + layout.board.width).toBeLessThanOrEqual(760 - NOTCH.right);
    expect(layout.minimap.y + layout.minimap.height).toBeLessThanOrEqual(380 - NOTCH.bottom);
    expect(layout.meter.x + layout.meter.width).toBeLessThanOrEqual(760 - NOTCH.right);
  });

  it('survives a viewport too small for the design', () => {
    const layout = hudLayout(320, 180, NOTCH);
    expect(layout.board.width).toBeGreaterThan(0);
    expect(layout.board.x).toBeGreaterThanOrEqual(NOTCH.left);
    expect(layout.minimap.width).toBeGreaterThan(0);
  });

  it('scales type with the viewport and the user s UI scale, within bounds', () => {
    expect(hudLayout(1200, 600).scale).toBeGreaterThan(hudLayout(600, 300).scale);
    expect(hudLayout(600, 300, NO_SCALE, 1.3).scale).toBeGreaterThan(hudLayout(600, 300).scale);
    expect(hudLayout(4000, 2000).scale).toBeLessThanOrEqual(1.4);
    expect(hudLayout(200, 100).scale).toBeGreaterThanOrEqual(0.75);
  });

  it('keeps the minimap at the court s aspect ratio', () => {
    const layout = hudLayout(800, 400);
    expect(layout.minimap.width / layout.minimap.height).toBeCloseTo(28 / 15, 1);
  });
});

const NO_SCALE: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

describe('clocks', () => {
  it('shows a game clock as minutes and a last minute as tenths', () => {
    expect(formatClock(415)).toBe('6:55');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(59.4)).toBe('59.4');
    expect(formatClock(-5)).toBe('0.0');
  });

  it('rounds the action clock up, because 0.2 seconds left is still a second on the clock', () => {
    expect(formatActionClock(23.1)).toBe('24');
    expect(formatActionClock(0.2)).toBe('1');
    expect(formatActionClock(0)).toBe('0');
  });
});

describe('reading it without colour (INV-11)', () => {
  it('marks possession with a caret rather than a highlight', () => {
    const ctx = recordingCanvas();
    drawHud(ctx, view(), hudLayout(800, 400));
    const texts = ctx.ofKind('fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('▸');
  });

  it('spells the bonus out', () => {
    expect(foulLabel(5, true)).toContain('BONUS');
    expect(foulLabel(3, false)).not.toContain('BONUS');

    const ctx = recordingCanvas();
    drawHud(ctx, view(), hudLayout(800, 400));
    const texts = ctx.ofKind('fillText').map((c) => String(c.args[0]));
    expect(texts.some((t) => t.includes('BONUS'))).toBe(true);
  });

  it('states the reason play has stopped', () => {
    const ctx = recordingCanvas();
    drawHud(
      ctx,
      view({ status: { ...view().status, stoppage: 'shot clock' } }),
      hudLayout(800, 400),
    );
    const texts = ctx.ofKind('fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('SHOT CLOCK');
  });

  it('rings the controlled athlete on the minimap instead of tinting them', () => {
    const world = new World({ width: 28, height: 15, cellSize: 3, capacity: 8 });
    const a = world.spawn({ x: 5, y: 5, team: 0 });
    world.spawn({ x: 20, y: 9, team: 1 });

    const ctx = recordingCanvas();
    drawMinimap(
      ctx,
      view({ status: { ...view().status, controlled: a } }),
      world,
      28,
      15,
      hudLayout(800, 400),
    );

    // Two dots plus one ring: the ring is the extra arc, and it is a shape.
    expect(ctx.ofKind('arc')).toHaveLength(3);
    expect(ctx.ofKind('stroke').length).toBeGreaterThan(0);
  });
});

describe('the scoreboard', () => {
  it('draws both scores, the period, and the clock', () => {
    const ctx = recordingCanvas();
    drawHud(ctx, view(), hudLayout(800, 400));
    const texts = ctx.ofKind('fillText').map((c) => String(c.args[0]));

    expect(texts).toContain('42');
    expect(texts).toContain('38');
    expect(texts).toContain('Quarter 2');
    expect(texts).toContain('6:55');
    expect(texts).toContain('18');
  });

  it('omits what the sport does not have', () => {
    const plain = view({
      status: { ...view().status, actionClock: null, teamFouls: null, bonus: null },
    });
    const ctx = recordingCanvas();
    drawHud(ctx, plain, hudLayout(800, 400));
    const texts = ctx.ofKind('fillText').map((c) => String(c.args[0]));

    expect(texts).toContain('42');
    expect(texts.some((t) => t.includes('PF'))).toBe(false);
  });

  it('draws the release meter only while something is charging', () => {
    const idle = recordingCanvas();
    drawHud(idle, view(), hudLayout(800, 400));
    const idleRects = idle.ofKind('fillRect').length;

    const charging = recordingCanvas();
    drawHud(charging, view({ status: { ...view().status, meter: 0.6 } }), hudLayout(800, 400));
    expect(charging.ofKind('fillRect').length).toBeGreaterThan(idleRects);
  });
});

describe('off-screen teammates', () => {
  function world() {
    const w = new World({ width: 28, height: 15, cellSize: 3, capacity: 8 });
    return w;
  }

  it('points at a teammate the camera cannot see, and not at one it can', () => {
    const w = world();
    const near = w.spawn({ x: 4, y: 4, team: 0 });
    const far = w.spawn({ x: 26, y: 14, team: 0 });
    const layout = hudLayout(800, 400);

    // A camera zoomed in enough that the far corner is off the edge.
    const toScreen = (x: number, y: number) => ({ x: x * 40, y: y * 40 });
    const indicators = offScreenIndicators(w, view(), toScreen, layout);

    expect(indicators.map((i) => i.athlete)).toContain(far);
    expect(indicators.map((i) => i.athlete)).not.toContain(near);
  });

  it('never points at the opposition or at the athlete you are already controlling', () => {
    const w = world();
    const controlled = w.spawn({ x: 27, y: 14, team: 0 });
    w.spawn({ x: 27, y: 1, team: 1 });
    const layout = hudLayout(800, 400);

    const indicators = offScreenIndicators(
      w,
      view({ status: { ...view().status, controlled } }),
      (x, y) => ({ x: x * 40, y: y * 40 }),
      layout,
    );
    expect(indicators).toHaveLength(0);
  });

  it('keeps every arrow inside the viewport, not half off the edge', () => {
    const w = world();
    w.spawn({ x: 27, y: 14, team: 0 });
    const layout = hudLayout(800, 400);
    const margin = 26;

    const indicators = offScreenIndicators(
      w,
      view(),
      () => ({ x: 5000, y: -3000 }),
      layout,
      margin,
    );
    for (const indicator of indicators) {
      expect(indicator.x).toBeLessThanOrEqual(layout.width - margin);
      expect(indicator.x).toBeGreaterThanOrEqual(margin);
      expect(indicator.y).toBeGreaterThanOrEqual(margin);
    }
  });

  it('draws one arrow per indicator', () => {
    const ctx = recordingCanvas();
    drawEdgeIndicators(
      ctx,
      [
        { athlete: 1, x: 10, y: 10, angle: 0, distance: 100 },
        { athlete: 2, x: 20, y: 20, angle: 1, distance: 100 },
      ],
      DEFAULT_HUD_THEME,
    );
    expect(ctx.ofKind('fill')).toHaveLength(2);
    expect(ctx.ofKind('save')).toHaveLength(2);
    expect(ctx.ofKind('restore')).toHaveLength(2);
  });
});

describe('the live box score', () => {
  it('is rows of strings, ending in a team total', () => {
    const rows = boxRows(view(), 0);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[rows.length - 1]?.label).toBe('Team');
    expect(rows[0]?.points).toBe('3');
    expect(rows[0]?.shooting).toBe('1-1');
  });

  it('is empty but for the total when nobody has done anything', () => {
    const rows = boxRows(view({ box: createBoxScore() }), 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Team', points: '0', shooting: '0-0' });
  });
});
