/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.4 — Movement & steering from attributes
 * @story   US-2.1 — Control my athlete with a virtual joystick
 * @design  04-architecture.md §6, 05-data-model.md §3
 * @invariant INV-8
 *
 * Purpose: that the three limits actually bind — top speed, acceleration, turn rate — and that a
 * higher-rated athlete is measurably better at each, which is the whole point of ratings.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { World } from '@/engine/world.ts';
import {
  MOVEMENT_TUNING,
  integrate,
  integrateAll,
  limit,
  movementProfile,
  normaliseAngle,
  signedAngleDelta,
  type MovementProfile,
  type Vec2,
} from '@/engine/physics/movement.ts';

const STEP = 1 / 60;

function world(): World {
  return new World({ width: 28, height: 15, cellSize: 4, capacity: 32 });
}

function profileFor(speed: number, acceleration = speed, agility = speed): MovementProfile {
  return movementProfile({ speed, acceleration, agility });
}

/** Runs `steps` steps with a constant desired velocity and reports the resulting speed. */
function run(w: World, id: number, profile: MovementProfile, desired: Vec2 | null, steps: number) {
  for (let i = 0; i < steps; i++) integrate(w, id, profile, desired, STEP);
  return Math.hypot(w.vx[id] as number, w.vy[id] as number);
}

describe('movementProfile', () => {
  it('maps the rating range onto the tuned physical range', () => {
    const floor = profileFor(1);
    const ceiling = profileFor(99);

    expect(floor.maxSpeed).toBeCloseTo(MOVEMENT_TUNING.minSpeed, 6);
    expect(ceiling.maxSpeed).toBeCloseTo(MOVEMENT_TUNING.minSpeed + MOVEMENT_TUNING.speedRange, 6);
    expect(floor.acceleration).toBeCloseTo(MOVEMENT_TUNING.minAcceleration, 6);
    expect(ceiling.turnRate).toBeCloseTo(
      MOVEMENT_TUNING.minTurnRate + MOVEMENT_TUNING.turnRateRange,
      6,
    );
  });

  it('stops faster than it starts', () => {
    const profile = profileFor(50);
    expect(profile.deceleration).toBeGreaterThan(profile.acceleration);
  });

  it('is monotonic in every rating', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 98 }),
        fc.integer({ min: 1, max: 20 }),
        (rating, step) => {
          const lower = profileFor(rating);
          const higher = profileFor(Math.min(99, rating + step));
          expect(higher.maxSpeed).toBeGreaterThanOrEqual(lower.maxSpeed);
          expect(higher.acceleration).toBeGreaterThanOrEqual(lower.acceleration);
          expect(higher.turnRate).toBeGreaterThanOrEqual(lower.turnRate);
        },
      ),
    );
  });

  it('clamps ratings outside 1–99 rather than extrapolating', () => {
    expect(profileFor(-50).maxSpeed).toBeCloseTo(profileFor(1).maxSpeed, 6);
    expect(profileFor(500).maxSpeed).toBeCloseTo(profileFor(99).maxSpeed, 6);
  });
});

describe('integrate — speed', () => {
  it('accelerates towards the desired velocity, not straight to it', () => {
    const w = world();
    const id = w.spawn({ x: 14, y: 7.5 });
    const profile = profileFor(50);
    const desired = { x: profile.maxSpeed, y: 0 };

    integrate(w, id, profile, desired, STEP);
    const afterOneStep = w.vx[id] as number;

    expect(afterOneStep).toBeGreaterThan(0);
    expect(afterOneStep).toBeCloseTo(profile.acceleration * STEP, 5);
    expect(afterOneStep).toBeLessThan(profile.maxSpeed);
  });

  it('reaches top speed and holds there', () => {
    const w = world();
    const id = w.spawn({ x: 2, y: 7.5 });
    const profile = profileFor(60);

    const speed = run(w, id, profile, { x: 99, y: 0 }, 200);
    expect(speed).toBeCloseTo(profile.maxSpeed, 4);
  });

  it('never exceeds top speed however hard it is pushed', () => {
    const w = world();
    const id = w.spawn({ x: 2, y: 7.5 });
    const profile = profileFor(30);

    for (let i = 0; i < 300; i++) {
      integrate(w, id, profile, { x: 1000, y: 1000 }, STEP);
      expect(Math.hypot(w.vx[id] as number, w.vy[id] as number)).toBeLessThanOrEqual(
        profile.maxSpeed + 1e-6,
      );
    }
  });

  it('decelerates to a full stop and stays stopped', () => {
    const w = world();
    const id = w.spawn({ x: 14, y: 7.5 });
    const profile = profileFor(50);

    run(w, id, profile, { x: profile.maxSpeed, y: 0 }, 200);
    const stopped = run(w, id, profile, null, 200);

    expect(stopped).toBe(0);
    expect(w.vx[id]).toBe(0);
    expect(w.vy[id]).toBe(0);
  });

  it('sheds speed along its heading, never sideways', () => {
    const w = world();
    const id = w.spawn({ x: 14, y: 7.5 });
    const profile = profileFor(50);

    run(w, id, profile, { x: 3, y: 4 }, 60);
    const headingBefore = Math.atan2(w.vy[id] as number, w.vx[id] as number);

    integrate(w, id, profile, null, STEP);
    expect(Math.atan2(w.vy[id] as number, w.vx[id] as number)).toBeCloseTo(headingBefore, 6);
  });

  it('gives the quicker athlete the better first step', () => {
    const w = world();
    const quick = w.spawn({ x: 2, y: 5 });
    const slow = w.spawn({ x: 2, y: 10 });

    const quickProfile = profileFor(90);
    const slowProfile = profileFor(20);

    const quickSpeed = run(w, quick, quickProfile, { x: 99, y: 0 }, 12);
    const slowSpeed = run(w, slow, slowProfile, { x: 99, y: 0 }, 12);

    expect(quickSpeed).toBeGreaterThan(slowSpeed);
    expect(w.x[quick] as number).toBeGreaterThan(w.x[slow] as number);
  });
});

describe('integrate — turning', () => {
  it('limits how fast a moving athlete can change direction', () => {
    const w = world();
    const id = w.spawn({ x: 14, y: 7.5 });
    const profile = profileFor(50);

    run(w, id, profile, { x: profile.maxSpeed, y: 0 }, 200);
    integrate(w, id, profile, { x: -profile.maxSpeed, y: 0.001 }, STEP);

    const heading = Math.atan2(w.vy[id] as number, w.vx[id] as number);
    expect(Math.abs(heading)).toBeLessThanOrEqual(profile.turnRate * STEP + 1e-6);
  });

  it('lets a nimbler athlete turn further in the same step', () => {
    const w = world();
    const nimble = w.spawn({ x: 5, y: 5 });
    const stiff = w.spawn({ x: 5, y: 10 });

    const nimbleProfile = movementProfile({ speed: 50, acceleration: 50, agility: 95 });
    const stiffProfile = movementProfile({ speed: 50, acceleration: 50, agility: 10 });

    run(w, nimble, nimbleProfile, { x: 9, y: 0 }, 120);
    run(w, stiff, stiffProfile, { x: 9, y: 0 }, 120);

    integrate(w, nimble, nimbleProfile, { x: 0, y: 9 }, STEP);
    integrate(w, stiff, stiffProfile, { x: 0, y: 9 }, STEP);

    const nimbleTurn = Math.atan2(w.vy[nimble] as number, w.vx[nimble] as number);
    const stiffTurn = Math.atan2(w.vy[stiff] as number, w.vx[stiff] as number);
    expect(nimbleTurn).toBeGreaterThan(stiffTurn);
  });

  it('lets a standing athlete pivot instantly, so starting off never feels sticky', () => {
    const w = world();
    const id = w.spawn({ x: 14, y: 7.5 });
    const profile = profileFor(50);

    integrate(w, id, profile, { x: 0, y: -5 }, STEP);
    expect(w.vy[id] as number).toBeLessThan(0);
    expect(Math.abs(w.vx[id] as number)).toBeLessThan(1e-6);
  });

  it('eventually completes a reversal', () => {
    const w = world();
    const id = w.spawn({ x: 14, y: 7.5 });
    const profile = profileFor(50);

    run(w, id, profile, { x: 9, y: 0 }, 200);
    run(w, id, profile, { x: -9, y: 0 }, 200);

    expect(w.vx[id] as number).toBeLessThan(0);
    expect(Math.hypot(w.vx[id] as number, w.vy[id] as number)).toBeCloseTo(profile.maxSpeed, 3);
  });

  it('faces the way it means to go while standing still', () => {
    const w = world();
    const id = w.spawn({ x: 14, y: 7.5, facing: 0 });
    const profile = profileFor(50);

    integrate(w, id, profile, { x: -1, y: 0 }, STEP);
    expect(Math.abs(normaliseAngle((w.facing[id] as number) - Math.PI))).toBeLessThan(1e-6);
  });
});

describe('integrate — position and bookkeeping', () => {
  it('moves by velocity × dt', () => {
    const w = world();
    const id = w.spawn({ x: 10, y: 5 });
    const profile = profileFor(50);

    integrate(w, id, profile, { x: 3, y: 0 }, STEP);
    expect(w.x[id] as number).toBeCloseTo(10 + (w.vx[id] as number) * STEP, 6);
    expect(w.y[id] as number).toBeCloseTo(5, 6);
  });

  it('marks the spatial index stale, since it wrote positions directly', () => {
    const w = world();
    const id = w.spawn({ x: 10, y: 5 });
    w.reindex();

    integrate(w, id, profileFor(50), { x: 1, y: 0 }, STEP);
    expect(w.isIndexed).toBe(false);
  });

  it('is deterministic — identical inputs, identical positions', () => {
    const run2 = () => {
      const w = world();
      const id = w.spawn({ x: 3, y: 3 });
      const profile = profileFor(64);
      for (let i = 0; i < 120; i++) {
        integrate(w, id, profile, { x: Math.cos(i / 9) * 8, y: Math.sin(i / 7) * 8 }, STEP);
      }
      return [w.x[id], w.y[id], w.vx[id], w.vy[id]];
    };

    expect(run2()).toEqual(run2());
  });
});

describe('integrateAll', () => {
  it('skips entities with no profile and reindexes once at the end', () => {
    const w = world();
    const mover = w.spawn({ x: 5, y: 5 });
    const statue = w.spawn({ x: 6, y: 5 });
    const profile = profileFor(50);

    integrateAll(
      w,
      STEP,
      (id) => (id === mover ? profile : null),
      () => ({ x: 5, y: 0 }),
    );

    expect(w.x[mover] as number).toBeGreaterThan(5);
    expect(w.x[statue] as number).toBe(6);
    expect(w.isIndexed).toBe(true);
  });
});

describe('angle helpers', () => {
  it('takes the short way round', () => {
    expect(signedAngleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6);
    expect(signedAngleDelta(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 6);
    expect(signedAngleDelta(3, -3)).toBeCloseTo(0.2831853, 5);
    expect(signedAngleDelta(-3, 3)).toBeCloseTo(-0.2831853, 5);
  });

  it('stays within ±π for any pair of angles', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        (from, to) => {
          const delta = signedAngleDelta(from, to);
          expect(delta).toBeGreaterThanOrEqual(-Math.PI - 1e-9);
          expect(delta).toBeLessThanOrEqual(Math.PI + 1e-9);
        },
      ),
    );
  });

  it('limits a vector without changing its direction', () => {
    const v = { x: 30, y: 40 };
    limit(v, 5);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(5, 6);
    expect(v.y / v.x).toBeCloseTo(40 / 30, 6);

    const short = { x: 1, y: 0 };
    limit(short, 5);
    expect(short.x).toBe(1);
  });
});
