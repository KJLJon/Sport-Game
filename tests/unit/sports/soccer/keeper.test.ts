/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.9 — Goalkeeper AI: positioning, shot-stopping, claims, distribution
 * @story   US-4.3 — Defend and keep goal
 * @design  06-game-design.md §3.2
 *
 * Purpose: that a save is a race rather than a dice roll. The far corner beats a good keeper
 * because it is further away, and coming off the line shortens every dive at the cost of the ball
 * over the top — both consequences of the geometry, so both are testable without a match.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import { CENTRE_Y, PITCH, defendedGoalLineX } from '@/sports/soccer/pitch.ts';
import {
  KEEPER,
  claimChance,
  distributionChoice,
  diveDistance,
  diveReach,
  interceptPoint,
  isKeeperManual,
  keeperSpot,
  reactionTime,
  resolveClaim,
  saveChance,
  saveOutcome,
  type KeeperRatings,
} from '@/sports/soccer/keeper.ts';

const AVERAGE: KeeperRatings = { goalkeeping: 50 };
const ELITE: KeeperRatings = { goalkeeping: 95 };
const POOR: KeeperRatings = { goalkeeping: 15 };

/** A central keeper defending the low goal. */
const CENTRAL = { y: CENTRE_Y };

describe('positioning', () => {
  it('stands off the line, in front of the goal it defends', () => {
    const spot = keeperSpot(60, CENTRE_Y, 0);
    expect(spot.x).toBeGreaterThan(defendedGoalLineX(0));
    expect(spot.x).toBeLessThan(KEEPER.maxAdvance + 1);
    expect(spot.y).toBeCloseTo(CENTRE_Y, 6);
  });

  it('mirrors at the other end', () => {
    const spot = keeperSpot(45, CENTRE_Y, 1);
    expect(spot.x).toBeLessThan(defendedGoalLineX(1));
    expect(PITCH.length - spot.x).toBeCloseTo(keeperSpot(60, CENTRE_Y, 0).x, 6);
  });

  it('comes further out as the ball closes', () => {
    const far = keeperSpot(70, CENTRE_Y, 0);
    const near = keeperSpot(20, CENTRE_Y, 0);
    expect(near.x).toBeGreaterThan(far.x);
  });

  it('comes out further when told to be aggressive, and barely at all when not', () => {
    expect(keeperSpot(20, CENTRE_Y, 0, 1).x).toBeGreaterThan(keeperSpot(20, CENTRE_Y, 0, 0.2).x);
    expect(keeperSpot(20, CENTRE_Y, 0, 0).x).toBeCloseTo(KEEPER.minAdvance, 6);
  });

  it('shades towards the ball without ever leaving the frame of the goal', () => {
    const wide = keeperSpot(15, CENTRE_Y + 25, 0);
    expect(wide.y).toBeGreaterThan(CENTRE_Y);
    expect(wide.y).toBeLessThanOrEqual(CENTRE_Y + PITCH.goalWidth / 2);

    const other = keeperSpot(15, CENTRE_Y - 25, 0);
    expect(other.y).toBeLessThan(CENTRE_Y);
    expect(other.y).toBeGreaterThanOrEqual(CENTRE_Y - PITCH.goalWidth / 2);
  });

  it('handles a ball on top of the keeper without dividing by nothing', () => {
    const spot = keeperSpot(0.2, CENTRE_Y + 1, 0, 1);
    expect(Number.isFinite(spot.x)).toBe(true);
    expect(Number.isFinite(spot.y)).toBe(true);
  });

  it('shortens the dive by coming out — which is the whole reason to do it', () => {
    const from = { x: 18, y: CENTRE_Y + 6 };
    const aim = { y: CENTRE_Y + 3, z: 1 };
    const goalX = defendedGoalLineX(0);

    const onLine = keeperSpot(from.x, from.y, 0, 0);
    const advanced = keeperSpot(from.x, from.y, 0, 1);
    expect(advanced.x).toBeGreaterThan(onLine.x);

    const dived = (spot: { x: number; y: number }) =>
      diveDistance(spot, interceptPoint(from, aim, goalX, spot.x));
    expect(dived(advanced)).toBeLessThan(dived(onLine));
  });

  it('reads a rising ball lower the further out the keeper is — the chord, not the arc', () => {
    const from = { x: 18, y: CENTRE_Y };
    const high = { y: CENTRE_Y, z: 2.3 };
    const goalX = defendedGoalLineX(0);

    // Documents the approximation rather than the sport: a real chip peaks above the bar and drops,
    // so an advanced keeper would meet it *higher*. The chord cannot express that, and pretending
    // otherwise here would be a test passing by accident. See the note in `keeper.ts`.
    expect(interceptPoint(from, high, goalX, 5).z).toBeLessThan(
      interceptPoint(from, high, goalX, 0.4).z,
    );
  });

  it('meets the ball at the goal line when the keeper is on it', () => {
    const aim = { y: CENTRE_Y + 3, z: 1.4 };
    const point = interceptPoint({ x: 20, y: CENTRE_Y }, aim, 0, 0);
    expect(point.y).toBeCloseTo(aim.y, 6);
    expect(point.z).toBeCloseTo(aim.z, 6);
  });

  it('does not divide by nothing when the shot is struck on the goal line', () => {
    const aim = { y: CENTRE_Y + 1, z: 1 };
    expect(interceptPoint({ x: 0, y: CENTRE_Y }, aim, 0, 0)).toEqual(aim);
  });
});

describe('reach', () => {
  it('is quicker off the mark for a better keeper', () => {
    expect(reactionTime(ELITE)).toBeLessThan(reactionTime(AVERAGE));
    expect(reactionTime(AVERAGE)).toBeLessThan(reactionTime(POOR));
  });

  it('is the standing reach when there is no time at all', () => {
    expect(diveReach(AVERAGE, 0)).toBe(KEEPER.reach);
    expect(diveReach(AVERAGE, reactionTime(AVERAGE))).toBeCloseTo(KEEPER.reach, 6);
  });

  it('grows with the time available and with the rating', () => {
    expect(diveReach(AVERAGE, 1)).toBeGreaterThan(diveReach(AVERAGE, 0.5));
    expect(diveReach(ELITE, 1)).toBeGreaterThan(diveReach(AVERAGE, 1));
  });

  it('measures the dive across the goal and up it', () => {
    expect(diveDistance(CENTRAL, { y: CENTRE_Y, z: 0.9 })).toBeCloseTo(0, 6);
    expect(diveDistance(CENTRAL, { y: CENTRE_Y + 3, z: 0.9 })).toBeCloseTo(3, 6);
    // A ball at the keeper's own height costs nothing extra.
    expect(diveDistance(CENTRAL, { y: CENTRE_Y, z: 0.2 })).toBeCloseTo(0, 6);
    expect(diveDistance(CENTRAL, { y: CENTRE_Y, z: 2.4 })).toBeGreaterThan(1);
  });
});

describe('shot-stopping', () => {
  it('saves the one straight at them and not the one in the corner', () => {
    const middle = saveChance(AVERAGE, CENTRAL, { y: CENTRE_Y, z: 1 }, 0.6);
    const corner = saveChance(AVERAGE, CENTRAL, { y: CENTRE_Y + 3.3, z: 2.2 }, 0.6);
    expect(middle).toBeGreaterThan(0.9);
    expect(corner).toBeLessThan(0.3);
  });

  it('beats a good keeper with the far corner, because it is further away', () => {
    const corner = { y: CENTRE_Y + 3.3, z: 2.2 };
    expect(saveChance(ELITE, CENTRAL, corner, 0.5)).toBeLessThan(
      saveChance(ELITE, CENTRAL, { y: CENTRE_Y + 0.5, z: 1 }, 0.5),
    );
  });

  it('gives a better keeper a better chance at the same shot', () => {
    const aim = { y: CENTRE_Y + 2.6, z: 1.6 };
    expect(saveChance(ELITE, CENTRAL, aim, 0.5)).toBeGreaterThan(
      saveChance(POOR, CENTRAL, aim, 0.5),
    );
  });

  it('is softer than a cliff at the edge of the reach', () => {
    // A shot right on the limit is neither certain nor hopeless.
    const reach = diveReach(AVERAGE, 0.5);
    const aim = { y: CENTRE_Y + reach, z: 0.9 };
    const chance = saveChance(AVERAGE, CENTRAL, aim, 0.5);
    expect(chance).toBeGreaterThan(0.3);
    expect(chance).toBeLessThan(0.7);
  });

  it('gives more time on a longer flight, and that is what a keeper is buying', () => {
    const aim = { y: CENTRE_Y + 2.6, z: 1.4 };
    expect(saveChance(AVERAGE, CENTRAL, aim, 0.9)).toBeGreaterThan(
      saveChance(AVERAGE, CENTRAL, aim, 0.35),
    );
  });

  it('holds a tame shot and parries a hard one', () => {
    const easy = { y: CENTRE_Y, z: 1 };
    const rng = createRng('holds');
    expect(saveOutcome(ELITE, CENTRAL, easy, 0.8, 10, rng)).toBe('caught');
    expect(saveOutcome(ELITE, CENTRAL, easy, 0.8, 25, rng)).toBe('parried');
  });

  it('parries a save made at full stretch even when the ball is slow', () => {
    const stretch = { y: CENTRE_Y + diveReach(AVERAGE, 0.6) - 0.1, z: 0.9 };
    const rng = createRng('stretch');
    let parried = 0;
    for (let i = 0; i < 200; i++) {
      if (saveOutcome(AVERAGE, CENTRAL, stretch, 0.6, 8, rng) === 'parried') parried++;
    }
    expect(parried).toBeGreaterThan(0);
  });

  it('is beaten sometimes, deterministically for a seed', () => {
    const corner = { y: CENTRE_Y + 3.4, z: 2.2 };
    const a = saveOutcome(AVERAGE, CENTRAL, corner, 0.4, 22, createRng('s'));
    const b = saveOutcome(AVERAGE, CENTRAL, corner, 0.4, 22, createRng('s'));
    expect(a).toBe(b);
    expect(a).toBe('beaten');
  });
});

describe('claims', () => {
  const keeper = { x: 4, y: CENTRE_Y };

  it('claims a ball in the air within range', () => {
    expect(claimChance(AVERAGE, keeper, { x: 5, y: CENTRE_Y, z: 2 })).toBeGreaterThan(0);
  });

  it('leaves a ball on the floor to the outfielders', () => {
    expect(claimChance(ELITE, keeper, { x: 5, y: CENTRE_Y, z: 0.4 })).toBe(0);
  });

  it('cannot reach one over everybody', () => {
    expect(claimChance(ELITE, keeper, { x: 5, y: CENTRE_Y, z: 4 })).toBe(0);
  });

  it('cannot claim what it cannot get to', () => {
    expect(claimChance(ELITE, keeper, { x: 15, y: CENTRE_Y, z: 2 })).toBe(0);
  });

  it('is likelier close in and for a better keeper', () => {
    const near = claimChance(AVERAGE, keeper, { x: 4.5, y: CENTRE_Y, z: 2 });
    const far = claimChance(AVERAGE, keeper, { x: 6.5, y: CENTRE_Y, z: 2 });
    expect(near).toBeGreaterThan(far);
    expect(claimChance(ELITE, keeper, { x: 5, y: CENTRE_Y, z: 2 })).toBeGreaterThan(
      claimChance(POOR, keeper, { x: 5, y: CENTRE_Y, z: 2 }),
    );
  });

  it('resolves deterministically for a seed', () => {
    const ball = { x: 5, y: CENTRE_Y, z: 2 };
    expect(resolveClaim(AVERAGE, keeper, ball, createRng('c'))).toBe(
      resolveClaim(AVERAGE, keeper, ball, createRng('c')),
    );
  });
});

describe('distribution and manual control', () => {
  it('plays short when there is an option and nobody near', () => {
    expect(distributionChoice(0, true)).toBe('short');
  });

  it('clears it under pressure, or with nobody to give it to', () => {
    expect(distributionChoice(1, true)).toBe('lofted');
    expect(distributionChoice(0, false)).toBe('lofted');
  });

  it('hands the gloves over on a penalty and nowhere else', () => {
    expect(isKeeperManual('penalty', true)).toBe(true);
    expect(isKeeperManual('penalty', false)).toBe(false);
    expect(isKeeperManual('cornerKick', true)).toBe(false);
    expect(isKeeperManual(null, true)).toBe(false);
  });
});
