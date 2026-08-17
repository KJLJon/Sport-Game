/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.1 — Pitch geometry, zones, goals, boundary lines
 * @task    T-13.5 — Field rendering: pitch, court, rink, and gridiron in the chosen style
 * @story   US-4.1 — Play an 11v11 soccer match
 * @design  13-visual-overhaul.md §3.2 (ball, fields, dressing)
 *
 * Purpose: that the pitch is *drawn* from the same numbers it is *played* on, disc and sprite
 * alike, and that the sprite restyle (T-13.5) only adds to the disc pitch rather than displacing
 * it — the disc renderer is the performance floor and must stay exactly what it already is.
 */
import { describe, expect, it } from 'vitest';
import { recordingCanvas, type RecordingCanvas } from '../../../helpers/canvas.ts';
import { PITCH, soccerPitch } from '@/sports/soccer/pitch.ts';
import { drawPitch, drawPitchSprite, pitchKey } from '@/sports/soccer/pitch-render.ts';

/**
 * `recordingCanvas` records method calls, not property assignments — `fillStyle` never shows up
 * in `calls`/`recorded` at all, so two themes that draw the same geometry in different colours
 * look byte-identical to it. This traces every `fillStyle` assignment instead, which is the one
 * place theme actually shows up in the draw sequence.
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

describe('pitch rendering', () => {
  it('draws the touchlines, halfway line, and centre circle at the rules numbers', () => {
    const ctx = recordingCanvas();
    drawPitch(ctx, soccerPitch);

    expect(ctx.ofKind('strokeRect')).toContainEqual(
      expect.objectContaining({ args: [0, 0, PITCH.length, PITCH.width] }),
    );
    const circles = ctx.ofKind('arc').filter((c) => c.args[2] === PITCH.circleRadius);
    // The centre circle plus the two penalty "D"s, all struck at the same radius.
    expect(circles.length).toBeGreaterThanOrEqual(1);
  });

  it('keys the static layer on the viewport, not on the clock', () => {
    const view = { x: 52.5, y: 34, scale: 10, width: 900, height: 480 };
    expect(pitchKey(soccerPitch, view)).toBe(pitchKey(soccerPitch, { ...view }));
    expect(pitchKey(soccerPitch, view)).not.toBe(pitchKey(soccerPitch, { ...view, scale: 12 }));
  });
});

describe('sprite pitch rendering (T-13.5)', () => {
  it('draws strictly more than the disc pitch, and leaves the disc pitch unchanged', () => {
    const disc = recordingCanvas();
    drawPitch(disc, soccerPitch);

    const sprite = recordingCanvas();
    drawPitchSprite(sprite, soccerPitch);

    expect(sprite.recorded.length).toBeGreaterThan(disc.recorded.length);

    const discAgain = recordingCanvas();
    drawPitch(discAgain, soccerPitch);
    expect(discAgain.calls).toEqual(disc.calls);
  });

  it('draws the apron outside the pitch rectangle, not inside it', () => {
    const ctx = recordingCanvas();
    drawPitchSprite(ctx, soccerPitch);

    const apron = ctx
      .ofKind('fillRect')
      .find((c) => (c.args[0] as number) < 0 && (c.args[1] as number) < 0);
    expect(apron).toBeDefined();
    const [x, y, w, h] = apron?.args as [number, number, number, number];
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
    expect(x + w).toBeGreaterThan(PITCH.length);
    expect(y + h).toBeGreaterThan(PITCH.width);

    // Everything else — grass, bands, boxes, goal net, arcs — stays within the pitch rectangle
    // (goal boxes hang slightly behind the goal line by `PITCH.goalDepth`, which the rules already
    // treat as pitch-adjacent, not apron), except the apron fill itself.
    for (const call of ctx.ofKind('fillRect')) {
      if (call === apron) continue;
      const [cx, cy, cw, ch] = call.args as [number, number, number, number];
      expect(cx).toBeGreaterThanOrEqual(-PITCH.goalDepth - 1e-9);
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cx + cw).toBeLessThanOrEqual(PITCH.length + 1e-9);
      expect(cy + ch).toBeLessThanOrEqual(PITCH.width + 1e-9);
    }
  });

  it('draws the same number of commands in both themes, with different fills', () => {
    const dark = recordingCanvas();
    const darkFills = fillStyleTrace(dark);
    drawPitchSprite(dark, soccerPitch, 'dark');

    const light = recordingCanvas();
    const lightFills = fillStyleTrace(light);
    drawPitchSprite(light, soccerPitch, 'light');

    expect(light.recorded.length).toBe(dark.recorded.length);
    expect(darkFills.length).toBe(lightFills.length);
    expect(darkFills.length).toBeGreaterThan(0);
    expect(darkFills).not.toEqual(lightFills);
  });

  it('still draws the penalty and goal boxes at the rules dimensions', () => {
    const ctx = recordingCanvas();
    drawPitchSprite(ctx, soccerPitch);

    const penaltyBoxes = ctx
      .ofKind('strokeRect')
      .filter((c) => c.args[2] === PITCH.penaltyAreaDepth && c.args[3] === PITCH.penaltyAreaWidth);
    expect(penaltyBoxes.length).toBeGreaterThanOrEqual(2);

    const goalBoxes = ctx
      .ofKind('strokeRect')
      .filter((c) => c.args[2] === PITCH.goalAreaDepth && c.args[3] === PITCH.goalAreaWidth);
    expect(goalBoxes.length).toBeGreaterThanOrEqual(2);
  });

  it('nets the goal box with an interior mesh instead of a bare outline', () => {
    const ctx = recordingCanvas();
    drawPitchSprite(ctx, soccerPitch);

    const goalOutlines = ctx
      .ofKind('strokeRect')
      .filter((c) => c.args[2] === PITCH.goalDepth && c.args[3] === PITCH.goalWidth);
    expect(goalOutlines).toHaveLength(2);

    // Mesh lines run inside each goal mouth: x in [-goalDepth, 0] for side 0, [length, length +
    // goalDepth] for side 1. Plenty of line segments land there beyond the two outlines.
    const insideLeftGoal = ctx
      .ofKind('lineTo')
      .filter(
        (c) => (c.args[0] as number) >= -PITCH.goalDepth - 1e-9 && (c.args[0] as number) <= 0,
      );
    expect(insideLeftGoal.length).toBeGreaterThan(0);
  });

  it('mow bands are finer than the disc pitch, and none overhangs the pitch rectangle', () => {
    // Both renderers paint a full grass fill first, then lay stripe-coloured bands only over
    // every other slice — so "finer" is measured as more, narrower stripe bands, not full
    // coverage by the stripe fills alone.
    const discBandWidth = PITCH.length / 9; // disc's STRIPES
    const disc = recordingCanvas();
    drawPitch(disc, soccerPitch);
    const discBands = disc
      .ofKind('fillRect')
      .filter(
        (c) =>
          c.args[1] === 0 &&
          c.args[3] === PITCH.width &&
          (c.args[2] as number) <= discBandWidth + 1e-9,
      );

    const spriteBandWidth = PITCH.length / 21; // sprite's SPRITE_STYLE.stripeCount
    const ctx = recordingCanvas();
    drawPitchSprite(ctx, soccerPitch);
    const spriteBands = ctx
      .ofKind('fillRect')
      .filter(
        (c) =>
          c.args[1] === 0 &&
          c.args[3] === PITCH.width &&
          (c.args[2] as number) <= spriteBandWidth + 1e-9,
      );

    expect(spriteBands.length).toBeGreaterThan(discBands.length);
    for (const band of spriteBands) {
      const [x, , w] = band.args as [number, number, number];
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(PITCH.length + 1e-9);
    }
  });
});
