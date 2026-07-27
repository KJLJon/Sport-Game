/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.4 — Movement & steering: seek, arrive, pursue, avoid
 * @story   US-2.1 — Control my athlete with a virtual joystick
 * @design  04-architecture.md §6
 * @invariant INV-8
 *
 * Purpose: each behaviour's shape — direction, magnitude, and the cases where it must do nothing.
 * The "does nothing" cases matter most: a behaviour that fires when it shouldn't is what makes AI
 * look drunk.
 */
import { describe, expect, it } from 'vitest';
import { World } from '@/engine/world.ts';
import { movementProfile, type Vec2 } from '@/engine/physics/movement.ts';
import {
  arrive,
  avoid,
  blend,
  evade,
  flee,
  pursue,
  seek,
  separate,
} from '@/engine/physics/steering.ts';

const MAX = 8;

function vec(): Vec2 {
  return { x: 0, y: 0 };
}

function heading(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}

describe('seek', () => {
  it('points at the target at full speed', () => {
    const out = seek(0, 0, 3, 4, MAX, vec());
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(MAX, 6);
    expect(out.x / out.y).toBeCloseTo(3 / 4, 6);
  });

  it('returns zero when already there, rather than dividing by zero', () => {
    expect(seek(5, 5, 5, 5, MAX, vec())).toEqual({ x: 0, y: 0 });
  });

  it('reuses the caller-owned vector', () => {
    const out = vec();
    expect(seek(0, 0, 1, 0, MAX, out)).toBe(out);
  });
});

describe('flee', () => {
  it('is seek with the sign flipped', () => {
    const away = flee(0, 0, 1, 0, MAX, vec());
    expect(away.x).toBeCloseTo(-MAX, 6);
    expect(away.y).toBeCloseTo(0, 6);
  });
});

describe('arrive', () => {
  it('runs at full speed outside the slowing radius', () => {
    const out = arrive(0, 0, 10, 0, MAX, 3, vec());
    expect(out.x).toBeCloseTo(MAX, 6);
  });

  it('scales speed down inside the slowing radius', () => {
    const out = arrive(0, 0, 1.5, 0, MAX, 3, vec());
    expect(out.x).toBeCloseTo(MAX * 0.5, 6);
  });

  it('stops inside the stop radius instead of jittering on the spot', () => {
    expect(arrive(0, 0, 0.01, 0, MAX, 3, vec())).toEqual({ x: 0, y: 0 });
    expect(arrive(5, 5, 5, 5, MAX, 3, vec())).toEqual({ x: 0, y: 0 });
  });

  it('decreases monotonically as the target is approached', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const distance of [3, 2.5, 2, 1.5, 1, 0.5, 0.2]) {
      const speed = Math.hypot(...Object.values(arrive(0, 0, distance, 0, MAX, 3, vec())));
      expect(speed).toBeLessThanOrEqual(previous);
      previous = speed;
    }
  });

  it('behaves like seek when the slowing radius is zero', () => {
    const out = arrive(0, 0, 0.5, 0, MAX, 0, vec());
    expect(out.x).toBeCloseTo(MAX, 6);
  });
});

describe('pursue', () => {
  it('leads a moving target', () => {
    const straight = seek(0, 0, 10, 0, MAX, vec());
    const led = pursue(0, 0, 10, 0, 0, 5, MAX, vec());

    expect(led.y).toBeGreaterThan(straight.y);
    expect(heading(led)).toBeGreaterThan(heading(straight));
  });

  it('does not lead a stationary target', () => {
    const led = pursue(0, 0, 10, 0, 0, 0, MAX, vec());
    expect(led.y).toBeCloseTo(0, 6);
    expect(led.x).toBeCloseTo(MAX, 6);
  });

  it('caps how far ahead it predicts', () => {
    const near = pursue(0, 0, 4, 0, 0, 6, MAX, vec(), 0.25);
    const far = pursue(0, 0, 100, 0, 0, 6, MAX, vec(), 0.25);

    // With prediction capped, the distant target's lead is a smaller share of the total offset,
    // so the chase angle is shallower rather than growing without bound.
    expect(Math.abs(heading(far))).toBeLessThan(Math.abs(heading(near)));
  });

  it('falls back to plain seek at zero max speed', () => {
    const out = pursue(0, 0, 10, 10, 5, 5, 0, vec());
    expect(out).toEqual({ x: 0, y: 0 });
  });
});

describe('evade', () => {
  it('runs from where the threat is heading', () => {
    const out = evade(0, 0, 10, 0, 0, 5, MAX, vec());
    expect(out.x).toBeLessThan(0);
    expect(out.y).toBeLessThan(0);
  });
});

describe('separate', () => {
  function crowd(): { world: World; centre: number } {
    const world = new World({ width: 28, height: 15, cellSize: 4, capacity: 32 });
    const centre = world.spawn({ x: 14, y: 7.5 });
    return { world, centre };
  }

  it('pushes directly away from a single neighbour', () => {
    const { world, centre } = crowd();
    world.spawn({ x: 15, y: 7.5 });

    const out = separate(world, centre, 2, MAX, new Int32Array(16), vec());
    expect(out.x).toBeCloseTo(-MAX, 6);
    expect(out.y).toBeCloseTo(0, 6);
  });

  it('returns zero when nobody is near', () => {
    const { world, centre } = crowd();
    world.spawn({ x: 27, y: 14 });

    expect(separate(world, centre, 2, MAX, new Int32Array(16), vec())).toEqual({ x: 0, y: 0 });
  });

  it('weights the closer neighbour more heavily', () => {
    const { world, centre } = crowd();
    world.spawn({ x: 14.3, y: 7.5 }); // very close, to the right
    world.spawn({ x: 12, y: 7.5 }); // further, to the left

    const out = separate(world, centre, 3, MAX, new Int32Array(16), vec());
    expect(out.x).toBeLessThan(0); // pushed away from the closer one
  });

  it('cancels to zero between two symmetric neighbours', () => {
    const { world, centre } = crowd();
    world.spawn({ x: 13, y: 7.5 });
    world.spawn({ x: 15, y: 7.5 });

    const out = separate(world, centre, 3, MAX, new Int32Array(16), vec());
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(0, 6);
  });

  it('ignores an exactly coincident neighbour rather than dividing by zero', () => {
    const { world, centre } = crowd();
    world.spawn({ x: 14, y: 7.5 });

    const out = separate(world, centre, 3, MAX, new Int32Array(16), vec());
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
  });

  it('never exceeds max speed, however crowded', () => {
    const { world, centre } = crowd();
    for (let i = 0; i < 12; i++) world.spawn({ x: 14.2 + i * 0.05, y: 7.6 });

    const out = separate(world, centre, 3, MAX, new Int32Array(32), vec());
    expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(MAX + 1e-6);
  });
});

describe('avoid', () => {
  it('does nothing when the obstacle is behind', () => {
    const out = vec();
    expect(avoid(0, 0, 5, 0, -5, 0, 1, MAX, out)).toBe(false);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('does nothing when the path misses the obstacle', () => {
    expect(avoid(0, 0, 5, 0, 3, 5, 1, MAX, vec())).toBe(false);
  });

  it('does nothing when the obstacle is beyond the lookahead', () => {
    expect(avoid(0, 0, 5, 0, 50, 0, 1, MAX, vec(), 1)).toBe(false);
  });

  it('does nothing when standing still', () => {
    expect(avoid(0, 0, 0, 0, 1, 0, 1, MAX, vec())).toBe(false);
  });

  it('steers aside when heading into the obstacle', () => {
    const out = vec();
    expect(avoid(0, 0, 5, 0, 3, 0.3, 1, MAX, out)).toBe(true);
    expect(out.y).toBeLessThan(0); // dodges away from the side the obstacle sits on
    expect(out.x).toBeGreaterThan(0); // and keeps going forward
    expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(MAX + 1e-6);
  });

  it('dodges to the opposite side for a mirrored obstacle', () => {
    const left = vec();
    const right = vec();
    avoid(0, 0, 5, 0, 3, 0.3, 1, MAX, left);
    avoid(0, 0, 5, 0, 3, -0.3, 1, MAX, right);

    expect(Math.sign(left.y)).toBe(-Math.sign(right.y));
  });

  it('dodges harder the more head-on the obstacle is', () => {
    const glancing = vec();
    const headOn = vec();
    avoid(0, 0, 5, 0, 3, 0.9, 1, MAX, glancing);
    avoid(0, 0, 5, 0, 3, 0.1, 1, MAX, headOn);

    expect(Math.abs(headOn.y)).toBeGreaterThan(Math.abs(glancing.y));
  });
});

describe('blend', () => {
  it('sums weighted behaviours', () => {
    const out = blend(vec(), MAX, [{ x: 2, y: 0 }, 1], [{ x: 0, y: 2 }, 0.5]);
    expect(out.x).toBeCloseTo(2, 6);
    expect(out.y).toBeCloseTo(1, 6);
  });

  it('clamps the result to max speed', () => {
    const out = blend(vec(), MAX, [{ x: 100, y: 0 }, 1], [{ x: 0, y: 100 }, 1]);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(MAX, 6);
  });

  it('returns zero for no behaviours', () => {
    expect(blend(vec(), MAX)).toEqual({ x: 0, y: 0 });
  });

  it('composes with a movement profile without exceeding it', () => {
    const profile = movementProfile({ speed: 70, acceleration: 70, agility: 70 });
    const out = blend(
      vec(),
      profile.maxSpeed,
      [seek(0, 0, 1, 0, profile.maxSpeed, vec()), 1],
      [seek(0, 0, 0, 1, profile.maxSpeed, vec()), 1],
    );
    expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(profile.maxSpeed + 1e-6);
  });
});
