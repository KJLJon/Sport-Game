/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced IndexedDB, localStorage, and Cache Storage
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §3 (storage scoping — the important caveat)
 * @invariant INV-3 (every storage key, database, and cache name carries the base-path namespace)
 * @invariant INV-4 (no literal repository path)
 *
 * Purpose: the one place a storage name is constructed. Browser storage is scoped to the *origin*,
 * not the path, so every PWA on `<user>.github.io` shares one IndexedDB, one localStorage, and one
 * Cache Storage. "Scoped to the repository directory" is therefore implemented as strict
 * namespacing derived from the base path — which achieves the same practical isolation, and lets
 * cleanup delete exactly our own entries and never a sibling project's.
 */

/** The deployed base path — the repository directory, resolved at build (`tools/base-path.ts`). */
export const SCOPE: string = import.meta.env.BASE_URL;

/** The prefix every name carries. Distinct per repository, so two of our apps never collide. */
export const NS = `sportgame${SCOPE}`;

/** The build identifier, injected by Vite. Suffixes cache names so activation can clean up. */
export const BUILD = __BUILD_HASH__;

/** The single IndexedDB database. Stores are listed in `05` §1. */
export function dbName(): string {
  return `${NS}db`;
}

/**
 * A cache name for a resource class. The build hash is part of the name, so a new build gets
 * fresh caches and activation deletes the previous build's — precisely, and only ours.
 */
export function cacheName(kind: string): string {
  return `${NS}${kind}@${BUILD}`;
}

/** A localStorage key. */
export function lsKey(key: string): string {
  return `${NS}${key}`;
}

/** True when a name belongs to this app — the test every cleanup routine gates on. */
export function isOurs(name: string): boolean {
  return name.startsWith(NS);
}

/**
 * True when a cache belongs to this app but to an *older* build. Activation deletes exactly
 * these: never a current cache, never a sibling project's.
 */
export function isStaleCache(name: string): boolean {
  return isOurs(name) && !name.endsWith(`@${BUILD}`);
}

/** Parses a cache name back into its parts. Returns `null` for anything not ours. */
export function parseCacheName(name: string): { kind: string; build: string } | null {
  if (!isOurs(name)) return null;
  const rest = name.slice(NS.length);
  const at = rest.lastIndexOf('@');
  if (at === -1) return null;
  return { kind: rest.slice(0, at), build: rest.slice(at + 1) };
}

/** The resource classes from `11` §2. `version.json` deliberately has no cache. */
export const CACHE_KINDS = {
  /** Content-hashed build assets: cache-first, immutable. */
  precache: 'precache',
  /** Navigations: network-first with a timeout, cache fallback. */
  shell: 'shell',
  /** Manifest and other small unhashed resources: network-first, cache fallback. */
  runtime: 'runtime',
} as const;

export type CacheKind = (typeof CACHE_KINDS)[keyof typeof CACHE_KINDS];
