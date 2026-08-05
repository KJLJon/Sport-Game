/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @story   US-9.5 — Understand my economy at a glance
 * @design  10-ui-ux.md §10 (the forgotten states), §11 (nothing by colour alone)
 * @invariant INV-11 (a debit is named, not merely tinted)
 *
 * Purpose: that the Store tab shows a balance and where it came from, and that a wallet with
 * nothing in it says something useful instead of showing an empty list.
 *
 * The itemisation cases live here too: `06` §4 asks the post-match screen to itemise coins, and the
 * thing worth asserting is that the lines a player can add up equal the total printed under them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { walletScreen } from '@/ui/screens/wallet.ts';
import { payoutPanel, multiplierText } from '@/ui/components/payout.ts';
import { appDatabase, closeAppDatabase } from '@/storage/app-db.ts';
import { deleteDatabase } from '@/storage/idb.ts';
import type { Payout } from '@/economy/types.ts';

function context() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  return { host, params: {}, query: {}, navigate: vi.fn() };
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('the wallet screen', () => {
  it('offers something to do when there are no coins yet (`10` §10)', async () => {
    const ctx = context();
    await walletScreen().mount(ctx);

    expect(ctx.host.querySelector('.empty-state')?.textContent).toContain('No coins yet');
    expect(ctx.host.querySelector('.wallet__entries')).toBeNull();
    // An empty state with no action is a dead end.
    expect(ctx.host.querySelector('.empty-state .button')).not.toBeNull();
  });

  it('shows the balance and the lifetime totals', async () => {
    const { economy } = await appDatabase();
    await economy.earn(1000, 'match', 'Basketball · Live · Won 60–50');
    await economy.spend(250, 'pack', 'Bronze pack');

    const ctx = context();
    await walletScreen().mount(ctx);

    expect(ctx.host.querySelector('.wallet__balance')?.textContent).toContain('750');
    expect(ctx.host.querySelector('.wallet__lifetime')?.textContent).toBe(
      'Earned 1,000 · spent 250',
    );
  });

  it('lists movements newest first, naming what each one was', async () => {
    const { economy } = await appDatabase();
    await economy.earn(1000, 'match', 'Basketball · Live · Won 60–50');
    await economy.spend(250, 'pack', 'Bronze pack');

    const ctx = context();
    await walletScreen().mount(ctx);

    const rows = [...ctx.host.querySelectorAll('.wallet__entry')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Bronze pack');
    expect(rows[1]?.textContent).toContain('Basketball · Live · Won 60–50');

    // The kind of movement is a word, not only a tint (INV-11).
    expect(rows[0]?.querySelector('.wallet__entry-meta')?.textContent).toContain('Pack');
    expect(rows[1]?.querySelector('.wallet__entry-meta')?.textContent).toContain('Match');
  });

  it('spells the balance out for a screen reader', async () => {
    const { economy } = await appDatabase();
    await economy.earn(1250, 'match', 'won');

    const ctx = context();
    await walletScreen().mount(ctx);
    expect(ctx.host.querySelector('.wallet__balance')?.getAttribute('aria-label')).toBe(
      '1,250 coins',
    );
  });
});

describe('the payout panel', () => {
  const payout: Payout = {
    total: 575,
    items: [
      { id: 'completed', label: 'Match completed', coins: 100 },
      { id: 'win', label: 'Win', coins: 150 },
      { id: 'difficulty', label: 'All-Star', coins: 100, multiplier: 1.4 },
      { id: 'first-win', label: 'First win today', coins: 225 },
    ],
  };

  it('prints every line, and the lines add up to the total', () => {
    const panel = payoutPanel(document, payout);
    const labels = [...panel.querySelectorAll('.payout__lines .payout__label')].map(
      (node) => node.textContent,
    );

    expect(labels).toEqual(['Match completed', 'Win', 'All-Star ×1.4', 'First win today']);
    expect(panel.querySelector('.payout__total')?.textContent).toContain('575');
    expect(payout.items.reduce((sum, item) => sum + item.coins, 0)).toBe(payout.total);
  });

  it('says so when a match paid nothing, rather than showing an empty list', () => {
    const panel = payoutPanel(document, { total: 0, items: [] });
    expect(panel.querySelector('.payout__empty')?.textContent).toBe('No coins for this one.');
    expect(panel.querySelector('.payout__lines')).toBeNull();
  });

  it('writes a multiplier without trailing zeroes', () => {
    expect(multiplierText(1.4)).toBe('×1.4');
    expect(multiplierText(2)).toBe('×2');
    expect(multiplierText(1.15)).toBe('×1.15');
  });
});
