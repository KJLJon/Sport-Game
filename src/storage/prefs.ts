/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced IndexedDB, localStorage, and Cache Storage
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §3 (localStorage: small prefs, every key prefixed)
 * @invariant INV-3
 *
 * Purpose: namespaced localStorage for small preferences and last-used selections. Every read is
 * total — a corrupt or absent value yields the fallback rather than throwing — because a bad
 * preference must never be able to stop the app from launching.
 */
import { isOurs, lsKey } from './scope.ts';

/** The storage API we depend on. Narrowed so tests and private-mode fallbacks can substitute. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/** In-memory stand-in for Safari private mode, where `setItem` throws on every write. */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

function defaultStore(): KeyValueStore {
  try {
    const store = globalThis.localStorage;
    // A probe write: private mode exposes the API but throws on use.
    const probe = lsKey('__probe');
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return memoryStore();
  }
}

export class Prefs {
  readonly #store: KeyValueStore;

  constructor(store: KeyValueStore = defaultStore()) {
    this.#store = store;
  }

  /** Reads and parses. Returns `fallback` for a missing, unparseable, or wrong-shaped value. */
  get<T>(key: string, fallback: T, validate?: (value: unknown) => value is T): T {
    let raw: string | null;
    try {
      raw = this.#store.getItem(lsKey(key));
    } catch {
      return fallback;
    }
    if (raw === null) return fallback;

    try {
      const parsed: unknown = JSON.parse(raw);
      if (validate !== undefined) return validate(parsed) ? parsed : fallback;
      return parsed as T;
    } catch {
      return fallback;
    }
  }

  /** Writes. Returns false when storage refused — full, or denied in private mode. */
  set<T>(key: string, value: T): boolean {
    try {
      this.#store.setItem(lsKey(key), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  remove(key: string): void {
    try {
      this.#store.removeItem(lsKey(key));
    } catch {
      // Nothing to do: the value is already unreachable either way.
    }
  }

  /** Every key this app owns, without its namespace prefix. */
  keys(): string[] {
    const out: string[] = [];
    try {
      for (let index = 0; index < this.#store.length; index += 1) {
        const key = this.#store.key(index);
        if (key !== null && isOurs(key)) out.push(key.slice(lsKey('').length));
      }
    } catch {
      return out;
    }
    return out;
  }

  /**
   * Deletes only namespace-prefixed keys — a sibling project on the same origin is untouched
   * (`04` §3).
   */
  clearOurs(): void {
    for (const key of this.keys()) this.remove(key);
  }
}

/** The app-wide instance. Tests construct their own against a fake store. */
export const prefs = new Prefs();
