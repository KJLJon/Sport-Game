/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced IndexedDB, localStorage, and Cache Storage
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §3, 05-data-model.md §1 (storage overview)
 * @invariant INV-3
 *
 * Purpose: a small promise wrapper over IndexedDB, and the object-store definitions from `05` §1.
 * This is the only module that opens a database, so the namespaced name is impossible to bypass.
 * Deliberately not a generic IndexedDB library — it does what this app needs and no more.
 */
import { dbName } from './scope.ts';

export interface StoreSpec {
  readonly name: string;
  readonly keyPath: string | null;
  readonly indexes?: readonly { name: string; keyPath: string | string[]; unique?: boolean }[];
}

/** `05` §1. Singleton stores use an explicit key rather than a keyPath. */
export const STORES: readonly StoreSpec[] = [
  {
    name: 'athletes',
    keyPath: 'id',
    indexes: [
      { name: 'byPrimarySport', keyPath: 'primarySport' },
      { name: 'byRarity', keyPath: 'rarity' },
      { name: 'byName', keyPath: 'name' },
      { name: 'byCreatedAt', keyPath: 'createdAt' },
    ],
  },
  { name: 'teams', keyPath: 'id', indexes: [{ name: 'byName', keyPath: 'name' }] },
  { name: 'squads', keyPath: 'id', indexes: [{ name: 'byTeam', keyPath: 'teamId' }] },
  { name: 'progress', keyPath: null },
  {
    name: 'achievements',
    keyPath: 'id',
    indexes: [{ name: 'byUnlockedAt', keyPath: 'unlockedAt' }],
  },
  { name: 'economy', keyPath: null },
  {
    name: 'matches',
    keyPath: 'id',
    indexes: [
      { name: 'byPlayedAt', keyPath: 'playedAt' },
      { name: 'bySport', keyPath: 'sportId' },
    ],
  },
  { name: 'settings', keyPath: null },
  { name: 'ledger', keyPath: 'custodyId' },
  { name: 'meta', keyPath: null },
] as const;

export type StoreName = (typeof STORES)[number]['name'];

/** Bumped only by a schema change, which ships with its migration (`05` §9, T-0.13). */
export const DB_VERSION = 1;

/** Promisifies a request, preserving the DOM error rather than flattening it to a string. */
export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export interface OpenOptions {
  /** Runs inside `upgradeneeded`, after stores are created. This is where migrations go. */
  readonly onUpgrade?: (db: IDBDatabase, tx: IDBTransaction, from: number, to: number) => void;
  /**
   * Called when another tab is holding an old version open. The app shows a "close other tabs"
   * notice rather than hanging silently (`11` §9, PWA-14).
   */
  readonly onBlocked?: () => void;
  readonly version?: number;
}

/** Opens the namespaced database, creating any missing stores and indexes. */
export function openDatabase(options: OpenOptions = {}): Promise<IDBDatabase> {
  const version = options.version ?? DB_VERSION;

  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(dbName(), version);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (tx === null) return;

      for (const spec of STORES) {
        const store = db.objectStoreNames.contains(spec.name)
          ? tx.objectStore(spec.name)
          : db.createObjectStore(spec.name, spec.keyPath === null ? {} : { keyPath: spec.keyPath });

        for (const index of spec.indexes ?? []) {
          if (!store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath, { unique: index.unique ?? false });
          }
        }
      }

      options.onUpgrade?.(db, tx, event.oldVersion, event.newVersion ?? version);
    };

    request.onblocked = () => options.onBlocked?.();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the database'));
  });
}

/** Deletes the namespaced database. Used by erase-all-data, never by Repair (INV-13). */
export function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(dbName());
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not delete the database'));
    request.onblocked = () => resolve();
  });
}

/**
 * A typed handle to the app's database. Holds the connection open for the session, which is what
 * IndexedDB is fastest at, and closes on `versionchange` so another tab's upgrade is never
 * blocked.
 */
export class Database {
  readonly #db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.#db = db;
    db.onversionchange = () => db.close();
  }

  static async open(options: OpenOptions = {}): Promise<Database> {
    return new Database(await openDatabase(options));
  }

  get raw(): IDBDatabase {
    return this.#db;
  }

  close(): void {
    this.#db.close();
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    const tx = this.#db.transaction(store, 'readonly');
    const result = await requestToPromise<T | undefined>(tx.objectStore(store).get(key));
    await transactionDone(tx);
    return result;
  }

  async getAll<T>(store: StoreName, query?: IDBKeyRange, count?: number): Promise<T[]> {
    const tx = this.#db.transaction(store, 'readonly');
    const result = await requestToPromise<T[]>(tx.objectStore(store).getAll(query, count));
    await transactionDone(tx);
    return result;
  }

  /** Reads through an index — the roster browser's search and sort paths (`03` T-3.10). */
  async getAllByIndex<T>(store: StoreName, index: string, query?: IDBKeyRange): Promise<T[]> {
    const tx = this.#db.transaction(store, 'readonly');
    const result = await requestToPromise<T[]>(tx.objectStore(store).index(index).getAll(query));
    await transactionDone(tx);
    return result;
  }

  /** Writes one record. `key` is required for the keyPath-less singleton stores. */
  async put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
    const tx = this.#db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await transactionDone(tx);
  }

  /** Writes many records in one transaction, so a partial batch can never be committed. */
  async putMany<T>(
    store: StoreName,
    entries: readonly { value: T; key?: IDBValidKey }[],
  ): Promise<void> {
    const tx = this.#db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    for (const entry of entries) objectStore.put(entry.value, entry.key);
    await transactionDone(tx);
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    const tx = this.#db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await transactionDone(tx);
  }

  async clear(store: StoreName): Promise<void> {
    const tx = this.#db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await transactionDone(tx);
  }

  async count(store: StoreName): Promise<number> {
    const tx = this.#db.transaction(store, 'readonly');
    const result = await requestToPromise<number>(tx.objectStore(store).count());
    await transactionDone(tx);
    return result;
  }

  /**
   * Runs a read-write transaction across several stores. Everything commits or nothing does —
   * which is what a trade, a pack opening, or a migration needs.
   */
  async transaction<T>(
    stores: readonly StoreName[],
    run: (tx: IDBTransaction) => T | Promise<T>,
  ): Promise<T> {
    const tx = this.#db.transaction([...stores], 'readwrite');
    const result = await run(tx);
    await transactionDone(tx);
    return result;
  }
}
