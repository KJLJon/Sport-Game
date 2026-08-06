/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.14 — Transfer market: rotating listings, tamper-resistant refresh, paid refreshes,
 *          buy-offers, seeded price walk
 * @story   US-9.4 — Work the transfer market
 * @design  10-ui-ux.md §7 (Store → Market), §10 (states), 05-data-model.md §5.4
 * @invariant INV-11 (44 px targets; a price is never the only thing a row says)
 *
 * Purpose: six athletes for sale, two offers for yours, and a clock.
 *
 * **The next free refresh is a time, not a mystery.** "New listings in 2h 14m" is the difference
 * between a market that rotates and a market that seems broken, and it is also what makes the paid
 * refresh an *option* rather than the only way to see anything new.
 *
 * **Nothing here mentions real money, ever.** `05` §5.4 — "never with real money" — and the paid
 * refreshes are priced in coins the player earned by playing.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { appDatabase } from '../../storage/app-db.ts';
import {
  acceptOffer,
  buyListing,
  readMarket,
  refreshForCoins,
  type MarketView,
} from '../../economy/market-service.ts';
import { REFRESH_INTERVAL_MS } from '../../economy/market.ts';
import { MetaKind } from '../../achievements/types.ts';
import { recordMetaEvents } from '../../achievements/session.ts';
import { valueFor } from '../../economy/sell.ts';
import { playableSport } from '../../sports/playable.ts';
import { button } from '../components/button.ts';
import { coinPill } from '../components/meters.ts';
import { emptyState, errorState } from '../components/states.ts';
import { el } from '../dom.ts';
import './market.css';

/** "2h 14m", or "any moment now" for the last minute. */
export function untilText(millis: number): string {
  if (millis <= 60_000) return 'any moment now';
  const minutes = Math.round(millis / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `in ${minutes}m` : `in ${hours}h ${minutes % 60}m`;
}

export function nextRefreshIn(view: MarketView, now: number): number {
  return Math.max(0, view.state.lastRefresh + REFRESH_INTERVAL_MS - now);
}

export function marketScreen(): Screen {
  return {
    async mount({ host }: ScreenContext): Promise<void> {
      const doc = host.ownerDocument;
      let view: MarketView;

      try {
        view = await readMarket(await appDatabase());
      } catch {
        host.replaceChildren(
          errorState(doc, {
            heading: 'The market could not be opened',
            body: 'Try again, or repair the app from Settings. Nothing has been bought or sold.',
            action: { label: 'Back to the Store', href: '#/store' },
          }),
        );
        return;
      }

      const status = el(doc, 'p', { class: 'market__status', attrs: { 'aria-live': 'polite' } });
      const board = el(doc, 'div', { class: 'market__board' });

      const reload = async (message: string): Promise<void> => {
        view = await readMarket(await appDatabase());
        status.textContent = message;
        render();
      };

      const buy = async (index: number): Promise<void> => {
        const entry = view.listings[index];
        if (entry === undefined) return;
        status.textContent = 'Buying…';

        const db = await appDatabase();
        const athlete = await buyListing(db, entry.listing);
        if (athlete === null) {
          await reload('That did not go through — check your balance.');
          return;
        }

        const at = Date.now();
        void recordMetaEvents(db, [
          {
            kind: MetaKind.MARKET_PURCHASE,
            at,
            athleteId: athlete.id,
            detail: {
              rarity: athlete.rarity,
              price: entry.listing.ask,
              // What the screen showed as "worth": below 0.95 is `05` §6's Bargain Hunter.
              priceRatio: entry.listing.ask / Math.max(1, valueFor(athlete, 0) || 1),
            },
          },
          {
            kind: MetaKind.ATHLETE_ACQUIRED,
            at,
            athleteId: athlete.id,
            detail: { rarity: athlete.rarity, from: 'market' },
          },
          { kind: MetaKind.ROSTER_SIZE, at, detail: { size: await db.athletes.count() } },
        ]);

        await reload(`${athlete.displayName} joined your roster.`);
      };

      const sell = async (index: number): Promise<void> => {
        const entry = view.offers[index];
        if (entry === undefined) return;
        status.textContent = 'Selling…';

        const db = await appDatabase();
        const done = await acceptOffer(db, entry.athlete, entry.coins);
        if (!done) {
          await reload('That offer is no longer on the table.');
          return;
        }

        const at = Date.now();
        void recordMetaEvents(db, [
          {
            kind: MetaKind.ATHLETE_SOLD,
            at,
            athleteId: entry.athlete.id,
            detail: { coins: entry.coins, rarity: entry.athlete.rarity, via: 'market' },
          },
          { kind: MetaKind.ROSTER_SIZE, at, detail: { size: await db.athletes.count() } },
        ]);

        await reload(
          `${entry.athlete.displayName} sold for ${entry.coins.toLocaleString('en-US')}.`,
        );
      };

      const payToRefresh = async (): Promise<void> => {
        status.textContent = 'Refreshing…';
        const refreshed = await refreshForCoins(await appDatabase());
        if (refreshed === null) {
          await reload("That refresh could not be bought — you may have used today's three.");
          return;
        }
        view = refreshed;
        status.textContent = 'New listings.';
        render();
      };

      function render(): void {
        const now = Date.now();

        board.replaceChildren(
          el(doc, 'p', {
            class: 'market__timer',
            text: `New listings ${untilText(nextRefreshIn(view, now))}.`,
          }),
          el(doc, 'div', {
            class: 'market__refresh',
            children: [
              view.paidPrice === null
                ? el(doc, 'p', {
                    class: 'market__refresh-note',
                    text: 'You have used all three paid refreshes today.',
                  })
                : button(doc, {
                    label: `Refresh now for ${view.paidPrice.toLocaleString('en-US')}`,
                    variant: 'secondary',
                    disabled: view.balance < view.paidPrice,
                    onClick: () => {
                      void payToRefresh();
                    },
                  }),
            ],
          }),

          el(doc, 'h2', { class: 'market__heading', text: 'For sale' }),
          view.listings.length === 0
            ? el(doc, 'p', { class: 'market__empty', text: 'Nothing listed right now.' })
            : el(doc, 'ul', {
                class: 'market-list',
                children: view.listings.map((entry, index) =>
                  el(doc, 'li', {
                    class: 'market-row',
                    dataset: { rarity: entry.athlete.rarity },
                    children: [
                      el(doc, 'div', {
                        class: 'market-row__text',
                        children: [
                          el(doc, 'p', {
                            class: 'market-row__name',
                            text: entry.athlete.displayName,
                          }),
                          el(doc, 'p', {
                            class: 'market-row__meta',
                            text: `${entry.athlete.rarity} · ${playableSport(entry.listing.sport).displayName}`,
                          }),
                        ],
                      }),
                      el(doc, 'div', {
                        class: 'market-row__actions',
                        children: [
                          coinPill(doc, { amount: entry.listing.ask }),
                          button(doc, {
                            label: 'Buy',
                            variant: 'primary',
                            disabled: view.balance < entry.listing.ask,
                            onClick: () => {
                              void buy(index);
                            },
                          }),
                        ],
                      }),
                    ],
                  }),
                ),
              }),

          el(doc, 'h2', { class: 'market__heading', text: 'Offers for your athletes' }),
          view.offers.length === 0
            ? el(doc, 'p', {
                class: 'market__empty',
                text: 'No offers this rotation. They change with the listings.',
              })
            : el(doc, 'ul', {
                class: 'market-list',
                children: view.offers.map((entry, index) =>
                  el(doc, 'li', {
                    class: 'market-row',
                    children: [
                      el(doc, 'div', {
                        class: 'market-row__text',
                        children: [
                          el(doc, 'p', {
                            class: 'market-row__name',
                            text: entry.athlete.displayName,
                          }),
                          el(doc, 'p', {
                            class: 'market-row__meta',
                            text: `${entry.athlete.rarity} · someone wants them`,
                          }),
                        ],
                      }),
                      el(doc, 'div', {
                        class: 'market-row__actions',
                        children: [
                          coinPill(doc, { amount: entry.coins, signed: true }),
                          button(doc, {
                            label: 'Accept',
                            variant: 'secondary',
                            onClick: () => {
                              void sell(index);
                            },
                          }),
                        ],
                      }),
                    ],
                  }),
                ),
              }),
        );
      }

      if (view.listings.length === 0 && view.offers.length === 0) {
        host.replaceChildren(
          emptyState(doc, {
            heading: 'The market is empty',
            body: 'It rotates every four hours. Come back, or buy a refresh from the Store.',
            action: { label: 'Back to the Store', href: '#/store' },
          }),
        );
        return;
      }

      render();
      host.replaceChildren(
        el(doc, 'section', {
          class: 'market',
          children: [
            el(doc, 'h1', { class: 'market__title', text: 'Transfer market' }),
            el(doc, 'p', {
              class: 'market__balance',
              children: [
                el(doc, 'span', { text: 'Balance ' }),
                coinPill(doc, { amount: view.balance }),
              ],
            }),
            status,
            board,
          ],
        }),
      );
    },
  };
}
