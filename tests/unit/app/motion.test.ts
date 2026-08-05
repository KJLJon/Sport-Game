/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.7 — Reduced-motion and accessibility: no camera motion a player cannot turn off
 * @story   US-13.4 — Turn off motion that makes me unwell
 * @design  10-ui-ux.md §6 (reduced motion), §11
 *
 * Purpose: the resolution rule — an explicit choice beats an inferred one, the operating system is
 * honoured without the player finding a setting, and a stored value that is nonsense is ignored
 * rather than obeyed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAMERA_MOTION_KEY,
  REDUCED_MOTION_KEY,
  cameraMotion,
  reducedMotion,
} from '@/app/motion.ts';
import { prefs } from '@/storage/prefs.ts';

/** A window that answers `matchMedia` the way a phone with the OS setting on would. */
function windowWith(prefersReduced: boolean): Window {
  return {
    matchMedia: (query: string) => ({
      matches: prefersReduced && query.includes('prefers-reduced-motion'),
    }),
  } as unknown as Window;
}

afterEach(() => {
  prefs.remove(REDUCED_MOTION_KEY);
  prefs.remove(CAMERA_MOTION_KEY);
});

describe('reduced motion', () => {
  it('follows the operating system when the app has no opinion', () => {
    expect(reducedMotion(windowWith(true))).toBe(true);
    expect(reducedMotion(windowWith(false))).toBe(false);
  });

  it('can be turned on in the app where the OS has not', () => {
    prefs.set(REDUCED_MOTION_KEY, true);
    expect(reducedMotion(windowWith(false))).toBe(true);
  });

  it('survives a window with no matchMedia at all', () => {
    // jsdom and a few embedded webviews. Not a reason to fail a match.
    expect(reducedMotion({} as unknown as Window)).toBe(false);
    expect(reducedMotion(null)).toBe(false);
  });
});

describe('camera motion', () => {
  it('is full by default', () => {
    expect(cameraMotion(windowWith(false))).toBe('full');
  });

  it('follows the global reduced-motion answer when nothing more specific was chosen', () => {
    // Somebody who set the OS preference gets a calm camera without ever opening Settings.
    expect(cameraMotion(windowWith(true))).toBe('reduced');
  });

  it('lets an explicit choice beat the inferred one, in both directions', () => {
    prefs.set(CAMERA_MOTION_KEY, 'full');
    expect(cameraMotion(windowWith(true))).toBe('full');

    prefs.set(CAMERA_MOTION_KEY, 'fixed');
    expect(cameraMotion(windowWith(false))).toBe('fixed');
  });

  it('ignores a stored value that is not one of the three', () => {
    prefs.set(CAMERA_MOTION_KEY, 'cinematic');
    expect(cameraMotion(windowWith(false))).toBe('full');
  });
});
