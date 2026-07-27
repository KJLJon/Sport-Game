/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.1 — Scaffold
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  04-architecture.md §4 (repository layout)
 *
 * Purpose: application entry point. Mounts the shell and, once the PWA layer exists, registers
 * the service worker. Deliberately thin — everything testable lives in a module it calls.
 */

const root = document.querySelector<HTMLDivElement>('#app');

if (root) {
  root.textContent = 'Sport-Game';
}
