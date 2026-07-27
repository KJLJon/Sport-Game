/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.2 — Attribute system: the eleven attributes, budget rules, sandbox flag, random roll
 * @story   US-5.1 — Create an athlete profile
 * @story   US-5.6 — Start with something to play with
 * @design  05-data-model.md §2 (athlete), §2.1 (budget and sandbox), §4 (rarity), §3.3 (familiarity)
 * @invariant INV-2 (a seeded roll is reproducible), INV-3 (storage only via src/storage/)
 *
 * Purpose: the one place an `Athlete` record comes into existence. The profile editor (T-3.7), the
 * starter roster (T-3.14), the importer (T-3.15), and pack openings all land here, so a record can
 * never be assembled with, say, a primary sport at novice familiarity or an id that collides.
 *
 * The factory clamps rather than throws. A caller that wants a refusal asks `judgeCreation` first;
 * by the time a record is being built the decision has been made, and a half-built athlete
 * escaping into the roster would be worse than a clamped one.
 */
import type { Rng } from '../engine/rng.ts';
import type { SportId } from '../sports/types.ts';
import { CREATION_DEFAULTS } from './tuning.ts';
import { rarityForTotal, rollAttributes, rollPhysical, rollTraits } from './attributes.ts';
import {
  ATHLETE_BOUNDS,
  ATTRIBUTE_IDS,
  STARTING_FAMILIARITY,
  attributeTotal,
  clamp,
  newSportSkill,
  type Athlete,
  type AthleteSource,
  type AttributeId,
  type Attributes,
  type Handedness,
  type Rarity,
  type TraitId,
} from './types.ts';

/** The record version new athletes are written at. Bumped with its migration (`05` §9). */
export const ATHLETE_SCHEMA_VERSION = 1;

export interface CreateAthleteOptions {
  readonly displayName: string;
  readonly primarySport: SportId;
  readonly attributes: Attributes;

  readonly heightCm?: number;
  readonly weightKg?: number;
  readonly age?: number;
  readonly handedness?: Handedness;
  readonly jerseyNumber?: number;
  readonly nationalityLabel?: string;
  readonly portraitBlobId?: string;

  readonly rarity?: Rarity;
  readonly traits?: readonly TraitId[];
  readonly source?: AthleteSource;
  readonly sandbox?: boolean;
  readonly editable?: boolean;

  /** Supplied by seeded generators so a roster is reproducible; otherwise a fresh uuid. */
  readonly id?: string;
  readonly custodyId?: string;
  readonly createdAt?: number;
}

/**
 * Sources whose athletes are locked to editing by default (US-5.5). Created, starter, and imported
 * athletes are the user's own material and stay editable.
 */
const LOCKED_SOURCES: ReadonlySet<AthleteSource> = new Set(['pack', 'market', 'peer']);

export function createAthlete(options: CreateAthleteOptions): Athlete {
  const attributes = clampAttributes(options.attributes);
  const source = options.source ?? 'created';
  const rarity = options.rarity ?? rarityForTotal(attributeTotal(attributes));

  return {
    id: options.id ?? newId(),
    schemaVersion: ATHLETE_SCHEMA_VERSION,

    displayName: cleanName(options.displayName),
    ...optional('portraitBlobId', options.portraitBlobId),
    ...optional(
      'nationalityLabel',
      options.nationalityLabel?.slice(0, ATHLETE_BOUNDS.maxNameLength),
    ),
    ...optional(
      'jerseyNumber',
      options.jerseyNumber === undefined
        ? undefined
        : Math.round(
            clamp(
              options.jerseyNumber,
              ATHLETE_BOUNDS.jerseyNumber.min,
              ATHLETE_BOUNDS.jerseyNumber.max,
            ),
          ),
    ),

    heightCm: bounded(options.heightCm ?? CREATION_DEFAULTS.heightCm, ATHLETE_BOUNDS.heightCm),
    weightKg: bounded(options.weightKg ?? CREATION_DEFAULTS.weightKg, ATHLETE_BOUNDS.weightKg),
    handedness: options.handedness ?? CREATION_DEFAULTS.handedness,
    age: bounded(options.age ?? CREATION_DEFAULTS.age, ATHLETE_BOUNDS.age),

    primarySport: options.primarySport,
    attributes,
    // The primary sport is the only one that starts known (`05` §3.3). Every other sport's skill
    // record is created the first time it is looked at, so an athlete never carries eleven empty
    // ones around for sports the build does not have yet.
    sportSkills: { [options.primarySport]: newSportSkill(STARTING_FAMILIARITY.primary) },

    rarity,
    traits: [...new Set(options.traits ?? [])].slice(0, ATHLETE_BOUNDS.maxTraits),
    condition: { stamina: ATHLETE_BOUNDS.stamina.max },

    source,
    sandbox: options.sandbox ?? false,
    custodyId: options.custodyId ?? newId(),
    createdAt: options.createdAt ?? Date.now(),
    editable: options.editable ?? !LOCKED_SOURCES.has(source),
  };
}

/**
 * A fully rolled athlete for a rarity band — packs, and the starter roster. Everything random
 * comes from `rng`, ids included, so the same seed produces the same roster on any device.
 */
export function rollAthlete(
  rng: Rng,
  options: {
    readonly displayName: string;
    readonly primarySport: SportId;
    readonly rarity: Rarity;
    readonly source?: AthleteSource;
    readonly createdAt?: number;
  } & Partial<Pick<CreateAthleteOptions, 'heightCm' | 'weightKg' | 'age' | 'jerseyNumber'>>,
): Athlete {
  const physical = rollPhysical(rng);
  const handedness: Handedness = rng.bool(0.12) ? 'left' : rng.bool(0.03) ? 'both' : 'right';

  return createAthlete({
    ...options,
    attributes: rollAttributes(rng, options.rarity),
    heightCm: options.heightCm ?? physical.heightCm,
    weightKg: options.weightKg ?? physical.weightKg,
    age: options.age ?? physical.age,
    handedness,
    traits: rollTraits(rng, options.rarity),
    source: options.source ?? 'pack',
    id: seededId(rng),
    custodyId: seededId(rng),
  });
}

function clampAttributes(attributes: Attributes): Attributes {
  const result = {} as Record<AttributeId, number>;
  for (const id of ATTRIBUTE_IDS) {
    result[id] = Math.round(
      clamp(attributes[id], ATHLETE_BOUNDS.attribute.min, ATHLETE_BOUNDS.attribute.max),
    );
  }
  return result;
}

function bounded(value: number, range: { readonly min: number; readonly max: number }): number {
  return Math.round(clamp(value, range.min, range.max));
}

/**
 * A name is trimmed and length-capped but never rejected: a blank one gets a placeholder rather
 * than blocking the save, because "Unnamed athlete" is recoverable and a lost profile is not.
 */
function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, ATHLETE_BOUNDS.maxNameLength);
  return trimmed === '' ? 'Unnamed athlete' : trimmed;
}

/**
 * `exactOptionalPropertyTypes` is on, so an optional field must be *absent* rather than set to
 * `undefined` — and a record with `jerseyNumber: undefined` in it round-trips through IndexedDB
 * as a real key. This keeps the stored shape honest.
 */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/** A random identifier, from the platform's generator — not the sim's, which must stay seeded. */
export function newId(): string {
  const crypto = globalThis.crypto as Crypto | undefined;
  if (crypto?.randomUUID !== undefined) return crypto.randomUUID();

  // Safari before 15.4 has `getRandomValues` but not `randomUUID`.
  const bytes = new Uint8Array(16);
  crypto?.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A reproducible identifier, so a seeded roster is identical on every device. */
export function seededId(rng: Rng): string {
  let id = '';
  for (let i = 0; i < 4; i++) id += rng.nextU32().toString(16).padStart(8, '0');
  return id;
}
