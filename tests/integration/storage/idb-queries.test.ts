/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced IndexedDB
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  05-data-model.md §1, 12-quality-and-testing.md §2 (storage ≥95%)
 * @invariant INV-3
 *
 * Purpose: the read paths the roster browser will lean on — bulk reads, index reads, and range
 * queries — plus database deletion and the `versionchange` close. These were the gap that kept
 * `src/storage/**` under its function-coverage threshold from Gate 0 onwards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Database,
  deleteDatabase,
  openDatabase,
  requestToPromise,
} from '../../../src/storage/idb.ts';

interface Athlete {
  id: string;
  name: string;
  primarySport: string;
  rarity: string;
  createdAt: number;
}

function athlete(id: string, overrides: Partial<Athlete> = {}): Athlete {
  return {
    id,
    name: `Athlete ${id}`,
    primarySport: 'basketball',
    rarity: 'common',
    createdAt: 1,
    ...overrides,
  };
}

let db: Database;

beforeEach(async () => {
  await deleteDatabase();
  db = await Database.open();
});

afterEach(async () => {
  db.close();
  await deleteDatabase();
});

describe('bulk reads', () => {
  beforeEach(async () => {
    await db.putMany('athletes', [
      { value: athlete('a', { createdAt: 3 }) },
      { value: athlete('b', { createdAt: 1, primarySport: 'soccer' }) },
      { value: athlete('c', { createdAt: 2, primarySport: 'soccer' }) },
    ]);
  });

  it('reads every record in a store', async () => {
    const all = await db.getAll<Athlete>('athletes');
    expect(all.map((row) => row.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('limits how many records it reads', async () => {
    expect(await db.getAll<Athlete>('athletes', undefined, 2)).toHaveLength(2);
  });

  it('reads a key range rather than the whole store', async () => {
    const range = IDBKeyRange.bound('a', 'b');
    const rows = await db.getAll<Athlete>('athletes', range);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('reads through an index', async () => {
    const soccer = await db.getAllByIndex<Athlete>(
      'athletes',
      'byPrimarySport',
      IDBKeyRange.only('soccer'),
    );
    expect(soccer.map((row) => row.id).sort()).toEqual(['b', 'c']);
  });

  it('reads a whole index with no range', async () => {
    expect(await db.getAllByIndex<Athlete>('athletes', 'byPrimarySport')).toHaveLength(3);
  });

  it('returns an empty array rather than throwing on an empty store', async () => {
    await db.clear('athletes');
    expect(await db.getAll('athletes')).toEqual([]);
  });
});

describe('connection handling', () => {
  it('exposes the raw connection for the migration runner', () => {
    expect(db.raw.name).toContain('sportgame');
    expect([...db.raw.objectStoreNames]).toContain('athletes');
  });

  it('closes itself on versionchange, so another tab can upgrade', async () => {
    let closed = false;
    const raw = db.raw;
    const originalClose = raw.close.bind(raw);
    raw.close = () => {
      closed = true;
      originalClose();
    };

    raw.onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent);
    expect(closed).toBe(true);
  });

  it('opens twice without conflict', async () => {
    const second = await Database.open();
    expect(await second.count('athletes')).toBe(0);
    second.close();
  });

  it('deletes the database, and deleting a missing one is not an error', async () => {
    db.close();
    await expect(deleteDatabase()).resolves.toBeUndefined();
    await expect(deleteDatabase()).resolves.toBeUndefined();
  });

  it('recreates every store on the next open after a delete', async () => {
    db.close();
    await deleteDatabase();

    const reopened = await openDatabase();
    expect([...reopened.objectStoreNames].length).toBeGreaterThan(0);
    reopened.close();
  });
});

describe('failure paths', () => {
  it('rejects a failed request with the DOM error rather than a string', async () => {
    const failing = {
      error: new DOMException('quota exceeded', 'QuotaExceededError'),
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
    } as unknown as IDBRequest<never>;

    const promise = requestToPromise(failing);
    failing.onerror?.(new Event('error'));

    await expect(promise).rejects.toBeInstanceOf(DOMException);
  });

  it('falls back to a plain error when the request carries none', async () => {
    const failing = {
      error: null,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
    } as unknown as IDBRequest<never>;

    const promise = requestToPromise(failing);
    failing.onerror?.(new Event('error'));

    await expect(promise).rejects.toThrow(/IndexedDB request failed/);
  });

  it('rejects when a transaction is aborted, so a half-written batch never looks committed', async () => {
    await expect(
      db.transaction(['athletes'], (tx) => {
        tx.objectStore('athletes').put(athlete('doomed'));
        tx.abort();
      }),
      // fake-indexeddb signals an abort through `onerror` rather than `onabort`; real browsers
      // vary too, which is why both handlers reject.
    ).rejects.toThrow(/abort|failed/i);

    expect(await db.get('athletes', 'doomed')).toBeUndefined();
  });

  it('reports a blocked upgrade instead of hanging (`11` §9, PWA-14)', async () => {
    const blocked = vi.fn();
    const realOpen = globalThis.indexedDB.open.bind(globalThis.indexedDB);

    const request = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: Event) => void) | null,
      error: null,
      result: db.raw,
      transaction: null,
    };
    globalThis.indexedDB.open = (() => request) as unknown as typeof globalThis.indexedDB.open;

    const promise = openDatabase({ onBlocked: blocked });
    request.onblocked?.(new Event('blocked'));
    request.onsuccess?.(new Event('success'));

    await promise;
    expect(blocked).toHaveBeenCalled();

    globalThis.indexedDB.open = realOpen;
  });

  it('rejects when the database cannot be opened at all — Safari private mode', async () => {
    const realOpen = globalThis.indexedDB.open.bind(globalThis.indexedDB);
    const request = {
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: Event) => void) | null,
      error: new DOMException('denied', 'SecurityError'),
    };
    globalThis.indexedDB.open = (() => request) as unknown as typeof globalThis.indexedDB.open;

    const promise = openDatabase();
    request.onerror?.(new Event('error'));

    await expect(promise).rejects.toBeInstanceOf(DOMException);
    globalThis.indexedDB.open = realOpen;
  });
});
