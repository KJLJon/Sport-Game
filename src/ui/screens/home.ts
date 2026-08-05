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
 * **An interrupted match outranks everything else on this screen** (T-8.4). If a match was left in
 * progress — a kill, a battery, a tab closed — the first thing offered is getting back into it,
 * above Quick Play and above the picker. `US-10.3` asks to be *offered* a resume, and an offer
 * three taps down is not one. The card says what it will restore, in the score and period the
 * player remembers, because a resume that quietly loses the box score should say so.
 *
 * **The button changes with what you have played.** `10` §8.2 wants one tap from cold launch into
 * the last match you were playing; `10` §8.1 wants a first launch that asks which sport and which
 * mode before it starts anything. Those want different buttons, so the screen shows different
 * buttons: nothing remembered means the primary action is the picker, and something remembered
 * means it is that match, named in full so a one-tap launch is never a surprise.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { quickPlay, rememberPlay } from '../../modes/last-played.ts';
import { clearCheckpoint, readCheckpoint, resumeHref } from '../../modes/checkpoint.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { playableSport } from '../../sports/playable.ts';
import { button } from '../components/button.ts';
import { el } from '../dom.ts';

/** The interrupted match, or `null`. Never throws: a broken database is not a reason to hide home. */
async function readInterrupted() {
  try {
    return await readCheckpoint((await appDatabase()).db);
  } catch {
    return null;
  }
}

export function homeScreen(): Screen {
  return {
    async mount({ host, navigate }: ScreenContext): Promise<void> {
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

      // Read after the first paint, so a slow database never delays the screen (`10` §10). The card
      // is inserted above the primary button when it arrives.
      const interrupted = await readInterrupted();
      if (interrupted === null) return;

      const section = host.querySelector('.home');
      if (section === null) return;

      section.insertBefore(
        el(doc, 'div', {
          class: 'home__resume',
          children: [
            el(doc, 'p', {
              class: 'home__resume-label',
              text: `Unfinished · ${interrupted.label}`,
            }),
            el(doc, 'p', { class: 'home__resume-detail', text: interrupted.detail }),
            button(doc, {
              // "Resume" only where one is actually offered. An arcade run has no resume state
              // (T-8.4) and this button starts it again, so it says so.
              label: interrupted.resume === undefined ? 'Play again' : 'Resume',
              variant: 'primary',
              size: 'large',
              href: resumeHref(interrupted),
            }),
            // A resume the player does not want must be dismissable, or the card is a nag that
            // outlives the match it describes.
            button(doc, {
              label: 'Discard',
              variant: 'ghost',
              onClick: () => {
                void appDatabase()
                  .then((db) => clearCheckpoint(db.db))
                  .catch(() => {});
                section.querySelector('.home__resume')?.remove();
              },
            }),
            el(doc, 'p', {
              class: 'home__resume-note',
              // Says exactly what it delivers rather than implying a perfect restore.
              text:
                interrupted.resume === undefined
                  ? 'Arcade runs are short, so this one starts from the beginning.'
                  : 'Picks up at that score and clock. Positions and the box score start fresh.',
            }),
          ],
        }),
        primary,
      );
    },
  };
}
