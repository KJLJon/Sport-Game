/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.11 — ScopedStorage: namespaced IndexedDB, localStorage, and Cache Storage
 * @story   US-1.3 — Storage and PWA scoped to the repository directory
 * @design  04-architecture.md §3, 05-data-model.md §1
 * @invariant INV-3
 *
 * Purpose: exercises the real IndexedDB path against `fake-indexeddb`, because the interesting
 * failures here are transaction-shaped and a mock would not reproduce them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database, STORES, deleteDatabase } from '../../../src/storage/idb.ts';
import { dbName, isOurs } from '../../../src/storage/scope.ts';

interface TestAthlete {
  id: string;
  name: string;
  primarySport: string;
  rarity: string;
  createdAt: number;
}

function athlete(id: string, overrides: Partial<TestAthlete> = {}): TestAthlete {
  return {
    id,
    name: `Athlete ${id}`,
    primarySport: 'basketball',
    rarity: 'common',
    createdAt: 1,
    ...overrides,
  };
}

describe('Database', () => {
  let db: Database;

  beforeEach(async () => {
    await deleteDatabase();
    db = await Database.open();
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase();
  });

  it('opens under the namespaced name', () => {
    expect(db.raw.name).toBe(dbName());
    expect(isOurs(db.raw.name)).toBe(true);
  });

  it('creates every store from `05` §1', () => {
    const created = [...db.raw.objectStoreNames].sort();
    expect(created).toEqual(STORES.map((store) => store.name).sort());
  });

  it('creates the declared indexes', async () => {
    const tx = db.raw.transaction('athletes', 'readonly');
    const names = [...tx.objectStore('athletes').indexNames].sort();
    expect(names).toEqual(['byCreatedAt', 'byName', 'byPrimarySport', 'byRarity']);
  });

  it('round-trips a keyed record', async () => {
    await db.put('athletes', athlete('a1'));
    expect(await db.get<TestAthlete>('athletes', 'a1')).toMatchObject({ id: 'a1' });
  });

  it('returns undefined for a missing record rather than throwing', async () => {
    expect(await db.get('athletes', 'nope')).toBeUndefined();
  });

  it('stores singletons under an explicit key', async () => {
    await db.put('meta', { schemaVersion: 1, installId: 'i1' }, 'meta');
    expect(await db.get<{ schemaVersion: number }>('meta', 'meta')).toMatchObject({
      schemaVersion: 1,
    });
  });

  it('writes a batch in one transaction', async () => {
    await db.putMany('athletes', [
      { value: athlete('a1') },
      { value: athlete('a2') },
      { value: athlete('a3') },
    ]);
    expect(await db.count('athletes')).toBe(3);
  });

  it('reads through an index', async () => {
    await db.putMany('athletes', [
      { value: athlete('a1', { primarySport: 'basketball' }) },
      { value: athlete('a2', { primarySport: 'soccer' }) },
      { value: athlete('a3', { primarySport: 'soccer' }) },
    ]);

    const soccer = await db.getAllByIndex<TestAthlete>(
      'athletes',
      'byPrimarySport',
      IDBKeyRange.only('soccer'),
    );
    expect(soccer.map((a) => a.id).sort()).toEqual(['a2', 'a3']);
  });

  it('deletes and clears', async () => {
    await db.putMany('athletes', [{ value: athlete('a1') }, { value: athlete('a2') }]);
    await db.delete('athletes', 'a1');
    expect(await db.count('athletes')).toBe(1);

    await db.clear('athletes');
    expect(await db.count('athletes')).toBe(0);
  });

  it('commits a multi-store transaction as a unit', async () => {
    await db.transaction(['athletes', 'economy'], (tx) => {
      tx.objectStore('athletes').put(athlete('a1'));
      tx.objectStore('economy').put({ coins: 900 }, 'economy');
    });

    expect(await db.get('athletes', 'a1')).toBeDefined();
    expect(await db.get<{ coins: number }>('economy', 'economy')).toMatchObject({ coins: 900 });
  });

  it('rejects and rolls back when a transaction step fails', async () => {
    await db.put('athletes', athlete('a1'));

    await expect(
      db.transaction(['athletes'], (tx) => {
        const store = tx.objectStore('athletes');
        store.put(athlete('a2'));
        // `add` on an existing key aborts the transaction, taking the sibling put with it.
        store.add(athlete('a1'));
      }),
    ).rejects.toBeDefined();

    expect(await db.get('athletes', 'a2')).toBeUndefined();
    expect(await db.count('athletes')).toBe(1);
  });

  it('survives reopening: data written in one session is there in the next', async () => {
    await db.put('athletes', athlete('a1'));
    db.close();

    const reopened = await Database.open();
    expect(await reopened.get('athletes', 'a1')).toBeDefined();
    reopened.close();
  });

  it('deletes only the namespaced database', async () => {
    await db.put('athletes', athlete('a1'));
    db.close();
    await deleteDatabase();

    const fresh = await Database.open();
    expect(await fresh.count('athletes')).toBe(0);
    fresh.close();
  });
});
