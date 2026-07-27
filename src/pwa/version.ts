/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.7 — `version.json` emission + all five update-detection triggers
 * @story   US-1.4 — Get updates reliably
 * @design  11-pwa-lifecycle.md §3 (update detection), §4 (applying an update)
 * @invariant INV-4 (no literal repository path), INV-14 (no third-party requests)
 *
 * Purpose: fetches and compares the deployed version. This is trigger 5 in `11` §3 and the one
 * that matters most: it lets the app notice a version mismatch even when the service-worker
 * mechanism has failed entirely, so it can offer Repair instead of silently doing nothing.
 */

export interface VersionInfo {
  readonly buildHash: string;
  readonly version: string;
  readonly builtAt: string;
  readonly minSupportedVersion: string;
}

/** The build this running code came from. Injected by Vite at build. */
export const RUNNING_BUILD: string = __BUILD_HASH__;

export const VERSION_URL = `${import.meta.env.BASE_URL}version.json`;

export type VersionFetchResult =
  | { readonly status: 'ok'; readonly info: VersionInfo }
  /** Offline, or the request timed out. Not an error — just unknown (`11` §2). */
  | { readonly status: 'unknown' }
  /** Reached the server but the document was not a valid version file. */
  | { readonly status: 'invalid' };

function isVersionInfo(value: unknown): value is VersionInfo {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['buildHash'] === 'string' &&
    typeof candidate['version'] === 'string' &&
    typeof candidate['builtAt'] === 'string' &&
    typeof candidate['minSupportedVersion'] === 'string'
  );
}

export interface FetchVersionOptions {
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
  readonly url?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Fetches `version.json` with `cache: 'no-store'`. Never throws — being offline is the expected
 * case for this app, not an exception.
 */
export async function fetchVersion(options: FetchVersionOptions = {}): Promise<VersionFetchResult> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const url = options.url ?? VERSION_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      signal: controller.signal,
      // Belt and braces: an intermediary must not answer this from its own cache either.
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) return { status: 'invalid' };

    const parsed: unknown = await response.json();
    return isVersionInfo(parsed) ? { status: 'ok', info: parsed } : { status: 'invalid' };
  } catch {
    return { status: 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

/** Compares dotted numeric versions. Returns <0, 0, or >0. Non-numeric parts sort as 0. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const x = Number.parseInt(left[index] ?? '0', 10);
    const y = Number.parseInt(right[index] ?? '0', 10);
    const xs = Number.isNaN(x) ? 0 : x;
    const ys = Number.isNaN(y) ? 0 : y;
    if (xs !== ys) return xs < ys ? -1 : 1;
  }
  return 0;
}

export interface VersionComparison {
  /** The deployed build differs from the running one. */
  readonly differs: boolean;
  /** The running version is below `minSupportedVersion`: the update is not dismissable. */
  readonly forced: boolean;
}

/**
 * @param runningVersion The semantic version this build was released as.
 */
export function compareToDeployed(
  deployed: VersionInfo,
  runningBuild: string,
  runningVersion: string,
): VersionComparison {
  return {
    differs: deployed.buildHash !== runningBuild,
    forced: compareVersions(runningVersion, deployed.minSupportedVersion) < 0,
  };
}

/** "3 days ago" — used in Settings so "am I on the new one?" is always answerable (`11` §4). */
export function describeAge(builtAt: string, now: number = Date.now()): string {
  const built = Date.parse(builtAt);
  if (Number.isNaN(built)) return 'unknown';

  const seconds = Math.max(0, Math.round((now - built) / 1000));
  if (seconds < 60) return 'just now';

  const units: readonly [number, string][] = [
    [60, 'minute'],
    [60, 'hour'],
    [24, 'day'],
    [7, 'week'],
  ];

  let value = seconds;
  let label = 'second';
  for (const [divisor, name] of units) {
    if (value < divisor) break;
    value = Math.floor(value / divisor);
    label = name;
  }

  return `${value} ${label}${value === 1 ? '' : 's'} ago`;
}
