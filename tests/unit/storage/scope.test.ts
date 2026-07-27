/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced IndexedDB, localStorage, and Cache Storage
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §3
 * @invariant INV-3
 */
import { describe, expect, it } from 'vitest';
import {
  BUILD,
  CACHE_KINDS,
  NS,
  SCOPE,
  cacheName,
  dbName,
  isOurs,
  isStaleCache,
  lsKey,
  parseCacheName,
} from '../../../src/storage/scope.ts';

describe('scope', () => {
  it('derives the namespace from the base path, never from a literal', () => {
    expect(NS).toBe(`sportgame${SCOPE}`);
    expect(SCOPE.startsWith('/')).toBe(true);
    expect(SCOPE.endsWith('/')).toBe(true);
  });

  it('prefixes the database name', () => {
    expect(dbName().startsWith(NS)).toBe(true);
  });

  it('prefixes localStorage keys', () => {
    expect(lsKey('theme')).toBe(`${NS}theme`);
  });

  it('prefixes and build-suffixes cache names', () => {
    const name = cacheName(CACHE_KINDS.precache);
    expect(name.startsWith(NS)).toBe(true);
    expect(name.endsWith(`@${BUILD}`)).toBe(true);
  });

  it('recognises our names and rejects a sibling project on the same origin', () => {
    expect(isOurs(cacheName('shell'))).toBe(true);
    expect(isOurs(dbName())).toBe(true);
    expect(isOurs('some-other-app-precache-v3')).toBe(false);
    expect(isOurs('workbox-precache-v2')).toBe(false);
    // Same product, different repository directory — a second copy of this game deployed under
    // another repo name on the same account is still not ours.
    expect(isOurs('sportgame/Other-Repo/precache@abc')).toBe(false);
  });

  it('treats only our previous builds as stale', () => {
    expect(isStaleCache(`${NS}precache@older`)).toBe(true);
    expect(isStaleCache(cacheName('precache'))).toBe(false);
    expect(isStaleCache('some-other-app@older')).toBe(false);
  });

  it('round-trips a cache name', () => {
    expect(parseCacheName(cacheName('runtime'))).toEqual({ kind: 'runtime', build: BUILD });
    expect(parseCacheName('some-other-app@x')).toBeNull();
    expect(parseCacheName(`${NS}no-build-suffix`)).toBeNull();
  });

  it('keeps every resource class distinct', () => {
    const names = Object.values(CACHE_KINDS).map(cacheName);
    expect(new Set(names).size).toBe(names.length);
  });
});
