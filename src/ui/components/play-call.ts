/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.4 — Basketball play catalogue (offence + defence calls) and call-selection UI
 * @story   US-15.2 — Call plays and see them resolve
 * @design  10-ui-ux.md §8.4 (Playbook turn), §5 (component inventory — "Play-call card"),
 *          §11 (accessibility), 09-modes-and-arcade.md §2.2
 * @invariant INV-5 (no sport names here — the sheet renders whatever catalogue it is given)
 *
 * Purpose: `10` §8.4's call sheet — "your call options as three-to-six large cards along the
 * bottom", then "brief confirm-by-tap on a target athlete if the call needs one".
 *
 * **The sheet knows no sport.** It renders `CallOption`s and `PlaybookAthlete`s, both of which are
 * mode-layer types. Basketball's catalogue is `09` §2.2's table and soccer's will be its intent
 * controls; neither is named here, and adding hockey adds no code to this file.
 *
 * **Two taps, never one and a half.** A targeted call switches the sheet into its target picker
 * rather than opening anything: the same rectangle, different contents, one back affordance. A
 * sheet-over-a-sheet on a phone is where a mis-tap becomes a call you did not make.
 *
 * **Radio semantics, not buttons.** A call sheet is a single choice from a set, which is exactly
 * what a radio group is — so keyboard navigation, roving focus, and the screen reader's "3 of 6"
 * come from the platform instead of being approximated (`10` §11).
 */
import { el } from '../dom.ts';
import type { CallOption, PlaybookAthlete } from '../../modes/playbook/types.ts';
import type { EntityId } from '../../engine/world.ts';

/** What the sheet hands back once a choice is complete. */
export interface CallChoice {
  readonly call: string;
  readonly target?: EntityId;
}

export interface CallSheetOptions {
  /** The calls this side may make. Three to six of them (`10` §8.4). */
  readonly calls: readonly CallOption[];
  /** Who a targeted call may be aimed at. */
  readonly squad: readonly PlaybookAthlete[];
  /** What the opponent called last turn, shown throughout (`10` §8.4). */
  readonly opponentLastCall?: string;
  /** Hides the choice while the other player is at the device (T-5.9's hot seat). */
  readonly hidden?: boolean;
  readonly onChoose: (choice: CallChoice) => void;
}

export interface CallSheetHandle {
  readonly element: HTMLElement;
  /** Back to the call list from the target picker. The screen's back gesture calls this. */
  reset(): void;
  /** Which call is mid-selection, or `null` when the sheet is showing its list. */
  pending(): string | null;
}

const CALL_KEY_LIMIT = 2;

function callCard(
  doc: Document,
  call: CallOption,
  name: string,
  onSelect: (call: CallOption) => void,
): HTMLElement {
  const id = `call-${name}-${call.id}`;

  const input = el(doc, 'input', {
    class: 'play-call__input',
    attrs: { type: 'radio', id, name, value: call.id },
  });
  input.addEventListener('change', () => onSelect(call));

  const label = el(doc, 'label', { class: 'play-call', attrs: { for: id } });
  label.appendChild(el(doc, 'span', { class: 'play-call__name', text: call.name }));
  label.appendChild(el(doc, 'span', { class: 'play-call__blurb', text: call.blurb }));

  // The ratings a call keys off, so "best when you have a star mismatch" is checkable against the
  // roster rather than taken on faith (`09` §2.2's "keys off" column).
  const keys = el(doc, 'span', { class: 'play-call__keys' });
  for (const key of call.keys.slice(0, CALL_KEY_LIMIT)) {
    keys.appendChild(el(doc, 'span', { class: 'play-call__key', text: readableRating(key) }));
  }
  label.appendChild(keys);

  if (call.targeted === true) {
    // Said in words, not implied by an icon: the next tap is a second decision (`10` §11).
    label.appendChild(el(doc, 'span', { class: 'play-call__targeted', text: 'Pick an athlete' }));
  }

  return el(doc, 'div', { class: 'play-call__slot', children: [input, label] });
}

/** `threePoint` → `Three point`. The catalogue stores rating ids; a card shows words. */
export function readableRating(id: string): string {
  const spaced = id
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function targetButton(
  doc: Document,
  player: PlaybookAthlete,
  onPick: (id: EntityId) => void,
): HTMLElement {
  const button = el(doc, 'button', {
    class: 'play-call-target',
    attrs: { type: 'button' },
  });
  button.appendChild(
    el(doc, 'span', { class: 'play-call-target__name', text: player.athlete.displayName }),
  );
  button.appendChild(el(doc, 'span', { class: 'play-call-target__role', text: player.role }));
  button.addEventListener('click', () => onPick(player.id));
  return button;
}

/** Keeps each sheet's radio group distinct from every other's. Never read for anything else. */
let sheetCount = 0;

/**
 * The call sheet. Returns a handle rather than a bare element so the turn screen can send it back
 * to its list — a call half-chosen when the turn is force-resolved must not stay half-chosen.
 */
export function callSheet(doc: Document, options: CallSheetOptions): CallSheetHandle {
  const element = el(doc, 'section', { class: 'play-call-sheet' });
  // A counter, not the clock (T-9.1). Two sheets built in the same millisecond used to share a
  // radio-group name, which makes choosing a call in one clear the other — and it made the dev
  // gallery, the visual-regression target, render differently on every load.
  sheetCount += 1;
  const name = `call-sheet-${sheetCount}`;
  let pendingCall: CallOption | null = null;

  const renderList = (): void => {
    element.replaceChildren();

    if (options.opponentLastCall !== undefined) {
      element.appendChild(
        el(doc, 'p', {
          class: 'play-call-sheet__opponent',
          text: `They called: ${options.opponentLastCall}`,
        }),
      );
    }

    if (options.hidden === true) {
      // The hot seat's whole point is that the other player cannot see this (`09` §4).
      element.appendChild(
        el(doc, 'p', { class: 'play-call-sheet__hidden', text: 'Pass the device to call.' }),
      );
      return;
    }

    const group = el(doc, 'fieldset', { class: 'play-call-sheet__calls' });
    group.appendChild(el(doc, 'legend', { class: 'sr-only', text: 'Choose a call' }));
    for (const call of options.calls) {
      group.appendChild(callCard(doc, call, name, choose));
    }
    element.appendChild(group);
  };

  const renderTargets = (call: CallOption): void => {
    element.replaceChildren();
    element.appendChild(
      el(doc, 'p', { class: 'play-call-sheet__prompt', text: `${call.name} — pick an athlete` }),
    );

    const list = el(doc, 'div', { class: 'play-call-sheet__targets' });
    for (const player of options.squad) {
      list.appendChild(targetButton(doc, player, (target) => finish(call, target)));
    }
    element.appendChild(list);

    const back = el(doc, 'button', {
      class: 'play-call-sheet__back',
      text: 'Back to calls',
      attrs: { type: 'button' },
    });
    back.addEventListener('click', reset);
    element.appendChild(back);
  };

  function choose(call: CallOption): void {
    if (call.targeted !== true || options.squad.length === 0) {
      finish(call, undefined);
      return;
    }
    pendingCall = call;
    renderTargets(call);
  }

  function finish(call: CallOption, target: EntityId | undefined): void {
    pendingCall = null;
    options.onChoose(target === undefined ? { call: call.id } : { call: call.id, target });
    renderList();
  }

  function reset(): void {
    pendingCall = null;
    renderList();
  }

  renderList();

  return {
    element,
    reset,
    pending: () => pendingCall?.id ?? null,
  };
}
