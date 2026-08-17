/**
 * @spec    001-initial-dev
 * @phase   9 — UI/UX, accessibility, performance, data safety
 * @task    T-9.1 — Design system completion: tokens, all components, full state matrices, dev gallery
 * @story   US-13.5 — The game looks and feels designed, not assembled
 * @design  10-ui-ux.md §5 (component inventory — onboarding coach-mark), §8.1 (first launch),
 *          §11 (accessibility), §3.3 (motion)
 * @invariant INV-11 (`10` §11 — nothing carried by colour alone), INV-12 (44 px targets)
 *
 * Purpose: the coach-mark `10` §5 names — one short instruction pointed at one control, for the
 * onboarding flow T-9.3 builds on top of this.
 *
 * Two rules shape it. It never traps: it is dismissible from the keyboard, from its own button,
 * and by tapping outside, because `10` §1's "someone handed the phone at a party" will not read it.
 * And it never blocks: the control it points at stays operable underneath, so a coach-mark that
 * fails to dismiss cannot make the game unplayable.
 */
import { el } from '../dom.ts';

export type CoachMarkPlacement = 'above' | 'below';

export interface CoachMarkOptions {
  /** Two or three words. A coach-mark that needs a heading is a sheet. */
  readonly title?: string;
  /** One sentence, in the second person: "Tap here to start a match." */
  readonly body: string;
  /** Which side of the target it sits on. The arrow follows. */
  readonly placement?: CoachMarkPlacement;
  /** "Got it" by default — dismissal is always a real, labelled, 44 px button. */
  readonly dismissLabel?: string;
  readonly onDismiss?: () => void;
  /** "3 of 5", for a sequence. Said in words, never as a row of dots alone (INV-11). */
  readonly step?: { readonly index: number; readonly total: number };
}

export interface CoachMarkHandle {
  readonly element: HTMLElement;
  /** Removes it and fires `onDismiss` once, however the dismissal arrived. */
  readonly dismiss: () => void;
}

export function coachMark(doc: Document, options: CoachMarkOptions): CoachMarkHandle {
  let dismissed = false;

  const dismissButton = el(doc, 'button', {
    class: 'button button--primary coach-mark__dismiss',
    attrs: { type: 'button' },
    text: options.dismissLabel ?? 'Got it',
  });

  const element = el(doc, 'div', {
    class: 'coach-mark',
    dataset: { placement: options.placement ?? 'below' },
    attrs: {
      // A tip, not a dialog: `role="dialog"` would imply a modal that must be answered, and this
      // one can be ignored. `polite` so it does not interrupt whatever is being read.
      role: 'note',
      'aria-live': 'polite',
    },
    children: [
      el(doc, 'span', { class: 'coach-mark__arrow', attrs: { 'aria-hidden': 'true' } }),
      el(doc, 'div', {
        class: 'coach-mark__body',
        children: [
          options.step === undefined
            ? null
            : el(doc, 'p', {
                class: 'coach-mark__step',
                text: `Step ${options.step.index} of ${options.step.total}`,
              }),
          options.title === undefined
            ? null
            : el(doc, 'p', { class: 'coach-mark__title', text: options.title }),
          el(doc, 'p', { class: 'coach-mark__text', text: options.body }),
          dismissButton,
        ],
      }),
    ],
  });

  function dismiss(): void {
    if (dismissed) return;
    dismissed = true;
    element.remove();
    options.onDismiss?.();
  }

  dismissButton.addEventListener('click', dismiss);
  // Escape reaches it wherever focus happens to be inside the mark.
  element.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') {
      event.stopPropagation();
      dismiss();
    }
  });

  return { element, dismiss };
}
