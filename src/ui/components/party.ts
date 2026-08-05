/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.15 — Local player names and party flows for hot-seat across Playbook and Arcade
 * @story   US-17.3 — Be recognised by name
 * @design  09-modes-and-arcade.md §4 (hot-seat), 10-ui-ux.md §11 (labels), 08-open-questions.md Q-13
 * @invariant INV-11 (44 px targets, every control labelled)
 *
 * Purpose: the seat list — who is playing on this device, and what they are called — built once so
 * Playbook and Arcade ask it the same way.
 *
 * **The names already worked; the flows did not.** `modes/local-players.ts` has stored, seated and
 * renamed local players since T-4.11, and only the arcade hub ever offered a way to type one. A
 * Playbook hot-seat player was "Player 2" for as long as they never opened Arcade, which is exactly
 * the "rather than Player 2" that `US-17.3` is about. This is that screen's worth of controls,
 * extracted so the second caller did not become a second implementation.
 *
 * **A name is saved as it is typed.** There is no Save button, because there is no moment at which
 * a player would press one: they type a name and then start a match, and a name lost between those
 * two actions is the whole feature failing quietly.
 */
import { el } from '../dom.ts';
import {
  MAX_NAME_LENGTH,
  cleanName,
  renamePlayer,
  savePlayers,
  type LocalPlayer,
} from '../../modes/local-players.ts';

export interface SeatListOptions {
  readonly players: readonly LocalPlayer[];
  /** Called after every keystroke, with the updated list. Already persisted by then. */
  readonly onChange: (players: readonly LocalPlayer[]) => void;
  /** Overrides the per-seat label, e.g. "Player 2" vs "Seat 2". */
  readonly seatLabel?: (index: number) => string;
}

/**
 * One text field per seat, each with a real label.
 *
 * The label is visually hidden rather than absent: a row of unlabelled text fields is unusable with
 * a screen reader, and a visible "Player 2" beside a field whose value *is* the player's name reads
 * as clutter to everyone else (`10` §11).
 */
export function seatList(doc: Document, options: SeatListOptions): HTMLElement {
  let players = options.players;

  const list = el(doc, 'div', { class: 'party-seats' });

  const render = (): void => {
    list.replaceChildren(
      ...players.map((player, index) => {
        const id = `party-seat-${player.id}`;
        return el(doc, 'div', {
          class: 'party-seats__row',
          children: [
            el(doc, 'label', {
              class: 'party-seats__label',
              attrs: { for: id },
              text: options.seatLabel?.(index) ?? `Player ${index + 1}`,
            }),
            el(doc, 'input', {
              class: 'party-seats__input',
              attrs: {
                type: 'text',
                id,
                value: player.name,
                maxlength: String(MAX_NAME_LENGTH),
                // Names are people's names: the browser should not autocorrect or capitalise them
                // into something else, and it must never offer to remember them anywhere.
                autocomplete: 'off',
                autocapitalize: 'words',
                spellcheck: 'false',
              },
              on: {
                input: (event) => {
                  players = renamePlayer(
                    players,
                    player.id,
                    (event.target as HTMLInputElement).value,
                  );
                  // Persisted per keystroke. There is no Save button because there is no moment a
                  // player would press one — they type a name and start a match.
                  savePlayers(players);
                  options.onChange(players);
                },
              },
            }),
          ],
        });
      }),
    );
  };

  render();
  return list;
}

/**
 * How a seat should be announced when it is somebody's turn.
 *
 * Centralised because "whose go it is" appears in three places — the arcade hand-over, Playbook's
 * hand-over, and the results table — and three phrasings of one sentence is how a party stops
 * feeling like one game.
 */
export function seatTurnLabel(player: LocalPlayer | undefined, seat: number): string {
  return cleanName(player?.name ?? '', seat);
}
