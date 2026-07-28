/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.4 — Design tokens + primitive components + dev-only component gallery route
 * @story   US-13.2 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §3 (show don't tell), §5 (component inventory), §11 (accessibility)
 *
 * Purpose: the quantity primitives — rating bar, progress bar, familiarity ring, star rating,
 * coin pill. `10` §11 forbids conveying anything by colour alone, so each carries a text or
 * shape channel as well as its fill.
 */
import { clamp01, el, percent, svg } from '../dom.ts';

export interface RatingBarOptions {
  readonly label: string;
  /** 0–99, the derived-rating range used throughout (`05` §3). */
  readonly value: number;
  /** Marks a rating dragged down by low familiarity, so the bar can say why (`10` §6). */
  readonly tone?: 'neutral' | 'strong' | 'weak';
  /** Hide the number for compact contexts. The value stays in `aria-valuenow`. */
  readonly hideValue?: boolean;
}

const RATING_MAX = 99;

export function ratingBar(doc: Document, options: RatingBarOptions): HTMLElement {
  const value = Math.round(Math.min(RATING_MAX, Math.max(0, options.value)));
  const fraction = value / RATING_MAX;

  const fill = el(doc, 'div', { class: 'rating-bar__fill' });
  fill.style.setProperty('--fill', percent(fraction));

  return el(doc, 'div', {
    class: 'rating-bar',
    dataset: { tone: options.tone ?? 'neutral' },
    children: [
      el(doc, 'span', { class: 'rating-bar__label', text: options.label }),
      el(doc, 'div', {
        class: 'rating-bar__track',
        attrs: {
          role: 'meter',
          'aria-label': options.label,
          'aria-valuemin': 0,
          'aria-valuemax': RATING_MAX,
          'aria-valuenow': value,
        },
        children: [fill],
      }),
      options.hideValue === true
        ? null
        : el(doc, 'span', { class: 'rating-bar__value', text: String(value) }),
    ],
  });
}

export interface ProgressBarOptions {
  readonly label: string;
  /** 0–1. Omit for an indeterminate bar — "downloading, size unknown". */
  readonly value?: number;
  /** Replaces the percentage, e.g. `"820 / 1000 XP"`. */
  readonly valueText?: string;
}

export function progressBar(doc: Document, options: ProgressBarOptions): HTMLElement {
  const indeterminate = options.value === undefined;
  const fraction = clamp01(options.value ?? 0);

  const fill = el(doc, 'div', { class: 'progress-bar__fill' });
  fill.style.setProperty('--fill', percent(fraction));

  return el(doc, 'div', {
    class: 'progress-bar',
    dataset: indeterminate ? { indeterminate: 'true' } : {},
    children: [
      el(doc, 'div', {
        class: 'progress-bar__head',
        children: [
          el(doc, 'span', { class: 'progress-bar__label', text: options.label }),
          el(doc, 'span', {
            class: 'progress-bar__value',
            text: options.valueText ?? (indeterminate ? '' : percent(fraction)),
          }),
        ],
      }),
      el(doc, 'div', {
        class: 'progress-bar__track',
        attrs: {
          role: 'progressbar',
          'aria-label': options.label,
          'aria-valuemin': indeterminate ? null : 0,
          'aria-valuemax': indeterminate ? null : 100,
          'aria-valuenow': indeterminate ? null : Math.round(fraction * 100),
          'aria-valuetext': options.valueText ?? null,
        },
        children: [fill],
      }),
    ],
  });
}

/** Plain-language familiarity ranks (`10` §6). The ring never shows a bare number alone. */
export const FAMILIARITY_RANKS = [
  'Novice',
  'Learning',
  'Competent',
  'Comfortable',
  'Natural',
] as const;

export type FamiliarityRank = (typeof FAMILIARITY_RANKS)[number];

/** Maps a 0–1 familiarity to its rank. Boundaries are even fifths. */
export function familiarityRank(value: number): FamiliarityRank {
  const index = Math.min(
    FAMILIARITY_RANKS.length - 1,
    Math.floor(clamp01(value) * FAMILIARITY_RANKS.length),
  );
  return FAMILIARITY_RANKS[index] ?? 'Novice';
}

export interface FamiliarityRingOptions {
  /** 0–1. */
  readonly value: number;
  readonly sport: string;
  readonly size?: number;
  /**
   * Overrides the rank word. The athlete layer's bands (`05` §3.3, T-3.4) are not even fifths, so
   * a caller that has a real athlete passes the real band rather than letting this recompute a
   * different one — a ring reading "Natural" beside text reading "Comfortable" is worse than
   * either being wrong alone.
   */
  readonly rank?: string;
}

export function familiarityRing(doc: Document, options: FamiliarityRingOptions): HTMLElement {
  const value = clamp01(options.value);
  const size = options.size ?? 56;
  const radius = size / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const rank = options.rank ?? familiarityRank(value);
  const label = `${options.sport} familiarity: ${rank}, ${percent(value)}`;

  const track = svg(doc, 'circle', {
    class: 'familiarity-ring__track',
    cx: String(size / 2),
    cy: String(size / 2),
    r: String(radius),
  });

  const fill = svg(doc, 'circle', {
    class: 'familiarity-ring__fill',
    cx: String(size / 2),
    cy: String(size / 2),
    r: String(radius),
    'stroke-dasharray': `${circumference}`,
    'stroke-dashoffset': `${circumference * (1 - value)}`,
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
  });

  return el(doc, 'div', {
    class: 'familiarity-ring',
    attrs: { role: 'img', 'aria-label': label },
    children: [
      svg(doc, 'svg', { viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }, [track, fill]),
      el(doc, 'span', { class: 'familiarity-ring__rank', text: rank }),
    ],
  });
}

export interface StarRatingOptions {
  /** Whole stars earned. */
  readonly value: number;
  readonly max?: number;
  readonly label?: string;
}

const STAR_PATH = 'M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z';

export function starRating(doc: Document, options: StarRatingOptions): HTMLElement {
  const max = options.max ?? 3;
  const value = Math.min(max, Math.max(0, Math.round(options.value)));
  const label = options.label ?? `${value} of ${max} stars`;

  const stars = Array.from({ length: max }, (_, index) =>
    svg(doc, 'svg', { viewBox: '0 0 24 24', class: index < value ? 'is-earned' : '' }, [
      svg(doc, 'path', { d: STAR_PATH }),
    ]),
  );

  return el(doc, 'div', {
    class: 'star-rating',
    attrs: { role: 'img', 'aria-label': label },
    children: stars,
  });
}

export interface CoinPillOptions {
  readonly amount: number;
  /** Renders `+250` / `−250` for rewards and costs. */
  readonly signed?: boolean;
}

const COIN_PATH =
  'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4l1.6 3.4 3.4.4-2.6 2.3.8 3.4L12 13.8 8.8 15.5l.8-3.4L7 9.8l3.4-.4z';

export function coinPill(doc: Document, options: CoinPillOptions): HTMLElement {
  const amount = Math.round(options.amount);
  const formatted = Math.abs(amount).toLocaleString('en-US');
  // U+2212 MINUS SIGN, not a hyphen — it aligns with tabular figures.
  const sign = options.signed === true ? (amount < 0 ? '−' : '+') : '';
  const text = `${sign}${formatted}`;

  return el(doc, 'span', {
    class: 'coin-pill',
    dataset: { tone: amount < 0 ? 'debit' : 'credit' },
    attrs: { 'aria-label': `${text} coins` },
    children: [
      svg(doc, 'svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
        svg(doc, 'path', { d: COIN_PATH }),
      ]),
      el(doc, 'span', { class: 'coin-pill__amount', text, attrs: { 'aria-hidden': 'true' } }),
    ],
  });
}
