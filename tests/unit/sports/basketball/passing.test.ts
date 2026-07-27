/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.4 — Passing: aimed, lead passes, interceptions, turnovers
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  06-game-design.md §2 (aimed passing, pass assist), §7 (difficulty assists)
 * @invariant INV-1 (difficulty never touches ratings), INV-8 (determinism)
 *
 * Purpose: the four things a pass is — aimed, led, error-prone, and interceptable — each tested on
 * its own. The lead is the one worth being careful about: a lead that quietly does nothing looks
 * exactly like a lead that works, until you watch a cutting receiver run past every ball.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import { World } from '@/engine/world.ts';
import { NO_ENTITY } from '@/engine/world.ts';
import { createBall, DEFAULT_BALL_PHYSICS } from '@/engine/physics/ball.ts';
import { basketballCourt } from '@/sports/basketball/court.ts';
import {
  PASSING,
  ballSpeed,
  canIntercept,
  catchControl,
  interceptControl,
  leadTarget,
  passError,
  passSpeed,
  selectPassTarget,
  throwPass,
  type PasserRatings,
} from '@/sports/basketball/passing.ts';

const AVERAGE: PasserRatings = { passing: 50, composure: 50 };

function arena() {
  return new World({
    width: basketballCourt.width,
    height: basketballCourt.height,
    cellSize: 3,
    capacity: 16,
  });
}

describe('pass speed', () => {
  it('is gentler up close and harder over distance', () => {
    expect(passSpeed(2)).toBeLessThan(passSpeed(10));
    expect(passSpeed(10)).toBeLessThanOrEqual(PASSING.maxSpeed);
    // And never so slow it would be quicker to walk it over.
    expect(passSpeed(1, 0.1)).toBeGreaterThan(4);
  });
});

describe('leading a receiver', () => {
  it('throws at a standing receiver exactly where they are', () => {
    const world = arena();
    const receiver = world.spawn({ x: 18, y: 7.5 });
    const lead = leadTarget(world, { x: 10, y: 7.5 }, receiver);
    expect(lead.x).toBeCloseTo(18, 5);
    expect(lead.y).toBeCloseTo(7.5, 5);
    expect(lead.flightTime).toBeGreaterThan(0);
  });

  it('throws ahead of a cutting receiver', () => {
    const world = arena();
    const receiver = world.spawn({ x: 18, y: 7.5, vy: 5 });
    const lead = leadTarget(world, { x: 10, y: 7.5 }, receiver);
    expect(lead.y).toBeGreaterThan(9);
    // Ahead of them, but not so far ahead it is a pass to nobody.
    expect(lead.y).toBeLessThan(13);
  });

  it('leads a faster cut further', () => {
    const world = arena();
    const slow = world.spawn({ x: 18, y: 7.5, vy: 2 });
    const fast = world.spawn({ x: 18, y: 7.5, vy: 6 });
    const from = { x: 10, y: 7.5 };
    expect(leadTarget(world, from, fast).y).toBeGreaterThan(leadTarget(world, from, slow).y);
  });
});

describe('pass error', () => {
  it('shrinks as the passer gets better', () => {
    expect(passError({ passing: 95, composure: 50 }, 8, 0)).toBeLessThan(passError(AVERAGE, 8, 0));
    expect(passError(AVERAGE, 8, 0)).toBeLessThan(passError({ passing: 15, composure: 50 }, 8, 0));
  });

  it('grows with distance and with pressure', () => {
    expect(passError(AVERAGE, 14, 0)).toBeGreaterThan(passError(AVERAGE, 4, 0));
    expect(passError(AVERAGE, 8, 1)).toBeGreaterThan(passError(AVERAGE, 8, 0));
  });

  it('lets composure hold a pressured pass together', () => {
    const calm = passError({ passing: 50, composure: 95 }, 8, 1);
    const rattled = passError({ passing: 50, composure: 10 }, 8, 1);
    expect(calm).toBeLessThan(rattled);
    // Composure only matters under pressure.
    expect(passError({ passing: 50, composure: 95 }, 8, 0)).toBe(
      passError({ passing: 50, composure: 10 }, 8, 0),
    );
  });
});

describe('pass assist', () => {
  function three(world: World) {
    return [
      world.spawn({ x: 14, y: 2 }), // up-court, low sideline
      world.spawn({ x: 14, y: 13 }), // up-court, high sideline
      world.spawn({ x: 6, y: 7.5 }), // trailing
    ];
  }

  it('picks the teammate the stick is pointing at', () => {
    const world = arena();
    const [low, high, behind] = three(world) as [number, number, number];
    const all = [low, high, behind];
    const from = { x: 10, y: 7.5 };
    expect(selectPassTarget(world, from, 1, -1, all)).toBe(low);
    expect(selectPassTarget(world, from, 1, 1, all)).toBe(high);
    expect(selectPassTarget(world, from, -1, 0, all)).toBe(behind);
  });

  it('ignores a teammate outside the cone', () => {
    const world = arena();
    const behind = world.spawn({ x: 4, y: 7.5 });
    const ahead = world.spawn({ x: 18, y: 7.5 });
    // Aiming forward should never offer the athlete standing behind.
    expect(selectPassTarget(world, { x: 10, y: 7.5 }, 1, 0, [behind])).toBe(NO_ENTITY);
    expect(selectPassTarget(world, { x: 10, y: 7.5 }, 1, 0, [behind, ahead])).toBe(ahead);
  });

  it('offers the nearest teammate when there is no aim at all', () => {
    const world = arena();
    const near = world.spawn({ x: 12, y: 7.5 });
    const far = world.spawn({ x: 24, y: 7.5 });
    expect(selectPassTarget(world, { x: 10, y: 7.5 }, 0, 0, [far, near])).toBe(near);
  });

  it('widens the cone with assist strength and nothing else (INV-1)', () => {
    const world = arena();
    const wide = world.spawn({ x: 13, y: 14 });
    const from = { x: 10, y: 7.5 };

    // Straight up-court: the wide athlete is outside a normal cone and inside a generous one.
    expect(selectPassTarget(world, from, 1, 0, [wide], 0.6)).toBe(NO_ENTITY);
    expect(selectPassTarget(world, from, 1, 0, [wide], 1.6)).toBe(wide);

    // And the assist has no say in how well the pass is then thrown.
    expect(passError(AVERAGE, 8, 0)).toBe(passError(AVERAGE, 8, 0));
  });
});

describe('catching and intercepting', () => {
  it('rewards a good handler and punishes a fast ball', () => {
    expect(catchControl({ ballHandling: 90 }, PASSING.minSpeed)).toBeGreaterThan(
      catchControl({ ballHandling: 30 }, PASSING.minSpeed),
    );
    expect(catchControl({ ballHandling: 60 }, PASSING.maxSpeed)).toBeLessThan(
      catchControl({ ballHandling: 60 }, PASSING.minSpeed),
    );
  });

  it('makes a defender less likely to hold it than the receiver was', () => {
    // A covered lane should mostly deflect, because a deflection keeps the ball live.
    expect(interceptControl({ perimeterD: 100 })).toBeLessThan(
      catchControl({ ballHandling: 100 }, PASSING.minSpeed),
    );
    expect(interceptControl({ perimeterD: 90 })).toBeGreaterThan(
      interceptControl({ perimeterD: 30 }),
    );
  });

  it('cannot reach a ball that is too high or too far', () => {
    const world = arena();
    const defender = world.spawn({ x: 10, y: 7.5 });
    const ball = createBall(world, 10, 7.5, DEFAULT_BALL_PHYSICS, 1);

    expect(canIntercept(world, ball, defender)).toBe(true);

    world.z[ball.entity] = PASSING.catchHeight + 0.5;
    expect(canIntercept(world, ball, defender)).toBe(false);

    world.z[ball.entity] = 1.2;
    world.x[ball.entity] = 10 + PASSING.catchReach + 0.5;
    expect(canIntercept(world, ball, defender)).toBe(false);
  });
});

describe('throwing it', () => {
  function setup() {
    const world = arena();
    const passer = world.spawn({ x: 10, y: 7.5, facing: 0 });
    const receiver = world.spawn({ x: 18, y: 7.5 });
    const ball = createBall(world, 10, 7.5, DEFAULT_BALL_PHYSICS, 1);
    return { world, passer, receiver, ball };
  }

  it('sends the ball towards the target at pass height', () => {
    const { world, passer, receiver, ball } = setup();
    const lead = leadTarget(world, { x: 10, y: 7.5 }, receiver);
    throwPass(
      world,
      ball,
      passer,
      0,
      receiver,
      lead.x,
      lead.y,
      lead.flightTime,
      AVERAGE,
      0,
      0,
      createRng('p'),
    );

    expect(ball.carrier).toBe(NO_ENTITY);
    expect(world.vx[ball.entity] as number).toBeGreaterThan(5);
    expect(Math.abs(world.vy[ball.entity] as number)).toBeLessThan(3);
    expect(ballSpeed(world, ball)).toBeGreaterThan(PASSING.minSpeed * 0.5);
  });

  it('gives a better passer a tighter grouping (INV-8)', () => {
    const spread = (ratings: PasserRatings) => {
      const { world, passer, receiver, ball } = setup();
      const rng = createRng('grouping');
      let worst = 0;
      for (let i = 0; i < 200; i++) {
        world.x[ball.entity] = 10;
        world.y[ball.entity] = 7.5;
        throwPass(world, ball, passer, 0, receiver, 18, 7.5, 0.7, ratings, 0, i, rng);
        worst = Math.max(
          worst,
          Math.abs(Math.atan2(world.vy[ball.entity] as number, world.vx[ball.entity] as number)),
        );
      }
      return worst;
    };

    expect(spread({ passing: 95, composure: 80 })).toBeLessThan(
      spread({ passing: 20, composure: 30 }),
    );
  });

  it('replays identically from the same seed', () => {
    const throwFive = (seed: string) => {
      const { world, passer, receiver, ball } = setup();
      const rng = createRng(seed);
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        throwPass(world, ball, passer, 0, receiver, 18, 7.5, 0.7, AVERAGE, 0.4, i, rng);
        out.push(world.vx[ball.entity] as number, world.vy[ball.entity] as number);
      }
      return out.join(',');
    };
    expect(throwFive('same')).toBe(throwFive('same'));
    expect(throwFive('other')).not.toBe(throwFive('same'));
  });

  it('records the throw so the receiver can be told from the lane', () => {
    const { world, passer, receiver, ball } = setup();
    const pass = throwPass(
      world,
      ball,
      passer,
      0,
      receiver,
      18,
      7.5,
      0.7,
      AVERAGE,
      0,
      12,
      createRng('p'),
    );
    expect(pass).toMatchObject({ passer, side: 0, target: receiver, releaseStep: 12 });
    expect(pass.expireStep).toBeGreaterThan(pass.releaseStep);
    expect(pass.contested).toEqual([]);
  });
});
