/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.13 — Sell-back: valuation, squad-lock guard, confirmation, anti-farm invariants
 * @story   US-9.3 — Sell athletes for coins
 * @design  05-data-model.md §5.1 (valuation), §5.5 (anti-farm), 10-ui-ux.md §10 (confirmation)
 * @invariant INV-5 (`sellPrice < marketAsk`), INV-6 (progression is untouched by a sale)
 *
 * Purpose: what selling an athlete is worth, what stops it, and what actually happens.
 *
 * **Three things can stop a sale, and each says why.** An athlete in a squad is *guarded*, not
 * forbidden — US-9.3 says "unless I confirm", so the squad lock is a warning the player can
 * override, and it names the team they would be leaving short. The last athlete in a save cannot be
 * sold at all: an empty roster is a save that cannot play, and no confirmation makes that a good
 * idea. And an athlete who does not exist is a stale screen, not a sale.
 *
 * **The valuation shown is the valuation paid.** The quote goes into the confirmation, and the sale
 * pays exactly it — recomputing at commit time would let a level-up between the two screens change
 * the number after the player agreed to it.
 *
 * **Selling is a deletion, and it is honest about that.** No "transfer list", no way back. The
 * confirmation says the name, the coins, and that it cannot be undone, because the alternative is a
 * player losing an athlete they had spent forty matches on to a mis-tap.
 */
import type { Athlete } from '../athletes/types.ts';
import type { Squad } from '../teams/types.ts';
import { sportSkillFor } from '../athletes/types.ts';
import { sellPrice, valueOf, type Valuable } from './valuation.ts';

/**
 * How an athlete is valued: at their *primary* sport, which is what they are.
 *
 * The overall is passed in rather than read off the record, because there is no such field: an
 * overall is per sport and derived from that sport's weight tables (`05` §3.4), which live in the
 * sport module. The caller has already loaded one; making this function load two would put an
 * `await` inside a price.
 */
export function valuableOf(athlete: Athlete, overall: number): Valuable {
  return {
    rarity: athlete.rarity,
    overall,
    level: sportSkillFor(athlete, athlete.primarySport).level,
  };
}

/** What the game will pay for this athlete, right now. */
export function quoteFor(athlete: Athlete, overall: number): number {
  return sellPrice(valuableOf(athlete, overall));
}

/** What they are notionally worth — shown beside the quote, so the 35% is visible rather than felt. */
export function valueFor(athlete: Athlete, overall: number): number {
  return Math.round(valueOf(valuableOf(athlete, overall)));
}

export type SellBlock =
  /** They are in a squad. Overridable with a confirmation (US-9.3). */
  | { readonly kind: 'in-squad'; readonly teamIds: readonly string[]; readonly message: string }
  /** The only athlete left. Not overridable. */
  | { readonly kind: 'last-athlete'; readonly message: string };

export interface SellQuote {
  readonly athlete: Athlete;
  readonly coins: number;
  readonly value: number;
  /** What stands in the way, if anything. `hard` blocks cannot be confirmed past. */
  readonly block: SellBlock | null;
  readonly hard: boolean;
  /** The sentence the confirmation dialog leads with. */
  readonly confirmation: string;
}

export interface QuoteOptions {
  readonly athlete: Athlete;
  /** Their overall in their primary sport, from that sport's tables. */
  readonly overall: number;
  /** Every squad in the save, so the guard can name the teams that would be left short. */
  readonly squads: readonly Squad[];
  /** How many athletes the save holds, including this one. */
  readonly rosterSize: number;
}

/** True when this athlete is a starter or on the bench of the given squad. */
export function squadHolds(squad: Squad, athleteId: string): boolean {
  return Object.values(squad.starters).includes(athleteId) || squad.bench.includes(athleteId);
}

export function quoteSale(options: QuoteOptions): SellQuote {
  const { athlete } = options;
  const coins = quoteFor(athlete, options.overall);
  const value = valueFor(athlete, options.overall);

  const teamIds = [
    ...new Set(
      options.squads.filter((squad) => squadHolds(squad, athlete.id)).map((squad) => squad.teamId),
    ),
  ];

  let block: SellBlock | null = null;
  let hard = false;

  if (options.rosterSize <= 1) {
    block = {
      kind: 'last-athlete',
      message:
        'This is the only athlete in your save. Selling them would leave nothing to play with.',
    };
    hard = true;
  } else if (teamIds.length > 0) {
    block = {
      kind: 'in-squad',
      teamIds,
      message:
        teamIds.length === 1
          ? 'They are in a squad. Selling them leaves that team a player short.'
          : `They are in ${teamIds.length} squads. Selling them leaves those teams a player short.`,
    };
  }

  return {
    athlete,
    coins,
    value,
    block,
    hard,
    // Names the athlete and the number, and says the part that matters (`10` §10).
    confirmation: `Sell ${athlete.displayName} for ${coins.toLocaleString('en-US')} coins? This cannot be undone.`,
  };
}

/** The ledger line a sale writes. Names who, so a wallet history is readable a month later. */
export function sellDetail(athlete: Athlete): string {
  return `Sold ${athlete.displayName}`;
}
