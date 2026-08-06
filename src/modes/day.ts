/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @task    T-4.4 — Practice / scored / daily modes; seeded daily challenge
 * @story   US-9.1 — Earn coins
 * @story   US-16.4 — Take a daily challenge
 * @design  09-modes-and-arcade.md §3.3 (the daily challenge and its day boundary),
 *          05-data-model.md §5.3 (first win of the day)
 *
 * Purpose: what "today" means, in one place.
 *
 * Two features now hang off a day boundary — the arcade's daily challenge (T-4.4) and the economy's
 * first-win-of-the-day bonus (T-8.10) — and two answers to "which day is it" would be a bug waiting
 * for a player in UTC+13 to find. The arcade owned this first; it moved here rather than being
 * copied, so a single definition serves both and `modes/arcade/daily.ts` re-exports it for the
 * callers that already had it.
 *
 * **The boundary is UTC**, for the reason the daily challenge chose it: a local boundary means two
 * players disagree about which challenge is today's, and a challenge code shared across a timezone
 * resolves to a different run at each end. The bonus inherits that honestly — it rolls over at
 * midnight UTC for everybody, and the wallet screen says so rather than implying it follows the
 * device clock.
 */

/** `YYYY-MM-DD` in UTC — the identity of a day. */
export function dateKey(now: number | Date = Date.now()): string {
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Milliseconds until the next UTC midnight — the "new challenge in 6h 12m" line. */
export function millisUntilNextDay(now: number = Date.now()): number {
  const date = new Date(now);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return next - now;
}
