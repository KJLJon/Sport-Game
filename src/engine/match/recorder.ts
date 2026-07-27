/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.12 — Input recording + golden-seed determinism tests in CI (INV-8)
 * @story   US-2.7 — Watch a replay of what just happened
 * @design  04-architecture.md §6, §7 (state is reconstructible from seed, setup, inputs)
 * @invariant INV-8 (the same seed and inputs produce identical state hashes)
 *
 * Purpose: a match is `(seed, setup, inputs)` and nothing else. This records the third part and
 * hashes the result, which buys four things at once: replays (US-2.7), resume-after-kill storing a
 * triple rather than a state dump (T-8.4), headless balance batches, and the desync check that
 * makes lockstep P2P possible (T-10.7).
 *
 * The recording is run-length encoded, because a held direction is the common case: a player
 * sprinting for two seconds is 120 identical frames, and storing them once with a count is the
 * difference between a replay that fits in IndexedDB and one that does not.
 */
import { EMPTY_FRAME, framesEqual, type InputFrame } from '../input/types.ts';
import type { EntityId } from '../world.ts';

/** One entity's input, held for `steps` consecutive simulation steps. */
export interface InputRun {
  readonly entity: EntityId;
  readonly frame: InputFrame;
  steps: number;
}

export interface RecordingHeader {
  readonly seed: string;
  readonly sport: string;
  /** Whatever the sport needs to rebuild the same match. Opaque here, and must be serialisable. */
  readonly setup: Readonly<Record<string, string | number | boolean>>;
  /** Fixed step in ms, so a replay on a different build cannot silently use another rate. */
  readonly stepMs: number;
}

export interface Recording extends RecordingHeader {
  readonly runs: readonly InputRun[];
  readonly steps: number;
}

/**
 * Records inputs as a match runs. One instance per match; `record()` is called once per step with
 * every controlled entity's frame.
 */
export class InputRecorder {
  private readonly runs: InputRun[] = [];
  private readonly lastFrame = new Map<EntityId, InputFrame>();
  private stepCount = 0;

  constructor(private readonly header: RecordingHeader) {}

  get steps(): number {
    return this.stepCount;
  }

  /**
   * Records one step. Entities are recorded in ascending id order regardless of map order, so two
   * runs of the same match produce byte-identical recordings (INV-8).
   */
  record(frames: ReadonlyMap<EntityId, InputFrame>): void {
    this.stepCount++;

    for (const entity of [...frames.keys()].sort((a, b) => a - b)) {
      const frame = frames.get(entity) as InputFrame;
      const previous = this.lastFrame.get(entity);

      if (previous !== undefined && framesEqual(previous, frame)) {
        const run = this.lastRunFor(entity);
        if (run !== undefined) {
          run.steps++;
          continue;
        }
      }

      this.runs.push({ entity, frame, steps: 1 });
      this.lastFrame.set(entity, frame);
    }
  }

  private lastRunFor(entity: EntityId): InputRun | undefined {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const run = this.runs[i] as InputRun;
      if (run.entity === entity) return run;
    }
    return undefined;
  }

  finish(): Recording {
    return { ...this.header, runs: this.runs.map((run) => ({ ...run })), steps: this.stepCount };
  }
}

/**
 * Plays a recording back, one step at a time. Returns the frames for a step, reusing one map so
 * playback allocates nothing per step.
 */
export class InputPlayer {
  private readonly cursor = new Map<EntityId, { index: number; consumed: number }>();
  private readonly frames = new Map<EntityId, InputFrame>();
  private step = 0;

  constructor(private readonly recording: Recording) {
    for (const run of recording.runs) {
      if (!this.cursor.has(run.entity)) this.cursor.set(run.entity, { index: -1, consumed: 0 });
    }
  }

  get finished(): boolean {
    return this.step >= this.recording.steps;
  }

  get currentStep(): number {
    return this.step;
  }

  /** The frames for the next step. Entities with no recorded input get `EMPTY_FRAME`. */
  next(): ReadonlyMap<EntityId, InputFrame> {
    this.step++;

    for (const [entity, cursor] of this.cursor) {
      const runs = this.runsFor(entity);
      if (cursor.index === -1 || cursor.consumed >= (runs[cursor.index]?.steps ?? 0)) {
        cursor.index++;
        cursor.consumed = 0;
      }

      const run = runs[cursor.index];
      if (run === undefined) {
        this.frames.set(entity, EMPTY_FRAME);
        continue;
      }

      cursor.consumed++;
      this.frames.set(entity, run.frame);
    }

    return this.frames;
  }

  private runsFor(entity: EntityId): InputRun[] {
    return this.recording.runs.filter((run) => run.entity === entity);
  }

  reset(): void {
    this.step = 0;
    for (const cursor of this.cursor.values()) {
      cursor.index = -1;
      cursor.consumed = 0;
    }
    this.frames.clear();
  }
}

/**
 * Quantisation grid for state hashing, in world units. Positions are rounded to the nearest
 * millimetre before hashing.
 *
 * @spec-ref 04-architecture.md §6 — "state hashes over quantised values". Hashing raw floats would
 * make the check fail on differences no player could see and no bug caused: two runs that agree to
 * fifteen decimal places are the same match. Quantising is what makes the hash a *behavioural*
 * check rather than a floating-point one.
 */
export const HASH_GRID = 1000;

/**
 * FNV-1a over quantised numbers. Cheap enough to run every step in a determinism test, and stable
 * across engines because it only ever hashes integers.
 */
export class StateHasher {
  private hash = 0x811c9dc5;

  /** Adds a floating-point value, quantised to the hash grid. */
  addFloat(value: number): void {
    this.addInt(Math.round(value * HASH_GRID));
  }

  addInt(value: number): void {
    let v = value | 0;
    for (let byte = 0; byte < 4; byte++) {
      this.hash ^= v & 0xff;
      this.hash = Math.imul(this.hash, 0x01000193);
      v >>= 8;
    }
  }

  addString(text: string): void {
    for (let i = 0; i < text.length; i++) this.addInt(text.charCodeAt(i));
  }

  /** The hash so far, as eight hex characters. */
  digest(): string {
    return (this.hash >>> 0).toString(16).padStart(8, '0');
  }

  reset(): void {
    this.hash = 0x811c9dc5;
  }
}

/** Estimates the byte cost of a recording, for the storage budget in `05` §9. */
export function recordingSize(recording: Recording): number {
  // 4 entity + 8 direction + 6 button/edge + 4 count, per run.
  return recording.runs.length * 22 + recording.seed.length + recording.sport.length;
}
