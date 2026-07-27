/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.4 — Design tokens + primitive components + dev-only component gallery route
 * @story   US-13.2 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §10 (states that are usually forgotten), §9 (copy tone)
 *
 * Purpose: the empty, error, and loading states. `10` §10 lists these as where a family-friendly
 * app either holds up or doesn't, so each takes a plain-language explanation and exactly one
 * suggested action — never a bare spinner and never a stack trace.
 */
import { el } from '../dom.ts';
import { button, type ButtonOptions } from './button.ts';

export interface StateAction {
  readonly label: string;
  readonly variant?: ButtonOptions['variant'];
  readonly href?: string;
  readonly onSelect?: () => void;
}

export interface EmptyStateOptions {
  readonly heading: string;
  readonly body: string;
  /** Exactly one suggested action, per `10` §10. Omit only when there genuinely isn't one. */
  readonly action?: StateAction;
}

export function emptyState(doc: Document, options: EmptyStateOptions): HTMLElement {
  return el(doc, 'section', {
    class: 'empty-state',
    children: [
      el(doc, 'h2', { class: 'empty-state__heading', text: options.heading }),
      el(doc, 'p', { class: 'empty-state__body', text: options.body }),
      options.action ? actionButton(doc, options.action, 'primary') : null,
    ],
  });
}

export interface ErrorStateOptions {
  readonly heading: string;
  /** What happened, in the player's words. Never an exception message. */
  readonly body: string;
  readonly action?: StateAction;
  /** Optional technical detail, collapsed. Useful when the player reports a problem. */
  readonly detail?: string;
}

export function errorState(doc: Document, options: ErrorStateOptions): HTMLElement {
  return el(doc, 'section', {
    class: 'error-state',
    attrs: { role: 'alert' },
    children: [
      el(doc, 'h2', { class: 'error-state__heading', text: options.heading }),
      el(doc, 'p', { class: 'error-state__body', text: options.body }),
      options.action ? actionButton(doc, options.action, 'primary') : null,
      options.detail !== undefined
        ? el(doc, 'details', {
            class: 'error-state__detail',
            children: [
              el(doc, 'summary', { text: 'Technical details' }),
              el(doc, 'pre', { text: options.detail }),
            ],
          })
        : null,
    ],
  });
}

export interface SkeletonOptions {
  readonly lines?: number;
  /** Announced while content loads, so the wait isn't silent for screen readers. */
  readonly label?: string;
}

export function skeleton(doc: Document, options: SkeletonOptions = {}): HTMLElement {
  const lines = Math.max(1, options.lines ?? 3);
  return el(doc, 'div', {
    class: 'skeleton',
    attrs: { role: 'status', 'aria-label': options.label ?? 'Loading', 'aria-busy': 'true' },
    children: Array.from({ length: lines }, () =>
      el(doc, 'span', { class: 'skeleton__line', attrs: { 'aria-hidden': 'true' } }),
    ),
  });
}

function actionButton(
  doc: Document,
  action: StateAction,
  fallbackVariant: ButtonOptions['variant'],
): HTMLElement {
  const variant = action.variant ?? fallbackVariant;
  return button(doc, {
    label: action.label,
    ...(variant !== undefined ? { variant } : {}),
    ...(action.href !== undefined ? { href: action.href } : {}),
    ...(action.onSelect ? { onClick: () => action.onSelect?.() } : {}),
  });
}
