/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @task    T-8.1 — Home screen, mode selector, Quick Play (two taps from cold launch)
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @story   US-10.1 — Jump straight into a game
 * @design  10-ui-ux.md §2 (two taps to play), §8.1 (first launch), §8.2 (Quick Play)
 *
 * Purpose: the home screen, and the first of the two taps.
 *
 * **The button changes with what you have played.** `10` §8.2 wants one tap from cold launch into
 * the last match you were playing; `10` §8.1 wants a first launch that asks which sport and which
 * mode before it starts anything. Those want different buttons, so the screen shows different
 * buttons: nothing remembered means the primary action is the picker, and something remembered
 * means it is that match, named in full so a one-tap launch is never a surprise.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { quickPlay, rememberPlay } from '../../modes/last-played.ts';
import { playableSport } from '../../sports/playable.ts';
import { button } from '../components/button.ts';
import { el } from '../dom.ts';

export function homeScreen(): Screen {
  return {
    mount({ host, navigate }: ScreenContext): void {
      const doc = host.ownerDocument;
      const resume = quickPlay();

      const primary =
        resume === null
          ? button(doc, {
              label: 'Play',
              variant: 'primary',
              size: 'large',
              onClick: () => navigate('/play'),
            })
          : button(doc, {
              label: `Quick Play · ${resume.mode.name} ${playableSport(resume.sport).displayName}`,
              variant: 'primary',
              size: 'large',
              onClick: () => {
                // Re-recorded on the way out, so the timestamp-free memory still reflects a launch
                // made from here rather than only ones made from the picker.
                rememberPlay(resume.sport, resume.mode);
                navigate(resume.mode.route(resume.sport).replace(/^#/, ''));
              },
            });

      // The class is the layout hook `components.css` already owns; `button()` sets its own.
      primary.classList.add('home__play');

      const links = el(doc, 'nav', {
        class: 'home__links',
        attrs: { 'aria-label': 'More' },
        children: [
          // Always present, and the only route to a *different* match — which is why it is here
          // even when the primary button is already the picker.
          ...(resume === null
            ? []
            : [button(doc, { label: 'Choose a game', variant: 'ghost', href: '#/play' })]),
          button(doc, { label: 'Squad', variant: 'ghost', href: '#/squad' }),
          button(doc, { label: 'Settings', variant: 'ghost', href: '#/settings' }),
        ],
      });

      host.replaceChildren(
        el(doc, 'section', {
          class: 'home',
          children: [
            el(doc, 'p', {
              class: 'home__lede',
              text: 'Build athletes once and play them in every sport. Install it, then play offline.',
            }),
            primary,
            links,
          ],
        }),
      );
    },
  };
}
