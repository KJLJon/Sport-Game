/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.1 — Pitch geometry, zones, goals, boundary lines
 * @story   US-4.1 — Play an 11v11 soccer match
 * @design  06-game-design.md §3.2 (soccer), 04-architecture.md §5 (the sport module seam)
 * @invariant INV-5 (no sport logic in the engine)
 *
 * Purpose: every question about *where* on a pitch something is. Rules, shooting, offside,
 * formations, the goalkeeper, and the renderer all ask this module rather than carrying their own
 * copies of the dimensions — so the penalty area is one number in one place.
 *
 * Dimensions are the FIFA recommended 105 × 68 pitch, in metres, with the origin at the
 * bottom-left corner to match `FieldGeometry`'s "origin at a corner". The marking distances are
 * the Laws of the Game's, which are imperial by origin (6-yard box, 18-yard box, 12-yard spot) and
 * metric by publication; the metric figures are used because the world works in metres.
 *
 * Sides follow the engine's convention, the same as basketball's: `goals[side]` is the goal that
 * `side` *defends*, so side 0 defends the left goal (low x) and attacks the right one. Zone names
 * carry the **defending** side as their suffix for the same reason — `penaltyArea0` is the box
 * side 0 defends and side 1 attacks.
 *
 * Unlike basketball, a soccer goal is a mouth rather than a point, so the geometry here answers two
 * questions a court never had to: whether a ball crossing the line is *between the posts and under
 * the bar* (`isGoal`), and how much of the goal a shooter can actually see from where they are
 * (`goalAngle`). Shooting (T-6.6) and the keeper (T-6.9) are both built on the second one.
 *
 * One deliberate simplification, carried over from `court.ts`: the world is exactly the pitch, so a
 * player taking a throw-in stands on the touchline rather than behind it. Nothing in the rules
 * depends on that metre, and keeping world bounds and pitch bounds identical means
 * `world.clampToBounds` is the whole containment story for athletes.
 */
import type { FieldGeometry, Goal, Rect } from '../types.ts';

/** Which side of the pitch a team defends. */
export type Side = 0 | 1;

/**
 * The pitch, in metres. Every literal in the soccer module traces back to one of these.
 *
 * @spec-ref 06-game-design.md §3.2 — full pitch, 11v11 including a goalkeeper
 */
export const PITCH = {
  /** Goal line to goal line. */
  length: 105,
  /** Touchline to touchline. */
  width: 68,

  /** Inside of post to inside of post. */
  goalWidth: 7.32,
  /** Underside of the crossbar. */
  goalHeight: 2.44,
  /** How far behind the goal line the net reaches — where a scored ball comes to rest. */
  goalDepth: 2,

  /** The 18-yard box: depth from the goal line, and full width. */
  penaltyAreaDepth: 16.5,
  penaltyAreaWidth: 40.32,

  /** The 6-yard box. */
  goalAreaDepth: 5.5,
  goalAreaWidth: 18.32,

  /** The penalty spot, from the goal line. */
  penaltySpotFromGoalLine: 11,
  /**
   * Radius of the centre circle, and of the arc struck from the penalty spot. They are the same
   * ten yards, which is why one number serves both.
   */
  circleRadius: 9.15,
  /** The quarter-circle at each corner, from which a corner kick is taken. */
  cornerArcRadius: 1,
} as const;

/** Half the pitch's width — the halfway line's y, and the axis both goals sit on. */
export const CENTRE_Y = PITCH.width / 2;
/** The halfway line. */
export const CENTRE_X = PITCH.length / 2;

const GOAL_HALF_WIDTH = PITCH.goalWidth / 2;
const PENALTY_HALF_WIDTH = PITCH.penaltyAreaWidth / 2;
const GOAL_AREA_HALF_WIDTH = PITCH.goalAreaWidth / 2;

/**
 * The goal each side defends, in the order `FieldGeometry.goals` requires.
 *
 * `radius` is half the goal mouth rather than a post's thickness: `Goal.radius` is documented as
 * the target's size, and for a sport whose target is a mouth that is the half-width. `z` is the
 * crossbar, matching basketball's use of it for the rim height.
 */
const GOALS: readonly Goal[] = [
  { side: 0, x: 0, y: CENTRE_Y, z: PITCH.goalHeight, radius: GOAL_HALF_WIDTH },
  { side: 1, x: PITCH.length, y: CENTRE_Y, z: PITCH.goalHeight, radius: GOAL_HALF_WIDTH },
];

/**
 * Named rectangles the rules, the formations, and the CPU reason about. The centre circle and the
 * penalty arc are curves and so cannot live here; they get predicates below instead.
 *
 * Suffixes are the *defending* side, matching `goals`.
 */
const ZONES: Readonly<Record<string, Rect>> = {
  penaltyArea0: {
    x: 0,
    y: CENTRE_Y - PENALTY_HALF_WIDTH,
    width: PITCH.penaltyAreaDepth,
    height: PITCH.penaltyAreaWidth,
  },
  penaltyArea1: {
    x: PITCH.length - PITCH.penaltyAreaDepth,
    y: CENTRE_Y - PENALTY_HALF_WIDTH,
    width: PITCH.penaltyAreaDepth,
    height: PITCH.penaltyAreaWidth,
  },
  goalArea0: {
    x: 0,
    y: CENTRE_Y - GOAL_AREA_HALF_WIDTH,
    width: PITCH.goalAreaDepth,
    height: PITCH.goalAreaWidth,
  },
  goalArea1: {
    x: PITCH.length - PITCH.goalAreaDepth,
    y: CENTRE_Y - GOAL_AREA_HALF_WIDTH,
    width: PITCH.goalAreaDepth,
    height: PITCH.goalAreaWidth,
  },
  half0: { x: 0, y: 0, width: CENTRE_X, height: PITCH.width },
  half1: { x: CENTRE_X, y: 0, width: CENTRE_X, height: PITCH.width },
  /** Thirds, which is how shape-by-phase (T-6.10) and the Playbook adapter talk about territory. */
  third0: { x: 0, y: 0, width: PITCH.length / 3, height: PITCH.width },
  middleThird: { x: PITCH.length / 3, y: 0, width: PITCH.length / 3, height: PITCH.width },
  third1: { x: (PITCH.length * 2) / 3, y: 0, width: PITCH.length / 3, height: PITCH.width },
};

export const soccerPitch: FieldGeometry = {
  width: PITCH.length,
  height: PITCH.width,
  zones: ZONES,
  goals: GOALS,
};

/** The goal `side` defends. */
export function defendedGoal(side: Side): Goal {
  return GOALS[side] as Goal;
}

/** The goal `side` attacks — the one it scores in. */
export function attackedGoal(side: Side): Goal {
  return GOALS[side === 0 ? 1 : 0] as Goal;
}

/** Sign of the direction `side` attacks in: `+1` towards high x, `-1` towards low x. */
export function attackDirection(side: Side): 1 | -1 {
  return side === 0 ? 1 : -1;
}

/** x of the goal line `side` defends. */
export function defendedGoalLineX(side: Side): number {
  return side === 0 ? 0 : PITCH.length;
}

/** Floor distance from a point to the centre of the goal `side` attacks. */
export function shotDistance(x: number, y: number, side: Side): number {
  const goal = attackedGoal(side);
  return Math.hypot(x - goal.x, y - goal.y);
}

/**
 * The angle, in radians, that the goal mouth subtends from a point — how much goal the shooter can
 * actually see. Zero along the goal line outside the posts, widest right in front of the mouth.
 *
 * This is the honest measure of a chance's quality, and the reason a shot from the by-line is bad
 * however short it is. Shooting (T-6.6) and keeper positioning (T-6.9) both read it.
 */
export function goalAngle(x: number, y: number, side: Side): number {
  const goal = attackedGoal(side);
  const depth = Math.abs(goal.x - x);
  const toLowPost = Math.atan2(y - (goal.y - GOAL_HALF_WIDTH), depth);
  const toHighPost = Math.atan2(y - (goal.y + GOAL_HALF_WIDTH), depth);
  return Math.abs(toLowPost - toHighPost);
}

/**
 * Whether a ball at this position has scored against `side` — over its goal line, between the
 * posts, under the bar.
 *
 * The whole-ball-over-the-line law is not modelled: the ball is a point here, as it is everywhere
 * else in the engine, and a radius correction would be the only place in the sport where it wasn't.
 */
export function isGoal(x: number, y: number, z: number, defendingSide: Side): boolean {
  const line = defendedGoalLineX(defendingSide);
  const past = defendingSide === 0 ? x <= line : x >= line;
  if (!past) return false;
  if (z > PITCH.goalHeight || z < 0) return false;
  return Math.abs(y - CENTRE_Y) <= GOAL_HALF_WIDTH;
}

function inRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Inside the penalty area `side` defends — where a foul by `side` is a penalty. */
export function isInDefendedPenaltyArea(x: number, y: number, side: Side): boolean {
  return inRect(ZONES[side === 0 ? 'penaltyArea0' : 'penaltyArea1'] as Rect, x, y);
}

/** Inside the penalty area `side` attacks — where a shot is "inside the box". */
export function isInAttackingPenaltyArea(x: number, y: number, side: Side): boolean {
  return isInDefendedPenaltyArea(x, y, side === 0 ? 1 : 0);
}

/** Inside the six-yard box `side` defends — where a goal kick is taken from. */
export function isInDefendedGoalArea(x: number, y: number, side: Side): boolean {
  return inRect(ZONES[side === 0 ? 'goalArea0' : 'goalArea1'] as Rect, x, y);
}

/**
 * Inside the arc struck from the penalty spot — the "D".
 *
 * Only the part outside the penalty area is marked on a real pitch, and only that part matters:
 * the arc exists to keep players ten yards from the spot at a penalty, and everyone but the taker
 * and the keeper is already required to be outside the box.
 */
export function isInPenaltyArc(x: number, y: number, defendingSide: Side): boolean {
  if (isInDefendedPenaltyArea(x, y, defendingSide)) return false;
  const spot = penaltySpot(defendingSide);
  return Math.hypot(x - spot.x, y - spot.y) <= PITCH.circleRadius;
}

/** Inside the centre circle. */
export function isInCentreCircle(x: number, y: number): boolean {
  return Math.hypot(x - CENTRE_X, y - CENTRE_Y) <= PITCH.circleRadius;
}

/**
 * Whether a point is in the half `side` attacks. The halfway line belongs to neither half for
 * offside purposes — a player level with it is not in the opposing half — so the test is strict.
 */
export function isInAttackingHalf(x: number, y: number, side: Side): boolean {
  void y;
  return side === 0 ? x > CENTRE_X : x < CENTRE_X;
}

/** Which third of the pitch a point is in, named from `side`'s point of view. */
export type Third = 'defensive' | 'middle' | 'attacking';

export function thirdFor(x: number, side: Side): Third {
  const fromOwnGoalLine = side === 0 ? x : PITCH.length - x;
  if (fromOwnGoalLine < PITCH.length / 3) return 'defensive';
  return fromOwnGoalLine < (PITCH.length * 2) / 3 ? 'middle' : 'attacking';
}

/**
 * How much of the goal is available compared with the best a shooter could do from that far out:
 * `1` straight in front of the mouth, falling towards `0` as they drift towards the by-line.
 *
 * The raw `goalAngle` cannot answer "is this a tight angle?" on its own, because it shrinks with
 * distance too — a perfectly central shot from 25 m subtends less than a scrappy one from six.
 * Dividing the distance out is what separates *far* from *narrow*, and the two want different
 * things from the shooting model.
 */
export function goalOpenness(x: number, y: number, side: Side): number {
  const best = 2 * Math.atan2(GOAL_HALF_WIDTH, shotDistance(x, y, side));
  return goalAngle(x, y, side) / best;
}

/** Below this share of the available angle, a shooter is squeezed towards the by-line. */
const TIGHT_ANGLE_OPENNESS = 0.5;

/** Shot zones, for the box score and for CPU shot selection. */
export type ShotZone =
  'sixYard' | 'penaltyArea' | 'edgeOfBox' | 'wide' | 'longRange' | 'speculative';

/** Beyond this, a shot is a hopeful punt rather than a chance worth counting. */
const SPECULATIVE_DISTANCE = 35;

/**
 * Classifies a shot location. Distance alone would call a shot from the by-line a good one, so
 * `wide` is cut by the angle on goal rather than by where the shooter is standing — which is also
 * how the zone reads back to a player watching the replay.
 */
export function shotZone(x: number, y: number, side: Side): ShotZone {
  const distance = shotDistance(x, y, side);
  const defender: Side = side === 0 ? 1 : 0;

  if (isInDefendedGoalArea(x, y, defender)) return 'sixYard';

  // @spec-ref 06-game-design.md §3.2 — a shot from a tight angle is a bad shot at any distance.
  const tightAngle = goalOpenness(x, y, side) < TIGHT_ANGLE_OPENNESS;

  if (isInDefendedPenaltyArea(x, y, defender)) return tightAngle ? 'wide' : 'penaltyArea';
  if (distance > SPECULATIVE_DISTANCE) return 'speculative';
  if (tightAngle) return 'wide';
  return isInPenaltyArc(x, y, defender) ? 'edgeOfBox' : 'longRange';
}

/** Inside the lines. `margin` shrinks the legal area, for an entity with a radius. */
export function isInBounds(x: number, y: number, margin = 0): boolean {
  return x >= margin && x <= PITCH.length - margin && y >= margin && y <= PITCH.width - margin;
}

/** Which boundary a point is past, or `null` if it is on the pitch. */
export type Boundary = 'goalLine0' | 'goalLine1' | 'touchlineLow' | 'touchlineHigh';

/**
 * The boundary a ball most escaped through. Deepest overshoot wins, so a ball that clears the
 * corner flag is attributed to the line it went furthest past rather than to whichever is checked
 * first — which is the difference between a corner and a throw-in.
 */
export function crossedBoundary(x: number, y: number): Boundary | null {
  const overshoots: readonly (readonly [Boundary, number])[] = [
    ['goalLine0', -x],
    ['goalLine1', x - PITCH.length],
    ['touchlineLow', -y],
    ['touchlineHigh', y - PITCH.width],
  ];

  let worst: Boundary | null = null;
  let depth = 0;
  for (const [boundary, over] of overshoots) {
    if (over > depth) {
      depth = over;
      worst = boundary;
    }
  }
  return worst;
}

export interface Spot {
  readonly x: number;
  readonly y: number;
}

/**
 * Where a throw-in is taken: the point on the touchline the ball left through, kept out of the
 * corner arcs so the thrower is never standing on the flag.
 */
export function throwInSpot(x: number, y: number): Spot {
  const inset = PITCH.cornerArcRadius;
  const high = y > CENTRE_Y;
  return { x: clamp(x, inset, PITCH.length - inset), y: high ? PITCH.width : 0 };
}

/**
 * The corner the attacking side takes from, given where the ball crossed the defending side's goal
 * line. Corner kicks are taken from inside the arc, so the spot is pulled a hair infield rather
 * than sitting exactly on the flag.
 */
export function cornerSpot(defendingSide: Side, y: number): Spot {
  const line = defendedGoalLineX(defendingSide);
  const inward = defendingSide === 0 ? PITCH.cornerArcRadius / 2 : -PITCH.cornerArcRadius / 2;
  return {
    x: line + inward,
    y: y > CENTRE_Y ? PITCH.width - PITCH.cornerArcRadius / 2 : PITCH.cornerArcRadius / 2,
  };
}

/**
 * Where a goal kick is taken. The law allows anywhere in the goal area; the keeper takes it from
 * the side the ball went out on, which is what a viewer expects to see.
 */
export function goalKickSpot(defendingSide: Side, y: number): Spot {
  const line = defendedGoalLineX(defendingSide);
  const depth = PITCH.goalAreaDepth * 0.9;
  return {
    x: defendingSide === 0 ? depth : line - depth,
    y: CENTRE_Y + (y > CENTRE_Y ? 1 : -1) * (GOAL_AREA_HALF_WIDTH * 0.6),
  };
}

/** The penalty spot in front of the goal `defendingSide` defends. */
export function penaltySpot(defendingSide: Side): Spot {
  const line = defendedGoalLineX(defendingSide);
  const inward = defendingSide === 0 ? 1 : -1;
  return { x: line + inward * PITCH.penaltySpotFromGoalLine, y: CENTRE_Y };
}

/** The centre spot, where each half and each restart after a goal begins. */
export function kickOffSpot(): Spot {
  return { x: CENTRE_X, y: CENTRE_Y };
}

/**
 * Mirrors a point to the other end of the pitch. Formations and set-piece placements are authored
 * once for the side attacking towards high x and reflected, so there is no second copy to keep in
 * step.
 */
export function mirrorX(x: number): number {
  return PITCH.length - x;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
