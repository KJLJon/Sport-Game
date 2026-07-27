/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.12 — Input recording + golden-seed determinism tests in CI (INV-8)
 * @story   US-2.7 — Watch a replay of what just happened
 * @design  04-architecture.md §6, §7, 12-quality-and-testing.md §1 (determinism layer)
 * @invariant INV-8
 *
 * Purpose: the test that has to pass for replays, resume, headless balance batches, and lockstep
 * P2P to be possible at all. Two runs of the same seed and inputs must produce the same state
 * hash, step for step — and a recorded match must replay into that same hash.
 */
import { describe, expect, it } from 'vitest';
import { World } from '@/engine/world.ts';
import { Button, EMPTY_FRAME, makeFrame, type InputFrame } from '@/engine/input/types.ts';
import {
  InputPlayer,
  InputRecorder,
  StateHasher,
  recordingSize,
  type Recording,
} from '@/engine/match/recorder.ts';
import { createTestMatch, testSport } from '@/sports/testsport/index.ts';
import type { EntityId } from '@/engine/world.ts';

const STEP = 1 / 60;

function arena(): World {
  return new World({
    width: testSport.field.width,
    height: testSport.field.height,
    cellSize: 4,
    capacity: 32,
  });
}

/** Hashes every entity's quantised kinematics — the whole visible state of the match. */
function hashWorld(world: World): string {
  const hasher = new StateHasher();
  world.forEach((id) => {
    hasher.addInt(id);
    hasher.addFloat(world.x[id] as number);
    hasher.addFloat(world.y[id] as number);
    hasher.addFloat(world.z[id] as number);
    hasher.addFloat(world.vx[id] as number);
    hasher.addFloat(world.vy[id] as number);
  });
  return hasher.digest();
}

/**
 * A scripted input sequence: the controlled athlete runs a square and taps a button, which is
 * enough to exercise pivots, turn-rate limiting, and possession changes.
 */
function scriptedFrame(step: number, previous: InputFrame): InputFrame {
  const phase = Math.floor(step / 40) % 4;
  const directions: readonly [number, number][] = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  const [x, y] = directions[phase] as [number, number];
  const buttons = step % 90 === 0 ? Button.A : step % 37 === 0 ? Button.MODIFIER : 0;
  return makeFrame(x, y, buttons, previous);
}

/** Plays the test sport with scripted inputs and returns the per-step hashes. */
function play(seed: string, steps: number, record?: InputRecorder): string[] {
  const world = arena();
  const { state, rng } = createTestMatch(world, seed, 0);
  const hashes: string[] = [];

  let frame = EMPTY_FRAME;
  const frames = new Map<EntityId, InputFrame>();

  for (let step = 0; step < steps; step++) {
    frame = scriptedFrame(step, frame);
    frames.set(state.controlled, frame);

    record?.record(frames);
    testSport.step(state, world, frames, STEP, rng);
    hashes.push(hashWorld(world));
  }

  return hashes;
}

describe('StateHasher', () => {
  it('is stable for the same values', () => {
    const a = new StateHasher();
    const b = new StateHasher();
    a.addFloat(1.23456);
    a.addInt(42);
    b.addFloat(1.23456);
    b.addInt(42);

    expect(a.digest()).toBe(b.digest());
  });

  it('separates values that differ above the grid', () => {
    const a = new StateHasher();
    const b = new StateHasher();
    a.addFloat(1.234);
    b.addFloat(1.235);

    expect(a.digest()).not.toBe(b.digest());
  });

  it('ignores differences below the grid, so float noise is not a false failure', () => {
    const a = new StateHasher();
    const b = new StateHasher();
    a.addFloat(1.2340001);
    b.addFloat(1.2340002);

    expect(a.digest()).toBe(b.digest());
  });

  it('is order-sensitive — a swapped pair of entities is a real divergence', () => {
    const a = new StateHasher();
    const b = new StateHasher();
    a.addInt(1);
    a.addInt(2);
    b.addInt(2);
    b.addInt(1);

    expect(a.digest()).not.toBe(b.digest());
  });

  it('produces eight hex characters', () => {
    const hasher = new StateHasher();
    hasher.addString('sport-game');
    expect(hasher.digest()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('resets', () => {
    const hasher = new StateHasher();
    const empty = hasher.digest();
    hasher.addFloat(9.9);
    hasher.reset();

    expect(hasher.digest()).toBe(empty);
  });
});

describe('INV-8 — golden seeds', () => {
  it('produces identical hashes for two runs of the same seed and inputs', () => {
    const first = play('golden-1', 600);
    const second = play('golden-1', 600);

    expect(second).toEqual(first);
  });

  it('diverges for a different seed', () => {
    expect(play('golden-1', 300).at(-1)).not.toBe(play('golden-2', 300).at(-1));
  });

  it('diverges for different inputs on the same seed', () => {
    const world = arena();
    const { state, rng } = createTestMatch(world, 'same-seed', 0);
    const frames = new Map<EntityId, InputFrame>([[state.controlled, makeFrame(1, 0, 0)]]);
    for (let i = 0; i < 300; i++) testSport.step(state, world, frames, STEP, rng);

    expect(hashWorld(world)).not.toBe(play('same-seed', 300).at(-1));
  });

  it('stays identical step for step, not just at the end', () => {
    const first = play('stepwise', 400);
    const second = play('stepwise', 400);

    for (let step = 0; step < first.length; step++) {
      expect(second[step], `diverged at step ${step}`).toBe(first[step]);
    }
  });

  it('holds across several seeds', () => {
    for (const seed of ['alpha', 'bravo', 'charlie', 'delta']) {
      expect(play(seed, 240)).toEqual(play(seed, 240));
    }
  });
});

describe('recording and replay', () => {
  function header(seed: string) {
    return { seed, sport: 'testsport', setup: { playerSide: 0 }, stepMs: 1000 / 60 };
  }

  it('replays a recorded match into the same hashes', () => {
    const recorder = new InputRecorder(header('replay-me'));
    const live = play('replay-me', 500, recorder);
    const recording = recorder.finish();

    const world = arena();
    const { state, rng } = createTestMatch(world, 'replay-me', 0);
    const player = new InputPlayer(recording);
    const replayed: string[] = [];

    while (!player.finished) {
      testSport.step(state, world, player.next(), STEP, rng);
      replayed.push(hashWorld(world));
    }

    expect(replayed).toEqual(live);
  });

  it('run-length encodes held input instead of storing every frame', () => {
    const recorder = new InputRecorder(header('rle'));
    const frames = new Map<EntityId, InputFrame>();
    const frame = makeFrame(1, 0, 0);

    for (let i = 0; i < 600; i++) {
      frames.set(0, frame);
      recorder.record(frames);
    }

    const recording = recorder.finish();
    expect(recording.steps).toBe(600);
    expect(recording.runs).toHaveLength(1);
    expect(recording.runs[0]?.steps).toBe(600);
    expect(recordingSize(recording)).toBeLessThan(100);
  });

  it('starts a new run when the input changes', () => {
    const recorder = new InputRecorder(header('changes'));
    const frames = new Map<EntityId, InputFrame>();

    let previous = EMPTY_FRAME;
    for (let i = 0; i < 100; i++) {
      previous = makeFrame(i < 50 ? 1 : 0, 0, i < 50 ? 0 : Button.A, previous);
      frames.set(0, previous);
      recorder.record(frames);
    }

    const recording = recorder.finish();
    // Held-left, then the button press edge, then the held button.
    expect(recording.runs.length).toBeGreaterThanOrEqual(2);
    expect(recording.runs.reduce((sum, run) => sum + run.steps, 0)).toBe(100);
  });

  it('records several entities independently, in id order', () => {
    const recorder = new InputRecorder(header('multi'));
    const frames = new Map<EntityId, InputFrame>([
      [3, makeFrame(1, 0, 0)],
      [1, makeFrame(0, 1, 0)],
    ]);
    recorder.record(frames);

    const recording = recorder.finish();
    expect(recording.runs.map((run) => run.entity)).toEqual([1, 3]);
  });

  it('replays entities with no recorded input as empty frames', () => {
    const recording: Recording = { ...header('sparse'), runs: [], steps: 3 };
    const player = new InputPlayer(recording);

    expect(player.next().size).toBe(0);
    expect(player.currentStep).toBe(1);
  });

  it('rewinds to the start', () => {
    const recorder = new InputRecorder(header('rewind'));
    const frames = new Map<EntityId, InputFrame>([[0, makeFrame(1, 0, 0)]]);
    for (let i = 0; i < 10; i++) recorder.record(frames);

    const player = new InputPlayer(recorder.finish());
    const first = [...Array(5)].map(() => player.next().get(0));
    player.reset();
    const second = [...Array(5)].map(() => player.next().get(0));

    expect(second).toEqual(first);
  });

  it('carries the header a replay needs to rebuild the match', () => {
    const recording = new InputRecorder(header('header')).finish();

    expect(recording.seed).toBe('header');
    expect(recording.sport).toBe('testsport');
    expect(recording.stepMs).toBeCloseTo(1000 / 60, 9);
  });
});
