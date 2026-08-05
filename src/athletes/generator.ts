/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.11 — Procedural athlete generator: rarity-coherent attribute spreads, fictional names
 * @story   US-9.2 — Open packs to earn new athletes
 * @design  05-data-model.md §2 (athlete records), §4 (rarity bands and traits), 09-modes-and-arcade.md §6
 * @invariant INV-1 (rarity changes the size of a spread; an archetype changes only its shape),
 *            INV-8 (an athlete is a pure function of the seed it was rolled from)
 *
 * Purpose: rolls an athlete who reads as a person rather than as a row of numbers.
 *
 * **The gap this fills.** `rollAthlete` has existed since T-3.2 and draws every attribute from *one*
 * gaussian around the band's mean. That is a correct spread and it produces athletes with no
 * identity: eleven of them are eleven slightly different blobs, all mediocre at everything, none of
 * them anybody. A pack you open to find another blob is a pack not worth opening.
 *
 * So a rolled athlete now gets an **archetype** — a small set of attributes the points lean towards,
 * with a body to match. A Sprinter is fast and light; an Anchor is strong and slow and tall. The
 * points are *moved*, never added: `shapeToward` takes proportionally from what the archetype does
 * not want and gives to what it does, so the total is untouched.
 *
 * **That is the INV-1 line, and it is worth being precise about.** Rarity decides *how many* points
 * an athlete has. The archetype decides *where they sit*. Coherence — how strongly the archetype
 * pulls — rises with rarity, which means a Legendary is not merely higher-total but more *pointed*:
 * clearly the best sprinter you own rather than uniformly slightly better at everything. Nothing
 * here lets an archetype or a coherence value change a total, and there is a test for it.
 *
 * **Primary sport is part of the roll** (`US-9.2`). It is drawn from the sports the build actually
 * has, so a pack cannot hand out an athlete whose primary sport is one nobody can play.
 */
import { createRng, type Rng } from '../engine/rng.ts';
import { rollAthlete } from './create.ts';
import { shapeToward } from './shape.ts';
import { uniqueName } from './names.ts';
import { ATHLETE_BOUNDS, RARITIES, type Athlete, type AttributeId, type Rarity } from './types.ts';
import type { SportId } from '../sports/types.ts';

/**
 * A body-and-skill shape. `wants` is what the points lean towards; `height` nudges the body so the
 * numbers and the person agree.
 *
 * Seven, chosen so that no two want the same pair and every attribute is wanted by somebody — the
 * same rule `CPU_STYLES` follows, for the same reason: an archetype nobody can tell from another is
 * not an archetype.
 */
export interface Archetype {
  readonly id: string;
  readonly label: string;
  readonly wants: readonly AttributeId[];
  /** Centimetres added to the rolled height. Kept small: an archetype is a lean, not a species. */
  readonly heightBias: number;
  /** Kilograms added, independently of height, so a build can be light-for-height or heavy. */
  readonly weightBias: number;
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: 'sprinter',
    label: 'Sprinter',
    wants: ['speed', 'acceleration'],
    heightBias: -2,
    weightBias: -6,
  },
  {
    id: 'anchor',
    label: 'Anchor',
    wants: ['strength', 'stamina'],
    heightBias: 7,
    weightBias: 12,
  },
  {
    id: 'technician',
    label: 'Technician',
    wants: ['coordination', 'accuracy'],
    heightBias: -1,
    weightBias: -2,
  },
  {
    id: 'reader',
    label: 'Reader',
    wants: ['awareness', 'composure'],
    heightBias: 0,
    weightBias: 0,
  },
  {
    id: 'leaper',
    label: 'Leaper',
    wants: ['vertical', 'agility'],
    heightBias: 3,
    weightBias: -3,
  },
  {
    id: 'enforcer',
    label: 'Enforcer',
    wants: ['strength', 'discipline'],
    heightBias: 4,
    weightBias: 9,
  },
  {
    id: 'engine',
    label: 'Engine',
    wants: ['stamina', 'agility'],
    heightBias: -3,
    weightBias: -4,
  },
];

/**
 * How hard the archetype pulls, per rarity.
 *
 * Rising with rarity is what makes a good pull *feel* different rather than merely score higher. It
 * tops out well below 1: a fully-shaped athlete is a caricature with two enormous attributes and
 * nine floors, and `shapeToward` bounds the move anyway.
 */
export const ARCHETYPE_COHERENCE: Readonly<Record<Rarity, number>> = {
  common: 0.25,
  uncommon: 0.35,
  rare: 0.5,
  epic: 0.65,
  legendary: 0.8,
};

export interface GenerateOptions {
  readonly rarity: Rarity;
  /** The sports a pack may roll a primary from. Must be non-empty. */
  readonly sports: readonly SportId[];
  /** Names already used, so a generated squad has no duplicates. Mutated. */
  readonly used?: Set<string>;
  /**
   * When this athlete came into existence.
   *
   * **The one field that is not a function of the seed**, and deliberately: a pack athlete was
   * created when the pack was opened, and pretending otherwise would put a false timestamp in a
   * record the roster screen sorts by. A caller that needs two runs to compare equal — a test, a
   * fixture — passes one.
   */
  readonly createdAt?: number;
  /** Forces an archetype. Tests and the starter roster use it; a pack never does. */
  readonly archetype?: Archetype;
}

export interface GeneratedAthlete {
  readonly athlete: Athlete;
  /** What it was shaped towards. Shown on a pack reveal so a pull can be described in words. */
  readonly archetype: Archetype;
}

/**
 * One athlete, everything about it drawn from `rng`.
 *
 * Forked by label rather than drawn in order, so adding a field later cannot shift the athletes an
 * existing seed produces (INV-8, and the rule `engine/rng.ts` states).
 */
export function generateAthlete(rng: Rng, options: GenerateOptions): GeneratedAthlete {
  const archetype =
    options.archetype ?? (ARCHETYPES[rng.fork('archetype').int(0, ARCHETYPES.length)] as Archetype);
  const primarySport = pickSport(rng.fork('sport'), options.sports);
  const name = uniqueName(rng.fork('name'), options.used ?? new Set());

  const rolled = rollAthlete(rng.fork('roll'), {
    displayName: name,
    primarySport,
    rarity: options.rarity,
    source: 'pack',
    ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
  });

  const heightCm = clampInt(
    rolled.heightCm + archetype.heightBias,
    ATHLETE_BOUNDS.heightCm.min,
    ATHLETE_BOUNDS.heightCm.max,
  );
  const weightKg = clampInt(
    rolled.weightKg + archetype.weightBias,
    ATHLETE_BOUNDS.weightKg.min,
    ATHLETE_BOUNDS.weightKg.max,
  );

  return {
    archetype,
    athlete: {
      ...rolled,
      heightCm,
      weightKg,
      attributes: shapeToward(
        rolled.attributes,
        archetype.wants,
        ARCHETYPE_COHERENCE[options.rarity],
      ),
    },
  };
}

/**
 * A whole squad, with no two athletes sharing a name.
 *
 * The shared `used` set is the reason this exists rather than a loop at the call site: names are
 * drawn independently, and a squad of eleven hits a collision often enough that two identical names
 * on one team sheet would be a regular occurrence.
 */
export function generateSquad(
  seed: string,
  options: Omit<GenerateOptions, 'used'> & { readonly size: number },
): GeneratedAthlete[] {
  const root = createRng(seed);
  const used = new Set<string>();
  const out: GeneratedAthlete[] = [];

  for (let index = 0; index < options.size; index++) {
    out.push(generateAthlete(root.fork(`athlete-${index}`), { ...options, used }));
  }
  return out;
}

/**
 * The rarity a pack pull lands on, from published odds.
 *
 * Takes the odds as an argument rather than owning them: `US-9.2` requires the odds to be *shown*
 * before purchase, which means they are pack data (T-8.12), and a generator that kept its own copy
 * would be a second set able to disagree with the displayed one.
 */
export function rollRarity(rng: Rng, odds: Readonly<Partial<Record<Rarity, number>>>): Rarity {
  const weights = RARITIES.map((rarity) => Math.max(0, odds[rarity] ?? 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return 'common';

  let roll = rng.float(0, total);
  for (const [index, weight] of weights.entries()) {
    roll -= weight;
    if (roll < 0) return RARITIES[index] as Rarity;
  }
  return RARITIES[RARITIES.length - 1] as Rarity;
}

function pickSport(rng: Rng, sports: readonly SportId[]): SportId {
  if (sports.length === 0) throw new Error('generateAthlete needs at least one sport to roll from');
  return sports[rng.int(0, sports.length)] as SportId;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(value < min ? min : value > max ? max : value);
}
