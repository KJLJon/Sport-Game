/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  10-ui-ux.md §7 (screen map)
 *
 * Purpose: the Settings hub. Its sections arrive with the features they configure; "App &
 * updates" fills in across T-0.7 through T-0.12, so the section exists here from the start rather
 * than being retrofitted.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';

interface SettingsSection {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** Sections without a route yet arrive with the features they configure. */
  readonly path?: string;
}

const SECTIONS: readonly SettingsSection[] = [
  { id: 'controls', title: 'Controls & assists', summary: 'Joystick, handedness, assists.' },
  { id: 'display', title: 'Display & accessibility', summary: 'Theme, UI scale, reduced motion.' },
  { id: 'audio', title: 'Audio & haptics', summary: 'Music, effects, vibration.' },
  {
    id: 'data',
    title: 'Data & backup',
    summary: 'Export, import, storage usage.',
    path: '/settings/data',
  },
  {
    id: 'updates',
    title: 'App & updates',
    summary: 'Version, offline readiness, repair.',
    path: '/settings/app',
  },
  { id: 'about', title: 'About', summary: 'What this is, and what it never sends anywhere.' },
];

export function settingsScreen(): Screen {
  return {
    mount({ host }: ScreenContext): void {
      const doc = host.ownerDocument;

      const list = doc.createElement('ul');
      list.className = 'settings-list';

      for (const section of SECTIONS) {
        const item = doc.createElement('li');
        item.className = 'settings-list__item';
        item.id = `settings-${section.id}`;

        const title = doc.createElement('h2');
        title.className = 'settings-list__title';

        if (section.path === undefined) {
          title.textContent = section.title;
        } else {
          const link = doc.createElement('a');
          link.className = 'settings-list__link';
          link.href = `#${section.path}`;
          link.textContent = section.title;
          title.appendChild(link);
        }

        const summary = doc.createElement('p');
        summary.className = 'settings-list__summary';
        summary.textContent = section.summary;

        item.append(title, summary);
        list.appendChild(item);
      }

      host.replaceChildren(list);
    },
  };
}
