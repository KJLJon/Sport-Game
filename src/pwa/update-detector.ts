/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.7 — `version.json` emission + all five update-detection triggers
 * @story   US-1.4 — Get updates reliably
 * @design  11-pwa-lifecycle.md §3 (update detection)
 *
 * Purpose: runs all five detection triggers from `11` §3, because any single one can be missed.
 * The fifth — comparing `version.json` against the running build — is the one that answers "I
 * couldn't get the latest update": it detects the mismatch even when the service-worker mechanism
 * has failed, so the app can offer Repair rather than silently doing nothing.
 */
import { RUNNING_BUILD, compareToDeployed, fetchVersion, type VersionInfo } from './version.ts';

/** `11` §3, trigger 2 — re-check on foreground, but not more than once a minute. */
export const FOREGROUND_MIN_INTERVAL_MS = 60_000;
/** `11` §3, trigger 3 — while the app is open and online. */
export const POLL_INTERVAL_MS = 15 * 60_000;

export type UpdateState =
  /** Nothing found, or we have not been able to check. */
  | { readonly kind: 'none' }
  /** A new worker has installed and is waiting. The normal path (`11` §4). */
  | { readonly kind: 'ready'; readonly deployed: VersionInfo | null; readonly forced: boolean }
  /**
   * `version.json` differs from the running build but no worker is waiting. Something is wrong
   * with the SW mechanism — offer Repair (`11` §3, trigger 5).
   */
  | { readonly kind: 'stuck'; readonly deployed: VersionInfo };

export interface DetectorStatus {
  readonly state: UpdateState;
  /** Epoch ms of the last completed check, or null. Shown in Settings (`11` §4). */
  readonly lastCheckedAt: number | null;
  /** What the last check found, so Settings can say "you're on the latest version". */
  readonly deployed: VersionInfo | null;
  readonly checking: boolean;
}

export type StatusListener = (status: DetectorStatus) => void;

export interface DetectorOptions {
  readonly registration?: ServiceWorkerRegistration | undefined;
  /** The semantic version this build shipped as, for the `minSupportedVersion` comparison. */
  readonly runningVersion: string;
  readonly runningBuild?: string;
  /** Injected for tests. */
  readonly window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly document?: Pick<
    Document,
    'addEventListener' | 'removeEventListener' | 'visibilityState'
  >;
  readonly fetchVersionImpl?: typeof fetchVersion;
  readonly now?: () => number;
}

export class UpdateDetector {
  readonly #options: DetectorOptions;
  readonly #listeners = new Set<StatusListener>();
  readonly #now: () => number;

  #status: DetectorStatus = {
    state: { kind: 'none' },
    lastCheckedAt: null,
    deployed: null,
    checking: false,
  };

  #timer: ReturnType<typeof setInterval> | null = null;
  #onVisibility: (() => void) | null = null;
  #onOnline: (() => void) | null = null;
  #onUpdateFound: (() => void) | null = null;
  #started = false;

  constructor(options: DetectorOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => Date.now());
  }

  get status(): DetectorStatus {
    return this.#status;
  }

  subscribe(listener: StatusListener): () => void {
    this.#listeners.add(listener);
    listener(this.#status);
    return () => this.#listeners.delete(listener);
  }

  /** Wires triggers 1–3 and 5. Trigger 4 is Settings calling {@link check} directly. */
  start(): void {
    if (this.#started) return;
    this.#started = true;

    const doc = this.#options.document ?? globalThis.document;
    const win = this.#options.window ?? globalThis.window;
    const registration = this.#options.registration;

    // Trigger 1 — on every launch.
    void this.check();

    // Trigger 2 — on foreground, throttled.
    if (doc !== undefined) {
      this.#onVisibility = () => {
        if (doc.visibilityState !== 'visible') return;
        const last = this.#status.lastCheckedAt;
        if (last !== null && this.#now() - last < FOREGROUND_MIN_INTERVAL_MS) return;
        void this.check();
      };
      doc.addEventListener('visibilitychange', this.#onVisibility);
    }

    // Trigger 3 — every fifteen minutes while open.
    this.#timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);

    // Coming back online is a free extra chance at the same answer.
    if (win !== undefined) {
      this.#onOnline = () => void this.check();
      win.addEventListener('online', this.#onOnline);
    }

    // A worker that installs on its own — the browser's own detection — still reaches us.
    if (registration !== undefined) {
      this.#onUpdateFound = () => {
        const installing = registration.installing;
        if (installing === null) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') this.#recompute();
        });
      };
      registration.addEventListener('updatefound', this.#onUpdateFound);
    }
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;

    const doc = this.#options.document ?? globalThis.document;
    const win = this.#options.window ?? globalThis.window;

    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#onVisibility && doc !== undefined) {
      doc.removeEventListener('visibilitychange', this.#onVisibility);
    }
    if (this.#onOnline && win !== undefined) win.removeEventListener('online', this.#onOnline);
    if (this.#onUpdateFound && this.#options.registration !== undefined) {
      this.#options.registration.removeEventListener('updatefound', this.#onUpdateFound);
    }
    this.#onVisibility = null;
    this.#onOnline = null;
    this.#onUpdateFound = null;
  }

  /**
   * Trigger 4 — "Check now" in Settings, and the shared body of every other trigger. Asks the
   * browser to re-evaluate the worker *and* polls `version.json`, because either one alone can
   * miss.
   */
  async check(): Promise<DetectorStatus> {
    if (this.#status.checking) return this.#status;
    this.#emit({ ...this.#status, checking: true });

    const registration = this.#options.registration;
    if (registration !== undefined) {
      await registration.update().catch(() => {
        // Offline, or the script is unreachable. The version poll below still has a say.
      });
    }

    const result = await (this.#options.fetchVersionImpl ?? fetchVersion)();
    const deployed = result.status === 'ok' ? result.info : this.#status.deployed;

    this.#emit({
      ...this.#status,
      checking: false,
      lastCheckedAt: this.#now(),
      deployed,
    });
    this.#recompute();
    return this.#status;
  }

  /** Recomputes the state from the waiting worker and the last known deployed version. */
  #recompute(): void {
    const waiting = this.#options.registration?.waiting ?? null;
    const deployed = this.#status.deployed;
    const runningBuild = this.#options.runningBuild ?? RUNNING_BUILD;

    const comparison =
      deployed === null
        ? null
        : compareToDeployed(deployed, runningBuild, this.#options.runningVersion);

    let state: UpdateState;
    if (waiting !== null) {
      state = { kind: 'ready', deployed, forced: comparison?.forced ?? false };
    } else if (comparison?.differs === true && deployed !== null) {
      // Deployed build differs but nothing is waiting: the SW mechanism is not doing its job.
      state = { kind: 'stuck', deployed };
    } else {
      state = { kind: 'none' };
    }

    this.#emit({ ...this.#status, state });
  }

  #emit(status: DetectorStatus): void {
    this.#status = status;
    for (const listener of this.#listeners) listener(status);
  }
}
