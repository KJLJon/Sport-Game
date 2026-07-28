/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.15 — Roster import: file + URL, schema validation, per-record errors, merge/conflict,
 *          responsibility notice
 * @story   US-5.7 — Import a roster file
 * @design  05-data-model.md §8 (roster import schema)
 * @invariant INV-2 (no Math.random — nothing here rolls anything), INV-3 (all storage through
 *            src/storage/ — this module never writes; it only produces records for a caller to)
 *
 * Purpose: turns the text of a roster file into `Athlete` records, exactly against `05` §8's wire
 * format and nothing more lenient or stricter than it says. Pure and DOM-free on purpose — the
 * screen (`../ui/screens/roster-import.ts`) owns the file/URL fetch, the preview, and the conflict
 * prompt; this file owns only the three things `05` §8 makes non-negotiable: unknown fields are
 * dropped silently, out-of-range values are clamped with a per-record warning, and one malformed
 * record never aborts the rest of the file.
 *
 * `createAthlete` (`create.ts`) is the only place an `Athlete` comes into existence, so once a
 * record passes validation it is hedged over to that unchanged — this module never assembles a
 * record by hand.
 */
import { rarityForTotal } from './attributes.ts';
import { createAthlete } from './create.ts';
import { normaliseForSearch } from './repository.ts';
import {
  ATHLETE_BOUNDS,
  ATTRIBUTE_IDS,
  attributeTotal,
  isHandedness,
  isRarity,
  isTraitId,
  clamp,
  type Athlete,
  type AttributeId,
  type Attributes,
  type Handedness,
  type Rarity,
  type TraitId,
} from './types.ts';
import type { SportId } from '../sports/types.ts';

/** The highest `formatVersion` this build understands (`05` §8). */
export const CURRENT_FORMAT_VERSION = 1;

/**
 * The sport ids the wire format documents (`05` §8's comment: `basketball|soccer|hockey|football`).
 * Deliberately wider than `RATEABLE_SPORTS` (`../sports/catalogue.ts`), which only lists sports this
 * build can rate today — a roster file authored against a later build's soccer or hockey module
 * should still import cleanly into an earlier one rather than being rejected for naming a sport that
 * merely isn't playable yet.
 */
export const ROSTER_IMPORT_SPORTS: readonly SportId[] = [
  'basketball',
  'soccer',
  'hockey',
  'football',
];

export interface ImportIssue {
  /** 1-based position in the file's `athletes` array; 0 for a problem with the file as a whole. */
  readonly record: number;
  readonly field?: string;
  readonly message: string;
  readonly severity: 'warning' | 'error';
}

export interface ImportResult {
  /** Successfully parsed, ready to write — nothing here has touched storage. */
  readonly athletes: Athlete[];
  readonly issues: ImportIssue[];
  readonly accepted: number;
  readonly rejected: number;
  /** The file's own `name`, if it gave one — purely a label for the preview screen. */
  readonly rosterName?: string;
}

/** One clear result for a file that has no salvageable records at all. */
function fileLevelFailure(message: string): ImportResult {
  return {
    athletes: [],
    issues: [{ record: 0, message, severity: 'error' }],
    accepted: 0,
    rejected: 0,
  };
}

/**
 * Validates and converts the text of a roster file (`05` §8). Never throws — a file that cannot be
 * read at all comes back as a single file-level error, not an exception, so the importer screen
 * never has to wrap this in a second try/catch on top of its own.
 */
export function parseRosterFile(text: string, now: number = Date.now()): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fileLevelFailure('This file is not valid JSON and could not be read.');
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return fileLevelFailure('This does not look like a roster file — expected a JSON object.');
  }
  const file = data as Record<string, unknown>;

  // A `formatVersion` this build does not understand is rejected outright rather than partially
  // applied, the same principle `05` §9 rule 4 states for migrations.
  const formatVersion = file.formatVersion;
  if (formatVersion !== undefined) {
    if (typeof formatVersion !== 'number' || !Number.isFinite(formatVersion)) {
      return fileLevelFailure("This file's formatVersion is not a number.");
    }
    if (formatVersion > CURRENT_FORMAT_VERSION) {
      return fileLevelFailure(
        `This file is format version ${formatVersion}, newer than this app understands ` +
          `(up to ${CURRENT_FORMAT_VERSION}). Update the app, or ask whoever made this file to ` +
          'export an older version.',
      );
    }
  }

  const rawAthletes = file.athletes;
  if (!Array.isArray(rawAthletes)) {
    return fileLevelFailure('This file has no "athletes" list to import.');
  }

  const issues: ImportIssue[] = [];
  const athletes: Athlete[] = [];
  let rejected = 0;

  rawAthletes.forEach((raw, index) => {
    const record = index + 1;
    const athlete = parseRecord(raw, record, now, issues);
    if (athlete === null) rejected += 1;
    else athletes.push(athlete);
  });

  const rosterName =
    typeof file.name === 'string' && file.name.trim() !== '' ? file.name : undefined;

  return {
    athletes,
    issues,
    accepted: athletes.length,
    rejected,
    ...(rosterName !== undefined ? { rosterName } : {}),
  };
}

/** One record of `05` §8's `athletes` array. `null` means the record could not be built at all. */
function parseRecord(
  raw: unknown,
  record: number,
  now: number,
  issues: ImportIssue[],
): Athlete | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    issues.push({
      record,
      message: 'Not a valid athlete record — expected an object.',
      severity: 'error',
    });
    return null;
  }
  const entry = raw as Record<string, unknown>;

  const displayName = entry.displayName;
  if (typeof displayName !== 'string' || displayName.trim() === '') {
    issues.push({
      record,
      field: 'displayName',
      message: 'displayName is required.',
      severity: 'error',
    });
    return null;
  }

  const primarySport = entry.primarySport;
  if (typeof primarySport !== 'string' || !ROSTER_IMPORT_SPORTS.includes(primarySport)) {
    issues.push({
      record,
      field: 'primarySport',
      message: `primarySport is required and must be one of ${ROSTER_IMPORT_SPORTS.join(', ')}.`,
      severity: 'error',
    });
    return null;
  }

  const attributes = parseAttributes(entry.attributes, record, issues);
  if (attributes === null) return null;

  const handedness = parseHandedness(entry.handedness, record, issues);
  const rarity = parseRarity(entry.rarity, attributes, record, issues);
  const traits = parseTraits(entry.traits, record, issues);

  const athlete = createAthlete({
    displayName,
    primarySport,
    attributes,
    ...(handedness !== undefined ? { handedness } : {}),
    ...clampedNumberField(entry, 'heightCm', ATHLETE_BOUNDS.heightCm, record, issues),
    ...clampedNumberField(entry, 'weightKg', ATHLETE_BOUNDS.weightKg, record, issues),
    ...clampedNumberField(entry, 'age', ATHLETE_BOUNDS.age, record, issues),
    ...(rarity !== undefined ? { rarity } : {}),
    ...(traits.length > 0 ? { traits } : {}),
    source: 'import',
    createdAt: now,
  });

  return athlete;
}

/**
 * All eleven attributes, required (`05` §8). A record missing any of them — or holding a
 * non-numeric value for one — cannot be built at all, so this is the one place a bad value rejects
 * the whole record rather than just clamping it: there is nothing sensible to clamp *to*.
 */
function parseAttributes(raw: unknown, record: number, issues: ImportIssue[]): Attributes | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    issues.push({
      record,
      field: 'attributes',
      message: 'attributes is required and must hold all eleven attributes.',
      severity: 'error',
    });
    return null;
  }
  const source = raw as Record<string, unknown>;
  const result = {} as Record<AttributeId, number>;

  for (const id of ATTRIBUTE_IDS) {
    const value = source[id];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({
        record,
        field: `attributes.${id}`,
        message: `attributes.${id} is required and must be a number.`,
        severity: 'error',
      });
      return null;
    }

    const clamped = Math.round(
      clamp(value, ATHLETE_BOUNDS.attribute.min, ATHLETE_BOUNDS.attribute.max),
    );
    if (clamped !== value) {
      issues.push({
        record,
        field: `attributes.${id}`,
        message:
          `attributes.${id} was ${value}, outside ${ATHLETE_BOUNDS.attribute.min}–` +
          `${ATHLETE_BOUNDS.attribute.max}. Clamped to ${clamped}.`,
        severity: 'warning',
      });
    }
    result[id] = clamped;
  }

  return result;
}

/**
 * An optional numeric field with bounds (`heightCm`, `weightKg`, `age`). Present and numeric but
 * out of range is clamped with a warning, per `05` §8; present but not a number at all is dropped
 * as though it were never in the file, the same treatment an unknown field gets.
 */
function clampedNumberField(
  entry: Record<string, unknown>,
  field: 'heightCm' | 'weightKg' | 'age',
  bounds: { readonly min: number; readonly max: number },
  record: number,
  issues: ImportIssue[],
): Record<string, number> {
  const value = entry[field];
  if (value === undefined) return {};
  if (typeof value !== 'number' || !Number.isFinite(value)) return {};

  const clamped = Math.round(clamp(value, bounds.min, bounds.max));
  if (clamped !== value) {
    issues.push({
      record,
      field,
      message: `${field} was ${value}, outside ${bounds.min}–${bounds.max}. Clamped to ${clamped}.`,
      severity: 'warning',
    });
  }
  return { [field]: clamped };
}

function parseHandedness(
  raw: unknown,
  record: number,
  issues: ImportIssue[],
): Handedness | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && isHandedness(raw)) return raw;
  issues.push({
    record,
    field: 'handedness',
    message: `handedness "${String(raw)}" is not recognised (left, right, both). Ignored.`,
    severity: 'warning',
  });
  return undefined;
}

function parseRarity(
  raw: unknown,
  attributes: Attributes,
  record: number,
  issues: ImportIssue[],
): Rarity | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && isRarity(raw)) return raw;
  issues.push({
    record,
    field: 'rarity',
    message:
      `rarity "${String(raw)}" is not recognised. Defaulted from the attribute total ` +
      `(${rarityForTotal(attributeTotal(attributes))}).`,
    severity: 'warning',
  });
  return undefined;
}

function parseTraits(raw: unknown, record: number, issues: ImportIssue[]): TraitId[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    issues.push({
      record,
      field: 'traits',
      message: 'traits must be a list. Ignored.',
      severity: 'warning',
    });
    return [];
  }

  const valid: TraitId[] = [];
  const invalid: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string' && isTraitId(entry)) valid.push(entry);
    else invalid.push(String(entry));
  }
  if (invalid.length > 0) {
    issues.push({
      record,
      field: 'traits',
      message: `Unrecognised trait${invalid.length === 1 ? '' : 's'} ignored: ${invalid.join(', ')}.`,
      severity: 'warning',
    });
  }
  return valid;
}

// ── Merge / conflict (US-5.7: "imports merge rather than overwrite, with a conflict prompt on
// duplicate IDs") ────────────────────────────────────────────────────────────────────────────────

export type ImportClassification = 'new' | 'conflict';

/** Why an incoming record was flagged, so the conflict prompt can say something specific. */
export type ConflictReason = 'custodyId' | 'name-and-sport';

export interface ClassifiedImport {
  readonly athlete: Athlete;
  readonly classification: ImportClassification;
  /** Present only when `classification` is `'conflict'`. */
  readonly conflictsWith?: Athlete;
  readonly reason?: ConflictReason;
}

/**
 * Classifies each successfully-parsed athlete against the existing roster, so the importer can
 * write the `new` ones straight away and prompt on the `conflict` ones rather than silently
 * overwriting anything (US-5.7). A conflict is a duplicate `custodyId` — the same record, or the
 * same P2P lineage — or an identical `displayName` + `primarySport`, which is what two exports of
 * the same fictional athlete look like without a shared id.
 */
export function classifyImports(
  incoming: readonly Athlete[],
  existing: readonly Athlete[],
): ClassifiedImport[] {
  const byCustodyId = new Map(existing.map((athlete) => [athlete.custodyId, athlete]));
  const byNameAndSport = new Map(
    existing.map((athlete) => [nameAndSportKey(athlete), athlete] as const),
  );

  return incoming.map((athlete): ClassifiedImport => {
    const custodyMatch = byCustodyId.get(athlete.custodyId);
    if (custodyMatch !== undefined) {
      return {
        athlete,
        classification: 'conflict',
        conflictsWith: custodyMatch,
        reason: 'custodyId',
      };
    }

    const nameMatch = byNameAndSport.get(nameAndSportKey(athlete));
    if (nameMatch !== undefined) {
      return {
        athlete,
        classification: 'conflict',
        conflictsWith: nameMatch,
        reason: 'name-and-sport',
      };
    }

    return { athlete, classification: 'new' };
  });
}

function nameAndSportKey(athlete: Athlete): string {
  return `${athlete.primarySport}::${normaliseForSearch(athlete.displayName)}`;
}

/** What the conflict prompt's three choices do to one conflicting record (US-5.7). */
export type ConflictResolution = 'skip' | 'replace' | 'keep-both';

/**
 * Applies one conflict's resolution, returning the record to write or `null` for "don't write
 * this one" — never a direct write, so the caller stays the only place that touches storage
 * (`AthleteRepository`, via `05` §1).
 */
export function resolveConflict(
  conflict: ClassifiedImport,
  resolution: ConflictResolution,
): Athlete | null {
  if (conflict.classification !== 'conflict' || conflict.conflictsWith === undefined) {
    return conflict.athlete;
  }

  switch (resolution) {
    case 'skip':
      return null;
    case 'keep-both':
      return conflict.athlete;
    case 'replace':
      // Same storage key as the existing record, so `AthleteRepository.put` overwrites it in
      // place instead of leaving the old one behind under a different id.
      return { ...conflict.athlete, id: conflict.conflictsWith.id };
  }
}

/**
 * The whole merge in one call: every `new` record is written as-is, every `conflict` goes through
 * `resolutions` (keyed by the incoming athlete's `id`, which is fresh and therefore unique even
 * before anything is written) — and a conflict with no entry in `resolutions` is skipped rather
 * than guessed at, since writing an unresolved conflict would be the overwrite US-5.7 rules out.
 */
export function mergeRoster(
  classified: readonly ClassifiedImport[],
  resolutions: ReadonlyMap<string, ConflictResolution>,
): Athlete[] {
  const result: Athlete[] = [];
  for (const entry of classified) {
    if (entry.classification === 'new') {
      result.push(entry.athlete);
      continue;
    }
    const resolution = resolutions.get(entry.athlete.id) ?? 'skip';
    const resolved = resolveConflict(entry, resolution);
    if (resolved !== null) result.push(resolved);
  }
  return result;
}
