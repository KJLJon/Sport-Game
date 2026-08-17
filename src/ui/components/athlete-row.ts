/**
 * @spec    001-initial-dev
 * @phase   9 — UI/UX, accessibility, performance, data safety
 * @task    T-9.1 — Design system completion: tokens, all components, full state matrices, dev gallery
 * @story   US-13.5 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory — athlete list row), §6 (the athlete card),
 *          §11 (accessibility)
 * @invariant INV-11 (`10` §11 — nothing carried by colour alone), INV-12 (44 px targets)
 *
 * Purpose: the athlete list row `10` §5 names — the dense, one-line presentation used wherever a
 * screen shows a list of athletes rather than a grid of cards. The compact card (`10` §6) is the
 * grid form; this is the list form, and every screen that wanted one had been building its own.
 *
 * A row is never only a colour: a blocked row says why in words, and a selected row carries a rule
 * as well as a tint.
 */
import type { Athlete } from '../../athletes/types.ts';
import { el } from '../dom.ts';
import { initials } from './athlete-card.ts';

export interface AthleteRowOptions {
  readonly athlete: Athlete;
  /** The line under the name — sport, rarity, price, whatever the screen is about. */
  readonly meta?: string;
  /** Overall in the sport being looked at. Omitted when the screen is not about one. */
  readonly overall?: number;
  /** A short position or role chip. */
  readonly position?: string;
  /**
   * Why this athlete cannot be used here — "In your starting five". Said in words because a row
   * that is merely dimmed tells a colourblind player nothing (INV-11).
   */
  readonly warning?: string;
  /** Trailing controls: a price, a button, a checkbox. */
  readonly trailing?: readonly Node[];
  /** Makes the name a link to the athlete. The trailing controls stay outside it. */
  readonly href?: string;
  /** Marks the row chosen — in a multi-select, in a lineup slot picker. */
  readonly selected?: boolean;
  /** The row is present but not usable. Pairs with `warning`, which says why. */
  readonly disabled?: boolean;
  /** `li` inside a list, `div` anywhere else. Defaults to `li`. */
  readonly as?: 'li' | 'div';
}

export function athleteRow(doc: Document, options: AthleteRowOptions): HTMLElement {
  const { athlete } = options;

  const name =
    options.href === undefined
      ? el(doc, 'span', { class: 'athlete-row__name', text: athlete.displayName })
      : el(doc, 'a', {
          class: 'athlete-row__name',
          attrs: { href: options.href },
          text: athlete.displayName,
        });

  const text = el(doc, 'div', {
    class: 'athlete-row__text',
    children: [
      el(doc, 'div', {
        class: 'athlete-row__headline',
        children: [
          name,
          options.position === undefined
            ? null
            : el(doc, 'span', { class: 'athlete-row__position', text: options.position }),
        ],
      }),
      options.meta === undefined
        ? null
        : el(doc, 'p', { class: 'athlete-row__meta', text: options.meta }),
      options.warning === undefined
        ? null
        : el(doc, 'p', { class: 'athlete-row__warning', text: options.warning }),
    ],
  });

  const trailing =
    options.overall === undefined && (options.trailing ?? []).length === 0
      ? null
      : el(doc, 'div', {
          class: 'athlete-row__trailing',
          children: [
            options.overall === undefined
              ? null
              : el(doc, 'span', {
                  class: 'athlete-row__overall',
                  // The bare number means nothing on its own to a screen reader reading a list.
                  attrs: { 'aria-label': `Overall ${Math.round(options.overall)}` },
                  text: String(Math.round(options.overall)),
                }),
            ...(options.trailing ?? []),
          ],
        });

  return el(doc, options.as ?? 'li', {
    class: 'athlete-row',
    dataset: {
      rarity: athlete.rarity,
      selected: String(options.selected === true),
      disabled: String(options.disabled === true),
    },
    // `aria-disabled` rather than removing it: the row is still worth reading, and `warning` says
    // why it cannot be used. Whatever is in `trailing` disables itself.
    attrs: options.disabled === true ? { 'aria-disabled': 'true' } : {},
    children: [
      el(doc, 'span', {
        class: 'athlete-row__portrait',
        attrs: { 'aria-hidden': 'true' },
        text: initials(athlete.displayName),
      }),
      text,
      trailing,
    ],
  });
}
