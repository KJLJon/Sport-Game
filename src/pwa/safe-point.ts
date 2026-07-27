/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.8 — Update application: safe-point auto-update
 * @story   US-1.4 — Get updates reliably, US-1.7 — Never interrupted mid-match
 * @design  11-pwa-lifecycle.md §4 (applying an update)
 *
 * Purpose: decides when a silent auto-update is allowed. `11` §4 names the safe points exactly —
 * home screen, no match in progress, no unsaved editor open, idle at least five seconds — and
 * everything else waits. A reload that eats a match is worse than a late update.
 */

export interface AppActivity {
  /** Current route path, e.g. `/` or `/play/live`. */
  readonly path: string;
  readonly inMatch: boolean;
  /** An editor with unsaved changes — the athlete profile editor, the lineup editor. */
  readonly unsavedEditor: boolean;
  /** A pack opening or another animation the player is watching. */
  readonly midCeremony: boolean;
  /** Epoch ms of the last input. */
  readonly lastInteractionAt: number;
}

/** `11` §4 — idle for at least this long before a silent reload is acceptable. */
export const IDLE_REQUIRED_MS = 5000;

/** The only screens quiet enough for a silent reload. */
const SAFE_PATHS = new Set(['/', '/play', '/progress', '/store', '/settings']);

export function isSafePoint(activity: AppActivity, now: number): boolean {
  if (activity.inMatch || activity.unsavedEditor || activity.midCeremony) return false;
  if (!SAFE_PATHS.has(activity.path)) return false;
  return now - activity.lastInteractionAt >= IDLE_REQUIRED_MS;
}

/** Tracks activity so the controller can ask, rather than every screen having to report. */
export class ActivityTracker {
  #activity: AppActivity = {
    path: '/',
    inMatch: false,
    unsavedEditor: false,
    midCeremony: false,
    lastInteractionAt: 0,
  };

  get activity(): AppActivity {
    return this.#activity;
  }

  update(patch: Partial<AppActivity>): void {
    this.#activity = { ...this.#activity, ...patch };
  }

  touch(now: number): void {
    this.#activity = { ...this.#activity, lastInteractionAt: now };
  }
}
