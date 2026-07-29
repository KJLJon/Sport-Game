/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  10-ui-ux.md §7 (screen map), §4 (layout)
 *
 * Purpose: the route table and the bottom tabs. Screens are loaded lazily so a sport, a mode, or
 * the dev gallery never lands in the initial bundle (`04` §9).
 */
import type { RouteDefinition } from './router.ts';
import type { ScreenDefinition } from './screen.ts';
import type { TabDefinition } from './shell.ts';
import { placeholderScreen } from '../ui/screens/placeholder.ts';

function stub(
  id: string,
  title: string,
  body: string,
  arrivesIn: string,
  extra: Partial<ScreenDefinition> = {},
): ScreenDefinition {
  return {
    id,
    title,
    load: () => placeholderScreen({ heading: title, body, arrivesIn }),
    ...extra,
  };
}

/**
 * A seed for a fresh match. The clock is a *source* of a seed, not a draw inside the simulation —
 * everything downstream forks from it deterministically, which is what INV-8 is about.
 */
function newMatchSeed(): string {
  return `m${Date.now().toString(36)}`;
}

export const ROUTES: readonly RouteDefinition<ScreenDefinition>[] = [
  {
    pattern: '/',
    value: {
      id: 'home',
      title: 'Sport-Game',
      load: async () => (await import('../ui/screens/home.ts')).homeScreen(),
    },
  },
  {
    pattern: '/play',
    value: stub('play', 'Play', 'Pick a sport and a way to play.', 'Phase 2'),
  },
  {
    pattern: '/play/live',
    value: {
      id: 'play-live',
      title: 'Live',
      chrome: 'bare',
      orientation: 'landscape',
      load: async () => {
        const [{ liveScreen }, { basketball }] = await Promise.all([
          import('../modes/live/screen.ts'),
          import('../sports/basketball/index.ts'),
        ]);
        return liveScreen({ sport: basketball, seed: newMatchSeed(), playerSide: 0 });
      },
    },
  },
  {
    pattern: '/play/playbook',
    value: {
      id: 'play-playbook',
      title: 'Playbook',
      load: async () => (await import('../ui/screens/playbook.ts')).playbookScreen(),
    },
  },
  {
    // Full-bleed: the diagram wants the width, and `10` §8.4 puts the call sheet where the tab bar
    // would otherwise be.
    pattern: '/play/playbook/match',
    value: {
      id: 'play-playbook-match',
      title: 'Playbook',
      chrome: 'bare',
      load: async () => (await import('../ui/screens/playbook-match.ts')).playbookMatchScreen(),
    },
  },
  {
    pattern: '/play/arcade',
    value: {
      id: 'play-arcade',
      title: 'Arcade',
      load: async () => (await import('../ui/screens/arcade.ts')).arcadeScreen(),
    },
  },
  {
    pattern: '/play/arcade/:id',
    value: {
      id: 'play-arcade-game',
      title: 'Arcade',
      chrome: 'bare',
      load: async () => (await import('../ui/screens/arcade-game.ts')).arcadeGameScreen(),
    },
  },
  {
    pattern: '/squad',
    value: {
      id: 'squad',
      title: 'Squad',
      load: async () => (await import('../ui/screens/roster.ts')).rosterScreen(),
    },
  },
  {
    pattern: '/squad/athlete/:id',
    value: {
      id: 'athlete',
      title: 'Athlete',
      load: async () => (await import('../ui/screens/athlete.ts')).athleteScreen(),
    },
  },
  {
    pattern: '/settings/data',
    value: {
      id: 'settings-data',
      title: 'Data & backup',
      load: async () => (await import('../ui/screens/backup.ts')).backupScreen(),
    },
  },
  {
    pattern: '/squad/import',
    value: {
      id: 'roster-import',
      title: 'Import a roster',
      load: async () => (await import('../ui/screens/roster-import.ts')).rosterImportScreen(),
    },
  },
  {
    pattern: '/squad/teams',
    value: {
      id: 'teams',
      title: 'Teams',
      load: async () => (await import('../ui/screens/teams.ts')).teamsScreen(),
    },
  },
  {
    pattern: '/squad/teams/new',
    value: {
      id: 'team-new',
      title: 'New team',
      load: async () => (await import('../ui/screens/team-editor.ts')).teamEditorScreen(),
    },
  },
  {
    pattern: '/squad/teams/:id/lineup/:sport',
    value: {
      id: 'lineup',
      title: 'Lineup',
      load: async () => (await import('../ui/screens/lineup.ts')).lineupScreen(),
    },
  },
  {
    pattern: '/squad/teams/:id',
    value: {
      id: 'team-edit',
      title: 'Edit team',
      load: async () => (await import('../ui/screens/team-editor.ts')).teamEditorScreen(),
    },
  },
  {
    pattern: '/squad/athlete/:id/compare',
    value: {
      id: 'athlete-compare',
      title: 'Every sport',
      load: async () => (await import('../ui/screens/athlete-compare.ts')).athleteCompareScreen(),
    },
  },
  {
    pattern: '/squad/athlete/new',
    value: {
      id: 'athlete-new',
      title: 'Make your own athlete',
      load: async () => (await import('../ui/screens/athlete-editor.ts')).athleteEditorScreen(),
    },
  },
  {
    pattern: '/store',
    value: stub('store', 'Store', 'Packs, the market, and selling athletes.', 'Phase 8'),
  },
  {
    pattern: '/progress',
    value: stub('progress', 'Progress', 'Achievements, stats, and tournaments.', 'Phase 8'),
  },
  {
    pattern: '/settings',
    value: {
      id: 'settings',
      title: 'Settings',
      load: async () => (await import('../ui/screens/settings.ts')).settingsScreen(),
    },
  },
  {
    pattern: '/settings/app',
    value: {
      id: 'settings-app',
      title: 'App & updates',
      load: async () => (await import('../ui/screens/app-updates.ts')).appUpdatesScreen(),
    },
  },
  // Dev-only. `import.meta.env.DEV` is statically false in a production build, so the branch and
  // the dynamic import behind it are both tree-shaken away.
  ...(import.meta.env.DEV
    ? [
        {
          pattern: '/dev/ui',
          value: {
            id: 'dev-gallery',
            title: 'Component gallery',
            load: async () => (await import('../ui/gallery/gallery.ts')).galleryScreen(),
          } satisfies ScreenDefinition,
        },
      ]
    : []),
];

/** `10` §7 — bottom tabs are Play · Squad · Store · Progress. Settings lives in the header. */
export const TABS: readonly TabDefinition[] = [
  {
    id: 'play',
    label: 'Play',
    path: '/play',
    icon: 'M8 5v14l11-7z',
  },
  {
    id: 'squad',
    label: 'Squad',
    path: '/squad',
    icon: 'M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  },
  {
    id: 'store',
    label: 'Store',
    path: '/store',
    icon: 'M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-6-2c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2z',
  },
  {
    id: 'progress',
    label: 'Progress',
    path: '/progress',
    icon: 'M5 21V9h4v12H5zm5.5 0V3h3v18h-3zM16 21v-8h4v8h-4z',
  },
];
