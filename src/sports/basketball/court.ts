/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.1 — Court geometry, zones, arc, key, hoop, boundaries
 * @story   US-3.1 — Play a 5v5 basketball match
 * @design  06-game-design.md §3.1 (basketball), 04-architecture.md §5 (the sport module seam)
 * @invariant INV-2 (seeded PRNG only), INV-5 (no sport logic in the engine)
 *
 * Purpose: every question about *where* on a basketball court something is. Shooting, rules,
 * rebounding, and the CPU all ask this module rather than carrying their own copies of the
 * dimensions — so the three-point line is one number in one place, and moving it moves the whole
 * game at once.
 *
 * Dimensions are FIBA, in metres, because the world already works in metres and FIBA's numbers are
 * metric by definition rather than by conversion. The court is 28 × 15 with the origin at the
 * bottom-left corner, matching `FieldGeometry`'s "origin at a corner".
 *
 * Sides follow the engine's convention: `goals[side]` is the basket that `side` *defends*, so side
 * 0 defends the left basket (low x) and attacks the right one.
 *
 * One deliberate simplification: the world is exactly the court, so an inbounding athlete stands on
 * the boundary line rather than a metre behind it. Nothing in the rules depends on that metre, and
 * keeping world bounds and court bounds identical means `world.clampToBounds` is the whole
 * out-of-bounds containment story for athletes.
 */
import type { FieldGeometry, Goal, Rect } from '../types.ts';

/** Which side of the court a team defends. */
export type Side = 0 | 1;

/**
 * The court, in metres. Every literal in the basketball module traces back to one of these.
 *
 * @spec-ref 06-game-design.md §3.1 — full court, 3-point line, key, free throws
 */
export const COURT = {
  /** Baseline to baseline. */
  length: 28,
  /** Sideline to sideline. */
  width: 15,

  /** Centre of the rim, measured from the nearer baseline. */
  basketFromBaseline: 1.575,
  /** Face of the backboard, from the nearer baseline. */
  backboardFromBaseline: 1.2,
  backboardWidth: 1.8,
  rimRadius: 0.2255,
  rimHeight: 3.05,

  /** Radius of the three-point arc, measured from the point below the rim centre. */
  threeArcRadius: 6.75,
  /** Corner three-point lines, this far in from each sideline. */
  threeCornerInset: 0.9,

  /** Width of the key (the painted area). */
  keyWidth: 4.9,
  /** Free-throw line, from the nearer baseline. */
  freeThrowFromBaseline: 5.8,
  freeThrowCircleRadius: 1.8,

  centreCircleRadius: 1.8,
  /** The no-charge semicircle under the basket. */
  restrictedAreaRadius: 1.25,
} as const;

/** Half the court's width — the centre line's y, and the axis every basket sits on. */
export const CENTRE_Y = COURT.width / 2;
/** Half-court line. */
export const CENTRE_X = COURT.length / 2;

/** Lateral distance from the centre line at which the corner three-point lines run. */
const CORNER_HALF_SPAN = CENTRE_Y - COURT.threeCornerInset;

const KEY_HALF_WIDTH = COURT.keyWidth / 2;

/** The basket each side defends, in the order `FieldGeometry.goals` requires. */
const GOALS: readonly Goal[] = [
  {
    side: 0,
    x: COURT.basketFromBaseline,
    y: CENTRE_Y,
    z: COURT.rimHeight,
    radius: COURT.rimRadius,
  },
  {
    side: 1,
    x: COURT.length - COURT.basketFromBaseline,
    y: CENTRE_Y,
    z: COURT.rimHeight,
    radius: COURT.rimRadius,
  },
];

/**
 * Named rectangles the rules and the CPU reason about. The arc and the restricted-area semicircle
 * are curves and so cannot live here; they get predicates below instead.
 *
 * Suffixes are the *defending* side, matching `goals`: `paint0` is the paint side 0 defends.
 */
const ZONES: Readonly<Record<string, Rect>> = {
  paint0: {
    x: 0,
    y: CENTRE_Y - KEY_HALF_WIDTH,
    width: COURT.freeThrowFromBaseline,
    height: COURT.keyWidth,
  },
  paint1: {
    x: COURT.length - COURT.freeThrowFromBaseline,
    y: CENTRE_Y - KEY_HALF_WIDTH,
    width: COURT.freeThrowFromBaseline,
    height: COURT.keyWidth,
  },
  half0: { x: 0, y: 0, width: CENTRE_X, height: COURT.width },
  half1: { x: CENTRE_X, y: 0, width: CENTRE_X, height: COURT.width },
};

export const basketballCourt: FieldGeometry = {
  width: COURT.length,
  height: COURT.width,
  zones: ZONES,
  goals: GOALS,
};

/** The basket `side` defends. */
export function defendedBasket(side: Side): Goal {
  return GOALS[side] as Goal;
}

/** The basket `side` attacks — the one it scores in. */
export function attackedBasket(side: Side): Goal {
  return GOALS[side === 0 ? 1 : 0] as Goal;
}

/** Sign of the direction `side` attacks in: `+1` towards high x, `-1` towards low x. */
export function attackDirection(side: Side): 1 | -1 {
  return side === 0 ? 1 : -1;
}

/** Floor distance from a point to the basket `side` attacks — what a shot is measured by. */
export function shotDistance(x: number, y: number, side: Side): number {
  const basket = attackedBasket(side);
  return Math.hypot(x - basket.x, y - basket.y);
}

/**
 * Whether a shot from here is worth three.
 *
 * @spec-ref 06-game-design.md §3.1 — three-point line
 *
 * Two rules, not one: beyond the arc, *or* outside the straight corner lines. The second is what
 * makes the corner three the shortest three on the court, and a distance-only test would score it
 * as a two.
 */
export function isThreePointShot(x: number, y: number, side: Side): boolean {
  if (Math.abs(y - CENTRE_Y) >= CORNER_HALF_SPAN) return true;
  return shotDistance(x, y, side) > COURT.threeArcRadius;
}

/** Points a made shot from here is worth. */
export function shotValue(x: number, y: number, side: Side): 2 | 3 {
  return isThreePointShot(x, y, side) ? 3 : 2;
}

/** Where the arc crosses a corner line, measured along the court from the baseline. */
export const CORNER_ARC_X =
  COURT.basketFromBaseline +
  Math.sqrt(COURT.threeArcRadius * COURT.threeArcRadius - CORNER_HALF_SPAN * CORNER_HALF_SPAN);

/** Inside the key the given side attacks. Includes the free-throw line itself. */
export function isInAttackingPaint(x: number, y: number, side: Side): boolean {
  const paint = ZONES[side === 0 ? 'paint1' : 'paint0'] as Rect;
  return x >= paint.x && x <= paint.x + paint.width && y >= paint.y && y <= paint.y + paint.height;
}

/** Inside the no-charge semicircle under the basket the given side attacks. */
export function isInRestrictedArea(x: number, y: number, side: Side): boolean {
  const basket = attackedBasket(side);
  if (!isInAttackingPaint(x, y, side)) return false;
  return Math.hypot(x - basket.x, y - basket.y) <= COURT.restrictedAreaRadius;
}

/**
 * Whether a point is in the attacking half for `side`. Backcourt violations (T-2.2) are decided by
 * this, so the boundary is inclusive of the centre line: the line belongs to the backcourt, which
 * is the real rule.
 */
export function isInFrontcourt(x: number, y: number, side: Side): boolean {
  void y;
  return side === 0 ? x > CENTRE_X : x < CENTRE_X;
}

/** Shot zones, for the box score and for CPU shot selection. */
export type ShotZone =
  'restricted' | 'paint' | 'midRange' | 'cornerThree' | 'wingThree' | 'topThree' | 'heave';

/** Beyond this, a shot is a heave rather than a three-point attempt worth taking. */
const HEAVE_DISTANCE = 11;

/**
 * Classifies a shot location. Wing and top are split by the angle off the axis through the basket,
 * which is how commentary and shot charts have always cut it and is what the CPU needs to reason
 * about spacing.
 */
export function shotZone(x: number, y: number, side: Side): ShotZone {
  const basket = attackedBasket(side);
  const distance = Math.hypot(x - basket.x, y - basket.y);

  if (!isThreePointShot(x, y, side)) {
    if (isInRestrictedArea(x, y, side)) return 'restricted';
    return isInAttackingPaint(x, y, side) ? 'paint' : 'midRange';
  }

  if (distance > HEAVE_DISTANCE) return 'heave';
  if (Math.abs(y - CENTRE_Y) >= CORNER_HALF_SPAN) return 'cornerThree';

  // Angle away from the line running up the court through the basket.
  const alongCourt = Math.abs(x - basket.x);
  const lateral = Math.abs(y - basket.y);
  return Math.atan2(lateral, alongCourt) <= Math.PI / 6 ? 'topThree' : 'wingThree';
}

/** Inside the lines. `margin` shrinks the legal area, for an entity with a radius. */
export function isInBounds(x: number, y: number, margin = 0): boolean {
  return x >= margin && x <= COURT.length - margin && y >= margin && y <= COURT.width - margin;
}

/** Which boundary a point is past, or `null` if it is on the court. */
export type Boundary = 'baseline0' | 'baseline1' | 'sidelineLow' | 'sidelineHigh';

/**
 * The boundary a point most escaped through. Deepest overshoot wins, so a ball that clears the
 * corner is attributed to the line it went furthest past rather than to whichever is checked first.
 */
export function crossedBoundary(x: number, y: number): Boundary | null {
  const overshoots: readonly (readonly [Boundary, number])[] = [
    ['baseline0', -x],
    ['baseline1', x - COURT.length],
    ['sidelineLow', -y],
    ['sidelineHigh', y - COURT.width],
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
 * Where play restarts after the ball goes out. The nearest point on the boundary, pulled away from
 * the corners so the inbounder is never wedged into one, and — on a baseline — pushed clear of the
 * backboard, which a real inbounder has to walk around.
 */
export function throwInSpot(x: number, y: number): Spot {
  const corner = 1.5;
  const boundary = crossedBoundary(x, y);

  if (boundary === 'sidelineLow' || boundary === 'sidelineHigh') {
    return {
      x: clamp(x, corner, COURT.length - corner),
      y: boundary === 'sidelineLow' ? 0 : COURT.width,
    };
  }

  if (boundary === 'baseline0' || boundary === 'baseline1') {
    const y0 = clamp(y, corner, COURT.width - corner);
    // Behind the backboard is not a legal place to stand; step to the nearer side of it.
    const behindBoard = Math.abs(y0 - CENTRE_Y) < COURT.backboardWidth / 2;
    const shifted = behindBoard
      ? CENTRE_Y + Math.sign(y0 - CENTRE_Y || 1) * (COURT.backboardWidth / 2 + 0.2)
      : y0;
    return { x: boundary === 'baseline0' ? 0 : COURT.length, y: shifted };
  }

  // Not actually out; the nearest edge is still the honest answer.
  const toBaseline = Math.min(x, COURT.length - x);
  const toSideline = Math.min(y, COURT.width - y);
  return toSideline <= toBaseline
    ? { x: clamp(x, corner, COURT.length - corner), y: y <= CENTRE_Y ? 0 : COURT.width }
    : { x: x <= CENTRE_X ? 0 : COURT.length, y: clamp(y, corner, COURT.width - corner) };
}

/** The centre circle, where the opening tip happens. */
export function tipOffSpot(): Spot {
  return { x: CENTRE_X, y: CENTRE_Y };
}

/** The free-throw line for a shooter attacking `side`'s target basket. */
export function freeThrowSpot(side: Side): Spot {
  return {
    x: side === 0 ? COURT.length - COURT.freeThrowFromBaseline : COURT.freeThrowFromBaseline,
    y: CENTRE_Y,
  };
}

/**
 * Mirrors a point to the other end of the court. Role placements and set plays are authored once
 * for the left-attacking side and reflected, so there is no second copy to keep in step.
 */
export function mirrorX(x: number): number {
  return COURT.length - x;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
