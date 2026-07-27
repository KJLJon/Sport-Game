/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.12 — Storage persistence request, quota/usage display, denial warning
 * @story   US-1.5 — My data survives
 * @design  11-pwa-lifecycle.md §7 (storage persistence), 10-ui-ux.md §10 (storage denied/full)
 *
 * Purpose: asks the browser to keep our data, and reports honestly when it will not. Browsers
 * grant persistence more readily once engagement is established, so `11` §7 has us re-ask after
 * milestones rather than only once at first launch.
 */

/** Milestones worth re-asking after — the browser weighs engagement (`11` §7). */
export type Milestone = 'first-write' | 'first-athlete' | 'first-pack' | 'first-match';

export type PersistenceState = 'granted' | 'denied' | 'unsupported';

export interface StorageUsage {
  readonly usageBytes: number;
  readonly quotaBytes: number;
  /** 0–1. `null` when the browser reports no quota. */
  readonly fraction: number | null;
}

/** `11` §7 — above this, surface a warning with a "manage data" action. */
export const QUOTA_WARNING_FRACTION = 0.8;

/** The slice of `navigator.storage` we use. Narrowed so tests can substitute a fake. */
export interface StorageManagerLike {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

function defaultManager(): StorageManagerLike | undefined {
  return globalThis.navigator?.storage;
}

/** Reports the current grant without asking for it. */
export async function persistenceState(
  manager: StorageManagerLike | undefined = defaultManager(),
): Promise<PersistenceState> {
  if (manager?.persisted === undefined) return 'unsupported';
  try {
    return (await manager.persisted()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/**
 * Requests persistence. Returns the resulting state rather than throwing — a refusal is an
 * expected answer that the UI has copy for, not an error.
 */
export async function requestPersistence(
  manager: StorageManagerLike | undefined = defaultManager(),
): Promise<PersistenceState> {
  if (manager?.persist === undefined) return 'unsupported';

  // Already granted: asking again is a no-op that some browsers count against us.
  if ((await persistenceState(manager)) === 'granted') return 'granted';

  try {
    return (await manager.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function storageUsage(
  manager: StorageManagerLike | undefined = defaultManager(),
): Promise<StorageUsage | null> {
  if (manager?.estimate === undefined) return null;
  try {
    const estimate = await manager.estimate();
    const usageBytes = estimate.usage ?? 0;
    const quotaBytes = estimate.quota ?? 0;
    return {
      usageBytes,
      quotaBytes,
      fraction: quotaBytes > 0 ? usageBytes / quotaBytes : null,
    };
  } catch {
    return null;
  }
}

export function isQuotaPressured(usage: StorageUsage | null): boolean {
  return usage?.fraction !== null && usage !== null && usage.fraction >= QUOTA_WARNING_FRACTION;
}

/** Human-readable bytes. Binary units, because that is what quota is reported in. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** The plain-language line Settings shows (`10` §9 — never blames the player). */
export function describePersistence(state: PersistenceState): string {
  switch (state) {
    case 'granted':
      return 'Your data is protected from automatic cleanup.';
    case 'denied':
      return 'This browser may clear game data if space runs low. Export a backup to be safe.';
    case 'unsupported':
      return 'This browser cannot guarantee stored data. Export a backup to be safe.';
  }
}

/**
 * Tracks which milestones have already prompted, so the app asks at useful moments and never
 * repeatedly. Callers pass a setter/getter rather than this module reaching for storage.
 */
export class PersistenceNudger {
  readonly #seen = new Set<Milestone>();
  readonly #manager: StorageManagerLike | undefined;

  constructor(manager: StorageManagerLike | undefined = defaultManager()) {
    this.#manager = manager;
  }

  /** Requests persistence at most once per milestone. Returns the state after the attempt. */
  async reach(milestone: Milestone): Promise<PersistenceState> {
    if (this.#seen.has(milestone)) return persistenceState(this.#manager);
    this.#seen.add(milestone);
    return requestPersistence(this.#manager);
  }
}
