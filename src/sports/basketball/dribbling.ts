/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.5 — Dribbling & driving: handling control, contact absorption, blow-by
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  06-game-design.md §3.1 (contact resolved by strength/agility), §2 (drive with the stick),
 *          05-data-model.md §3.1 (ballHandling, interiorD weights)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: what it costs to carry the ball. Three things, and they are the three `06` §3.1 and
 * US-3.2 name: keeping it on a dribble, surviving contact on a drive, and beating your defender.
 *
 * **Why all three are per-step draws rather than one outcome.** A drive is not an event, it is a
 * couple of seconds of sustained pressure — so the model has to be able to say "he lost it halfway
 * in", which a single resolve-at-the-end draw cannot. The per-step probabilities are correspondingly
 * tiny; the tuning table states them per step so the arithmetic is visible rather than implied.
 *
 * Fouls are T-2.7's. Contact here produces a `severity` the foul model will read; nothing in this
 * file decides whether a whistle blows.
 */
import type { Rng } from '../../engine/rng.ts';
import { release, type BallState } from '../../engine/physics/ball.ts';
import type { EntityId, World } from '../../engine/world.ts';

/** What an athlete brings to carrying the ball and to the contact that comes with it. */
export interface HandlerRatings {
  readonly ballHandling: number;
  readonly agility: number;
  readonly strength: number;
  readonly composure: number;
}

/** What a defender brings to taking it away by standing in the way. */
export interface BodyRatings {
  readonly strength: number;
  readonly agility: number;
  readonly interiorD: number;
  readonly perimeterD: number;
}

export const DRIBBLING = {
  /** Per-step chance a 50-rated handler loses it, clean, at a jog. Everything scales this. */
  baseFumble: 0.00025,
  /** How much of that a perfect handling rating removes. */
  handlingRelief: 0.8,
  /** Pressure multiplies it by up to `1 + pressureWeight`. */
  pressureWeight: 3,
  /** So does moving fast, and sprinting on top of that. */
  paceWeight: 0.6,
  sprintPenalty: 0.5,
  /** However bad it gets, a dribble is never a coin flip every frame. */
  maxFumble: 0.02,

  /** How far a fumbled ball squirts. */
  fumbleSpeed: 3.2,

  /** Contact counts within this much overlap of the two bodies' radii. */
  contactMargin: 0.18,
  /** Logistic width for the contact draw, in rating points. */
  contactScale: 22,
  /** Speed a carrier keeps after absorbing contact, and after being stood up by it. */
  absorbedSpeed: 0.82,
  stoppedSpeed: 0.35,
  /** A poor handler can lose it outright in contact. */
  contactStripFloor: 0.02,
  contactStripSpan: 0.16,

  /** Steps a beaten defender is out of the play. */
  blowByStaggerSteps: 24,
  /** Steps a carrier is slowed after being stood up. */
  contactStaggerSteps: 12,
  /** Rating points of advantage that make a blow-by a coin flip. */
  blowByScale: 60,
  blowByFloor: 0.04,
  blowByCeiling: 0.85,
  /** A blow-by is only on the table while actually attacking the defender. */
  blowByRange: 1.9,
  blowByMinSpeed: 3,
} as const;

/**
 * Per-step chance of losing the handle.
 *
 * @spec-ref 06-game-design.md §3.1 — handling control under pressure
 */
export function fumbleChance(
  ratings: HandlerRatings,
  pressure: number,
  speed: number,
  maxSpeed: number,
  sprinting: boolean,
): number {
  const skill = 1 - DRIBBLING.handlingRelief * (ratings.ballHandling / 100);
  const press = 1 + DRIBBLING.pressureWeight * clamp01(pressure) * (1 - ratings.composure / 250);
  const pace =
    1 +
    DRIBBLING.paceWeight * clamp01(speed / Math.max(maxSpeed, 1e-3)) +
    (sprinting ? DRIBBLING.sprintPenalty : 0);

  return Math.min(DRIBBLING.maxFumble, DRIBBLING.baseFumble * skill * press * pace);
}

/**
 * Knocks the ball loose ahead of the carrier, so a fumble reads as a fumble rather than as the ball
 * simply vanishing from someone's hands.
 */
export function fumbleBall(world: World, ball: BallState, carrier: EntityId, rng: Rng): void {
  const facing = world.facing[carrier] as number;
  const angle = facing + rng.float(-1.1, 1.1);
  const speed = DRIBBLING.fumbleSpeed * rng.float(0.7, 1.3);
  release(world, ball, Math.cos(angle) * speed, Math.sin(angle) * speed, 1.1);
}

/** What happened when a driver met a body. */
export const Contact = {
  /** Through it: the drive continues, barely slowed. */
  ABSORBED: 'absorbed',
  /** Stood up: the drive stalls. */
  STOPPED: 'stopped',
  /** Dispossessed: the ball is loose. */
  STRIPPED: 'stripped',
} as const;
export type ContactName = (typeof Contact)[keyof typeof Contact];

export interface ContactResult {
  readonly kind: ContactName;
  /** Speed the carrier keeps, `0–1`. */
  readonly speedFactor: number;
  /**
   * How heavy the collision was, `0–1`. T-2.7's foul model reads this; nothing here does. Built
   * from the closing speed and the mismatch, which is `06` §3.1's "approach angle, speed
   * differential, and discipline" minus the discipline it does not yet have.
   */
  readonly severity: number;
}

/**
 * Resolves contact on a drive: strength and agility against strength and interior defence.
 *
 * @spec-ref 06-game-design.md §3.1 — "contact with defenders is resolved by strength/agility"
 */
export function resolveContact(
  carrier: HandlerRatings & BodyRatings,
  defender: BodyRatings,
  closingSpeed: number,
  rng: Rng,
): ContactResult {
  const power = carrier.strength * 0.6 + carrier.agility * 0.4 + closingSpeed * 3;
  const resist = defender.strength * 0.6 + defender.interiorD * 0.4;
  const through = logistic((power - resist) / DRIBBLING.contactScale);
  const severity = clamp01((closingSpeed / 9 + Math.abs(power - resist) / 90) / 2);

  if (rng.bool(through)) {
    return { kind: Contact.ABSORBED, speedFactor: DRIBBLING.absorbedSpeed, severity };
  }

  const strip = clamp01(
    DRIBBLING.contactStripFloor + DRIBBLING.contactStripSpan * (1 - carrier.ballHandling / 100),
  );
  if (rng.bool(strip)) {
    return { kind: Contact.STRIPPED, speedFactor: DRIBBLING.stoppedSpeed, severity };
  }

  return { kind: Contact.STOPPED, speedFactor: DRIBBLING.stoppedSpeed, severity };
}

/**
 * Chance of beating a defender off the dribble. Agility against perimeter defence, and nothing
 * else — a blow-by is a first step, not a wrestle.
 */
export function blowByChance(carrier: BodyRatings, defender: BodyRatings): number {
  const edge = carrier.agility - defender.perimeterD;
  return clamp(
    0.5 + edge / DRIBBLING.blowByScale / 2,
    DRIBBLING.blowByFloor,
    DRIBBLING.blowByCeiling,
  );
}

/**
 * Whether a blow-by is even on the table: close enough, fast enough, and going *past* the defender
 * rather than into them. The last part is what stops a drive straight at a set defender from
 * counting as beating them — that is contact, and `resolveContact` handles it.
 */
export function canBlowBy(
  world: World,
  carrier: EntityId,
  defender: EntityId,
  targetX: number,
  targetY: number,
): boolean {
  const cx = world.x[carrier] as number;
  const cy = world.y[carrier] as number;
  const dx = (world.x[defender] as number) - cx;
  const dy = (world.y[defender] as number) - cy;

  const gap = Math.hypot(dx, dy);
  if (gap > DRIBBLING.blowByRange || gap < 1e-3) return false;

  const speed = Math.hypot(world.vx[carrier] as number, world.vy[carrier] as number);
  if (speed < DRIBBLING.blowByMinSpeed) return false;

  // Heading for the target, with the defender off to one side rather than dead ahead.
  const toTargetX = targetX - cx;
  const toTargetY = targetY - cy;
  const targetLength = Math.hypot(toTargetX, toTargetY);
  if (targetLength < 1e-3) return false;

  const cos = (dx * toTargetX + dy * toTargetY) / (gap * targetLength);
  return cos > 0.1 && cos < 0.92;
}

/** Speed multiplier for an athlete with `steps` of stagger left, `0` meaning none. */
export function staggerFactor(steps: number): number {
  if (steps <= 0) return 1;
  return 0.45 + 0.55 * (1 - Math.min(1, steps / DRIBBLING.blowByStaggerSteps));
}

function logistic(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
