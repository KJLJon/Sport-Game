/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.14 — Transfer market: rotating listings, tamper-resistant refresh, paid refreshes,
 *          buy-offers, seeded price walk
 * @story   US-9.4 — Work the transfer market
 * @design  05-data-model.md §5.4
 * @invariant INV-2 (the board is a function of seed and epoch), INV-5 (an offer never beats an ask)
 *
 * Purpose: the market's three rules — it rotates on a timer, it cannot be farmed by moving the
 * clock, and the same save at the same epoch sees the same board.
 *
 * The tamper case is the one `05` §5.4 writes out in full: "the stored `lastRefresh` only advances,
 * and a jump larger than the refresh interval grants exactly one refresh, not many". Implemented as
 * a `while` loop it would have been a vending machine, so it has its own test.
 */
import { describe, expect, it } from 'vitest';
import {
  LISTING_COUNT,
  OFFER_COUNT,
  PAID_REFRESH_PRICES,
  REFRESH_INTERVAL_MS,
  afterPaidRefresh,
  emptyMarket,
  normaliseMarket,
  paidRefreshPrice,
  refreshDue,
  refreshMarket,
  refreshesOwed,
  rollListingRarity,
  scarceSport,
  withoutListing,
  type MarketState,
} from '@/economy/market.ts';
import { marketAsk, sellPrice, type Valuable } from '@/economy/valuation.ts';
import { createRng } from '@/engine/rng.ts';

const AT = Date.UTC(2026, 7, 6, 12, 0, 0);

const VALUABLE: Valuable = { rarity: 'rare', overall: 62, level: 3 };

function build(state: MarketState = emptyMarket(), now = AT, seed = 'seed'): MarketState {
  return refreshMarket(state, {
    seed,
    now,
    shape: { bySport: { basketball: 8, soccer: 1 }, sports: ['basketball', 'soccer'] },
    valueOfListing: () => VALUABLE,
    owned: [
      { athleteId: 'a1', valuable: VALUABLE },
      { athleteId: 'a2', valuable: VALUABLE },
      { athleteId: 'a3', valuable: VALUABLE },
    ],
  });
}

describe('refreshMarket', () => {
  it('lists six and offers two (`05` §5.4)', () => {
    const market = build();
    expect(market.listings).toHaveLength(LISTING_COUNT);
    expect(market.offers).toHaveLength(OFFER_COUNT);
    expect(market.epoch).toBe(1);
  });

  it('is the same board for the same seed and epoch (INV-2)', () => {
    const first = build();
    const second = build();
    expect(second.listings).toEqual(first.listings);
    expect(second.offers).toEqual(first.offers);
  });

  it('is a different board at the next epoch', () => {
    const first = build();
    const second = build(first, AT + REFRESH_INTERVAL_MS);
    expect(second.epoch).toBe(2);
    expect(second.listings.map((listing) => listing.seed)).not.toEqual(
      first.listings.map((listing) => listing.seed),
    );
  });

  it('is a different board for a different save', () => {
    expect(build(emptyMarket(), AT, 'other').listings).not.toEqual(build().listings);
  });

  it('never offers the same athlete twice in one rotation', () => {
    const ids = build().offers.map((offer) => offer.athleteId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('asks inside `05` §5.1’s band, and never below what selling would pay (INV-5)', () => {
    for (const listing of build().listings) {
      expect(listing.ask).toBeGreaterThanOrEqual(marketAsk(VALUABLE, 0));
      expect(listing.ask).toBeLessThanOrEqual(marketAsk(VALUABLE, 1));
      expect(sellPrice(VALUABLE)).toBeLessThan(listing.ask);
    }
  });

  it('offers less for yours than it asks for the same athlete', () => {
    const market = build();
    const cheapest = Math.min(...market.listings.map((listing) => listing.ask));
    for (const offer of market.offers) expect(offer.coins).toBeLessThan(cheapest);
  });
});

describe('the timer, and the clock it does not trust', () => {
  it('is due immediately when the market has never been built', () => {
    expect(refreshDue(emptyMarket(), AT)).toBe(true);
  });

  it('is not due again until four hours have passed', () => {
    const market = build();
    expect(refreshDue(market, AT + REFRESH_INTERVAL_MS - 1)).toBe(false);
    expect(refreshDue(market, AT + REFRESH_INTERVAL_MS)).toBe(true);
  });

  it('grants exactly one refresh for a jump of a year, not hundreds (`05` §5.4)', () => {
    const market = build();
    const yearLater = AT + 365 * 24 * 60 * 60 * 1000;
    expect(refreshesOwed(market, yearLater)).toBe(1);

    const after = build(market, yearLater);
    expect(after.epoch).toBe(market.epoch + 1);
  });

  it('never moves `lastRefresh` backwards, so winding the clock back earns nothing', () => {
    const market = build();
    const rewound = build(market, AT - 100 * REFRESH_INTERVAL_MS);

    expect(rewound.lastRefresh).toBe(market.lastRefresh);
    // …and with the clock back where it was, the next free refresh is still four hours away.
    expect(refreshDue(rewound, AT + REFRESH_INTERVAL_MS - 1)).toBe(false);
  });
});

describe('paid refreshes', () => {
  it('costs 250, then 500, then 1 000, and then stops', () => {
    let market = emptyMarket();
    const paid: (number | null)[] = [];
    for (let index = 0; index < 4; index += 1) {
      paid.push(paidRefreshPrice(market, '2026-08-06'));
      market = afterPaidRefresh(market, '2026-08-06');
    }
    expect(paid).toEqual([...PAID_REFRESH_PRICES, null]);
  });

  it('resets the next day', () => {
    let market = emptyMarket();
    for (let index = 0; index < 3; index += 1) market = afterPaidRefresh(market, '2026-08-06');
    expect(paidRefreshPrice(market, '2026-08-06')).toBeNull();
    expect(paidRefreshPrice(market, '2026-08-07')).toBe(PAID_REFRESH_PRICES[0]);
  });

  it('does not push the free refresh further away', () => {
    const market = build();
    const paid = afterPaidRefresh(market, '2026-08-06');
    expect(paid.lastRefresh).toBe(market.lastRefresh);
  });
});

describe('scarcity and rarity', () => {
  it('favours the sport the roster is thin in, without guaranteeing it', () => {
    const rng = createRng('scarcity');
    const shape = {
      bySport: { basketball: 40, soccer: 0 },
      sports: ['basketball', 'soccer'] as const,
    };

    let soccer = 0;
    for (let index = 0; index < 400; index += 1) {
      if (scarceSport(rng.fork(`s-${index}`), shape) === 'soccer') soccer += 1;
    }
    expect(soccer).toBeGreaterThan(200); // biased…
    expect(soccer).toBeLessThan(400); // …but not certain
  });

  it('rolls a spread of rarities weighted to the middle', () => {
    const rng = createRng('rarity');
    const counts = new Map<string, number>();
    for (let index = 0; index < 20_000; index += 1) {
      const rarity = rollListingRarity(rng);
      counts.set(rarity, (counts.get(rarity) ?? 0) + 1);
    }
    expect((counts.get('uncommon') ?? 0) / 20_000).toBeCloseTo(0.34, 1);
    expect((counts.get('legendary') ?? 0) / 20_000).toBeLessThan(0.06);
  });
});

describe('board edits and repair', () => {
  it('takes a bought listing off the board and leaves the rest', () => {
    const market = build();
    const first = market.listings[0];
    const after = withoutListing(market, first!.id);
    expect(after.listings).toHaveLength(LISTING_COUNT - 1);
    expect(after.listings.some((listing) => listing.id === first!.id)).toBe(false);
  });

  it('reads a market an older build wrote, and refuses nonsense', () => {
    expect(normaliseMarket(null)).toEqual(emptyMarket());
    expect(normaliseMarket({ epoch: -5, listings: 'nope' })).toEqual(emptyMarket());

    const repaired = normaliseMarket({
      epoch: 3,
      lastRefresh: AT,
      paidDay: '2026-08-06',
      paidToday: 99,
      listings: [{ id: 'x', seed: 's', rarity: 'rare', sport: 'basketball', ask: 100 }, 7],
      offers: [{ athleteId: 'a', coins: 10 }],
    });
    expect(repaired.listings).toHaveLength(1);
    // A stored count above the daily allowance cannot buy extra refreshes.
    expect(repaired.paidToday).toBe(PAID_REFRESH_PRICES.length);
  });
});
