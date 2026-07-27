/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.1 — Athlete schema, IndexedDB store, indexes, repository
 * @design  05-data-model.md §2, §2.1, §3.3
 *
 * Purpose: the schema's own rules — the eleven attributes and their order, the starting
 * familiarities, availability, and editability.
 */
import { describe, expect, it } from 'vitest';
import {
  ATHLETE_BOUNDS,
  ATTRIBUTE_IDS,
  RARITIES,
  STARTING_FAMILIARITY,
  attributeTotal,
  clamp,
  isAthleteSource,
  isAttributeId,
  isAvailable,
  isEditable,
  isHandedness,
  isRarity,
  isTraitId,
  newSportSkill,
  sportSkillFor,
} from '../../../src/athletes/types.ts';
import { athlete, attributes } from '../../helpers/athletes.ts';

describe('attributes', () => {
  it('is exactly the eleven from `05` §2.1, in the spec order', () => {
    expect(ATTRIBUTE_IDS).toEqual([
      'speed',
      'acceleration',
      'agility',
      'strength',
      'vertical',
      'stamina',
      'coordination',
      'accuracy',
      'awareness',
      'composure',
      'discipline',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(ATTRIBUTE_IDS).size).toBe(ATTRIBUTE_IDS.length);
  });

  it('totals every attribute', () => {
    expect(attributeTotal(attributes(50))).toBe(550);
    expect(attributeTotal(attributes(50, { speed: 99 }))).toBe(599);
  });

  it('recognises its own ids and rejects anything else', () => {
    expect(isAttributeId('speed')).toBe(true);
    expect(isAttributeId('shooting')).toBe(false);
  });
});

describe('vocabularies', () => {
  it('lists the five rarities from `05` §4 in ascending order', () => {
    expect(RARITIES).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary']);
  });

  it('validates rarity, trait, handedness, and source', () => {
    expect(isRarity('legendary')).toBe(true);
    expect(isRarity('mythic')).toBe(false);
    expect(isTraitId('clutch')).toBe(true);
    expect(isTraitId('lucky')).toBe(false);
    expect(isHandedness('both')).toBe(true);
    expect(isHandedness('either')).toBe(false);
    expect(isAthleteSource('import')).toBe(true);
    expect(isAthleteSource('cheat')).toBe(false);
  });
});

describe('clamp', () => {
  it('bounds on both sides and leaves the middle alone', () => {
    expect(clamp(-5, 1, 99)).toBe(1);
    expect(clamp(120, 1, 99)).toBe(99);
    expect(clamp(50, 1, 99)).toBe(50);
  });
});

describe('sport skills', () => {
  it('starts a fresh skill at level 1 with nothing learned', () => {
    const skill = newSportSkill(10);
    expect(skill).toEqual({
      familiarity: 10,
      level: 1,
      xp: 0,
      subSkills: {},
      minutesPlayed: 0,
    });
  });

  it('clamps a starting familiarity into range', () => {
    expect(newSportSkill(400).familiarity).toBe(ATHLETE_BOUNDS.familiarity.max);
    expect(newSportSkill(-1).familiarity).toBe(ATHLETE_BOUNDS.familiarity.min);
  });

  it('gives an unplayed sport the novice familiarity and the primary sport 85', () => {
    const a = athlete({ primarySport: 'basketball', sportSkills: {} });
    expect(sportSkillFor(a, 'basketball').familiarity).toBe(STARTING_FAMILIARITY.primary);
    expect(sportSkillFor(a, 'soccer').familiarity).toBe(STARTING_FAMILIARITY.other);
  });

  it('returns the stored record once one exists', () => {
    const stored = { ...newSportSkill(10), familiarity: 42, minutesPlayed: 90 };
    const a = athlete({ sportSkills: { soccer: stored } });
    expect(sportSkillFor(a, 'soccer')).toBe(stored);
  });
});

describe('availability', () => {
  const now = 1_000;

  it('is available when healthy and unsuspended', () => {
    expect(isAvailable(athlete(), now)).toBe(true);
  });

  it('is unavailable while injured, and available once the injury lapses', () => {
    expect(isAvailable(athlete({ condition: { stamina: 100, injuredUntil: now + 1 } }), now)).toBe(
      false,
    );
    expect(isAvailable(athlete({ condition: { stamina: 100, injuredUntil: now } }), now)).toBe(
      true,
    );
  });

  it('is unavailable while games of a suspension remain', () => {
    expect(isAvailable(athlete({ condition: { stamina: 100, suspendedGames: 1 } }), now)).toBe(
      false,
    );
    expect(isAvailable(athlete({ condition: { stamina: 100, suspendedGames: 0 } }), now)).toBe(
      true,
    );
  });
});

describe('editability', () => {
  it('allows editing a user-created athlete', () => {
    expect(isEditable(athlete({ editable: true }), false)).toBe(true);
  });

  it('locks a pack athlete unless sandbox mode is on (US-5.5)', () => {
    const pulled = athlete({ source: 'pack', editable: false });
    expect(isEditable(pulled, false)).toBe(false);
    expect(isEditable(pulled, true)).toBe(true);
  });
});
