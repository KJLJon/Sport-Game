/**
 * Drives an arcade run headlessly: a fixed 60 Hz step, and a press whenever a predicate says so.
 * Every game test uses this rather than reaching into a session's private state, so the tests
 * exercise the same path a thumb does.
 */
import { Button, EMPTY_FRAME, makeFrame, type InputFrame } from '../../src/engine/input/types.ts';
import { createRng } from '../../src/engine/rng.ts';
import type { ArcadeRun } from '../../src/modes/arcade/session.ts';

export const STEP = 1 / 60;

export interface DriveOptions {
  /** Steps to run before giving up. */
  readonly steps?: number;
  /** Returns true on the steps where the player presses. */
  readonly press?: (run: ArcadeRun, step: number) => boolean;
  /** Stops early once this is true. */
  readonly until?: (run: ArcadeRun) => boolean;
  readonly dt?: number;
}

/** Runs the game, returning how many steps it took. */
export function drive(run: ArcadeRun, options: DriveOptions = {}): number {
  const dt = options.dt ?? STEP;
  const steps = options.steps ?? 3000;
  let previous: InputFrame = EMPTY_FRAME;

  run.start();
  for (let i = 0; i < steps; i++) {
    if (run.finished) return i;
    if (options.until?.(run) === true) return i;

    const pressing = options.press?.(run, i) ?? false;
    const frame = pressing ? makeFrame(0, 0, Button.A, previous) : makeFrame(0, 0, 0, previous);
    run.step(frame, dt);
    previous = frame;
  }
  return steps;
}

/**
 * Presses near the middle of the band — a genuinely competent player. Pressing at the *edge* of the
 * band is technically "in the window" and scores almost nothing, because quality falls to zero
 * there; a helper that did that would model a lucky player rather than a good one, and every
 * "a good run scores well" assertion built on it would be testing the wrong thing.
 */
export function pressInBand(run: ArcadeRun): boolean {
  const { meter, target } = run.view().game;
  if (meter === null || target === null) return false;
  const centre = (target.from + target.to) / 2;
  const half = (target.to - target.from) / 2;
  return Math.abs(meter - centre) <= half * 0.4;
}

export interface HumanOptions {
  /** Timing precision on a rhythm the player can anticipate, in seconds (1 sigma). */
  readonly precision?: number;
  /** Reaction latency to something unpredictable, in seconds. ~0.25 s is an ordinary adult. */
  readonly latency?: number;
  /** Standard deviation of the extra error on a reaction, in seconds. */
  readonly jitter?: number;
  readonly seed?: string;
}

/**
 * A player with human timing, used everywhere a claim about calibration mattering is measured.
 *
 * This exists because a bot that presses on the exact frame the band opens cannot tell a novice from
 * a specialist: perfect timing collects the athlete's ceiling either way, and the whole of `09` §2.4
 * is invisible to it.
 *
 * **Two models, because the games test two different things.** On a sweeping meter a real player
 * *anticipates* — they learn the rhythm and aim at the middle of the band, missing by their own
 * precision — so a wider band is directly more forgiving. On a reaction test there is nothing to
 * anticipate, so the player sees the opening a fixed latency late and a longer window is what saves
 * them. A single model would flatter one kind of game and libel the other. The heuristic that picks
 * between them is the shape of the target: a band that spans the whole track is a countdown, not a
 * sweep.
 */
export function humanPlayer(options: HumanOptions = {}): (run: ArcadeRun, step: number) => boolean {
  const precision = options.precision ?? 0.075;
  const latency = options.latency ?? 0.24;
  const jitter = options.jitter ?? 0.04;
  const rng = createRng(options.seed ?? 'human');
  const delayFrames = Math.max(1, Math.round(latency / STEP));
  /** How far ahead the player starts committing to a press, in frames. */
  const horizon = 40;

  const history: { meter: number | null; from: number; to: number }[] = [];
  /** Frames until the press lands. `-1` when nothing is queued. */
  let pending = -1;
  let committed = false;

  const fireNow = (): boolean => {
    pending = -1;
    committed = false;
    return true;
  };

  const schedule = (frames: number): boolean => {
    pending = Math.max(0, Math.round(frames));
    committed = true;
    if (pending === 0) return fireNow();
    return false;
  };

  return (run) => {
    const { meter, target } = run.view().game;
    const sample =
      meter === null || target === null
        ? { meter: null, from: 0, to: 0 }
        : { meter, from: target.from, to: target.to };
    history.push(sample);

    if (pending === 0) return fireNow();
    if (pending > 0) {
      pending--;
      return false;
    }

    if (sample.meter === null) {
      // Nothing on screen to act on; a lapsed decision does not carry to the next opportunity.
      committed = false;
      return false;
    }

    const spansTrack = sample.from <= 0.001 && sample.to >= 0.999;
    if (spansTrack) {
      // A countdown: react to what was on screen a latency ago.
      const seen = history[history.length - 1 - delayFrames];
      if (seen === undefined || seen.meter === null || committed) return false;
      return schedule(rng.gaussian(0, jitter) / STEP);
    }

    // A sweep: estimate the marker's velocity and aim at the middle of the band.
    const previous = history[history.length - 2];
    if (previous === undefined || previous.meter === null || committed) return false;

    const velocity = sample.meter - previous.meter;
    if (velocity === 0) return false;

    const centre = (sample.from + sample.to) / 2;
    const frames = (centre - sample.meter) / velocity;
    if (frames < 0 || frames > horizon) return false;

    return schedule(frames + rng.gaussian(0, precision) / STEP);
  };
}

/** Presses every `every` steps regardless of the meter — a masher. */
export function pressEvery(every: number): (run: ArcadeRun, step: number) => boolean {
  return (_run, step) => step % every === 0;
}

/** Never presses. */
export function pressNever(): boolean {
  return false;
}
