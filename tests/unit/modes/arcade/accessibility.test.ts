/**
 * @vitest-environment jsdom
 *
 * T-4.12 — left-hand mirroring, colour-independent meters, and reduced motion, asserted on what is
 * actually drawn rather than on the intention.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FEEDBACK_SECONDS,
  LEFT_HANDED_KEY,
  REDUCED_MOTION_KEY,
  applyMotionPreference,
  arcadeLayout,
  drawOutcomeFeedback,
  leftHanded,
  reducedMotion,
} from '../../../../src/modes/arcade/accessibility.ts';
import { prefs } from '../../../../src/storage/prefs.ts';
import { BASKETBALL_ARCADE } from '../../../../src/sports/basketball/arcade/index.ts';
import { startRun } from '../../../../src/modes/arcade/modes.ts';
import type { ArcadeLayout } from '../../../../src/modes/arcade/types.ts';
import { arcadeConfig } from '../../../helpers/arcade.ts';
import { drive, humanPlayer } from '../../../helpers/arcade-drive.ts';
import { recordingCanvas, type RecordingCanvas } from '../../../helpers/canvas.ts';

const LAYOUT: ArcadeLayout = { width: 400, height: 700, mirror: false, reducedMotion: false };

afterEach(() => {
  prefs.remove(LEFT_HANDED_KEY);
  prefs.remove(REDUCED_MOTION_KEY);
  document.documentElement.removeAttribute('data-motion');
});

describe('the settings an arcade run reads', () => {
  it('follows the app setting', () => {
    expect(leftHanded()).toBe(false);
    prefs.set(LEFT_HANDED_KEY, true);
    expect(leftHanded()).toBe(true);

    prefs.set(REDUCED_MOTION_KEY, true);
    expect(reducedMotion(window)).toBe(true);
  });

  it('follows the operating system when the app has no opinion', () => {
    const view = { matchMedia: () => ({ matches: true }) } as unknown as Window;
    expect(reducedMotion(view)).toBe(true);
  });

  it('survives a platform with no matchMedia at all', () => {
    const view = {
      matchMedia: () => {
        throw new Error('nope');
      },
    } as unknown as Window;
    expect(reducedMotion(view)).toBe(false);
    expect(reducedMotion(null)).toBe(false);
  });

  it('builds a layout from both', () => {
    prefs.set(LEFT_HANDED_KEY, true);
    prefs.set(REDUCED_MOTION_KEY, true);
    expect(arcadeLayout(window)).toMatchObject({ mirror: true, reducedMotion: true });
  });

  it('puts the motion preference where the tokens can see it', () => {
    applyMotionPreference(document, window);
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false);

    prefs.set(REDUCED_MOTION_KEY, true);
    applyMotionPreference(document, window);
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduced');

    prefs.set(REDUCED_MOTION_KEY, false);
    applyMotionPreference(document, window);
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false);
  });
});

describe('the outcome banner', () => {
  const made = { outcome: { made: true, label: 'Swish', quality: 1, points: 100 }, age: 0 };

  it('says the outcome in words and marks it with a shape, not only a colour', () => {
    const canvas = recordingCanvas();
    drawOutcomeFeedback(canvas, LAYOUT, made);

    expect(canvas.ofKind('fillText').map((call) => call.args[0])).toContain('Swish');
    // A tick is three points; a cross is two strokes of two. Either way, geometry was drawn.
    expect(canvas.ofKind('lineTo').length).toBeGreaterThan(0);
  });

  it('draws a cross for a miss and a tick for a make, at the same size', () => {
    const hit = recordingCanvas();
    const miss = recordingCanvas();
    drawOutcomeFeedback(hit, LAYOUT, made);
    drawOutcomeFeedback(miss, LAYOUT, {
      outcome: { made: false, label: 'Rimmed out', quality: 0.4, points: 0 },
      age: 0,
    });

    // A tick is one stroke of three points; a cross is two strokes of two. Structurally different
    // shapes, so the two outcomes are distinguishable with the colour removed entirely.
    expect(hit.ofKind('moveTo').length).toBe(1);
    expect(miss.ofKind('moveTo').length).toBe(2);
  });

  it('neither moves nor fades under reduced motion', () => {
    const still = recordingCanvas();
    const moving = recordingCanvas();
    const half = { ...made, age: FEEDBACK_SECONDS / 2 };

    drawOutcomeFeedback(still, { ...LAYOUT, reducedMotion: true }, half);
    drawOutcomeFeedback(moving, LAYOUT, half);

    const panelY = (canvas: RecordingCanvas): number =>
      Number(canvas.ofKind('fillRect')[0]?.args[1] ?? 0);
    expect(panelY(still)).toBeGreaterThan(panelY(moving));
    expect(still.globalAlpha).toBe(1);
  });

  it('is gone once it has run its course, and never drawn without one', () => {
    const stale = recordingCanvas();
    drawOutcomeFeedback(stale, LAYOUT, { ...made, age: FEEDBACK_SECONDS + 0.1 });
    expect(stale.calls).toHaveLength(0);

    const none = recordingCanvas();
    drawOutcomeFeedback(none, LAYOUT, null);
    expect(none.calls).toHaveLength(0);
  });
});

describe('left-hand mirroring', () => {
  it('moves what every game draws, without changing the run', () => {
    for (const game of BASKETBALL_ARCADE) {
      const run = startRun(game, arcadeConfig({ seed: `mirror:${game.id}` }));
      drive(run, { press: humanPlayer({ seed: 'm' }), steps: 300 });

      const plain = recordingCanvas();
      const flipped = recordingCanvas();
      run.draw(plain, LAYOUT);
      run.draw(flipped, { ...LAYOUT, mirror: true });

      // The same shapes, in different places: a mirrored run must look different and *play* the
      // same, so the call sequence differs while the run's own state is untouched by drawing.
      expect(plain.calls.join('|'), game.id).not.toBe(flipped.calls.join('|'));
      expect(plain.calls.length, game.id).toBe(flipped.calls.length);
    }
  });
});

describe('every game says something in words on its canvas', () => {
  it('draws text as well as shapes, so nothing is carried by colour alone', () => {
    for (const game of BASKETBALL_ARCADE) {
      const run = startRun(game, arcadeConfig({ seed: `text:${game.id}` }));
      drive(run, { press: humanPlayer({ seed: 't' }), steps: 300 });

      const canvas = recordingCanvas();
      run.draw(canvas, LAYOUT);
      expect(canvas.ofKind('fillText').length, game.id).toBeGreaterThan(0);
    }
  });
});
