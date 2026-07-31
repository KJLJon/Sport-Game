/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.16 — Soccer art & audio pass
 * @story   US-2.3 — See the whole field on a small screen
 *
 * Purpose: the same properties basketball's art test asserts — detail tiers draw less, teams never
 * differ by hue alone, the ball's height reads through its shadow — plus the two claims that are
 * soccer's own: the keeper is visibly a keeper, and the ball is not a basketball.
 *
 * Properties, never an exact call sequence. A test that pinned the command list would break on every
 * cosmetic tweak; these break only if the promise does.
 */
import { describe, expect, it } from 'vitest';
import { recordingCanvas } from '../../../helpers/canvas.ts';
import { Detail } from '@/engine/render/renderer.ts';
import {
  ATHLETE_RADIUS,
  BALL_RADIUS,
  drawAthlete,
  drawBall,
  paletteFor,
  type AthleteDrawOptions,
} from '@/sports/soccer/art.ts';

const OUTFIELD: AthleteDrawOptions = {
  team: 0,
  controlled: false,
  radius: ATHLETE_RADIUS,
  keeper: false,
};

function athleteCalls(
  detail: (typeof Detail)[keyof typeof Detail],
  options: Partial<AthleteDrawOptions> = {},
): string[] {
  const merged = { ...OUTFIELD, ...options };
  const canvas = recordingCanvas();
  const palette = paletteFor();
  drawAthlete(
    canvas,
    10,
    20,
    0.5,
    merged.keeper ? palette.keeper : palette.teams[merged.team],
    detail,
    merged,
  );
  return canvas.calls;
}

describe('paletteFor', () => {
  it('defaults dark and differs from light', () => {
    const dark = paletteFor();
    expect(dark).toEqual(paletteFor('dark'));
    expect(dark.teams[0].fill).not.toBe(paletteFor('light').teams[0].fill);
  });

  it('keeps the two teams, and the keeper, distinguishable from each other in both themes', () => {
    for (const theme of ['dark', 'light'] as const) {
      const palette = paletteFor(theme);
      const fills = [palette.teams[0].fill, palette.teams[1].fill, palette.keeper.fill];
      expect(new Set(fills).size, theme).toBe(3);
    }
  });

  it('gives the ball a panel colour distinct from the ball itself', () => {
    // A football is white with dark markings. A ball whose panels matched it would be a white disc,
    // which is what the borrowed basketball art produced once its orange was swapped out.
    const palette = paletteFor();
    expect(palette.ball).not.toBe(palette.ballPanel);
  });
});

describe('drawAthlete — level of detail', () => {
  it('draws strictly fewer commands at MINIMAL than at FULL', () => {
    expect(athleteCalls(Detail.MINIMAL).length).toBeLessThan(athleteCalls(Detail.FULL).length);
  });

  it('draws a facing tick only at FULL', () => {
    // The tick is the one thing that needs two points, so a `lineTo` from the body's own centre is
    // its signature.
    const full = athleteCalls(Detail.FULL).filter((call) => call.startsWith('lineTo'));
    const reduced = athleteCalls(Detail.REDUCED).filter((call) => call.startsWith('lineTo'));
    expect(full.length).toBeGreaterThan(reduced.length);
  });
});

describe('drawAthlete — identity is never colour alone (10 §11)', () => {
  it('gives team 1 a marking team 0 does not have, at every non-minimal tier', () => {
    for (const detail of [Detail.FULL, Detail.REDUCED]) {
      const solid = athleteCalls(detail, { team: 0 }).filter((c) => c.startsWith('stroke('));
      const hooped = athleteCalls(detail, { team: 1 }).filter((c) => c.startsWith('stroke('));
      expect(hooped.length, String(detail)).toBeGreaterThan(solid.length);
    }
  });

  it('makes the minimal dot a different shape per team, not just a different fill', () => {
    const zero = athleteCalls(Detail.MINIMAL, { team: 0 });
    const one = athleteCalls(Detail.MINIMAL, { team: 1 });
    expect(zero.some((call) => call.startsWith('arc('))).toBe(true);
    expect(one.some((call) => call.startsWith('arc('))).toBe(false);
    expect(one.some((call) => call.startsWith('lineTo('))).toBe(true);
  });

  it('marks the keeper differently from both outfield kits, in shape as well as colour', () => {
    // The claim this file exists for as much as the ball does: on a pitch shrunk to a phone, "which
    // dot is the keeper" has to be answerable, and a hue nobody can resolve at that size is not an
    // answer. The keeper's band is drawn for *either* team, including the solid one.
    const solid = athleteCalls(Detail.FULL, { team: 0, keeper: false });
    const keeper = athleteCalls(Detail.FULL, { team: 0, keeper: true });
    expect(keeper.filter((c) => c.startsWith('stroke(')).length).toBeGreaterThan(
      solid.filter((c) => c.startsWith('stroke(')).length,
    );
  });
});

describe('drawAthlete — controlled marker', () => {
  it('is a shape drawn around the athlete, not a recolour of them', () => {
    const plain = athleteCalls(Detail.FULL, { controlled: false });
    const mine = athleteCalls(Detail.FULL, { controlled: true });
    expect(mine.length).toBeGreaterThan(plain.length);
    // Two rings, so the marker reads on grass of any shade without knowing the theme.
    expect(mine.filter((c) => c.startsWith('stroke(')).length).toBeGreaterThanOrEqual(
      plain.filter((c) => c.startsWith('stroke(')).length + 2,
    );
  });
});

describe('drawBall — a football, and its height', () => {
  function ballCalls(z: number, detail: (typeof Detail)[keyof typeof Detail]): string[] {
    const canvas = recordingCanvas();
    drawBall(canvas, 5, 5, z, paletteFor(), detail, { radius: BALL_RADIUS });
    return canvas.calls;
  }

  it('draws panels, which is what makes it a football rather than a disc', () => {
    // Three panels plus the body: strictly more circles than a plain ball would need.
    const arcs = ballCalls(0, Detail.FULL).filter((call) => call.startsWith('arc('));
    expect(arcs.length).toBeGreaterThanOrEqual(4);
  });

  it('drops the panels at MINIMAL — one dot, not five circles', () => {
    expect(ballCalls(0, Detail.MINIMAL).filter((c) => c.startsWith('arc(')).length).toBeLessThan(
      ballCalls(0, Detail.FULL).filter((c) => c.startsWith('arc(')).length,
    );
  });

  it('shrinks the shadow as the ball rises, at the same detail tier', () => {
    const radiusOf = (calls: string[]): number => {
      const arc = calls.find((call) => call.startsWith('arc('));
      return Number(arc?.split(',')[2] ?? 0);
    };
    expect(radiusOf(ballCalls(4, Detail.FULL))).toBeLessThan(radiusOf(ballCalls(0, Detail.FULL)));
  });

  it('defaults to a football’s radius rather than a basketball’s', () => {
    // 0.11 m is a size-5 ball. The basketball this used to borrow is more than twice that, which is
    // the single most visible symptom of the bug T-6.16 fixed.
    expect(BALL_RADIUS).toBeLessThan(0.15);
    expect(ATHLETE_RADIUS).toBeGreaterThan(BALL_RADIUS);
  });
});
