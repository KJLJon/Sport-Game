/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.1 — Court geometry, zones, arc, key, hoop, boundaries
 * @story   US-3.1 — Play a 5v5 basketball match
 * @design  06-game-design.md §3.1
 *
 * Purpose: pins the court's numbers and, more importantly, the two places the geometry is easy to
 * get wrong — the corner three, which a distance test scores as a two, and the boundary a ball
 * leaves through when it clears a corner.
 */
import { describe, expect, it } from 'vitest';
import {
  CENTRE_X,
  CENTRE_Y,
  CORNER_ARC_X,
  COURT,
  attackDirection,
  attackedBasket,
  basketballCourt,
  crossedBoundary,
  defendedBasket,
  freeThrowSpot,
  isInAttackingPaint,
  isInBounds,
  isInFrontcourt,
  isInRestrictedArea,
  isThreePointShot,
  mirrorX,
  shotDistance,
  shotValue,
  shotZone,
  throwInSpot,
  tipOffSpot,
  type Side,
} from '@/sports/basketball/court.ts';

const SIDES: readonly Side[] = [0, 1];

describe('court dimensions', () => {
  it('is a FIBA court in metres', () => {
    expect(basketballCourt.width).toBe(28);
    expect(basketballCourt.height).toBe(15);
    expect(COURT.rimHeight).toBeCloseTo(3.05);
  });

  it('places both baskets on the centre axis, one per end', () => {
    expect(defendedBasket(0)).toMatchObject({ side: 0, x: 1.575, y: CENTRE_Y, z: 3.05 });
    expect(defendedBasket(1)).toMatchObject({ side: 1, x: 28 - 1.575, y: CENTRE_Y });
  });

  it('has each side attacking the basket it does not defend', () => {
    for (const side of SIDES) {
      expect(attackedBasket(side)).not.toBe(defendedBasket(side));
      expect(attackedBasket(side).side).not.toBe(side);
    }
    expect(attackDirection(0)).toBe(1);
    expect(attackDirection(1)).toBe(-1);
  });

  it('exposes the paint and half-court zones through the seam', () => {
    const zones = basketballCourt.zones ?? {};
    expect(Object.keys(zones).sort()).toEqual(['half0', 'half1', 'paint0', 'paint1']);
    expect(zones.paint0).toEqual({ x: 0, y: CENTRE_Y - 2.45, width: 5.8, height: 4.9 });
    expect(zones.half1).toEqual({ x: CENTRE_X, y: 0, width: CENTRE_X, height: 15 });
  });

  it('puts the free-throw line 4.225 m from the rim it faces', () => {
    for (const side of SIDES) {
      const spot = freeThrowSpot(side);
      expect(shotDistance(spot.x, spot.y, side)).toBeCloseTo(4.225, 3);
    }
    expect(tipOffSpot()).toEqual({ x: CENTRE_X, y: CENTRE_Y });
  });

  it('mirrors x about the half-court line', () => {
    expect(mirrorX(0)).toBe(28);
    expect(mirrorX(CENTRE_X)).toBe(CENTRE_X);
    expect(mirrorX(mirrorX(7.3))).toBeCloseTo(7.3);
  });
});

describe('the three-point line', () => {
  it('scores a shot just inside the arc as two and just outside as three', () => {
    const basket = attackedBasket(0);
    // Straight-on, so the corner rule is not involved.
    expect(isThreePointShot(basket.x - 6.7, CENTRE_Y, 0)).toBe(false);
    expect(isThreePointShot(basket.x - 6.8, CENTRE_Y, 0)).toBe(true);
    expect(shotValue(basket.x - 6.7, CENTRE_Y, 0)).toBe(2);
    expect(shotValue(basket.x - 6.8, CENTRE_Y, 0)).toBe(3);
  });

  it('scores the corner three as three even though it is shorter than the arc', () => {
    const basket = attackedBasket(0);
    // On the corner line, level with the rim: 6.6 m out, which is inside 6.75.
    const x = basket.x;
    const y = COURT.threeCornerInset - 0.05;
    expect(shotDistance(x, y, 0)).toBeLessThan(COURT.threeArcRadius);
    expect(isThreePointShot(x, y, 0)).toBe(true);
    // A step inside the corner line is a long two.
    expect(isThreePointShot(x, COURT.threeCornerInset + 0.05, 0)).toBe(false);
  });

  it('meets the arc exactly where the corner lines end', () => {
    const basket = attackedBasket(0);
    const junctionX = basket.x - (CORNER_ARC_X - COURT.basketFromBaseline);
    expect(Math.hypot(junctionX - basket.x, COURT.threeCornerInset - basket.y)).toBeCloseTo(
      COURT.threeArcRadius,
      6,
    );
  });

  it('is symmetric between the two ends', () => {
    for (const y of [1.2, 4, CENTRE_Y, 11, 14.1]) {
      for (const x of [2, 5, 8, 12]) {
        expect(isThreePointShot(mirrorX(x), y, 1)).toBe(isThreePointShot(x, y, 0));
      }
    }
  });
});

describe('paint, restricted area, and frontcourt', () => {
  it('recognises the key each side attacks and not the one it defends', () => {
    const attacking = { x: 28 - 2, y: CENTRE_Y };
    expect(isInAttackingPaint(attacking.x, attacking.y, 0)).toBe(true);
    expect(isInAttackingPaint(attacking.x, attacking.y, 1)).toBe(false);
    // Just outside the key's width is not the paint.
    expect(isInAttackingPaint(28 - 2, CENTRE_Y + 2.5, 0)).toBe(false);
  });

  it('puts the restricted area under the rim only', () => {
    const basket = attackedBasket(0);
    expect(isInRestrictedArea(basket.x, basket.y, 0)).toBe(true);
    expect(isInRestrictedArea(basket.x - 1.0, basket.y, 0)).toBe(true);
    expect(isInRestrictedArea(basket.x - 1.5, basket.y, 0)).toBe(false);
  });

  it('leaves the centre line in the backcourt for both sides', () => {
    expect(isInFrontcourt(CENTRE_X, CENTRE_Y, 0)).toBe(false);
    expect(isInFrontcourt(CENTRE_X, CENTRE_Y, 1)).toBe(false);
    expect(isInFrontcourt(CENTRE_X + 0.1, CENTRE_Y, 0)).toBe(true);
    expect(isInFrontcourt(CENTRE_X - 0.1, CENTRE_Y, 1)).toBe(true);
  });
});

describe('shot zones', () => {
  const basket = attackedBasket(0);

  it.each([
    ['restricted', basket.x - 0.6, CENTRE_Y],
    ['paint', basket.x - 3.0, CENTRE_Y],
    ['midRange', basket.x - 5.0, CENTRE_Y - 4.0],
    ['cornerThree', basket.x, 0.5],
    ['topThree', basket.x - 7.2, CENTRE_Y],
    ['wingThree', basket.x - 4.6, CENTRE_Y - 5.4],
    ['heave', 4, CENTRE_Y],
  ])('classifies %s', (zone, x, y) => {
    expect(shotZone(x, y, 0)).toBe(zone);
  });

  it('classifies the mirrored point identically at the other end', () => {
    for (const [x, y] of [
      [basket.x - 0.6, CENTRE_Y],
      [basket.x - 5.0, CENTRE_Y - 4.0],
      [basket.x, 0.5],
      [basket.x - 4.6, CENTRE_Y - 5.4],
    ] as const) {
      expect(shotZone(mirrorX(x), y, 1)).toBe(shotZone(x, y, 0));
    }
  });
});

describe('boundaries and restarts', () => {
  it('reports no boundary for a point on the court', () => {
    expect(crossedBoundary(CENTRE_X, CENTRE_Y)).toBeNull();
    expect(crossedBoundary(0, 0)).toBeNull();
    expect(isInBounds(0, 0)).toBe(true);
    expect(isInBounds(0.3, CENTRE_Y, 0.45)).toBe(false);
  });

  it('attributes a corner exit to whichever line it went furthest past', () => {
    expect(crossedBoundary(-0.4, -0.1)).toBe('baseline0');
    expect(crossedBoundary(-0.1, -0.4)).toBe('sidelineLow');
    expect(crossedBoundary(28.5, 15.2)).toBe('baseline1');
  });

  it('restarts from the nearest line, out of the corner', () => {
    expect(throwInSpot(9, -0.5)).toEqual({ x: 9, y: 0 });
    expect(throwInSpot(0.2, -0.4)).toEqual({ x: 1.5, y: 0 });
    expect(throwInSpot(29, 8)).toMatchObject({ x: 28 });
  });

  it('never puts the inbounder behind the backboard', () => {
    const spot = throwInSpot(-0.5, CENTRE_Y);
    expect(spot.x).toBe(0);
    expect(Math.abs(spot.y - CENTRE_Y)).toBeGreaterThanOrEqual(COURT.backboardWidth / 2);
  });

  it('keeps every restart on the boundary', () => {
    for (const [x, y] of [
      [-2, 3],
      [30, 12],
      [14, -1],
      [14, 16],
      [-1, -1],
      [29, 16],
    ] as const) {
      const spot = throwInSpot(x, y);
      const onEdge =
        spot.x === 0 || spot.x === COURT.length || spot.y === 0 || spot.y === COURT.width;
      expect(onEdge).toBe(true);
      expect(isInBounds(spot.x, spot.y)).toBe(true);
    }
  });
});
