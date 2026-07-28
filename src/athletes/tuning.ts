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

/**
 * Familiarity growth (`05` §3.3):
 * `gain = 0.9 × minutes × (1 − familiarity/100)^1.3 × ageFactor / sportComplexity`.
 *
 * @spec-ref 05-data-model.md §3.3
 */
export const FAMILIARITY = {
  rate: 0.9,
  headroomExponent: 1.3,
  primaryCap: 100,
  secondaryCap: 95,

  ageBase: 1.25,
  ageReference: 22,
  agePerYear: 0.02,
  ageFactorMin: 0.55,
  ageFactorMax: 1.25,

  /** Sports not listed learn at basketball's rate — a new sport is a table entry, not a branch. */
  defaultComplexity: 1,
  complexity: {
    basketball: 1,
    soccer: 1.15,
    football: 1.3,
    hockey: 1.4,
  } as Readonly<Record<string, number>>,

  /** Ceiling on "how many matches until…" answers, so a projection cannot run forever. */
  projectionLimit: 2_000,
} as const;

/**
 * Sport skill XP (`05` §3.3): `xpFor(level) = 100 × level^1.6`, XP from minutes plus events, and
 * level-ups that buy sub-skill points.
 *
 * @spec-ref 05-data-model.md §3.3
 */
export const XP = {
  levelBase: 100,
  levelExponent: 1.6,
  /** XP per real minute of play — the half that does not depend on doing anything. */
  perMinute: 6,
  /** Sub-skill points a level grants, spent on what the athlete actually did. */
  pointsPerLevel: 2,
  /**
   * Within one session, the n-th award of the same action is worth `repeatDecay^(n-1)` of the
   * first, floored. Forty threes should not teach forty threes' worth (`05` §5.5's shape).
   */
  repeatDecay: 0.93,
  repeatFloor: 0.2,
} as const;

/**
 * Behavioural coupling (`05` §3.3's last paragraph). Every value is a *maximum*, reached only by a
 * complete novice; all of them are zero at `fadeOut` familiarity and above.
 *
 * @spec-ref 05-data-model.md §3.3 — "adds decision noise, increases control error on first touch
 * and handling, and lengthens reaction latency in the AI layer"
 */
export const COUPLING = {
  /** At or above this familiarity nothing is coupled at all — an athlete plays cleanly. */
  fadeOut: 75,
  /** Above 1, so the effect is concentrated in the genuinely lost rather than spread thinly. */
  exponent: 1.4,
  /** Standard deviation, in expected points, of a novice's misjudgement of a look. */
  decisionNoise: 0.45,
  /** A novice's catches and first touches land at 45% of their controlled quality. */
  controlError: 0.55,
  /** A novice acts on a decision at 40% of the rate an at-home athlete does. */
  reactionPenalty: 0.6,
  /** A novice's release timing scatters over three times as wide a band. */
  timingSpread: 2.2,
} as const;
