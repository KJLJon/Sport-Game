/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  10-ui-ux.md §7 (screen map), §4 (layout)
 *
 * Purpose: the contract between the shell and anything it can show. A screen owns its subtree and
 * nothing outside it, so the shell can tear one down without knowing what it was.
 */
import type { RouteParams } from './router.ts';

/** Which chrome a screen wants around it. Live matches want none of it. */
export type ChromeMode = 'full' | 'bare';

/** Orientation a screen is designed for; the shell prompts when the device disagrees. */
export type ScreenOrientation = 'portrait' | 'landscape' | 'any';

export interface ScreenContext {
  /** The element the screen renders into. Cleared by the shell on unmount. */
  readonly host: HTMLElement;
  readonly params: RouteParams;
  readonly query: Readonly<Record<string, string>>;
  /** Navigate without the screen needing a reference to the router. */
  navigate(path: string, query?: Record<string, string>): void;
}

export interface Screen {
  /** Renders into `context.host`. May be async for code-split screens. */
  mount(context: ScreenContext): void | Promise<void>;
  /** Releases listeners, timers, and animation frames. The host is cleared for you. */
  unmount?(): void;
}

export interface ScreenDefinition {
  readonly id: string;
  /** Shown in the header. */
  readonly title: string;
  readonly chrome?: ChromeMode;
  readonly orientation?: ScreenOrientation;
  /** Loaded lazily so sports and heavy screens stay out of the initial bundle (`04` §9). */
  load(): Promise<Screen> | Screen;
}
