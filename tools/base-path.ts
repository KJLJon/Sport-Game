/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.2 — Derive `base` from the repository name at build
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §2
 * @invariant INV-4 (no literal repository path exists anywhere in src/)
 *
 * Purpose: resolves the deployed base path from the build environment. Build-time only — this
 * file lives in tools/ precisely so that `src/` never needs to know a repository name.
 */

export interface BasePathEnv {
  /** Set by GitHub Actions as `owner/repo`. */
  GITHUB_REPOSITORY?: string | undefined;
  /** Explicit override; local dev uses `/`. */
  BASE_PATH?: string | undefined;
}

const FALLBACK_REPO = 'Sport-Game';

/** Normalises to a leading-and-trailing-slash path, e.g. `/Sport-Game/`. */
export function normaliseBase(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '/') return '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/**
 * Resolution order: explicit `BASE_PATH` → repository name from `GITHUB_REPOSITORY` → fallback.
 * CI sets `GITHUB_REPOSITORY` automatically, so a repository rename needs no code change.
 */
export function resolveBasePath(env: BasePathEnv = {}): string {
  if (env.BASE_PATH !== undefined && env.BASE_PATH !== '') {
    return normaliseBase(env.BASE_PATH);
  }
  const repo = env.GITHUB_REPOSITORY?.split('/')[1];
  return normaliseBase(repo && repo !== '' ? repo : FALLBACK_REPO);
}
