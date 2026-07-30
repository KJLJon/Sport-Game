/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.1 — Pitch geometry, zones, goals, boundary lines
 * @story   US-4.1 — Play an 11v11 soccer match
 * @design  06-game-design.md §3.2
 *
 * Purpose: pins the pitch's numbers and the three places soccer geometry is easy to get wrong —
 * the goal mouth (a ball can cross the line and not be a goal), the angle on goal (which is what
 * makes a shot from the by-line a bad one), and the boundary a ball leaves through when it clears
 * a corner, which is the difference between a corner kick and a throw-in.
 */
import { describe, expect, it } from 'vitest';
import {
  CENTRE_X,
  CENTRE_Y,
  PITCH,
  attackDirection,
  attackedGoal,
  cornerSpot,
  crossedBoundary,
  defendedGoal,
  defendedGoalLineX,
  goalAngle,
  goalKickSpot,
  goalOpenness,
  isGoal,
  isInAttackingHalf,
  isInAttackingPenaltyArea,
  isInBounds,
  isInCentreCircle,
  isInDefendedGoalArea,
  isInDefendedPenaltyArea,
  isInPenaltyArc,
  kickOffSpot,
  mirrorX,
  penaltySpot,
  shotDistance,
  shotZone,
  soccerPitch,
  thirdFor,
  throwInSpot,
  type Side,
} from '@/sports/soccer/pitch.ts';

const SIDES: readonly Side[] = [0, 1];

describe('pitch dimensions', () => {
  it('is a 105 × 68 pitch in metres', () => {
    expect(soccerPitch.width).toBe(105);
    expect(soccerPitch.height).toBe(68);
    expect(PITCH.goalWidth).toBeCloseTo(7.32);
    expect(PITCH.goalHeight).toBeCloseTo(2.44);
  });

  it('places both goals on the centre axis, one per end', () => {
    expect(defendedGoal(0)).toMatchObject({ side: 0, x: 0, y: CENTRE_Y, z: PITCH.goalHeight });
    expect(defendedGoal(1)).toMatchObject({ side: 1, x: 105, y: CENTRE_Y });
    expect(defendedGoal(0).radius).toBeCloseTo(PITCH.goalWidth / 2);
  });

  it('has each side attacking the goal it does not defend', () => {
    for (const side of SIDES) {
      expect(attackedGoal(side)).not.toBe(defendedGoal(side));
      expect(attackedGoal(side).side).not.toBe(side);
      expect(defendedGoalLineX(side)).toBe(defendedGoal(side).x);
    }
    expect(attackDirection(0)).toBe(1);
    expect(attackDirection(1)).toBe(-1);
  });

  it('exposes the boxes, halves, and thirds through the seam', () => {
    const zones = soccerPitch.zones ?? {};
    expect(Object.keys(zones).sort()).toEqual([
      'goalArea0',
      'goalArea1',
      'half0',
      'half1',
      'middleThird',
      'penaltyArea0',
      'penaltyArea1',
      'third0',
      'third1',
    ]);
    expect(zones.penaltyArea0).toEqual({
      x: 0,
      y: CENTRE_Y - 20.16,
      width: 16.5,
      height: 40.32,
    });
    expect(zones.goalArea1).toEqual({
      x: 105 - 5.5,
      y: CENTRE_Y - 9.16,
      width: 5.5,
      height: 18.32,
    });
  });

  it('puts each penalty spot 11 m from the line it faces', () => {
    for (const side of SIDES) {
      const spot = penaltySpot(side);
      expect(Math.abs(spot.x - defendedGoalLineX(side))).toBeCloseTo(11, 6);
      expect(spot.y).toBe(CENTRE_Y);
      expect(isInDefendedPenaltyArea(spot.x, spot.y, side)).toBe(true);
    }
    expect(kickOffSpot()).toEqual({ x: CENTRE_X, y: CENTRE_Y });
  });

  it('mirrors x about the halfway line', () => {
    expect(mirrorX(0)).toBe(105);
    expect(mirrorX(CENTRE_X)).toBe(CENTRE_X);
    expect(mirrorX(mirrorX(31.4))).toBeCloseTo(31.4);
  });
});

describe('the goal mouth', () => {
  it('is a goal only between the posts and under the bar', () => {
    expect(isGoal(0, CENTRE_Y, 1, 0)).toBe(true);
    expect(isGoal(-0.5, CENTRE_Y, 0, 0)).toBe(true);
    // Over the bar.
    expect(isGoal(0, CENTRE_Y, PITCH.goalHeight + 0.01, 0)).toBe(false);
    // Wide of the post.
    expect(isGoal(0, CENTRE_Y + PITCH.goalWidth / 2 + 0.01, 1, 0)).toBe(false);
    // On the line but not past it.
    expect(isGoal(0.5, CENTRE_Y, 1, 0)).toBe(false);
  });

  it('scores at the other end for the other side', () => {
    expect(isGoal(105, CENTRE_Y, 1, 1)).toBe(true);
    expect(isGoal(105, CENTRE_Y, 1, 0)).toBe(false);
    expect(isGoal(104.5, CENTRE_Y, 1, 1)).toBe(false);
  });

  it('rejects a ball below the surface', () => {
    expect(isGoal(0, CENTRE_Y, -0.01, 0)).toBe(false);
  });
});

describe('the angle on goal', () => {
  it('is widest straight in front and narrows towards the by-line', () => {
    const straight = goalAngle(90, CENTRE_Y, 0);
    const wide = goalAngle(90, CENTRE_Y + 25, 0);
    const byLine = goalAngle(104.9, CENTRE_Y + 20, 0);
    expect(straight).toBeGreaterThan(wide);
    expect(wide).toBeGreaterThan(byLine);
  });

  it('grows as the shooter closes on the goal from straight on', () => {
    expect(goalAngle(95, CENTRE_Y, 0)).toBeGreaterThan(goalAngle(70, CENTRE_Y, 0));
  });

  it('subtends the full mouth from the penalty spot', () => {
    const spot = penaltySpot(1);
    const expected = 2 * Math.atan(PITCH.goalWidth / 2 / PITCH.penaltySpotFromGoalLine);
    expect(goalAngle(spot.x, spot.y, 0)).toBeCloseTo(expected, 6);
  });

  it('divides the distance out, so openness measures only how central the shooter is', () => {
    // Dead centre is the whole available angle, at any distance.
    for (const x of [70, 85, 95, 103]) {
      expect(goalOpenness(x, CENTRE_Y, 0)).toBeCloseTo(1, 9);
    }
    // Drifting wide costs openness even as the shot gets shorter.
    expect(goalOpenness(100, CENTRE_Y + 18, 0)).toBeLessThan(goalOpenness(85, CENTRE_Y + 10, 0));
  });

  it('is symmetric about the centre axis and between the ends', () => {
    for (const [x, y] of [
      [80, 20],
      [95, 30],
      [60, 34],
    ] as const) {
      expect(goalAngle(x, y, 0)).toBeCloseTo(goalAngle(x, PITCH.width - y, 0), 9);
      expect(goalAngle(mirrorX(x), y, 1)).toBeCloseTo(goalAngle(x, y, 0), 9);
    }
  });
});

describe('areas and territory', () => {
  it('separates the box a side defends from the one it attacks', () => {
    expect(isInDefendedPenaltyArea(10, CENTRE_Y, 0)).toBe(true);
    expect(isInAttackingPenaltyArea(10, CENTRE_Y, 1)).toBe(true);
    expect(isInAttackingPenaltyArea(10, CENTRE_Y, 0)).toBe(false);
    expect(isInDefendedPenaltyArea(17, CENTRE_Y, 0)).toBe(false);
    expect(isInDefendedPenaltyArea(10, CENTRE_Y + 21, 0)).toBe(false);
  });

  it('nests the six-yard box inside the penalty area', () => {
    for (const side of SIDES) {
      const spot = goalKickSpot(side, 10);
      expect(isInDefendedGoalArea(spot.x, spot.y, side)).toBe(true);
      expect(isInDefendedPenaltyArea(spot.x, spot.y, side)).toBe(true);
    }
    expect(isInDefendedGoalArea(6, CENTRE_Y, 0)).toBe(false);
  });

  it('marks the D as the part of the arc outside the box', () => {
    // Straight out from the spot: inside the box is not the D, just beyond it is.
    expect(isInPenaltyArc(16, CENTRE_Y, 0)).toBe(false);
    expect(isInPenaltyArc(17, CENTRE_Y, 0)).toBe(true);
    // Ten yards from the spot is the edge of the arc.
    expect(isInPenaltyArc(11 + PITCH.circleRadius + 0.1, CENTRE_Y, 0)).toBe(false);
    // Wide of the box at the same depth is outside the arc.
    expect(isInPenaltyArc(17, CENTRE_Y + 22, 0)).toBe(false);
  });

  it('has a centre circle of the same ten yards', () => {
    expect(isInCentreCircle(CENTRE_X, CENTRE_Y)).toBe(true);
    expect(isInCentreCircle(CENTRE_X + PITCH.circleRadius - 0.1, CENTRE_Y)).toBe(true);
    expect(isInCentreCircle(CENTRE_X + PITCH.circleRadius + 0.1, CENTRE_Y)).toBe(false);
  });

  it('reads halves and thirds from each side own point of view', () => {
    expect(isInAttackingHalf(60, CENTRE_Y, 0)).toBe(true);
    expect(isInAttackingHalf(60, CENTRE_Y, 1)).toBe(false);
    // The halfway line itself is in neither attacking half.
    expect(isInAttackingHalf(CENTRE_X, CENTRE_Y, 0)).toBe(false);
    expect(isInAttackingHalf(CENTRE_X, CENTRE_Y, 1)).toBe(false);

    expect(thirdFor(10, 0)).toBe('defensive');
    expect(thirdFor(10, 1)).toBe('attacking');
    expect(thirdFor(CENTRE_X, 0)).toBe('middle');
    expect(thirdFor(CENTRE_X, 1)).toBe('middle');
    expect(thirdFor(100, 0)).toBe('attacking');
  });
});

describe('shot zones', () => {
  it('names the zone a shot came from', () => {
    expect(shotZone(102, CENTRE_Y, 0)).toBe('sixYard');
    expect(shotZone(95, CENTRE_Y, 0)).toBe('penaltyArea');
    expect(shotZone(86, CENTRE_Y, 0)).toBe('edgeOfBox');
    expect(shotZone(60, CENTRE_Y, 0)).toBe('speculative');
  });

  it('calls a tight angle wide however close it is', () => {
    // Beside the six-yard box, half a metre from the by-line: close, and no goal to aim at.
    expect(shotZone(104.5, CENTRE_Y + 12, 0)).toBe('wide');
    expect(goalOpenness(104.5, CENTRE_Y + 12, 0)).toBeLessThan(0.5);
    // Distance alone would have called it the best chance on the pitch.
    expect(shotDistance(104.5, CENTRE_Y + 12, 0)).toBeLessThan(13);
  });

  it('separates the D from a long-range effort at the same distance', () => {
    const spot = penaltySpot(1);
    const edge = spot.x - PITCH.circleRadius - 1;
    expect(shotZone(edge, CENTRE_Y, 0)).toBe('longRange');
    expect(shotZone(edge + 2, CENTRE_Y, 0)).toBe('edgeOfBox');
    expect(shotDistance(edge, CENTRE_Y, 0)).toBeLessThan(35);
  });

  it('is symmetric between the two ends', () => {
    for (const y of [4, 20, CENTRE_Y, 50, 64]) {
      for (const x of [62, 75, 88, 96, 103]) {
        expect(shotZone(mirrorX(x), y, 1)).toBe(shotZone(x, y, 0));
      }
    }
  });
});

describe('boundaries and restarts', () => {
  it('reports nothing for a ball on the pitch', () => {
    expect(crossedBoundary(CENTRE_X, CENTRE_Y)).toBeNull();
    expect(isInBounds(CENTRE_X, CENTRE_Y)).toBe(true);
    expect(isInBounds(0.2, CENTRE_Y, 0.5)).toBe(false);
  });

  it('attributes a ball over the corner to the line it went furthest past', () => {
    // Barely over the goal line, well over the touchline: a throw-in, not a corner.
    expect(crossedBoundary(-0.1, 69)).toBe('touchlineHigh');
    // The other way round.
    expect(crossedBoundary(-3, 68.2)).toBe('goalLine0');
    expect(crossedBoundary(106, -0.2)).toBe('goalLine1');
    expect(crossedBoundary(CENTRE_X, -1)).toBe('touchlineLow');
  });

  it('takes a throw-in from the touchline, clear of the corner arc', () => {
    expect(throwInSpot(40, 69)).toEqual({ x: 40, y: 68 });
    expect(throwInSpot(40, -1)).toEqual({ x: 40, y: 0 });
    expect(throwInSpot(0.2, -1).x).toBeCloseTo(PITCH.cornerArcRadius);
    expect(throwInSpot(104.9, 69).x).toBeCloseTo(105 - PITCH.cornerArcRadius);
  });

  it('takes a corner from the flag nearest where the ball went out', () => {
    const high = cornerSpot(0, 60);
    expect(high.y).toBeGreaterThan(CENTRE_Y);
    expect(high.x).toBeGreaterThan(0);
    expect(isInBounds(high.x, high.y)).toBe(true);

    const low = cornerSpot(1, 5);
    expect(low.y).toBeLessThan(CENTRE_Y);
    expect(low.x).toBeLessThan(105);
    expect(isInBounds(low.x, low.y)).toBe(true);
  });

  it('takes a goal kick from the side the ball went out on', () => {
    expect(goalKickSpot(0, 60).y).toBeGreaterThan(CENTRE_Y);
    expect(goalKickSpot(0, 5).y).toBeLessThan(CENTRE_Y);
    expect(goalKickSpot(1, 60).x).toBeGreaterThan(CENTRE_X);
    expect(goalKickSpot(0, 60).x).toBeLessThan(CENTRE_X);
  });
});
