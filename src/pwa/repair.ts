/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.10 — Repair flow — caches and SW only, IndexedDB untouched
 * @story   US-1.9 — A way out when the app gets stuck
 * @design  11-pwa-lifecycle.md §6 (Repair — the escape hatch)
 * @invariant INV-13 (Repair deletes only namespaced caches and never touches IndexedDB)
 *
 * Purpose: one button that fixes every stuck state. The player's roster, progress, coins, and
 * achievements live in IndexedDB, and nothing here reads or writes it — that promise is the only
 * reason anyone would ever press this button, so it is enforced by an invariant test as well as
 * by this module importing no IndexedDB code at all.
 */
import { deleteAllOurCaches } from '../storage/caches.ts';
import { unregisterOurWorkers } from './register.ts';

export interface RepairReport {
  readonly workersUnregistered: number;
  readonly cachesDeleted: readonly string[];
}

export interface RepairOptions {
  readonly container?: ServiceWorkerContainer | undefined;
  /** Injected for tests; defaults to a cache-busting hard reload. */
  readonly reload?: (url: string) => void;
  readonly baseUrl?: string;
}

/** What Repair will and will not touch, in the words the UI must use verbatim (`11` §6). */
export const REPAIR_PROMISE =
  'Your roster, progress, coins, and achievements are stored separately and are never touched by Repair.';

/**
 * `11` §6, steps 2–6. Step 1 — offering a backup download — belongs to the caller, because it is
 * a choice, not part of the repair.
 */
export async function repair(options: RepairOptions = {}): Promise<RepairReport> {
  const container = options.container ?? globalThis.navigator?.serviceWorker;

  // 2. Unregister every service worker in our scope.
  const workersUnregistered = await unregisterOurWorkers(
    container === undefined ? {} : { container },
  );

  // 3–4. Delete every cache carrying our namespace — ours only, never a sibling project's.
  //      IndexedDB is deliberately absent from this function.
  const cachesDeleted = await deleteAllOurCaches();

  // 5. Hard-reload with a cache-busting parameter, so no intermediary can answer from its cache.
  const base = options.baseUrl ?? import.meta.env.BASE_URL;
  const target = `${base}?repaired=${Date.now().toString(36)}`;
  (options.reload ?? ((url: string) => globalThis.location.replace(url)))(target);

  // 6. Re-registration happens on the next boot, from `main.ts`.
  return { workersUnregistered, cachesDeleted };
}
