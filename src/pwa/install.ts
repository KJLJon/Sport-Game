/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.14 — Install UX: `beforeinstallprompt` capture, custom button, iOS A2HS
 * @story   US-1.1 — Install the game from a GitHub Pages URL
 * @design  04-architecture.md §2, 10-ui-ux.md §8.1 (first launch), §10
 *
 * Purpose: makes installing a deliberate, explained action. Chrome fires `beforeinstallprompt`
 * once and only honours it inside a user gesture, so the event is captured and replayed from our
 * own button. iOS has no such API at all, which is a different screen rather than a broken one.
 */

export type InstallAvailability =
  /** Already running as an installed app — offer nothing. */
  | 'installed'
  /** We hold a deferred prompt and can install on tap. */
  | 'promptable'
  /** iOS Safari: no API, so we show the Add to Home Screen steps instead. */
  | 'ios-manual'
  /** Nothing to offer: unsupported browser, or the criteria are not met yet. */
  | 'unavailable';

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PlatformHints {
  readonly userAgent: string;
  /** True when launched from the home screen. */
  readonly standalone: boolean;
}

/** iOS Safari, including iPadOS reporting itself as a Mac with touch. */
export function isIosSafari(userAgent: string): boolean {
  const ios = /iphone|ipad|ipod/i.test(userAgent);
  const iPadOs = /macintosh/i.test(userAgent) && /mobile|version\/\d+.*safari/i.test(userAgent);
  const notAnotherEngine = !/crios|fxios|edgios|opios/i.test(userAgent);
  return (ios || iPadOs) && notAnotherEngine;
}

export function readStandalone(win: Window | undefined = globalThis.window): boolean {
  if (win === undefined) return false;
  if (win.matchMedia?.('(display-mode: standalone)').matches === true) return true;
  // iOS predates the media query and exposes this instead.
  return (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function availability(hints: PlatformHints, hasPrompt: boolean): InstallAvailability {
  if (hints.standalone) return 'installed';
  if (hasPrompt) return 'promptable';
  if (isIosSafari(hints.userAgent)) return 'ios-manual';
  return 'unavailable';
}

/** The iOS steps, in the order they appear on screen. Shown only where they apply (`10` §10). */
export const IOS_STEPS: readonly string[] = [
  'Tap the Share button at the bottom of Safari.',
  'Scroll down and tap "Add to Home Screen".',
  'Tap "Add". The game will open like an app, and work offline.',
];

export type InstallListener = (state: InstallAvailability) => void;

export interface InstallOptions {
  readonly window?: Window | undefined;
}

/**
 * Captures the deferred prompt and exposes it behind our own button. The event fires once, so
 * it is stored rather than handled — replaying it later is the only way to place the install
 * offer where the player will understand it.
 */
export class InstallController {
  readonly #listeners = new Set<InstallListener>();
  readonly #window: Window | undefined;
  #deferred: BeforeInstallPromptEvent | null = null;
  #state: InstallAvailability = 'unavailable';
  #onBeforePrompt: ((event: Event) => void) | null = null;
  #onInstalled: (() => void) | null = null;

  constructor(options: InstallOptions = {}) {
    this.#window = options.window ?? globalThis.window;
  }

  get state(): InstallAvailability {
    return this.#state;
  }

  start(): void {
    const win = this.#window;
    if (win === undefined) return;

    this.#refresh();

    this.#onBeforePrompt = (event: Event) => {
      // Suppress Chrome's own mini-infobar; we place the offer ourselves.
      event.preventDefault();
      this.#deferred = event as BeforeInstallPromptEvent;
      this.#refresh();
    };
    win.addEventListener('beforeinstallprompt', this.#onBeforePrompt);

    this.#onInstalled = () => {
      this.#deferred = null;
      this.#emit('installed');
    };
    win.addEventListener('appinstalled', this.#onInstalled);
  }

  stop(): void {
    const win = this.#window;
    if (win === undefined) return;
    if (this.#onBeforePrompt) win.removeEventListener('beforeinstallprompt', this.#onBeforePrompt);
    if (this.#onInstalled) win.removeEventListener('appinstalled', this.#onInstalled);
    this.#onBeforePrompt = null;
    this.#onInstalled = null;
  }

  subscribe(listener: InstallListener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Shows the browser's install dialog. Must be called from a user gesture; a deferred prompt is
   * single-use, so it is discarded either way.
   */
  async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const deferred = this.#deferred;
    if (deferred === null) return 'unavailable';
    this.#deferred = null;

    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      this.#refresh();
      return outcome;
    } catch {
      this.#refresh();
      return 'unavailable';
    }
  }

  #refresh(): void {
    const win = this.#window;
    this.#emit(
      availability(
        {
          userAgent: win?.navigator?.userAgent ?? '',
          standalone: readStandalone(win),
        },
        this.#deferred !== null,
      ),
    );
  }

  #emit(state: InstallAvailability): void {
    this.#state = state;
    for (const listener of this.#listeners) listener(state);
  }
}
