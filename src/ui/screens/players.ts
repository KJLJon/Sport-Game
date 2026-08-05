/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.15 — Local player names and party flows for hot-seat across Playbook and Arcade
 * @story   US-17.3 — Be recognised by name
 * @design  10-ui-ux.md §9 (settings), §10 (states), 08-open-questions.md Q-13
 * @invariant INV-3 (names live in preferences, never in the database or a backup)
 *
 * Purpose: Settings → People. The one place the names on this device can be reviewed, changed, or
 * removed outright.
 *
 * **This is the "at any time" half of `US-17.3`**, and it was the missing one. `forgetPlayers()` has
 * existed since T-4.11 with **no caller**: names could be typed on the arcade hub and after that
 * there was nowhere in the app to take them back out. A name somebody typed once about a person who
 * no longer plays — an ex, a child who has grown up, a friend — with no way to remove it is a small
 * thing that is entirely the wrong side of the line this project keeps.
 *
 * **They were never anywhere else to begin with.** `US-17.3` says local only, so the names sit in
 * preferences rather than in IndexedDB: they are not in a backup, not in a roster export, and not in
 * a P2P handshake. Removing them here removes them, and the screen says so rather than asking anyone
 * to take it on trust.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { el } from '../dom.ts';
import { button } from '../components/button.ts';
import { seatList } from '../components/party.ts';
import {
  PARTY_LIMITS,
  forgetPlayers,
  loadPlayers,
  savePlayers,
  seatPlayers,
  type LocalPlayer,
} from '../../modes/local-players.ts';
import './players.css';

export function playersScreen(): Screen {
  return {
    mount(context: ScreenContext): void {
      const doc = context.host.ownerDocument;
      let players: readonly LocalPlayer[] = seatPlayers(PARTY_LIMITS.max, loadPlayers());
      const stored = loadPlayers().length > 0;

      const render = (): void => {
        context.host.replaceChildren(
          el(doc, 'section', {
            class: 'players',
            children: [
              el(doc, 'h1', { class: 'players__title', text: 'People on this device' }),
              el(doc, 'p', {
                class: 'players__lede',
                text: 'Names for the seats in hot-seat and party games, so a hand-over says who is up rather than "Player 2".',
              }),

              seatList(doc, {
                players,
                onChange: (next) => {
                  players = next;
                },
              }),

              el(doc, 'p', {
                class: 'players__note',
                // Said plainly, because "local only" is a promise and a promise nobody can see is
                // indistinguishable from a promise nobody kept.
                text: 'These names stay on this device. They are not in your backup, not in a roster export, and never sent to another player.',
              }),

              el(doc, 'div', {
                class: 'players__actions',
                children: [
                  button(doc, {
                    label: 'Remove all names',
                    variant: 'destructive',
                    disabled: !stored,
                    onClick: () => {
                      forgetPlayers();
                      players = seatPlayers(PARTY_LIMITS.max, []);
                      render();
                    },
                  }),
                  button(doc, { label: 'Back to settings', variant: 'ghost', href: '#/settings' }),
                ],
              }),
            ],
          }),
        );
      };

      render();
      // Seats that were only defaulted are not written until somebody edits one: opening this screen
      // must not be what creates a record of four people who do not exist.
      if (stored) savePlayers(players);
    },
  };
}
