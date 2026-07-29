/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.5 — Passing suite: short, through-ball, lofted, cross
 * @story   US-4.2 — Pass, shoot, dribble, and cross
 * @design  06-game-design.md §3.2
 *
 * Purpose: weight, which is the half of a soccer pass basketball does not have. A pass that goes
 * wrong here mostly goes wrong by being hit too hard or not hard enough, so the arithmetic that
 * turns "arrive at this speed, that far away" into a release speed is what most of this pins —
 * along with the offside snapshot, which has to be taken at release and nowhere else.
 */
import { describe, expect, it } from 'vitest';
import { createBall } from '@/engine/physics/ball.ts';
import { createRng } from '@/engine/rng.ts';
import { NO_ENTITY, World } from '@/engine/world.ts';
import { ROLL_DECAY_PER_METRE, SOCCER_BALL_PHYSICS } from '@/sports/soccer/ball.ts';
import { judgeOffside } from '@/sports/soccer/offside.ts';
import { CENTRE_Y, soccerPitch } from '@/sports/soccer/pitch.ts';
import {
  PASS_PROFILES,
  airFlightTime,
  groundArrivalSpeed,
  groundFlightTime,
  groundReleaseSpeed,
  isLive,
  leadTarget,
  markContested,
  passError,
  selectPassTarget,
  throwPass,
  type PassKind,
  type PasserRatings,
} from '@/sports/soccer/passing.ts';

const AVERAGE: PasserRatings = { shortPass: 50, longPass: 50, crossing: 50 };
const ELITE: PasserRatings = { shortPass: 95, longPass: 95, crossing: 95 };
const KINDS: readonly PassKind[] = ['short', 'through', 'lofted', 'cross'];

function pitch() {
  return new World({
    width: soccerPitch.width,
    height: soccerPitch.height,
    cellSize: 6,
    capacity: 32,
  });
}

function ballOf(world: World, x: number, y: number) {
  return createBall(world, x, y, SOCCER_BALL_PHYSICS);
}

describe('the four passes', () => {
  it('plays two along the ground and two through the air', () => {
    expect(PASS_PROFILES.short.grounded).toBe(true);
    expect(PASS_PROFILES.through.grounded).toBe(true);
    expect(PASS_PROFILES.lofted.grounded).toBe(false);
    expect(PASS_PROFILES.cross.grounded).toBe(false);
  });

  it('strikes each with the rating that belongs to it', () => {
    expect(PASS_PROFILES.short.rating).toBe('shortPass');
    expect(PASS_PROFILES.lofted.rating).toBe('longPass');
    expect(PASS_PROFILES.cross.rating).toBe('crossing');
  });

  it('makes a through ball the risky one, in weight and not in anything else', () => {
    expect(PASS_PROFILES.through.weightError).toBeGreaterThan(
      PASS_PROFILES.short.weightError * 2.5,
    );
    // Not simply a worse pass: it is aimed about as well as a short one.
    expect(PASS_PROFILES.through.baseError).toBeLessThan(PASS_PROFILES.short.baseError * 1.5);
  });

  it('arrives a cross at head height, which is what makes it a cross', () => {
    expect(PASS_PROFILES.cross.arrivalHeight).toBeGreaterThan(1.5);
    expect(PASS_PROFILES.lofted.arrivalHeight).toBeLessThan(1);
  });
});

describe('weighting a ground pass', () => {
  const profile = PASS_PROFILES.short;

  it('hits it harder the further it has to go, by exactly the roll decay', () => {
    const near = groundReleaseSpeed(profile, 10);
    const far = groundReleaseSpeed(profile, 20);
    expect(far - near).toBeCloseTo(ROLL_DECAY_PER_METRE * 10, 6);
  });

  it('arrives at the speed the profile asked for', () => {
    for (const distance of [5, 15, 25]) {
      const speed = groundReleaseSpeed(profile, distance);
      expect(groundArrivalSpeed(speed, distance)).toBeCloseTo(profile.arrivalSpeed, 6);
    }
  });

  it('falls short when it is underhit', () => {
    const distance = 30;
    const underhit = groundReleaseSpeed(profile, distance, 0.4);
    expect(groundArrivalSpeed(underhit, distance)).toBe(0);
    // And arrives faster when overhit.
    const overhit = groundReleaseSpeed(profile, distance, 1.3);
    expect(groundArrivalSpeed(overhit, distance)).toBeGreaterThan(profile.arrivalSpeed);
  });

  it('caps the release speed, which is what gives a ground pass a range', () => {
    const speed = groundReleaseSpeed(profile, 90);
    expect(speed).toBe(profile.maxSpeed);
    expect(groundArrivalSpeed(speed, 90)).toBe(0);
  });

  it('takes longer than distance over release speed, because the ball is slowing', () => {
    const distance = 25;
    const speed = groundReleaseSpeed(profile, distance);
    const naive = distance / speed;
    expect(groundFlightTime(speed, distance)).toBeGreaterThan(naive * 1.1);
  });

  it('still returns a finite time for a pass that never arrives', () => {
    const time = groundFlightTime(groundReleaseSpeed(profile, 90, 0.5), 90);
    expect(Number.isFinite(time)).toBe(true);
    expect(time).toBeGreaterThan(0);
  });

  it('hangs an aerial ball longer than a flat one', () => {
    expect(airFlightTime(PASS_PROFILES.lofted, 40)).toBeGreaterThan(
      40 / PASS_PROFILES.lofted.maxSpeed,
    );
  });
});

describe('error', () => {
  it('shrinks with the rating, on both the aim and the weight', () => {
    for (const kind of KINDS) {
      const profile = PASS_PROFILES[kind];
      const poor = passError(profile, AVERAGE, 20, 0);
      const good = passError(profile, ELITE, 20, 0);
      expect(good.angle).toBeLessThan(poor.angle);
      expect(good.weight).toBeLessThan(poor.weight);
    }
  });

  it('grows under pressure', () => {
    const profile = PASS_PROFILES.short;
    expect(passError(profile, AVERAGE, 20, 1).angle).toBeGreaterThan(
      passError(profile, AVERAGE, 20, 0).angle,
    );
  });

  it('grows the aim error with distance but not the weight error', () => {
    const profile = PASS_PROFILES.lofted;
    const near = passError(profile, AVERAGE, 5, 0);
    const far = passError(profile, AVERAGE, 50, 0);
    expect(far.angle).toBeGreaterThan(near.angle);
    // Over-hitting is about how cleanly it was struck, not how far it had to go.
    expect(far.weight).toBeCloseTo(near.weight, 9);
  });
});

describe('leading a receiver', () => {
  it('plays it to the feet of a standing receiver', () => {
    const world = pitch();
    const receiver = world.spawn({ x: 60, y: CENTRE_Y });
    const lead = leadTarget(world, { x: 40, y: CENTRE_Y }, receiver, 'short');
    expect(lead.x).toBeCloseTo(60, 5);
    expect(lead.y).toBeCloseTo(CENTRE_Y, 5);
    expect(lead.flightTime).toBeGreaterThan(0);
  });

  it('plays it ahead of a runner', () => {
    const world = pitch();
    const receiver = world.spawn({ x: 60, y: CENTRE_Y, vx: 6 });
    const lead = leadTarget(world, { x: 40, y: CENTRE_Y }, receiver, 'short');
    expect(lead.x).toBeGreaterThan(62);
  });

  it('plays a through ball further ahead still — into space, not to feet', () => {
    const world = pitch();
    const receiver = world.spawn({ x: 60, y: CENTRE_Y, vx: 6 });
    const from = { x: 40, y: CENTRE_Y };
    const toFeet = leadTarget(world, from, receiver, 'short');
    const intoSpace = leadTarget(world, from, receiver, 'through', 8);
    expect(intoSpace.x).toBeGreaterThan(toFeet.x + 6);
  });

  it('does not run a standing receiver onto a ball they are not moving towards', () => {
    const world = pitch();
    const receiver = world.spawn({ x: 60, y: CENTRE_Y });
    const lead = leadTarget(world, { x: 40, y: CENTRE_Y }, receiver, 'through', 8);
    expect(lead.x).toBeCloseTo(60, 5);
  });
});

describe('choosing who to pass to', () => {
  it('offers the teammate the player is aiming at', () => {
    const world = pitch();
    const ahead = world.spawn({ x: 70, y: CENTRE_Y });
    const behind = world.spawn({ x: 30, y: CENTRE_Y });
    const from = { x: 50, y: CENTRE_Y };
    expect(selectPassTarget(world, from, 1, 0, [ahead, behind])).toBe(ahead);
    expect(selectPassTarget(world, from, -1, 0, [ahead, behind])).toBe(behind);
  });

  it('offers the nearest teammate when the player is aiming at nothing', () => {
    const world = pitch();
    const near = world.spawn({ x: 56, y: CENTRE_Y });
    const far = world.spawn({ x: 80, y: CENTRE_Y });
    expect(selectPassTarget(world, { x: 50, y: CENTRE_Y }, 0, 0, [near, far])).toBe(near);
  });

  it('offers nobody outside the cone, and assist widens the cone and nothing else', () => {
    const world = pitch();
    const wide = world.spawn({ x: 52, y: CENTRE_Y + 25 });
    const from = { x: 50, y: CENTRE_Y };
    expect(selectPassTarget(world, from, 1, 0, [wide])).toBe(NO_ENTITY);
    expect(selectPassTarget(world, from, 1, 0, [wide], 2)).toBe(wide);
  });

  it('ignores a teammate standing on top of the passer', () => {
    const world = pitch();
    const onTop = world.spawn({ x: 50.1, y: CENTRE_Y });
    expect(selectPassTarget(world, { x: 50, y: CENTRE_Y }, 1, 0, [onTop])).toBe(NO_ENTITY);
  });
});

describe('striking the pass', () => {
  function attempt(kind: PassKind, overrides = {}) {
    return {
      kind,
      passer: 0,
      side: 0 as const,
      target: 1,
      toX: 70,
      toY: CENTRE_Y,
      ratings: AVERAGE,
      pressure: 0,
      ...overrides,
    };
  }

  it('puts the ball in the air for a cross and along the grass for a short pass', () => {
    const world = pitch();
    const passer = world.spawn({ x: 50, y: CENTRE_Y });
    void passer;
    const ball = ballOf(world, 50, CENTRE_Y);

    throwPass(world, ball, attempt('short'), 0, createRng('a'));
    expect(world.vz[ball.entity]).toBe(0);

    const air = ballOf(world, 50, CENTRE_Y);
    throwPass(world, air, attempt('cross'), 0, createRng('a'));
    expect(world.vz[air.entity] as number).toBeGreaterThan(0);
  });

  it('is deterministic for a seed, and different for another', () => {
    const run = (seed: string) => {
      const world = pitch();
      world.spawn({ x: 50, y: CENTRE_Y });
      const ball = ballOf(world, 50, CENTRE_Y);
      const pass = throwPass(world, ball, attempt('through'), 0, createRng(seed));
      return [pass.toX, pass.toY, world.vx[ball.entity], world.vy[ball.entity]];
    };
    expect(run('seed-a')).toEqual(run('seed-a'));
    expect(run('seed-a')).not.toEqual(run('seed-b'));
  });

  it('bends the ball when the player asks it to, and not otherwise', () => {
    const world = pitch();
    world.spawn({ x: 50, y: CENTRE_Y });

    const straight = ballOf(world, 50, CENTRE_Y);
    throwPass(world, straight, attempt('cross'), 0, createRng('a'));
    expect(straight.spin).toBe(0);

    const bent = ballOf(world, 50, CENTRE_Y);
    throwPass(world, bent, attempt('cross', { curve: 1 }), 0, createRng('a'));
    expect(bent.spin).toBeGreaterThan(0);
  });

  it('reports how fast a ground pass will be going when it gets there', () => {
    const world = pitch();
    world.spawn({ x: 50, y: CENTRE_Y });
    const ball = ballOf(world, 50, CENTRE_Y);
    const pass = throwPass(world, ball, attempt('short', { power: 1 }), 0, createRng('a'));
    expect(pass.arrivalSpeed).toBeGreaterThan(0);
    expect(pass.arrivalSpeed).toBeLessThan(PASS_PROFILES.short.maxSpeed);
  });

  it('expires, so a pass nobody took becomes a loose ball', () => {
    const world = pitch();
    world.spawn({ x: 50, y: CENTRE_Y });
    const ball = ballOf(world, 50, CENTRE_Y);
    const pass = throwPass(world, ball, attempt('lofted'), 100, createRng('a'));
    expect(isLive(pass, 100)).toBe(true);
    expect(isLive(pass, pass.expireStep + 1)).toBe(false);
  });

  it('gives each defender one read at it, not one per step', () => {
    const world = pitch();
    world.spawn({ x: 50, y: CENTRE_Y });
    const ball = ballOf(world, 50, CENTRE_Y);
    const pass = throwPass(world, ball, attempt('short'), 0, createRng('a'));
    expect(markContested(pass, 9)).toBe(true);
    expect(markContested(pass, 9)).toBe(false);
    expect(markContested(pass, 8)).toBe(true);
  });
});

describe('the offside contract', () => {
  function scene() {
    const world = pitch();
    const passer = world.spawn({ x: 60, y: CENTRE_Y });
    const ball = ballOf(world, 60, CENTRE_Y);
    return { world, passer, ball };
  }

  const DEFENDERS = [
    { id: 20, x: 104, y: CENTRE_Y },
    { id: 21, x: 80, y: CENTRE_Y },
    { id: 22, x: 78, y: CENTRE_Y },
  ];

  it('freezes the picture at release, so a later run does not make the receiver offside', () => {
    const { world, ball } = scene();
    const attackers = [
      { id: 0, x: 60, y: CENTRE_Y },
      { id: 1, x: 79, y: CENTRE_Y },
    ];

    const pass = throwPass(
      world,
      ball,
      {
        kind: 'through',
        passer: 0,
        side: 0,
        target: 1,
        toX: 95,
        toY: CENTRE_Y,
        ratings: AVERAGE,
        pressure: 0,
      },
      0,
      createRng('a'),
      { attackers, defenders: DEFENDERS },
    );

    expect(pass.offside).not.toBeNull();
    // Onside at the pass — and moving them now changes nothing, because nothing re-measures.
    attackers[1] = { id: 1, x: 100, y: CENTRE_Y };
    expect(judgeOffside(pass.offside!, 1)).toBe(false);
  });

  it('flags a receiver who was already beyond the line when it was struck', () => {
    const { world, ball } = scene();
    const pass = throwPass(
      world,
      ball,
      {
        kind: 'through',
        passer: 0,
        side: 0,
        target: 1,
        toX: 95,
        toY: CENTRE_Y,
        ratings: AVERAGE,
        pressure: 0,
      },
      0,
      createRng('a'),
      {
        attackers: [
          { id: 0, x: 60, y: CENTRE_Y },
          { id: 1, x: 90, y: CENTRE_Y },
        ],
        defenders: DEFENDERS,
      },
    );

    expect(judgeOffside(pass.offside!, 1)).toBe(true);
  });

  it('carries no snapshot when the caller has no squad to offer', () => {
    const { world, ball } = scene();
    const pass = throwPass(
      world,
      ball,
      {
        kind: 'short',
        passer: 0,
        side: 0,
        target: 1,
        toX: 70,
        toY: CENTRE_Y,
        ratings: AVERAGE,
        pressure: 0,
      },
      0,
      createRng('a'),
    );
    expect(pass.offside).toBeNull();
  });
});
