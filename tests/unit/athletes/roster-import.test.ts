/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.15 — Roster import: file + URL, schema validation, per-record errors, merge/conflict,
 *          responsibility notice
 * @story   US-5.7 — Import a roster file
 * @design  05-data-model.md §8 (roster import schema)
 *
 * Purpose: `parseRosterFile` against `05` §8's acceptance criteria field by field — unknown fields
 * dropped silently, out-of-range values clamped with a warning, a bad record never aborting the
 * rest of the file — plus the merge/conflict classification US-5.7 asks for.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_FORMAT_VERSION,
  classifyImports,
  mergeRoster,
  parseRosterFile,
  resolveConflict,
  type ClassifiedImport,
} from '../../../src/athletes/roster-import.ts';
import { attributeTotal } from '../../../src/athletes/types.ts';
import { rarityForTotal } from '../../../src/athletes/attributes.ts';
import { athlete } from '../../helpers/athletes.ts';

const FULL_ATTRIBUTES = {
  speed: 84,
  acceleration: 91,
  agility: 95,
  strength: 68,
  vertical: 70,
  stamina: 78,
  coordination: 96,
  accuracy: 92,
  awareness: 94,
  composure: 93,
  discipline: 74,
};

function fileWith(...athletes: unknown[]): string {
  return JSON.stringify({ formatVersion: 1, name: 'My roster', athletes });
}

function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayName: 'A. Example',
    primarySport: 'soccer',
    attributes: FULL_ATTRIBUTES,
    ...overrides,
  };
}

describe('parseRosterFile — whole-file problems', () => {
  it('reports malformed JSON as one clear error, not a crash', () => {
    const result = parseRosterFile('{ not json');
    expect(result.athletes).toEqual([]);
    expect(result.accepted).toBe(0);
    expect(result.issues).toEqual([
      { record: 0, message: expect.stringContaining('not valid JSON'), severity: 'error' },
    ]);
  });

  it('rejects a top-level value that is not an object', () => {
    const result = parseRosterFile(JSON.stringify(['nope']));
    expect(result.issues[0]?.message).toContain('expected a JSON object');
  });

  it('rejects a formatVersion newer than this build understands, without partially applying it', () => {
    const result = parseRosterFile(
      JSON.stringify({ formatVersion: CURRENT_FORMAT_VERSION + 1, athletes: [validRecord()] }),
    );
    expect(result.athletes).toEqual([]);
    expect(result.issues[0]?.severity).toBe('error');
    expect(result.issues[0]?.message).toContain('newer than this app understands');
  });

  it('rejects a non-numeric formatVersion', () => {
    const result = parseRosterFile(JSON.stringify({ formatVersion: 'two', athletes: [] }));
    expect(result.issues[0]?.message).toContain('formatVersion');
  });

  it('accepts a file with no formatVersion at all', () => {
    const result = parseRosterFile(JSON.stringify({ athletes: [validRecord()] }));
    expect(result.accepted).toBe(1);
  });

  it('rejects a file with no athletes array', () => {
    const result = parseRosterFile(JSON.stringify({ formatVersion: 1 }));
    expect(result.issues[0]?.message).toContain('athletes');
    expect(result.athletes).toEqual([]);
  });

  it('carries the file’s own roster name through for the preview screen', () => {
    const result = parseRosterFile(fileWith(validRecord()));
    expect(result.rosterName).toBe('My roster');
  });

  it('omits rosterName when the file gives none', () => {
    const result = parseRosterFile(JSON.stringify({ athletes: [validRecord()] }));
    expect(result.rosterName).toBeUndefined();
  });

  it('ignores a non-string, blank name rather than surfacing it as the roster name', () => {
    const result = parseRosterFile(JSON.stringify({ athletes: [validRecord()], name: '   ' }));
    expect(result.rosterName).toBeUndefined();
  });
});

describe('parseRosterFile — per-record validation', () => {
  it('one malformed record never aborts the rest of the file', () => {
    const result = parseRosterFile(
      fileWith(validRecord({ displayName: 'Good One' }), { displayName: 'Missing sport' }),
    );
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(1);
    expect(result.athletes).toHaveLength(1);
    expect(result.athletes[0]?.displayName).toBe('Good One');
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true);
  });

  it('rejects a record that is not an object', () => {
    const result = parseRosterFile(fileWith('not an object'));
    expect(result.rejected).toBe(1);
    expect(result.issues[0]).toMatchObject({ record: 1, severity: 'error' });
  });

  it('rejects a record missing displayName', () => {
    const result = parseRosterFile(fileWith(validRecord({ displayName: undefined })));
    expect(result.rejected).toBe(1);
    expect(result.issues[0]).toMatchObject({ field: 'displayName', severity: 'error' });
  });

  it('rejects a record with a blank displayName', () => {
    const result = parseRosterFile(fileWith(validRecord({ displayName: '   ' })));
    expect(result.rejected).toBe(1);
  });

  it('rejects a record missing primarySport', () => {
    const result = parseRosterFile(fileWith(validRecord({ primarySport: undefined })));
    expect(result.rejected).toBe(1);
    expect(result.issues[0]).toMatchObject({ field: 'primarySport', severity: 'error' });
  });

  it('rejects a record naming a sport outside the documented set', () => {
    const result = parseRosterFile(fileWith(validRecord({ primarySport: 'cricket' })));
    expect(result.rejected).toBe(1);
    expect(result.issues[0]?.field).toBe('primarySport');
  });

  it('accepts every documented sport id', () => {
    for (const sport of ['basketball', 'soccer', 'hockey', 'football']) {
      const result = parseRosterFile(fileWith(validRecord({ primarySport: sport })));
      expect(result.accepted).toBe(1);
    }
  });

  it('rejects a record with no attributes object at all', () => {
    const result = parseRosterFile(fileWith(validRecord({ attributes: undefined })));
    expect(result.rejected).toBe(1);
    expect(result.issues[0]).toMatchObject({ field: 'attributes', severity: 'error' });
  });

  it('rejects a record whose attributes is not an object', () => {
    const result = parseRosterFile(fileWith(validRecord({ attributes: 'nope' })));
    expect(result.rejected).toBe(1);
  });

  it('rejects a record missing one of the eleven attributes', () => {
    const { discipline: _discipline, ...incomplete } = FULL_ATTRIBUTES;
    const result = parseRosterFile(fileWith(validRecord({ attributes: incomplete })));
    expect(result.rejected).toBe(1);
    expect(result.issues[0]).toMatchObject({ field: 'attributes.discipline', severity: 'error' });
  });

  it('rejects a record whose attribute value is not a number', () => {
    const result = parseRosterFile(
      fileWith(validRecord({ attributes: { ...FULL_ATTRIBUTES, speed: 'fast' } })),
    );
    expect(result.rejected).toBe(1);
    expect(result.issues[0]?.field).toBe('attributes.speed');
  });

  it('clamps an out-of-range attribute and records a per-record warning, without rejecting it', () => {
    const result = parseRosterFile(
      fileWith(validRecord({ attributes: { ...FULL_ATTRIBUTES, speed: 150, agility: 0 } })),
    );
    expect(result.accepted).toBe(1);
    expect(result.athletes[0]?.attributes.speed).toBe(99);
    expect(result.athletes[0]?.attributes.agility).toBe(1);
    const warnings = result.issues.filter((issue) => issue.severity === 'warning');
    expect(warnings.map((w) => w.field)).toEqual(
      expect.arrayContaining(['attributes.speed', 'attributes.agility']),
    );
  });

  it('drops an unknown top-level field silently', () => {
    const result = parseRosterFile(
      fileWith(validRecord({ favouriteColour: 'blue', shoeSize: 11 })),
    );
    expect(result.accepted).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('drops an unknown field inside attributes silently', () => {
    const result = parseRosterFile(
      fileWith(validRecord({ attributes: { ...FULL_ATTRIBUTES, telekinesis: 99 } })),
    );
    expect(result.accepted).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it('clamps out-of-range heightCm/weightKg/age with a warning each', () => {
    const result = parseRosterFile(fileWith(validRecord({ heightCm: 999, weightKg: 5, age: 5 })));
    expect(result.accepted).toBe(1);
    expect(result.athletes[0]?.heightCm).toBe(230);
    expect(result.athletes[0]?.weightKg).toBe(45);
    expect(result.athletes[0]?.age).toBe(16);
    const fields = result.issues.map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(['heightCm', 'weightKg', 'age']));
    expect(result.issues.every((issue) => issue.severity === 'warning')).toBe(true);
  });

  it('accepts heightCm/weightKg/age already in range without any warning', () => {
    const result = parseRosterFile(fileWith(validRecord({ heightCm: 180, weightKg: 80, age: 25 })));
    expect(result.issues).toEqual([]);
  });

  it('silently ignores a non-numeric optional physical field rather than rejecting the record', () => {
    const result = parseRosterFile(fileWith(validRecord({ heightCm: 'tall' })));
    expect(result.accepted).toBe(1);
    expect(result.athletes[0]?.heightCm).not.toBe('tall');
  });

  it('accepts a valid handedness', () => {
    const result = parseRosterFile(fileWith(validRecord({ handedness: 'left' })));
    expect(result.athletes[0]?.handedness).toBe('left');
    expect(result.issues).toEqual([]);
  });

  it('warns and ignores an invalid handedness', () => {
    const result = parseRosterFile(fileWith(validRecord({ handedness: 'sideways' })));
    expect(result.accepted).toBe(1);
    expect(result.issues[0]).toMatchObject({ field: 'handedness', severity: 'warning' });
  });

  it('accepts an explicit rarity', () => {
    const result = parseRosterFile(fileWith(validRecord({ rarity: 'legendary' })));
    expect(result.athletes[0]?.rarity).toBe('legendary');
    expect(result.issues).toEqual([]);
  });

  it('defaults rarity from the attribute total when omitted', () => {
    const result = parseRosterFile(fileWith(validRecord()));
    expect(result.athletes[0]?.rarity).toBe(rarityForTotal(attributeTotal(FULL_ATTRIBUTES)));
  });

  it('warns and defaults rarity when the given value is not recognised', () => {
    const result = parseRosterFile(fileWith(validRecord({ rarity: 'mythic' })));
    expect(result.accepted).toBe(1);
    expect(result.issues[0]).toMatchObject({ field: 'rarity', severity: 'warning' });
    expect(result.athletes[0]?.rarity).toBe(rarityForTotal(attributeTotal(FULL_ATTRIBUTES)));
  });

  it('accepts valid traits', () => {
    const result = parseRosterFile(fileWith(validRecord({ traits: ['clutch'] })));
    expect(result.athletes[0]?.traits).toEqual(['clutch']);
    expect(result.issues).toEqual([]);
  });

  it('drops unrecognised traits with a warning, keeping the recognised ones', () => {
    const result = parseRosterFile(fileWith(validRecord({ traits: ['clutch', 'invisible'] })));
    expect(result.athletes[0]?.traits).toEqual(['clutch']);
    expect(result.issues[0]).toMatchObject({ field: 'traits', severity: 'warning' });
  });

  it('warns when traits is not a list at all', () => {
    const result = parseRosterFile(fileWith(validRecord({ traits: 'clutch' })));
    expect(result.accepted).toBe(1);
    expect(result.athletes[0]?.traits).toEqual([]);
    expect(result.issues[0]).toMatchObject({ field: 'traits', severity: 'warning' });
  });
});

describe('parseRosterFile — imported athletes are marked as such', () => {
  it('sets source, a fresh custodyId, and primary-sport familiarity 85', () => {
    const result = parseRosterFile(fileWith(validRecord()), 1_700_000_000_000);
    const [record] = result.athletes;
    expect(record?.source).toBe('import');
    expect(record?.custodyId).toBeTruthy();
    expect(record?.sportSkills[record.primarySport]?.familiarity).toBe(85);
    expect(record?.createdAt).toBe(1_700_000_000_000);
  });

  it('gives two imported athletes distinct ids and custodyIds', () => {
    const result = parseRosterFile(fileWith(validRecord(), validRecord({ displayName: 'Other' })));
    const [first, second] = result.athletes;
    expect(first?.id).not.toBe(second?.id);
    expect(first?.custodyId).not.toBe(second?.custodyId);
  });
});

describe('classifyImports', () => {
  it('classifies a record with no overlap as new', () => {
    const incoming = [athlete({ id: 'incoming-1', custodyId: 'custody-1' })];
    const [result] = classifyImports(incoming, []);
    expect(result).toMatchObject({ classification: 'new' });
  });

  it('flags a duplicate custodyId as a conflict', () => {
    const existing = athlete({ id: 'existing-1', custodyId: 'shared-custody' });
    const incoming = athlete({ id: 'incoming-1', custodyId: 'shared-custody' });
    const [result] = classifyImports([incoming], [existing]);
    expect(result).toMatchObject({ classification: 'conflict', reason: 'custodyId' });
    expect(result?.conflictsWith).toBe(existing);
  });

  it('flags an identical displayName + primarySport as a conflict even with different custodyIds', () => {
    const existing = athlete({
      id: 'existing-1',
      custodyId: 'custody-a',
      displayName: 'Ada Lovelace',
      primarySport: 'basketball',
    });
    const incoming = athlete({
      id: 'incoming-1',
      custodyId: 'custody-b',
      displayName: 'ada lovelace',
      primarySport: 'basketball',
    });
    const [result] = classifyImports([incoming], [existing]);
    expect(result).toMatchObject({ classification: 'conflict', reason: 'name-and-sport' });
  });

  it('does not conflict on name alone across different sports', () => {
    const existing = athlete({
      id: 'existing-1',
      custodyId: 'custody-a',
      displayName: 'Ada Lovelace',
      primarySport: 'basketball',
    });
    const incoming = athlete({
      id: 'incoming-1',
      custodyId: 'custody-b',
      displayName: 'Ada Lovelace',
      primarySport: 'soccer',
    });
    const [result] = classifyImports([incoming], [existing]);
    expect(result?.classification).toBe('new');
  });
});

describe('resolveConflict', () => {
  function conflictOf(reason: 'custodyId' | 'name-and-sport' = 'custodyId'): ClassifiedImport {
    const existing = athlete({ id: 'existing-1', custodyId: 'shared' });
    const incoming = athlete({ id: 'incoming-1', custodyId: 'shared' });
    return { athlete: incoming, classification: 'conflict', conflictsWith: existing, reason };
  }

  it('passes a non-conflicting entry through unchanged', () => {
    const entry: ClassifiedImport = { athlete: athlete({ id: 'a' }), classification: 'new' };
    expect(resolveConflict(entry, 'skip')).toBe(entry.athlete);
  });

  it('skip drops the incoming record', () => {
    expect(resolveConflict(conflictOf(), 'skip')).toBeNull();
  });

  it('keep-both writes the incoming record under its own fresh id', () => {
    const conflict = conflictOf();
    expect(resolveConflict(conflict, 'keep-both')).toBe(conflict.athlete);
  });

  it('replace writes the incoming record under the existing record’s id', () => {
    const conflict = conflictOf();
    const resolved = resolveConflict(conflict, 'replace');
    expect(resolved?.id).toBe(conflict.conflictsWith?.id);
    expect(resolved?.custodyId).toBe(conflict.athlete.custodyId);
  });
});

describe('mergeRoster', () => {
  it('writes every new record and skips unresolved conflicts', () => {
    const newEntry: ClassifiedImport = {
      athlete: athlete({ id: 'new-1' }),
      classification: 'new',
    };
    const existing = athlete({ id: 'existing-1', custodyId: 'shared' });
    const conflictEntry: ClassifiedImport = {
      athlete: athlete({ id: 'incoming-1', custodyId: 'shared' }),
      classification: 'conflict',
      conflictsWith: existing,
      reason: 'custodyId',
    };

    const written = mergeRoster([newEntry, conflictEntry], new Map());
    expect(written).toEqual([newEntry.athlete]);
  });

  it('applies a supplied resolution to a conflict', () => {
    const existing = athlete({ id: 'existing-1', custodyId: 'shared' });
    const incoming = athlete({ id: 'incoming-1', custodyId: 'shared' });
    const conflictEntry: ClassifiedImport = {
      athlete: incoming,
      classification: 'conflict',
      conflictsWith: existing,
      reason: 'custodyId',
    };

    const written = mergeRoster([conflictEntry], new Map([[incoming.id, 'replace']]));
    expect(written).toEqual([{ ...incoming, id: existing.id }]);
  });
});
