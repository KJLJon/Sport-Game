/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @story   US-9.5 — Understand my economy at a glance
 * @design  10-ui-ux.md §7 (screen map — the Store tab), §10 (the forgotten states), §11 (nothing
 *          by colour alone), 05-data-model.md §5
 * @invariant INV-11 (44 px targets; a debit says "spent", it is not merely red)
 *
 * Purpose: the Store tab. Your balance, and where every coin of it came from.
 *
 * **This is the first screen behind that tab**; it was an "arrives in Phase 8" placeholder until
 * now. Packs, the market, and selling are T-8.12 to T-8.14 and will land alongside this rather than
 * instead of it — a wallet is the thing all three spend from, and US-9.5 asks for it in its own
 * right.
 *
 * **A credit and a debit are told apart in words.** The pill is tinted, and the row also says what
 * the movement was — "Match", "Pack" — so nothing depends on telling green from red (`10` §11).
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { coinPill } from '../components/meters.ts';
import { emptyState, errorState } from '../components/states.ts';
import { el } from '../dom.ts';
import type { EconomyState, LedgerEntry, LedgerReason } from '../../economy/types.ts';
import './wallet.css';

/** What each reason is called on screen. One word where one word will do. */
const REASON_WORDS: Readonly<Record<LedgerReason, string>> = {
  match: 'Match',
  arcade: 'Arcade',
  tournament: 'Tournament',
  achievement: 'Achievement',
  pack: 'Pack',
  sell: 'Sold',
  market: 'Market',
  adjust: 'Adjustment',
};

/** A date and time a person can read, in their own locale, without a formatting library. */
function movedOn(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function entryRow(doc: Document, entry: LedgerEntry): HTMLElement {
  return el(doc, 'li', {
    class: 'wallet__entry',
    children: [
      el(doc, 'div', {
        class: 'wallet__entry-text',
        children: [
          el(doc, 'p', { class: 'wallet__entry-detail', text: entry.detail || 'Coins' }),
          el(doc, 'p', {
            class: 'wallet__entry-meta',
            text: `${REASON_WORDS[entry.reason]} · ${movedOn(entry.at)}`,
          }),
        ],
      }),
      coinPill(doc, { amount: entry.delta, signed: true }),
    ],
  });
}

function summary(doc: Document, state: EconomyState): HTMLElement {
  return el(doc, 'section', {
    class: 'wallet__summary',
    children: [
      el(doc, 'p', { class: 'wallet__balance-label', text: 'Balance' }),
      // The pill names itself — it carries `role="img"` and the spelled-out amount — so there is
      // nothing for this paragraph to label, and `aria-label` on a `<p>` is prohibited anyway.
      el(doc, 'p', {
        class: 'wallet__balance',
        children: [coinPill(doc, { amount: state.balance })],
      }),
      el(doc, 'p', {
        class: 'wallet__lifetime',
        text: `Earned ${state.totalEarned.toLocaleString('en-US')} · spent ${state.totalSpent.toLocaleString('en-US')}`,
      }),
    ],
  });
}

export function walletScreen(): Screen {
  return {
    async mount({ host, navigate }: ScreenContext): Promise<void> {
      const doc = host.ownerDocument;

      let state: EconomyState;
      try {
        state = await (await appDatabase()).economy.state();
      } catch {
        host.replaceChildren(
          errorState(doc, {
            heading: 'Your wallet is not available',
            body: 'The game could not open its storage, so the balance cannot be shown. Everything you have earned is still there.',
            action: { label: 'Back to Play', href: '#/play' },
          }),
        );
        return;
      }

      const children: (HTMLElement | null)[] = [
        el(doc, 'h1', { class: 'wallet__title', text: 'Store' }),
        summary(doc, state),
      ];

      if (state.ledger.length === 0) {
        children.push(
          emptyState(doc, {
            heading: 'No coins yet',
            body: 'Every match pays, win or lose, and the harder levels pay more. An arcade run pays a little, up to a daily cap.',
            action: { label: 'Play a match', onSelect: () => navigate('/play') },
          }),
        );
      } else {
        children.push(
          el(doc, 'section', {
            class: 'wallet__ledger',
            children: [
              el(doc, 'h2', { class: 'wallet__ledger-title', text: 'Recent activity' }),
              el(doc, 'ul', {
                class: 'wallet__entries',
                children: state.ledger.map((entry) => entryRow(doc, entry)),
              }),
            ],
          }),
        );
      }

      children.push(
        el(doc, 'p', {
          class: 'wallet__note',
          // Says what is not here yet, rather than leaving a tab that looks finished and is not.
          text: 'Packs, the transfer market, and selling athletes arrive later in this phase.',
        }),
      );

      host.replaceChildren(el(doc, 'div', { class: 'wallet', children }));
    },
  };
}
