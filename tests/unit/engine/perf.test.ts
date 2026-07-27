/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.13 — Perf harness
 * @story   US-2.5 — Run at a steady frame rate
 * @design  12-quality-and-testing.md §6
 *
 * Purpose: that the monitor reports percentiles rather than flattering averages, and that the
 * headless benchmark actually runs the load it claims to.
 */
import { describe, expect, it } from 'vitest';
import { FRAME_BUDGET_MS, PERF_BUDGETS, PerfMonitor, checkBudgets } from '@/engine/render/perf.ts';
import { benchmark } from '../../../tools/bench.ts';

describe('PerfMonitor', () => {
  it('reports nothing before it has a sample', () => {
    const snapshot = new PerfMonitor().snapshot();
    expect(snapshot.samples).toBe(0);
    expect(snapshot.fps).toBe(0);
  });

  it('computes fps from the mean frame time', () => {
    const monitor = new PerfMonitor();
    for (let i = 0; i < 60; i++) monitor.addFrame(16.667);

    const snapshot = monitor.snapshot();
    expect(snapshot.fps).toBeCloseTo(60, 1);
    expect(snapshot.frameMs).toBeCloseTo(16.667, 3);
  });

  it('catches a stutter the mean would hide', () => {
    const monitor = new PerfMonitor();
    // 114 good frames and 6 terrible ones: 60 fps on average, unplayable in practice.
    for (let i = 0; i < 114; i++) monitor.addFrame(10);
    for (let i = 0; i < 6; i++) monitor.addFrame(140);

    const snapshot = monitor.snapshot();
    expect(snapshot.frameMs).toBeLessThan(17);
    expect(snapshot.frameP95Ms).toBeGreaterThan(100);
    expect(snapshot.worstFrameMs).toBe(140);
    expect(snapshot.jankRatio).toBeCloseTo(6 / 120, 3);
  });

  it('measures sim time separately from frame time', () => {
    const monitor = new PerfMonitor();
    for (let i = 0; i < 60; i++) monitor.addFrame(16, 3);

    const snapshot = monitor.snapshot();
    expect(snapshot.simMs).toBeCloseTo(3, 6);
    expect(snapshot.frameMs).toBeCloseTo(16, 6);
  });

  it('accumulates several sim steps into one frame', () => {
    const monitor = new PerfMonitor();
    monitor.beginFrame(0);
    monitor.addSimTime(1.5);
    monitor.addSimTime(1.5);
    monitor.endFrame(20);

    const snapshot = monitor.snapshot();
    expect(snapshot.simMs).toBeCloseTo(3, 6);
    expect(snapshot.frameMs).toBeCloseTo(20, 6);
  });

  it('keeps a rolling window rather than the whole match', () => {
    const monitor = new PerfMonitor();
    for (let i = 0; i < 500; i++) monitor.addFrame(100);
    for (let i = 0; i < 120; i++) monitor.addFrame(10);

    const snapshot = monitor.snapshot();
    expect(snapshot.samples).toBe(120);
    expect(snapshot.frameMs).toBeCloseTo(10, 6);
  });

  it('counts a frame over budget as jank', () => {
    const monitor = new PerfMonitor();
    monitor.addFrame(FRAME_BUDGET_MS - 0.1);
    monitor.addFrame(FRAME_BUDGET_MS + 0.1);

    expect(monitor.snapshot().jankRatio).toBeCloseTo(0.5, 6);
  });

  it('resets', () => {
    const monitor = new PerfMonitor();
    for (let i = 0; i < 30; i++) monitor.addFrame(50);
    monitor.reset();

    expect(monitor.snapshot().samples).toBe(0);
  });
});

describe('checkBudgets', () => {
  const snapshot = (simP95: number, frameP95: number) => ({
    fps: 60,
    frameMs: 16,
    frameP95Ms: frameP95,
    worstFrameMs: frameP95,
    simMs: simP95,
    simP95Ms: simP95,
    jankRatio: 0,
    samples: 120,
  });

  it('passes inside the budget', () => {
    expect(checkBudgets(snapshot(1, 12)).every((check) => check.passed)).toBe(true);
  });

  it('fails the metric that is over, and names it', () => {
    const results = checkBudgets(snapshot(9, 12));
    const sim = results.find((check) => check.metric.startsWith('sim'));

    expect(sim?.passed).toBe(false);
    expect(sim?.budget).toBe(PERF_BUDGETS.simStepMs);
  });

  it('reports passing metrics too, so a number creeping up is visible', () => {
    expect(checkBudgets(snapshot(9, 12))).toHaveLength(2);
  });
});

describe('headless benchmark', () => {
  it('runs the 22-athlete load the budget is written for', () => {
    const result = benchmark(11, 200, 50);

    // 11 per side plus the ball.
    expect(result.entities).toBe(23);
    expect(result.steps).toBe(200);
  });

  it('stays inside the sim-step budget with room to spare', () => {
    const result = benchmark(11, 500, 100);
    expect(result.p95Ms).toBeLessThan(PERF_BUDGETS.simStepMs);
  });
});
