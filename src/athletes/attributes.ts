/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.2 — Attribute system: the eleven attributes, budget rules, sandbox flag, random roll
 * @story   US-5.1 — Create an athlete profile
 * @design  05-data-model.md §2.1 (creation budget, sandbox), §4 (rarity bands and traits)
 * @invariant INV-2 (seeded PRNG only — the roll is reproducible from its seed)
 *
 * Purpose: the rules about attribute *values* — what the editor may set, what the budget allows,
 * when an athlete becomes a sandbox athlete, and how a rolled athlete's eleven numbers are drawn.
 *
 * The budget is the reason profiles stay comparable, so it is stated once here and every creation
 * path is made to come through it. Sandbox is not an error state: `05` §2.1 is explicit that the
 * "make Messi" fantasy stays fully available, and the cost is a flag that keeps such an athlete
 * out of the contexts where comparability matters. Refusing to build them would be the wrong call.
 */
import type { Rng } from '../engine/rng.ts';
import { CREATION, RARITY_BANDS, ROLL } from './tuning.ts';
import {
  ATTRIBUTE_IDS,
  RARITIES,
  TRAIT_IDS,
  clamp,
  attributeTotal,
  type AttributeId,
  type Attributes,
  type Rarity,
  type TraitId,
} from './types.ts';

/**
 * `Rng.int` is half-open — `int(0, 1)` is the constant zero. Every inclusive draw in this module
 * goes through here so that trap is spelled out once rather than re-made at each call site.
 */
function intInclusive(rng: Rng, min: number, max: number): number {
  return max <= min ? min : rng.int(min, max + 1);
}

/** What the profile editor's live budget meter shows (US-5.1). */
export interface BudgetState {
  readonly total: number;
  readonly budget: number;
  /** Negative once the athlete is over budget — the meter shows the overspend, not zero. */
  readonly remaining: number;
  readonly withinBudget: boolean;
  /** Attributes outside the editor's per-attribute range, in spec order. */
  readonly outOfRange: readonly AttributeId[];
  /** True when saving this spread would produce a sandbox athlete (`05` §2.1). */
  readonly requiresSandbox: boolean;
}

export function budgetState(attributes: Attributes): BudgetState {
  const total = attributeTotal(attributes);
  const outOfRange = ATTRIBUTE_IDS.filter((id) => {
    const value = attributes[id];
    return value < CREATION.attribute.min || value > CREATION.attribute.max;
  });
  const withinBudget = total <= CREATION.budget;

  return {
    total,
    budget: CREATION.budget,
    remaining: CREATION.budget - total,
    withinBudget,
    outOfRange,
    requiresSandbox: !withinBudget || outOfRange.length > 0,
  };
}

/**
 * The decision the editor's Save button makes. Over budget with sandbox mode off is the only
 * refusal, and it is a refusal to *save silently* — the UI's answer is to offer sandbox mode, not
 * to discard the athlete.
 */
export interface CreationVerdict {
  readonly allowed: boolean;
  readonly sandbox: boolean;
  readonly budget: BudgetState;
  /** Present only when `allowed` is false; plain enough to show as-is. */
  readonly reason?: string;
}

export function judgeCreation(attributes: Attributes, sandboxMode: boolean): CreationVerdict {
  const budget = budgetState(attributes);
  if (!budget.requiresSandbox) return { allowed: true, sandbox: false, budget };

  if (sandboxMode) return { allowed: true, sandbox: true, budget };

  const reason = !budget.withinBudget
    ? `Over the ${CREATION.budget}-point budget by ${budget.total - CREATION.budget}. ` +
      'Turn on Sandbox mode in Settings to save anyway.'
    : `Every attribute must be between ${CREATION.attribute.min} and ${CREATION.attribute.max}. ` +
      'Turn on Sandbox mode in Settings to go outside that.';

  return { allowed: false, sandbox: false, budget, reason };
}

/** Clamps a spread into the editor's per-attribute range without touching the total rule. */
export function clampToCreationRange(attributes: Attributes): Attributes {
  const result = {} as Record<AttributeId, number>;
  for (const id of ATTRIBUTE_IDS) {
    result[id] = Math.round(clamp(attributes[id], CREATION.attribute.min, CREATION.attribute.max));
  }
  return result;
}

/**
 * Scales a spread down proportionally until it fits the budget. This is the editor's "fit to
 * budget" action: it preserves the shape the user built — a shooter stays a shooter — rather than
 * trimming whichever attribute happens to be highest.
 */
export function fitToBudget(attributes: Attributes): Attributes {
  const clamped = clampToCreationRange(attributes);
  const total = attributeTotal(clamped);
  if (total <= CREATION.budget) return clamped;

  const floor = CREATION.attribute.min * ATTRIBUTE_IDS.length;
  // Scale only the headroom above the floor: the floor is not the user's to spend.
  const scale = (CREATION.budget - floor) / (total - floor);

  const scaled = {} as Record<AttributeId, number>;
  for (const id of ATTRIBUTE_IDS) {
    scaled[id] = Math.round(
      CREATION.attribute.min + (clamped[id] - CREATION.attribute.min) * scale,
    );
  }

  return settleToTotal(scaled, CREATION.budget, CREATION.attribute, null);
}

/**
 * Nudges a spread by ±1 until it sums to exactly `target`, respecting `bounds`.
 *
 * Rounding always leaves a few points unaccounted for, and where those points land matters: the
 * obvious "give them to the first attribute with room" is a systematic bias toward `speed`, which
 * is the same shape of bug as tie-breaking in entity-id order. With an `rng` the choice is a
 * seeded draw; without one — the editor's fit-to-budget, which must not consume the sim's
 * randomness — it walks the attributes in turn, spreading the correction evenly instead.
 */
function settleToTotal(
  attributes: Record<AttributeId, number>,
  target: number,
  bounds: { readonly min: number; readonly max: number },
  rng: Rng | null,
): Attributes {
  const result = { ...attributes };
  let cursor = 0;

  for (let guard = 0; guard < 10_000; guard++) {
    const total = attributeTotal(result);
    if (total === target) break;
    const step = total < target ? 1 : -1;

    const movable = ATTRIBUTE_IDS.filter((id) =>
      step > 0 ? result[id] < bounds.max : result[id] > bounds.min,
    );
    if (movable.length === 0) break;

    const id =
      rng === null
        ? (movable[cursor++ % movable.length] as AttributeId)
        : (rng.pick(movable) as AttributeId);
    result[id] += step;
  }

  return result;
}

/**
 * Draws eleven attributes summing to `total`, shaped rather than flat.
 *
 * Every value is drawn around the average and then corrected, so the total is exact and the spread
 * is real. `total` is clamped to what the bounds can actually represent — a caller asking for 900
 * across eleven attributes capped at 99 gets the closest achievable spread rather than a silent
 * infinite loop.
 */
export function spreadAttributes(
  rng: Rng,
  total: number,
  bounds: { readonly min: number; readonly max: number } = ROLL.attribute,
): Attributes {
  const count = ATTRIBUTE_IDS.length;
  const target = Math.round(clamp(total, bounds.min * count, bounds.max * count));
  const mean = target / count;

  const drawn = {} as Record<AttributeId, number>;
  for (const id of ATTRIBUTE_IDS) {
    drawn[id] = Math.round(clamp(rng.gaussian(mean, ROLL.spread), bounds.min, bounds.max));
  }

  return settleToTotal(drawn, target, bounds, rng);
}

/** A seeded roll for a rarity band (`05` §4). The band sets the range; the shape is the draw. */
export function rollAttributes(rng: Rng, rarity: Rarity): Attributes {
  const band = RARITY_BANDS[rarity];
  return spreadAttributes(rng, intInclusive(rng, band.totalMin, band.totalMax));
}

/**
 * The rarity an attribute total implies, used when a roster file omits it (`05` §8) and to label
 * a created athlete. The bands overlap, so the highest one containing the total wins — a 600 is
 * an Epic rather than the weakest possible Rare.
 */
export function rarityForTotal(total: number): Rarity {
  for (let index = RARITIES.length - 1; index >= 0; index--) {
    const rarity = RARITIES[index] as Rarity;
    const band = RARITY_BANDS[rarity];
    if (total >= band.totalMin && total <= band.totalMax) return rarity;
  }
  // Outside every band: below the floor is Common, above the ceiling is Legendary.
  return total > RARITY_BANDS.legendary.totalMax ? 'legendary' : 'common';
}

/** Trait count and identities for a rarity (`05` §4). Never duplicates a trait. */
export function rollTraits(rng: Rng, rarity: Rarity): TraitId[] {
  const band = RARITY_BANDS[rarity];
  const count = Math.min(intInclusive(rng, band.traitsMin, band.traitsMax), TRAIT_IDS.length);
  return rng.shuffle([...TRAIT_IDS]).slice(0, count);
}

/** A body for a rolled athlete, weight tracking height so the numbers read as one person. */
export function rollPhysical(rng: Rng): {
  heightCm: number;
  weightKg: number;
  age: number;
} {
  const heightCm = Math.round(
    clamp(rng.gaussian(ROLL.heightCm.mean, ROLL.heightCm.spread), 150, 230),
  );
  const expected = ROLL.weightKg.mean + (heightCm - ROLL.heightCm.mean) * ROLL.weightKg.perCm;
  const weightKg = Math.round(clamp(rng.gaussian(expected, ROLL.weightKg.spread), 45, 160));
  return { heightCm, weightKg, age: intInclusive(rng, ROLL.age.min, ROLL.age.max) };
}

/**
 * The editor's "roll" button: a spread that lands on budget and inside the editor's per-attribute
 * range, so rolling never hands the user something they would then have to be told they cannot
 * save.
 */
export function rollWithinBudget(rng: Rng): Attributes {
  return spreadAttributes(rng, CREATION.budget, CREATION.attribute);
}
