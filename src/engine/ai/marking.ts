/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.3 — Team coordination: formation shape, phase of play, pressing triggers, help defence, transition
 * @story   US-7.1 — Play against the computer
 * @design  06-game-design.md §5 (the Role layer's "marking assignment")
 * @invariant INV-5 (no sport-specific branching in engine core), INV-8 (determinism)
 *
 * Purpose: decides who is picking up whom. One defender per attacker, chosen by distance, and —
 * the part that matters — **kept** from tick to tick unless somebody else is clearly better placed.
 *
 * Re-running a nearest-first match every tick is what produces the defence that looks like it is
 * playing a different sport: two defenders trade marks as an attacker crosses between them, both
 * turn, and the attacker walks through the gap they just made for each other. So a held assignment
 * carries a bonus — a challenger has to be `hysteresis` metres closer before the swap happens —
 * and a swap, once made, is stable for the same reason.
 *
 * Greedy nearest-first rather than optimal (Hungarian) matching, deliberately. Optimal matching
 * minimises total distance, which happily leaves one defender sprinting across the pitch so that
 * two others save a metre each; greedy gives every defender the closest attacker still going
 * spare, which is both cheaper and what a defence actually does.
 */
import type { EntityId } from '../world.ts';

export interface Marker {
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
  /**
   * How willing this one is to pick somebody up at all, `0–1` — the duty's `urgency`. Markers are
   * offered attackers in urgency order, so the role whose job is marking gets first choice over
   * the one who happens to be a metre closer.
   */
  readonly urgency?: number;
}

export interface Markable {
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
  /**
   * How dangerous this attacker is right now, `0–1`. The carrier is `1`; a sport may raise the one
   * in behind the last defender. Danger is matched first, so the ball never goes unmarked because
   * a defender was already busy with somebody standing still.
   */
  readonly danger?: number;
}

/** Who is marking whom: marker id → attacker id. */
export type Marks = ReadonlyMap<EntityId, EntityId>;

export interface MarkOptions {
  /** Last tick's assignments, so a mark can be kept. */
  readonly previous?: Marks;
  /** Metres a challenger must beat the incumbent by before the mark changes hands. */
  readonly hysteresis?: number;
  /** Beyond this, a marker would rather hold its shape than chase. `Infinity` marks regardless. */
  readonly range?: number;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Assigns each marker at most one attacker, and each attacker at most one marker.
 *
 * Markers are served in order of urgency, then of how close their nearest available attacker is,
 * then by id — so the result never depends on the order the sport happened to spawn its athletes
 * in (INV-8). Attackers left over are unmarked, which is a real outcome: five defenders cannot
 * mark six attackers, and the shape has to concede somebody.
 */
export function assignMarks(
  markers: readonly Marker[],
  attackers: readonly Markable[],
  options: MarkOptions = {},
): Map<EntityId, EntityId> {
  const hysteresis = Math.max(0, options.hysteresis ?? 0);
  const range = options.range ?? Number.POSITIVE_INFINITY;
  const previous = options.previous;

  const marks = new Map<EntityId, EntityId>();
  if (markers.length === 0 || attackers.length === 0) return marks;

  // Danger first: whoever has the ball is picked up before anybody argues about the rest.
  const queue = [...attackers].sort(
    (a, b) => (b.danger ?? 0) - (a.danger ?? 0) || Number(a.id) - Number(b.id),
  );
  const taken = new Set<EntityId>();

  for (const attacker of queue) {
    let best: Marker | undefined;
    let bestCost = Number.POSITIVE_INFINITY;

    for (const marker of markers) {
      if (taken.has(marker.id)) continue;

      const gap = distance(marker, attacker);
      if (gap > range) continue;

      // The incumbent's discount is the whole of the stickiness, and it is applied to the *cost*
      // rather than to the comparison so that two incumbents cannot both keep the same attacker.
      const held = previous?.get(marker.id) === attacker.id;
      const eagerness = 1 + (marker.urgency ?? 0.5);
      const cost = (held ? Math.max(0, gap - hysteresis) : gap) / eagerness;

      if (cost < bestCost || (cost === bestCost && best !== undefined && marker.id < best.id)) {
        best = marker;
        bestCost = cost;
      }
    }

    if (best === undefined) continue;
    marks.set(best.id, attacker.id);
    taken.add(best.id);
  }

  return marks;
}

/**
 * Where to stand to mark somebody: on the line between them and the goal being defended, a
 * stand-off in front.
 *
 * In front, not behind. A defender who stands behind their mark has conceded the ball, the turn,
 * and the shot in one decision, and the same geometry is right in every sport this engine carries —
 * which is why it lives here rather than in each of them.
 */
export function goalSideSpot(
  mark: { readonly x: number; readonly y: number },
  goal: { readonly x: number; readonly y: number },
  standoff: number,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  const dx = goal.x - mark.x;
  const dy = goal.y - mark.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) {
    out.x = mark.x;
    out.y = mark.y;
    return out;
  }
  const step = Math.min(standoff, length);
  out.x = mark.x + (dx / length) * step;
  out.y = mark.y + (dy / length) * step;
  return out;
}
