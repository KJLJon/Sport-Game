/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.3 — Derivation engine: weight matrix, physical modifiers, unit-tested invariants
 * @story   US-5.2 — Play any athlete in any sport
 * @design  05-data-model.md §3, §3.1, §3.2, §3.4
 *
 * Purpose: the headline feature's arithmetic. Both shipped weight tables are checked structurally
 * (rows sum to 1.0, every attribute is a real one), and the derivation itself is checked against
 * `05` §3 by hand at the two ends of the familiarity curve — plus the properties that have to hold
 * for the feature to be honest: monotonic in every weighted attribute, always 1–99, and identical
 * arithmetic whether a rating is real or projected.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  bestPosition,
  deriveRatings,
  explainRating,
  familiarityMultiplier,
  overall,
  physicalModifier,
  positionFits,
  projectRatings,
  rawRating,
  skillBonus,
  type SportRatingTables,
} from '../../../src/athletes/derivation.ts';
import { DERIVATION } from '../../../src/athletes/tuning.ts';
import { ATTRIBUTE_IDS, isAttributeId } from '../../../src/athletes/types.ts';
import {
  BASKETBALL_PHYSICAL,
  BASKETBALL_POSITION_WEIGHTS,
  BASKETBALL_REFERENCE_HEIGHT_CM,
  BASKETBALL_WEIGHTS,
} from '../../../src/sports/basketball/weights.ts';
import { SOCCER_PHYSICAL, SOCCER_WEIGHTS } from '../../../src/sports/soccer/weights.ts';
import { athlete, attributes } from '../../helpers/athletes.ts';

const basketball: SportRatingTables = {
  weights: BASKETBALL_WEIGHTS,
  physicalModifiers: BASKETBALL_PHYSICAL,
  positionWeights: BASKETBALL_POSITION_WEIGHTS,
};

const soccer: SportRatingTables = { weights: SOCCER_WEIGHTS, physicalModifiers: SOCCER_PHYSICAL };

const TABLES = [
  ['basketball', BASKETBALL_WEIGHTS],
  ['soccer', SOCCER_WEIGHTS],
] as const;

describe('weight tables', () => {
  it.each(TABLES)('%s rows sum to 1.0 (`05` §3.1, §3.2)', (_name, table) => {
    for (const [rating, row] of Object.entries(table)) {
      const sum = Object.values(row).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      expect(rating).not.toBe('');
    }
  });

  it.each(TABLES)('%s weights every attribute by one of the eleven names', (_name, table) => {
    for (const row of Object.values(table)) {
      for (const attribute of Object.keys(row)) expect(isAttributeId(attribute)).toBe(true);
    }
  });

  it.each(TABLES)('%s has no negative weights', (_name, table) => {
    for (const row of Object.values(table)) {
      for (const weight of Object.values(row)) expect(weight).toBeGreaterThan(0);
    }
  });

  it('gives basketball ten ratings and soccer twelve', () => {
    expect(Object.keys(BASKETBALL_WEIGHTS)).toHaveLength(10);
    expect(Object.keys(SOCCER_WEIGHTS)).toHaveLength(12);
  });

  it('position weight rows sum to 1.0, so an overall is on the rating scale (`05` §3.4)', () => {
    for (const row of Object.values(BASKETBALL_POSITION_WEIGHTS)) {
      const sum = Object.values(row).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      for (const rating of Object.keys(row)) expect(BASKETBALL_WEIGHTS[rating]).toBeDefined();
    }
  });
});

describe('familiarityMultiplier', () => {
  it('matches `05` §3 at both ends', () => {
    expect(familiarityMultiplier(0)).toBeCloseTo(0.55, 10);
    expect(familiarityMultiplier(100)).toBeCloseTo(1, 10);
  });

  it('rises fastest early — the first matches are the visible ones', () => {
    const early = familiarityMultiplier(25) - familiarityMultiplier(10);
    const late = familiarityMultiplier(95) - familiarityMultiplier(80);
    expect(early).toBeGreaterThan(late);
  });

  it('is monotonic and clamps outside 0–100', () => {
    for (let f = 0; f < 100; f++) {
      expect(familiarityMultiplier(f + 1)).toBeGreaterThan(familiarityMultiplier(f));
    }
    expect(familiarityMultiplier(-40)).toBe(familiarityMultiplier(0));
    expect(familiarityMultiplier(400)).toBe(familiarityMultiplier(100));
  });
});

describe('skillBonus', () => {
  it('turns 0–20 of sub-skill into 0–15 rating points (`05` §3)', () => {
    expect(skillBonus(0)).toBe(0);
    expect(skillBonus(20)).toBe(15);
    expect(skillBonus(1_000)).toBe(15);
    expect(skillBonus(-5)).toBe(0);
  });
});

describe('rawRating', () => {
  it('is the weighted sum — checked by hand against `05` §3.1', () => {
    // freeThrow = coordination .15 + accuracy .50 + composure .35, and no height modifier.
    const flat = athlete({
      attributes: attributes(50, { coordination: 80, accuracy: 60, composure: 40 }),
      heightCm: BASKETBALL_REFERENCE_HEIGHT_CM,
    });
    expect(rawRating('freeThrow', flat.attributes, flat.heightCm, flat.weightKg, basketball)).toBe(
      0.15 * 80 + 0.5 * 60 + 0.35 * 40,
    );
  });

  it('is zero for a rating the sport does not define', () => {
    const a = athlete();
    expect(rawRating('headers', a.attributes, a.heightCm, a.weightKg, basketball)).toBe(0);
  });

  it('applies height where `05` §3.1 says it applies, and nowhere else', () => {
    const a = athlete({ attributes: attributes(50), heightCm: 215 });
    const flat = athlete({ attributes: attributes(50), heightCm: 195 });
    const delta = (rating: string) =>
      rawRating(rating, a.attributes, a.heightCm, a.weightKg, basketball) -
      rawRating(rating, flat.attributes, flat.heightCm, flat.weightKg, basketball);

    expect(delta('rebounding')).toBeCloseTo(20 * 0.35, 10);
    expect(delta('interiorD')).toBeCloseTo(20 * 0.35, 10);
    expect(delta('ballHandling')).toBeCloseTo(-20 * 0.15, 10);
    expect(delta('perimeterD')).toBeCloseTo(-20 * 0.15, 10);
    expect(delta('threePoint')).toBe(0);
  });

  it('reports no physical modifier for a sport that declares none', () => {
    expect(physicalModifier('rebounding', 220, 110, undefined)).toBe(0);
    expect(physicalModifier('pace', 200, 90, { weightKg: { reference: 80, perUnit: {} } })).toBe(0);
  });

  it('reads a weight modifier when a sport declares one', () => {
    const heavy: SportRatingTables = {
      weights: BASKETBALL_WEIGHTS,
      physicalModifiers: { weightKg: { reference: 90, perUnit: { finishing: 0.2 } } },
    };
    const a = athlete({ weightKg: 110 });
    const light = athlete({ weightKg: 90 });
    expect(
      rawRating('finishing', a.attributes, a.heightCm, a.weightKg, heavy) -
        rawRating('finishing', light.attributes, light.heightCm, light.weightKg, heavy),
    ).toBeCloseTo(4, 10);
  });
});

describe('deriveRatings', () => {
  it('produces every rating the sport defines', () => {
    expect(Object.keys(deriveRatings(athlete(), 'basketball', basketball)).sort()).toEqual(
      Object.keys(BASKETBALL_WEIGHTS).sort(),
    );
  });

  it('plays a total novice at 55% of their ceiling (`05` §3)', () => {
    const a = athlete({
      primarySport: 'basketball',
      sportSkills: {},
      heightCm: BASKETBALL_REFERENCE_HEIGHT_CM,
    });
    const novice = deriveRatings(a, 'soccer', soccer, { familiarity: 0 });
    const expert = deriveRatings(a, 'soccer', soccer, { familiarity: 100 });
    for (const rating of Object.keys(SOCCER_WEIGHTS)) {
      expect(novice[rating]).toBeCloseTo(Math.round((expert[rating] as number) * 0.55), 0);
    }
  });

  it("reads the athlete's stored familiarity when none is given", () => {
    const a = athlete({
      primarySport: 'basketball',
      sportSkills: {
        basketball: { familiarity: 85, level: 1, xp: 0, subSkills: {}, minutesPlayed: 0 },
      },
    });
    expect(deriveRatings(a, 'basketball', basketball)).toEqual(
      deriveRatings(a, 'basketball', basketball, { familiarity: 85 }),
    );
  });

  it('makes an athlete worse in a sport they have never played (US-5.2)', () => {
    const a = athlete({ primarySport: 'basketball' });
    const home = deriveRatings(a, 'basketball', basketball);
    const away = deriveRatings(a, 'soccer', soccer);
    // `finishing` exists in both tables, and the same body scores it lower away from home.
    expect(away.finishing).toBeLessThan(home.finishing as number);
  });

  it('adds learned sub-skills on top of the gated rating', () => {
    const a = athlete({
      sportSkills: {
        basketball: {
          familiarity: 100,
          level: 5,
          xp: 0,
          subSkills: { threePoint: 20 },
          minutesPlayed: 0,
        },
      },
    });
    const withSkill = deriveRatings(a, 'basketball', basketball);
    const without = deriveRatings(a, 'basketball', basketball, { familiarity: 100, subSkills: {} });
    expect((withSkill.threePoint as number) - (without.threePoint as number)).toBe(15);
    expect(withSkill.passing).toBe(without.passing);
  });

  it('is always 1–99, whatever it is given', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99 }),
        fc.integer({ min: 150, max: 230 }),
        fc.integer({ min: 0, max: 100 }),
        (value, heightCm, familiarity) => {
          const a = athlete({ attributes: attributes(value), heightCm });
          const ratings = deriveRatings(a, 'basketball', basketball, { familiarity });
          return Object.values(ratings).every(
            (rating) => Number.isInteger(rating) && rating >= 1 && rating <= 99,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('never falls when an attribute it weights rises', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ATTRIBUTE_IDS),
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 1, max: 39 }),
        (attribute, base, bump) => {
          const lower = athlete({ attributes: attributes(base) });
          const higher = athlete({
            attributes: attributes(base, { [attribute]: base + bump }),
          });
          const a = deriveRatings(lower, 'basketball', basketball, { familiarity: 100 });
          const b = deriveRatings(higher, 'basketball', basketball, { familiarity: 100 });
          return Object.keys(a).every((rating) => (b[rating] as number) >= (a[rating] as number));
        },
      ),
      { numRuns: 150 },
    );
  });

  it('never rates an athlete above their ceiling', () => {
    const a = athlete({ attributes: attributes(70) });
    const now = deriveRatings(a, 'soccer', soccer, { familiarity: 40 });
    const ceiling = projectRatings(a, 'soccer', soccer);
    for (const rating of Object.keys(SOCCER_WEIGHTS)) {
      expect(now[rating]).toBeLessThanOrEqual(ceiling[rating] as number);
    }
  });

  it('projects through the same arithmetic as the real thing (T-3.9)', () => {
    const a = athlete({
      sportSkills: {
        soccer: { familiarity: 12, level: 3, xp: 0, subSkills: { pace: 10 }, minutesPlayed: 30 },
      },
    });
    expect(projectRatings(a, 'soccer', soccer)).toEqual(
      deriveRatings(a, 'soccer', soccer, { familiarity: 100, subSkills: {} }),
    );
  });
});

describe('explainRating', () => {
  it('accounts for the whole rating, largest contribution first (US-5.4)', () => {
    const a = athlete({
      attributes: attributes(50, { accuracy: 90, coordination: 70 }),
      heightCm: BASKETBALL_REFERENCE_HEIGHT_CM,
      sportSkills: {
        basketball: { familiarity: 60, level: 1, xp: 0, subSkills: {}, minutesPlayed: 0 },
      },
    });
    const why = explainRating(a, 'basketball', 'threePoint', basketball);

    expect(why.contributions[0]?.attribute).toBe('accuracy');
    expect(why.contributions.map((c) => c.points)).toEqual(
      [...why.contributions.map((c) => c.points)].sort((x, y) => y - x),
    );
    expect(why.contributions.reduce((sum, c) => sum + c.points, 0) + why.physical).toBeCloseTo(
      why.raw,
      10,
    );
    expect(why.final).toBe(deriveRatings(a, 'basketball', basketball).threePoint);
  });

  it('reports the points lost to the familiarity gate — what the badge shows', () => {
    const a = athlete({ sportSkills: {} });
    const why = explainRating(a, 'soccer', 'pace', soccer);
    expect(why.familiarity).toBe(10);
    expect(why.familiarityPenalty).toBeCloseTo(why.raw * (1 - why.familiarityMultiplier), 10);
    expect(why.familiarityPenalty).toBeGreaterThan(0);
  });

  it('reports the height contribution separately from the attributes', () => {
    const tall = explainRating(athlete({ heightCm: 215 }), 'basketball', 'rebounding', basketball);
    expect(tall.physical).toBeCloseTo(20 * 0.35, 10);
    expect(tall.contributions.every((c) => c.attribute !== 'vertical' || c.weight === 0.35)).toBe(
      true,
    );
  });

  it('explains an unknown rating as nothing rather than throwing', () => {
    const why = explainRating(athlete(), 'basketball', 'nutmegs', basketball);
    expect(why.contributions).toEqual([]);
    expect(why.raw).toBe(0);
    expect(why.final).toBe(1);
  });
});

describe('overall and position fit (`05` §3.4)', () => {
  const guardAttributes = attributes(45, {
    coordination: 90,
    accuracy: 88,
    awareness: 85,
    agility: 88,
    speed: 85,
    acceleration: 85,
  });
  const bigAttributes = attributes(45, { strength: 92, vertical: 90, awareness: 70 });

  it('is the weighted sum of the derived ratings', () => {
    const ratings = { finishing: 80, rebounding: 40 };
    expect(overall(ratings, { finishing: 0.5, rebounding: 0.5 })).toBe(60);
    expect(overall(ratings, { missing: 1 })).toBe(0);
  });

  it('puts a small quick shooter at guard and a tall strong athlete in the paint', () => {
    const guard = athlete({ attributes: guardAttributes, heightCm: 185, weightKg: 80 });
    const big = athlete({ attributes: bigAttributes, heightCm: 215, weightKg: 115 });

    expect(
      bestPosition(deriveRatings(guard, 'basketball', basketball), BASKETBALL_POSITION_WEIGHTS)
        ?.position,
    ).toBe('PG');
    expect(
      bestPosition(deriveRatings(big, 'basketball', basketball), BASKETBALL_POSITION_WEIGHTS)
        ?.position,
    ).toBe('C');
  });

  it('rates the best position at 1.0 and warns below the threshold', () => {
    const big = athlete({ attributes: bigAttributes, heightCm: 215, weightKg: 115 });
    const fits = positionFits(
      deriveRatings(big, 'basketball', basketball),
      BASKETBALL_POSITION_WEIGHTS,
    );

    expect(fits[0]?.fit).toBe(1);
    expect(fits[0]?.warn).toBe(false);
    expect(fits.map((f) => f.position)).toHaveLength(5);

    const atPoint = fits.find((f) => f.position === 'PG');
    expect(atPoint?.fit).toBeLessThan(DERIVATION.positionFitWarning);
    expect(atPoint?.warn).toBe(true);
  });

  it('answers "is this where they belong", not "are they good"', () => {
    // A weak athlete in their best spot still reads 1.0 — the warning is about fit alone.
    const weak = athlete({ attributes: attributes(20) });
    expect(
      positionFits(deriveRatings(weak, 'basketball', basketball), BASKETBALL_POSITION_WEIGHTS)[0]
        ?.fit,
    ).toBe(1);
  });

  it('has nothing to say about a sport that declares no positions', () => {
    expect(positionFits({ pace: 70 }, undefined)).toEqual([]);
    expect(bestPosition({ pace: 70 }, undefined)).toBeNull();
    expect(positionFits({ pace: 70 }, {})).toEqual([]);
  });

  it('treats an all-zero athlete as a perfect fit everywhere rather than dividing by zero', () => {
    const fits = positionFits({}, BASKETBALL_POSITION_WEIGHTS);
    expect(fits).toHaveLength(5);
    expect(fits.every((f) => f.fit === 1 && !f.warn)).toBe(true);
  });
});
