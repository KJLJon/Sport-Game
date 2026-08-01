/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @task    T-6.30 — Make the unbuilt screens read as unbuilt rather than as broken
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @story   US-13.6 — Never hit a dead end
 * @design  10-ui-ux.md §7 (screen map), §10 (states that are usually forgotten)
 *
 * Purpose: stands in for screens whose phase hasn't arrived yet, so the shell, the router, and the
 * navigation model are all exercised end to end from Phase 0.
 *
 * **Why T-6.30 rewrote it.** The user played the deployed build and reported that "some screens
 * don't seem to work". They meant these: `#/store` and `#/progress` are the last two stubs, and both
 * are **tabs in the bottom bar**, so they are among the most tappable things in the app. The screen
 * they got said *"Arrives in Phase 8."* — which is a sentence about this repository's plan, not
 * about the game, and to anyone who has not read `03` it reads as a broken page.
 *
 * So it now says what the screen will *be*, says plainly that it is not built yet, and offers a way
 * back to something that works. A dead end is a `10` §10 state and this was one.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { button } from '../components/button.ts';
import { el } from '../dom.ts';

export interface PlaceholderSpec {
  readonly heading: string;
  readonly body: string;
  /**
   * Which phase delivers the real screen, e.g. `Phase 2`.
   *
   * Kept for traceability — it is how `docs/traceability.md` and a reader of this file know what is
   * outstanding — but it is **no longer shown to the player**, because "Phase 8" means nothing to
   * anyone who is not building this.
   */
  readonly arrivesIn: string;
}

export function placeholderScreen(spec: PlaceholderSpec): Screen {
  return {
    mount({ host }: ScreenContext): void {
      const doc = host.ownerDocument;

      host.replaceChildren(
        el(doc, 'section', {
          class: 'empty-state',
          // The phase rides along in the DOM so it is still discoverable when debugging a build,
          // without being prose the player has to read past.
          attrs: { 'data-arrives-in': spec.arrivesIn },
          children: [
            el(doc, 'h2', { text: spec.heading }),
            el(doc, 'p', { text: spec.body }),
            el(doc, 'p', {
              class: 'empty-state__note',
              text: 'Still being built — there is nothing to do here yet.',
            }),
            // Never a dead end (`10` §10). The one thing that always works is a match.
            button(doc, { label: 'Play a match', variant: 'primary', href: '#/play' }),
          ],
        }),
      );
    },
  };
}
