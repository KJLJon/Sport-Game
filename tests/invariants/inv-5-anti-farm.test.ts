/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.13 — Sell-back: valuation, squad-lock guard, confirmation, anti-farm invariants
 * @story   US-9.3 — Sell athletes for coins
 * @design  05-data-model.md §5.1 (the formulas), §5.5 (the anti-farm invariant)
 * @invariant INV-5 — `sellPrice < marketAsk` for the same athlete, so there is no buy-low-sell-high
 *            loop; and the valuation is monotonic in the things it claims to price
 *
 * Purpose: that the economy is closed.
 *
 * `05` §5.5 states the rule in one line — "sellPrice < marketAsk for the same athlete, closing the
 * buy-low-sell-high loop" — and it is exactly the kind of rule a later tuning pass can break by
 * moving one constant. So it is checked across every rarity, every plausible overall, every level,
 * and the *cheapest* ask the market can produce, rather than at a couple of sample points.
 *
 * The pack half of §5.5 — expected sell value below pack price — is asserted in T-8.12's own test,
 * where the odds tables live. This file owns the athlete-level half.
 */
import { describe, expect, it } from 'vitest';
import {
  ASK_RANGE,
  OFFER_RANGE,
  SELL_FRACTION,
  buyOffer,
  marketAsk,
  minimumAsk,
  round10,
  sellPrice,
  valueOf,
  type Valuable,
} from '../../src/economy/valuation.ts';
import { RARITIES } from '../../src/athletes/types.ts';

/** A wide sweep: every rarity, overalls from bad to superhuman, and the full level range. */
function everyAthlete(): Valuable[] {
  const subjects: Valuable[] = [];
  for (const rarity of RARITIES) {
    for (let overall = 30; overall <= 99; overall += 1) {
      for (const level of [1, 5, 10, 20]) subjects.push({ rarity, overall, level });
    }
  }
  return subjects;
}

describe('INV-5 — buying and selling back is always a loss', () => {
  it('sellPrice is below the cheapest the market could ever ask, for every athlete', () => {
    for (const subject of everyAthlete()) {
      const sell = sellPrice(subject);
      const ask = minimumAsk(subject);
      // `round10` can round a small value to the same step from both sides, so the rule is stated
      // as "never more", with the strict version asserted below where the numbers are meaningful.
      expect(sell, `${subject.rarity} ${subject.overall} L${subject.level}`).toBeLessThanOrEqual(
        ask,
      );
    }
  });

  it('is a strict loss for any athlete worth more than a rounding step', () => {
    for (const subject of everyAthlete()) {
      if (valueOf(subject) < 100) continue;
      expect(sellPrice(subject), `${subject.rarity} ${subject.overall}`).toBeLessThan(
        minimumAsk(subject),
      );
    }
  });

  it('a buy-offer for one of yours never beats what the market would charge for them', () => {
    for (const subject of everyAthlete()) {
      // The best offer against the worst ask: still a loss to flip.
      expect(buyOffer(subject, 1)).toBeLessThanOrEqual(marketAsk(subject, 1));
    }
  });

  it('the bands themselves cannot overlap the sell fraction', () => {
    // The structural version of the same rule: if a later tuning pass lifts `SELL_FRACTION` above
    // the bottom of the ask band, every case above would fail one at a time. This says why.
    expect(SELL_FRACTION).toBeLessThan(ASK_RANGE[0]);
    expect(OFFER_RANGE[1]).toBeLessThan(ASK_RANGE[1]);
  });
});

describe('valuation is monotonic in what it prices (`05` §5.1)', () => {
  it('rises with overall', () => {
    for (const rarity of RARITIES) {
      let previous = 0;
      for (let overall = 30; overall <= 99; overall += 1) {
        const value = valueOf({ rarity, overall, level: 1 });
        expect(value, `${rarity} at ${overall}`).toBeGreaterThan(previous);
        previous = value;
      }
    }
  });

  it('rises with rarity at the same overall', () => {
    let previous = 0;
    for (const rarity of RARITIES) {
      const value = valueOf({ rarity, overall: 70, level: 1 });
      expect(value, rarity).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('rises with level, and only modestly', () => {
    const one = valueOf({ rarity: 'rare', overall: 70, level: 1 });
    const twenty = valueOf({ rarity: 'rare', overall: 70, level: 20 });
    expect(twenty).toBeGreaterThan(one);
    // `1 + 0.02 × level`: level 20 is 40% more than level 0, never a different order of magnitude.
    expect(twenty / one).toBeLessThan(1.5);
  });

  it('is worth its rarity base at the pivot overall', () => {
    // The sanity check on the formula's shape: a 60-overall level-0 athlete is worth exactly base.
    expect(valueOf({ rarity: 'common', overall: 60, level: 0 })).toBeCloseTo(200);
    expect(valueOf({ rarity: 'legendary', overall: 60, level: 0 })).toBeCloseTo(8000);
  });

  it('prices in whole tens, and never below zero', () => {
    expect(round10(0)).toBe(0);
    expect(round10(-500)).toBe(0);
    expect(round10(104)).toBe(100);
    expect(round10(105)).toBe(110);
    for (const subject of everyAthlete()) expect(sellPrice(subject) % 10).toBe(0);
  });
});
