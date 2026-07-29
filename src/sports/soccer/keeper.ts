/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.9 — Goalkeeper AI: positioning, shot-stopping, claims, distribution; manual on penalties
 * @story   US-4.3 — Defend and keep goal
 * @design  06-game-design.md §3.2 (the goalkeeper), 05-data-model.md §3.2 (goalkeeping weights)
 * @invariant INV-1 (difficulty never touches ratings), INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: the eleventh player, and the only one the game plays for you by default.
 *
 * **A save is a race, not a dice roll.** The keeper has a position and a reach; the shot has an aim
 * point and a flight time. If the keeper can cover the distance to the ball in the time available,
 * they save it. `goalkeeping` decides how fast they cover ground, not how often a hidden number
 * comes up — so a shot into the far corner beats a good keeper because it is *further away*, and
 * that reads on screen as a dive that didn't quite get there.
 *
 * This is why T-6.6 took its flight time from the distance to the aim point rather than to the goal
 * centre. That decision was made for the keeper's benefit and this module is where it pays: a
 * far-corner shot is in the air longer, which partly offsets the extra dive, and the two effects
 * fighting each other is what makes the near post the right thing to aim at from a tight angle
 * without anyone writing a rule saying so.
 *
 * **Positioning is where most keeping actually happens.** `keeperSpot` puts them on the bisector of
 * the angle to the two posts, advanced off the line towards the ball. Coming off the line shortens
 * every dive; it also means a chip goes over them. Both fall out of the geometry rather than being
 * separate mechanics, which is the test of whether the positioning model is real.
 *
 * **`saveOutcome` is deliberately three-valued.** Caught, parried, beaten. A keeper who only ever
 * catches or concedes has no rebounds in them, and rebounds are most of the drama in a penalty box.
 * A hard shot at full stretch is parried; a tame one straight at them is held.
 *
 * **Manual on penalties is a control-layer flag, not a fifth model** (`06` §3.2). The same
 * `saveOutcome` runs either way; `isKeeperManual` only says who supplies the dive.
 */
import type { Rng } from '../../engine/rng.ts';
import {
  PITCH,
  defendedGoal,
  defendedGoalLineX,
  type Side as PitchSide,
  type Spot,
} from './pitch.ts';
import type { PassKind } from './passing.ts';

/** What a keeper brings. `goalkeeping` is a derived soccer rating (`05` §3.2). */
export interface KeeperRatings {
  readonly goalkeeping: number;
}

export const KEEPER = {
  /** Metres off the line at the very least — nobody stands *on* it. */
  minAdvance: 0.4,
  /** And at most, before they are simply out of the goal. */
  maxAdvance: 5.5,
  /** Distance from goal at which the keeper stops advancing further for a closer ball. */
  advanceRange: 30,

  /**
   * Metres per second a 50-rated keeper covers going to ground, and what a perfect one adds.
   *
   * Tuned down from a first guess of 4.6/3.4, which had an average keeper saving 58% of top-corner
   * shots from twelve metres — a wall with a radius rather than a goalkeeper. Around 4 m/s of
   * lateral dive is what the footage supports, and it puts that same shot near 16%.
   */
  diveSpeed: 3,
  diveSpeedBonus: 2.2,
  /** Standing reach, in metres, before any diving happens at all. */
  reach: 1.15,
  /** Reaction time, in seconds, that a 50-rated keeper loses before moving. */
  reactionSeconds: 0.28,
  /** How much of that a perfect `goalkeeping` removes. */
  reactionRelief: 0.6,

  /** How sharply the save chance switches from "gets there" to "doesn't". */
  softness: 0.45,

  /** Above this ball speed a save is parried rather than held. */
  holdSpeed: 19,
  /** And below this margin of comfort, likewise. */
  holdMargin: 0.35,

  /** Metres either side of the keeper a cross can be claimed from. */
  claimRadius: 3.2,
  /** Ball heights, in metres, a claim is possible between. */
  claimMinHeight: 1.2,
  claimMaxHeight: 2.9,

  /** Pressure above which the keeper stops trying to play out from the back. */
  distributionPanic: 0.55,
} as const;

const GOAL_HALF_WIDTH = PITCH.goalWidth / 2;

/**
 * Where the keeper should be standing, given where the ball is.
 *
 * On the bisector of the angle to the two posts — the line that leaves equal goal on either side of
 * them — advanced off the line by an amount that grows as the ball gets closer. Coming out narrows
 * the angle and shortens every dive, at the cost of the ball over the top. Neither of those is a
 * rule here; they are both consequences.
 *
 * `aggression` is `0–1` and belongs to the formation (T-6.10), not to difficulty: a sweeper-keeper
 * is a tactical choice, and scaling it with difficulty would be exactly the rating-tampering INV-1
 * forbids.
 */
export function keeperSpot(ballX: number, ballY: number, side: PitchSide, aggression = 0.5): Spot {
  const goal = defendedGoal(side);
  const line = defendedGoalLineX(side);

  const distance = Math.hypot(ballX - goal.x, ballY - goal.y);
  const closeness = 1 - clamp01(distance / KEEPER.advanceRange);
  const advance =
    KEEPER.minAdvance + closeness * aggression * (KEEPER.maxAdvance - KEEPER.minAdvance);

  const towards = side === 0 ? 1 : -1;
  const x = line + towards * advance;

  // Stand on the line from the ball to the goal centre, at the depth we have advanced to. That is
  // the bisector for a symmetric mouth, and it degrades sensibly when the ball is level with us.
  const depthFraction = distance <= advance ? 1 : advance / distance;
  const y = goal.y + (ballY - goal.y) * depthFraction;

  return { x, y: clamp(y, goal.y - GOAL_HALF_WIDTH, goal.y + GOAL_HALF_WIDTH) };
}

/** Seconds lost before the keeper moves at all. */
export function reactionTime(ratings: KeeperRatings): number {
  return KEEPER.reactionSeconds * (1 - KEEPER.reactionRelief * (ratings.goalkeeping / 100));
}

/** How far the keeper can get in a given time, including their standing reach. */
export function diveReach(ratings: KeeperRatings, seconds: number): number {
  const speed = KEEPER.diveSpeed + KEEPER.diveSpeedBonus * (ratings.goalkeeping / 100);
  const moving = Math.max(0, seconds - reactionTime(ratings));
  return KEEPER.reach + speed * moving;
}

/**
 * Where the ball passes the keeper's own depth, rather than where it ends up in the goal.
 *
 * This is what makes coming off the line *worth* anything. A keeper five metres out meets the ball
 * before it has finished spreading towards the corner, so the dive is shorter.
 *
 * **Known limitation: height is the chord, not the arc.** Exact at both ends, low in between. The
 * consequence is specific and worth stating, because the first draft of this file claimed the
 * opposite: a chip over an advanced keeper is **not** modelled. A real lofted shot peaks above the
 * bar and drops, so an advanced keeper meets it *higher* and it goes over them; a straight line
 * from boot to goal is never above the bar, so here they meet it *lower*. Fixing it means passing
 * the launch velocity in and evaluating the true parabola — worth doing when something actually
 * needs the chip (T-6.15's arcade set is the likely first caller), and not before.
 */
export function interceptPoint(
  from: { x: number; y: number },
  aim: { y: number; z: number },
  goalX: number,
  keeperX: number,
  releaseZ = 0.11,
): { y: number; z: number } {
  const span = goalX - from.x;
  if (Math.abs(span) < 1e-6) return aim;

  const t = clamp01((keeperX - from.x) / span);
  return {
    y: from.y + (aim.y - from.y) * t,
    z: releaseZ + (aim.z - releaseZ) * t,
  };
}

/**
 * How far the keeper has to travel to reach the ball, across the goal and up it.
 *
 * Pass the *intercept* point rather than the aim point when the keeper is off their line — see
 * `interceptPoint`. Passing the aim point measures the dive as if the keeper were standing on the
 * goal line, which is the right answer only when they are.
 */
export function diveDistance(
  keeper: { y: number },
  ball: { y: number; z: number },
  keeperHeight = 0.9,
): number {
  return Math.hypot(ball.y - keeper.y, Math.max(0, ball.z - keeperHeight));
}

/**
 * The chance of a save, `0–1`.
 *
 * A logistic on `reach − distance`, so it is not a cliff: a shot just inside the keeper's range is
 * usually but not always saved, and one just outside is occasionally clawed out. The softness is
 * what stops the model reading as binary, which is the difference between a goalkeeper and a wall
 * with a radius.
 */
export function saveChance(
  ratings: KeeperRatings,
  keeper: { y: number },
  aim: { y: number; z: number },
  flightSeconds: number,
): number {
  const margin = diveReach(ratings, flightSeconds) - diveDistance(keeper, aim);
  return 1 / (1 + Math.exp(-margin / KEEPER.softness));
}

export type SaveResult = 'caught' | 'parried' | 'beaten';

/**
 * Whether the keeper stops it, and whether they hold it.
 *
 * Three-valued on purpose. A keeper who only catches or concedes has no rebounds in them, and a
 * rebound is most of what makes a penalty box interesting. A ball is held when it is slow enough
 * *and* the keeper had it comfortably; everything else that is stopped is pushed away.
 */
export function saveOutcome(
  ratings: KeeperRatings,
  keeper: { y: number },
  aim: { y: number; z: number },
  flightSeconds: number,
  ballSpeed: number,
  rng: Rng,
): SaveResult {
  const chance = saveChance(ratings, keeper, aim, flightSeconds);
  if (rng.next() >= chance) return 'beaten';

  const margin = diveReach(ratings, flightSeconds) - diveDistance(keeper, aim);
  const comfortable = margin >= KEEPER.holdMargin && ballSpeed < KEEPER.holdSpeed;
  return comfortable ? 'caught' : 'parried';
}

/**
 * Whether the keeper can come and claim a ball in the air.
 *
 * Height is the gate that matters: below `claimMinHeight` an outfield player's foot gets there
 * first and a keeper diving into it is a foul waiting to happen, and above `claimMaxHeight` nobody
 * is reaching it. Between the two it is a contest of `goalkeeping` against distance.
 */
export function claimChance(
  ratings: KeeperRatings,
  keeper: { x: number; y: number },
  ball: { x: number; y: number; z: number },
): number {
  if (ball.z < KEEPER.claimMinHeight || ball.z > KEEPER.claimMaxHeight) return 0;

  const distance = Math.hypot(ball.x - keeper.x, ball.y - keeper.y);
  if (distance > KEEPER.claimRadius) return 0;

  const closeness = 1 - distance / KEEPER.claimRadius;
  return clamp01(closeness * (0.45 + 0.55 * (ratings.goalkeeping / 100)));
}

/** The seeded half of a claim. */
export function resolveClaim(
  ratings: KeeperRatings,
  keeper: { x: number; y: number },
  ball: { x: number; y: number; z: number },
  rng: Rng,
): boolean {
  return rng.next() < claimChance(ratings, keeper, ball);
}

/**
 * What the keeper does with it once they have it.
 *
 * Under real pressure they clear it — a lofted ball upfield. Otherwise they look for the short one,
 * which is what makes playing out from the back a thing that can go wrong rather than a thing that
 * happens off screen. Returns a `PassKind` so distribution goes through `passing.ts` like every
 * other pass, rather than acquiring its own throw model.
 */
export function distributionChoice(pressure: number, hasShortOption: boolean): PassKind {
  if (!hasShortOption || pressure >= KEEPER.distributionPanic) return 'lofted';
  return 'short';
}

/**
 * Whether the player takes the gloves for this moment.
 *
 * `06` §3.2 offers manual control on penalties and nowhere else, and this is the whole of that
 * feature: the same `saveOutcome` runs either way, and this only says who supplies the dive.
 */
export function isKeeperManual(restartKind: string | null, playerControlsKeeper: boolean): boolean {
  return playerControlsKeeper && restartKind === 'penalty';
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
