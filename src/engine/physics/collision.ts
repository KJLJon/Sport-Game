/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.5 — Collision & contact contests weighted by strength/agility
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  04-architecture.md §6, 06-game-design.md §3.1 (contests), 12-quality-and-testing.md §3
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: two athletes cannot occupy the same metre of floor, and when they meet, one of them
 * gets the better of it. Those are separate problems and this module keeps them separate:
 * `resolveCollisions()` is deterministic geometry with no randomness at all, and `contest()` is
 * the seeded, ratings-weighted decision that sports build rebounds, tackles, and post-ups on.
 *
 * Contact here is intentionally soft. Athletes push through each other over a few steps rather
 * than bouncing: real bodies in a sporting contest lean and slide, and impulse-based separation at
 * 60 Hz produces jitter between two athletes who both want the same spot — which is most of a
 * basketball possession.
 */
import type { EntityId, World } from '../world.ts';
import { Flags } from '../world.ts';
import type { Rng } from '../rng.ts';
import { clamp } from './movement.ts';

/**
 * How much of an overlap is corrected per step, `0–1`. Correcting all of it in one step is what
 * makes contact snap; over a few frames it reads as leaning.
 *
 * @spec-ref 06-game-design.md §3.1 — physicality should feel like bodies, not like billiards.
 */
export const CONTACT_STIFFNESS = 0.4;

/**
 * Overlaps smaller than this are left alone — a millimetre of shared floor is invisible, and
 * chasing it costs a correction every step for every touching pair, forever. Separation therefore
 * settles to *within* this tolerance rather than to exactly zero.
 */
export const OVERLAP_EPSILON = 0.001;

/** Applied to `strength` when a contest is about holding ground, `agility` when it is about beating someone to a spot. */
export interface ContestWeights {
  readonly strength: number;
  readonly agility: number;
  /** Positional advantage in `-1 … 1`: who already had the spot. */
  readonly position: number;
}

export interface Contestant {
  readonly id: EntityId;
  /** Derived strength rating, 1–99. */
  readonly strength: number;
  /** Derived agility rating, 1–99. */
  readonly agility: number;
  /**
   * How well placed this contestant is, `-1 … 1`. Sports compute it — box-out position in
   * basketball, body-between-ball-and-opponent in soccer.
   */
  readonly position?: number;
}

export interface ContestResult {
  readonly winner: EntityId;
  readonly loser: EntityId;
  /** The winner's probability going in, `0–1`. Sports use it to scale what follows. */
  readonly probability: number;
  /** How lopsided it was, `0–1`. A near coin-flip produces a scramble; a rout does not. */
  readonly margin: number;
}

/** The default mix: contact is mostly strength, with agility and positioning mattering. */
export const DEFAULT_CONTEST_WEIGHTS: ContestWeights = {
  strength: 0.5,
  agility: 0.3,
  position: 0.2,
};

/**
 * Resolves overlaps between every pair of colliding entities, in one pass over the spatial hash.
 *
 * Corrections are mass-weighted — a 110 kg centre moves a 75 kg guard further than the reverse —
 * and applied positionally rather than as impulses, so velocity keeps expressing intent. Athletes
 * who are still trying to run into each other simply overlap a little; that is what leaning is.
 *
 * Returns how many contacts were resolved, which the sport layer uses to decide whether anything
 * worth an event happened.
 */
export function resolveCollisions(world: World, scratch: Int32Array, maxRadius = 2): number {
  if (!world.isIndexed) world.reindex();

  let contacts = 0;

  world.forEach((a) => {
    if (world.hasFlag(a, Flags.INTANGIBLE) || world.hasFlag(a, Flags.BENCHED)) return;

    const radiusA = world.radius[a] as number;
    const found = world.queryNeighbours(a, radiusA + maxRadius, scratch);

    for (let i = 0; i < found; i++) {
      const b = scratch[i] as number;
      // Each pair is visited twice by a symmetric query; taking only a < b halves the work and,
      // more importantly, makes the result independent of which entity was visited first.
      if (b <= a) continue;
      if (world.hasFlag(b, Flags.INTANGIBLE) || world.hasFlag(b, Flags.BENCHED)) continue;

      if (separatePair(world, a, b)) contacts++;
    }
  });

  if (contacts > 0) world.invalidateIndex();
  return contacts;
}

/** Pushes one overlapping pair apart. Returns whether they were actually overlapping. */
export function separatePair(world: World, a: EntityId, b: EntityId): boolean {
  const dx = (world.x[b] as number) - (world.x[a] as number);
  const dy = (world.y[b] as number) - (world.y[a] as number);
  const minDistance = (world.radius[a] as number) + (world.radius[b] as number);

  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared >= minDistance * minDistance) return false;

  const distance = Math.sqrt(distanceSquared);
  const massA = world.mass[a] as number;
  const massB = world.mass[b] as number;
  const total = massA + massB;

  let nx: number;
  let ny: number;
  let overlap: number;

  if (distance < 1e-6) {
    // Exactly coincident: there is no contact normal to use, so pick one from the entity ids.
    // Deterministic and stable — the alternative is a random direction, which INV-2 forbids and
    // which would make a replay diverge the moment two athletes stack.
    const angle = ((a * 2654435761 + b) % 360) * (Math.PI / 180);
    nx = Math.cos(angle);
    ny = Math.sin(angle);
    overlap = minDistance;
  } else {
    nx = dx / distance;
    ny = dy / distance;
    overlap = minDistance - distance;
  }

  if (overlap < OVERLAP_EPSILON) return false;

  const correction = overlap * CONTACT_STIFFNESS;
  const shareA = total > 0 ? massB / total : 0.5;
  const shareB = total > 0 ? massA / total : 0.5;

  const frozenA = world.hasFlag(a, Flags.FROZEN);
  const frozenB = world.hasFlag(b, Flags.FROZEN);

  // A frozen entity is immovable — a screener holding position, a wall. The mover takes the whole
  // correction rather than the pair sharing it.
  if (!frozenA) {
    const share = frozenB ? 1 : shareA;
    world.x[a] = (world.x[a] as number) - nx * correction * share;
    world.y[a] = (world.y[a] as number) - ny * correction * share;
  }
  if (!frozenB) {
    const share = frozenA ? 1 : shareB;
    world.x[b] = (world.x[b] as number) + nx * correction * share;
    world.y[b] = (world.y[b] as number) + ny * correction * share;
  }

  return true;
}

/** Whether two entities' circles overlap right now. */
export function isOverlapping(world: World, a: EntityId, b: EntityId): boolean {
  const minDistance = (world.radius[a] as number) + (world.radius[b] as number);
  return world.distanceSquared(a, b) < minDistance * minDistance;
}

/**
 * The seeded half: who wins a physical contest.
 *
 * A weighted score per contestant becomes a win probability through a logistic curve, and the
 * `Rng` draws against it. The logistic matters: a linear ratio makes a 99 beat a 50 almost always,
 * which kills upsets and makes low-rated athletes unplayable. Here a 20-point rating edge is worth
 * roughly 65–70%, which is a real advantage that still loses often enough to be worth watching.
 *
 * @spec-ref 06-game-design.md §3.1 — rebounds are contested by height, vertical, strength, box-out
 * position and timing; this is the engine-level core those sport-specific weights plug into.
 */
export function contest(
  a: Contestant,
  b: Contestant,
  rng: Rng,
  weights: ContestWeights = DEFAULT_CONTEST_WEIGHTS,
): ContestResult {
  const scoreA = contestScore(a, weights);
  const scoreB = contestScore(b, weights);

  const probability = logistic(scoreA - scoreB);
  const roll = rng.next();
  const aWins = roll < probability;

  return {
    winner: aWins ? a.id : b.id,
    loser: aWins ? b.id : a.id,
    probability: aWins ? probability : 1 - probability,
    margin: Math.abs(probability - 0.5) * 2,
  };
}

/** The win probability `a` would have, without drawing. Used by AI to decide whether to contest. */
export function contestOdds(
  a: Contestant,
  b: Contestant,
  weights: ContestWeights = DEFAULT_CONTEST_WEIGHTS,
): number {
  return logistic(contestScore(a, weights) - contestScore(b, weights));
}

function contestScore(contestant: Contestant, weights: ContestWeights): number {
  const strength = clamp(contestant.strength, 1, 99);
  const agility = clamp(contestant.agility, 1, 99);
  const position = clamp(contestant.position ?? 0, -1, 1);

  return (
    strength * weights.strength +
    agility * weights.agility +
    // Position is -1…1, scaled to the same 1–99 space so its weight means the same thing.
    position * 49 * weights.position
  );
}

/**
 * Logistic over a rating difference. The divisor sets how decisive ratings are: 25 means a
 * 25-point edge is about 73%, and even a 99-vs-1 mismatch leaves the underdog a couple of percent.
 * Sport-specific certainty (a 7-foot centre out-rebounding a point guard) comes from the weights
 * the sport passes, not from making this curve steeper.
 */
function logistic(difference: number): number {
  return 1 / (1 + Math.exp(-difference / 25));
}
