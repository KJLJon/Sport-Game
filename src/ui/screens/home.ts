/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  10-ui-ux.md §2 (two taps to play), §8.2 (Quick Play)
 *
 * Purpose: the home screen. `10` §2 makes this the shortest path to a match, so the primary
 * action is one large button and everything else is secondary. The Quick Play target becomes
 * real in Phase 2; until then it routes to the Play screen.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';

export function homeScreen(): Screen {
  return {
    mount({ host, navigate }: ScreenContext): void {
      const doc = host.ownerDocument;

      const section = doc.createElement('section');
      section.className = 'home';

      const lede = doc.createElement('p');
      lede.className = 'home__lede';
      lede.textContent =
        'Build athletes once and play them in every sport. Install it, then play offline.';

      const play = doc.createElement('button');
      play.type = 'button';
      play.className = 'button button--primary home__play';
      play.textContent = 'Play';
      play.addEventListener('click', () => navigate('/play'));

      const links = doc.createElement('nav');
      links.className = 'home__links';
      links.setAttribute('aria-label', 'More');
      for (const [label, path] of [
        ['Squad', '/squad'],
        ['Settings', '/settings'],
      ] as const) {
        const anchor = doc.createElement('a');
        anchor.className = 'button button--ghost';
        anchor.href = `#${path}`;
        anchor.textContent = label;
        links.appendChild(anchor);
      }

      section.append(lede, play, links);
      host.replaceChildren(section);
    },
  };
}
