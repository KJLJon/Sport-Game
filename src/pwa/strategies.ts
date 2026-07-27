/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.6 — Service worker: per-class cache strategies, atomic precache, versioned caches
 * @story   US-1.2 — Play offline, US-1.3 — Scoped to the repository directory, US-1.6 — Reliable updates
 * @design  11-pwa-lifecycle.md §2 (cache strategy, per resource class)
 * @invariant INV-3 (namespaced cache names)
 *
 * Purpose: decides which caching strategy a request gets. Kept as pure functions, separate from
 * the worker, because this table is the single most important thing in `11` — cache-first HTML is
 * what causes stale-lock, and network-cached `version.json` is what makes an update undetectable.
 * A table this consequential should be unit-testable without a service-worker environment.
 */

export type Strategy =
  /** Never cached. The source of truth about what is deployed (`11` §2). */
  | 'network-only'
  /** Navigations: network-first with a timeout, then the cached shell. */
  | 'navigation'
  /** Content-hashed URLs. Staleness is impossible by construction, so cache-first is safe. */
  | 'cache-first'
  /** Small unhashed resources: try the network, fall back to cache. */
  | 'network-first'
  /** Not ours — pass straight through, touch nothing. */
  | 'passthrough';

/** `11` §2 — network-first navigation gives up on the network after this and serves the shell. */
export const NAVIGATION_TIMEOUT_MS = 2500;

export const VERSION_FILE = 'version.json';
export const MANIFEST_FILE = 'manifest.webmanifest';

export interface RouteInput {
  /** The absolute request URL. */
  readonly url: string;
  /** The deployed base path, with leading and trailing slashes. */
  readonly base: string;
  /** The document origin the worker is registered under. */
  readonly origin: string;
  /** True for a navigation request (`request.mode === 'navigate'`). */
  readonly isNavigation: boolean;
  readonly method: string;
}

/** Path segment holding Vite's content-hashed output. Everything under it is immutable. */
const HASHED_DIR = 'assets/';

/** Icons are content-stable but unhashed; they belong in the precache all the same. */
const PRECACHED_DIRS = ['icons/'];

export function routeFor(input: RouteInput): Strategy {
  // A service worker only ever sees GET for caching purposes; anything else goes to the network.
  if (input.method !== 'GET') return 'passthrough';

  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return 'passthrough';
  }

  // Cross-origin is not ours. There should be none at all (INV-14), but the worker must not
  // silently intercept it if there is.
  if (parsed.origin !== input.origin) return 'passthrough';

  // Outside our base path is a sibling project on the same Pages account. Never touch it.
  if (!parsed.pathname.startsWith(input.base)) return 'passthrough';

  const relative = parsed.pathname.slice(input.base.length);

  // The one rule that makes updates detectable even when the SW mechanism has failed (`11` §3).
  if (relative === VERSION_FILE) return 'network-only';

  // The SW script itself is browser-managed; intercepting it is how updates get stuck.
  if (relative === 'sw.js') return 'passthrough';

  if (input.isNavigation) return 'navigation';

  if (relative.startsWith(HASHED_DIR)) return 'cache-first';
  if (PRECACHED_DIRS.some((dir) => relative.startsWith(dir))) return 'cache-first';

  if (relative === MANIFEST_FILE) return 'network-first';

  // Anything else unhashed under our base: try the network, fall back to what we have.
  return 'network-first';
}

/** Which cache a strategy writes into. `network-only` writes nowhere. */
export function cacheKindFor(strategy: Strategy): 'precache' | 'shell' | 'runtime' | null {
  switch (strategy) {
    case 'cache-first':
      return 'precache';
    case 'navigation':
      return 'shell';
    case 'network-first':
      return 'runtime';
    case 'network-only':
    case 'passthrough':
      return null;
  }
}

/**
 * Races a fetch against a timeout. Resolves `null` on timeout or network failure — both mean
 * "fall back to cache", and distinguishing them would not change what we do.
 */
export async function fetchWithTimeout(
  request: Request,
  timeoutMs: number,
  fetcher: (request: Request) => Promise<Response>,
): Promise<Response | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([fetcher(request).catch(() => null), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** A response worth caching: a real 200 from our own origin, not an opaque or partial one. */
export function isCacheable(response: Response): boolean {
  return response.ok && response.status === 200 && response.type !== 'opaque';
}
