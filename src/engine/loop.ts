/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.2 — Fixed-timestep loop (60 Hz) with accumulator, render interpolation,
 *          pause/step/time-scale
 * @story   US-2.5 — Run at a steady frame rate
 * @design  04-architecture.md §6 (loop), 12-quality-and-testing.md §3
 * @invariant INV-8 (the same seed and inputs produce identical state hashes)
 *
 * Purpose: the clock the whole simulation runs on. Physics advances in fixed 60 Hz steps and
 * never in wall-clock deltas, because a variable `dt` makes the sim a function of frame rate —
 * which loses determinism, loses replays, and makes a phone that drops frames play a different
 * game from one that doesn't (US-2.5).
 *
 * The timing policy is a pure function of the accumulator, split out from the driver that calls
 * it, so every rule below is tested without a browser, a timer, or a frame.
 */

/** 60 Hz. The one number the simulation's behaviour is defined against. */
export const STEP_HZ = 60;

/** The fixed simulation step, in milliseconds. */
export const STEP_MS = 1000 / STEP_HZ;

export interface LoopOptions {
  /** Simulation step in ms. Defaults to `STEP_MS`; tests and benchmarks override it. */
  readonly stepMs?: number;
  /**
   * The most steps one `advance()` may run before the loop gives up on catching up.
   *
   * @spec-ref 04-architecture.md §6 — the spiral-of-death clamp. If a frame takes longer than the
   * steps it triggers, the backlog grows every frame and the app locks solid. Dropping simulated
   * time is the only recovery: the match runs slightly slow for a moment instead of freezing.
   */
  readonly maxStepsPerFrame?: number;
  /**
   * The largest wall-clock delta accepted from the driver, in ms. A backgrounded tab returns
   * minutes; simulating them is never what the player wants.
   */
  readonly maxFrameMs?: number;
}

/** What one `advance()` decided. Pure data — the caller does the stepping. */
export interface Tick {
  /** How many fixed steps to run before rendering. */
  readonly steps: number;
  /** Interpolation factor in `[0, 1)` between the previous and current sim state. */
  readonly alpha: number;
  /** Simulated time discarded by the clamps this frame, in ms. `0` in the normal case. */
  readonly droppedMs: number;
}

/**
 * The timing policy. Holds the accumulator and nothing else — no entities, no rendering, no
 * knowledge of what a step does.
 */
export class Clock {
  readonly stepMs: number;
  readonly maxStepsPerFrame: number;
  readonly maxFrameMs: number;

  private accumulator = 0;
  private timeScale = 1;
  private paused = false;
  /** Fixed steps run since construction — the simulation's own clock, immune to frame rate. */
  private stepCount = 0;

  constructor(options: LoopOptions = {}) {
    this.stepMs = options.stepMs ?? STEP_MS;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 5;
    this.maxFrameMs = options.maxFrameMs ?? 250;
  }

  /** Total fixed steps run. Multiply by `stepMs` for elapsed simulated time. */
  get steps(): number {
    return this.stepCount;
  }

  /** Simulated milliseconds elapsed. Never wall-clock time. */
  get simulatedMs(): number {
    return this.stepCount * this.stepMs;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** The current time scale: `1` is real time, `0.5` is slow motion, `2` is double speed. */
  get scale(): number {
    return this.timeScale;
  }

  /**
   * Sets the time scale. Used by replay slow motion (US-2.7) and by ceremony beats. Negative
   * values are clamped to zero — time does not run backwards, and a replay rewind is a seek,
   * not a negative scale.
   */
  setTimeScale(scale: number): void {
    this.timeScale = Number.isFinite(scale) && scale > 0 ? scale : 0;
  }

  pause(): void {
    this.paused = true;
  }

  /**
   * Resumes. The accumulator is deliberately *not* cleared — the driver drops the paused wall
   * time instead (see `createLoop`), so resuming never produces a burst of catch-up steps.
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Consumes a wall-clock delta and decides what this frame does.
   *
   * While paused, no steps are produced and `alpha` holds still, so a paused frame renders
   * exactly the frame before it — no shimmer from a drifting interpolation factor.
   */
  advance(deltaMs: number): Tick {
    if (this.paused || !Number.isFinite(deltaMs) || deltaMs <= 0) {
      return { steps: 0, alpha: this.alpha(), droppedMs: 0 };
    }

    let dropped = 0;
    let frameMs = deltaMs;
    if (frameMs > this.maxFrameMs) {
      dropped += frameMs - this.maxFrameMs;
      frameMs = this.maxFrameMs;
    }

    this.accumulator += frameMs * this.timeScale;

    let steps = Math.floor(this.accumulator / this.stepMs);
    if (steps > this.maxStepsPerFrame) {
      const excess = steps - this.maxStepsPerFrame;
      dropped += excess * this.stepMs;
      this.accumulator -= excess * this.stepMs;
      steps = this.maxStepsPerFrame;
    }

    this.accumulator -= steps * this.stepMs;
    this.stepCount += steps;

    return { steps, alpha: this.alpha(), droppedMs: dropped };
  }

  /**
   * Runs exactly one fixed step, ignoring pause and time scale. The debugger's frame-advance
   * (`04` §6) and the determinism harness both drive the sim this way.
   */
  step(): Tick {
    this.stepCount += 1;
    return { steps: 1, alpha: this.alpha(), droppedMs: 0 };
  }

  /** Discards the partial step. Call after a seek, a resume, or a state load. */
  reset(): void {
    this.accumulator = 0;
  }

  private alpha(): number {
    const alpha = this.accumulator / this.stepMs;
    return alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  }
}

/** The per-frame callbacks a driver needs. */
export interface LoopHandlers {
  /** One fixed simulation step. Never receives a variable `dt` — that is the whole point. */
  step(stepMs: number): void;
  /** Draws, interpolating `alpha` of the way from the previous state to the current one. */
  render(alpha: number): void;
  /** Called when the clamps discard simulated time, for the perf overlay (T-1.13). */
  onDrop?(droppedMs: number): void;
}

/** Injectable frame source, so tests drive frames by hand and never wait on a real one. */
export interface FrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

/** The browser's frame source. */
export function rafScheduler(): FrameScheduler {
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  };
}

export interface Loop {
  readonly clock: Clock;
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/**
 * Wires a `Clock` to a frame source. Thin by design: everything worth testing is in `Clock`,
 * and this only converts timestamps into deltas and calls the handlers.
 */
export function createLoop(
  handlers: LoopHandlers,
  options: LoopOptions & { readonly scheduler?: FrameScheduler } = {},
): Loop {
  const clock = new Clock(options);
  const scheduler = options.scheduler ?? rafScheduler();

  let handle: number | null = null;
  let lastTimestamp: number | null = null;

  const frame = (timestamp: number): void => {
    // A resumed or first frame has no previous timestamp to subtract, so it renders without
    // stepping. This is also what keeps a pause from banking wall time.
    const delta = lastTimestamp === null ? 0 : timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    const tick = clock.advance(delta);
    for (let i = 0; i < tick.steps; i++) handlers.step(clock.stepMs);
    if (tick.droppedMs > 0) handlers.onDrop?.(tick.droppedMs);
    handlers.render(tick.alpha);

    handle = scheduler.request(frame);
  };

  return {
    clock,
    get running() {
      return handle !== null;
    },
    start() {
      if (handle !== null) return;
      lastTimestamp = null;
      handle = scheduler.request(frame);
    },
    stop() {
      if (handle === null) return;
      scheduler.cancel(handle);
      handle = null;
      lastTimestamp = null;
    },
  };
}
