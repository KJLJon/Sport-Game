/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced IndexedDB, localStorage, and Cache Storage
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §3, 11-pwa-lifecycle.md §2 (cache strategy), §6 (Repair)
 * @invariant INV-3 (namespaced cache names), INV-13 (Repair deletes only ours, never IndexedDB)
 *
 * Purpose: the only module that names or deletes a cache. Every deletion path filters on our
 * namespace first, which is what makes it safe for another PWA to live on the same origin — and
 * what PWA-15 asserts.
 */
import { CACHE_KINDS, cacheName, isOurs, isStaleCache, type CacheKind } from './scope.ts';

/** The Cache Storage API, narrowed so tests can substitute a fake. */
export interface CacheHost {
  open(name: string): Promise<Cache>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

function defaultHost(): CacheHost {
  return globalThis.caches;
}

/** Opens the cache for a resource class at the current build. */
export function openCache(kind: CacheKind, host: CacheHost = defaultHost()): Promise<Cache> {
  return host.open(cacheName(kind));
}

/** Every cache name on this origin that belongs to this app. */
export async function ourCacheNames(host: CacheHost = defaultHost()): Promise<string[]> {
  return (await host.keys()).filter(isOurs);
}

/**
 * Deletes our caches from previous builds. Run on `activate`, so the new worker starts with only
 * its own caches and the old build's bytes are reclaimed.
 */
export async function deleteStaleCaches(host: CacheHost = defaultHost()): Promise<string[]> {
  const stale = (await host.keys()).filter(isStaleCache);
  await Promise.all(stale.map((name) => host.delete(name)));
  return stale;
}

/**
 * Deletes every cache we own, current build included. This is Repair (`11` §6) — and it must not
 * touch IndexedDB, which is where the player's roster, progress, and coins live.
 */
export async function deleteAllOurCaches(host: CacheHost = defaultHost()): Promise<string[]> {
  const ours = await ourCacheNames(host);
  await Promise.all(ours.map((name) => host.delete(name)));
  return ours;
}

/**
 * Reports which precached URLs are actually present. This is the read half of the integrity
 * self-check in `11` §5.2 — the app stops assuming the precache stays complete forever.
 */
export async function missingFromCache(
  kind: CacheKind,
  urls: readonly string[],
  host: CacheHost = defaultHost(),
): Promise<string[]> {
  const cache = await openCache(kind, host);
  const present = new Set((await cache.keys()).map((request) => request.url));
  return urls.filter((url) => !present.has(new URL(url, globalThis.location.href).href));
}

export { CACHE_KINDS };
export type { CacheKind };
