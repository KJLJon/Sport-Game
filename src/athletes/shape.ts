/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.11 — Procedural athlete generator: rarity-coherent attribute spreads
 * @task    T-7.9 — CPU team generation (this function's first caller)
 * @story   US-9.2 — Open packs to earn new athletes
 * @design  05-data-model.md §2 (attributes), §4 (rarity bands)
 * @invariant INV-1 (coherence decides the *shape* of a spread and never its *size*)
 *
 * Purpose: moves an athlete's points towards a set of attributes without changing how many points
 * there are.
 *
 * **Written for T-7.9 and moved here by T-8.11**, when a second caller appeared. It lived in
 * `teams/cpu-team.ts` while its only use was shaping an opponent to a team style; a pack rolling an
 * archetype wants exactly the same operation, and a copy in `athletes/` would have been two
 * implementations of the one function INV-1 rests on. `cpu-team.ts` re-exports it, so nothing that
 * imported it from there had to change.
 */
import {
  ATHLETE_BOUNDS,
  ATTRIBUTE_IDS,
  attributeTotal,
  clamp,
  type AttributeId,
  type Attributes,
} from './types.ts';

/**
 * Moves an athlete's points towards what the style wants, **without changing how many there are**.
 *
 * This is the whole of the INV-1 argument in one function: `coherence` decides the *shape* of a
 * spread and can never decide its *size*. A Legend opponent's centre-back is not a better athlete
 * than a Rookie opponent's, they are a better centre-back — which is a thing a player can see, and
 * a thing they can beat.
 *
 * Points are taken proportionally from what the style does not want and given proportionally to
 * what it does, which keeps the whole spread inside the attribute bounds without special cases and
 * leaves an athlete who is already shaped that way untouched.
 */
export function shapeToward(
  attributes: Attributes,
  wants: readonly AttributeId[],
  coherence: number,
): Attributes {
  const pull = clamp(coherence, 0, 1);
  if (pull === 0 || wants.length === 0 || wants.length === ATTRIBUTE_IDS.length) return attributes;

  const wanted = new Set<AttributeId>(wants);
  const rest = ATTRIBUTE_IDS.filter((id) => !wanted.has(id));

  // What the unwanted attributes can spare, and what the wanted ones can hold. The move is bounded
  // by *both*: taking more than the style can absorb would pile every spare point onto whichever
  // attribute had room, which is a caricature rather than a team — a style should be recognisable,
  // not a spike.
  const room = rest.reduce(
    (total, id) => total + (attributes[id] - ATHLETE_BOUNDS.attribute.min),
    0,
  );
  const headroom = wants.reduce(
    (total, id) => total + (ATHLETE_BOUNDS.attribute.max - attributes[id]),
    0,
  );
  const moved = Math.min(room, headroom) * pull * MAX_RESHAPE;
  if (moved <= 0) return attributes;

  const result = { ...attributes } as Record<AttributeId, number>;

  for (const id of rest) {
    const share = (attributes[id] - ATHLETE_BOUNDS.attribute.min) / room;
    result[id] = attributes[id] - moved * share;
  }
  for (const id of wants) {
    const share = (ATHLETE_BOUNDS.attribute.max - attributes[id]) / headroom;
    result[id] = attributes[id] + moved * share;
  }

  return settle(result, attributeTotal(attributes));
}

/**
 * How much of the available room a fully coherent team may move. Well under half, deliberately: an
 * opponent whose every athlete is a spike is not a coherent team, it is a gimmick, and it would
 * also make the style unbeatable rather than recognisable.
 */
const MAX_RESHAPE = 0.45;

/**
 * Rounds to whole attributes and puts back whatever rounding cost, so the total is *exactly* what
 * it was. Without this the invariant test would pass on average and fail on a seed.
 */
function settle(draft: Record<AttributeId, number>, target: number): Attributes {
  const rounded = {} as Record<AttributeId, number>;
  for (const id of ATTRIBUTE_IDS) {
    rounded[id] = Math.round(
      clamp(draft[id], ATHLETE_BOUNDS.attribute.min, ATHLETE_BOUNDS.attribute.max),
    );
  }

  let drift = target - attributeTotal(rounded as Attributes);
  // Spread the rounding residue one point at a time over the attributes that have room for it, so
  // no single attribute absorbs a correction big enough to change the shape.
  for (let guard = 0; drift !== 0 && guard < ATTRIBUTE_IDS.length * 4; guard += 1) {
    for (const id of ATTRIBUTE_IDS) {
      if (drift === 0) break;
      const next = rounded[id] + Math.sign(drift);
      if (next < ATHLETE_BOUNDS.attribute.min || next > ATHLETE_BOUNDS.attribute.max) continue;
      rounded[id] = next;
      drift -= Math.sign(drift);
    }
  }

  return rounded as Attributes;
}
