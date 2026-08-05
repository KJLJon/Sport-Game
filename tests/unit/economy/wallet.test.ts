/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @story   US-9.1 — Earn coins
 * @story   US-9.5 — Understand my economy at a glance
 * @design  05-data-model.md §5 (economy), 09-modes-and-arcade.md §7
 * @invariant INV-2 (an entry id is a counter, never a draw)
 *
 * Purpose: the four rules the wallet promises — no negative balance, no silent movement, no entry
 * for nothing, and lifetime totals that survive the ledger being trimmed.
 *
 * The first-win-of-the-day cases are the ones a player would notice being wrong: paid twice is a
 * money loop, and lost to a draw played at 23:59 is 250 coins somebody earned and did not get.
 */
import { describe, expect, it } from 'vitest';
import { applyEntry, canAfford, earn, settleMatch, spend } from '@/economy/wallet.ts';
import { FIRST_WIN_OF_DAY_COINS, MATCH_COMPLETED_COINS, WIN_COINS } from '@/economy/earning.ts';
import { LEDGER_LIMIT, emptyEconomy, normaliseEconomy } from '@/economy/types.ts';
import { MATCH_RECORD_VERSION, type MatchRecord } from '@/stats/types.ts';

const AT = Date.UTC(2026, 7, 5, 12, 0, 0);

function match(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'm1',
    schemaVersion: MATCH_RECORD_VERSION,
    playedAt: AT,
    sportId: 'basketball',
    mode: 'live',
    difficulty: 'pro',
    score: [60, 50],
    playerSide: 0,
    teamNames: ['Home', 'Away'],
    periodsPlayed: 4,
    lines: [],
    ...overrides,
  };
}

describe('applyEntry', () => {
  it('credits, records, and keeps the totals', () => {
    const { state, entry } = applyEntry(emptyEconomy(), {
      delta: 250,
      reason: 'match',
      detail: 'Basketball · Live · Won',
      at: AT,
    });

    expect(state.balance).toBe(250);
    expect(state.totalEarned).toBe(250);
    expect(state.totalSpent).toBe(0);
    expect(entry).toMatchObject({ id: 'e1', delta: 250, reason: 'match', at: AT });
    expect(state.ledger[0]).toBe(entry);
  });

  it('numbers entries sequentially rather than drawing an id (INV-2)', () => {
    let state = emptyEconomy();
    for (let index = 0; index < 3; index += 1) {
      state = applyEntry(state, { delta: 10, reason: 'arcade', detail: 'run', at: AT }).state;
    }
    expect(state.ledger.map((entry) => entry.id)).toEqual(['e3', 'e2', 'e1']);
  });

  it('records nothing for a movement of zero', () => {
    const before = emptyEconomy();
    const { state, entry } = applyEntry(before, { delta: 0, reason: 'arcade', detail: 'capped' });
    expect(state).toBe(before);
    expect(entry).toBeNull();
  });

  it('refuses a debit the balance cannot cover, whole', () => {
    const funded = earn(emptyEconomy(), 100, 'match', 'won', AT);
    const { state, entry } = applyEntry(funded, { delta: -101, reason: 'pack', detail: 'Bronze' });
    expect(state).toBe(funded);
    expect(entry).toBeNull();
    expect(state.balance).toBe(100);
  });

  it('trims the ledger but never the lifetime totals', () => {
    let state = emptyEconomy();
    for (let index = 0; index < LEDGER_LIMIT + 25; index += 1) {
      state = applyEntry(state, { delta: 10, reason: 'match', detail: `#${index}`, at: AT }).state;
    }

    expect(state.ledger).toHaveLength(LEDGER_LIMIT);
    expect(state.balance).toBe((LEDGER_LIMIT + 25) * 10);
    expect(state.totalEarned).toBe((LEDGER_LIMIT + 25) * 10);
    expect(state.entryCount).toBe(LEDGER_LIMIT + 25);
    // Newest first, and the ids keep counting past the trim.
    expect(state.ledger[0]?.id).toBe(`e${LEDGER_LIMIT + 25}`);
  });
});

describe('spend', () => {
  it('debits and tracks what has been spent', () => {
    const funded = earn(emptyEconomy(), 1000, 'match', 'won', AT);
    const after = spend(funded, 750, 'pack', 'Bronze pack', AT);

    expect(after?.balance).toBe(250);
    expect(after?.totalSpent).toBe(750);
    expect(after?.totalEarned).toBe(1000);
    expect(after?.ledger[0]?.delta).toBe(-750);
  });

  it('returns null rather than overdrawing', () => {
    expect(spend(emptyEconomy(), 750, 'pack', 'Bronze pack')).toBeNull();
    expect(canAfford(emptyEconomy(), 750)).toBe(false);
    expect(canAfford(earn(emptyEconomy(), 750, 'match', 'won'), 750)).toBe(true);
  });
});

describe('settleMatch', () => {
  it('credits the payout and pays the first win of the day once', () => {
    const first = settleMatch(emptyEconomy(), match(), { detail: 'Basketball · Live', at: AT });
    expect(first.payout.items.map((item) => item.id)).toContain('first-win');
    expect(first.state.balance).toBe(MATCH_COMPLETED_COINS + WIN_COINS + FIRST_WIN_OF_DAY_COINS);
    expect(first.state.lastWinDay).toBe('2026-08-05');

    const second = settleMatch(first.state, match({ id: 'm2' }), {
      detail: 'Basketball · Live',
      at: AT + 60_000,
    });
    expect(second.payout.items.map((item) => item.id)).not.toContain('first-win');
    expect(second.state.balance).toBe(first.state.balance + MATCH_COMPLETED_COINS + WIN_COINS);
  });

  it('pays it again the next UTC day', () => {
    const first = settleMatch(emptyEconomy(), match(), { detail: 'x', at: AT });
    const tomorrow = settleMatch(first.state, match({ id: 'm2' }), {
      detail: 'x',
      at: AT + 24 * 60 * 60 * 1000,
    });
    expect(tomorrow.payout.items.map((item) => item.id)).toContain('first-win');
    expect(tomorrow.state.lastWinDay).toBe('2026-08-06');
  });

  it('does not let a loss consume the day’s bonus', () => {
    const lost = settleMatch(emptyEconomy(), match({ score: [50, 60] }), { detail: 'x', at: AT });
    expect(lost.state.lastWinDay).toBeNull();

    const won = settleMatch(lost.state, match({ id: 'm2' }), { detail: 'x', at: AT });
    expect(won.payout.items.map((item) => item.id)).toContain('first-win');
  });

  it('writes nothing for a match nobody played', () => {
    const before = emptyEconomy();
    const settled = settleMatch(before, match({ playerSide: -1 }), { detail: 'x', at: AT });
    expect(settled.state).toBe(before);
    expect(settled.payout.total).toBe(0);
  });

  it('leaves the ledger line the caller wrote', () => {
    const settled = settleMatch(emptyEconomy(), match(), {
      detail: 'Basketball · Live · Won 60–50',
      at: AT,
    });
    expect(settled.state.ledger[0]).toMatchObject({
      reason: 'match',
      detail: 'Basketball · Live · Won 60–50',
      delta: settled.payout.total,
    });
  });
});

describe('normaliseEconomy', () => {
  it('reads a wallet an older build wrote', () => {
    const state = normaliseEconomy({
      balance: 500,
      ledger: [{ id: 'e1', at: AT, delta: 500, reason: 'match', detail: 'won' }],
    });
    expect(state.balance).toBe(500);
    expect(state.totalEarned).toBe(500);
    expect(state.entryCount).toBe(1);
  });

  it('refuses to believe a negative balance or a broken entry', () => {
    const state = normaliseEconomy({
      balance: -900,
      totalSpent: Number.NaN,
      ledger: [
        { id: 'e1', at: AT, delta: 0, reason: 'match', detail: 'nothing' },
        { id: 'e2', at: AT, delta: 40, reason: 'not-a-reason', detail: 'bogus' },
        { id: 'e3', at: AT, delta: 40, reason: 'arcade', detail: 'kept' },
      ],
    });
    expect(state.balance).toBe(0);
    expect(state.totalSpent).toBe(0);
    expect(state.ledger.map((entry) => entry.id)).toEqual(['e3']);
  });

  it('turns anything unrecognisable into an empty wallet', () => {
    expect(normaliseEconomy(null)).toEqual(emptyEconomy());
    expect(normaliseEconomy('coins')).toEqual(emptyEconomy());
  });
});
