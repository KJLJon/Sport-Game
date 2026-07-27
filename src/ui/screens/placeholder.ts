/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  10-ui-ux.md §7 (screen map), §10 (states that are usually forgotten)
 *
 * Purpose: stands in for screens whose phase hasn't arrived yet, so the shell, the router, and the
 * navigation model are all exercised end to end from Phase 0. Each placeholder names the phase
 * that will replace it — an honest empty state rather than a blank page.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';

export interface PlaceholderSpec {
  readonly heading: string;
  readonly body: string;
  /** Which phase delivers the real screen, e.g. `Phase 2`. */
  readonly arrivesIn: string;
}

export function placeholderScreen(spec: PlaceholderSpec): Screen {
  return {
    mount({ host }: ScreenContext): void {
      const doc = host.ownerDocument;

      const section = doc.createElement('section');
      section.className = 'empty-state';

      const heading = doc.createElement('h2');
      heading.textContent = spec.heading;

      const body = doc.createElement('p');
      body.textContent = spec.body;

      const note = doc.createElement('p');
      note.className = 'empty-state__note';
      note.textContent = `Arrives in ${spec.arrivesIn}.`;

      section.append(heading, body, note);
      host.replaceChildren(section);
    },
  };
}
