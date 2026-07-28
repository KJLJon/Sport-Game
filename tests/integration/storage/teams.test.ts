/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.11 — Teams: create/edit, name, colours, generic crests
 * @story   US-6.1 — Build a team
 * @story   US-6.2 — Set a lineup
 * @design  05-data-model.md §1
 *
 * Purpose: the team and squad repository against real IndexedDB. The cases that matter are the
 * relational ones — a deleted team must not leave squads behind, and a deleted athlete must not
 * leave a lineup pointing at a record that is gone.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TeamRepository } from '../../../src/teams/repository.ts';
import {
  CREST_IDS,
  TEAM_PALETTES,
  filledSlots,
  isCrestId,
  newSquad,
  squadIsValid,
  squadKey,
  squadMembers,
  type Squad,
  type Team,
} from '../../../src/teams/types.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';

function team(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    schemaVersion: 1,
    name: `Team ${id}`,
    shortName: id.slice(0, 3).toUpperCase(),
    colours: { primary: '#2f4858', secondary: '#f2ede4' },
    crestId: 'shield',
    createdAt: 1,
    editable: true,
    ...overrides,
  };
}

function squad(teamId: string, sportId: string, overrides: Partial<Squad> = {}): Squad {
  return { ...newSquad(teamId, sportId, 1), ...overrides, id: squadKey(teamId, sportId) };
}

describe('team schema helpers', () => {
  it('keys a squad by team and sport, so one roster feeds many squads (US-6.1)', () => {
    expect(squadKey('t1', 'basketball')).toBe('t1:basketball');
    expect(newSquad('t1', 'soccer').id).toBe('t1:soccer');
  });

  it('lists starters then bench, without duplicates', () => {
    const s = squad('t1', 'basketball', {
      starters: { PG: 'a', SG: 'b', SF: '', PF: 'c' },
      bench: ['d', 'a', ''],
    });
    expect(squadMembers(s)).toEqual(['a', 'b', 'c', 'd']);
    expect(filledSlots(s)).toBe(3);
  });

  it('is fieldable only when every slot is filled and nobody is named twice', () => {
    const full = squad('t1', 'basketball', {
      starters: { PG: 'a', SG: 'b', SF: 'c', PF: 'd', C: 'e' },
    });
    expect(squadIsValid(full, 5)).toBe(true);
    expect(squadIsValid(full, 6)).toBe(false);

    // The failure that matters: the same athlete would spawn twice in the sim.
    const doubled = squad('t1', 'basketball', {
      starters: { PG: 'a', SG: 'b', SF: 'c', PF: 'd', C: 'e' },
      bench: ['a'],
    });
    expect(squadIsValid(doubled, 5)).toBe(false);
  });

  it('offers colourblind-safe palettes, each with a name rather than a hue', () => {
    expect(TEAM_PALETTES.length).toBeGreaterThanOrEqual(6);
    for (const palette of TEAM_PALETTES) {
      expect(palette.name).not.toBe('');
      expect(palette.colours.primary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(palette.colours.secondary).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(TEAM_PALETTES.map((p) => p.id)).size).toBe(TEAM_PALETTES.length);
  });

  it('validates crest ids', () => {
    expect(CREST_IDS.length).toBeGreaterThan(4);
    expect(isCrestId('shield')).toBe(true);
    expect(isCrestId('a-real-club-badge')).toBe(false);
  });
});

describe('TeamRepository', () => {
  let db: Database;
  let repo: TeamRepository;

  beforeEach(async () => {
    await deleteDatabase();
    db = await Database.open();
    repo = new TeamRepository(db);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase();
  });

  it('round-trips a team', async () => {
    const created = team('t1', { name: 'Riverside', shortName: 'RIV' });
    await repo.put(created);
    expect(await repo.get('t1')).toEqual(created);
    expect(await repo.count()).toBe(1);
  });

  it('holds a squad per sport for one team (US-6.1)', async () => {
    await repo.put(team('t1'));
    await repo.putSquad(squad('t1', 'basketball', { starters: { PG: 'a' } }));
    await repo.putSquad(squad('t1', 'soccer', { starters: { GK: 'a' } }));

    expect((await repo.squad('t1', 'basketball'))?.starters).toEqual({ PG: 'a' });
    expect((await repo.squad('t1', 'soccer'))?.starters).toEqual({ GK: 'a' });
    expect(await repo.squads('t1')).toHaveLength(2);
  });

  it('rebuilds the key on write, so half a key can never be stored', async () => {
    await repo.putSquad({ ...squad('t1', 'basketball'), id: 'nonsense' });
    expect(await repo.squad('t1', 'basketball')).toBeDefined();
  });

  it('deletes a team and its squads together, leaving no orphans', async () => {
    await repo.put(team('t1'));
    await repo.put(team('t2'));
    await repo.putSquad(squad('t1', 'basketball'));
    await repo.putSquad(squad('t1', 'soccer'));
    await repo.putSquad(squad('t2', 'basketball'));

    const deleted = await repo.delete('t1');
    expect(deleted?.squads).toHaveLength(2);
    expect(await repo.get('t1')).toBeUndefined();
    expect(await repo.squads('t1')).toEqual([]);
    // The other team is untouched.
    expect(await repo.squads('t2')).toHaveLength(1);
  });

  it('restores a deleted team with its squads', async () => {
    await repo.put(team('t1'));
    await repo.putSquad(squad('t1', 'basketball', { starters: { PG: 'a' } }));

    const deleted = await repo.delete('t1');
    await repo.restore(deleted!);

    expect(await repo.get('t1')).toBeDefined();
    expect((await repo.squad('t1', 'basketball'))?.starters).toEqual({ PG: 'a' });
  });

  it('treats deleting a missing team as nothing to undo', async () => {
    expect(await repo.delete('ghost')).toBeUndefined();
  });

  it('finds every squad naming an athlete — what selling has to check (US-9.3)', async () => {
    await repo.putSquad(squad('t1', 'basketball', { starters: { PG: 'a', SG: 'b' } }));
    await repo.putSquad(squad('t2', 'basketball', { bench: ['a'] }));
    await repo.putSquad(squad('t3', 'basketball', { starters: { PG: 'c' } }));

    expect((await repo.squadsContaining('a')).map((s) => s.teamId).sort()).toEqual(['t1', 't2']);
    expect(await repo.squadsContaining('nobody')).toEqual([]);
  });

  it('removes a deleted athlete from every lineup that names them', async () => {
    await repo.putSquad(squad('t1', 'basketball', { starters: { PG: 'a', SG: 'b' } }));
    await repo.putSquad(squad('t2', 'soccer', { bench: ['a', 'z'] }));

    const updated = await repo.removeAthlete('a', 99);
    expect(updated).toHaveLength(2);

    expect((await repo.squad('t1', 'basketball'))?.starters).toEqual({ SG: 'b' });
    expect((await repo.squad('t2', 'soccer'))?.bench).toEqual(['z']);
    expect((await repo.squad('t1', 'basketball'))?.updatedAt).toBe(99);
  });

  it('does no work when the athlete is in no lineup at all', async () => {
    await repo.putSquad(squad('t1', 'basketball', { starters: { PG: 'a' } }));
    expect(await repo.removeAthlete('nobody')).toEqual([]);
  });

  it('clears teams and squads together', async () => {
    await repo.put(team('t1'));
    await repo.putSquad(squad('t1', 'basketball'));
    await repo.clear();

    expect(await repo.count()).toBe(0);
    expect(await repo.squads('t1')).toEqual([]);
  });

  it('writes many teams in one transaction', async () => {
    await repo.putMany([team('a'), team('b'), team('c')]);
    expect((await repo.getAll()).map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
  });
});
