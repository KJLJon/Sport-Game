/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.1 — Scaffold, T-0.3 — App shell
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  04-architecture.md §4 (repository layout), §2 (base path)
 * @invariant INV-4 (no literal repository path)
 *
 * Purpose: application entry point. Mounts the shell and, once the PWA layer exists, registers
 * the service worker. Deliberately thin — everything testable lives in a module it calls.
 */
import './ui/tokens.css';
import './app/shell.css';
import './ui/components.css';
import { Router } from './app/router.ts';
import { AppShell } from './app/shell.ts';
import { ROUTES, TABS } from './app/routes.ts';
import type { ScreenDefinition } from './app/screen.ts';
import { bootPwa, pwaRuntime } from './pwa/boot.ts';

const root = document.querySelector<HTMLDivElement>('#app');

if (root === null) {
  throw new Error('#app host is missing from index.html');
}

// No fallback: an unknown deep link gets an explicit not-found state with a way home.
const router = new Router<ScreenDefinition>({ routes: ROUTES });

const shell = new AppShell({ root, router, tabs: TABS, window });
shell.start();

// The starter roster is an install step, and it runs after first paint for the same reason the
// service worker does: nothing about a fresh install should delay the app appearing (US-5.6).
void import('./storage/app-db.ts').then(({ ensureStarterRoster }) => ensureStarterRoster());

// Deliberately after the shell is up: offline support must never delay first paint, and a failed
// registration must never stop the app from running (`11` §3).
void bootPwa({ bannerHost: shell.bannerHost });

// The update controller needs to know where the player is, so it never reloads mid-flow (`11` §4).
router.subscribe((match) => {
  pwaRuntime()?.activity.update({
    path: match?.location.path ?? '/',
    // Bare chrome means a Live match or a full-screen arcade game — never interrupt either.
    inMatch: match?.route.chrome === 'bare',
  });
  pwaRuntime()?.controller.reconsider();
});

// Idle time is part of the safe-point test, so the shell has to know when input last happened.
for (const type of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(type, () => pwaRuntime()?.activity.touch(Date.now()), { passive: true });
}
