/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.13 — Perf harness: CI budget check on a headless benchmark
 * @task    T-6.11 — 22-entity performance work: LOD, culling, spatial-hash tuning
 * @story   US-2.5 — Run at a steady frame rate
 * @design  12-quality-and-testing.md §6 (performance budgets)
 *
 * Purpose: runs a sport headless at the 22-entity load `12` §6 budgets, and fails the build
 * if the simulation step goes over 4 ms. Headless because the number worth guarding in CI is the
 * *simulation*: rendering depends on the GPU of whatever runner picked up the job, and a budget
 * that changes with the runner is a flaky test, not a budget.
 *
 * `pnpm bench` locally; a CI step on `main`.
 */
import { World } from '../src/engine/world.ts';
import { PERF_BUDGETS, PerfMonitor, checkBudgets } from '../src/engine/render/perf.ts';
import { EMPTY_FRAME, type InputFrame } from '../src/engine/input/types.ts';
import { createTestMatch, testSport } from '../src/sports/testsport/index.ts';
import { soccer } from '../src/sports/soccer/index.ts';
import { createRng } from '../src/engine/rng.ts';
import type { EntityId } from '../src/engine/world.ts';

const STEP = 1 / 60;

export interface BenchResult {
  readonly entities: number;
  readonly steps: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly worstMs: number;
}

/**
 * Runs `steps` simulation steps with `squadSize` per side, timing each one.
 *
 * A warm-up pass runs first and is discarded: the first hundred steps of any JS workload measure
 * the JIT rather than the code, and a benchmark that includes them fails on a fast machine having
 * a slow morning.
 */
export function benchmark(squadSize: number, steps: number, warmup = 200): BenchResult {
  const world = new World({
    width: testSport.field.width,
    height: testSport.field.height,
    cellSize: 4,
    capacity: squadSize * 2 + 4,
  });

  const { state, rng } = createTestMatch(world, 'benchmark', 0, squadSize);
  const inputs = new Map<EntityId, InputFrame>([[state.controlled, EMPTY_FRAME]]);
  const monitor = new PerfMonitor();

  for (let i = 0; i < warmup; i++) testSport.step(state, world, inputs, STEP, rng);

  const timings: number[] = [];
  for (let i = 0; i < steps; i++) {
    const start = performance.now();
    testSport.step(state, world, inputs, STEP, rng);
    const elapsed = performance.now() - start;
    timings.push(elapsed);
    monitor.addFrame(elapsed, elapsed);
  }

  const snapshot = monitor.snapshot();
  const mean = timings.reduce((sum, value) => sum + value, 0) / timings.length;

  return {
    entities: world.count,
    steps,
    meanMs: mean,
    p95Ms: snapshot.simP95Ms,
    worstMs: snapshot.worstFrameMs,
  };
}

/**
 * The same measurement against real soccer — 22 athletes, a ball, formations, steering, tackling,
 * and a keeper.
 *
 * T-1.13 could only benchmark the test sport, because it was the only thing that ran at eleven a
 * side. Now that a real one exists, *this* is the number `12` §6's budget is actually about: the
 * test sport moves 22 entities, and soccer moves 22 entities and then decides what they should do.
 */
export function benchmarkSoccer(steps: number, warmup = 200): BenchResult {
  const world = new World({
    width: soccer.field.width,
    height: soccer.field.height,
    cellSize: 6,
    capacity: 32,
  });

  const rng = createRng('benchmark');
  const state = soccer.createState({ seed: 'benchmark', playerSide: 0 }, world, rng);
  const inputs = new Map<EntityId, InputFrame>([[state.controlled, EMPTY_FRAME]]);
  const stepRng = rng.fork('sim');
  const monitor = new PerfMonitor();

  for (let i = 0; i < warmup; i++) soccer.step(state, world, inputs, STEP, stepRng);

  const timings: number[] = [];
  for (let i = 0; i < steps; i++) {
    const start = performance.now();
    soccer.step(state, world, inputs, STEP, stepRng);
    const elapsed = performance.now() - start;
    timings.push(elapsed);
    monitor.addFrame(elapsed, elapsed);
  }

  const snapshot = monitor.snapshot();
  const mean = timings.reduce((sum, value) => sum + value, 0) / timings.length;

  return {
    entities: world.count,
    steps,
    meanMs: mean,
    p95Ms: snapshot.simP95Ms,
    worstMs: snapshot.worstFrameMs,
  };
}

function report(label: string, result: BenchResult): void {
  console.log(`\n${label}`);
  console.log(`  entities: ${result.entities}`);
  console.log(`  mean:     ${result.meanMs.toFixed(4)} ms`);
  console.log(`  p95:      ${result.p95Ms.toFixed(4)} ms`);
  console.log(`  worst:    ${result.worstMs.toFixed(4)} ms`);
}

async function main(): Promise<void> {
  // 11 per side is the worst case `12` §6 names. Both sports are measured; the budget is judged
  // against soccer, because that is the real workload and the test sport is only a floor.
  const floor = benchmark(11, 2000);
  const result = benchmarkSoccer(2000);

  report('test sport (floor)', floor);
  report('soccer (the real workload)', result);
  console.log(`\nbudget:     ${PERF_BUDGETS.simStepMs} ms per sim step`);

  const failures = checkBudgets({
    fps: 0,
    frameMs: 0,
    frameP95Ms: 0,
    worstFrameMs: result.worstMs,
    simMs: result.meanMs,
    simP95Ms: result.p95Ms,
    jankRatio: 0,
    samples: result.steps,
  }).filter((check) => check.metric.startsWith('sim') && !check.passed);

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `FAIL ${failure.metric}: ${failure.measured.toFixed(3)} ms > ${failure.budget} ms`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nWithin budget.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
