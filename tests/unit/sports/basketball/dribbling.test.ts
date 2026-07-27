/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.5 — Dribbling & driving: handling control, contact absorption, blow-by
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  06-game-design.md §3.1 (contact resolved by strength/agility)
 * @invariant INV-8 (determinism)
 *
 * Purpose: the three costs of carrying the ball. The fumble chance gets the most attention here
 * because it is a per-*step* probability: a number that looks tiny and, multiplied by the three
 * hundred steps of a possession, quietly decides how often anybody keeps the ball.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import { World } from '@/engine/world.ts';
import { createBall, DEFAULT_BALL_PHYSICS } from '@/engine/physics/ball.ts';
import { basketballCourt } from '@/sports/basketball/court.ts';
import {
  Contact,
  DRIBBLING,
  blowByChance,
  canBlowBy,
  fumbleBall,
  fumbleChance,
  resolveContact,
  staggerFactor,
  type BodyRatings,
  type HandlerRatings,
} from '@/sports/basketball/dribbling.ts';

const HANDLER: HandlerRatings & BodyRatings = {
  ballHandling: 50,
  agility: 50,
  strength: 50,
  composure: 50,
  interiorD: 50,
  perimeterD: 50,
};

const MAX_SPEED = 7;

/** Chance of surviving a whole possession's worth of steps at a fixed per-step risk. */
function survivesPossession(chance: number, steps = 360): number {
  return Math.pow(1 - chance, steps);
}

describe('keeping the handle', () => {
  it('is easier for a better handler', () => {
    const good = fumbleChance({ ...HANDLER, ballHandling: 90 }, 0.5, 4, MAX_SPEED, false);
    const poor = fumbleChance({ ...HANDLER, ballHandling: 20 }, 0.5, 4, MAX_SPEED, false);
    expect(good).toBeLessThan(poor);
  });

  it('gets harder under pressure, at speed, and sprinting', () => {
    const calm = fumbleChance(HANDLER, 0, 2, MAX_SPEED, false);
    expect(fumbleChance(HANDLER, 1, 2, MAX_SPEED, false)).toBeGreaterThan(calm);
    expect(fumbleChance(HANDLER, 0, 7, MAX_SPEED, false)).toBeGreaterThan(calm);
    expect(fumbleChance(HANDLER, 0, 2, MAX_SPEED, true)).toBeGreaterThan(calm);
  });

  it('lets composure steady a pressured handler', () => {
    expect(fumbleChance({ ...HANDLER, composure: 95 }, 1, 4, MAX_SPEED, false)).toBeLessThan(
      fumbleChance({ ...HANDLER, composure: 5 }, 1, 4, MAX_SPEED, false),
    );
  });

  it('adds up to a plausible amount of ball security over a whole possession', () => {
    // An average handler, moderately pressed, should nearly always finish the possession...
    const typical = fumbleChance(HANDLER, 0.4, 4, MAX_SPEED, false);
    expect(survivesPossession(typical)).toBeGreaterThan(0.8);

    // ...and the worst case — poor handler, smothered, sprinting — should be genuinely risky.
    const worst = fumbleChance(
      { ...HANDLER, ballHandling: 15, composure: 20 },
      1,
      7,
      MAX_SPEED,
      true,
    );
    expect(survivesPossession(worst)).toBeLessThan(0.7);
    expect(worst).toBeLessThanOrEqual(DRIBBLING.maxFumble);
  });

  it('squirts a fumbled ball away from the carrier (INV-8)', () => {
    const world = new World({
      width: basketballCourt.width,
      height: basketballCourt.height,
      cellSize: 3,
      capacity: 8,
    });
    const carrier = world.spawn({ x: 14, y: 7.5, facing: 0 });
    const ball = createBall(world, 14, 7.5, DEFAULT_BALL_PHYSICS, 1);

    fumbleBall(world, ball, carrier, createRng('fumble'));
    expect(ball.carrier).toBe(-1);
    expect(
      Math.hypot(world.vx[ball.entity] as number, world.vy[ball.entity] as number),
    ).toBeGreaterThan(1);
    expect(world.vz[ball.entity] as number).toBeGreaterThan(0);
  });
});

describe('contact on a drive', () => {
  const rng = () => createRng('contact');

  it('lets a stronger, quicker driver through more often', () => {
    const bully = { ...HANDLER, strength: 95, agility: 85 };
    const weak = { ...HANDLER, strength: 20, agility: 30 };
    const wall: BodyRatings = { strength: 85, agility: 50, interiorD: 90, perimeterD: 50 };

    const through = (carrier: typeof bully) => {
      const r = rng();
      let count = 0;
      for (let i = 0; i < 500; i++) {
        if (resolveContact(carrier, wall, 4, r).kind === Contact.ABSORBED) count++;
      }
      return count;
    };

    expect(through(bully)).toBeGreaterThan(through(weak));
  });

  it('slows a driver it stops, and slows a stripped one too', () => {
    const wall: BodyRatings = { strength: 99, agility: 50, interiorD: 99, perimeterD: 50 };
    const result = resolveContact({ ...HANDLER, strength: 5, agility: 5 }, wall, 4, rng());
    expect(result.kind).not.toBe(Contact.ABSORBED);
    expect(result.speedFactor).toBeLessThan(1);
  });

  it('strips a poor handler more often than a good one', () => {
    const wall: BodyRatings = { strength: 99, agility: 50, interiorD: 99, perimeterD: 50 };
    const strips = (ballHandling: number) => {
      const r = createRng('strip');
      let count = 0;
      for (let i = 0; i < 800; i++) {
        if (
          resolveContact({ ...HANDLER, ballHandling, strength: 5 }, wall, 4, r).kind ===
          Contact.STRIPPED
        ) {
          count++;
        }
      }
      return count;
    };
    expect(strips(15)).toBeGreaterThan(strips(95));
  });

  it('reports a severity for the foul model to read, without deciding anything itself', () => {
    const wall: BodyRatings = { strength: 60, agility: 50, interiorD: 60, perimeterD: 50 };
    const gentle = resolveContact(HANDLER, wall, 0.5, createRng('a'));
    const heavy = resolveContact(HANDLER, wall, 9, createRng('a'));
    expect(heavy.severity).toBeGreaterThan(gentle.severity);
    expect(gentle.severity).toBeGreaterThanOrEqual(0);
    expect(heavy.severity).toBeLessThanOrEqual(1);
  });
});

describe('the blow-by', () => {
  function world() {
    return new World({
      width: basketballCourt.width,
      height: basketballCourt.height,
      cellSize: 3,
      capacity: 8,
    });
  }

  it('favours quickness over perimeter defence', () => {
    const quick: BodyRatings = { strength: 50, agility: 95, interiorD: 50, perimeterD: 50 };
    const slow: BodyRatings = { strength: 50, agility: 20, interiorD: 50, perimeterD: 50 };
    const stopper: BodyRatings = { strength: 50, agility: 50, interiorD: 50, perimeterD: 95 };

    expect(blowByChance(quick, stopper)).toBeGreaterThan(blowByChance(slow, stopper));
    expect(blowByChance(quick, stopper)).toBeLessThanOrEqual(DRIBBLING.blowByCeiling);
    expect(blowByChance(slow, stopper)).toBeGreaterThanOrEqual(DRIBBLING.blowByFloor);
  });

  it('is on the table only when actually attacking past somebody', () => {
    const w = world();
    const carrier = w.spawn({ x: 14, y: 7.5, vx: 6, vy: 0 });
    const beside = w.spawn({ x: 15, y: 8.3 });
    expect(canBlowBy(w, carrier, beside, 26, 7.5)).toBe(true);

    // Standing still is not beating anybody.
    w.vx[carrier] = 0;
    expect(canBlowBy(w, carrier, beside, 26, 7.5)).toBe(false);

    // Neither is running straight into them — that is contact, not a blow-by.
    w.vx[carrier] = 6;
    const dead = w.spawn({ x: 15.2, y: 7.5 });
    expect(canBlowBy(w, carrier, dead, 26, 7.5)).toBe(false);

    // Nor is a defender too far away to be beaten.
    const distant = w.spawn({ x: 20, y: 9 });
    expect(canBlowBy(w, carrier, distant, 26, 7.5)).toBe(false);
  });

  it('leaves a beaten defender slowed, recovering over time', () => {
    expect(staggerFactor(0)).toBe(1);
    expect(staggerFactor(DRIBBLING.blowByStaggerSteps)).toBeLessThan(0.6);
    expect(staggerFactor(4)).toBeGreaterThan(staggerFactor(DRIBBLING.blowByStaggerSteps));
    expect(staggerFactor(DRIBBLING.blowByStaggerSteps * 3)).toBeGreaterThan(0);
  });
});
