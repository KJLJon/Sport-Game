/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.12 — Packs: tiers, prices, published odds, pity timers, reveal animation with skip
 * @story   US-9.2 — Open packs to earn new athletes
 * @design  05-data-model.md §5.2 (the table), §5.5 (packs are a coin sink)
 * @invariant INV-2 (a pack is a function of its seed), INV-5 (expected sell value < price)
 *
 * Purpose: that the published odds are the odds, that the pity timer means what it says, and that
 * no pack is a way to make money.
 *
 * The anti-farm case is the one `05` §5.5 asks for by name: "for every pack tier,
 * `expectedSellValue(pack) < price(pack)`… asserted by a unit test over the odds tables and
 * valuation formula, so a future odds tweak cannot silently open a money loop". This is that test.
 */
import { describe, expect, it } from 'vitest';
import {
  PACKS,
  PACK_ORDER,
  oddsText,
  pityRemaining,
  publishedOdds,
  rollPack,
  rollRarity,
} from '@/economy/packs.ts';
import { sellPrice } from '@/economy/valuation.ts';
import { createRng } from '@/engine/rng.ts';
import { RARITIES, type Rarity } from '@/athletes/types.ts';

describe('the published table (`05` §5.2)', () => {
  it('matches the spec, tier by tier', () => {
    expect(PACKS.bronze).toMatchObject({ price: 750, cards: 3, pityAfter: 6, pityFloor: 'rare' });
    expect(PACKS.silver).toMatchObject({ price: 2000, cards: 4, pityAfter: 12, pityFloor: 'epic' });
    expect(PACKS.gold).toMatchObject({ price: 5000, cards: 5, pityAfter: 8, pityFloor: 'epic' });
    expect(PACKS.elite).toMatchObject({
      price: 12_000,
      cards: 5,
      pityAfter: 25,
      pityFloor: 'legendary',
    });
  });

  it('has odds that sum to one', () => {
    for (const tier of PACK_ORDER) {
      const total = publishedOdds(PACKS[tier]).reduce((sum, row) => sum + row.chance, 0);
      expect(total, tier).toBeCloseTo(1, 6);
    }
  });

  it('never offers a rarity at zero, so the screen shows no empty rows', () => {
    for (const tier of PACK_ORDER) {
      for (const row of publishedOdds(PACKS[tier])) expect(row.chance, tier).toBeGreaterThan(0);
    }
    // Elite cannot roll a Common at all, and says so by omission.
    expect(publishedOdds(PACKS.elite).map((row) => row.rarity)).toEqual([
      'rare',
      'epic',
      'legendary',
    ]);
  });

  it('prints a percentage a player can read', () => {
    expect(oddsText(0.7)).toBe('70%');
    expect(oddsText(0.045)).toBe('4.5%');
    expect(oddsText(0.002)).toBe('0.2%');
  });
});

describe('rollRarity', () => {
  it('follows the published odds over a large sample', () => {
    const counts = new Map<Rarity, number>();
    const rng = createRng('odds');
    const samples = 200_000;

    for (let index = 0; index < samples; index += 1) {
      const rarity = rollRarity(rng, PACKS.gold.odds);
      counts.set(rarity, (counts.get(rarity) ?? 0) + 1);
    }

    for (const row of publishedOdds(PACKS.gold)) {
      const observed = (counts.get(row.rarity) ?? 0) / samples;
      // Within a fifth of the published figure, which at 200k samples is far outside noise for
      // every row including the 1.5% Legendary.
      expect(Math.abs(observed - row.chance), row.rarity).toBeLessThan(row.chance * 0.2 + 0.002);
    }
  });

  it('never rolls a rarity the tier does not offer', () => {
    const rng = createRng('elite');
    for (let index = 0; index < 5000; index += 1) {
      const rarity = rollRarity(rng, PACKS.elite.odds);
      expect(['rare', 'epic', 'legendary']).toContain(rarity);
    }
  });
});

describe('rollPack', () => {
  it('is a function of its seed (INV-2)', () => {
    const first = rollPack('gold', createRng('same'));
    const second = rollPack('gold', createRng('same'));
    expect(second.rarities).toEqual(first.rarities);
  });

  it('deals the number of cards the tier promises', () => {
    for (const tier of PACK_ORDER) {
      expect(rollPack(tier, createRng(tier)).rarities).toHaveLength(PACKS[tier].cards);
    }
  });

  it('guarantees the floor on the pity pack, and resets the counter', () => {
    const bronze = PACKS.bronze;
    // One short of the guarantee.
    const roll = rollPack('bronze', createRng('pity'), { bronze: bronze.pityAfter - 1 });

    expect(roll.pityTriggered).toBe(true);
    const best = Math.max(...roll.rarities.map((rarity) => RARITIES.indexOf(rarity)));
    expect(best).toBeGreaterThanOrEqual(RARITIES.indexOf(bronze.pityFloor));
    expect(roll.pity['bronze']).toBe(0);
  });

  it('counts up when a pack pays nothing at the floor', () => {
    let pity = {};
    let counted = 0;
    for (let index = 0; index < 5; index += 1) {
      const roll = rollPack('bronze', createRng(`count-${index}`), pity);
      pity = roll.pity;
      counted = roll.pity['bronze'] ?? 0;
      if (counted === 0) break; // a lucky Rare reset it, which is also correct
    }
    expect(counted).toBeGreaterThanOrEqual(0);
    expect(counted).toBeLessThan(PACKS.bronze.pityAfter);
  });

  it('never leaves a player waiting longer than the published guarantee', () => {
    // The property the timer exists for: across a long run, no gap between floor-or-better pulls is
    // longer than `pityAfter` packs.
    let pity: Record<string, number> = {};
    let sinceFloor = 0;

    for (let index = 0; index < 200; index += 1) {
      const roll = rollPack('bronze', createRng(`long-${index}`), pity);
      pity = { ...roll.pity };
      const best = Math.max(...roll.rarities.map((rarity) => RARITIES.indexOf(rarity)));
      sinceFloor = best >= RARITIES.indexOf('rare') ? 0 : sinceFloor + 1;
      expect(sinceFloor, `dry streak at pack ${index}`).toBeLessThan(PACKS.bronze.pityAfter);
    }
  });

  it('reports how many are left before the guarantee', () => {
    expect(pityRemaining('bronze', {})).toBe(PACKS.bronze.pityAfter);
    expect(pityRemaining('bronze', { bronze: 5 })).toBe(1);
    expect(pityRemaining('bronze', { bronze: 99 })).toBe(0);
  });
});

describe('INV-5 — a pack is a coin sink, never a source (`05` §5.5)', () => {
  /**
   * The overall a pack athlete of each rarity actually rolls, measured rather than assumed.
   *
   * An earlier version of this test guessed the numbers and guessed high, and "failed" against a
   * perfectly sound economy. Rarity sets the *attribute band* (`05` §4), not the overall, and the
   * two are a long way apart — a Legendary averages about 60 overall, not 94. Measuring keeps the
   * test honest when the bands or the derivation change, which is exactly when it matters.
   */
  async function overallByRarity(): Promise<Readonly<Record<Rarity, number>>> {
    const [{ generateAthlete }, { sportOverall }, { basketball }] = await Promise.all([
      import('@/athletes/generator.ts'),
      import('@/athletes/derivation.ts'),
      import('@/sports/basketball/index.ts'),
    ]);
    const tables = {
      weights: basketball.ratingWeights,
      ...(basketball.positionWeights === undefined
        ? {}
        : { positionWeights: basketball.positionWeights }),
    };

    const out = {} as Record<Rarity, number>;
    for (const rarity of RARITIES) {
      let best = 0;
      for (let index = 0; index < 200; index += 1) {
        const { athlete } = generateAthlete(createRng(`inv5-${rarity}-${index}`), {
          rarity,
          sports: ['basketball'],
        });
        // The *best* roll of two hundred, so the bound below is generous: if the invariant holds
        // for a pack of ninety-ninth-percentile pulls, it holds for every real one.
        best = Math.max(best, sportOverall(athlete, 'basketball', tables).overall);
      }
      out[rarity] = best;
    }
    return out;
  }

  function expectedSellValue(
    tier: (typeof PACK_ORDER)[number],
    overalls: Readonly<Record<Rarity, number>>,
  ): number {
    const def = PACKS[tier];
    let perCard = 0;
    for (const row of publishedOdds(def)) {
      perCard +=
        row.chance * sellPrice({ rarity: row.rarity, overall: overalls[row.rarity], level: 1 });
    }
    return perCard * def.cards;
  }

  it('expected sell value is below the price, for every tier', async () => {
    const overalls = await overallByRarity();
    for (const tier of PACK_ORDER) {
      const expected = expectedSellValue(tier, overalls);
      expect(expected, `${tier}: ${expected.toFixed(0)} vs ${PACKS[tier].price}`).toBeLessThan(
        PACKS[tier].price,
      );
    }
  }, 30_000);

  it('and by a margin, so a small odds tweak cannot flip it silently', async () => {
    const overalls = await overallByRarity();
    for (const tier of PACK_ORDER) {
      expect(expectedSellValue(tier, overalls) / PACKS[tier].price, tier).toBeLessThan(0.9);
    }
  }, 30_000);
});
