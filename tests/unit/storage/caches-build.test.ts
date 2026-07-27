/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced Cache Storage
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  11-pwa-lifecycle.md §5.1 (undoing a failed precache install)
 * @invariant INV-3 (every cache name carries the namespace)
 *
 * Purpose: `deleteCachesForBuild` is the rollback path when a precache install fails part-way —
 * the one that has to delete *this* build's caches and leave the previous build's alone, because
 * the previous build is what the player is still running. It had no test until now.
 */
import { describe, expect, it } from 'vitest';
import { deleteCachesForBuild, type CacheHost } from '../../../src/storage/caches.ts';
import { CACHE_KINDS, cacheName, isOurs, type CacheKind } from '../../../src/storage/scope.ts';

/** The three kinds as a list — `CACHE_KINDS` is a lookup object, not an array. */
const ALL_KINDS: readonly CacheKind[] = Object.values(CACHE_KINDS);

function fakeCaches(names: string[]): CacheHost & { readonly remaining: string[] } {
  const store = new Set(names);
  return {
    open: async () => ({}) as Cache,
    keys: async () => [...store],
    delete: async (name: string) => store.delete(name),
    get remaining() {
      return [...store].sort();
    },
  };
}

describe('deleteCachesForBuild', () => {
  it('deletes exactly the named kinds for this build', async () => {
    const host = fakeCaches([cacheName('shell'), cacheName('precache'), cacheName('runtime')]);

    await deleteCachesForBuild(['shell'], host);
    expect(host.remaining).toEqual([cacheName('precache'), cacheName('runtime')].sort());
  });

  it('deletes several kinds at once', async () => {
    const host = fakeCaches(ALL_KINDS.map((kind) => cacheName(kind)));

    await deleteCachesForBuild(ALL_KINDS, host);
    expect(host.remaining).toEqual([]);
  });

  it('leaves another build’s caches alone — that build is what the player is still running', async () => {
    const previousBuild = `${cacheName('shell')}-old`;
    const host = fakeCaches([cacheName('shell'), previousBuild]);

    await deleteCachesForBuild(['shell'], host);
    expect(host.remaining).toEqual([previousBuild]);
  });

  it('never touches a sibling PWA on the same origin (INV-3)', async () => {
    const sibling = 'someone-elses-app-shell-v1';
    const host = fakeCaches([cacheName('shell'), sibling]);

    await deleteCachesForBuild(ALL_KINDS, host);
    expect(host.remaining).toEqual([sibling]);
    expect(isOurs(sibling)).toBe(false);
  });

  it('is a no-op for an empty kind list', async () => {
    const host = fakeCaches([cacheName('shell')]);

    await deleteCachesForBuild([], host);
    expect(host.remaining).toEqual([cacheName('shell')]);
  });

  it('does not fail when the cache was never created', async () => {
    const host = fakeCaches([]);
    await expect(deleteCachesForBuild(['shell'], host)).resolves.toBeUndefined();
  });
});
