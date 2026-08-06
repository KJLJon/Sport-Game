/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.14 — Transfer market: rotating listings, tamper-resistant refresh, paid refreshes,
 *          buy-offers, seeded price walk
 * @story   US-9.4 — Work the transfer market
 * @design  05-data-model.md §5.4 (the market), §5.1 (prices), §5.5 (anti-farm)
 * @invariant INV-2 (seeded PRNG only — the market is a function of its seed and its epoch),
 *            INV-5 (`sellPrice < marketAsk`, so flipping is always a loss)
 *
 * Purpose: the offline transfer market — what is for sale, what somebody will pay for yours, and
 * when any of it changes.
 *
 * **A listing is a seed, not an athlete.** Storing six generated athletes in the wallet record would
 * be a few kilobytes of duplicated roster written every four hours; storing the seed they were rolled
 * from is thirty bytes and produces the same athlete every time (INV-2). The screen regenerates them
 * to display, the buy regenerates the one being bought, and they are byte-identical because the roll
 * is deterministic.
 *
 * **The clock is not trusted, and the rule is one refresh per jump.** `05` §5.4: "the stored
 * `lastRefresh` only advances, and a jump larger than the refresh interval grants exactly one
 * refresh, not many". So a player who sets their device forward a year gets one new market, and a
 * player who sets it *backwards* gets nothing at all — `lastRefresh` never moves back, so the next
 * genuine four hours still have to pass.
 *
 * **The price walk is anchored, not free.** Each epoch's ask is a seeded draw inside `05` §5.1's
 * `0.90–1.35` band around the athlete's own value, nudged by how thin the roster is in that sport.
 * It is a *walk* in the sense that it moves every epoch; it is anchored in the sense that it cannot
 * drift away from value, because a market that wandered would eventually undercut `sellPrice` and
 * break INV-5.
 */
import { createRng, type Rng } from '../engine/rng.ts';
import { RARITIES, type Rarity } from '../athletes/types.ts';
import type { SportId } from '../sports/types.ts';
import { buyOffer, marketAsk, type Valuable } from './valuation.ts';

/** `05` §5.4 — six listings. */
export const LISTING_COUNT = 6;

/** …and two buy-offers for athletes you own, on the same timer. */
export const OFFER_COUNT = 2;

/** Four hours, in milliseconds. */
export const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** `05` §5.4 — up to three paid manual refreshes per day, at these prices in order. */
export const PAID_REFRESH_PRICES: readonly number[] = [250, 500, 1000];

/** One athlete on sale. The athlete itself is regenerated from `seed`. */
export interface MarketListing {
  readonly id: string;
  /** The seed the athlete is rolled from. Same seed, same athlete, forever (INV-2). */
  readonly seed: string;
  readonly rarity: Rarity;
  readonly sport: SportId;
  readonly ask: number;
}

/** Somebody wants one of yours. */
export interface BuyOffer {
  readonly athleteId: string;
  readonly coins: number;
}

export interface MarketState {
  /** How many refreshes have happened. The listings are a function of this and the market seed. */
  readonly epoch: number;
  /** When the last refresh happened. Only ever advances (`05` §5.4). */
  readonly lastRefresh: number;
  /** The UTC day the paid refreshes below were bought on. */
  readonly paidDay: string | null;
  readonly paidToday: number;
  readonly listings: readonly MarketListing[];
  readonly offers: readonly BuyOffer[];
}

export function emptyMarket(): MarketState {
  return { epoch: 0, lastRefresh: 0, paidDay: null, paidToday: 0, listings: [], offers: [] };
}

/** True when four hours have passed since the last refresh — or the market has never been built. */
export function refreshDue(state: MarketState, now: number): boolean {
  return state.listings.length === 0 || now - state.lastRefresh >= REFRESH_INTERVAL_MS;
}

/**
 * What the next paid refresh costs, or `null` when today's three are spent (`05` §5.4).
 *
 * The day is passed in rather than read from the clock, because the caller already knows it and
 * because a function that asked the device what day it was would be one more thing to tamper with.
 */
export function paidRefreshPrice(state: MarketState, day: string): number | null {
  const used = state.paidDay === day ? state.paidToday : 0;
  return PAID_REFRESH_PRICES[used] ?? null;
}

/** What the roster is short of: sports with fewer athletes get their listings favoured. */
export interface RosterShape {
  /** Sport → how many athletes the player has whose primary sport it is. */
  readonly bySport: Readonly<Partial<Record<SportId, number>>>;
  /** Every sport a listing may be rolled for. */
  readonly sports: readonly SportId[];
}

/**
 * Which sport a listing is rolled for, biased towards what the roster is thin in.
 *
 * `05` §5.4 asks for scarcity "at positions your roster is thin at". Positions are a sport's own
 * vocabulary and a market that reasoned about them would need every sport's role table; sport-level
 * thinness is the same idea at the granularity this build can express honestly, and it is the one a
 * player actually feels — a squad that cannot field a soccer XI is offered soccer players.
 */
export function scarceSport(rng: Rng, shape: RosterShape): SportId {
  const sports = shape.sports;
  const fallback = sports[0] as SportId;
  if (sports.length <= 1) return fallback;

  // Weight is inverse to how many you already have, so an empty sport is roughly twice as likely as
  // a well-stocked one rather than certain — the market is biased, not a vending machine.
  const weights = sports.map((sport) => 1 / (1 + (shape.bySport[sport] ?? 0) / 8));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  let roll = rng.next() * total;
  for (let index = 0; index < sports.length; index += 1) {
    roll -= weights[index] ?? 0;
    if (roll < 0) return sports[index] as SportId;
  }
  return fallback;
}

/** The rarity spread the market offers. Weighted towards the middle: a market of Commons is dull. */
export const LISTING_ODDS: Readonly<Record<Rarity, number>> = {
  common: 0.24,
  uncommon: 0.34,
  rare: 0.28,
  epic: 0.11,
  legendary: 0.03,
};

export function rollListingRarity(rng: Rng): Rarity {
  let roll = rng.next();
  for (const rarity of RARITIES) {
    roll -= LISTING_ODDS[rarity];
    if (roll < 0) return rarity;
  }
  return 'uncommon';
}

export interface RefreshOptions {
  /** The save's own market seed, so two installs do not see the same shop. */
  readonly seed: string;
  readonly now: number;
  readonly shape: RosterShape;
  /** What each listed athlete would be worth, once generated. Supplied by the caller. */
  readonly valueOfListing: (listing: Omit<MarketListing, 'ask'>) => Valuable;
  /** Athletes the player owns, with what they are worth — the pool buy-offers are drawn from. */
  readonly owned: readonly { readonly athleteId: string; readonly valuable: Valuable }[];
}

/**
 * The market at the next epoch.
 *
 * Everything is forked by label from `seed:epoch`, so the same save at the same epoch always sees
 * the same shop — which is what makes the whole thing testable and what stops a reload being a
 * reroll.
 */
export function refreshMarket(state: MarketState, options: RefreshOptions): MarketState {
  const epoch = state.epoch + 1;
  const root = createRng(`${options.seed}:${epoch}`);

  const listings: MarketListing[] = [];
  for (let index = 0; index < LISTING_COUNT; index += 1) {
    const rng = root.fork(`listing-${index}`);
    const rarity = rollListingRarity(rng.fork('rarity'));
    const sport = scarceSport(rng.fork('sport'), options.shape);
    const partial = {
      id: `${epoch}-${index}`,
      seed: `${options.seed}:${epoch}:${index}`,
      rarity,
      sport,
    };
    listings.push({
      ...partial,
      ask: marketAsk(options.valueOfListing(partial), rng.fork('price').next()),
    });
  }

  const offers: BuyOffer[] = [];
  if (options.owned.length > 0) {
    const pool = [...options.owned];
    const picker = root.fork('offers');
    for (let index = 0; index < Math.min(OFFER_COUNT, pool.length); index += 1) {
      const chosen = picker.fork(`pick-${index}`).int(0, pool.length);
      const entry = pool.splice(chosen, 1)[0];
      if (entry === undefined) continue;
      offers.push({
        athleteId: entry.athleteId,
        coins: buyOffer(entry.valuable, picker.fork(`price-${index}`).next()),
      });
    }
  }

  return {
    epoch,
    // Only ever forward. A device clock set backwards leaves this where it was, so the next genuine
    // four hours still have to pass (`05` §5.4).
    lastRefresh: Math.max(state.lastRefresh, options.now),
    paidDay: state.paidDay,
    paidToday: state.paidToday,
    listings,
    offers,
  };
}

/**
 * The market after a *paid* refresh: a new epoch, and one of today's three used up.
 *
 * The timer is not reset by a paid refresh — buying a reroll should not push the free one four
 * hours away, or the paid refreshes would be a tax on waiting rather than a shortcut.
 */
export function afterPaidRefresh(state: MarketState, day: string): MarketState {
  const used = state.paidDay === day ? state.paidToday : 0;
  return { ...state, paidDay: day, paidToday: used + 1 };
}

/**
 * How many refreshes a jump in the clock is worth: **one**, however far it jumped (`05` §5.4).
 *
 * Stated as its own function because it is the whole anti-tamper rule, and because "a jump larger
 * than the interval grants exactly one refresh, not many" is easy to implement as a `while` loop by
 * accident — which would turn the device clock into a market vending machine.
 */
export function refreshesOwed(state: MarketState, now: number): number {
  return refreshDue(state, now) ? 1 : 0;
}

/** Removes a listing that has been bought, leaving the rest of the epoch alone. */
export function withoutListing(state: MarketState, listingId: string): MarketState {
  return { ...state, listings: state.listings.filter((listing) => listing.id !== listingId) };
}

/** Removes a buy-offer that has been accepted. */
export function withoutOffer(state: MarketState, athleteId: string): MarketState {
  return { ...state, offers: state.offers.filter((offer) => offer.athleteId !== athleteId) };
}

/** Repairs a market read out of storage. */
export function normaliseMarket(value: unknown): MarketState {
  if (value === null || typeof value !== 'object') return emptyMarket();
  const raw = value as Partial<MarketState>;
  const number = (input: unknown, fallback: number): number =>
    typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : fallback;

  const listings = Array.isArray(raw.listings)
    ? raw.listings.filter(
        (listing): listing is MarketListing =>
          listing !== null &&
          typeof listing === 'object' &&
          typeof (listing as MarketListing).seed === 'string' &&
          typeof (listing as MarketListing).ask === 'number',
      )
    : [];

  const offers = Array.isArray(raw.offers)
    ? raw.offers.filter(
        (offer): offer is BuyOffer =>
          offer !== null &&
          typeof offer === 'object' &&
          typeof (offer as BuyOffer).athleteId === 'string' &&
          typeof (offer as BuyOffer).coins === 'number',
      )
    : [];

  return {
    epoch: number(raw.epoch, 0),
    lastRefresh: number(raw.lastRefresh, 0),
    paidDay: typeof raw.paidDay === 'string' ? raw.paidDay : null,
    paidToday: Math.min(PAID_REFRESH_PRICES.length, number(raw.paidToday, 0)),
    listings: listings.slice(0, LISTING_COUNT),
    offers: offers.slice(0, OFFER_COUNT),
  };
}
