/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.1 — Scaffold
 * @design  12-quality-and-testing.md §1
 *
 * Purpose: shared test environment setup. `fake-indexeddb` gives storage tests a real IndexedDB
 * implementation under jsdom; the base-path stub keeps namespacing identical across suites.
 */
import 'fake-indexeddb/auto';

// jsdom does not implement `structuredClone` in every version we run against.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}
