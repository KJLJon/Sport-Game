/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-6.12 — Camera and minimap tuning for the larger pitch
 * @task    T-1.8 — Camera
 * @story   US-2.3 — See the whole field on a small screen
 * @design  04-architecture.md §6, 10-ui-ux.md §6
 * @invariant INV-2
 *
 * Purpose: following, framing, clamping, and the two behaviours that are accessibility rather
 * than polish — frame-rate-independent smoothing, and reduced motion actually meaning no motion.
 */
import { describe, expect, it } from 'vitest';
import { Camera } from '@/engine/render/camera.ts';
import { createRng } from '@/engine/rng.ts';

const COURT = { worldWidth: 28, worldHeight: 15 };

function camera(overrides = {}) {
  return new Camera({
    width: 800,
    height: 400,
    ...COURT,
    maxScale: 60,
    minScale: 20,
    ...overrides,
  });
}

/**
 * A camera zoomed in enough that the court is larger than the viewport, which is the only regime
 * where following is observable — zoomed out past the field, the clamp centres every axis and the
 * camera correctly refuses to move at all.
 */
function zoomed(overrides = {}) {
  const cam = camera(overrides);
  cam.snapTo(14, 7.5, 40);
  return cam;
}

const FRAME = 1 / 60;

function follow(
  cam: Camera,
  target: { x: number; y: number; vx?: number; vy?: number },
  seconds: number,
) {
  for (let i = 0; i < Math.round(seconds / FRAME); i++) cam.update(FRAME, target);
}

describe('following', () => {
  it('starts centred on the field', () => {
    const cam = camera();
    expect(cam.x).toBeCloseTo(14, 6);
    expect(cam.y).toBeCloseTo(7.5, 6);
  });

  it('closes the gap towards its target', () => {
    const cam = zoomed();
    const before = cam.x;
    cam.update(FRAME, { x: 17, y: 7.5 });

    expect(cam.x).toBeGreaterThan(before);
    expect(cam.x).toBeLessThan(17);
  });

  it('converges on a stationary target', () => {
    const cam = zoomed();
    follow(cam, { x: 17, y: 9 }, 3);

    expect(cam.x).toBeCloseTo(17, 1);
    expect(cam.y).toBeCloseTo(9, 1);
  });

  it('leads a moving target so the player sees where play is going', () => {
    const led = zoomed();
    const flat = zoomed();

    led.update(FRAME, { x: 14, y: 7.5, vx: 8, vy: 0 });
    flat.update(FRAME, { x: 14, y: 7.5, vx: 0, vy: 0 });

    expect(led.x).toBeGreaterThan(flat.x);
  });

  it('smooths identically at 30 and 120 fps', () => {
    const slow = zoomed();
    const fast = zoomed();

    for (let i = 0; i < 30; i++) slow.update(1 / 30, { x: 17, y: 7.5 });
    for (let i = 0; i < 120; i++) fast.update(1 / 120, { x: 17, y: 7.5 });

    // One second of following, delivered as 30 frames or as 120, ends in the same place.
    expect(slow.x).toBeCloseTo(fast.x, 3);
  });

  it('holds position when there is nothing to follow', () => {
    const cam = zoomed();
    follow(cam, { x: 17, y: 9 }, 2);
    const held = cam.x;

    for (let i = 0; i < 60; i++) cam.update(FRAME, null);
    expect(cam.x).toBeCloseTo(held, 6);
  });

  it('jumps without smoothing on a snap', () => {
    const cam = camera();
    cam.snapTo(17, 9, 40);

    expect(cam.x).toBeCloseTo(17, 6);
    expect(cam.y).toBeCloseTo(9, 6);
    expect(cam.scale).toBeCloseTo(40, 6);
  });

  it('clamps a snap that would show past the edge', () => {
    const cam = camera();
    cam.snapTo(27, 14, 40);

    // At scale 40 the viewport spans 20 × 10 world units, so the centre cannot exceed (18, 10).
    expect(cam.x).toBeCloseTo(18, 6);
    expect(cam.y).toBeCloseTo(10, 6);
  });
});

describe('zoom', () => {
  it('eases towards a requested scale rather than snapping', () => {
    const cam = camera();
    cam.snapTo(14, 7.5, 20);
    cam.requestScale(50);

    cam.update(FRAME, null);
    expect(cam.scale).toBeGreaterThan(20);
    expect(cam.scale).toBeLessThan(50);

    for (let i = 0; i < 300; i++) cam.update(FRAME, null);
    expect(cam.scale).toBeCloseTo(50, 1);
  });

  it('refuses to zoom outside its limits', () => {
    const cam = camera();
    cam.requestScale(1000);
    for (let i = 0; i < 300; i++) cam.update(FRAME, null);
    expect(cam.scale).toBeCloseTo(60, 1);

    cam.requestScale(0.1);
    for (let i = 0; i < 300; i++) cam.update(FRAME, null);
    expect(cam.scale).toBeCloseTo(20, 1);
  });

  it('zooms out to frame a spread-out play, and back in for a tight one', () => {
    const cam = camera();

    cam.frameToFit([
      { x: 2, y: 2 },
      { x: 26, y: 13 },
    ]);
    for (let i = 0; i < 300; i++) cam.update(FRAME, null);
    const spreadScale = cam.scale;

    cam.frameToFit([
      { x: 13, y: 7 },
      { x: 15, y: 8 },
    ]);
    for (let i = 0; i < 300; i++) cam.update(FRAME, null);

    expect(cam.scale).toBeGreaterThan(spreadScale);
  });

  it('ignores an empty set of points', () => {
    const cam = camera();
    cam.requestScale(45);
    cam.frameToFit([]);
    for (let i = 0; i < 300; i++) cam.update(FRAME, null);
    expect(cam.scale).toBeCloseTo(45, 1);
  });
});

describe('bounds', () => {
  it('never shows past the edge of the field', () => {
    const cam = camera();
    cam.snapTo(14, 7.5, 60);
    follow(cam, { x: 100, y: 100 }, 5);

    const view = cam.view();
    const halfW = view.width / view.scale / 2;
    const halfH = view.height / view.scale / 2;

    expect(view.x - halfW).toBeGreaterThanOrEqual(-1e-6);
    expect(view.x + halfW).toBeLessThanOrEqual(28 + 1e-6);
    expect(view.y - halfH).toBeGreaterThanOrEqual(-1e-6);
    expect(view.y + halfH).toBeLessThanOrEqual(15 + 1e-6);
  });

  it('centres an axis the viewport is wider than', () => {
    // At scale 20 the 800 px viewport shows 40 world units — wider than the 28-unit court.
    const cam = camera();
    cam.snapTo(2, 7.5, 20);
    follow(cam, { x: 2, y: 7.5 }, 1);

    expect(cam.x).toBeCloseTo(14, 6);
  });

  it('re-clamps after a resize', () => {
    const cam = camera();
    cam.snapTo(26, 13, 60);
    cam.update(FRAME, { x: 26, y: 13 });
    cam.resize(1600, 400);

    const view = cam.view();
    expect(view.x + view.width / view.scale / 2).toBeLessThanOrEqual(28 + 1e-6);
  });
});

describe('shake', () => {
  it('offsets the view and decays back to nothing', () => {
    const cam = camera();
    const rng = createRng('shake');
    cam.snapTo(14, 7.5, 30);

    cam.shake(0.5);
    cam.update(FRAME, null, rng);
    const shaken = cam.view();
    expect(Math.hypot(shaken.x - 14, shaken.y - 7.5)).toBeGreaterThan(0);

    for (let i = 0; i < 600; i++) cam.update(FRAME, null, rng);
    const settled = cam.view();
    expect(Math.hypot(settled.x - 14, settled.y - 7.5)).toBeLessThan(1e-6);
  });

  it('is seeded, so two replays of the same match shake identically', () => {
    const trace = () => {
      const cam = camera();
      const rng = createRng('replay-shake');
      cam.snapTo(14, 7.5, 30);
      cam.shake(0.4);

      const path: number[] = [];
      for (let i = 0; i < 30; i++) {
        cam.update(FRAME, null, rng);
        path.push(cam.view().x);
      }
      return path;
    };

    expect(trace()).toEqual(trace());
  });

  it('keeps the strongest shake when two land together', () => {
    const cam = camera();
    const rng = createRng('double');
    cam.snapTo(14, 7.5, 30);

    cam.shake(0.2);
    cam.shake(0.6);
    cam.update(FRAME, null, rng);

    expect(Math.hypot(cam.view().x - 14, cam.view().y - 7.5)).toBeGreaterThan(0.2);
  });

  it('does nothing at all under reduced motion', () => {
    const cam = camera({ reducedMotion: true });
    const rng = createRng('quiet');
    cam.snapTo(14, 7.5, 30);

    cam.shake(2);
    cam.update(FRAME, null, rng);

    expect(cam.view().x).toBeCloseTo(14, 6);
    expect(cam.view().y).toBeCloseTo(7.5, 6);
  });

  it('stops mid-shake when reduced motion is turned on', () => {
    const cam = camera();
    const rng = createRng('interrupt');
    cam.snapTo(14, 7.5, 30);
    cam.shake(1);
    cam.update(FRAME, null, rng);

    cam.setReducedMotion(true);
    cam.update(FRAME, null, rng);
    expect(cam.view().x).toBeCloseTo(14, 6);
  });

  it('drops the lookahead lead under reduced motion too', () => {
    const still = zoomed({ reducedMotion: true });
    const normal = zoomed();

    still.update(FRAME, { x: 14, y: 7.5, vx: 8 });
    normal.update(FRAME, { x: 14, y: 7.5, vx: 8 });

    expect(still.x).toBeLessThan(normal.x);
  });
});

describe('coordinate conversion', () => {
  it('round-trips world → screen → world', () => {
    const cam = camera();
    cam.snapTo(14, 7.5, 25);

    const screen = cam.worldToScreen(18, 10, { x: 0, y: 0 });
    const world = cam.screenToWorld(screen.x, screen.y, { x: 0, y: 0 });

    expect(world.x).toBeCloseTo(18, 6);
    expect(world.y).toBeCloseTo(10, 6);
  });

  it('puts the camera centre at the middle of the viewport', () => {
    const cam = camera();
    cam.snapTo(14, 7.5, 25);

    const screen = cam.worldToScreen(14, 7.5, { x: 0, y: 0 });
    expect(screen.x).toBeCloseTo(400, 6);
    expect(screen.y).toBeCloseTo(200, 6);
  });
});

describe('a camera told not to fit the whole field (T-6.12)', () => {
  const PITCH_W = 105;
  const PITCH_H = 68;

  function zoomed(width = 900, height = 460) {
    return new Camera({
      width,
      height,
      worldWidth: PITCH_W,
      worldHeight: PITCH_H,
      minScale: width / 45,
      maxScale: 34,
    });
  }

  it('starts zoomed in rather than fitted', () => {
    const camera = zoomed();
    const fit = Math.min(900 / PITCH_W, 460 / PITCH_H);
    expect(camera.scale).toBeGreaterThan(fit);
    // 45 m of the long axis on screen.
    expect(900 / camera.scale).toBeCloseTo(45, 6);
  });

  it('keeps that floor across a resize — the bug this fixed', () => {
    const camera = zoomed();
    const before = camera.scale;
    // A rotation. Previously this clamped the floor down to fit-the-field and undid the zoom.
    camera.resize(460, 900);
    expect(camera.scale).toBe(before);
    camera.update(1 / 60, null);
    expect(camera.scale).toBeGreaterThan(Math.min(460 / PITCH_W, 900 / PITCH_H));
  });

  it('still recomputes the floor for a camera that asked for the default', () => {
    const camera = new Camera({
      width: 900,
      height: 460,
      worldWidth: PITCH_W,
      worldHeight: PITCH_H,
    });
    const fitted = Math.min(900 / PITCH_W, 460 / PITCH_H);
    expect(camera.scale).toBeCloseTo(fitted, 6);

    camera.resize(1800, 920);
    expect(camera.scale).toBeCloseTo(Math.min(1800 / PITCH_W, 920 / PITCH_H), 6);
  });

  it('follows the ball and stays inside the field', () => {
    const camera = zoomed();
    for (let i = 0; i < 240; i++) {
      camera.update(1 / 60, { x: 5, y: 3, vx: 0, vy: 0 });
    }
    const halfW = 900 / camera.scale / 2;
    const halfH = 460 / camera.scale / 2;
    expect(camera.x).toBeGreaterThanOrEqual(halfW - 1e-6);
    expect(camera.y).toBeGreaterThanOrEqual(halfH - 1e-6);
    // And it actually moved towards the corner rather than staying centred.
    expect(camera.x).toBeLessThan(PITCH_W / 2);
    expect(camera.y).toBeLessThan(PITCH_H / 2);
  });
});
