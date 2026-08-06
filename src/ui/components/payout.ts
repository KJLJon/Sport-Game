/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @story   US-9.1 — Earn coins
 * @design  06-game-design.md §4 (post-match: coin itemisation), 10-ui-ux.md §11 (no information by
 *          colour alone), §3.1 (`accent-alt` is the rewards colour)
 * @invariant INV-11 (44 px targets, nothing conveyed by colour alone)
 *
 * Purpose: the coin itemisation, as one component both post-match screens use.
 *
 * **Every line is named.** `06` §4 asks the post-match screen to itemise coins, and the reason is
 * trust: a player who is told "+575" and cannot see where 575 came from has been given a number,
 * not an explanation. So each award prints its own label, a multiplier prints what it multiplied by,
 * and the total is the sum of the lines above it — which the payout guarantees, and a unit test
 * asserts, so the screen can add up in public.
 *
 * A description list rather than a table: these are label/value pairs, not tabular data with
 * columns to compare down, and a screen reader announces them as the pairs they are.
 */
import { el } from '../dom.ts';
import { coinPill } from './meters.ts';
import type { Payout } from '../../economy/types.ts';

export interface PayoutPanelOptions {
  /** Defaults to "Coins earned". */
  readonly heading?: string;
  /** What to say when the payout was nothing at all. */
  readonly emptyText?: string;
}

/** How a multiplier is written: "×1.4", with the multiplication sign rather than a letter x. */
export function multiplierText(multiplier: number): string {
  return `×${multiplier.toFixed(2).replace(/\.?0+$/, '')}`;
}

export function payoutPanel(
  doc: Document,
  payout: Payout,
  options: PayoutPanelOptions = {},
): HTMLElement {
  const heading = el(doc, 'h3', {
    class: 'payout__heading',
    text: options.heading ?? 'Coins earned',
  });

  if (payout.items.length === 0) {
    return el(doc, 'section', {
      class: 'payout',
      children: [
        heading,
        el(doc, 'p', {
          class: 'payout__empty',
          text: options.emptyText ?? 'No coins for this one.',
        }),
      ],
    });
  }

  const lines: HTMLElement[] = [];
  for (const item of payout.items) {
    lines.push(
      el(doc, 'dt', {
        class: 'payout__label',
        // The multiplier is part of the label, not a third column: "All-Star ×1.4" is the sentence,
        // and the coins beside it are what it added.
        text:
          item.multiplier === undefined
            ? item.label
            : `${item.label} ${multiplierText(item.multiplier)}`,
      }),
    );
    lines.push(
      el(doc, 'dd', {
        class: 'payout__amount',
        children: [coinPill(doc, { amount: item.coins, signed: true })],
      }),
    );
  }

  return el(doc, 'section', {
    class: 'payout',
    children: [
      heading,
      el(doc, 'dl', { class: 'payout__lines', children: lines }),
      el(doc, 'p', {
        class: 'payout__total',
        children: [
          el(doc, 'span', { class: 'payout__label', text: 'Total' }),
          coinPill(doc, { amount: payout.total, signed: true }),
        ],
      }),
    ],
  });
}
