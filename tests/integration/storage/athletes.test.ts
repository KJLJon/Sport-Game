/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.1 — Athlete schema, IndexedDB store, indexes, repository
 * @story   US-5.5 — Edit and delete profiles
 * @design  05-data-model.md §1 (storage overview), §2 (athlete)
 *
 * Purpose: the repository against real IndexedDB (`fake-indexeddb`), because its interesting
 * behaviour is index- and transaction-shaped. The index reads in particular would pass against a
 * mock while failing in a browser — which is exactly how the `byName`/`displayName` mismatch this
 * task fixed survived Phase 0.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AthleteRepository,
  matchesQuery,
  normaliseForSearch,
} from '../../../src/athletes/repository.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { athlete } from '../../helpers/athletes.ts';

describe('AthleteRepository', () => {
  let db: Database;
  let repo: AthleteRepository;

  beforeEach(async () => {
    await deleteDatabase();
    db = await Database.open();
    repo = new AthleteRepository(db);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase();
  });

  it('round-trips an athlete with every field intact', async () => {
    const created = athlete({
      id: 'a1',
      displayName: 'R. Example',
      traits: ['clutch'],
      condition: { stamina: 80, suspendedGames: 2 },
    });
    await repo.put(created);
    expect(await repo.get('a1')).toEqual(created);
  });

  it('returns undefined for an id that is not there', async () => {
    expect(await repo.get('ghost')).toBeUndefined();
  });

  it('counts and lists the whole roster', async () => {
    await repo.putMany([athlete({ id: 'a' }), athlete({ id: 'b' }), athlete({ id: 'c' })]);
    expect(await repo.count()).toBe(3);
    expect((await repo.getAll()).map((a) => a.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('reads several by id in the order asked, skipping the ones that are gone', async () => {
    await repo.putMany([athlete({ id: 'a' }), athlete({ id: 'b' })]);
    expect((await repo.getMany(['b', 'missing', 'a'])).map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('filters by primary sport through the index', async () => {
    await repo.putMany([
      athlete({ id: 'hoops', primarySport: 'basketball' }),
      athlete({ id: 'boots', primarySport: 'soccer' }),
    ]);
    expect((await repo.byPrimarySport('soccer')).map((a) => a.id)).toEqual(['boots']);
    expect(await repo.byPrimarySport('hockey')).toEqual([]);
  });

  it('filters by rarity through the index', async () => {
    await repo.putMany([
      athlete({ id: 'filler', rarity: 'common' }),
      athlete({ id: 'star', rarity: 'legendary' }),
    ]);
    expect((await repo.byRarity('legendary')).map((a) => a.id)).toEqual(['star']);
  });

  it('returns the most recently created first, limited', async () => {
    await repo.putMany([
      athlete({ id: 'old', createdAt: 1 }),
      athlete({ id: 'mid', createdAt: 2 }),
      athlete({ id: 'new', createdAt: 3 }),
    ]);
    expect((await repo.recent(2)).map((a) => a.id)).toEqual(['new', 'mid']);
    expect(await repo.recent(0)).toEqual([]);
  });

  it('sorts by display name through the index that used to point at nothing', async () => {
    await repo.putMany([
      athlete({ id: 'z', displayName: 'Zeta' }),
      athlete({ id: 'a', displayName: 'Alpha' }),
    ]);
    const byName = await db.getAllByIndex<{ id: string }>('athletes', 'byDisplayName');
    expect(byName.map((a) => a.id)).toEqual(['a', 'z']);
  });

  it('deletes and hands back the record so it can be undone (US-5.5)', async () => {
    await repo.put(athlete({ id: 'a1', displayName: 'Gone' }));
    const deleted = await repo.delete('a1');
    expect(deleted?.athlete.displayName).toBe('Gone');
    expect(await repo.get('a1')).toBeUndefined();

    await repo.restore(deleted!);
    expect((await repo.get('a1'))?.displayName).toBe('Gone');
  });

  it('treats deleting a missing athlete as nothing to undo, not an error', async () => {
    expect(await repo.delete('ghost')).toBeUndefined();
  });

  it('bulk-deletes a selection and returns only what it removed', async () => {
    await repo.putMany([athlete({ id: 'a' }), athlete({ id: 'b' }), athlete({ id: 'c' })]);
    const removed = await repo.deleteMany(['a', 'c', 'ghost']);
    expect(removed.map((r) => r.athlete.id)).toEqual(['a', 'c']);
    expect(await repo.count()).toBe(1);
  });

  it('clears the roster without touching other stores', async () => {
    await repo.put(athlete({ id: 'a' }));
    await db.put('teams', { id: 't1', name: 'Team' });
    await repo.clear();
    expect(await repo.count()).toBe(0);
    expect(await db.count('teams')).toBe(1);
  });
});

describe('search matching', () => {
  it('is case-insensitive and matches on a substring', () => {
    const a = athlete({ displayName: 'Marta Vieira' });
    expect(matchesQuery(a, 'vieira')).toBe(true);
    expect(matchesQuery(a, 'MARTA')).toBe(true);
    expect(matchesQuery(a, 'pelé')).toBe(false);
  });

  it('finds an accented name typed without accents', () => {
    expect(matchesQuery(athlete({ displayName: 'Zlatan Ibrahimović' }), 'ibrahimovic')).toBe(true);
  });

  it('treats an empty or whitespace query as matching everything', () => {
    expect(matchesQuery(athlete(), '   ')).toBe(true);
  });

  it('normalises consistently', () => {
    expect(normaliseForSearch('  ÉLODIE  ')).toBe('elodie');
  });
});
