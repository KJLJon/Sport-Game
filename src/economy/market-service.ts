/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.14 — Transfer market: rotating listings, tamper-resistant refresh, paid refreshes,
 *          buy-offers, seeded price walk
 * @story   US-9.4 — Work the transfer market
 * @design  05-data-model.md §5.4, §5.1
 * @invariant INV-2 (a listing is a seed), INV-3 (storage through the repositories)
 *
 * Purpose: the market with a database behind it — the half `market.ts` deliberately does not have.
 *
 * `market.ts` is pure and knows nothing about athletes; this joins it to the roster: it regenerates
 * the athlete behind a listing, works out what the player owns for the buy-offers, and performs the
 * two transactions.
 *
 * **The market seed is per install.** Stored in `meta` with the rest of the install's identity, so
 * two players do not see the same shop, and so one player's shop is stable across a reload.
 */
import { createRng } from '../engine/rng.ts';
import { generateAthlete, type GeneratedAthlete } from '../athletes/generator.ts';
import { sportOverall, type SportRatingTables } from '../athletes/derivation.ts';
import { sportSkillFor, type Athlete } from '../athletes/types.ts';
import { PLAYABLE_SPORTS } from '../sports/playable.ts';
import type { SportId } from '../sports/types.ts';
import type { AppDatabase } from '../storage/app-db.ts';
import { dateKey } from '../modes/day.ts';
import { refreshMarket, type MarketListing, type MarketState, type RosterShape } from './market.ts';
import type { Valuable } from './valuation.ts';

/** The athlete behind a listing. Deterministic: the same listing always regenerates the same one. */
export function listedAthlete(listing: MarketListing): GeneratedAthlete {
  return generateAthlete(createRng(listing.seed), {
    rarity: listing.rarity,
    sports: [listing.sport],
    createdAt: 0,
  });
}

/** How the roster is spread across sports, for the scarcity bias (`05` §5.4). */
export function rosterShape(athletes: readonly Athlete[]): RosterShape {
  const bySport: Partial<Record<SportId, number>> = {};
  for (const athlete of athletes) {
    bySport[athlete.primarySport] = (bySport[athlete.primarySport] ?? 0) + 1;
  }
  return { bySport, sports: PLAYABLE_SPORTS.map((sport) => sport.id) };
}

/** How an athlete is valued in a sport, given that sport's tables. */
export function valuableFor(athlete: Athlete, sport: SportId, tables: SportRatingTables): Valuable {
  return {
    rarity: athlete.rarity,
    overall: sportOverall(athlete, sport, tables).overall,
    level: sportSkillFor(athlete, sport).level,
  };
}

/** Rating tables for every playable sport, loaded once per market build. */
export async function ratingTables(): Promise<Map<SportId, SportRatingTables>> {
  const entries = await Promise.all(
    PLAYABLE_SPORTS.map(async (sport) => {
      const module = await sport.load();
      const tables: SportRatingTables = {
        weights: module.ratingWeights,
        ...(module.positionWeights === undefined
          ? {}
          : { positionWeights: module.positionWeights }),
      };
      return [sport.id, tables] as const;
    }),
  );
  return new Map(entries);
}

/** The install's market seed, minted once and stored with the rest of the install's identity. */
export async function marketSeed(db: AppDatabase): Promise<string> {
  const meta = (await db.db.get<Record<string, unknown>>('meta', 'meta')) ?? {};
  const existing = meta['marketSeed'];
  if (typeof existing === 'string' && existing.length > 0) return existing;

  // The clock as a *source* of a seed, exactly as a match seed is minted (INV-2 is about draws
  // inside the sim, not about where a seed comes from).
  const seed = `market-${Date.now().toString(36)}`;
  await db.db.put('meta', { ...meta, marketSeed: seed }, 'meta');
  return seed;
}

export interface MarketView {
  readonly state: MarketState;
  /** Listings with their athletes regenerated, in board order. */
  readonly listings: readonly { readonly listing: MarketListing; readonly athlete: Athlete }[];
  /** Offers joined to the athletes they are for. An offer for a sold athlete simply drops out. */
  readonly offers: readonly {
    readonly athlete: Athlete;
    readonly coins: number;
  }[];
  readonly balance: number;
  /** What the next paid refresh costs, or `null` when today's are spent. */
  readonly paidPrice: number | null;
}

/** Builds the whole market for a screen: rotating it first if it is due. */
export async function readMarket(db: AppDatabase, now = Date.now()): Promise<MarketView> {
  const [athletes, tables, seed] = await Promise.all([
    db.athletes.getAll(),
    ratingTables(),
    marketSeed(db),
  ]);

  const shape = rosterShape(athletes);
  const owned = athletes.map((athlete) => ({
    athleteId: athlete.id,
    valuable: valuableFor(
      athlete,
      athlete.primarySport,
      tables.get(athlete.primarySport) ?? { weights: {} },
    ),
  }));

  const build = (market: MarketState): MarketState =>
    refreshMarket(market, {
      seed,
      now,
      shape,
      owned,
      valueOfListing: (listing) => {
        const athlete = listedAthlete({ ...listing, ask: 0 }).athlete;
        return valuableFor(athlete, listing.sport, tables.get(listing.sport) ?? { weights: {} });
      },
    });

  const state = await db.economy.ensureMarket(now, build);
  return view(state, athletes, await db.economy.balance(), now);
}

/** Spends on a manual refresh and returns the new board, or `null` when it could not happen. */
export async function refreshForCoins(
  db: AppDatabase,
  now = Date.now(),
): Promise<MarketView | null> {
  const [athletes, tables, seed] = await Promise.all([
    db.athletes.getAll(),
    ratingTables(),
    marketSeed(db),
  ]);
  const shape = rosterShape(athletes);
  const owned = athletes.map((athlete) => ({
    athleteId: athlete.id,
    valuable: valuableFor(
      athlete,
      athlete.primarySport,
      tables.get(athlete.primarySport) ?? { weights: {} },
    ),
  }));

  const state = await db.economy.paidRefresh(
    dateKey(now),
    (market) =>
      refreshMarket(market, {
        seed,
        now,
        shape,
        owned,
        valueOfListing: (listing) => {
          const athlete = listedAthlete({ ...listing, ask: 0 }).athlete;
          return valuableFor(athlete, listing.sport, tables.get(listing.sport) ?? { weights: {} });
        },
      }),
    now,
  );

  if (state === null) return null;
  return view(state, athletes, await db.economy.balance(), now);
}

function view(
  state: MarketState,
  athletes: readonly Athlete[],
  balance: number,
  now: number,
): MarketView {
  const byId = new Map(athletes.map((athlete) => [athlete.id, athlete]));
  return {
    state,
    listings: state.listings.map((listing) => ({
      listing,
      athlete: listedAthlete(listing).athlete,
    })),
    offers: state.offers.flatMap((offer) => {
      const athlete = byId.get(offer.athleteId);
      // An offer for somebody you have already sold is not an error, it is stale. Dropped rather
      // than shown as a ghost row.
      return athlete === undefined ? [] : [{ athlete, coins: offer.coins }];
    }),
    balance,
    paidPrice: paidPriceFor(state, now),
  };
}

function paidPriceFor(state: MarketState, now: number): number | null {
  const day = dateKey(now);
  const used = state.paidDay === day ? state.paidToday : 0;
  return [250, 500, 1000][used] ?? null;
}

/** Buys a listing: pays, and puts the athlete in the roster. Returns the athlete, or `null`. */
export async function buyListing(
  db: AppDatabase,
  listing: MarketListing,
  now = Date.now(),
): Promise<Athlete | null> {
  const generated = listedAthlete(listing);
  const athlete: Athlete = { ...generated.athlete, source: 'market', createdAt: now };

  const bought = await db.economy.buyListing(
    listing.id,
    listing.ask,
    `Bought ${athlete.displayName}`,
    now,
  );
  if (!bought) return null;

  await db.athletes.put(athlete);
  return athlete;
}

/** Accepts a buy-offer: credits the coins and removes the athlete. Returns whether it happened. */
export async function acceptOffer(
  db: AppDatabase,
  athlete: Athlete,
  coins: number,
  now = Date.now(),
): Promise<boolean> {
  const accepted = await db.economy.acceptOffer(
    athlete.id,
    coins,
    `Sold ${athlete.displayName} to a buyer`,
    now,
  );
  if (!accepted) return false;

  await db.athletes.delete(athlete.id);
  return true;
}
