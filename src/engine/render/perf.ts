/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.13 — Perf harness: fps/frame-time/entity overlay + CI budget check
 * @story   US-2.5 — Run at a steady frame rate
 * @design  12-quality-and-testing.md §6 (performance budgets), 04-architecture.md §9
 * @invariant INV-8 (measurement never influences the simulation)
 *
 * Purpose: measures what `12` §6 budgets. The numbers that matter are percentiles, not averages:
 * a match that averages 60 fps and stutters twice a second is a bad match, and a mean hides
 * exactly that. p95 frame time is the number in the budget table, so p95 is what this reports.
 *
 * The monitor is allocation-free in steady state — it writes into pre-sized ring buffers — because
 * a performance monitor that allocates is measuring itself.
 */

/** How many recent frames the percentiles are computed over. Two seconds at 60 fps. */
const WINDOW = 120;

export interface PerfSnapshot {
  readonly fps: number;
  /** Mean frame time over the window, ms. */
  readonly frameMs: number;
  /** 95th-percentile frame time, ms — the `12` §6 budget metric. */
  readonly frameP95Ms: number;
  readonly worstFrameMs: number;
  /** Mean simulation step time, ms. */
  readonly simMs: number;
  /** 95th-percentile simulation step time, ms. */
  readonly simP95Ms: number;
  /** Frames slower than the 16.7 ms budget, as a fraction of the window. */
  readonly jankRatio: number;
  readonly samples: number;
}

/** One frame at 60 fps. Anything longer has dropped a frame. */
export const FRAME_BUDGET_MS = 1000 / 60;

export class PerfMonitor {
  private readonly frameTimes = new Float32Array(WINDOW);
  private readonly simTimes = new Float32Array(WINDOW);
  private readonly sorted = new Float32Array(WINDOW);
  private cursor = 0;
  private filled = 0;

  private frameStart = 0;
  private simAccumulator = 0;

  /** Marks the start of a frame. */
  beginFrame(nowMs: number): void {
    this.frameStart = nowMs;
    this.simAccumulator = 0;
  }

  /** Adds one simulation step's cost to this frame. A frame may contain several steps. */
  addSimTime(ms: number): void {
    this.simAccumulator += ms;
  }

  /** Closes the frame and records it. */
  endFrame(nowMs: number): void {
    this.frameTimes[this.cursor] = nowMs - this.frameStart;
    this.simTimes[this.cursor] = this.simAccumulator;
    this.cursor = (this.cursor + 1) % WINDOW;
    if (this.filled < WINDOW) this.filled++;
  }

  /** Records a frame directly — for headless benchmarks with their own timing. */
  addFrame(frameMs: number, simMs = 0): void {
    this.frameTimes[this.cursor] = frameMs;
    this.simTimes[this.cursor] = simMs;
    this.cursor = (this.cursor + 1) % WINDOW;
    if (this.filled < WINDOW) this.filled++;
  }

  snapshot(): PerfSnapshot {
    if (this.filled === 0) {
      return {
        fps: 0,
        frameMs: 0,
        frameP95Ms: 0,
        worstFrameMs: 0,
        simMs: 0,
        simP95Ms: 0,
        jankRatio: 0,
        samples: 0,
      };
    }

    let frameSum = 0;
    let simSum = 0;
    let worst = 0;
    let janky = 0;

    for (let i = 0; i < this.filled; i++) {
      const frame = this.frameTimes[i] as number;
      frameSum += frame;
      simSum += this.simTimes[i] as number;
      if (frame > worst) worst = frame;
      if (frame > FRAME_BUDGET_MS) janky++;
    }

    const meanFrame = frameSum / this.filled;

    return {
      fps: meanFrame > 0 ? 1000 / meanFrame : 0,
      frameMs: meanFrame,
      frameP95Ms: this.percentile(this.frameTimes, 0.95),
      worstFrameMs: worst,
      simMs: simSum / this.filled,
      simP95Ms: this.percentile(this.simTimes, 0.95),
      jankRatio: janky / this.filled,
      samples: this.filled,
    };
  }

  /** Copies into the reusable scratch array and sorts in place — no allocation per call. */
  private percentile(source: Float32Array, fraction: number): number {
    for (let i = 0; i < this.filled; i++) this.sorted[i] = source[i] as number;
    const window = this.sorted.subarray(0, this.filled);
    window.sort();

    const index = Math.min(this.filled - 1, Math.floor(this.filled * fraction));
    return window[index] as number;
  }

  reset(): void {
    this.cursor = 0;
    this.filled = 0;
  }
}

/** The `12` §6 budgets this engine can measure without a browser. */
export const PERF_BUDGETS = {
  /** Sim step with 22 entities. */
  simStepMs: 4,
  /** Frame time, p95. */
  frameP95Ms: 16,
} as const;

export interface BudgetCheck {
  readonly metric: string;
  readonly measured: number;
  readonly budget: number;
  readonly passed: boolean;
}

/**
 * Checks a snapshot against the budgets. Returns every result, passing or failing, because a
 * benchmark that only reports failures gives no warning as a number creeps towards its limit.
 */
export function checkBudgets(snapshot: PerfSnapshot): BudgetCheck[] {
  return [
    {
      metric: 'sim step (p95)',
      measured: snapshot.simP95Ms,
      budget: PERF_BUDGETS.simStepMs,
      passed: snapshot.simP95Ms <= PERF_BUDGETS.simStepMs,
    },
    {
      metric: 'frame time (p95)',
      measured: snapshot.frameP95Ms,
      budget: PERF_BUDGETS.frameP95Ms,
      passed: snapshot.frameP95Ms <= PERF_BUDGETS.frameP95Ms,
    },
  ];
}
