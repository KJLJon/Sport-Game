/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.6 — Service worker: per-class cache strategies, atomic precache, versioned caches
 * @story   US-1.2 — Play offline, US-1.3 — Scoped to the repository directory, US-1.6 — Reliable updates
 * @design  11-pwa-lifecycle.md §2 (cache strategy), §4 (applying an update), §5.1 (atomic precache)
 * @invariant INV-3 (namespaced caches), INV-13 (never touches IndexedDB), INV-14 (no third-party requests)
 *
 * Purpose: the service worker. It caches by resource class rather than uniformly, which is the
 * whole design in `11` — cache-first for content-hashed URLs, where staleness is impossible, and
 * network-first for the three unhashed resources that tell you what version you are on.
 *
 * This worker never reads or writes IndexedDB. The player's roster, progress, and coins live
 * there, and nothing in the update or repair path may put them at risk.
 */
import { deleteCachesForBuild, deleteStaleCaches, openCache } from '../storage/caches.ts';
import {
  NAVIGATION_TIMEOUT_MS,
  cacheKindFor,
  fetchWithTimeout,
  isCacheable,
  routeFor,
  type Strategy,
} from './strategies.ts';

/** Injected at build from the emitted asset list, base-path-prefixed (`04` §10). */
declare const __PRECACHE_MANIFEST__: readonly string[];
/** The base path this worker was built for. */
declare const __BASE_PATH__: string;

const sw = self as unknown as ServiceWorkerGlobalScope;

const BASE = __BASE_PATH__;
const PRECACHE_URLS = __PRECACHE_MANIFEST__;

/** The navigation fallback. Kept under its own key so a query string can never miss it. */
const SHELL_URL = BASE;

// ── Install ─────────────────────────────────────────────────────────────────
//
// `11` §5.1 — the precache is fetched as a unit and fails as a unit. If any asset 404s, install
// fails, this worker is discarded, and the previous version keeps running intact. That is what
// stops a bad deploy from leaving a half-updated app with missing files.

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const precache = await openCache('precache');
        // `addAll` rejects if any single request fails — exactly the atomicity we want.
        await precache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));

        const shell = await openCache('shell');
        await shell.add(new Request(SHELL_URL, { cache: 'reload' }));
      } catch (error) {
        // Opening a cache creates it, so a rejected `addAll` would otherwise leave an empty one
        // behind for this build. Remove it: a discarded worker should leave no trace.
        await deleteCachesForBuild(['precache', 'shell']);
        throw error;
      }
    })(),
  );
});

// ── Activate ────────────────────────────────────────────────────────────────

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Only ours, and only previous builds. A sibling PWA on this origin is untouched (PWA-15).
      await deleteStaleCaches();

      if ('navigationPreload' in sw.registration) {
        await sw.registration.navigationPreload.enable();
      }

      await sw.clients.claim();
    })(),
  );
});

// ── Messages ────────────────────────────────────────────────────────────────

sw.addEventListener('message', (event) => {
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null) return;
  const type = (data as { type?: unknown }).type;

  if (type === 'SKIP_WAITING') {
    // `11` §4 — the page asks for this only at a safe point, never mid-match.
    void sw.skipWaiting();
    return;
  }

  if (type === 'GET_BUILD') {
    event.source?.postMessage({ type: 'BUILD', build: __BUILD_HASH__ });
    return;
  }

  if (type === 'GET_PRECACHE') {
    // The page needs the manifest to run the integrity check (`11` §5.2); only the worker has it.
    event.source?.postMessage({ type: 'PRECACHE', urls: PRECACHE_URLS });
    return;
  }

  if (type === 'PRECACHE_URLS') {
    // `11` §5.3 — "Download everything for offline", and the heal path for evicted entries.
    const urls = (data as { urls?: unknown }).urls;
    if (Array.isArray(urls)) {
      event.waitUntil(precacheExtra(urls.filter((url): url is string => typeof url === 'string')));
    }
  }
});

async function precacheExtra(urls: readonly string[]): Promise<void> {
  const cache = await openCache('precache');
  // Per-URL rather than `addAll`: healing should restore what it can, not fail as a unit.
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (isCacheable(response)) await cache.put(url, response);
      } catch {
        // Offline. The integrity check will try again next launch (`11` §5.2).
      }
    }),
  );
}

// ── Fetch ───────────────────────────────────────────────────────────────────

sw.addEventListener('fetch', (event) => {
  const strategy = routeFor({
    url: event.request.url,
    base: BASE,
    origin: sw.location.origin,
    isNavigation: event.request.mode === 'navigate',
    method: event.request.method,
  });

  if (strategy === 'passthrough' || strategy === 'network-only') return;

  event.respondWith(handle(event, strategy));
});

function handle(event: FetchEvent, strategy: Strategy): Promise<Response> {
  switch (strategy) {
    case 'navigation':
      return handleNavigation(event);
    case 'cache-first':
      return handleCacheFirst(event.request);
    case 'network-first':
      return handleNetworkFirst(event.request);
    default:
      return fetch(event.request);
  }
}

/**
 * `11` §2 — the single most important line in that document. Cache-first HTML is what causes
 * stale-lock, so navigations go to the network first and only fall back to the cached shell.
 */
async function handleNavigation(event: FetchEvent): Promise<Response> {
  // Navigation preload rejects — it does not resolve undefined — when the network is down. An
  // uncaught rejection here fails the whole navigation, which is exactly the offline cold-start
  // this document exists to prevent.
  const preload = (await Promise.resolve(event.preloadResponse).catch(() => undefined)) as
    Response | undefined;
  const cache = await openCache('shell');

  const fresh =
    preload ?? (await fetchWithTimeout(event.request, NAVIGATION_TIMEOUT_MS, (r) => fetch(r)));

  if (fresh && isCacheable(fresh)) {
    // Store under the shell key, not the requested URL: every hash route shares one document.
    await cache.put(SHELL_URL, fresh.clone());
    return fresh;
  }
  if (fresh) return fresh;

  const cached = (await cache.match(SHELL_URL)) ?? (await cache.match(event.request));
  if (cached) return cached;

  return offlineResponse();
}

/** Content-hashed URLs can never be stale, so a hit is served without touching the network. */
async function handleCacheFirst(request: Request): Promise<Response> {
  const cache = await openCache('precache');
  const cached = await cache.match(request);
  if (cached) return cached;

  // A miss here means eviction (`11` §5.2). Fetch, restore, and carry on silently.
  try {
    const response = await fetch(request);
    if (isCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline and not cached' });
  }
}

async function handleNetworkFirst(request: Request): Promise<Response> {
  const cache = await openCache(cacheKindFor('network-first') ?? 'runtime');

  const fresh = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS, (r) => fetch(r));
  if (fresh && isCacheable(fresh)) {
    await cache.put(request, fresh.clone());
    return fresh;
  }
  if (fresh) return fresh;

  const cached = await cache.match(request);
  if (cached) return cached;

  return new Response('', { status: 504, statusText: 'Offline and not cached' });
}

/** Last resort: honest, styled inline, and never a browser error page. */
function offlineResponse(): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title>
<style>body{margin:0;display:grid;place-content:center;min-height:100vh;
background:#0B0F14;color:#F2F6FA;font:16px/1.5 system-ui,sans-serif;padding:32px;text-align:center}
p{color:#94A3B4}</style></head><body><div>
<h1>Game files are missing</h1>
<p>Reconnect once and they will be restored. Your roster and progress are safe.</p>
</div></body></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
