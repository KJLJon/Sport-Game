/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.1 — Athlete schema, IndexedDB store, indexes, repository
 * @story   US-5.1 — Create an athlete profile
 * @story   US-5.5 — Edit and delete profiles
 * @design  05-data-model.md §2 (athlete), §2.1 (attributes), §3.3 (sport skill), §4 (rarity)
 * @invariant INV-3 (all storage through src/storage/)
 *
 * Purpose: the shape of an athlete, and nothing else. This is the record every other Phase 3
 * module reads and the one the sim will finally be handed at T-3.17, so it is written once,
 * against `05` §2 field for field, and the bounds live here beside it rather than being
 * re-guessed at each call site.
 *
 * Deliberately free of behaviour: the budget rules and the random roll are T-3.2, derivation is
 * T-3.3, familiarity growth is T-3.4. What belongs here is the schema and the ranges a record is
 * only ever valid inside.
 */
import type { SportId } from '../sports/types.ts';

/**
 * The eleven sport-neutral attributes, in `05` §2.1's order. The order is part of the contract:
 * the weight matrix, the profile editor's sliders, and the compare view all present them in it.
 */
export const ATTRIBUTE_IDS = [
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
] as const;

export type AttributeId = (typeof ATTRIBUTE_IDS)[number];

/** All eleven, always. A partial attribute set is not an athlete. */
export type Attributes = Record<AttributeId, number>;

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * Traits are named modifiers with readable effects (`05` §4). Their effects land with the systems
 * they modify — this is the vocabulary, so a record can be validated before those exist.
 */
export const TRAIT_IDS = ['clutch', 'motor', 'hothead', 'glass-cannon', 'workhorse'] as const;
export type TraitId = (typeof TRAIT_IDS)[number];

export type Handedness = 'left' | 'right' | 'both';

/** Where a record came from. `05` §2 — drives editability, and the P2P custody chain later. */
export const ATHLETE_SOURCES = ['starter', 'created', 'pack', 'market', 'peer', 'import'] as const;
export type AthleteSource = (typeof ATHLETE_SOURCES)[number];

/** Per-sport learned state (`05` §3.3). Sub-skills are keyed by derived-rating name. */
export interface SportSkill {
  /** 0–100. Primary sport starts at 85, every other sport at 10. */
  familiarity: number;
  /** 1–20. */
  level: number;
  xp: number;
  /** Per derived rating, 0–20 — worth 0.75 rating points each at derivation (`05` §3). */
  subSkills: Record<string, number>;
  minutesPlayed: number;
}

/** Availability (`05` §2). Timestamps are epoch ms; `stamina` is 0–100. */
export interface AthleteCondition {
  stamina: number;
  injuredUntil?: number;
  suspendedGames?: number;
}

/** `05` §2, field for field. */
export interface Athlete {
  id: string;
  schemaVersion: number;

  displayName: string;
  /** Key of a locally-held blob in IndexedDB. Never uploaded — `05` §2, US-5.1. */
  portraitBlobId?: string;
  /** Free text, purely cosmetic. Never used as a rule input. */
  nationalityLabel?: string;
  jerseyNumber?: number;

  heightCm: number;
  weightKg: number;
  handedness: Handedness;
  /** Affects growth rate only — never a rating (`05` §3.3 `ageFactor`). */
  age: number;

  primarySport: SportId;
  attributes: Attributes;
  sportSkills: Record<SportId, SportSkill>;

  rarity: Rarity;
  /** 0–3 modifiers (`05` §4). */
  traits: TraitId[];
  condition: AthleteCondition;

  source: AthleteSource;
  /** True when created outside the attribute budget (`05` §2.1). Excluded from fair contexts. */
  sandbox: boolean;
  /** Provenance identity, stable across a P2P transfer (`05` §7). */
  custodyId: string;
  createdAt: number;
  editable: boolean;
}

/**
 * Structural bounds. These are what a record is *valid* inside — not the creation budget, which is
 * a rule about user-created athletes and lives in `tuning.ts` with the rest of T-3.2's numbers.
 */
export const ATHLETE_BOUNDS = {
  /** `05` §2.1 — the attribute scale itself. Creation is narrower. */
  attribute: { min: 1, max: 99 },
  heightCm: { min: 150, max: 230 },
  weightKg: { min: 45, max: 160 },
  age: { min: 16, max: 45 },
  jerseyNumber: { min: 0, max: 99 },
  familiarity: { min: 0, max: 100 },
  level: { min: 1, max: 20 },
  subSkill: { min: 0, max: 20 },
  stamina: { min: 0, max: 100 },
  maxTraits: 3,
  /** Longer than this is a paste, not a name; trimmed rather than rejected on import. */
  maxNameLength: 40,
} as const;

/** Familiarity a sport starts at, by whether it is the athlete's primary (`05` §3.3). */
export const STARTING_FAMILIARITY = { primary: 85, other: 10 } as const;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function isAttributeId(value: string): value is AttributeId {
  return (ATTRIBUTE_IDS as readonly string[]).includes(value);
}

export function isRarity(value: string): value is Rarity {
  return (RARITIES as readonly string[]).includes(value);
}

export function isTraitId(value: string): value is TraitId {
  return (TRAIT_IDS as readonly string[]).includes(value);
}

export function isHandedness(value: string): value is Handedness {
  return value === 'left' || value === 'right' || value === 'both';
}

export function isAthleteSource(value: string): value is AthleteSource {
  return (ATHLETE_SOURCES as readonly string[]).includes(value);
}

/** The sum every budget rule is stated against (`05` §2.1). */
export function attributeTotal(attributes: Attributes): number {
  let total = 0;
  for (const id of ATTRIBUTE_IDS) total += attributes[id];
  return total;
}

/** A fresh skill record for a sport the athlete has never played. */
export function newSportSkill(familiarity: number): SportSkill {
  return {
    familiarity: clamp(familiarity, ATHLETE_BOUNDS.familiarity.min, ATHLETE_BOUNDS.familiarity.max),
    level: 1,
    xp: 0,
    subSkills: {},
    minutesPlayed: 0,
  };
}

/**
 * The skill record for `sport`, creating it at the right starting familiarity if this is the first
 * time the athlete has been looked at through that sport. Reading is not playing, so the caller
 * decides whether to persist what comes back.
 */
export function sportSkillFor(athlete: Athlete, sport: SportId): SportSkill {
  const existing = athlete.sportSkills[sport];
  if (existing !== undefined) return existing;
  return newSportSkill(
    sport === athlete.primarySport ? STARTING_FAMILIARITY.primary : STARTING_FAMILIARITY.other,
  );
}

/** Availability at a moment in time (`03` T-3.13 builds the UI on this). */
export function isAvailable(athlete: Athlete, now: number): boolean {
  const { injuredUntil, suspendedGames } = athlete.condition;
  if (injuredUntil !== undefined && injuredUntil > now) return false;
  if (suspendedGames !== undefined && suspendedGames > 0) return false;
  return true;
}

/**
 * Whether the profile editor may change this athlete. Pack, market, and peer athletes are locked
 * by default (US-5.5); Settings' sandbox mode is the documented way past it, and it sets
 * `sandbox: true` on the result rather than quietly editing a "fair" record.
 */
export function isEditable(athlete: Athlete, sandboxMode: boolean): boolean {
  return athlete.editable || sandboxMode;
}
