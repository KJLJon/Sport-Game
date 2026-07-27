/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.3 — Shooting: hold-release meter, arc trajectory, make probability
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  06-game-design.md §3.1 (shooting model), §2 (release window), §7 (difficulty)
 * @invariant INV-1 (difficulty never touches ratings), INV-8 (determinism)
 *
 * Purpose: the shooting model, term by term. `06` §3.1 lists seven things a shot is built from, and
 * each gets a test that moves *only* that term — because a model where two terms accidentally
 * cancel still produces plausible-looking box scores.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import { World } from '@/engine/world.ts';
import { createBall, DEFAULT_BALL_PHYSICS } from '@/engine/physics/ball.ts';
import { COURT, attackedBasket, basketballCourt } from '@/sports/basketball/court.ts';
import {
  SHOOTING,
  ShotMovement,
  baseChance,
  caromOffRim,
  contestLevel,
  dropThroughNet,
  flightTime,
  isOverheld,
  ratingForZone,
  releaseQuality,
  releaseWindow,
  shotInputAt,
  shotProbability,
  startShot,
  takeShot,
  type ShooterRatings,
  type ShotInput,
} from '@/sports/basketball/shooting.ts';

const AVERAGE: ShooterRatings = {
  finishing: 50,
  midRange: 50,
  threePoint: 50,
  freeThrow: 50,
  composure: 50,
};

/** A clean, set, perfectly released shot — the baseline every other case moves away from. */
function clean(overrides: Partial<ShotInput> = {}): ShotInput {
  return {
    ratings: AVERAGE,
    distance: 6,
    zone: 'midRange',
    contest: 0,
    release: 1,
    movement: ShotMovement.SET,
    stamina: 1,
    clockPressure: 0,
    ...overrides,
  };
}

describe('distance', () => {
  it('is hardest from far away and easiest at the rim', () => {
    let previous = Infinity;
    for (let d = 0; d <= 14; d += 0.5) {
      const chance = baseChance(d);
      expect(chance).toBeLessThan(previous);
      previous = chance;
    }
    expect(baseChance(0)).toBeCloseTo(SHOOTING.baseAtRim, 6);
  });

  it('falls off sharply once a shot becomes a heave', () => {
    const nearArc = baseChance(6.75) - baseChance(7.75);
    const deep = baseChance(12) - baseChance(13);
    expect(deep).toBeGreaterThan(nearArc);
  });

  it('lands an average shooter in plausible territory', () => {
    // Clean, set, perfect release: better than a real game average, as it should be.
    expect(shotProbability(clean({ distance: 1, zone: 'restricted' }))).toBeGreaterThan(0.55);
    expect(shotProbability(clean({ distance: 6.9, zone: 'topThree' }))).toBeGreaterThan(0.3);
    expect(shotProbability(clean({ distance: 6.9, zone: 'topThree' }))).toBeLessThan(0.5);
  });
});

describe('the terms of the model', () => {
  it('rewards the rating the zone is judged on, and only that one', () => {
    const shooter = { ...AVERAGE, threePoint: 95 };
    expect(shotProbability(clean({ zone: 'topThree', ratings: shooter }))).toBeGreaterThan(
      shotProbability(clean({ zone: 'topThree' })),
    );
    // A great three-point shooter is no better at a layup.
    expect(shotProbability(clean({ zone: 'restricted', ratings: shooter }))).toBe(
      shotProbability(clean({ zone: 'restricted' })),
    );
  });

  it('maps each zone to the rating `06` §3.1 names', () => {
    const r: ShooterRatings = {
      finishing: 1,
      midRange: 2,
      threePoint: 3,
      freeThrow: 4,
      composure: 5,
    };
    expect(ratingForZone(r, 'restricted')).toBe(1);
    expect(ratingForZone(r, 'paint')).toBe(1);
    expect(ratingForZone(r, 'midRange')).toBe(2);
    expect(ratingForZone(r, 'cornerThree')).toBe(3);
    expect(ratingForZone(r, 'wingThree')).toBe(3);
    expect(ratingForZone(r, 'heave')).toBe(3);
  });

  it('punishes a contest, and punishes it more the closer it is', () => {
    const open = shotProbability(clean({ contest: 0 }));
    const half = shotProbability(clean({ contest: 0.5 }));
    const smothered = shotProbability(clean({ contest: 1 }));
    expect(half).toBeLessThan(open);
    expect(smothered).toBeLessThan(half);
    expect(smothered / open).toBeCloseTo(1 - SHOOTING.contestWeight, 6);
  });

  it('rewards a clean release', () => {
    expect(shotProbability(clean({ release: 0 }))).toBeLessThan(
      shotProbability(clean({ release: 0.5 })),
    );
    expect(shotProbability(clean({ release: 0.5 }))).toBeLessThan(
      shotProbability(clean({ release: 1 })),
    );
  });

  it('orders the movement states set > off-dribble > fadeaway', () => {
    const set = shotProbability(clean({ movement: ShotMovement.SET }));
    const dribble = shotProbability(clean({ movement: ShotMovement.OFF_DRIBBLE }));
    const fade = shotProbability(clean({ movement: ShotMovement.FADEAWAY }));
    expect(dribble).toBeLessThan(set);
    expect(fade).toBeLessThan(dribble);
  });

  it('costs a tired shooter', () => {
    expect(shotProbability(clean({ stamina: 0.2 }))).toBeLessThan(
      shotProbability(clean({ stamina: 1 })),
    );
  });

  it('lets composure buy back the late-clock penalty, but never turn it into a bonus', () => {
    const calm = { ...AVERAGE, composure: 95 };
    const rattled = { ...AVERAGE, composure: 10 };

    const late = { clockPressure: 1 };
    expect(shotProbability(clean({ ...late, ratings: calm }))).toBeGreaterThan(
      shotProbability(clean({ ...late, ratings: rattled })),
    );

    // Even ice-cold composure is not *better* under pressure than not being under it.
    const iceCold = { ...AVERAGE, composure: 100 };
    expect(shotProbability(clean({ ...late, ratings: iceCold }))).toBeLessThanOrEqual(
      shotProbability(clean({ ratings: iceCold })),
    );
  });

  it('never certifies a shot and never writes one off', () => {
    const hopeless = clean({
      distance: 24,
      zone: 'heave',
      contest: 1,
      release: 0,
      stamina: 0,
      clockPressure: 1,
      movement: ShotMovement.FADEAWAY,
    });
    expect(shotProbability(hopeless)).toBe(SHOOTING.minProbability);

    const perfect = clean({
      distance: 0,
      zone: 'restricted',
      ratings: { ...AVERAGE, finishing: 100 },
    });
    expect(shotProbability(perfect)).toBeLessThanOrEqual(SHOOTING.maxProbability);
  });

  it('does not let one excellent term paper over a terrible one', () => {
    const elite = { ...AVERAGE, threePoint: 100 };
    const smotheredElite = shotProbability(
      clean({ zone: 'topThree', ratings: elite, contest: 1, release: 0 }),
    );
    const openAverage = shotProbability(clean({ zone: 'topThree' }));
    expect(smotheredElite).toBeLessThan(openAverage);
  });
});

describe('the release meter', () => {
  it('gives a better shooter a more forgiving window', () => {
    expect(releaseWindow(90)).toBeGreaterThan(releaseWindow(50));
    expect(releaseWindow(50)).toBeGreaterThan(releaseWindow(20));
    // Never so small it cannot be hit at all.
    expect(releaseWindow(0)).toBeGreaterThanOrEqual(2);
  });

  it('is perfect at the ideal hold and worthless outside the window (INV-8)', () => {
    const meter = startShot(AVERAGE, 'midRange', ShotMovement.SET);
    meter.charge = SHOOTING.idealHoldSteps;
    expect(releaseQuality(meter)).toBe(1);

    meter.charge = SHOOTING.idealHoldSteps + meter.window / 2;
    expect(releaseQuality(meter)).toBeCloseTo(0.5, 6);

    meter.charge = SHOOTING.idealHoldSteps + meter.window + 1;
    expect(releaseQuality(meter)).toBe(0);

    // Early is punished exactly as much as late.
    meter.charge = SHOOTING.idealHoldSteps - meter.window / 2;
    expect(releaseQuality(meter)).toBeCloseTo(0.5, 6);
  });

  it('forces the shot up rather than letting it be held forever', () => {
    const meter = startShot(AVERAGE, 'midRange', ShotMovement.SET);
    meter.charge = SHOOTING.idealHoldSteps + SHOOTING.overholdWindows * meter.window;
    expect(isOverheld(meter)).toBe(false);
    meter.charge += 1;
    expect(isOverheld(meter)).toBe(true);
  });

  it('sizes the window from the rating the zone uses', () => {
    const specialist: ShooterRatings = { ...AVERAGE, threePoint: 95, finishing: 20 };
    const three = startShot(specialist, 'topThree', ShotMovement.SET);
    const layup = startShot(specialist, 'restricted', ShotMovement.SET);
    expect(three.window).toBeGreaterThan(layup.window);
  });

  it('lets difficulty widen the window and nothing else (INV-1)', () => {
    const generous = releaseWindow(50, 1.4);
    const tight = releaseWindow(50, 0.7);
    expect(generous).toBeGreaterThan(tight);

    // The probability model has no idea difficulty exists: same release quality, same chance.
    expect(shotProbability(clean({ release: 0.8 }))).toBe(shotProbability(clean({ release: 0.8 })));
  });
});

describe('contesting', () => {
  it('is nothing from far away and everything in your face', () => {
    expect(contestLevel(SHOOTING.contestRadius)).toBe(0);
    expect(contestLevel(SHOOTING.contestRadius + 5)).toBe(0);
    expect(contestLevel(0)).toBeGreaterThan(0.7);
    expect(contestLevel(1)).toBeGreaterThan(contestLevel(2));
  });

  it('counts reach, so a long defender contests more from the same distance', () => {
    expect(contestLevel(1, 2.6)).toBeGreaterThan(contestLevel(1, 2.0));
  });
});

describe('the shot in flight', () => {
  function arena() {
    const world = new World({
      width: basketballCourt.width,
      height: basketballCourt.height,
      cellSize: 3,
      capacity: 8,
    });
    const shooter = world.spawn({ x: 20, y: 7.5, radius: 0.42, team: 0 });
    const ball = createBall(world, 20, 7.5, DEFAULT_BALL_PHYSICS, 1);
    return { world, shooter, ball };
  }

  it('hangs longer the further out it is taken', () => {
    expect(flightTime(8)).toBeGreaterThan(flightTime(2));
  });

  it('leaves the hand on an arc that reaches the rim', () => {
    const { world, shooter, ball } = arena();
    const input = shotInputAt(20, 7.5, 0, { ...AVERAGE, midRange: 100 });
    const shot = takeShot(world, ball, shooter, 0, input, 0, createRng('arc'));

    expect(shot.resolveStep).toBeGreaterThan(0);
    // Going up and towards the basket, which is at higher x.
    expect(world.vz[ball.entity] as number).toBeGreaterThan(0);
    expect(world.vx[ball.entity] as number).toBeGreaterThan(0);
    expect(ball.carrier).toBe(-1);
  });

  it('scores a shot from behind the arc as three and inside it as two', () => {
    const { world, shooter, ball } = arena();
    const rng = createRng('value');
    world.x[shooter] = 19;
    const deep = takeShot(world, ball, shooter, 0, shotInputAt(19, 7.5, 0, AVERAGE), 0, rng);
    expect(deep.value).toBe(3);

    world.x[shooter] = 24;
    const close = takeShot(world, ball, shooter, 0, shotInputAt(24, 7.5, 0, AVERAGE), 0, rng);
    expect(close.value).toBe(2);
  });

  it('makes shots at about the rate the model says (INV-8)', () => {
    const { world, shooter, ball } = arena();
    const rng = createRng('rate');
    const input = shotInputAt(20, 7.5, 0, AVERAGE);
    const expected = shotProbability(input);

    let made = 0;
    const trials = 4000;
    for (let i = 0; i < trials; i++) {
      if (takeShot(world, ball, shooter, 0, input, i, rng).made) made++;
    }
    expect(made / trials).toBeCloseTo(expected, 1);
  });

  it('replays identically from the same seed', () => {
    const input = shotInputAt(20, 7.5, 0, AVERAGE);
    const take = (seed: string) => {
      const { world, shooter, ball } = arena();
      const rng = createRng(seed);
      return Array.from({ length: 20 }, (_, i) => takeShot(world, ball, shooter, 0, input, i, rng));
    };
    expect(JSON.stringify(take('same'))).toBe(JSON.stringify(take('same')));
    expect(JSON.stringify(take('other'))).not.toBe(JSON.stringify(take('same')));
  });

  it('caroms a miss off the rim as a live ball', () => {
    const { world, ball } = arena();
    caromOffRim(world, ball, 0, createRng('carom'));
    const basket = attackedBasket(0);
    expect(
      Math.hypot(
        (world.x[ball.entity] as number) - basket.x,
        (world.y[ball.entity] as number) - basket.y,
      ),
    ).toBeLessThan(1);
    expect(world.z[ball.entity] as number).toBeGreaterThan(2);
    expect(
      Math.hypot(world.vx[ball.entity] as number, world.vy[ball.entity] as number),
    ).toBeGreaterThan(1);
  });

  it('drops a make through the net, below catching height', () => {
    const { world, ball } = arena();
    dropThroughNet(world, ball, 0);
    expect(world.x[ball.entity] as number).toBeCloseTo(attackedBasket(0).x, 4);
    expect(world.z[ball.entity] as number).toBeLessThan(COURT.rimHeight);
    expect(world.vz[ball.entity] as number).toBeLessThan(0);
  });
});
