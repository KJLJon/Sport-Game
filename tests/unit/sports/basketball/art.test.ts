/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.12 — Basketball art & audio pass
 * @story   US-2.3 — See the whole field on a small screen
 *
 * Purpose: asserts the properties the art pass promises rather than an exact call sequence — that
 * detail tiers actually draw less, that the two teams never differ by hue alone, and that a shadow
 * genuinely encodes the ball's height. A test that pinned the exact command list would break on
 * every cosmetic tweak; these break only if the promise itself breaks.
 */
import { describe, expect, it } from 'vitest';
import { recordingCanvas } from '../../../helpers/canvas.ts';
import { Detail } from '@/engine/render/renderer.ts';
import {
  ATHLETE_RADIUS,
  BALL_RADIUS,
  drawAthlete,
  drawBall,
  drawControlledMarker,
  paletteFor,
} from '@/sports/basketball/art.ts';

describe('paletteFor', () => {
  it('defaults dark and differs from light', () => {
    const dark = paletteFor();
    const light = paletteFor('light');
    expect(dark).toEqual(paletteFor('dark'));
    expect(dark.court.floor).not.toBe(light.court.floor);
    expect(dark.teams[0].fill).not.toBe(light.teams[0].fill);
  });

  it('keeps the two teams distinguishable from each other in both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      const palette = paletteFor(theme);
      expect(palette.teams[0].fill).not.toBe(palette.teams[1].fill);
    }
  });
});

describe('drawAthlete — level of detail', () => {
  const team0 = paletteFor('dark').teams[0];

  it('draws strictly fewer commands at MINIMAL than at FULL', () => {
    const full = recordingCanvas();
    drawAthlete(full, 5, 5, 0, team0, Detail.FULL, { team: 0 });

    const minimal = recordingCanvas();
    drawAthlete(minimal, 5, 5, 0, team0, Detail.MINIMAL, { team: 0 });

    expect(minimal.recorded.length).toBeLessThan(full.recorded.length);
  });

  it('draws a facing tick only at FULL', () => {
    const full = recordingCanvas();
    drawAthlete(full, 5, 5, Math.PI / 4, team0, Detail.FULL, { team: 0 });

    const reduced = recordingCanvas();
    drawAthlete(reduced, 5, 5, Math.PI / 4, team0, Detail.REDUCED, { team: 0 });

    // The facing tick is the one line from centre outward — a moveTo at the athlete's own
    // position followed by a stroke — which REDUCED has no reason to draw.
    const fullLines = full.ofKind('lineTo');
    const reducedLines = reduced.ofKind('lineTo');
    expect(fullLines.length).toBeGreaterThan(reducedLines.length);
  });
});

describe('drawAthlete — team identity is never colour alone', () => {
  it('team 1 draws a marking commmand team 0 does not, at every non-minimal tier', () => {
    for (const detail of [Detail.FULL, Detail.REDUCED] as const) {
      const home = recordingCanvas();
      drawAthlete(home, 5, 5, 0, paletteFor('dark').teams[0], detail, { team: 0 });

      const away = recordingCanvas();
      drawAthlete(away, 5, 5, 0, paletteFor('dark').teams[1], detail, { team: 1 });

      expect(away.ofKind('stroke').length).toBeGreaterThan(home.ofKind('stroke').length);
    }
  });

  it('the minimal dot is a different shape per team, not just a different fill', () => {
    const home = recordingCanvas();
    drawAthlete(home, 5, 5, 0, paletteFor('dark').teams[0], Detail.MINIMAL, { team: 0 });

    const away = recordingCanvas();
    drawAthlete(away, 5, 5, 0, paletteFor('dark').teams[1], Detail.MINIMAL, { team: 1 });

    // Team 0 stays a circle (an `arc` call); team 1 becomes a diamond (no `arc`, a closed path
    // built from `lineTo`s instead) — a shape difference survives even where there is no room
    // left to draw a marking on top of a fill.
    expect(home.ofKind('arc').length).toBeGreaterThan(0);
    expect(away.ofKind('arc').length).toBe(0);
    expect(away.ofKind('lineTo').length).toBeGreaterThan(0);
  });
});

describe('drawAthlete — controlled marker', () => {
  it('is a shape drawn in addition to the body, not a recolour of it', () => {
    const plain = recordingCanvas();
    drawAthlete(plain, 5, 5, 0, paletteFor('dark').teams[0], Detail.FULL, { team: 0 });

    const controlled = recordingCanvas();
    drawAthlete(controlled, 5, 5, 0, paletteFor('dark').teams[0], Detail.FULL, {
      team: 0,
      controlled: true,
    });

    // Same number of `fill` calls either way — the marker adds strokes, it never adds or changes
    // a fill.
    expect(controlled.ofKind('fill').length).toBe(plain.ofKind('fill').length);
    expect(controlled.ofKind('stroke').length).toBeGreaterThan(plain.ofKind('stroke').length);
  });

  it('survives down to MINIMAL, since which athlete is mine is not decoration', () => {
    const controlled = recordingCanvas();
    drawAthlete(controlled, 5, 5, 0, paletteFor('dark').teams[0], Detail.MINIMAL, {
      team: 0,
      controlled: true,
    });
    expect(controlled.ofKind('stroke').length).toBeGreaterThan(0);
  });

  it('drawControlledMarker never touches fillStyle — it is a stroked shape, not a tint', () => {
    const ctx = recordingCanvas();
    drawControlledMarker(ctx, 5, 5, ATHLETE_RADIUS, Detail.FULL);
    expect(ctx.ofKind('fill').length).toBe(0);
    expect(ctx.ofKind('stroke').length).toBeGreaterThan(0);
  });
});

describe('drawBall — height reads through the shadow', () => {
  const palette = paletteFor('dark');

  it('shrinks the shadow as z rises, at the same detail tier', () => {
    const low = recordingCanvas();
    drawBall(low, 10, 5, 0, palette, Detail.FULL);
    const high = recordingCanvas();
    drawBall(high, 10, 5, 3, palette, Detail.FULL);

    const shadowRadius = (ctx: typeof low): number => ctx.ofKind('arc')[0]?.args[2] as number;
    expect(shadowRadius(high)).toBeLessThan(shadowRadius(low));
  });

  it('never lets the shadow disappear entirely, even at the top of a lob', () => {
    const ctx = recordingCanvas();
    drawBall(ctx, 10, 5, 50, palette, Detail.FULL);
    const shadowRadius = ctx.ofKind('arc')[0]?.args[2] as number;
    expect(shadowRadius).toBeGreaterThan(0);
  });

  it('draws no shadow at MINIMAL — one dot, not two circles', () => {
    const ctx = recordingCanvas();
    drawBall(ctx, 10, 5, 1, palette, Detail.MINIMAL);
    expect(ctx.ofKind('arc').length).toBe(1);
  });

  it('defaults to the physics ball radius', () => {
    expect(BALL_RADIUS).toBeGreaterThan(0);
    const ctx = recordingCanvas();
    drawBall(ctx, 10, 5, 0, palette, Detail.REDUCED);
    const ballArc = ctx.ofKind('arc').at(-1);
    expect(ballArc?.args[2]).toBe(BALL_RADIUS);
  });
});
