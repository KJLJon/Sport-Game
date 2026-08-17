/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.13 — Sell-back: valuation, squad-lock guard, confirmation, anti-farm invariants
 * @story   US-9.3 — Sell athletes for coins
 * @design  10-ui-ux.md §7 (Store → Sell), §10 (states and confirmation), 05-data-model.md §5.1
 * @invariant INV-11 (44 px targets; a warning is a sentence, not a colour)
 *
 * Purpose: the Sell screen. Every athlete, what they are worth, and one confirmation before any of
 * them goes.
 *
 * **Cheapest first is the wrong default and most-valuable-first is worse.** The list is sorted by
 * what the game will pay, descending, because the question a player arrives with is "what can I
 * raise" — and the athletes they must not sell by accident are at the top where the squad warning
 * is impossible to miss.
 *
 * **Every row says whether the athlete is in a squad, before the dialog does.** US-9.3 allows the
 * sale with a confirmation; it does not allow the player to be surprised by it. So the guard appears
 * twice: quietly on the row, and as the thing the dialog leads with.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { playableSport, PLAYABLE_SPORTS } from '../../sports/playable.ts';
import { sportOverall, type SportRatingTables } from '../../athletes/derivation.ts';
import { MetaKind } from '../../achievements/types.ts';
import { recordMetaEvents } from '../../achievements/session.ts';
import { quoteSale, sellDetail, type SellQuote } from '../../economy/sell.ts';
import type { Athlete } from '../../athletes/types.ts';
import type { Squad } from '../../teams/types.ts';
import type { SportId } from '../../sports/types.ts';
import { button } from '../components/button.ts';
import { athleteRow } from '../components/athlete-row.ts';
import { coinPill } from '../components/meters.ts';
import { dialog } from '../components/feedback.ts';
import { emptyState, errorState } from '../components/states.ts';
import { el } from '../dom.ts';
import './sell.css';

/** Rating tables per sport, loaded once. A price cannot be computed without them. */
async function ratingTables(): Promise<Map<SportId, SportRatingTables>> {
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

function overallFor(athlete: Athlete, tables: ReadonlyMap<SportId, SportRatingTables>): number {
  const table = tables.get(athlete.primarySport);
  // A sport this build cannot rate values at zero rather than throwing: the row still renders, the
  // price is honest about knowing nothing, and the player is not stuck on an error screen.
  return table === undefined ? 0 : sportOverall(athlete, athlete.primarySport, table).overall;
}

/**
 * One athlete, priced. The row itself is the shared `athleteRow` (T-9.1) — this screen used to
 * build its own, which is how `10` §5's list row came to have four implementations and no
 * component.
 */
function row(doc: Document, quote: SellQuote, onSell: (quote: SellQuote) => void): HTMLElement {
  const { athlete } = quote;
  const node = athleteRow(doc, {
    athlete,
    meta: `${athlete.rarity} · ${playableSport(athlete.primarySport).displayName} · worth ${quote.value.toLocaleString('en-US')}`,
    ...(quote.block === null ? {} : { warning: quote.block.message }),
    disabled: quote.hard,
    trailing: [
      coinPill(doc, { amount: quote.coins }),
      button(doc, {
        label: 'Sell',
        variant: quote.block === null ? 'secondary' : 'ghost',
        disabled: quote.hard,
        onClick: () => onSell(quote),
      }),
    ],
  });
  // The sell screen's own tests and stylesheet key off this; the guard state is the screen's, not
  // the row component's.
  node.dataset.blocked = quote.block === null ? 'false' : 'true';
  return node;
}

export function sellScreen(): Screen {
  return {
    async mount({ host, navigate }: ScreenContext): Promise<void> {
      const doc = host.ownerDocument;

      let athletes: Athlete[];
      let squads: Squad[];
      let tables: ReadonlyMap<SportId, SportRatingTables>;
      try {
        const db = await appDatabase();
        athletes = await db.athletes.getAll();
        const teams = await db.teams.getAll();
        squads = (await Promise.all(teams.map((team) => db.teams.squads(team.id)))).flat();
        tables = await ratingTables();
      } catch {
        host.replaceChildren(
          errorState(doc, {
            heading: 'Your roster could not be read',
            body: 'Try again, or repair the app from Settings. Nothing has been sold.',
            action: { label: 'Back to the Store', href: '#/store' },
          }),
        );
        return;
      }

      if (athletes.length === 0) {
        host.replaceChildren(
          emptyState(doc, {
            heading: 'Nobody to sell',
            body: 'Your roster is empty. Make an athlete, or win some coins and open a pack.',
            action: { label: 'Make an athlete', href: '#/squad/athlete/new' },
          }),
        );
        return;
      }

      const list = el(doc, 'ul', { class: 'sell-list' });

      const render = (): void => {
        const quotes = athletes
          .map((athlete) =>
            quoteSale({
              athlete,
              overall: overallFor(athlete, tables),
              squads,
              rosterSize: athletes.length,
            }),
          )
          .sort((a, b) => b.coins - a.coins);

        list.replaceChildren(...quotes.map((quote) => row(doc, quote, confirmSale)));
      };

      const commit = async (quote: SellQuote): Promise<void> => {
        const db = await appDatabase();
        // Paid first, then removed: a crash between the two leaves the player with the coins and
        // the athlete, which is a bug in their favour. The reverse loses them both.
        await db.economy.earn(quote.coins, 'sell', sellDetail(quote.athlete));
        await db.athletes.delete(quote.athlete.id);

        athletes = athletes.filter((athlete) => athlete.id !== quote.athlete.id);
        void recordMetaEvents(db, [
          {
            kind: MetaKind.ATHLETE_SOLD,
            at: Date.now(),
            athleteId: quote.athlete.id,
            detail: { coins: quote.coins, rarity: quote.athlete.rarity },
          },
          { kind: MetaKind.ROSTER_SIZE, at: Date.now(), detail: { size: athletes.length } },
        ]);

        if (athletes.length === 0) {
          navigate('/store');
          return;
        }
        render();
      };

      function confirmSale(quote: SellQuote): void {
        if (quote.hard) return;

        const box = dialog(doc, {
          title: 'Sell this athlete?',
          // The dialog takes one string, which is the right constraint: a confirmation that needs
          // two paragraphs is a confirmation the player will not read.
          body:
            quote.block === null
              ? quote.confirmation
              : `${quote.block.message} ${quote.confirmation}`,
          actions: [
            { label: 'Cancel', variant: 'ghost' },
            {
              label: `Sell for ${quote.coins.toLocaleString('en-US')}`,
              variant: 'primary',
              onSelect: () => {
                void commit(quote);
              },
            },
          ],
        });
        doc.body.appendChild(box);
        box.showModal?.();
      }

      render();
      host.replaceChildren(
        el(doc, 'section', {
          class: 'sell',
          children: [
            el(doc, 'h1', { class: 'sell__title', text: 'Sell athletes' }),
            el(doc, 'p', {
              class: 'sell__note',
              // The 35% is stated rather than discovered. A player who works it out for themselves
              // feels cheated; one who is told feels informed.
              text: 'Selling pays about a third of an athlete’s value, and cannot be undone.',
            }),
            list,
          ],
        }),
      );
    },
  };
}
