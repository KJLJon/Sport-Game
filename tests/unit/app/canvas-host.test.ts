/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-2.3 — See what's happening in a match
 * @design  04-architecture.md §6 (rendering), §9 (performance budgets)
 */
import { describe, expect, it } from 'vitest';
import { computeCanvasSize } from '../../../src/app/canvas-host.ts';

describe('computeCanvasSize', () => {
  it('multiplies the CSS box by the device pixel ratio', () => {
    const size = computeCanvasSize(390, 844, 2);
    expect(size).toMatchObject({ width: 390, height: 844, pixelWidth: 780, pixelHeight: 1688 });
  });

  it('caps the ratio so a 3x phone does not ask for nine times the fill rate', () => {
    const size = computeCanvasSize(390, 844, 3);
    expect(size.dpr).toBe(2);
    expect(size.pixelWidth).toBe(780);
  });

  it('honours an explicit cap', () => {
    expect(computeCanvasSize(390, 844, 3, 1.5).dpr).toBe(1.5);
    expect(computeCanvasSize(390, 844, 3, 3).dpr).toBe(3);
  });

  it('never drops below a ratio of 1, even if the browser reports nonsense', () => {
    expect(computeCanvasSize(390, 844, 0).dpr).toBe(1);
    expect(computeCanvasSize(390, 844, -4).dpr).toBe(1);
  });

  it('never produces a zero-sized backing store', () => {
    const size = computeCanvasSize(0, 0, 2);
    expect(size.pixelWidth).toBeGreaterThanOrEqual(1);
    expect(size.pixelHeight).toBeGreaterThanOrEqual(1);
  });

  it('produces integral backing-store dimensions from fractional layout boxes', () => {
    const size = computeCanvasSize(390.6, 843.2, 2);
    expect(Number.isInteger(size.pixelWidth)).toBe(true);
    expect(Number.isInteger(size.pixelHeight)).toBe(true);
    expect(Number.isInteger(size.width)).toBe(true);
  });
});
