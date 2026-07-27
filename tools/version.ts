/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.7 — `version.json` emission + update-detection triggers
 * @story   US-1.4 — Get updates reliably
 * @design  11-pwa-lifecycle.md §3 (update detection), §4 (forced updates)
 *
 * Purpose: builds the `version.json` document. It is emitted at build and served network-only —
 * never cached, because it is the source of truth about what is deployed, and a cached copy of
 * it is precisely how "I couldn't get the update" happens.
 */

export interface VersionInfo {
  /** Short build identifier; matches the suffix on every cache name. */
  readonly buildHash: string;
  /** Semantic version from `package.json`. */
  readonly version: string;
  /** ISO timestamp, so Settings can say "built 3 days ago". */
  readonly builtAt: string;
  /**
   * Running below this forces a non-dismissable update (`11` §4). Raise it only for a release
   * that breaks saves or is badly broken — it takes the player's choice away.
   */
  readonly minSupportedVersion: string;
}

export const VERSION_FILE_NAME = 'version.json';

/**
 * The floor for a forced update. A deliberate constant rather than derived from the version, so
 * raising it is always an explicit decision recorded in a diff.
 */
export const MIN_SUPPORTED_VERSION = '0.0.0';

export interface VersionEnv {
  readonly GITHUB_SHA?: string | undefined;
  readonly BUILD_HASH?: string | undefined;
  /** Fixed timestamp for reproducible builds and tests. */
  readonly SOURCE_DATE_EPOCH?: string | undefined;
}

export function buildVersionInfo(
  buildHash: string,
  packageVersion: string,
  env: VersionEnv = {},
  now: Date = new Date(),
): VersionInfo {
  const epoch = env.SOURCE_DATE_EPOCH;
  const builtAt =
    epoch !== undefined && epoch !== ''
      ? new Date(Number(epoch) * 1000).toISOString()
      : now.toISOString();

  return {
    buildHash,
    version: packageVersion,
    builtAt,
    minSupportedVersion: MIN_SUPPORTED_VERSION,
  };
}

export function serialiseVersionInfo(info: VersionInfo): string {
  return `${JSON.stringify(info, null, 2)}\n`;
}
