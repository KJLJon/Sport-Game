/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.1 — Home screen, mode selector, Quick Play (two taps from cold launch)
 * @story   US-10.1 — Jump straight into a game
 * @design  10-ui-ux.md §8.1 (first launch: pick a sport, then pick how to play), §7 (screen map),
 *          §10 (states), 09-modes-and-arcade.md §1 (the three modes, remembered per sport)
 *
 * Purpose: the screen behind the Play tab, and the second of the two taps. Pick a sport, pick a
 * mode, and you are in a match — which is the whole of `10` §8.1 steps 2 and 3.
 *
 * **A mode a sport cannot start is shown, not hidden.** `10` §10 asks for honest states, and a
 * missing card is indistinguishable from a bug: a player who has read that this game has three
 * modes and sees two would reasonably conclude their install is broken. So the card renders,
 * unselectable, saying in words what is missing and that it is coming. The reason text comes from
 * `modes/catalogue.ts`, which is the one place availability is written down.
 *
 * The sport choice is a real radio group rather than tap-tracking on `div`s, so keyboard and
 * screen-reader behaviour come from the platform (`10` §11) and the selection has a name.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { PLAY_MODE_CATALOGUE, isModeAvailable, type PlayMode } from '../../modes/catalogue.ts';
import {
  lastDifficulty,
  lastSport,
  rememberDifficulty,
  rememberPlay,
} from '../../modes/last-played.ts';
import { PLAYABLE_SPORTS, isPlayable } from '../../sports/playable.ts';
import type { SportId } from '../../sports/types.ts';
import { button } from '../components/button.ts';
import { segmented } from '../components/controls.ts';
import { DIFFICULTIES, DIFFICULTY_PROFILES } from '../../modes/difficulty.ts';
import { el } from '../dom.ts';
import './play.css';

/**
 * Builds one mode card.
 *
 * The available card's whole surface is the link, because a 44 px target that is only the button
 * inside a card is a target the thumb misses (`10` §3.2). The unavailable one is a plain section:
 * it is not interactive, so it must not look or behave as though it is.
 */
function modeCard(
  doc: Document,
  mode: PlayMode,
  sport: SportId,
  onStart: (mode: PlayMode) => void,
): HTMLElement {
  const available = isModeAvailable(mode, sport);

  const heading = el(doc, 'h3', { class: 'play-mode__name', text: mode.name });
  const blurb = el(doc, 'p', { class: 'play-mode__blurb', text: mode.blurb });
  const hint = el(doc, 'p', { class: 'play-mode__hint', text: mode.hint });

  if (!available) {
    return el(doc, 'li', {
      children: [
        el(doc, 'section', {
          class: 'play-mode play-mode--pending',
          children: [
            heading,
            blurb,
            hint,
            el(doc, 'p', {
              class: 'play-mode__pending',
              // Never colour alone (`10` §11): the state is a sentence first.
              text: mode.pending?.(sport) ?? 'Not available for this sport yet.',
            }),
          ],
        }),
      ],
    });
  }

  return el(doc, 'li', {
    children: [
      el(doc, 'a', {
        class: 'play-mode play-mode--ready',
        attrs: { href: mode.route(sport) },
        // A real anchor, so long-press, middle-click, and the back button all behave. The handler
        // only records the choice; navigation is the browser's, not ours.
        on: { click: () => onStart(mode) },
        children: [heading, blurb, hint, el(doc, 'span', { class: 'play-mode__go', text: 'Play' })],
      }),
    ],
  });
}

export function playScreen(): Screen {
  return {
    mount(context: ScreenContext): void {
      const doc = context.host.ownerDocument;

      // A sport in the URL wins over the remembered one, so `#/play?sport=soccer` is a shareable
      // link into the picker rather than a page that quietly ignores its own query.
      const fromQuery = context.query['sport'];
      let sport: SportId = isPlayable(fromQuery) ? (fromQuery as SportId) : lastSport();

      const modeList = el(doc, 'ul', { class: 'play-modes' });

      const renderModes = (): void => {
        modeList.replaceChildren(
          ...PLAY_MODE_CATALOGUE.map((mode) =>
            modeCard(doc, mode, sport, (chosen) => {
              rememberPlay(sport, chosen);
            }),
          ),
        );
      };

      const sportPicker = el(doc, 'fieldset', { class: 'play-sports' });
      sportPicker.appendChild(
        el(doc, 'legend', { class: 'play-section__title', text: 'Pick a sport' }),
      );

      for (const playable of PLAYABLE_SPORTS) {
        const id = `play-sport-${playable.id}`;
        sportPicker.append(
          el(doc, 'input', {
            class: 'play-sports__input',
            attrs: {
              type: 'radio',
              id,
              name: 'play-sport',
              value: playable.id,
              checked: playable.id === sport,
            },
            on: {
              change: () => {
                sport = playable.id;
                renderModes();
              },
            },
          }),
          el(doc, 'label', {
            class: 'play-sports__card',
            attrs: { for: id },
            children: [el(doc, 'span', { class: 'play-sports__name', text: playable.displayName })],
          }),
        );
      }

      // One picker for every mode (`06` §7 — the same four levels apply in all three). It is
      // remembered the moment it changes rather than when a match starts, because the modes are
      // reached by following a link out of this screen: there is no later moment to record it in.
      const difficultyPicker = el(doc, 'div', {
        class: 'play-section',
        children: [
          el(doc, 'h2', { class: 'play-section__title', text: 'How hard should the CPU be?' }),
          segmented(doc, {
            legend: 'Difficulty',
            name: 'play-difficulty',
            value: lastDifficulty(),
            options: DIFFICULTIES.map((id) => ({
              value: id,
              label: DIFFICULTY_PROFILES[id].label,
            })),
            onChange: (value) => {
              rememberDifficulty(value);
            },
          }),
          el(doc, 'p', {
            class: 'play-section__hint',
            text: 'Difficulty changes how the CPU plays and how much help you get — never how good anyone is.',
          }),
        ],
      });

      renderModes();

      context.host.replaceChildren(
        el(doc, 'section', {
          class: 'play-screen',
          children: [
            el(doc, 'p', {
              class: 'play-screen__lede',
              text: 'Pick a sport, then pick how you want to play it. The same athletes play all of them.',
            }),
            sportPicker,
            difficultyPicker,
            el(doc, 'div', {
              class: 'play-section',
              children: [
                el(doc, 'h2', { class: 'play-section__title', text: 'How do you want to play?' }),
                modeList,
              ],
            }),
            el(doc, 'div', {
              class: 'play-screen__footer',
              children: [
                button(doc, {
                  label: 'Manage your squad',
                  variant: 'ghost',
                  href: '#/squad',
                }),
              ],
            }),
          ],
        }),
      );
    },
  };
}
