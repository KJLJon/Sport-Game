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
import { registerServiceWorker } from './pwa/register.ts';

const root = document.querySelector<HTMLDivElement>('#app');

if (root === null) {
  throw new Error('#app host is missing from index.html');
}

const router = new Router<ScreenDefinition>({ routes: ROUTES, fallbackPath: '/' });

const shell = new AppShell({ root, router, tabs: TABS, window });
shell.start();

// Registration is deliberately after the shell is up: offline support must never delay first
// paint, and a failed registration must never stop the app from running (`11` §3).
void registerServiceWorker();
