/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced IndexedDB, localStorage, and Cache Storage
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  11-pwa-lifecycle.md §2, §5.2, §6
 * @invariant INV-3, INV-13
 */
import { describe, expect, it } from 'vitest';
import {
  deleteAllOurCaches,
  deleteStaleCaches,
  missingFromCache,
  openCache,
  ourCacheNames,
  type CacheHost,
} from '../../../src/storage/caches.ts';
import { NS, cacheName } from '../../../src/storage/scope.ts';

/** A Cache Storage double holding just the URLs each cache contains. */
function fakeCaches(initial: Record<string, string[]> = {}): CacheHost & {
  readonly store: Map<string, Set<string>>;
} {
  const store = new Map<string, Set<string>>(
    Object.entries(initial).map(([name, urls]) => [name, new Set(urls)]),
  );

  return {
    store,
    open: async (name) => {
      if (!store.has(name)) store.set(name, new Set());
      const urls = store.get(name)!;
      return {
        keys: async () => [...urls].map((url) => ({ url }) as Request),
      } as unknown as Cache;
    },
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
  };
}

const SIBLING = 'another-pwa-precache-v4';

describe('cache scoping', () => {
  it('opens a cache under the namespaced, build-suffixed name', async () => {
    const host = fakeCaches();
    await openCache('precache', host);
    expect([...host.store.keys()]).toEqual([cacheName('precache')]);
  });

  it('lists only our caches', async () => {
    const host = fakeCaches({
      [cacheName('precache')]: [],
      [`${NS}precache@older`]: [],
      [SIBLING]: [],
    });
    expect((await ourCacheNames(host)).sort()).toEqual(
      [cacheName('precache'), `${NS}precache@older`].sort(),
    );
  });

  it('deletes previous builds and keeps the current one', async () => {
    const host = fakeCaches({
      [cacheName('precache')]: [],
      [cacheName('shell')]: [],
      [`${NS}precache@older`]: [],
      [`${NS}shell@older`]: [],
      [SIBLING]: [],
    });

    const deleted = await deleteStaleCaches(host);

    expect(deleted.sort()).toEqual([`${NS}precache@older`, `${NS}shell@older`].sort());
    expect(host.store.has(cacheName('precache'))).toBe(true);
    expect(host.store.has(SIBLING)).toBe(true);
  });

  it('INV-13: Repair deletes every cache of ours and never a sibling project’s', async () => {
    const host = fakeCaches({
      [cacheName('precache')]: [],
      [`${NS}shell@older`]: [],
      [SIBLING]: [],
      'workbox-precache-v2-https://example.test/': [],
    });

    const deleted = await deleteAllOurCaches(host);

    expect(deleted).toHaveLength(2);
    expect(host.store.has(SIBLING)).toBe(true);
    expect(host.store.has('workbox-precache-v2-https://example.test/')).toBe(true);
  });

  it('is a no-op when we own nothing yet', async () => {
    const host = fakeCaches({ [SIBLING]: [] });
    expect(await deleteAllOurCaches(host)).toEqual([]);
    expect(host.store.size).toBe(1);
  });

  it('reports precache entries the browser has evicted', async () => {
    const base = globalThis.location.href;
    const present = new URL('assets/app.abc123.js', base).href;
    const host = fakeCaches({ [cacheName('precache')]: [present] });

    const missing = await missingFromCache(
      'precache',
      ['assets/app.abc123.js', 'assets/engine.def456.js'],
      host,
    );

    expect(missing).toEqual(['assets/engine.def456.js']);
  });

  it('reports nothing missing when the precache is intact', async () => {
    const base = globalThis.location.href;
    const urls = ['assets/a.js', 'assets/b.css'];
    const host = fakeCaches({
      [cacheName('precache')]: urls.map((url) => new URL(url, base).href),
    });
    expect(await missingFromCache('precache', urls, host)).toEqual([]);
  });
});
