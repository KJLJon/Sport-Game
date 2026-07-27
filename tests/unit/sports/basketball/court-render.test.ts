/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.1 — Court geometry, zones, arc, key, hoop, boundaries
 * @story   US-3.1 — Play a 5v5 basketball match
 *
 * Purpose: that the court is *drawn* from the same numbers it is *played* on. The assertion that
 * matters is the arc: it is the one piece of line art with a derived sweep, and an arc drawn at a
 * different radius from the one `isThreePointShot` uses would be invisible in tests and glaring on
 * a phone.
 */
import { describe, expect, it } from 'vitest';
import { recordingCanvas } from '../../../helpers/canvas.ts';
import { basketballCourt, COURT, attackedBasket, CENTRE_Y } from '@/sports/basketball/court.ts';
import { courtKey, drawCourt } from '@/sports/basketball/court-render.ts';
import type { ViewTransform } from '@/engine/render/renderer.ts';

const VIEW: ViewTransform = { x: 14, y: 7.5, scale: 24, width: 900, height: 480 };

describe('court rendering', () => {
  it('draws both three-point arcs at the rules radius, centred on the rims', () => {
    const ctx = recordingCanvas();
    drawCourt(ctx, basketballCourt);

    const arcs = ctx.ofKind('arc');
    const threes = arcs.filter((call) => call.args[2] === COURT.threeArcRadius);
    expect(threes).toHaveLength(2);

    const centres = threes.map((call) => [call.args[0], call.args[1]]);
    expect(centres).toContainEqual([attackedBasket(1).x, CENTRE_Y]);
    expect(centres).toContainEqual([attackedBasket(0).x, CENTRE_Y]);
  });

  it('draws a rim, a backboard, and a key at each end', () => {
    const ctx = recordingCanvas();
    drawCourt(ctx, basketballCourt);

    expect(ctx.ofKind('arc').filter((c) => c.args[2] === COURT.rimRadius)).toHaveLength(2);
    expect(ctx.ofKind('arc').filter((c) => c.args[2] === COURT.restrictedAreaRadius)).toHaveLength(
      2,
    );
    // Two keys, filled and stroked, at 5.8 × 4.9.
    const keys = ctx
      .ofKind('fillRect')
      .filter((c) => c.args[2] === COURT.freeThrowFromBaseline && c.args[3] === COURT.keyWidth);
    expect(keys).toHaveLength(2);
    expect(keys.map((c) => c.args[0]).sort()).toEqual([0, COURT.length - 5.8]);
  });

  it('sweeps each arc so it ends on the corner lines', () => {
    const ctx = recordingCanvas();
    drawCourt(ctx, basketballCourt);

    for (const call of ctx.ofKind('arc').filter((c) => c.args[2] === COURT.threeArcRadius)) {
      const [cx, cy, r, start, end] = call.args as [number, number, number, number, number];
      for (const angle of [start, end]) {
        const y = cy + r * Math.sin(angle);
        expect(Math.abs(y - CENTRE_Y)).toBeCloseTo(CENTRE_Y - COURT.threeCornerInset, 6);
        // And the endpoint is on the court, not off the side of it.
        expect(cx + r * Math.cos(angle)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keys the static layer on the viewport, not on the clock', () => {
    expect(courtKey(basketballCourt, VIEW)).toBe(courtKey(basketballCourt, { ...VIEW }));
    expect(courtKey(basketballCourt, VIEW)).not.toBe(
      courtKey(basketballCourt, { ...VIEW, scale: 30 }),
    );
  });
});
