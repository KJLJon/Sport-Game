/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.7 — Defence: marking, contest, steal, block, foul model, free throws
 * @story   US-3.3 — Defend
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  06-game-design.md §3.1 (fouls from approach angle, speed differential, discipline;
 *          free throws), §2 (steal and block on the context buttons),
 *          05-data-model.md §3.1 (perimeterD, interiorD, freeThrow weights)
 * @invariant INV-1 (difficulty never touches ratings), INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: the other half of a possession. Where a defender stands, what they can do about the ball,
 * and what it costs them when they get it wrong.
 *
 * **Every defensive action carries a foul risk, and that is the whole design.** A steal that could
 * only succeed or fail would be free to spam; a steal that can also put the other team on the line
 * is a decision. `06` §3.1 builds the foul from approach angle, speed differential, and
 * `discipline`, and all three appear in `foulChance` for exactly that reason.
 *
 * Zone defence is `06` §3.1's second scheme and belongs with the CPU's scheme selection in T-2.8;
 * what is here is man marking, which is what a scheme is a variation *on*.
 */
import type { Rng } from '../../engine/rng.ts';
import type { EntityId } from '../../engine/world.ts';

/** What a defender brings. `05` §3.1 splits perimeter and interior defence, and so does this. */
export interface DefenderRatings {
  readonly perimeterD: number;
  readonly interiorD: number;
  readonly vertical: number;
  readonly strength: number;
  readonly agility: number;
  readonly discipline: number;
}

/** What the athlete being defended brings to resisting it. */
export interface AttackerRatings {
  readonly ballHandling: number;
  readonly strength: number;
  readonly agility: number;
}

/** What a free-throw shooter brings. */
export interface FreeThrowRatings {
  readonly freeThrow: number;
  readonly composure: number;
}

export const DEFENCE = {
  /** How far off their mark a defender plays, on the perimeter and in the paint. */
  perimeterStandoff: 2.2,
  interiorStandoff: 1.6,
  /** A better perimeter defender can afford to sit closer without being beaten. */
  standoffRelief: 0.25,

  /** Inside this, a defender is boxing out rather than marking. */
  boxOutDistance: 1.0,

  /** Reach for a steal attempt. */
  stealReach: 1.6,
  stealFloor: 0.05,
  stealSpan: 0.42,
  /** Steps before the same defender may try again — a steal is a lunge, not a hold. */
  stealCooldown: 45,

  /** Reach for a block, and how high above the shooter it still counts. */
  blockReach: 2.0,
  blockFloor: 0.02,
  blockSpan: 0.4,
  /** A clean release is much harder to block. */
  blockReleasePenalty: 0.55,

  /**
   * Base foul chance for a badly judged challenge, before discipline and the collision.
   *
   * Tuned down hard from a first guess of 0.3, which produced fifty fouls and ten disqualifications
   * in a headless game — every athlete on the floor fouled out. A whole game should be nearer
   * twenty fouls.
   */
  baseFoul: 0.1,
  /** Discipline buys back this share of it. */
  disciplineRelief: 0.7,
  /** A fast, badly angled challenge multiplies it by up to this. */
  recklessWeight: 1.8,

  /** Free-throw make chance runs between these for the worst and best shooter. */
  freeThrowFloor: 0.35,
  freeThrowSpan: 0.55,
  /** Release quality is worth this much of the chance. */
  freeThrowRelease: 0.18,
} as const;

/**
 * Man assignments: like marks like, by role. Deterministic and cheap, and the thing a scheme
 * (T-2.8) overrides rather than the thing it replaces.
 *
 * Both lists are assumed to be in role order, which is how the module spawns them.
 */
export function assignMarks(
  attackers: readonly EntityId[],
  defenders: readonly EntityId[],
): Map<EntityId, EntityId> {
  const marks = new Map<EntityId, EntityId>();
  for (let i = 0; i < defenders.length; i++) {
    const defender = defenders[i];
    const attacker = attackers[i % Math.max(attackers.length, 1)];
    if (defender !== undefined && attacker !== undefined) marks.set(defender, attacker);
  }
  return marks;
}

/**
 * Where a defender should stand: on the line between their mark and the basket their mark is
 * attacking, a stand-off in front.
 *
 * In front, not behind — the whole point of man defence is to be the thing between an attacker and
 * the rim, and a defender who trails their mark is a defender who has already lost.
 */
export function markingSpot(
  mark: { x: number; y: number },
  basket: { x: number; y: number },
  ratings: DefenderRatings,
  inPaint: boolean,
): { x: number; y: number } {
  const base = inPaint ? DEFENCE.interiorStandoff : DEFENCE.perimeterStandoff;
  const skill = inPaint ? ratings.interiorD : ratings.perimeterD;
  const standoff = base * (1 - DEFENCE.standoffRelief * (skill / 100));

  const dx = basket.x - mark.x;
  const dy = basket.y - mark.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: mark.x, y: mark.y };

  return { x: mark.x + (dx / length) * standoff, y: mark.y + (dy / length) * standoff };
}

/** Where to stand to seal an attacker off the glass: between them and the basket, right on them. */
export function boxOutSpot(
  attacker: { x: number; y: number },
  basket: { x: number; y: number },
): { x: number; y: number } {
  const dx = basket.x - attacker.x;
  const dy = basket.y - attacker.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: attacker.x, y: attacker.y };

  return {
    x: attacker.x + (dx / length) * DEFENCE.boxOutDistance,
    y: attacker.y + (dy / length) * DEFENCE.boxOutDistance,
  };
}

/**
 * Chance of coming away with the ball on a steal attempt.
 *
 * @spec-ref 06-game-design.md §3.3 — "attempt steals and blocks with foul risk"
 */
export function stealChance(
  defender: DefenderRatings,
  carrier: AttackerRatings,
  distance: number,
): number {
  if (distance > DEFENCE.stealReach) return 0;
  const closeness = 1 - distance / DEFENCE.stealReach;
  const edge = (defender.perimeterD - carrier.ballHandling) / 100;
  return clamp(DEFENCE.stealFloor + DEFENCE.stealSpan * closeness * (0.5 + edge), 0, 0.75);
}

/**
 * Chance of getting a hand to a shot. Interior defence and vertical, against a distance that goes
 * up fast and a release that a good shooter gets off clean.
 */
export function blockChance(
  defender: DefenderRatings,
  distance: number,
  releaseQuality: number,
): number {
  if (distance > DEFENCE.blockReach) return 0;
  const closeness = 1 - distance / DEFENCE.blockReach;
  const reach = (defender.interiorD * 0.6 + defender.vertical * 0.4) / 100;
  const clean = 1 - DEFENCE.blockReleasePenalty * clamp01(releaseQuality);
  return clamp(DEFENCE.blockFloor + DEFENCE.blockSpan * closeness * reach * clean, 0, 0.6);
}

/**
 * Whether a challenge is a foul.
 *
 * `06` §3.1's three ingredients, all present: how badly angled the challenge is (`approach`, `0`
 * head-on and `1` across the body), how much faster the defender was travelling
 * (`speedDifferential`), and `discipline`.
 *
 * @spec-ref 06-game-design.md §3.1 — "Fouls come from defender approach angle, speed differential,
 * and discipline"
 */
export function foulChance(
  ratings: DefenderRatings,
  approach: number,
  speedDifferential: number,
): number {
  const control = 1 - DEFENCE.disciplineRelief * (ratings.discipline / 100);
  const reckless =
    1 + DEFENCE.recklessWeight * (clamp01(approach) * 0.6 + clamp01(speedDifferential / 6) * 0.4);
  return clamp(DEFENCE.baseFoul * control * reckless, 0, 0.95);
}

/**
 * How across-the-body a challenge was, `0–1`. A defender moving the same way as the attacker is
 * playing defence; one moving across them is reaching.
 */
export function approachAngle(
  defenderVelocity: { x: number; y: number },
  attackerVelocity: { x: number; y: number },
): number {
  const dLength = Math.hypot(defenderVelocity.x, defenderVelocity.y);
  const aLength = Math.hypot(attackerVelocity.x, attackerVelocity.y);
  if (dLength < 0.2 || aLength < 0.2) return 0;

  const cos =
    (defenderVelocity.x * attackerVelocity.x + defenderVelocity.y * attackerVelocity.y) /
    (dLength * aLength);
  // cos 1 (alongside) → 0; cos −1 (straight into them) → 1.
  return clamp01((1 - cos) / 2);
}

/** Make chance for a free throw. No defender, no distance — just the shooter and their nerve. */
export function freeThrowProbability(
  ratings: FreeThrowRatings,
  release: number,
  pressure = 0,
): number {
  const skill = DEFENCE.freeThrowFloor + DEFENCE.freeThrowSpan * (ratings.freeThrow / 100);
  const timing = 1 - DEFENCE.freeThrowRelease * (1 - clamp01(release));
  const nerve = 1 - clamp01(pressure) * 0.12 * (1 - ratings.composure / 100);
  return clamp(skill * timing * nerve, 0.05, 0.98);
}

/** A steal attempt's outcome. */
export const StealResult = {
  STOLEN: 'stolen',
  FOULED: 'fouled',
  MISSED: 'missed',
} as const;
export type StealResultName = (typeof StealResult)[keyof typeof StealResult];

/**
 * Resolves a steal. Order matters: the ball first, the whistle second — a defender who gets the
 * ball cleanly has not fouled, however fast they arrived.
 */
export function resolveSteal(
  defender: DefenderRatings,
  carrier: AttackerRatings,
  distance: number,
  approach: number,
  speedDifferential: number,
  rng: Rng,
): StealResultName {
  if (rng.bool(stealChance(defender, carrier, distance))) return StealResult.STOLEN;
  if (rng.bool(foulChance(defender, approach, speedDifferential))) return StealResult.FOULED;
  return StealResult.MISSED;
}

/** A block attempt's outcome. Same order, same reason. */
export const BlockResult = {
  BLOCKED: 'blocked',
  FOULED: 'fouled',
  MISSED: 'missed',
} as const;
export type BlockResultName = (typeof BlockResult)[keyof typeof BlockResult];

export function resolveBlock(
  defender: DefenderRatings,
  distance: number,
  releaseQuality: number,
  approach: number,
  speedDifferential: number,
  rng: Rng,
): BlockResultName {
  if (rng.bool(blockChance(defender, distance, releaseQuality))) return BlockResult.BLOCKED;
  // A challenge on a shooter is judged harder than one on a dribbler.
  if (rng.bool(foulChance(defender, approach, speedDifferential) * 0.8)) return BlockResult.FOULED;
  return BlockResult.MISSED;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
