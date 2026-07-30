/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.8 — Defending: pressure, standing and slide tackles, foul/card risk
 * @story   US-4.3 — Defend and keep goal
 * @design  06-game-design.md §3.2 (fouls, cards), §2 (controls), 05-data-model.md §3.2
 * @invariant INV-1 (difficulty never touches ratings), INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: taking the ball off somebody, and the price of getting it wrong.
 *
 * **This module decides how badly a challenge went. It does not decide cards.** `FoulSeverity` —
 * careless, reckless, excessive — was put in `fouls.ts` for exactly this: T-6.8 rolls the seeded
 * draw that says how the tackle came out, and `commitFoul` turns that into a caution, a dismissal,
 * or nothing. Two modules that both know the card table is one module too many, and it is the kind
 * of duplication that survives right up until the two disagree.
 *
 * **Timing is the whole mechanic.** Not the ratings — the ratings decide how *wide* the window is,
 * and where inside it you swung decides what happens. A well-timed slide from a poor defender beats
 * a wild one from a good defender, which is the only version of tackling that rewards playing
 * rather than having.
 *
 * **A slide tackle is the interesting button because it is the only genuinely dangerous one.** It
 * reaches further, it wins the ball more often when it lands, and it is the only challenge that can
 * reach `excessive` — a straight red. It also commits: the defender is on the ground and out of the
 * play whether or not it worked. Standing tackles cannot be excessive at all, because a standing
 * challenge that hurts someone is a different offence from a mistimed one.
 *
 * **Pressure is computed here and consumed everywhere.** `passing.ts` and `shooting.ts` both take a
 * `pressure` term and neither knows how to work it out; this is where it comes from, so there is
 * one definition of "being closed down" rather than three that drift.
 */
import { contestOdds, type Contestant } from '../../engine/physics/collision.ts';
import type { Rng } from '../../engine/rng.ts';
import type { EntityId } from '../../engine/world.ts';
import type { FoulKind, FoulSeverity } from './fouls.ts';

/** What a defender brings. Both are derived soccer ratings from `05` §3.2. */
export interface TacklerRatings {
  readonly tackling: number;
  readonly marking: number;
}

/** What the carrier brings to keeping it. */
export interface CarrierDefenceRatings {
  readonly dribbling: number;
  readonly pace: number;
}

export type TackleKind = 'standing' | 'slide';

export const DEFENDING = {
  /** Metres at which a defender starts to count as pressure at all. */
  pressureRadius: 6,
  /** How much of full pressure one perfectly positioned defender is worth. */
  soloPressure: 0.7,
  /** Marking scales a defender's contribution by up to this either side of 1. */
  markingSwing: 0.35,

  /** How far a challenge can reach, in metres. */
  standingReach: 1.3,
  slideReach: 2.6,

  /** A slide that lands wins the ball this much more often than a standing one that lands. */
  slideWinBonus: 0.12,
  /** And fouls this much more often when it does not. */
  slideFoulBonus: 0.22,

  /**
   * Closing speed, m/s, above which a challenge is going in hard. Not a foul on its own — a fast,
   * well-timed tackle is the best tackle in the sport — but it is what turns a mistimed one from
   * clumsy into reckless.
   */
  hardChallengeSpeed: 4.5,

  /** Timing below which a challenge cannot win the ball cleanly at all. */
  hopelessTiming: 0.15,
  /** And below which a slide becomes potentially a red card. */
  dangerousTiming: 0.08,
} as const;

/**
 * How closely the carrier is being closed down, `0–1`.
 *
 * Falls off with distance, scales with each defender's `marking`, and accumulates — being
 * surrounded is worse than being marked. Saturating rather than summing, so a fourth defender
 * arriving cannot push it past 1 and make the term meaningless.
 */
export function pressureOn(
  carrier: { x: number; y: number },
  defenders: readonly { x: number; y: number; marking: number }[],
): number {
  let free = 1;
  for (const defender of defenders) {
    const distance = Math.hypot(defender.x - carrier.x, defender.y - carrier.y);
    if (distance >= DEFENDING.pressureRadius) continue;

    const closeness = 1 - distance / DEFENDING.pressureRadius;
    const skill = 1 + DEFENDING.markingSwing * (defender.marking / 100 - 0.5) * 2;
    const share = clamp01(DEFENDING.soloPressure * closeness * skill);
    free *= 1 - share;
  }
  return 1 - free;
}

/** How far the challenge can reach. */
export function tackleReach(kind: TackleKind): number {
  return kind === 'slide' ? DEFENDING.slideReach : DEFENDING.standingReach;
}

/**
 * How well the challenge is placed, `0–1`.
 *
 * `1` is arriving exactly on the ball; `0` is swinging at nothing. This is the number a player is
 * actually playing against — the ratings only decide how forgiving the rest of the model is about
 * it.
 */
export function tackleTiming(distanceToBall: number, kind: TackleKind): number {
  const reach = tackleReach(kind);
  if (distanceToBall >= reach) return 0;
  return 1 - distanceToBall / reach;
}

function contestants(
  tackler: { id: EntityId; ratings: TacklerRatings },
  carrier: { id: EntityId; ratings: CarrierDefenceRatings },
): [Contestant, Contestant] {
  return [
    { id: tackler.id, strength: tackler.ratings.tackling, agility: tackler.ratings.marking },
    { id: carrier.id, strength: carrier.ratings.dribbling, agility: carrier.ratings.pace },
  ];
}

const TACKLE_WEIGHTS = { strength: 0.6, agility: 0.25, position: 0 };

/**
 * The defender's chance of winning the ball cleanly, before the draw.
 *
 * Timing gates it: below `hopelessTiming` no rating saves the challenge, which is what makes a
 * well-timed tackle from a poor defender beat a wild one from a good defender.
 */
export function tackleOdds(
  tackler: { id: EntityId; ratings: TacklerRatings },
  carrier: { id: EntityId; ratings: CarrierDefenceRatings },
  timing: number,
  kind: TackleKind,
): number {
  const placed = clamp01(timing);
  if (placed <= DEFENDING.hopelessTiming) return 0;

  const [a, b] = contestants(tackler, carrier);
  const skill = contestOdds(a, b, TACKLE_WEIGHTS);
  const window = (placed - DEFENDING.hopelessTiming) / (1 - DEFENDING.hopelessTiming);
  const bonus = kind === 'slide' ? DEFENDING.slideWinBonus : 0;
  return clamp01((skill + bonus) * window);
}

export interface TackleOutcome {
  /** The defender came away with the ball. */
  readonly won: boolean;
  /** The offence to hand to `commitFoul`, or `null` for a fair challenge. */
  readonly foul: { kind: FoulKind; severity: FoulSeverity } | null;
  /** The defender is on the ground and out of the play, win or lose. Slides only. */
  readonly committed: boolean;
}

/**
 * Resolves one challenge.
 *
 * Three outcomes, drawn in one pass so the seed spends exactly one value per tackle: the ball is
 * won, the challenge misses cleanly, or it is a foul. A tackle that wins the ball is never a foul
 * here — winning the ball first is the definition of a fair challenge, and the alternative ("won it
 * but caught him afterwards") is a judgement call the model has no honest way to make.
 *
 * `closingSpeed` is the defender's speed relative to the carrier, m/s. It never makes a challenge
 * more likely to foul; it decides how *bad* the foul is when one happens.
 */
export function resolveTackle(
  tackler: { id: EntityId; ratings: TacklerRatings },
  carrier: { id: EntityId; ratings: CarrierDefenceRatings },
  timing: number,
  kind: TackleKind,
  closingSpeed: number,
  rng: Rng,
): TackleOutcome {
  const placed = clamp01(timing);
  const committed = kind === 'slide';
  const odds = tackleOdds(tackler, carrier, placed, kind);

  const roll = rng.next();
  if (roll < odds) return { won: true, foul: null, committed };

  // Missed. Whether that is a foul depends on how badly it was placed, not on the ratings — a good
  // defender does not get to mistime a challenge and have it be nobody's fault.
  const foulChance = clamp01(
    (1 - placed) * (kind === 'slide' ? 0.55 + DEFENDING.slideFoulBonus : 0.45),
  );
  const missRange = Math.max(1 - odds, 1e-6);
  const fouled = (roll - odds) / missRange < foulChance;

  if (!fouled) return { won: false, foul: null, committed };

  return {
    won: false,
    foul: {
      kind: kind === 'slide' ? 'slideTackle' : 'trip',
      severity: severityOf(placed, kind, closingSpeed),
    },
    committed,
  };
}

/**
 * How bad the foul was.
 *
 * The three degrees are the Laws' own, and `fouls.ts` maps them to cards. Only a slide can reach
 * `excessive`, and only when it was both hopelessly placed and going in fast — a standing challenge
 * that hurts someone is a different offence from a mistimed one, and this model has no business
 * inventing it.
 */
export function severityOf(timing: number, kind: TackleKind, closingSpeed: number): FoulSeverity {
  const hard = closingSpeed >= DEFENDING.hardChallengeSpeed;

  if (kind === 'slide' && timing <= DEFENDING.dangerousTiming && hard) return 'excessive';
  if (timing <= DEFENDING.hopelessTiming && hard) return 'reckless';
  if (kind === 'slide' && timing <= DEFENDING.hopelessTiming) return 'reckless';
  return 'careless';
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
