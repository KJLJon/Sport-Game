/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.12 — Packs: tiers, prices, published odds, pity timers, reveal animation with skip
 * @story   US-9.2 — Open packs to earn new athletes
 * @design  05-data-model.md §5.2, 10-ui-ux.md §7 (Store → Packs → opening), §10 (states),
 *          §11 (44 px targets, reduced motion)
 * @invariant INV-11 (odds are a table a screen reader can read, not an image)
 *
 * Purpose: the four packs, their published odds, and the reveal.
 *
 * **The odds are on the purchase screen, before the button.** US-9.2 requires it and it is also the
 * only honest way to sell a random box. They are rendered from `PACKS` itself rather than from a
 * copy, so the number on the screen and the number in the roll cannot drift apart.
 *
 * **The reveal is a presentation of a result that already exists.** `openPack` returns every
 * athlete before the first card turns, so Skip shows what you already had rather than hurrying a
 * roll — and the animation can be dropped entirely under `prefers-reduced-motion` without changing
 * a single outcome.
 *
 * **The pity counter is shown, not hidden.** "Rare or better guaranteed within 4 more" is the sort
 * of thing a game usually keeps secret; saying it costs nothing and is the difference between a
 * mechanic and a trick.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { PACKS, PACK_ORDER, oddsText, pityRemaining, publishedOdds } from '../../economy/packs.ts';
import { isRefusal, openPack, type OpenedPack } from '../../economy/open-pack.ts';
import { MetaKind } from '../../achievements/types.ts';
import { recordMetaEvents } from '../../achievements/session.ts';
import type { EconomyState, PackTier } from '../../economy/types.ts';
import { button } from '../components/button.ts';
import { coinPill } from '../components/meters.ts';
import { errorState } from '../components/states.ts';
import { el } from '../dom.ts';
import { reducedMotion } from '../../app/motion.ts';
import './packs.css';

/** How long each card waits before the next turns over. Zero under reduced motion. */
export const REVEAL_STEP_MS = 550;

function oddsTable(doc: Document, tier: PackTier): HTMLElement {
  const def = PACKS[tier];
  return el(doc, 'table', {
    class: 'pack__odds',
    children: [
      el(doc, 'caption', { text: `${def.name} odds per card` }),
      el(doc, 'tbody', {
        children: publishedOdds(def).map((row) =>
          el(doc, 'tr', {
            children: [
              el(doc, 'th', { attrs: { scope: 'row' }, text: row.rarity }),
              el(doc, 'td', { text: oddsText(row.chance) }),
            ],
          }),
        ),
      }),
    ],
  });
}

function pityLine(tier: PackTier, state: EconomyState): string {
  const def = PACKS[tier];
  const left = pityRemaining(tier, state.pity);
  if (left <= 1) return `${def.pityFloor} or better guaranteed in your next ${def.name}.`;
  return `${def.pityFloor} or better guaranteed within ${left} more ${def.name} packs.`;
}

export function packsScreen(): Screen {
  return {
    async mount({ host }: ScreenContext): Promise<void> {
      const doc = host.ownerDocument;
      const reduced = reducedMotion(doc.defaultView);

      let state: EconomyState;
      try {
        state = await (await appDatabase()).economy.state();
      } catch {
        host.replaceChildren(
          errorState(doc, {
            heading: 'The store could not be opened',
            body: 'Try again, or repair the app from Settings. Nothing has been charged.',
            action: { label: 'Back to the Store', href: '#/store' },
          }),
        );
        return;
      }

      const status = el(doc, 'p', { class: 'packs__status', attrs: { 'aria-live': 'polite' } });
      const reveal = el(doc, 'section', { class: 'packs__reveal' });
      const grid = el(doc, 'div', { class: 'packs__grid' });
      const timers: ReturnType<typeof setTimeout>[] = [];

      const renderReveal = (opened: OpenedPack, shown: number): void => {
        const def = PACKS[opened.tier];
        reveal.replaceChildren(
          el(doc, 'h2', {
            class: 'packs__reveal-title',
            text: opened.free ? `${def.name} pack — free` : `${def.name} pack`,
          }),
          ...(opened.roll.pityTriggered
            ? [
                el(doc, 'p', {
                  class: 'packs__pity-hit',
                  text: `Guaranteed ${def.pityFloor} or better — the counter reset.`,
                }),
              ]
            : []),
          el(doc, 'ul', {
            class: 'packs__cards',
            children: opened.athletes.slice(0, shown).map((entry) =>
              el(doc, 'li', {
                class: 'packs__card',
                dataset: { rarity: entry.athlete.rarity },
                children: [
                  el(doc, 'p', { class: 'packs__card-name', text: entry.athlete.displayName }),
                  el(doc, 'p', {
                    class: 'packs__card-meta',
                    text: `${entry.athlete.rarity} · ${entry.archetype.label}`,
                  }),
                ],
              }),
            ),
          }),
          ...(shown < opened.athletes.length
            ? [
                button(doc, {
                  label: 'Skip',
                  variant: 'ghost',
                  onClick: () => {
                    for (const timer of timers) clearTimeout(timer);
                    timers.length = 0;
                    renderReveal(opened, opened.athletes.length);
                  },
                }),
              ]
            : [
                el(doc, 'p', {
                  class: 'packs__reveal-done',
                  text: `${opened.athletes.length} athletes added to your roster.`,
                }),
                button(doc, { label: 'See them', variant: 'secondary', href: '#/squad' }),
              ]),
        );
      };

      const startReveal = (opened: OpenedPack): void => {
        if (reduced) {
          // Reduced motion means the whole pack at once. The result is identical either way, which
          // is the point of rolling before revealing.
          renderReveal(opened, opened.athletes.length);
          return;
        }
        renderReveal(opened, 1);
        for (let index = 2; index <= opened.athletes.length; index += 1) {
          timers.push(
            setTimeout(
              () => {
                renderReveal(opened, index);
              },
              REVEAL_STEP_MS * (index - 1),
            ),
          );
        }
      };

      const buy = async (tier: PackTier): Promise<void> => {
        status.textContent = 'Opening…';
        const db = await appDatabase();
        const result = await openPack({ db, tier });

        if (isRefusal(result)) {
          status.textContent = result.message;
          return;
        }

        state = await db.economy.state();
        status.textContent = '';
        renderGrid();
        startReveal(result);

        const at = Date.now();
        void recordMetaEvents(db, [
          { kind: MetaKind.PACK_OPENED, at, detail: { tier, free: result.free } },
          ...result.athletes.map((entry) => ({
            kind: MetaKind.ATHLETE_ACQUIRED,
            at,
            athleteId: entry.athlete.id,
            detail: { rarity: entry.athlete.rarity, from: 'pack', tier },
          })),
          { kind: MetaKind.ROSTER_SIZE, at, detail: { size: await db.athletes.count() } },
        ]);
      };

      function renderGrid(): void {
        grid.replaceChildren(
          ...PACK_ORDER.map((tier) => {
            const def = PACKS[tier];
            const owed = state.owedPacks.filter((entry) => entry === tier).length;
            const affordable = owed > 0 || state.balance >= def.price;

            return el(doc, 'article', {
              class: 'pack',
              dataset: { tier },
              children: [
                el(doc, 'h2', { class: 'pack__name', text: def.name }),
                el(doc, 'p', {
                  class: 'pack__price',
                  children:
                    owed > 0
                      ? [el(doc, 'span', { class: 'pack__free', text: `${owed} free` })]
                      : [coinPill(doc, { amount: def.price })],
                }),
                el(doc, 'p', { class: 'pack__cards', text: `${def.cards} athletes` }),
                oddsTable(doc, tier),
                el(doc, 'p', { class: 'pack__pity', text: pityLine(tier, state) }),
                button(doc, {
                  label:
                    owed > 0
                      ? 'Open your free pack'
                      : `Buy for ${def.price.toLocaleString('en-US')}`,
                  variant: 'primary',
                  disabled: !affordable,
                  onClick: () => {
                    void buy(tier);
                  },
                }),
                affordable
                  ? null
                  : el(doc, 'p', {
                      class: 'pack__short',
                      text: `${(def.price - state.balance).toLocaleString('en-US')} coins short.`,
                    }),
              ],
            });
          }),
        );
      }

      renderGrid();
      host.replaceChildren(
        el(doc, 'section', {
          class: 'packs',
          children: [
            el(doc, 'h1', { class: 'packs__title', text: 'Packs' }),
            el(doc, 'p', {
              class: 'packs__balance',
              children: [
                el(doc, 'span', { text: 'Balance ' }),
                coinPill(doc, { amount: state.balance }),
              ],
            }),
            status,
            reveal,
            grid,
          ],
        }),
      );
    },
  };
}
