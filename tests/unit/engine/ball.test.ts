/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.6 — Ball physics
 * @story   US-3.2, US-4.2
 * @design  04-architecture.md §6, 06-game-design.md §3.1
 * @invariant INV-2, INV-8
 *
 * Purpose: flight, bounce, roll, curve, and possession — including the settling behaviour, which
 * is where a naive bounce model spends the rest of the match buzzing on the floor.
 */
import { describe, expect, it } from 'vitest';
import { NO_ENTITY, World } from '@/engine/world.ts';
import { createRng } from '@/engine/rng.ts';
import {
  DEFAULT_BALL_PHYSICS,
  attach,
  attemptCatch,
  canCatch,
  createBall,
  isAtRest,
  launchVelocity,
  release,
  stepBall,
  type BallState,
} from '@/engine/physics/ball.ts';

const STEP = 1 / 60;
const P = DEFAULT_BALL_PHYSICS;

function court(): World {
  return new World({ width: 28, height: 15, cellSize: 4, capacity: 32 });
}

function stepFor(world: World, ball: BallState, seconds: number) {
  const steps = Math.round(seconds / STEP);
  let bounces = 0;
  for (let i = 0; i < steps; i++) {
    if (stepBall(world, ball, STEP).bounced) bounces++;
  }
  return bounces;
}

describe('createBall', () => {
  it('starts resting on the ground, owned by nobody', () => {
    const world = court();
    const ball = createBall(world, 14, 7.5);

    expect(ball.carrier).toBe(NO_ENTITY);
    expect(ball.lastToucher).toBe(NO_ENTITY);
    expect(world.z[ball.entity]).toBeCloseTo(P.radius, 6);
    expect(isAtRest(world, ball)).toBe(true);
  });

  it('is intangible, so it never shoves an athlete off their line', () => {
    const world = court();
    const ball = createBall(world, 14, 7.5);
    expect(world.hasFlag(ball.entity, 1 /* INTANGIBLE */)).toBe(true);
  });
});

describe('flight', () => {
  it('falls under gravity', () => {
    const world = court();
    const ball = createBall(world, 14, 7.5);
    world.z[ball.entity] = 3;

    stepBall(world, ball, STEP);
    expect(world.vz[ball.entity] as number).toBeCloseTo(-P.gravity * STEP, 5);
    expect(world.z[ball.entity] as number).toBeLessThan(3);
  });

  it('follows an arc that peaks and comes back down', () => {
    const world = court();
    const ball = createBall(world, 5, 7.5);
    release(world, ball, 4, 0, 6);

    let peak = 0;
    for (let i = 0; i < 90; i++) {
      stepBall(world, ball, STEP);
      peak = Math.max(peak, world.z[ball.entity] as number);
    }

    expect(peak).toBeGreaterThan(1.5);
    expect(world.x[ball.entity] as number).toBeGreaterThan(5);
    expect(world.z[ball.entity] as number).toBeLessThan(peak);
  });

  it('loses a little speed to drag', () => {
    const world = court();
    const ball = createBall(world, 5, 7.5);
    world.z[ball.entity] = 5;
    release(world, ball, 10, 0, 0);

    for (let i = 0; i < 30; i++) stepBall(world, ball, STEP);
    const vx = world.vx[ball.entity] as number;

    expect(vx).toBeLessThan(10);
    expect(vx).toBeGreaterThan(9);
  });

  it('curves with spin, and the other way with opposite spin', () => {
    const fly = (spin: number) => {
      const world = court();
      const ball = createBall(world, 5, 7.5);
      world.z[ball.entity] = 2;
      release(world, ball, 12, 0, 2, spin);
      for (let i = 0; i < 40; i++) stepBall(world, ball, STEP);
      return world.y[ball.entity] as number;
    };

    expect(fly(30)).toBeGreaterThan(7.5);
    expect(fly(-30)).toBeLessThan(7.5);
    expect(fly(0)).toBeCloseTo(7.5, 6);
  });

  it('does not gain speed from spin', () => {
    const world = court();
    const ball = createBall(world, 5, 7.5);
    world.z[ball.entity] = 6;
    release(world, ball, 10, 0, 0, 60);

    for (let i = 0; i < 30; i++) stepBall(world, ball, STEP);
    const speed = Math.hypot(world.vx[ball.entity] as number, world.vy[ball.entity] as number);
    expect(speed).toBeLessThanOrEqual(10);
  });

  it('lets spin decay, so a curve straightens out', () => {
    const world = court();
    const ball = createBall(world, 5, 7.5);
    world.z[ball.entity] = 6;
    release(world, ball, 10, 0, 0, 40);

    for (let i = 0; i < 60; i++) stepBall(world, ball, STEP);
    expect(Math.abs(ball.spin)).toBeLessThan(40);
  });
});

describe('bounce and roll', () => {
  it('bounces to a fraction of its impact speed', () => {
    const world = court();
    const ball = createBall(world, 14, 7.5);
    world.z[ball.entity] = 2;

    let impact = 0;
    for (let i = 0; i < 120; i++) {
      const result = stepBall(world, ball, STEP);
      if (result.bounced) {
        impact = result.impactSpeed;
        break;
      }
    }

    expect(impact).toBeGreaterThan(5);
    expect(world.vz[ball.entity] as number).toBeCloseTo(impact * P.restitution, 5);
  });

  it('bounces lower each time and eventually settles', () => {
    const world = court();
    const ball = createBall(world, 14, 7.5);
    world.z[ball.entity] = 2;

    const peaks: number[] = [];
    let rising = false;
    let peak = 0;

    for (let i = 0; i < 60 * 12; i++) {
      stepBall(world, ball, STEP);
      const z = world.z[ball.entity] as number;
      const vz = world.vz[ball.entity] as number;
      if (vz > 0) rising = true;
      if (rising && vz <= 0) {
        peaks.push(peak);
        rising = false;
      }
      peak = vz > 0 ? z : peak;
    }

    expect(peaks.length).toBeGreaterThan(2);
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i] as number).toBeLessThan(peaks[i - 1] as number);
    }
    expect(world.vz[ball.entity]).toBe(0);
  });

  it('reports the settle exactly once', () => {
    const world = court();
    const ball = createBall(world, 14, 7.5);
    world.z[ball.entity] = 0.2;
    world.vz[ball.entity] = -0.2;

    let settles = 0;
    for (let i = 0; i < 300; i++) {
      if (stepBall(world, ball, STEP).settled) settles++;
    }
    expect(settles).toBe(1);
  });

  it('keeps some forward speed through a bounce, but not all of it', () => {
    const world = court();
    const ball = createBall(world, 5, 7.5);
    world.z[ball.entity] = 2;
    release(world, ball, 8, 0, 0);

    for (let i = 0; i < 200; i++) {
      if (stepBall(world, ball, STEP).bounced) break;
    }

    const vx = world.vx[ball.entity] as number;
    expect(vx).toBeGreaterThan(0);
    expect(vx).toBeLessThan(8);
  });

  it('rolls to a stop on the ground', () => {
    const world = court();
    const ball = createBall(world, 5, 7.5);
    release(world, ball, 6, 0, 0);

    stepFor(world, ball, 20);
    expect(isAtRest(world, ball)).toBe(true);
    expect(world.x[ball.entity] as number).toBeGreaterThan(5);
  });

  it('stays within a sensible margin of the field', () => {
    const world = court();
    const ball = createBall(world, 27, 7.5);
    release(world, ball, 40, 0, 0);

    stepFor(world, ball, 30);
    expect(world.x[ball.entity] as number).toBeLessThanOrEqual(world.width + 10);
  });

  it('is deterministic', () => {
    const trace = () => {
      const world = court();
      const ball = createBall(world, 3, 3);
      release(world, ball, 9, 4, 7, 25);
      stepFor(world, ball, 6);
      return [world.x[ball.entity], world.y[ball.entity], world.z[ball.entity]];
    };

    expect(trace()).toEqual(trace());
  });
});

describe('possession', () => {
  function withCarrier() {
    const world = court();
    const athlete = world.spawn({ x: 10, y: 7.5, facing: 0, radius: 0.4 });
    const ball = createBall(world, 14, 7.5);
    return { world, athlete, ball };
  }

  it('places a carried ball in front of its carrier', () => {
    const { world, athlete, ball } = withCarrier();
    attach(world, ball, athlete);

    expect(ball.carrier).toBe(athlete);
    expect(ball.lastToucher).toBe(athlete);
    expect(world.x[ball.entity] as number).toBeCloseTo(10 + 0.4 + P.radius, 5);
    expect(world.y[ball.entity] as number).toBeCloseTo(7.5, 5);
  });

  it('follows the carrier as they move and turn', () => {
    const { world, athlete, ball } = withCarrier();
    attach(world, ball, athlete);

    world.x[athlete] = 20;
    world.facing[athlete] = Math.PI / 2;
    stepBall(world, ball, STEP);

    expect(world.x[ball.entity] as number).toBeCloseTo(20, 5);
    expect(world.y[ball.entity] as number).toBeGreaterThan(7.5);
  });

  it('does not fall while carried', () => {
    const { world, athlete, ball } = withCarrier();
    attach(world, ball, athlete);

    const height = world.z[ball.entity] as number;
    for (let i = 0; i < 120; i++) stepBall(world, ball, STEP);
    expect(world.z[ball.entity] as number).toBeCloseTo(height, 6);
  });

  it('releases with the given velocity and spin', () => {
    const { world, athlete, ball } = withCarrier();
    attach(world, ball, athlete);
    release(world, ball, 5, 1, 4, 12);

    expect(ball.carrier).toBe(NO_ENTITY);
    expect(ball.lastToucher).toBe(athlete);
    expect(ball.spin).toBe(12);
    expect([world.vx[ball.entity], world.vy[ball.entity], world.vz[ball.entity]]).toEqual([
      5, 1, 4,
    ]);
  });

  it('stops the passer instantly re-catching their own pass', () => {
    const { world, athlete, ball } = withCarrier();
    attach(world, ball, athlete);
    release(world, ball, 1, 0, 0);

    expect(canCatch(world, ball, athlete, 2, 2)).toBe(false);
    for (let i = 0; i < 10; i++) stepBall(world, ball, STEP);
    expect(canCatch(world, ball, athlete, 2, 2)).toBe(true);
  });

  it('lets a different athlete catch it immediately', () => {
    const { world, athlete, ball } = withCarrier();
    const receiver = world.spawn({ x: 11, y: 7.5 });
    attach(world, ball, athlete);
    release(world, ball, 1, 0, 0);

    expect(canCatch(world, ball, receiver, 2, 2)).toBe(true);
  });

  it('refuses a catch that is out of reach, too high, or already owned', () => {
    const { world, athlete, ball } = withCarrier();
    expect(canCatch(world, ball, athlete, 1, 2)).toBe(false); // 4 m away

    world.z[ball.entity] = 5;
    expect(canCatch(world, ball, athlete, 10, 2)).toBe(false); // above reach

    world.z[ball.entity] = P.radius;
    attach(world, ball, athlete);
    expect(canCatch(world, ball, athlete, 10, 2)).toBe(false); // already carried
  });
});

describe('attemptCatch', () => {
  function loose() {
    const world = court();
    const athlete = world.spawn({ x: 10, y: 7.5, facing: 0 });
    const ball = createBall(world, 10.5, 7.5);
    release(world, ball, 6, 0, 1, 0, 0);
    return { world, athlete, ball };
  }

  it('takes possession on success', () => {
    const { world, athlete, ball } = loose();
    expect(attemptCatch(world, ball, athlete, 1, createRng('sure'))).toBe(true);
    expect(ball.carrier).toBe(athlete);
  });

  it('fumbles loose on failure rather than leaving the ball frozen', () => {
    const { world, athlete, ball } = loose();
    const before = Math.hypot(world.vx[ball.entity] as number, world.vy[ball.entity] as number);

    expect(attemptCatch(world, ball, athlete, 0, createRng('drop'))).toBe(false);
    expect(ball.carrier).toBe(NO_ENTITY);
    expect(ball.lastToucher).toBe(athlete);
    expect(world.vz[ball.entity] as number).toBeGreaterThan(0);
    expect(
      Math.hypot(world.vx[ball.entity] as number, world.vy[ball.entity] as number),
    ).not.toBeCloseTo(before, 3);
  });

  it('succeeds about as often as its control value says', () => {
    const rng = createRng('catches');
    let caught = 0;

    for (let i = 0; i < 2000; i++) {
      const { world, athlete, ball } = loose();
      if (attemptCatch(world, ball, athlete, 0.7, rng)) caught++;
    }

    expect(caught / 2000).toBeCloseTo(0.7, 1);
  });

  it('replays identically from the same seed', () => {
    const outcomes = () => {
      const rng = createRng('replay-catch');
      return Array.from({ length: 40 }, () => {
        const { world, athlete, ball } = loose();
        return attemptCatch(world, ball, athlete, 0.5, rng);
      });
    };

    expect(outcomes()).toEqual(outcomes());
  });
});

describe('launchVelocity', () => {
  const out = { x: 0, y: 0, z: 0 };

  it('lands the ball on the target in the requested time', () => {
    const world = court();
    const ball = createBall(world, 4, 4);
    world.z[ball.entity] = 1.8;

    const flight = 1.0;
    const v = launchVelocity(4, 4, 1.8, 20, 11, 3.05, flight, P.gravity, out);
    release(world, ball, v.x, v.y, v.z);

    for (let i = 0; i < Math.round(flight / STEP); i++) stepBall(world, ball, STEP);

    // Drag pulls it a little short of the mark, which is physical rather than a miss.
    expect(world.x[ball.entity] as number).toBeGreaterThan(19);
    expect(world.x[ball.entity] as number).toBeLessThanOrEqual(20.1);
    expect(world.y[ball.entity] as number).toBeCloseTo(11, 0);
    expect(world.z[ball.entity] as number).toBeCloseTo(3.05, 0);
  });

  it('throws harder for a shorter flight time', () => {
    const slow = launchVelocity(0, 0, 1, 10, 0, 1, 2, P.gravity, { x: 0, y: 0, z: 0 });
    const fast = launchVelocity(0, 0, 1, 10, 0, 1, 0.5, P.gravity, { x: 0, y: 0, z: 0 });
    expect(fast.x).toBeGreaterThan(slow.x);
  });

  it('survives a zero flight time instead of dividing by zero', () => {
    const v = launchVelocity(0, 0, 0, 1, 1, 1, 0, P.gravity, out);
    expect(Number.isFinite(v.x)).toBe(true);
    expect(Number.isFinite(v.z)).toBe(true);
  });
});
