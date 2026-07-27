/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.2 — Fixed-timestep loop
 * @story   US-2.5 — Run at a steady frame rate
 * @design  04-architecture.md §6 (loop)
 * @invariant INV-8
 *
 * Purpose: the timing rules that make render rate irrelevant to the simulation — step counts,
 * interpolation, the two clamps, pause/step/time-scale, and a driver that never leaks wall time.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  Clock,
  createLoop,
  STEP_HZ,
  STEP_MS,
  type FrameScheduler,
  type LoopHandlers,
} from '@/engine/loop.ts';

/** A frame source under the test's control: no timers, no browser, no waiting. */
function fakeScheduler(): FrameScheduler & { frame(timestampMs: number): void; pending: boolean } {
  let queued: ((timestamp: number) => void) | null = null;
  let nextHandle = 1;

  return {
    request(callback) {
      queued = callback;
      return nextHandle++;
    },
    cancel() {
      queued = null;
    },
    get pending() {
      return queued !== null;
    },
    frame(timestampMs) {
      const callback = queued;
      queued = null;
      callback?.(timestampMs);
    },
  };
}

describe('STEP_MS', () => {
  it('is 60 Hz', () => {
    expect(STEP_HZ).toBe(60);
    expect(STEP_MS).toBeCloseTo(16.6667, 3);
    expect(STEP_MS * STEP_HZ).toBeCloseTo(1000, 9);
  });
});

describe('Clock — stepping', () => {
  it('runs no step until a full step of time has accumulated', () => {
    const clock = new Clock();
    expect(clock.advance(10).steps).toBe(0);
    expect(clock.advance(5).steps).toBe(0);
    expect(clock.advance(5).steps).toBe(1);
  });

  it('runs one step per frame at 60 fps', () => {
    const clock = new Clock();
    for (let i = 0; i < 100; i++) clock.advance(1000 / 60);
    expect(clock.steps).toBe(100);
  });

  it('runs two steps per frame at 30 fps — the same simulated time', () => {
    const slow = new Clock();
    for (let i = 0; i < 50; i++) slow.advance(1000 / 30);

    const fast = new Clock();
    for (let i = 0; i < 100; i++) fast.advance(1000 / 60);

    expect(slow.steps).toBe(100);
    expect(slow.simulatedMs).toBeCloseTo(fast.simulatedMs, 6);
  });

  it('runs a step every other frame at 120 fps', () => {
    const clock = new Clock();
    for (let i = 0; i < 100; i++) clock.advance(1000 / 120);
    expect(clock.steps).toBe(50);
  });

  it('keeps simulated time independent of how the wall time arrives', () => {
    // The same second delivered as smooth frames, as a jittery mix, and as one lump.
    const smooth = new Clock();
    for (let i = 0; i < 60; i++) smooth.advance(1000 / 60);

    const jittery = new Clock();
    const deltas = [8, 33, 12, 41, 9, 25, 60, 11, 17, 22];
    let delivered = 0;
    while (delivered < 1000) {
      const delta = deltas[delivered % deltas.length] as number;
      const capped = Math.min(delta, 1000 - delivered);
      jittery.advance(capped);
      delivered += capped;
    }

    // Within one step, not exactly equal: a second delivered in ragged chunks lands a hair under
    // 60 whole steps once float error accumulates, and the remainder stays in the accumulator
    // rather than being lost. Determinism is unaffected — the same deltas always give the same
    // count — so one step of slack is the honest claim to make here.
    expect(smooth.steps).toBe(60);
    expect(Math.abs(jittery.steps - smooth.steps)).toBeLessThanOrEqual(1);
  });

  it('ignores zero, negative, and non-finite deltas', () => {
    const clock = new Clock();
    expect(clock.advance(0).steps).toBe(0);
    expect(clock.advance(-100).steps).toBe(0);
    expect(clock.advance(Number.NaN).steps).toBe(0);
    expect(clock.advance(Number.POSITIVE_INFINITY).steps).toBe(0);
    expect(clock.steps).toBe(0);
  });

  it('counts simulated time in steps, not in wall time', () => {
    const clock = new Clock();
    clock.advance(100);
    expect(clock.simulatedMs).toBeCloseTo(clock.steps * STEP_MS, 6);
    expect(clock.simulatedMs).toBeLessThanOrEqual(100);
  });
});

describe('Clock — interpolation alpha', () => {
  it('reports the fraction of a step left in the accumulator', () => {
    const clock = new Clock({ stepMs: 10 });
    expect(clock.advance(15).alpha).toBeCloseTo(0.5, 6);
    expect(clock.advance(2).alpha).toBeCloseTo(0.7, 6);
  });

  it('stays within [0, 1]', () => {
    const clock = new Clock();
    for (const delta of [1, 7, 16, 33, 99, 250, 4, 0.5]) {
      const alpha = clock.advance(delta).alpha;
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
    }
  });

  it('holds still while paused, so a paused frame renders identically', () => {
    const clock = new Clock({ stepMs: 10 });
    clock.advance(15);
    const held = clock.advance(0).alpha;
    clock.pause();
    expect(clock.advance(50).alpha).toBe(held);
    expect(clock.advance(50).alpha).toBe(held);
  });

  it('drops the partial step on reset', () => {
    const clock = new Clock({ stepMs: 10 });
    clock.advance(15);
    clock.reset();
    expect(clock.advance(0).alpha).toBe(0);
  });
});

describe('Clock — the spiral-of-death clamp', () => {
  it('caps steps per frame and reports the dropped time', () => {
    const clock = new Clock({ stepMs: 10, maxStepsPerFrame: 3, maxFrameMs: 1000 });
    const tick = clock.advance(100);

    expect(tick.steps).toBe(3);
    expect(tick.droppedMs).toBeCloseTo(70, 6);
    // The backlog is discarded, not banked: the next frame starts clean.
    expect(clock.advance(0).alpha).toBe(0);
  });

  it('does not let a backlog grow across frames', () => {
    const clock = new Clock({ stepMs: 10, maxStepsPerFrame: 3, maxFrameMs: 1000 });
    for (let i = 0; i < 20; i++) {
      const tick = clock.advance(100);
      expect(tick.steps).toBeLessThanOrEqual(3);
    }
    expect(clock.steps).toBe(60);
  });

  it('clamps an absurd frame delta before it reaches the accumulator', () => {
    // A backgrounded tab for two minutes.
    const clock = new Clock({ stepMs: 10, maxStepsPerFrame: 100, maxFrameMs: 250 });
    const tick = clock.advance(120_000);

    expect(tick.steps).toBe(25);
    expect(tick.droppedMs).toBeCloseTo(119_750, 6);
  });

  it('drops nothing in the normal case', () => {
    const clock = new Clock();
    for (let i = 0; i < 100; i++) expect(clock.advance(1000 / 60).droppedMs).toBe(0);
  });
});

describe('Clock — pause, step, and time scale', () => {
  it('runs no steps while paused and resumes without a burst', () => {
    const clock = new Clock();
    clock.advance(16);
    clock.pause();

    expect(clock.isPaused).toBe(true);
    for (let i = 0; i < 10; i++) expect(clock.advance(1000).steps).toBe(0);

    clock.resume();
    expect(clock.isPaused).toBe(false);
    expect(clock.advance(1000 / 60).steps).toBeLessThanOrEqual(2);
  });

  it('advances exactly one step, ignoring pause', () => {
    const clock = new Clock();
    clock.pause();
    expect(clock.step().steps).toBe(1);
    expect(clock.step().steps).toBe(1);
    expect(clock.steps).toBe(2);
  });

  it('halves the step rate at 0.5× and doubles it at 2×', () => {
    const slow = new Clock();
    slow.setTimeScale(0.5);
    for (let i = 0; i < 60; i++) slow.advance(1000 / 60);
    expect(slow.steps).toBe(30);

    const fast = new Clock();
    fast.setTimeScale(2);
    for (let i = 0; i < 60; i++) fast.advance(1000 / 60);
    expect(fast.steps).toBe(120);
  });

  it('freezes at scale zero and refuses to run time backwards', () => {
    const clock = new Clock();
    clock.setTimeScale(0);
    for (let i = 0; i < 60; i++) clock.advance(16);
    expect(clock.steps).toBe(0);

    clock.setTimeScale(-2);
    expect(clock.scale).toBe(0);
    clock.setTimeScale(Number.NaN);
    expect(clock.scale).toBe(0);

    clock.setTimeScale(1);
    expect(clock.scale).toBe(1);
  });

  it('keeps the step size fixed whatever the scale — the sim never sees a variable dt', () => {
    const clock = new Clock();
    clock.setTimeScale(0.25);
    for (let i = 0; i < 240; i++) clock.advance(1000 / 60);
    expect(clock.simulatedMs).toBeCloseTo(clock.steps * STEP_MS, 6);
    expect(clock.steps).toBe(60);
  });
});

describe('createLoop', () => {
  function handlers(): LoopHandlers & {
    steps: number[];
    renders: number[];
    drops: number[];
  } {
    const steps: number[] = [];
    const renders: number[] = [];
    const drops: number[] = [];
    return {
      steps,
      renders,
      drops,
      step: (stepMs) => steps.push(stepMs),
      render: (alpha) => renders.push(alpha),
      onDrop: (dropped) => drops.push(dropped),
    };
  }

  it('renders every frame and steps only on accumulated time', () => {
    const scheduler = fakeScheduler();
    const spy = handlers();
    const loop = createLoop(spy, { scheduler, stepMs: 10 });

    loop.start();
    scheduler.frame(0); // first frame: no previous timestamp, so no delta
    scheduler.frame(5);
    scheduler.frame(25);

    expect(spy.steps).toEqual([10, 10]);
    expect(spy.renders).toHaveLength(3);
  });

  it('hands the step handler the fixed step, never the frame delta', () => {
    const scheduler = fakeScheduler();
    const spy = handlers();
    createLoop(spy, { scheduler, stepMs: 10 }).start();

    scheduler.frame(0);
    scheduler.frame(37);

    expect(new Set(spy.steps)).toEqual(new Set([10]));
  });

  it('reports dropped time to the perf overlay', () => {
    const scheduler = fakeScheduler();
    const spy = handlers();
    createLoop(spy, { scheduler, stepMs: 10, maxStepsPerFrame: 2, maxFrameMs: 1000 }).start();

    scheduler.frame(0);
    scheduler.frame(100);

    expect(spy.steps).toHaveLength(2);
    expect(spy.drops).toEqual([80]);
  });

  it('keeps requesting frames while running, and stops on stop()', () => {
    const scheduler = fakeScheduler();
    const loop = createLoop(handlers(), { scheduler });

    expect(loop.running).toBe(false);
    loop.start();
    expect(loop.running).toBe(true);

    scheduler.frame(16);
    expect(scheduler.pending).toBe(true);

    loop.stop();
    expect(loop.running).toBe(false);
    expect(scheduler.pending).toBe(false);
  });

  it('ignores a second start()', () => {
    const scheduler = fakeScheduler();
    const request = vi.spyOn(scheduler, 'request');
    const loop = createLoop(handlers(), { scheduler });

    loop.start();
    loop.start();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('ignores stop() when not running', () => {
    const scheduler = fakeScheduler();
    const cancel = vi.spyOn(scheduler, 'cancel');
    createLoop(handlers(), { scheduler }).stop();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not bank wall time across a stop and start', () => {
    const scheduler = fakeScheduler();
    const spy = handlers();
    const loop = createLoop(spy, { scheduler, stepMs: 10 });

    loop.start();
    scheduler.frame(0);
    loop.stop();

    // Ten seconds pass with the loop stopped — a backgrounded app, a settings screen.
    loop.start();
    scheduler.frame(10_000);
    scheduler.frame(10_010);

    expect(spy.steps).toHaveLength(1);
  });

  it('exposes its clock, so pause and time scale reach the simulation', () => {
    const scheduler = fakeScheduler();
    const spy = handlers();
    const loop = createLoop(spy, { scheduler, stepMs: 10 });

    loop.start();
    scheduler.frame(0);
    loop.clock.pause();
    scheduler.frame(1000);

    expect(spy.steps).toHaveLength(0);
    expect(spy.renders).toHaveLength(2);
  });
});
