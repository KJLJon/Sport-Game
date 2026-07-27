/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.8 — Baseline CPU: role-based offence (spacing, cuts, screens), man defence, possession decisions
 * @story   US-7.1 — Play against a CPU that plays the sport properly
 * @design  06-game-design.md §3.1 (schemes: motion / iso / pick-and-roll; man / 2-3 zone),
 *          §7 (difficulty modifies the *use* of these scores, never the ratings)
 * @invariant INV-1 (difficulty never touches ratings), INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: what the CPU wants to do and where it wants to stand. Pure functions over positions,
 * ratings, and the clock — no world mutation, so every decision is testable on its own and the
 * module that wires them (`index.ts`) is the only thing that knows the step order.
 *
 * **Decisions are expected points, not rules of thumb.** "Shoot if open and close" is a heuristic
 * that has to be re-tuned for every change to the shooting model; "shoot if this shot is worth more
 * than what the possession is otherwise worth" re-tunes itself. It is also the only formulation
 * that gets the corner three right — a 36% three is worth more than a 48% long two, and no
 * distance-and-openness rule will ever say so.
 *
 * **Spacing is the foundation, not a polish item.** Five athletes converging on the ball starves
 * every other model in the sport: no passing lanes, no open shots, no rebounding position, and a
 * shot chart that is nothing but layups. The spot table below is the fix.
 */
import type { Rng } from '../../engine/rng.ts';
import { CENTRE_Y, COURT, attackedBasket, mirrorX, type Side } from './court.ts';

/** A place to stand. */
export interface Spot {
  readonly x: number;
  readonly y: number;
}

export const CPU = {
  /**
   * The *continuation* value of a possession: what it is worth if you decline this shot and keep
   * playing. Shots below it are passed up while there is time; the bar falls to nothing as the shot
   * clock runs out, because a shot you never take is worth zero.
   *
   * Deliberately below league-average efficiency (~1.05 points per possession) rather than equal to
   * it. Declining a shot costs clock and risks a turnover, so what is left is worth less than the
   * possession was — and a bar set at the average means only above-average shots are ever taken,
   * which is arithmetically impossible and, in a headless game, produced 61 attempts instead of 160.
   */
  possessionValue: 0.85,
  /** Game seconds below which the bar starts dropping, and below which anything goes. */
  urgencyFrom: 14,
  urgencyTo: 3,

  /** A lane is open if the contest towards the rim is under this. */
  driveLaneContest: 0.45,
  /**
   * How much better a teammate's look has to be before the ball moves.
   *
   * Set this low and the offence ping-pongs: with five athletes properly spaced somebody always
   * looks marginally better, so the ball never stops moving and every possession is a coin flip
   * on a deflection. At 0.12 a headless game threw 1 264 passes and gave up 167 turnovers.
   */
  passMargin: 0.28,
  /** Game seconds below which the offence will move the ball on a merely-open teammate. */
  desperationFrom: 7,

  /** Per-step chance an off-ball athlete starts a cut, and how long one lasts. */
  cutChance: 0.004,
  cutSteps: 70,
  /** A cut is only worth making from outside this radius. */
  cutFromDistance: 4.5,

  /** Per-step chance the nearest big goes to set a screen, and how long it lasts. */
  screenChance: 0.01,
  screenSteps: 110,
  /** How far in front of the handler's defender the screener sets up. */
  screenOffset: 1.0,

  /** How far a helping defender will leave their own mark to close on a drive. */
  helpDistance: 4.5,
  /** Only help when the drive is this close to the rim. */
  helpTrigger: 4.0,
} as const;

/**
 * Where each role stands on offence, as a fraction of the court measured from the *defending* end,
 * so it mirrors the same way `RoleTable` does.
 *
 * Five spots that between them touch both corners, both wings, the top, and the block — which is
 * what "spacing" means concretely.
 *
 * @spec-ref 06-game-design.md §3.1 — motion offence
 */
const OFFENSIVE_SPOTS: readonly Spot[] = [
  { x: 0.68, y: 0.5 }, // PG — top of the key
  { x: 0.79, y: 0.14 }, // SG — wing, near sideline
  { x: 0.79, y: 0.86 }, // SF — opposite wing
  { x: 0.91, y: 0.28 }, // PF — short corner
  { x: 0.88, y: 0.62 }, // C  — block
];

/** Where each role stands in a 2-3 zone, relative to the basket it is defending. */
const ZONE_SPOTS: readonly Spot[] = [
  // The top pair sit *outside* the arc. Inside it they leave the top of the key open, and an
  // expected-points offence will shoot open threes there until the game is unwatchable.
  { x: 0.32, y: 0.36 }, // top left
  { x: 0.32, y: 0.64 }, // top right
  { x: 0.12, y: 0.17 }, // baseline left
  { x: 0.12, y: 0.83 }, // baseline right
  { x: 0.14, y: 0.5 }, // middle
];

/** Absolute court position for a fractional spot, for a side measured from the end it defends. */
export function spotFor(spot: Spot, side: Side): Spot {
  const x = spot.x * COURT.length;
  return { x: side === 0 ? x : mirrorX(x), y: spot.y * COURT.width };
}

/** The offensive spot for a role. */
export function offensiveSpot(roleIndex: number, side: Side): Spot {
  const spot = OFFENSIVE_SPOTS[roleIndex % OFFENSIVE_SPOTS.length] as Spot;
  return spotFor(spot, side);
}

/**
 * The zone spot for a role, shaded towards the ball. A zone that ignores where the ball is is not a
 * zone, it is five athletes standing still.
 *
 * @spec-ref 06-game-design.md §3.1 — defence: man / 2-3 zone
 */
export function zoneSpot(roleIndex: number, side: Side, ball: Spot): Spot {
  const base = spotFor(ZONE_SPOTS[roleIndex % ZONE_SPOTS.length] as Spot, side);
  const basket = attackedBasket(side === 0 ? 1 : 0);
  return {
    x: base.x + (ball.x - basket.x) * ZONE_SHADE * 0.35,
    y: base.y + (ball.y - CENTRE_Y) * ZONE_SHADE,
  };
}

/** How far a zone leans towards the ball. Zero is five athletes standing still, not a zone. */
const ZONE_SHADE = 0.4;

/**
 * The bar a shot has to clear, in expected points. Falls to nothing as the clock runs out, because
 * a shot you do not take is worth zero.
 */
export function shotBar(shotClockSeconds: number): number {
  if (shotClockSeconds <= CPU.urgencyTo) return 0;
  if (shotClockSeconds >= CPU.urgencyFrom) return CPU.possessionValue;
  const t = (shotClockSeconds - CPU.urgencyTo) / (CPU.urgencyFrom - CPU.urgencyTo);
  return CPU.possessionValue * t;
}

/** Expected points from a shot: what it is worth times how often it goes in. */
export function expectedPoints(probability: number, value: number): number {
  return probability * value;
}

/**
 * Whether to shoot.
 *
 * @spec-ref 06-game-design.md §3.1 — shot outcome is driven by ratings, not by a coin flip; the
 * same numbers therefore drive the decision to take it.
 */
export function shouldShoot(probability: number, value: number, shotClockSeconds: number): boolean {
  return expectedPoints(probability, value) >= shotBar(shotClockSeconds);
}

/** What the ball-handler has decided to do. */
export const Decision = {
  SHOOT: 'shoot',
  DRIVE: 'drive',
  PASS: 'pass',
  HOLD: 'hold',
} as const;
export type DecisionName = (typeof Decision)[keyof typeof Decision];

export interface Look {
  /** Expected points if this athlete shoots from where they stand. */
  readonly expected: number;
  /** `0` clean, `1` smothered. */
  readonly contest: number;
}

/**
 * The possession decision, in priority order: take the shot that clears the bar, move the ball to a
 * clearly better look, drive an open lane, or hold and let the offence move.
 *
 * A teammate has to be *clearly* better, not merely better — `passMargin` is what stops the ball
 * ping-ponging between two athletes with near-identical looks, which is what a naive
 * best-expected-value rule does.
 */
export function decide(
  own: Look,
  best: { look: Look; open: boolean } | null,
  laneContest: number,
  shotClockSeconds: number,
): DecisionName {
  if (own.expected >= shotBar(shotClockSeconds)) return Decision.SHOOT;
  if (best !== null && best.open && best.look.expected > own.expected + CPU.passMargin) {
    return Decision.PASS;
  }
  if (laneContest < CPU.driveLaneContest) return Decision.DRIVE;
  // Only once the clock is genuinely short is a merely-open teammate worth the risk.
  if (best !== null && best.open && shotClockSeconds < CPU.desperationFrom) return Decision.PASS;
  return Decision.HOLD;
}

/** Whether an off-ball athlete should start a cut to the rim from where they are. */
export function shouldCut(distanceToBasket: number, ballIsHeld: boolean, rng: Rng): boolean {
  if (!ballIsHeld || distanceToBasket < CPU.cutFromDistance) return false;
  return rng.bool(CPU.cutChance);
}

/**
 * Where a screener stands: just in front of the handler's defender, on the side the handler is
 * heading. The physical effect comes free from the collision solver — a screen is a body, not a
 * special case.
 *
 * @spec-ref 06-game-design.md §3.1 — pick-and-roll emphasis
 */
export function screenSpot(handler: Spot, defender: Spot): Spot {
  const dx = defender.x - handler.x;
  const dy = defender.y - handler.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: handler.x, y: handler.y };

  return {
    x: defender.x + (dx / length) * CPU.screenOffset,
    y: defender.y + (dy / length) * CPU.screenOffset,
  };
}

/**
 * Whether a defender should leave their mark to help on a drive: the ball is getting to the rim,
 * they are near enough to do something about it, and their own mark is not the one driving.
 */
export function shouldHelp(
  distanceToBall: number,
  ballDistanceToBasket: number,
  markIsCarrier: boolean,
): boolean {
  if (markIsCarrier) return false;
  return ballDistanceToBasket <= CPU.helpTrigger && distanceToBall <= CPU.helpDistance;
}
