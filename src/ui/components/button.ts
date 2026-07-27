/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.4 — Design tokens + primitive components + dev-only component gallery route
 * @story   US-13.2 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory), §3.2 (targets), §11 (accessibility)
 *
 * Purpose: the button primitive in all five variants, with the full state matrix — default,
 * pressed, disabled, loading, focus. Loading is a state of the same element rather than a
 * swap, so the button never changes size under the player's thumb mid-tap.
 */
import { el, svg } from '../dom.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'icon';
export type ButtonSize = 'regular' | 'large';

export interface ButtonOptions {
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  /** Inline SVG path data. Required for the `icon` variant, which hides the label visually. */
  readonly icon?: string;
  /** Renders an anchor instead of a button. Use for real navigation, so links stay links. */
  readonly href?: string;
  readonly onClick?: (event: Event) => void;
}

export function button(doc: Document, options: ButtonOptions): HTMLElement {
  const variant = options.variant ?? 'primary';
  const size = options.size ?? 'regular';
  const loading = options.loading ?? false;
  const disabled = (options.disabled ?? false) || loading;

  const classes = ['button', `button--${variant}`, size === 'large' && 'button--large']
    .filter(Boolean)
    .join(' ');

  const children = [
    options.icon !== undefined
      ? svg(doc, 'svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, [
          svg(doc, 'path', { d: options.icon }),
        ])
      : null,
    el(doc, 'span', {
      class: variant === 'icon' ? 'sr-only' : 'button__label',
      text: options.label,
    }),
    // Announced by the accessible name change, not by the spinner, which is decorative.
    loading
      ? el(doc, 'span', { class: 'button__spinner', attrs: { 'aria-hidden': 'true' } })
      : null,
  ];

  if (options.href !== undefined) {
    return el(doc, 'a', {
      class: classes,
      attrs: {
        href: options.href,
        'aria-disabled': disabled ? 'true' : null,
        'aria-busy': loading ? 'true' : null,
      },
      children,
      ...(options.onClick ? { on: { click: options.onClick } } : {}),
    });
  }

  return el(doc, 'button', {
    class: classes,
    attrs: {
      type: 'button',
      disabled,
      'aria-busy': loading ? 'true' : null,
    },
    children,
    ...(options.onClick ? { on: { click: options.onClick } } : {}),
  });
}
