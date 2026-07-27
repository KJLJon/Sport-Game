/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.1 — Scaffold, T-0.6 — Versioned caches
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §3 (cache names carry the build hash), 11-pwa-lifecycle.md §2
 *
 * Purpose: produces the build identifier that suffixes every cache name, so service-worker
 * activation can delete exactly the caches belonging to previous builds of this app.
 */

export interface BuildHashEnv {
  /** Commit SHA supplied by CI. */
  GITHUB_SHA?: string | undefined;
  /** Explicit override, used by deterministic tests. */
  BUILD_HASH?: string | undefined;
}

/** Short, URL-safe, stable within a build; unique across builds. */
export function buildHash(env: BuildHashEnv = {}, now: number = Date.now()): string {
  if (env.BUILD_HASH !== undefined && env.BUILD_HASH !== '') return env.BUILD_HASH;
  if (env.GITHUB_SHA !== undefined && env.GITHUB_SHA !== '') return env.GITHUB_SHA.slice(0, 7);
  return `dev${now.toString(36)}`;
}
