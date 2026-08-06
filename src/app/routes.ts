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
import type { Screen, ScreenDefinition } from './screen.ts';
import type { TabDefinition } from './shell.ts';
import type { Athlete } from '../athletes/types.ts';

/**
 * The Live route, for `#/play/live` and `#/play/live/:sport` alike.
 *
 * Both patterns share one definition because they are one screen: the sport is a parameter, and an
 * absent or unknown one falls back to the default rather than 404ing, which is what `loadSport`
 * documents. Before soccer this route imported `basketball` directly; that was a hardcoded sport id
 * in the app layer, and `sports/playable.ts` is where it belongs.
 */
function liveRoute(): ScreenDefinition {
  return {
    id: 'play-live',
    title: 'Live',
    chrome: 'bare',
    orientation: 'landscape',
    // `load()` gets no arguments — only `mount` sees the route params — so the sport is resolved at
    // mount and the real screen is built then. A thin adapter rather than a change to `liveScreen`,
    // which has no business knowing that a sport can arrive from a URL.
    load: async () => {
      const [
        { liveScreen },
        { loadSport },
        { isDifficulty },
        { lastDifficulty },
        { decodeSetup, scalePeriodSteps, liveMatchHref },
        { resolveRosters, isRosterProblem },
        { appDatabase },
        { parseResume },
      ] = await Promise.all([
        import('../modes/live/screen.ts'),
        import('../sports/playable.ts'),
        import('../modes/difficulty.ts'),
        import('../modes/last-played.ts'),
        import('../modes/match-setup.ts'),
        import('../modes/rosters.ts'),
        import('../storage/app-db.ts'),
        import('../modes/checkpoint.ts'),
      ]);
      let inner: Screen | null = null;
      return {
        async mount(context) {
          const sport = await loadSport(context.params['sport']);
          // A level in the link wins over the remembered one, so a match is shareable at the
          // difficulty it was played at (US-7.2).
          const asked = context.query['difficulty'] ?? '';
          const difficulty = isDifficulty(asked) ? asked : lastDifficulty();
          const setup = { ...decodeSetup(context.query, sport.id), difficulty };

          /**
           * The athletes, if this save has any (T-8.2).
           *
           * A failure here is deliberately not an error screen: `#/play/live/soccer` from a fresh
           * install has no athletes and must still open a match, which it does with the seeded ones
           * `MatchSetup.rosters` was always optional for. The setup screen is where a player is told
           * they are short; a deep link just plays.
           */
          let rosters: readonly (readonly Athlete[])[] | undefined;
          try {
            const resolved = await resolveRosters({
              db: await appDatabase(),
              sport,
              teamId: setup.teamId,
              opponentSeed: setup.opponentSeed,
              difficulty,
            });
            if (!isRosterProblem(resolved)) rosters = resolved.rosters;
          } catch {
            // No database, no athletes, still a match.
          }

          /**
           * A resume comes in on the link, as `?resume=score-score:period:step` (T-8.4).
           *
           * On the URL rather than read from the checkpoint here, so that a resume is a *link* like
           * every other match: the same property that makes setup shareable makes a resumed match
           * reproducible, and it keeps this route from having to know a checkpoint exists.
           */
          const resumeFrom = parseResume(context.query['resume']);

          inner = liveScreen({
            sport,
            seed: newMatchSeed(),
            playerSide: 0,
            difficulty,
            ruleOptions: setup.rules,
            rules: { periodSteps: scalePeriodSteps(sport.rules.periodSteps, setup.length) },
            // The canonical link for this setup — rebuilt rather than echoed, so a checkpoint never
            // carries a stale `resume=` from the link that opened it.
            checkpointHref: liveMatchHref(setup),
            ...(rosters === undefined ? {} : { rosters }),
            ...(resumeFrom === undefined ? {} : { resumeFrom }),
          });
          await inner.mount(context);
        },
        unmount() {
          inner?.unmount?.();
          inner = null;
        },
      };
    },
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
    value: {
      id: 'play',
      title: 'Play',
      load: async () => (await import('../ui/screens/play.ts')).playScreen(),
    },
  },
  {
    // The Live setup screen (T-8.2). A separate route from the match itself, so a deep link to
    // `#/play/live/soccer` still opens a match and the hub's Live card opens the choices first.
    pattern: '/play/setup/:sport',
    value: {
      id: 'play-setup',
      title: 'Set up a match',
      load: async () => (await import('../ui/screens/match-setup.ts')).matchSetupScreen(),
    },
  },
  {
    pattern: '/play/setup',
    value: {
      id: 'play-setup',
      title: 'Set up a match',
      load: async () => (await import('../ui/screens/match-setup.ts')).matchSetupScreen(),
    },
  },
  {
    pattern: '/play/live',
    value: liveRoute(),
  },
  {
    // `#/play/live/soccer` is how a second sport is reached until the modes hub lands (T-8.1).
    // Sport ids come from `sports/playable.ts`, so this route names no sport of its own.
    pattern: '/play/live/:sport',
    value: liveRoute(),
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
    // Store → Packs (`10` §7).
    pattern: '/store/packs',
    value: {
      id: 'store-packs',
      title: 'Packs',
      load: async () => (await import('../ui/screens/packs.ts')).packsScreen(),
    },
  },
  {
    // Store → Market (`10` §7).
    pattern: '/store/market',
    value: {
      id: 'store-market',
      title: 'Transfer market',
      load: async () => (await import('../ui/screens/market.ts')).marketScreen(),
    },
  },
  {
    // Store → Sell (`10` §7).
    pattern: '/store/sell',
    value: {
      id: 'store-sell',
      title: 'Sell athletes',
      load: async () => (await import('../ui/screens/sell.ts')).sellScreen(),
    },
  },
  {
    pattern: '/store',
    value: {
      // The wallet is the first thing behind this tab (T-8.10). Packs, the market, and selling are
      // T-8.12 to T-8.14 and land alongside it — all three spend from the balance this screen shows.
      id: 'store',
      title: 'Store',
      load: async () => (await import('../ui/screens/wallet.ts')).walletScreen(),
    },
  },
  {
    // Progress → Achievements (`10` §7). A route of its own rather than a tab on the history
    // screen, so the unlock moment in a match summary can link straight at it.
    pattern: '/progress/achievements',
    value: {
      id: 'achievements',
      title: 'Achievements',
      load: async () => (await import('../ui/screens/achievements.ts')).achievementsScreen(),
    },
  },
  {
    pattern: '/progress',
    value: {
      id: 'progress',
      title: 'Progress',
      load: async () => (await import('../ui/screens/history.ts')).historyScreen(),
    },
  },
  {
    pattern: '/settings/players',
    value: {
      id: 'settings-players',
      title: 'People on this device',
      load: async () => (await import('../ui/screens/players.ts')).playersScreen(),
    },
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
    pattern: '/settings/controls',
    value: {
      id: 'settings-controls',
      title: 'Controls & assists',
      load: async () => (await import('../ui/screens/assists.ts')).assistsScreen(),
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
