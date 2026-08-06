/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @story   US-9.1 — Earn coins
 * @story   US-9.5 — Understand my economy at a glance
 * @design  05-data-model.md §1 (the `economy` store — one keyless record), §5
 * @invariant INV-3 (the store name comes from `idb.ts`, which builds it in `storage/scope.ts`)
 *
 * Purpose: the wallet, persisted. Reading and writing the one `economy` record, and nothing else.
 *
 * **Every write is serialised.** A wallet is read-modify-write by nature — the balance depends on
 * the balance — so two credits landing in the same tick would otherwise both read the old record
 * and the second would overwrite the first's coins. A match that ends while an arcade run is still
 * settling is not a hypothetical: both write from a `.then()` on the same promise. So mutations go
 * through one promise chain, and a caller that awaits gets the state its own write produced.
 *
 * **The key is the store's own name**, which is the convention the keyless stores in `05` §1 share
 * (`meta`, `progress`, `settings`) and the one `storage/backup.ts` relies on to export a singleton.
 * Getting it wrong would leave the wallet out of every backup, silently.
 */
import type { Database } from '../storage/idb.ts';
import type { MatchRecord } from '../stats/types.ts';
import type { PackRoll } from './packs.ts';
import { earn, settleMatch, spend, type LedgerInput, type SettleMatchOptions } from './wallet.ts';
import {
  emptyEconomy,
  normaliseEconomy,
  type EconomyState,
  type LedgerEntry,
  type LedgerReason,
  type PackTier,
  type Payout,
} from './types.ts';

/** What one purchase produced: the cards, and whether it cost anything. */
export interface PackPurchase {
  readonly roll: PackRoll;
  /** True when an owed pack (an achievement reward, a tournament prize) paid for it. */
  readonly free: boolean;
  readonly spent: number;
}

/** The key the single record lives under, matching the store name (`05` §1). */
export const ECONOMY_KEY = 'economy';

export class EconomyRepository {
  readonly #db: Database;
  /** The tail of the write chain. Mutations queue behind it; reads do not. */
  #chain: Promise<unknown> = Promise.resolve();

  constructor(db: Database) {
    this.#db = db;
  }

  /** The wallet as it stands. An install that has never earned anything reads as empty, not absent. */
  async state(): Promise<EconomyState> {
    const stored = await this.#db.get<unknown>('economy', ECONOMY_KEY);
    return stored === undefined ? emptyEconomy() : normaliseEconomy(stored);
  }

  async balance(): Promise<number> {
    return (await this.state()).balance;
  }

  /** Recent movements, newest first — the ledger US-9.5 asks the wallet screen to show. */
  async recent(limit = 25): Promise<LedgerEntry[]> {
    return (await this.state()).ledger.slice(0, limit);
  }

  /**
   * Applies a change to the stored wallet, serialised against every other change.
   *
   * The mutator is pure and may refuse by returning the state it was given: an unchanged state is
   * not written, so a refused spend costs no IndexedDB round trip.
   */
  #mutate<T>(
    apply: (state: EconomyState) => { readonly state: EconomyState; readonly result: T },
  ): Promise<T> {
    const next = this.#chain.then(async () => {
      const current = await this.state();
      const { state, result } = apply(current);
      if (state !== current) await this.#db.put('economy', state, ECONOMY_KEY);
      return result;
    });
    // The chain must survive a failed write, or one rejection would strand every later mutation.
    this.#chain = next.catch(() => undefined);
    return next;
  }

  /** Credits coins. Returns the wallet afterwards. */
  earn(amount: number, reason: LedgerReason, detail: string, at?: number): Promise<EconomyState> {
    return this.#mutate((state) => {
      const next = earn(state, amount, reason, detail, at);
      return { state: next, result: next };
    });
  }

  /**
   * Debits coins. Resolves to `null` when the wallet could not afford it — the caller has to decide
   * what to say, and the balance has not moved.
   */
  spend(
    cost: number,
    reason: LedgerReason,
    detail: string,
    at?: number,
  ): Promise<EconomyState | null> {
    return this.#mutate((state) => {
      const next = spend(state, cost, reason, detail, at);
      return { state: next ?? state, result: next };
    });
  }

  /** A signed movement, for a caller that already knows the sign. */
  record(input: LedgerInput): Promise<EconomyState> {
    return input.delta >= 0
      ? this.earn(input.delta, input.reason, input.detail, input.at)
      : this.spend(-input.delta, input.reason, input.detail, input.at).then(
          async (next) => next ?? (await this.state()),
        );
  }

  /** Settles a finished match: the payout, credited, with the day's first-win bonus handled once. */
  settleMatch(record: MatchRecord, options: SettleMatchOptions): Promise<Payout> {
    return this.#mutate((state) => {
      const settled = settleMatch(state, record, options);
      return { state: settled.state, result: settled.payout };
    });
  }

  /**
   * Records a pack the player is owed (an achievement reward, a tournament win).
   *
   * Not a coin movement, so it writes no ledger entry — the thing that earned it will have written
   * its own. Opening it is T-8.12's; until then it simply waits, which is the honest state.
   */
  owePack(tier: PackTier): Promise<EconomyState> {
    return this.#mutate((state) => {
      const next = { ...state, owedPacks: [...state.owedPacks, tier] };
      return { state: next, result: next };
    });
  }

  /**
   * Takes one owed pack of a tier, or `null` when none is owed. The removal and the read are one
   * step, so two callers cannot open the same free pack.
   */
  takeOwedPack(tier: PackTier): Promise<EconomyState | null> {
    return this.#mutate((state) => {
      const index = state.owedPacks.indexOf(tier);
      if (index === -1) return { state, result: null };
      const owedPacks = [...state.owedPacks];
      owedPacks.splice(index, 1);
      const next = { ...state, owedPacks };
      return { state: next, result: next };
    });
  }

  /**
   * Buys and opens a pack in one queued step (T-8.12).
   *
   * Paying, taking an owed pack, and advancing the pity counter are three writes to the same record
   * and have to be one operation: a player who taps twice quickly must not open two packs for one
   * price, and a pity counter that advanced without a pack being opened would be a guarantee the
   * player paid for and did not get.
   *
   * The roll is passed in as a function of the current counters, so this method stays ignorant of
   * odds tables and athlete generation while still holding the lock over them.
   */
  purchasePack(
    tier: PackTier,
    price: number,
    roll: (pity: EconomyState['pity']) => PackRoll,
    detail: string,
    at?: number,
  ): Promise<PackPurchase | null> {
    return this.#mutate((state) => {
      const owedIndex = state.owedPacks.indexOf(tier);
      const free = owedIndex !== -1;

      let paid = state;
      if (free) {
        const owedPacks = [...state.owedPacks];
        owedPacks.splice(owedIndex, 1);
        paid = { ...state, owedPacks };
      } else {
        const spent = spend(state, price, 'pack', detail, at);
        if (spent === null) return { state, result: null };
        paid = spent;
      }

      const rolled = roll(paid.pity);
      return {
        state: { ...paid, pity: rolled.pity },
        result: { roll: rolled, free, spent: free ? 0 : price },
      };
    });
  }

  /** Empties the wallet. Used by erase-all-data; never by an update. */
  async clear(): Promise<void> {
    await this.#mutate(() => ({ state: emptyEconomy(), result: undefined }));
  }
}
