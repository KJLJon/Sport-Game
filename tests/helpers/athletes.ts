/**
 * Athlete fixtures. One builder, so a test that cares about two fields does not have to spell out
 * the other twenty — and so a schema change breaks in one place.
 */
import {
  ATTRIBUTE_IDS,
  STARTING_FAMILIARITY,
  newSportSkill,
  type Athlete,
  type AttributeId,
  type Attributes,
} from '../../src/athletes/types.ts';

export function attributes(value = 50, overrides: Partial<Attributes> = {}): Attributes {
  const all = {} as Record<AttributeId, number>;
  for (const id of ATTRIBUTE_IDS) all[id] = value;
  return { ...all, ...overrides };
}

let counter = 0;

export function athlete(overrides: Partial<Athlete> = {}): Athlete {
  counter += 1;
  const id = overrides.id ?? `athlete-${counter}`;
  const primarySport = overrides.primarySport ?? 'basketball';

  return {
    id,
    schemaVersion: 1,
    displayName: `Athlete ${counter}`,
    heightCm: 195,
    weightKg: 90,
    handedness: 'right',
    age: 25,
    primarySport,
    attributes: attributes(),
    sportSkills: { [primarySport]: newSportSkill(STARTING_FAMILIARITY.primary) },
    rarity: 'common',
    traits: [],
    condition: { stamina: 100 },
    source: 'created',
    sandbox: false,
    custodyId: `custody-${counter}`,
    createdAt: counter,
    editable: true,
    ...overrides,
  };
}
