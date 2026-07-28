/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.2 — Attribute system: budget rules, sandbox flag, random roll
 * @design  05-data-model.md §2.1 (budget, sandbox), §4 (rarity bands)
 *
 * Purpose: the budget is what keeps profiles comparable and the roll is what makes a pull feel
 * like a pull, so both are pinned here — including the property that every roll, at every rarity,
 * lands on a legal spread.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../../../src/engine/rng.ts';
import {
  budgetState,
  clampToCreationRange,
  fitToBudget,
  judgeCreation,
  rarityForTotal,
  rollAttributes,
  rollPhysical,
  rollTraits,
  rollWithinBudget,
  spreadAttributes,
} from '../../../src/athletes/attributes.ts';
import { CREATION, RARITY_BANDS, ROLL } from '../../../src/athletes/tuning.ts';
import { ATTRIBUTE_IDS, RARITIES, attributeTotal } from '../../../src/athletes/types.ts';
import { attributes } from '../../helpers/athletes.ts';

describe('budget', () => {
  it('reports the total, the remainder, and nothing wrong with a legal spread', () => {
    const state = budgetState(attributes(50));
    expect(state.total).toBe(550);
    expect(state.remaining).toBe(CREATION.budget - 550);
    expect(state.withinBudget).toBe(true);
    expect(state.outOfRange).toEqual([]);
    expect(state.requiresSandbox).toBe(false);
  });

  it('shows the overspend as a negative remainder rather than clamping it to zero', () => {
    const state = budgetState(attributes(90));
    expect(state.total).toBe(990);
    expect(state.remaining).toBe(CREATION.budget - 990);
    expect(state.withinBudget).toBe(false);
    expect(state.requiresSandbox).toBe(true);
  });

  it('names the attributes outside the per-attribute range, in spec order', () => {
    const state = budgetState(attributes(50, { speed: 99, discipline: 5 }));
    expect(state.outOfRange).toEqual(['speed', 'discipline']);
    expect(state.withinBudget).toBe(true);
    expect(state.requiresSandbox).toBe(true);
  });

  it('treats the budget as inclusive', () => {
    const exact = attributes(52, { speed: 60 });
    expect(attributeTotal(exact)).toBe(CREATION.budget);
    expect(budgetState(exact).withinBudget).toBe(true);
  });
});

describe('judgeCreation', () => {
  it('allows a legal athlete without marking them sandbox', () => {
    const verdict = judgeCreation(attributes(50), false);
    expect(verdict).toMatchObject({ allowed: true, sandbox: false });
    expect(verdict.reason).toBeUndefined();
  });

  it('refuses an over-budget athlete and says how to save them anyway', () => {
    const verdict = judgeCreation(attributes(90), false);
    expect(verdict.allowed).toBe(false);
    expect(verdict.sandbox).toBe(false);
    expect(verdict.reason).toContain('Sandbox mode');
    expect(verdict.reason).toContain(String(990 - CREATION.budget));
  });

  it('explains the per-attribute range when that is what is wrong', () => {
    const verdict = judgeCreation(attributes(40, { speed: 99 }), false);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain(String(CREATION.attribute.max));
  });

  it('allows either violation in sandbox mode, and flags the result (`05` §2.1)', () => {
    expect(judgeCreation(attributes(90), true)).toMatchObject({ allowed: true, sandbox: true });
    expect(judgeCreation(attributes(40, { speed: 99 }), true)).toMatchObject({
      allowed: true,
      sandbox: true,
    });
  });
});

describe('fitToBudget', () => {
  it('leaves a legal spread alone', () => {
    const legal = attributes(50);
    expect(fitToBudget(legal)).toEqual(legal);
  });

  it('lands exactly on the budget', () => {
    expect(attributeTotal(fitToBudget(attributes(90)))).toBe(CREATION.budget);
  });

  it('preserves the shape — a shooter stays a shooter', () => {
    const shooter = attributes(80, { accuracy: 95, strength: 30 });
    const fitted = fitToBudget(shooter);
    expect(fitted.accuracy).toBeGreaterThan(fitted.speed);
    expect(fitted.strength).toBeLessThan(fitted.speed);
  });

  it('clamps into the editor range on the way', () => {
    const clamped = clampToCreationRange(attributes(50, { speed: 99, agility: 1 }));
    expect(clamped.speed).toBe(CREATION.attribute.max);
    expect(clamped.agility).toBe(CREATION.attribute.min);
  });
});

describe('spreadAttributes', () => {
  it('hits the requested total exactly', () => {
    const rng = createRng('spread');
    for (const total of [400, 550, 640, 720]) {
      expect(attributeTotal(spreadAttributes(rng, total))).toBe(total);
    }
  });

  it('produces a spread rather than eleven identical numbers', () => {
    const rolled = spreadAttributes(createRng('shape'), 550);
    expect(new Set(Object.values(rolled)).size).toBeGreaterThan(3);
  });

  it('clamps an unachievable total to what the bounds can represent', () => {
    const tooHigh = spreadAttributes(createRng('cap'), 5_000);
    expect(attributeTotal(tooHigh)).toBe(ROLL.attribute.max * ATTRIBUTE_IDS.length);
    const tooLow = spreadAttributes(createRng('floor'), 0);
    expect(attributeTotal(tooLow)).toBe(ROLL.attribute.min * ATTRIBUTE_IDS.length);
  });

  it('is reproducible from its seed (INV-2)', () => {
    expect(spreadAttributes(createRng('same'), 550)).toEqual(
      spreadAttributes(createRng('same'), 550),
    );
  });

  it('does not favour the first attribute when spending the rounding remainder', () => {
    // The obvious "give the leftover to the first attribute with room" is a systematic bias
    // toward `speed` — the same shape of bug as tie-breaking in entity-id order.
    const rng = createRng('bias');
    let speedHighest = 0;
    const runs = 300;
    for (let i = 0; i < runs; i++) {
      const rolled = spreadAttributes(rng, 550);
      const best = Math.max(...ATTRIBUTE_IDS.map((id) => rolled[id]));
      if (rolled.speed === best) speedHighest++;
    }
    // One in eleven is 27; anything under 60 is comfortably not a systematic bias.
    expect(speedHighest).toBeLessThan(60);
  });
});

describe('rollAttributes', () => {
  it('lands inside its rarity band for every rarity', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 }),
        fc.constantFrom(...RARITIES),
        (n, rarity) => {
          const total = attributeTotal(rollAttributes(createRng(`roll-${n}`), rarity));
          const band = RARITY_BANDS[rarity];
          return total >= band.totalMin && total <= band.totalMax;
        },
      ),
      { numRuns: 120 },
    );
  });

  it('keeps every attribute on the scale', () => {
    const rng = createRng('scale');
    for (let i = 0; i < 50; i++) {
      const rolled = rollAttributes(rng, 'legendary');
      for (const id of ATTRIBUTE_IDS) {
        expect(rolled[id]).toBeGreaterThanOrEqual(ROLL.attribute.min);
        expect(rolled[id]).toBeLessThanOrEqual(ROLL.attribute.max);
      }
    }
  });

  it('makes a legendary meaningfully better than a common', () => {
    const rng = createRng('gap');
    const common = attributeTotal(rollAttributes(rng, 'common'));
    const legendary = attributeTotal(rollAttributes(rng, 'legendary'));
    expect(legendary).toBeGreaterThan(common);
  });
});

describe('rarityForTotal', () => {
  it('picks the highest band containing the total, since the bands overlap', () => {
    expect(rarityForTotal(600)).toBe('epic');
    expect(rarityForTotal(460)).toBe('uncommon');
    expect(rarityForTotal(400)).toBe('common');
    expect(rarityForTotal(660)).toBe('legendary');
  });

  it('falls off both ends sensibly', () => {
    expect(rarityForTotal(11)).toBe('common');
    expect(rarityForTotal(1_000)).toBe('legendary');
  });
});

describe('rollTraits', () => {
  it("respects each band's trait count", () => {
    const rng = createRng('traits');
    for (const rarity of RARITIES) {
      const band = RARITY_BANDS[rarity];
      for (let i = 0; i < 40; i++) {
        const traits = rollTraits(rng, rarity);
        expect(traits.length).toBeGreaterThanOrEqual(band.traitsMin);
        expect(traits.length).toBeLessThanOrEqual(band.traitsMax);
        expect(new Set(traits).size).toBe(traits.length);
      }
    }
  });

  it('gives a common none and a legendary at least two', () => {
    const rng = createRng('extremes');
    expect(rollTraits(rng, 'common')).toEqual([]);
    expect(rollTraits(rng, 'legendary').length).toBeGreaterThanOrEqual(2);
  });
});

describe('rollPhysical', () => {
  it('stays inside the schema bounds and keeps weight tracking height', () => {
    const rng = createRng('bodies');
    const bodies = Array.from({ length: 200 }, () => rollPhysical(rng));
    for (const body of bodies) {
      expect(body.heightCm).toBeGreaterThanOrEqual(150);
      expect(body.heightCm).toBeLessThanOrEqual(230);
      expect(body.weightKg).toBeGreaterThanOrEqual(45);
      expect(body.weightKg).toBeLessThanOrEqual(160);
      expect(body.age).toBeGreaterThanOrEqual(ROLL.age.min);
      expect(body.age).toBeLessThanOrEqual(ROLL.age.max);
    }

    const tall = bodies.filter((b) => b.heightCm >= ROLL.heightCm.mean);
    const short = bodies.filter((b) => b.heightCm < ROLL.heightCm.mean);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean(tall.map((b) => b.weightKg))).toBeGreaterThan(mean(short.map((b) => b.weightKg)));
  });
});

describe('rollWithinBudget', () => {
  it('always produces something the editor can actually save', () => {
    const rng = createRng('editor-roll');
    for (let i = 0; i < 100; i++) {
      const rolled = rollWithinBudget(rng);
      const verdict = judgeCreation(rolled, false);
      expect(verdict.allowed).toBe(true);
      expect(verdict.sandbox).toBe(false);
      expect(attributeTotal(rolled)).toBe(CREATION.budget);
    }
  });
});
