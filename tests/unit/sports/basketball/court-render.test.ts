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
import { recordingCanvas, type RecordingCanvas } from '../../../helpers/canvas.ts';
import { basketballCourt, COURT, attackedBasket, CENTRE_Y } from '@/sports/basketball/court.ts';
import { courtKey, drawCourt, drawCourtSprite } from '@/sports/basketball/court-render.ts';
import type { ViewTransform } from '@/engine/render/renderer.ts';

/**
 * `recordingCanvas` records method calls, not property assignments — `fillStyle`/`strokeStyle`
 * never show up in `calls`/`recorded` at all, so two themes that draw the same geometry in
 * different colours look byte-identical to it. This traces every `fillStyle` assignment instead,
 * which is the one place theme actually shows up in the draw sequence.
 */
function fillStyleTrace(ctx: RecordingCanvas): string[] {
  const trace: string[] = [];
  let current = '';
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => current,
    set: (value: string) => {
      current = value;
      trace.push(value);
    },
  });
  return trace;
}

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

describe('sprite court rendering (T-13.5)', () => {
  it('draws strictly more than the disc court, and leaves the disc court unchanged', () => {
    const disc = recordingCanvas();
    drawCourt(disc, basketballCourt);

    const sprite = recordingCanvas();
    drawCourtSprite(sprite, basketballCourt);

    expect(sprite.recorded.length).toBeGreaterThan(disc.recorded.length);

    // The disc court's own call sequence — same calls, same order, same coordinates — is
    // untouched by this file's sprite work.
    const discAgain = recordingCanvas();
    drawCourt(discAgain, basketballCourt);
    expect(discAgain.calls).toEqual(disc.calls);
  });

  it('draws the apron outside the court rectangle, not inside it', () => {
    const ctx = recordingCanvas();
    drawCourtSprite(ctx, basketballCourt);

    // The apron is the fill that reaches past every edge of the court rect: negative origin, and
    // an extent bigger than COURT.length × COURT.width.
    const apron = ctx
      .ofKind('fillRect')
      .find((c) => (c.args[0] as number) < 0 && (c.args[1] as number) < 0);
    expect(apron).toBeDefined();
    const [x, y, w, h] = apron?.args as [number, number, number, number];
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
    // It reaches past the far edges too, not just the near ones.
    expect(x + w).toBeGreaterThan(COURT.length);
    expect(y + h).toBeGreaterThan(COURT.width);

    // Every other fill/stroke call stays within (or exactly on) the court boundary — the apron is
    // the one deliberate exception, never the reverse.
    for (const call of [...ctx.ofKind('fillRect'), ...ctx.ofKind('strokeRect')]) {
      if (call === apron) continue;
      const [cx, cy, cw, ch] = call.args as [number, number, number, number];
      expect(cx).toBeGreaterThanOrEqual(0);
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cx + cw).toBeLessThanOrEqual(COURT.length + 1e-9);
      expect(cy + ch).toBeLessThanOrEqual(COURT.width + 1e-9);
    }
  });

  it('draws the same number of commands in both themes, with different fills', () => {
    const dark = recordingCanvas();
    const darkFills = fillStyleTrace(dark);
    drawCourtSprite(dark, basketballCourt, 'dark');

    const light = recordingCanvas();
    const lightFills = fillStyleTrace(light);
    drawCourtSprite(light, basketballCourt, 'light');

    expect(light.recorded.length).toBe(dark.recorded.length);
    expect(darkFills.length).toBe(lightFills.length);
    expect(darkFills.length).toBeGreaterThan(0);
    expect(darkFills).not.toEqual(lightFills);
  });

  it('still draws both three-point arcs at the rules radius, centred on the rims', () => {
    const ctx = recordingCanvas();
    drawCourtSprite(ctx, basketballCourt);

    const threes = ctx.ofKind('arc').filter((call) => call.args[2] === COURT.threeArcRadius);
    expect(threes).toHaveLength(2);
    const centres = threes.map((call) => [call.args[0], call.args[1]]);
    expect(centres).toContainEqual([attackedBasket(1).x, CENTRE_Y]);
    expect(centres).toContainEqual([attackedBasket(0).x, CENTRE_Y]);
  });

  it('still draws the key at the rules dimensions, plus its inner keyed border', () => {
    const ctx = recordingCanvas();
    drawCourtSprite(ctx, basketballCourt);

    const keys = ctx
      .ofKind('fillRect')
      .filter((c) => c.args[2] === COURT.freeThrowFromBaseline && c.args[3] === COURT.keyWidth);
    expect(keys).toHaveLength(2);
    expect(keys.map((c) => c.args[0]).sort()).toEqual([0, COURT.length - 5.8]);

    // The keyed inner border: a strokeRect strictly inside one of the two key rectangles.
    const innerBorders = ctx
      .ofKind('strokeRect')
      .filter(
        (c) =>
          (c.args[2] as number) < COURT.freeThrowFromBaseline &&
          (c.args[3] as number) < COURT.keyWidth &&
          (c.args[3] as number) > COURT.keyWidth - 1,
      );
    expect(innerBorders.length).toBeGreaterThanOrEqual(2);
  });

  it('parquet bands cover the full court with no gap and no overhang', () => {
    const ctx = recordingCanvas();
    drawCourtSprite(ctx, basketballCourt);

    const bands = ctx
      .ofKind('fillRect')
      .filter(
        (c) => c.args[1] === 0 && c.args[3] === COURT.width && (c.args[2] as number) <= 1.4 + 1e-9,
      );
    expect(bands.length).toBeGreaterThan(1);

    const total = bands.reduce((sum, c) => sum + (c.args[2] as number), 0);
    expect(total).toBeCloseTo(COURT.length, 6);

    const rightmost = bands.reduce(
      (max, c) => Math.max(max, (c.args[0] as number) + (c.args[2] as number)),
      0,
    );
    expect(rightmost).toBeCloseTo(COURT.length, 6);
  });
});
