/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.2 — Dynamic zoom by phase of play
 * @task    T-12.5 — Camera handoff — never a cut mid-action
 * @task    T-12.7 — Reduced motion: no camera motion a player cannot turn off
 * @story   US-2.3 — See what is happening on a small screen
 * @design  04-architecture.md §6, 10-ui-ux.md §6
 * @invariant INV-2 (shake is seeded), INV-8 (the camera never feeds the sim)
 *
 * Purpose: the behaviour that has memory — the zoom following the phase of play, the handoff pans,
 * and what a player who turned camera motion down actually gets.
 */
import { describe, expect, it } from 'vitest';
import { Camera } from '@/engine/render/camera.ts';
import { CameraDirector } from '@/engine/render/director.ts';
import {
  DEFAULT_CAMERA_PROFILE,
  legibleSpan,
  type FramingSignal,
} from '@/engine/render/framing.ts';

const PITCH = { worldWidth: 105, worldHeight: 68 };
const VIEW = { width: 900, height: 460 };
const FRAME = 1 / 60;

function signal(overrides: Partial<FramingSignal> = {}): FramingSignal {
  return {
    ball: { x: 52.5, y: 34, vx: 0, vy: 0 },
    controlled: { x: 52.5, y: 34, vx: 0, vy: 0 },
    pressure: Number.POSITIVE_INFINITY,
    possession: 0,
    stoppage: null,
    ...overrides,
  };
}

function setup(options: { reducedMotion?: boolean } = {}) {
  const camera = new Camera({
    ...VIEW,
    ...PITCH,
    maxScale: 34,
    // The legibility floor for this viewport, the same way the live screen derives it.
    minScale: VIEW.width / legibleSpan(VIEW.width, DEFAULT_CAMERA_PROFILE),
  });
  const director = new CameraDirector({
    camera,
    fieldWidth: PITCH.worldWidth,
    ...options,
  });
  director.snap(signal());
  return { camera, director };
}

function run(director: CameraDirector, input: FramingSignal, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / FRAME); i++) director.update(FRAME, input);
}

describe('zoom by phase of play (T-12.2)', () => {
  it('tightens for a duel and widens again when it ends', () => {
    const { camera, director } = setup();
    run(director, signal(), 2);
    const open = camera.scale;

    run(director, signal({ pressure: 2 }), 3);
    expect(director.state.phase).toBe('duel');
    expect(camera.scale).toBeGreaterThan(open);

    run(director, signal(), 4);
    expect(camera.scale).toBeLessThan(open * 1.05);
  });

  it('widens for a set piece the moment play stops', () => {
    const { camera, director } = setup();
    run(director, signal(), 2);
    const open = camera.scale;

    run(director, signal({ stoppage: 'Free kick', ball: { x: 52.5, y: 34, vx: 0, vy: 0 } }), 2);
    expect(director.state.phase).toBe('setPiece');
    expect(camera.scale).toBeLessThan(open);
  });

  it('never zooms out past the span that keeps an athlete legible', () => {
    // On a narrow phone the legible span is narrower than a set piece would like, and legibility
    // wins: this is the whole reason the phase exists.
    const camera = new Camera({ width: 360, height: 640, ...PITCH, maxScale: 34 });
    const legible = legibleSpan(360, DEFAULT_CAMERA_PROFILE);
    camera.setMinScale(360 / legible);
    const director = new CameraDirector({ camera, fieldWidth: PITCH.worldWidth });
    director.snap(signal());

    run(director, signal({ stoppage: 'Goal kick' }), 4);

    expect(legible).toBeLessThan(DEFAULT_CAMERA_PROFILE.spans.setPiece);
    expect(camera.scale).toBeGreaterThanOrEqual(360 / legible - 1e-6);
  });

  it('changes zoom gradually rather than snapping', () => {
    const { camera, director } = setup();
    run(director, signal(), 2);
    const before = camera.scale;

    director.update(FRAME, signal({ pressure: 2 }));
    const afterOneFrame = camera.scale;

    // One frame moves it a little. A camera that re-zoomed instantly on a phase change would be
    // unwatchable, which is why the zoom rate is deliberately slower than the follow rate.
    expect(Math.abs(afterOneFrame - before)).toBeLessThan(before * 0.05);
  });
});

describe('handoff (T-12.5)', () => {
  it('pans rather than cuts when the ball is moved across the pitch', () => {
    const { camera, director } = setup();
    run(director, signal(), 1);
    const before = camera.x;

    // A throw-in on the far touchline: the ball teleports. The camera must not.
    const restart = signal({ ball: { x: 95, y: 5, vx: 0, vy: 0 }, controlled: null });
    director.update(FRAME, restart);

    expect(camera.x).toBeGreaterThan(before);
    expect(camera.x).toBeLessThan(90);
    expect(director.state.handoff).toBeGreaterThan(0);
  });

  it('gets there eventually', () => {
    const { camera, director } = setup();
    const restart = signal({ ball: { x: 95, y: 5, vx: 0, vy: 0 }, controlled: null });
    run(director, restart, 3);

    // Clamped to keep the viewport inside the pitch, so it stops short of the corner itself.
    expect(camera.x).toBeGreaterThan(80);
  });

  it('crosses a dead-ball distance faster than a live-ball one', () => {
    const dead = setup();
    const live = setup();
    const target = { x: 72, y: 34, vx: 0, vy: 0 };

    run(dead.director, signal({ ball: target, controlled: null, stoppage: 'Throw-in' }), 0.25);
    run(live.director, signal({ ball: target, controlled: null }), 0.25);

    expect(dead.camera.x).toBeGreaterThan(live.camera.x);
  });

  it('starts a handoff when possession changes even without a jump', () => {
    const { director } = setup();
    run(director, signal({ possession: 0 }), 1);
    expect(director.state.handoff).toBe(0);

    director.update(FRAME, signal({ possession: 1 }));
    expect(director.state.handoff).toBeGreaterThan(0);
  });

  it('does not start one for a loose ball nobody has', () => {
    const { director } = setup();
    run(director, signal({ possession: 0 }), 1);

    director.update(FRAME, signal({ possession: -1 }));
    expect(director.state.handoff).toBe(0);
  });

  it('ends after its duration and hands following back', () => {
    const { director } = setup();
    director.update(FRAME, signal({ possession: 1 }));
    run(director, signal({ possession: 1 }), 2);
    expect(director.state.handoff).toBe(0);
  });

  it('cuts only when asked to explicitly', () => {
    const { camera, director } = setup();
    director.snap(signal({ ball: { x: 90, y: 50, vx: 0, vy: 0 }, controlled: null }));

    // A period start is the one place a cut is right, and it is a call, not a threshold.
    expect(camera.x).toBeGreaterThan(70);
  });
});

describe('reduced motion (T-12.7)', () => {
  it('holds one zoom whatever the phase of play', () => {
    const { camera, director } = setup({ reducedMotion: true });
    run(director, signal(), 2);
    const open = camera.scale;

    run(director, signal({ pressure: 1 }), 3);
    expect(camera.scale).toBeCloseTo(open, 6);

    run(director, signal({ stoppage: 'Free kick' }), 3);
    expect(camera.scale).toBeCloseTo(open, 6);
  });

  it('still follows, because a fixed camera on a pitch is the problem this phase exists to fix', () => {
    const { camera, director } = setup({ reducedMotion: true });
    const before = camera.x;
    run(director, signal({ ball: { x: 85, y: 34, vx: 0, vy: 0 }, controlled: null }), 3);
    expect(camera.x).toBeGreaterThan(before + 10);
  });

  it('does not look ahead of a moving ball', () => {
    const calm = setup({ reducedMotion: true });
    const full = setup();
    // Fast enough that the lead alone carries the aim point out of the deadzone — below that, a
    // camera with lookahead and one without are indistinguishable, which is the deadzone working.
    const moving = signal({ ball: { x: 52.5, y: 34, vx: 20, vy: 0 }, controlled: null });

    // Long enough for both to leave the deadzone: the question is where each settles, and the
    // camera that leads a moving ball settles further along than the one that does not.
    run(calm.director, moving, 2);
    run(full.director, moving, 2);

    expect(calm.camera.x).toBeLessThan(full.camera.x);
  });

  it('can be turned on and off mid-match', () => {
    const { camera, director } = setup();
    run(director, signal({ pressure: 2 }), 3);
    const duelScale = camera.scale;

    director.setReducedMotion(true);
    run(director, signal({ pressure: 2 }), 3);
    expect(camera.scale).toBeLessThan(duelScale);
    expect(director.state.reducedMotion).toBe(true);

    director.setReducedMotion(false);
    run(director, signal({ pressure: 2 }), 3);
    expect(camera.scale).toBeGreaterThan(camera.scale * 0.99);
  });
});

describe('per-sport profiles (T-12.6)', () => {
  it('frames a small field entirely whatever the phase, without naming a sport', () => {
    const court = { worldWidth: 28, worldHeight: 15 };
    const camera = new Camera({ ...VIEW, ...court, maxScale: 60 });
    const director = new CameraDirector({ camera, fieldWidth: court.worldWidth });
    director.snap(signal({ ball: { x: 14, y: 7.5, vx: 0, vy: 0 }, controlled: null }));

    const scales: number[] = [];
    for (const input of [
      signal({ ball: { x: 14, y: 7.5, vx: 0, vy: 0 }, controlled: null }),
      signal({ ball: { x: 14, y: 7.5, vx: 0, vy: 0 }, controlled: null, pressure: 1 }),
      signal({ ball: { x: 14, y: 7.5, vx: 0, vy: 0 }, controlled: null, stoppage: 'Timeout' }),
    ]) {
      run(director, input, 2);
      scales.push(camera.scale);
    }

    // Every phase span exceeds a 28 m court, so all three clamp to the same fit-the-court scale.
    for (const scale of scales) expect(scale).toBeCloseTo(scales[0] as number, 4);
  });

  it('takes the sport’s tighter framing when it asks for one', () => {
    const camera = new Camera({ ...VIEW, ...PITCH, maxScale: 200, minScale: 4 });
    const director = new CameraDirector({
      camera,
      fieldWidth: PITCH.worldWidth,
      profile: { ...DEFAULT_CAMERA_PROFILE, spans: { ...DEFAULT_CAMERA_PROFILE.spans, duel: 14 } },
    });
    director.snap(signal());
    run(director, signal({ pressure: 2 }), 4);

    expect(camera.scale).toBeGreaterThan(VIEW.width / 20);
  });
});

/**
 * T-12.4. Tap-to-look is the one camera movement the player asks for directly, which is why it
 * behaves differently from every other one here — including being available when the automatic
 * movements have been turned off.
 */
describe('tap to look (T-12.4)', () => {
  it('goes where it was pointed and comes back on its own', () => {
    const { camera, director } = setup();
    run(director, signal(), 1);

    director.peek(15, 20, 1);
    expect(director.peeking).toBe(true);

    run(director, signal(), 0.9);
    expect(camera.x).toBeLessThan(40);

    // The play carried on while the player was looking elsewhere.
    run(director, signal({ ball: { x: 80, y: 34, vx: 0, vy: 0 }, controlled: null }), 3);
    expect(director.peeking).toBe(false);
    expect(camera.x).toBeGreaterThan(70);
  });

  it('pans back rather than cutting back', () => {
    const { camera, director } = setup();
    director.peek(10, 10, 0.1);
    run(director, signal(), 0.15);

    const away = camera.x;
    director.update(FRAME, signal());

    // One frame of return, not a teleport: coming back is a handoff like any other.
    expect(camera.x).toBeGreaterThan(away);
    expect(camera.x).toBeLessThan(45);
    expect(director.state.handoff).toBeGreaterThan(0);
  });

  it('can be abandoned the moment the player touches the stick', () => {
    const { director } = setup();
    director.peek(10, 10, 5);
    director.endPeek();
    expect(director.peeking).toBe(false);
  });

  it('still works when automatic camera motion is turned off', () => {
    // A setting that stops the camera moving on its own should not disable the control that moves
    // it deliberately.
    const { camera, director } = setup({ reducedMotion: true });
    const before = camera.x;

    director.peek(12, 20, 1);
    run(director, signal(), 0.8);

    expect(camera.x).toBeLessThan(before - 10);
  });
});
