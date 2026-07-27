/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-13.1 — The game works on my phone
 * @design  04-architecture.md §9, 10-ui-ux.md §4
 */
import { describe, expect, it, vi } from 'vitest';
import {
  readOrientation,
  releaseOrientationLock,
  requestOrientationLock,
  shouldPromptRotate,
  type OrientationTarget,
} from '../../../src/app/orientation.ts';

describe('readOrientation', () => {
  it('trusts screen.orientation.type when present', () => {
    const target = { orientation: { type: 'landscape-primary' } } satisfies OrientationTarget;
    // Dimensions deliberately disagree: the API wins.
    expect(readOrientation(target, { width: 400, height: 900 })).toBe('landscape');
  });

  it('handles the secondary variants', () => {
    expect(
      readOrientation({ orientation: { type: 'portrait-secondary' } }, { width: 900, height: 400 }),
    ).toBe('portrait');
  });

  it('falls back to dimensions when the API is absent, which is the iOS path', () => {
    expect(readOrientation(undefined, { width: 900, height: 400 })).toBe('landscape');
    expect(readOrientation(undefined, { width: 400, height: 900 })).toBe('portrait');
  });

  it('calls a perfect square portrait rather than landscape', () => {
    expect(readOrientation({}, { width: 500, height: 500 })).toBe('portrait');
  });
});

describe('requestOrientationLock', () => {
  it('reports "unsupported" instead of throwing where lock does not exist', async () => {
    await expect(requestOrientationLock('landscape', undefined)).resolves.toBe('unsupported');
    await expect(requestOrientationLock('landscape', { orientation: {} })).resolves.toBe(
      'unsupported',
    );
  });

  it('reports "locked" on success and passes the orientation through', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    await expect(requestOrientationLock('landscape', { orientation: { lock } })).resolves.toBe(
      'locked',
    );
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  it('reports "rejected" when the browser refuses, which Chrome does outside fullscreen', async () => {
    const lock = vi.fn().mockRejectedValue(new Error('not allowed'));
    await expect(requestOrientationLock('landscape', { orientation: { lock } })).resolves.toBe(
      'rejected',
    );
  });
});

describe('releaseOrientationLock', () => {
  it('is a no-op where unlock does not exist', () => {
    expect(() => releaseOrientationLock(undefined)).not.toThrow();
  });

  it('swallows an unlock that throws', () => {
    const unlock = vi.fn(() => {
      throw new Error('nope');
    });
    expect(() => releaseOrientationLock({ orientation: { unlock } })).not.toThrow();
    expect(unlock).toHaveBeenCalled();
  });
});

describe('shouldPromptRotate', () => {
  it('never prompts for a screen that works either way', () => {
    expect(shouldPromptRotate('any', 'portrait', null)).toBe(false);
  });

  it('never prompts once the platform granted a lock', () => {
    expect(shouldPromptRotate('landscape', 'portrait', 'locked')).toBe(false);
  });

  it('prompts when the device disagrees and no lock was granted', () => {
    expect(shouldPromptRotate('landscape', 'portrait', 'unsupported')).toBe(true);
    expect(shouldPromptRotate('portrait', 'landscape', 'rejected')).toBe(true);
  });

  it('does not prompt when the device already agrees', () => {
    expect(shouldPromptRotate('landscape', 'landscape', 'unsupported')).toBe(false);
  });
});
