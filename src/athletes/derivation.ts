/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.3 — Derivation engine: weight matrix, physical modifiers, unit-tested invariants
 * @story   US-5.2 — Play any athlete in any sport
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @design  05-data-model.md §3 (derivation), §3.1 (basketball weights), §3.3 (familiarity),
 *          §3.4 (overall and position fit)
 * @invariant INV-5 (no sport-specific branching — the tables come from the sport module)
 *
 * Purpose: turns eleven sport-neutral attributes into one sport's derived ratings. This is the
 * headline feature's arithmetic, and it is the only place it exists.
 *
 * `05` §3's three stages, in order:
 *
 *     raw_r       = Σ_a ( weight[r][a] × attribute[a] ) + physicalMod[r]
 *     famMult(f)  = 0.55 + 0.45 × (f / 100) ^ 0.75
 *     rating_r    = clamp( round( raw_r × famMult(f) + subSkill[r] × 0.75 ), 1, 99 )
 *
 * There is no `if (sport === …)` anywhere below, and there must never be: every sport-specific
 * number arrives as a table from the sport module, which is what makes adding a sport add its
 * ratings too. A new sport is a new table, not an edit here.
 *
 * Familiarity is *read* here and *grown* in T-3.4. The behavioural half of the penalty — decision
 * noise, control error, reaction latency — is T-3.6; this file only produces the number.
 */
import type { PhysicalModifiers, RatingWeightTable, SportId } from '../sports/types.ts';
import type { PositionWeightTable } from '../sports/types.ts';
import { DERIVATION } from './tuning.ts';
import {
  ATHLETE_BOUNDS,
  clamp,
  isAttributeId,
  sportSkillFor,
  type Athlete,
  type AttributeId,
  type Attributes,
} from './types.ts';

/** Everything about a sport that derivation needs. Supplied by the sport module. */
export interface SportRatingTables {
  readonly weights: RatingWeightTable;
  readonly physicalModifiers?: PhysicalModifiers;
  readonly positionWeights?: PositionWeightTable;
}

/** Derived rating name → 1–99. */
export type DerivedRatings = Readonly<Record<string, number>>;

/**
 * The familiarity gate (`05` §3). A total novice plays at 55% of their athletic ceiling; at full
 * familiarity they reach 100%. The exponent below 1 means the early matches move the number most,
 * which is where the feature has to sell itself.
 */
export function familiarityMultiplier(familiarity: number): number {
  const f = clamp(familiarity, ATHLETE_BOUNDS.familiarity.min, ATHLETE_BOUNDS.familiarity.max);
  return (
    DERIVATION.familiarityFloor +
    DERIVATION.familiarityRange * (f / 100) ** DERIVATION.familiarityExponent
  );
}

/** Learned sub-skill, 0–20, worth 0.75 rating points each (`05` §3). */
export function skillBonus(subSkill: number): number {
  return (
    clamp(subSkill, ATHLETE_BOUNDS.subSkill.min, ATHLETE_BOUNDS.subSkill.max) *
    DERIVATION.subSkillPoints
  );
}

/** The physical adjustment for one rating, in rating points. */
export function physicalModifier(
  rating: string,
  heightCm: number,
  weightKg: number,
  modifiers: PhysicalModifiers | undefined,
): number {
  if (modifiers === undefined) return 0;

  let total = 0;
  const height = modifiers.heightCm;
  if (height !== undefined) total += (heightCm - height.reference) * (height.perUnit[rating] ?? 0);
  const weight = modifiers.weightKg;
  if (weight !== undefined) total += (weightKg - weight.reference) * (weight.perUnit[rating] ?? 0);
  return total;
}

/**
 * The athletic ceiling: what the athlete would rate at with full familiarity and nothing learned.
 * Unclamped and unrounded, because the caller's next step is to multiply it.
 */
export function rawRating(
  rating: string,
  attributes: Attributes,
  heightCm: number,
  weightKg: number,
  tables: SportRatingTables,
): number {
  const row = tables.weights[rating];
  if (row === undefined) return 0;

  let sum = 0;
  for (const [attribute, weight] of Object.entries(row)) {
    if (!isAttributeId(attribute)) continue;
    sum += weight * attributes[attribute];
  }

  return sum + physicalModifier(rating, heightCm, weightKg, tables.physicalModifiers);
}

export interface DeriveOptions {
  /**
   * Overrides the athlete's stored familiarity. The compare view uses it to project what an
   * athlete *would* rate at in a sport they have never played (T-3.9), which is only honest if
   * the projection runs through the same arithmetic as the real thing.
   */
  readonly familiarity?: number;
  /** Overrides learned sub-skills — a projection has none. */
  readonly subSkills?: Readonly<Record<string, number>>;
}

/** Every rating the sport defines, for this athlete, in the table's own order. */
export function deriveRatings(
  athlete: Athlete,
  sport: SportId,
  tables: SportRatingTables,
  options: DeriveOptions = {},
): DerivedRatings {
  const skill = sportSkillFor(athlete, sport);
  const familiarity = options.familiarity ?? skill.familiarity;
  const subSkills = options.subSkills ?? skill.subSkills;
  const multiplier = familiarityMultiplier(familiarity);

  const ratings: Record<string, number> = {};
  for (const rating of Object.keys(tables.weights)) {
    const raw = rawRating(rating, athlete.attributes, athlete.heightCm, athlete.weightKg, tables);
    ratings[rating] = clamp(
      Math.round(raw * multiplier + skillBonus(subSkills[rating] ?? 0)),
      ATHLETE_BOUNDS.attribute.min,
      ATHLETE_BOUNDS.attribute.max,
    );
  }

  return ratings;
}

/** The same athlete at the sport's familiarity cap with nothing learned — their ceiling (T-3.9). */
export function projectRatings(
  athlete: Athlete,
  sport: SportId,
  tables: SportRatingTables,
  familiarity = ATHLETE_BOUNDS.familiarity.max,
): DerivedRatings {
  return deriveRatings(athlete, sport, tables, { familiarity, subSkills: {} });
}

/** One attribute's share of a rating, for the card's "why this rating" (US-5.4). */
export interface Contribution {
  readonly attribute: AttributeId;
  readonly weight: number;
  readonly value: number;
  /** Rating points this attribute put in, before the familiarity gate. */
  readonly points: number;
}

export interface RatingExplanation {
  readonly rating: string;
  /** Contributions, largest first — the card shows the top few. */
  readonly contributions: readonly Contribution[];
  /** Rating points from height and weight. Zero when the sport has no opinion about size. */
  readonly physical: number;
  readonly raw: number;
  readonly familiarity: number;
  readonly familiarityMultiplier: number;
  /** Points lost to the familiarity gate — the number the penalty badge shows. */
  readonly familiarityPenalty: number;
  readonly skillBonus: number;
  readonly final: number;
}

/**
 * Why a rating is what it is. Everything the athlete card needs to say it in plain language,
 * computed here so the explanation can never drift from the arithmetic it explains.
 */
export function explainRating(
  athlete: Athlete,
  sport: SportId,
  rating: string,
  tables: SportRatingTables,
  options: DeriveOptions = {},
): RatingExplanation {
  const skill = sportSkillFor(athlete, sport);
  const familiarity = options.familiarity ?? skill.familiarity;
  const subSkill = (options.subSkills ?? skill.subSkills)[rating] ?? 0;

  const row = tables.weights[rating] ?? {};
  const contributions: Contribution[] = [];
  for (const [attribute, weight] of Object.entries(row)) {
    if (!isAttributeId(attribute) || weight === 0) continue;
    const value = athlete.attributes[attribute];
    contributions.push({ attribute, weight, value, points: weight * value });
  }
  // Largest contribution first; ties broken by attribute name so the card is stable between
  // renders rather than depending on object key order.
  contributions.sort((a, b) => b.points - a.points || a.attribute.localeCompare(b.attribute));

  const physical = physicalModifier(
    rating,
    athlete.heightCm,
    athlete.weightKg,
    tables.physicalModifiers,
  );
  const raw = contributions.reduce((sum, c) => sum + c.points, 0) + physical;
  const multiplier = familiarityMultiplier(familiarity);
  const bonus = skillBonus(subSkill);

  return {
    rating,
    contributions,
    physical,
    raw,
    familiarity,
    familiarityMultiplier: multiplier,
    familiarityPenalty: raw - raw * multiplier,
    skillBonus: bonus,
    final: clamp(
      Math.round(raw * multiplier + bonus),
      ATHLETE_BOUNDS.attribute.min,
      ATHLETE_BOUNDS.attribute.max,
    ),
  };
}

/** `overall(sport, position) = Σ_r ( positionWeight[position][r] × rating_r )` — `05` §3.4. */
export function overall(
  ratings: DerivedRatings,
  positionWeights: Readonly<Record<string, number>>,
): number {
  let sum = 0;
  for (const [rating, weight] of Object.entries(positionWeights))
    sum += weight * (ratings[rating] ?? 0);
  return sum;
}

export interface PositionFit {
  readonly position: string;
  readonly overall: number;
  /** `overall / max over positions` — 1.0 at the athlete's best position (`05` §3.4). */
  readonly fit: number;
  /** True under the threshold, which warns in the lineup editor rather than blocking (T-3.12). */
  readonly warn: boolean;
}

/**
 * Every position, best first. The fit is relative to the athlete's *own* best position, so it
 * answers "is this where they belong?" rather than "are they good?" — a weak athlete played in
 * their best spot still reads 1.0, which is what the lineup editor's warning needs to mean.
 */
export function positionFits(
  ratings: DerivedRatings,
  positionWeights: PositionWeightTable | undefined,
): PositionFit[] {
  const positions = Object.keys(positionWeights ?? {});
  if (positions.length === 0) return [];

  const overalls = positions.map((position) => ({
    position,
    overall: overall(ratings, (positionWeights ?? {})[position] ?? {}),
  }));
  const best = Math.max(...overalls.map((entry) => entry.overall));

  return overalls
    .map(({ position, overall: value }) => {
      const fit = best <= 0 ? 1 : value / best;
      return { position, overall: value, fit, warn: fit < DERIVATION.positionFitWarning };
    })
    .sort((a, b) => b.overall - a.overall || a.position.localeCompare(b.position));
}

/** The athlete's best position for a sport, or `null` when the sport declares none. */
export function bestPosition(
  ratings: DerivedRatings,
  positionWeights: PositionWeightTable | undefined,
): PositionFit | null {
  return positionFits(ratings, positionWeights)[0] ?? null;
}
