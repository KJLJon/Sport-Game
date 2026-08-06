/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @story   US-9.1 — Earn coins
 * @story   US-9.5 — Understand my economy at a glance
 * @design  05-data-model.md §5 (economy), §5.5 (the anti-farm invariant)
 * @invariant INV-2 (nothing draws — an entry id is a counter, not a roll)
 *
 * Purpose: the rules a coin balance obeys, as pure functions on the record.
 *
 * Storage is next door in `repository.ts`; everything that decides *what the balance becomes* is
 * here, so it can be tested without a database and reasoned about without a promise. A wallet is
 * the one place in the app where being subtly wrong takes something from the player, so the rules
 * it obeys are worth stating:
 *
 * 1. **The balance never goes negative.** A spend the wallet cannot afford does not happen; it is
 *    refused and says so, rather than being clamped into an overdraft nobody can see.
 * 2. **Nothing moves silently.** Every change to the balance writes a ledger entry, and the entry
 *    is what the change *is*. There is no setter.
 * 3. **A movement of zero is not a movement.** A capped arcade run that paid nothing, a payout for
 *    a match nobody played — those leave the wallet exactly as it was, including its history.
 * 4. **Lifetime totals outlive the ledger.** Trimming old entries must not make "earned so far"
 *    shrink, so the totals are their own fields.
 */
import { dateKey } from '../modes/day.ts';
import { resultOf, type MatchRecord } from '../stats/types.ts';
import { matchPayout, type MatchPayoutOptions } from './earning.ts';
import {
  LEDGER_LIMIT,
  type EconomyState,
  type LedgerEntry,
  type LedgerReason,
  type Payout,
} from './types.ts';

export interface LedgerInput {
  /** Signed. Rounded to a whole coin — there are no fractional coins in this economy. */
  readonly delta: number;
  readonly reason: LedgerReason;
  readonly detail: string;
  readonly at?: number;
}

/** True when the wallet can pay `cost` without going negative. `cost` is a positive number. */
export function canAfford(state: EconomyState, cost: number): boolean {
  return state.balance >= Math.round(cost);
}

/**
 * The wallet after a movement, and the entry it wrote.
 *
 * A debit larger than the balance is refused whole rather than partially applied: half a purchase
 * is not a state any caller wants to unpick. `entry` is `null` for a refused or empty movement, and
 * the returned state is then the one that went in — reference-equal, so a caller can skip a write.
 */
export function applyEntry(
  state: EconomyState,
  input: LedgerInput,
): { readonly state: EconomyState; readonly entry: LedgerEntry | null } {
  const delta = Math.round(input.delta);
  if (!Number.isFinite(delta) || delta === 0) return { state, entry: null };
  if (delta < 0 && state.balance + delta < 0) return { state, entry: null };

  const entry: LedgerEntry = {
    id: `e${state.entryCount + 1}`,
    at: input.at ?? Date.now(),
    delta,
    reason: input.reason,
    detail: input.detail,
  };

  return {
    state: {
      ...state,
      balance: state.balance + delta,
      totalEarned: state.totalEarned + (delta > 0 ? delta : 0),
      totalSpent: state.totalSpent + (delta < 0 ? -delta : 0),
      entryCount: state.entryCount + 1,
      ledger: [entry, ...state.ledger].slice(0, LEDGER_LIMIT),
    },
    entry,
  };
}

/** A credit. Negative amounts are ignored rather than quietly becoming a spend. */
export function earn(
  state: EconomyState,
  amount: number,
  reason: LedgerReason,
  detail: string,
  at?: number,
): EconomyState {
  if (amount <= 0) return state;
  return applyEntry(state, { delta: amount, reason, detail, ...(at === undefined ? {} : { at }) })
    .state;
}

/**
 * A spend. Returns `null` when the wallet cannot afford it, so the caller has to handle the case
 * rather than discovering later that the balance did not move.
 */
export function spend(
  state: EconomyState,
  cost: number,
  reason: LedgerReason,
  detail: string,
  at?: number,
): EconomyState | null {
  const amount = Math.round(cost);
  if (amount <= 0) return state;
  if (!canAfford(state, amount)) return null;
  return applyEntry(state, { delta: -amount, reason, detail, ...(at === undefined ? {} : { at }) })
    .state;
}

/** Everything the payout needs that the record does not carry. The record is the other argument. */
export interface SettleMatchOptions extends Omit<MatchPayoutOptions, 'record' | 'firstWinToday'> {
  /** The ledger line. Built by the caller, which is the only thing that knows the sport's name. */
  readonly detail: string;
  /** Defaults to now. Also decides which UTC day the first-win bonus is counted against. */
  readonly at?: number;
}

/**
 * The wallet after a finished match, and the payout that got it there.
 *
 * **First-win-of-the-day is settled here, not in `earning.ts`**, because it is a fact about the
 * wallet's history rather than about the match: whether today has already paid one, and marking
 * that it now has. Doing both in one function is what stops two matches finishing in the same
 * second from each being "the first".
 *
 * A draw or a loss does not consume the day's bonus — `lastWinDay` only advances on a win that was
 * actually paid, so an unlucky evening does not cost you tomorrow morning's 250.
 */
export function settleMatch(
  state: EconomyState,
  record: MatchRecord,
  options: SettleMatchOptions,
): { readonly state: EconomyState; readonly payout: Payout } {
  const at = options.at ?? Date.now();
  const day = dateKey(at);
  const won = resultOf(record) === 'win';
  const firstWinToday = won && state.lastWinDay !== day;

  const payout = matchPayout({
    record,
    ...(options.assists === undefined ? {} : { assists: options.assists }),
    firstWinToday,
  });
  if (payout.total <= 0) return { state, payout };

  const credited = applyEntry(state, {
    delta: payout.total,
    reason: 'match',
    detail: options.detail,
    at,
  }).state;

  return {
    state: firstWinToday ? { ...credited, lastWinDay: day } : credited,
    payout,
  };
}
