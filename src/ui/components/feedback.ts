/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.4 — Design tokens + primitive components + dev-only component gallery route
 * @story   US-13.2 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory), §9 (copy tone), §11 (accessibility)
 *
 * Purpose: dialog, sheet, toast, and banner. `11` §4 requires the update prompt to be a bottom
 * banner and never a modal, so banners are a first-class primitive here rather than a dialog
 * with the edges filed off.
 */
import { el } from '../dom.ts';
import { button, type ButtonOptions } from './button.ts';

/** Distinguishes one dialog's title id from another's. Never read for anything else. */
let dialogCount = 0;

export interface DialogAction {
  readonly label: string;
  readonly variant?: ButtonOptions['variant'];
  readonly onSelect?: () => void;
}

export interface DialogOptions {
  readonly title: string;
  readonly body: string;
  readonly actions: readonly DialogAction[];
  /** A dialog with no dismiss path is reserved for forced updates (`11` §4). */
  readonly dismissible?: boolean;
  readonly onDismiss?: () => void;
}

/**
 * Returns a `<dialog>`. The caller appends it and calls `showModal()`; keeping open/close with
 * the caller means the same element can be reused rather than rebuilt per open.
 */
export function dialog(doc: Document, options: DialogOptions): HTMLDialogElement {
  const dismissible = options.dismissible ?? true;
  // A counter, not `performance.now()` (T-9.1): two dialogs built inside the same millisecond used
  // to share an id, which points the second one's `aria-labelledby` at the first one's title. It
  // also made the dev gallery — the visual-regression target — render differently on every load.
  dialogCount += 1;
  const titleId = `dialog-title-${dialogCount}`;

  const node = el(doc, 'dialog', {
    class: 'dialog',
    attrs: { 'aria-labelledby': titleId },
    children: [
      el(doc, 'h2', { class: 'dialog__title', text: options.title, attrs: { id: titleId } }),
      el(doc, 'p', { class: 'dialog__body', text: options.body }),
      el(doc, 'div', {
        class: 'dialog__actions',
        children: options.actions.map((action) =>
          button(doc, {
            label: action.label,
            variant: action.variant ?? 'secondary',
            ...(action.onSelect ? { onClick: () => action.onSelect?.() } : {}),
          }),
        ),
      }),
    ],
  }) as HTMLDialogElement;

  node.addEventListener('cancel', (event) => {
    if (!dismissible) {
      event.preventDefault();
      return;
    }
    options.onDismiss?.();
  });

  return node;
}

export type SheetHeight = 'half' | 'full';

export interface SheetOptions {
  readonly title: string;
  readonly height?: SheetHeight;
  readonly children: readonly Node[];
  readonly onClose?: () => void;
}

export function sheet(doc: Document, options: SheetOptions): HTMLElement {
  return el(doc, 'section', {
    class: 'sheet',
    dataset: { height: options.height ?? 'half' },
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title },
    children: [
      el(doc, 'header', {
        class: 'sheet__header',
        children: [
          el(doc, 'span', { class: 'sheet__grip', attrs: { 'aria-hidden': 'true' } }),
          el(doc, 'h2', { class: 'sheet__title', text: options.title }),
          button(doc, {
            label: 'Close',
            variant: 'icon',
            icon: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
            ...(options.onClose ? { onClick: () => options.onClose?.() } : {}),
          }),
        ],
      }),
      el(doc, 'div', { class: 'sheet__body', children: options.children }),
    ],
  });
}

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  readonly message: string;
  readonly tone?: ToastTone;
  readonly action?: { readonly label: string; readonly onSelect: () => void };
}

export function toast(doc: Document, options: ToastOptions): HTMLElement {
  const tone = options.tone ?? 'neutral';
  return el(doc, 'div', {
    class: 'toast',
    dataset: { tone },
    // Anything the player must act on is assertive; the rest must not interrupt.
    attrs: { role: 'status', 'aria-live': tone === 'danger' ? 'assertive' : 'polite' },
    children: [
      el(doc, 'span', { class: 'toast__message', text: options.message }),
      options.action
        ? button(doc, {
            label: options.action.label,
            variant: 'ghost',
            onClick: () => options.action?.onSelect(),
          })
        : null,
    ],
  });
}

export interface BannerAction {
  readonly label: string;
  readonly variant?: ButtonOptions['variant'];
  readonly onSelect: () => void;
}

export interface BannerOptions {
  readonly message: string;
  readonly tone?: ToastTone;
  readonly actions: readonly BannerAction[];
}

/**
 * The bottom banner. `11` §4: the update prompt is a banner, never a modal, and never during a
 * match — so this primitive has no backdrop and does not trap focus.
 */
export function banner(doc: Document, options: BannerOptions): HTMLElement {
  return el(doc, 'div', {
    class: 'banner',
    dataset: { tone: options.tone ?? 'neutral' },
    attrs: { role: 'status' },
    children: [
      el(doc, 'p', { class: 'banner__message', text: options.message }),
      el(doc, 'div', {
        class: 'banner__actions',
        children: options.actions.map((action) =>
          button(doc, {
            label: action.label,
            variant: action.variant ?? 'ghost',
            onClick: () => action.onSelect(),
          }),
        ),
      }),
    ],
  });
}
