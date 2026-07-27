/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.2 — Attribute system: budget rules, sandbox flag, random roll
 * @design  05-data-model.md §2 (athlete), §3.3 (starting familiarity), §4 (rarity)
 *
 * Purpose: the factory is the only door into the roster, so what it guarantees is worth pinning:
 * a clamped, complete record with the primary sport already known and every other sport not.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/engine/rng.ts';
import {
  ATHLETE_SCHEMA_VERSION,
  createAthlete,
  newId,
  rollAthlete,
  seededId,
} from '../../../src/athletes/create.ts';
import { CREATION_DEFAULTS } from '../../../src/athletes/tuning.ts';
import {
  STARTING_FAMILIARITY,
  attributeTotal,
  sportSkillFor,
} from '../../../src/athletes/types.ts';
import { attributes } from '../../helpers/athletes.ts';

const base = {
  displayName: 'A. Example',
  primarySport: 'basketball',
  attributes: attributes(50),
};

describe('createAthlete', () => {
  it('produces a complete record at the current schema version', () => {
    const athlete = createAthlete(base);
    expect(athlete.schemaVersion).toBe(ATHLETE_SCHEMA_VERSION);
    expect(athlete.id).not.toBe('');
    expect(athlete.custodyId).not.toBe(athlete.id);
    expect(athlete.condition).toEqual({ stamina: 100 });
    expect(athlete.createdAt).toBeGreaterThan(0);
  });

  it('starts the primary sport at 85 and leaves every other sport unknown (`05` §3.3)', () => {
    const athlete = createAthlete(base);
    expect(Object.keys(athlete.sportSkills)).toEqual(['basketball']);
    expect(athlete.sportSkills.basketball?.familiarity).toBe(STARTING_FAMILIARITY.primary);
    expect(sportSkillFor(athlete, 'soccer').familiarity).toBe(STARTING_FAMILIARITY.other);
  });

  it('fills the body from the defaults when the caller gives none', () => {
    const athlete = createAthlete(base);
    expect(athlete.heightCm).toBe(CREATION_DEFAULTS.heightCm);
    expect(athlete.weightKg).toBe(CREATION_DEFAULTS.weightKg);
    expect(athlete.age).toBe(CREATION_DEFAULTS.age);
    expect(athlete.handedness).toBe('right');
  });

  it('clamps rather than throws — a half-built athlete is worse than a clamped one', () => {
    const athlete = createAthlete({
      ...base,
      attributes: attributes(50, { speed: 400, agility: -20 }),
      heightCm: 400,
      weightKg: 5,
      age: 99,
      jerseyNumber: 1_000,
    });
    expect(athlete.attributes.speed).toBe(99);
    expect(athlete.attributes.agility).toBe(1);
    expect(athlete.heightCm).toBe(230);
    expect(athlete.weightKg).toBe(45);
    expect(athlete.age).toBe(45);
    expect(athlete.jerseyNumber).toBe(99);
  });

  it('tidies a name and never leaves one blank', () => {
    expect(createAthlete({ ...base, displayName: '  A.   Example  ' }).displayName).toBe(
      'A. Example',
    );
    expect(createAthlete({ ...base, displayName: '   ' }).displayName).toBe('Unnamed athlete');
    expect(createAthlete({ ...base, displayName: 'x'.repeat(200) }).displayName).toHaveLength(40);
  });

  it('omits absent optional fields entirely rather than storing undefined', () => {
    const athlete = createAthlete(base);
    expect('jerseyNumber' in athlete).toBe(false);
    expect('portraitBlobId' in athlete).toBe(false);
    expect('nationalityLabel' in athlete).toBe(false);
  });

  it('keeps the optional fields it is given', () => {
    const athlete = createAthlete({
      ...base,
      jerseyNumber: 23,
      portraitBlobId: 'blob-1',
      nationalityLabel: 'Nowhere',
    });
    expect(athlete).toMatchObject({
      jerseyNumber: 23,
      portraitBlobId: 'blob-1',
      nationalityLabel: 'Nowhere',
    });
  });

  it('defaults rarity from the attribute total (`05` §8)', () => {
    expect(createAthlete({ ...base, attributes: attributes(38) }).rarity).toBe('common');
    expect(createAthlete({ ...base, attributes: attributes(60) }).rarity).toBe('legendary');
    expect(createAthlete({ ...base, rarity: 'rare' }).rarity).toBe('rare');
  });

  it("locks pack, market, and peer athletes to editing but not the user's own (US-5.5)", () => {
    expect(createAthlete({ ...base, source: 'pack' }).editable).toBe(false);
    expect(createAthlete({ ...base, source: 'market' }).editable).toBe(false);
    expect(createAthlete({ ...base, source: 'peer' }).editable).toBe(false);
    expect(createAthlete({ ...base, source: 'created' }).editable).toBe(true);
    expect(createAthlete({ ...base, source: 'import' }).editable).toBe(true);
    expect(createAthlete({ ...base, source: 'starter' }).editable).toBe(true);
    expect(createAthlete({ ...base, source: 'pack', editable: true }).editable).toBe(true);
  });

  it('is not sandbox unless it is told to be', () => {
    expect(createAthlete(base).sandbox).toBe(false);
    expect(createAthlete({ ...base, sandbox: true }).sandbox).toBe(true);
  });

  it('de-duplicates traits and caps them at three (`05` §4)', () => {
    const athlete = createAthlete({
      ...base,
      traits: ['clutch', 'clutch', 'motor', 'hothead', 'glass-cannon'],
    });
    expect(athlete.traits).toEqual(['clutch', 'motor', 'hothead']);
  });
});

describe('rollAthlete', () => {
  it('is fully reproducible from its seed, ids included (INV-2)', () => {
    const options = { displayName: 'Rolled', primarySport: 'soccer', rarity: 'epic' } as const;
    const a = rollAthlete(createRng('pull'), { ...options, createdAt: 1 });
    const b = rollAthlete(createRng('pull'), { ...options, createdAt: 1 });
    expect(a).toEqual(b);
  });

  it('rolls a body, a hand, traits, and a legal spread for its band', () => {
    const rng = createRng('band');
    for (let i = 0; i < 40; i++) {
      const athlete = rollAthlete(rng, {
        displayName: `Rolled ${i}`,
        primarySport: 'basketball',
        rarity: 'rare',
      });
      expect(attributeTotal(athlete.attributes)).toBeGreaterThanOrEqual(520);
      expect(attributeTotal(athlete.attributes)).toBeLessThanOrEqual(600);
      expect(athlete.traits).toHaveLength(1);
      expect(athlete.source).toBe('pack');
      expect(athlete.editable).toBe(false);
      expect(['left', 'right', 'both']).toContain(athlete.handedness);
    }
  });

  it('produces left-handers without producing only left-handers', () => {
    const rng = createRng('hands');
    const hands = Array.from(
      { length: 300 },
      () =>
        rollAthlete(rng, { displayName: 'H', primarySport: 'basketball', rarity: 'common' })
          .handedness,
    );
    expect(hands.filter((h) => h === 'left').length).toBeGreaterThan(0);
    expect(hands.filter((h) => h === 'right').length).toBeGreaterThan(hands.length / 2);
  });

  it('lets the caller pin a body — the starter roster needs bigs to be big (T-3.14)', () => {
    const athlete = rollAthlete(createRng('centre'), {
      displayName: 'Centre',
      primarySport: 'basketball',
      rarity: 'rare',
      heightCm: 214,
      weightKg: 118,
      age: 27,
    });
    expect(athlete).toMatchObject({ heightCm: 214, weightKg: 118, age: 27 });
  });

  it('gives two rolls from one generator different ids', () => {
    const rng = createRng('ids');
    const options = { displayName: 'X', primarySport: 'basketball', rarity: 'common' } as const;
    expect(rollAthlete(rng, options).id).not.toBe(rollAthlete(rng, options).id);
  });
});

describe('identifiers', () => {
  it('mints distinct unseeded ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
  });

  it('mints a seeded id of stable width', () => {
    expect(seededId(createRng('a'))).toHaveLength(32);
    expect(seededId(createRng('a'))).toBe(seededId(createRng('a')));
    expect(seededId(createRng('a'))).not.toBe(seededId(createRng('b')));
  });
});
