/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.9 — Offline integrity self-check and self-heal; offline-readiness UI
 * @story   US-1.8 — The game keeps working offline over time
 * @design  11-pwa-lifecycle.md §5 (offline durability), §5.2 (integrity self-check), §5.3
 * @invariant INV-3 (namespaced caches)
 *
 * Purpose: cache decay happens because the browser evicts entries we assumed were permanent, so
 * this module stops assuming. It compares the precache manifest against what is actually cached,
 * restores silently when online, and says so plainly when offline — never a blank screen.
 */
import { missingFromCache } from '../storage/caches.ts';
import type { Prefs } from '../storage/prefs.ts';

/** `11` §5.2 — on launch, and once per 24 h. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const PREF_LAST_CHECK = 'pwa.integrityCheckedAt';

export type Readiness =
  /** Everything the app needs is cached. "Ready to play offline." */
  | { readonly kind: 'ready' }
  /** Some entries are gone but nothing critical. Restored silently when online. */
  | { readonly kind: 'healing'; readonly missing: readonly string[] }
  /** Missing while offline. Anything still playable stays playable (`11` §5.2). */
  | { readonly kind: 'incomplete'; readonly missing: readonly string[] }
  /** The app shell or engine chunk is gone — offer Repair directly (`11` §5.2). */
  | { readonly kind: 'critical'; readonly missing: readonly string[] }
  /** No worker, or nothing precached yet. */
  | { readonly kind: 'unknown' };

/**
 * An entry whose absence means the app cannot start. The document itself and the entry JavaScript
 * chunk; a missing sport pack is merely inconvenient.
 */
export function isCritical(url: string, base: string): boolean {
  if (url === base) return true;
  const relative = url.startsWith(base) ? url.slice(base.length) : url;
  if (relative === 'index.html') return true;
  return /^assets\/index-[^/]+\.(js|css)$/.test(relative);
}

export function classify(
  missing: readonly string[],
  base: string,
  online: boolean,
  precacheSize: number,
): Readiness {
  if (precacheSize === 0) return { kind: 'unknown' };
  if (missing.length === 0) return { kind: 'ready' };
  if (missing.some((url) => isCritical(url, base))) return { kind: 'critical', missing };
  return online ? { kind: 'healing', missing } : { kind: 'incomplete', missing };
}

/** Plain-language copy for each state (`10` §9 — short, warm, never blames the player). */
export function describeReadiness(readiness: Readiness): string {
  switch (readiness.kind) {
    case 'ready':
      return 'Ready to play offline.';
    case 'healing':
      return 'Restoring a few game files…';
    case 'incomplete':
      return 'Some game files are missing and will be restored next time you are online.';
    case 'critical':
      return 'Important game files are missing. Repair will put them back — your roster is safe.';
    case 'unknown':
      return 'Offline readiness is still being set up.';
  }
}

/** Asks the active worker for its precache manifest; only the worker has it. */
export function requestPrecacheManifest(
  container: ServiceWorkerContainer | undefined,
  timeoutMs = 3000,
): Promise<readonly string[]> {
  const worker = container?.controller;
  if (container === undefined || !worker) return Promise.resolve([]);
  const target = container;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      target.removeEventListener('message', onMessage);
      resolve([]);
    }, timeoutMs);

    function onMessage(event: MessageEvent): void {
      const data: unknown = event.data;
      if (typeof data !== 'object' || data === null) return;
      const record = data as { type?: unknown; urls?: unknown };
      if (record.type !== 'PRECACHE' || !Array.isArray(record.urls)) return;

      clearTimeout(timer);
      target.removeEventListener('message', onMessage);
      resolve(record.urls.filter((url): url is string => typeof url === 'string'));
    }

    target.addEventListener('message', onMessage);
    worker.postMessage({ type: 'GET_PRECACHE' });
  });
}

export interface IntegrityOptions {
  readonly prefs: Prefs;
  readonly base: string;
  readonly container?: ServiceWorkerContainer | undefined;
  readonly isOnline?: () => boolean;
  readonly now?: () => number;
  /** Injected for tests. */
  readonly manifest?: () => Promise<readonly string[]>;
  readonly missing?: typeof missingFromCache;
}

export class IntegrityChecker {
  readonly #options: IntegrityOptions;
  readonly #now: () => number;

  constructor(options: IntegrityOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => Date.now());
  }

  /** True when the 24-hour interval has elapsed. Launch always checks regardless. */
  isDue(): boolean {
    const last = this.#options.prefs.get(PREF_LAST_CHECK, 0);
    return this.#now() - last >= CHECK_INTERVAL_MS;
  }

  /**
   * Compares the manifest against the cache. Restores missing entries when online, silently —
   * `11` §5.2 says a successful heal is not a user-visible event.
   */
  async check(): Promise<Readiness> {
    const container = this.#options.container ?? globalThis.navigator?.serviceWorker;
    const urls = await (this.#options.manifest ?? (() => requestPrecacheManifest(container)))();

    if (urls.length === 0) return { kind: 'unknown' };

    const missingImpl = this.#options.missing ?? missingFromCache;
    const missing = await missingImpl('precache', urls);
    const online = (this.#options.isOnline ?? (() => globalThis.navigator?.onLine !== false))();

    this.#options.prefs.set(PREF_LAST_CHECK, this.#now());
    const readiness = classify(missing, this.#options.base, online, urls.length);

    if (readiness.kind === 'healing' || readiness.kind === 'critical') {
      if (online) container?.controller?.postMessage({ type: 'PRECACHE_URLS', urls: missing });
    }

    return readiness;
  }

  /**
   * `11` §5.3 — "Download everything for offline". Re-fetches the whole manifest, including
   * sports the player has not opened yet. The thing you do before a flight.
   */
  async downloadEverything(): Promise<number> {
    const container = this.#options.container ?? globalThis.navigator?.serviceWorker;
    const urls = await (this.#options.manifest ?? (() => requestPrecacheManifest(container)))();
    if (urls.length === 0) return 0;

    container?.controller?.postMessage({ type: 'PRECACHE_URLS', urls });
    return urls.length;
  }
}
