/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.6 — Shooting: power meter, placement, curve, deflections
 * @story   US-4.2 — Pass, shoot, dribble, and cross
 * @design  06-game-design.md §3.2
 *
 * Purpose: the trade the power meter is offering. More power has to buy speed *and* cost accuracy,
 * or the meter is a shoot button with extra steps — so that pairing is what most of this pins,
 * along with curve coming from the run rather than from a button.
 */
import { describe, expect, it } from 'vitest';
import { createBall } from '@/engine/physics/ball.ts';
import { createRng } from '@/engine/rng.ts';
import { World } from '@/engine/world.ts';
import { SOCCER_BALL_PHYSICS } from '@/sports/soccer/ball.ts';
import { CENTRE_Y, PITCH, soccerPitch } from '@/sports/soccer/pitch.ts';
import {
  SHOOTING,
  aimPoint,
  chargePower,
  curveFrom,
  deflectShot,
  placementError,
  shotSpeed,
  takeShot,
  type ShooterRatings,
  type ShotAttempt,
} from '@/sports/soccer/shooting.ts';

const AVERAGE: ShooterRatings = { finishing: 50, shotPower: 50, coordination: 50 };
const ELITE: ShooterRatings = { finishing: 95, shotPower: 95, coordination: 95 };

function pitch() {
  return new World({
    width: soccerPitch.width,
    height: soccerPitch.height,
    cellSize: 6,
    capacity: 32,
  });
}

function attempt(overrides: Partial<ShotAttempt> = {}): ShotAttempt {
  return {
    shooter: 0,
    side: 0,
    ratings: AVERAGE,
    power: 0.5,
    placeAcross: 0,
    placeUp: 0.3,
    pressure: 0,
    approachAngle: 0,
    ...overrides,
  };
}

describe('the power meter', () => {
  it('fills over the charge time and stops at full', () => {
    expect(chargePower(0)).toBe(0);
    expect(chargePower(SHOOTING.chargeRealSeconds * 30)).toBeCloseTo(0.5, 6);
    expect(chargePower(SHOOTING.chargeRealSeconds * 60)).toBe(1);
    expect(chargePower(10_000)).toBe(1);
  });

  it('buys speed', () => {
    expect(shotSpeed(AVERAGE, 1)).toBeGreaterThan(shotSpeed(AVERAGE, 0.3));
    expect(shotSpeed(AVERAGE, 0)).toBe(SHOOTING.minSpeed);
  });

  it('and costs accuracy — which is the whole point of it being a meter', () => {
    const placed = placementError(AVERAGE, 12, SHOOTING.tapPower, 0);
    const blasted = placementError(AVERAGE, 12, 1, 0);
    expect(blasted.across).toBeGreaterThan(placed.across * 1.3);
  });

  it('raises the ceiling with shotPower, not the floor', () => {
    // A tap is a tap whoever takes it.
    expect(shotSpeed(ELITE, 0)).toBe(shotSpeed(AVERAGE, 0));
    // The difference shows up only when both wind up.
    expect(shotSpeed(ELITE, 1)).toBeGreaterThan(shotSpeed(AVERAGE, 1));
  });
});

describe('placement', () => {
  it('maps the joystick onto the goal mouth', () => {
    expect(aimPoint(0, 0.5).y).toBeCloseTo(CENTRE_Y, 6);
    expect(aimPoint(1, 0).y).toBeGreaterThan(CENTRE_Y);
    expect(aimPoint(-1, 0).y).toBeLessThan(CENTRE_Y);
    expect(aimPoint(0, 1).z).toBeGreaterThan(aimPoint(0, 0).z);
  });

  it('keeps the aim inside the frame, so the top corner is near the top corner', () => {
    const corner = aimPoint(1, 1);
    expect(corner.y).toBeLessThan(CENTRE_Y + PITCH.goalWidth / 2);
    expect(corner.z).toBeLessThan(PITCH.goalHeight);
    expect(corner.z).toBeGreaterThan(0);
  });

  it('clamps a joystick pushed past its own range', () => {
    expect(aimPoint(5, 5)).toEqual(aimPoint(1, 1));
    expect(aimPoint(-5, -5)).toEqual(aimPoint(-1, 0));
  });

  it('shrinks with finishing and grows with distance and pressure', () => {
    expect(placementError(ELITE, 12, 0.5, 0).across).toBeLessThan(
      placementError(AVERAGE, 12, 0.5, 0).across,
    );
    expect(placementError(AVERAGE, 30, 0.5, 0).across).toBeGreaterThan(
      placementError(AVERAGE, 8, 0.5, 0).across,
    );
    expect(placementError(AVERAGE, 12, 0.5, 1).across).toBeGreaterThan(
      placementError(AVERAGE, 12, 0.5, 0).across,
    );
  });

  it('sprays sideways more than upwards', () => {
    const error = placementError(AVERAGE, 12, 0.5, 0);
    expect(error.up).toBeLessThan(error.across);
  });
});

describe('curve', () => {
  it('is nothing at all when the shooter runs straight at goal', () => {
    expect(curveFrom(0, 95)).toBe(0);
    expect(curveFrom(0.1, 95)).toBe(0);
  });

  it('grows as the run cuts further across the ball', () => {
    expect(Math.abs(curveFrom(1.2, 50))).toBeGreaterThan(Math.abs(curveFrom(0.6, 50)));
  });

  it('bends the opposite way for the opposite run', () => {
    expect(curveFrom(1.2, 50)).toBeCloseTo(-curveFrom(-1.2, 50), 9);
  });

  it('is earned by coordination, the attribute 06 §3.2 names', () => {
    expect(Math.abs(curveFrom(1.2, 95))).toBeGreaterThan(Math.abs(curveFrom(1.2, 30)));
    expect(curveFrom(1.2, 0)).toBeCloseTo(0, 10);
  });

  it('handles an approach angle wrapped past half a turn', () => {
    expect(curveFrom(Math.PI * 1.5, 50)).toBeCloseTo(curveFrom(-Math.PI * 0.5, 50), 9);
  });
});

describe('striking the shot', () => {
  function scene(x = 90, y = CENTRE_Y) {
    const world = pitch();
    world.spawn({ x, y });
    const ball = createBall(world, x, y, SOCCER_BALL_PHYSICS);
    return { world, ball };
  }

  it('sends the ball towards the goal it is attacking', () => {
    const { world, ball } = scene();
    takeShot(world, ball, attempt(), 0, createRng('a'));
    expect(world.vx[ball.entity] as number).toBeGreaterThan(0);

    const other = scene(15);
    takeShot(other.world, other.ball, attempt({ side: 1 }), 0, createRng('a'));
    expect(other.world.vx[other.ball.entity] as number).toBeLessThan(0);
  });

  it('reports the chance honestly — distance and how much goal was on offer', () => {
    const central = scene(95, CENTRE_Y);
    const tight = scene(103, CENTRE_Y + 8);

    const good = takeShot(central.world, central.ball, attempt(), 0, createRng('a'));
    const bad = takeShot(tight.world, tight.ball, attempt(), 0, createRng('a'));

    expect(good.openness).toBeGreaterThan(bad.openness);
    // The bad chance is the *closer* one, which is exactly why distance alone will not do.
    expect(bad.distance).toBeLessThan(good.distance);
  });

  it('is deterministic for a seed, and different for another', () => {
    const run = (seed: string) => {
      const { world, ball } = scene();
      const shot = takeShot(world, ball, attempt(), 0, createRng(seed));
      return [shot.aim.y, shot.aim.z, world.vx[ball.entity], world.vz[ball.entity]];
    };
    expect(run('s1')).toEqual(run('s1'));
    expect(run('s1')).not.toEqual(run('s2'));
  });

  it('never aims the ball below the ground', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { world, ball } = scene();
      const shot = takeShot(world, ball, attempt({ placeUp: 0, power: 1 }), 0, createRng(seed));
      expect(shot.aim.z).toBeGreaterThanOrEqual(0);
    }
  });

  it('puts the earned spin on the ball and nothing when the run was straight', () => {
    const bent = scene();
    takeShot(bent.world, bent.ball, attempt({ approachAngle: 1.2 }), 0, createRng('a'));
    expect(bent.ball.spin).not.toBe(0);

    const straight = scene();
    takeShot(straight.world, straight.ball, attempt({ approachAngle: 0 }), 0, createRng('a'));
    expect(straight.ball.spin).toBe(0);
  });
});

describe('deflections', () => {
  function shotScene() {
    const world = pitch();
    world.spawn({ x: 90, y: CENTRE_Y });
    const ball = createBall(world, 90, CENTRE_Y, SOCCER_BALL_PHYSICS);
    const shot = takeShot(world, ball, attempt({ approachAngle: 1.2 }), 0, createRng('a'));
    return { world, ball, shot };
  }

  it('turns the ball and takes the pace off it', () => {
    const { world, ball, shot } = shotScene();
    const before = Math.hypot(world.vx[ball.entity] as number, world.vy[ball.entity] as number);
    const beforeAngle = Math.atan2(
      world.vy[ball.entity] as number,
      world.vx[ball.entity] as number,
    );

    expect(deflectShot(world, ball, shot, createRng('d'))).toBe(true);

    const after = Math.hypot(world.vx[ball.entity] as number, world.vy[ball.entity] as number);
    const afterAngle = Math.atan2(world.vy[ball.entity] as number, world.vx[ball.entity] as number);
    expect(after).toBeLessThan(before);
    expect(afterAngle).not.toBeCloseTo(beforeAngle, 6);
  });

  it('kills the bend, because the ball is no longer spinning as it was struck', () => {
    const { world, ball, shot } = shotScene();
    expect(ball.spin).not.toBe(0);
    deflectShot(world, ball, shot, createRng('d'));
    expect(ball.spin).toBe(0);
  });

  it('happens once — a ball off three legs in a row is a bug, not drama', () => {
    const { world, ball, shot } = shotScene();
    expect(deflectShot(world, ball, shot, createRng('d'))).toBe(true);
    expect(shot.deflected).toBe(true);
    expect(deflectShot(world, ball, shot, createRng('d'))).toBe(false);
  });

  it('does nothing to a ball that is not going anywhere', () => {
    const { world, ball, shot } = shotScene();
    world.vx[ball.entity] = 0;
    world.vy[ball.entity] = 0;
    expect(deflectShot(world, ball, shot, createRng('d'))).toBe(false);
  });
});
