/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.2 — Attribute system: the eleven attributes, budget rules, sandbox flag, random roll
 * @story   US-5.1 — Create an athlete profile
 * @design  05-data-model.md §2.1 (creation budget), §4 (rarity and traits)
 *
 * Purpose: every tunable number the athlete system reads, in one place, so a balance pass never
 * means touching logic — which is exactly what `05`'s preamble asks for. Nothing here has
 * behaviour; the modules that consume these values are where the rules live.
 *
 * All of it is a starting value for a balance pass, not final truth.
 */

/** `05` §2.1 — the rules a user-created athlete is comparable under. */
export const CREATION = {
  /** Per-attribute range in the editor. Narrower than the 1–99 scale a record may hold. */
  attribute: { min: 20, max: 95 },
  /** Total across all eleven. Exceeding it requires Sandbox mode. */
  budget: 580,
} as const;

/** Defaults for fields the editor leaves alone, near the middle of each range (`05` §2). */
export const CREATION_DEFAULTS = {
  heightCm: 185,
  weightKg: 82,
  age: 24,
  handedness: 'right',
  attribute: 50,
} as const;

export interface RarityBand {
  /** Inclusive attribute-total roll range (`05` §4). */
  readonly totalMin: number;
  readonly totalMax: number;
  /** Inclusive trait-count range. */
  readonly traitsMin: number;
  readonly traitsMax: number;
  /** Coin value base (`05` §5.1 builds on this). */
  readonly valueBase: number;
}

/**
 * `05` §4, in ascending order. The bands overlap deliberately: rarity sets the roll range and the
 * trait count and nothing else, so a well-built Rare beating a badly-built Epic is a feature.
 */
export const RARITY_BANDS = {
  common: { totalMin: 380, totalMax: 470, traitsMin: 0, traitsMax: 0, valueBase: 200 },
  uncommon: { totalMin: 450, totalMax: 540, traitsMin: 0, traitsMax: 1, valueBase: 500 },
  rare: { totalMin: 520, totalMax: 600, traitsMin: 1, traitsMax: 1, valueBase: 1_200 },
  epic: { totalMin: 580, totalMax: 660, traitsMin: 1, traitsMax: 2, valueBase: 3_000 },
  legendary: { totalMin: 640, totalMax: 720, traitsMin: 2, traitsMax: 3, valueBase: 8_000 },
} as const;

/**
 * Shape of a rolled athlete's attribute spread. A flat draw makes every athlete the same
 * featureless mid, so attributes are drawn around the band's average and then corrected to hit
 * the rolled total exactly — the spread is what makes one Rare a shooter and another a defender.
 */
export const ROLL = {
  /** Standard deviation, in attribute points, of the initial draw. */
  spread: 13,
  /** A rolled athlete may sit anywhere on the full scale, unlike one built in the editor. */
  attribute: { min: 12, max: 99 },
  /** Physical roll (`05` §2), used when a caller does not supply a body. */
  heightCm: { mean: 186, spread: 9 },
  /** Weight tracks height: this many kg per cm above 186, around the mean. */
  weightKg: { mean: 83, spread: 6, perCm: 0.75 },
  age: { min: 18, max: 34 },
} as const;

/**
 * The derivation curve (`05` §3, §3.4). `famMult(f) = 0.55 + 0.45 × (f/100)^0.75`, so a total
 * novice plays at 55% of their ceiling and a fully familiar athlete at 100%.
 *
 * @spec-ref 05-data-model.md §3
 */
export const DERIVATION = {
  familiarityFloor: 0.55,
  familiarityRange: 0.45,
  familiarityExponent: 0.75,
  /** Sub-skill 0–20 → 0–15 rating points. */
  subSkillPoints: 0.75,
  /** Under this, the lineup editor warns rather than blocks (`05` §3.4). */
  positionFitWarning: 0.85,
} as const;
