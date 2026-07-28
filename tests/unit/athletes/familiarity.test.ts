/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.4 — Familiarity model: per-sport familiarity, penalty curve, growth from minutes
 * @story   US-5.3 — Watch an athlete learn a new sport
 * @design  05-data-model.md §3.3
 *
 * Purpose: the growth half of familiarity. The formula is checked term by term, and — the test
 * that actually matters — `05` §3.3's own stated pace is asserted rather than assumed: roughly
 * fifteen full matches from novice to competent, roughly fifty to approach the cap. That claim is
 * what pins what `minutes` means; get the unit wrong and it is one match, not fifteen.
 */
import { describe, expect, it } from 'vitest';
import {
  ageFactor,
  applyMinutes,
  familiarityBand,
  familiarityCap,
  familiarityGain,
  learningMinutes,
  matchesToReach,
  projectFamiliarity,
  sportComplexity,
  startingFamiliarity,
} from '../../../src/athletes/familiarity.ts';
import { familiarityMultiplier } from '../../../src/athletes/derivation.ts';
import { FAMILIARITY } from '../../../src/athletes/tuning.ts';
import { athlete } from '../../helpers/athletes.ts';

/** A starter's real minutes in one basketball match: 32 game minutes at 4× compression. */
const MATCH_MINUTES = learningMinutes(32, 4);

describe('caps', () => {
  it('lets only the primary sport reach 100 (`05` §3.3)', () => {
    const a = athlete({ primarySport: 'basketball' });
    expect(familiarityCap(a, 'basketball')).toBe(100);
    expect(familiarityCap(a, 'soccer')).toBe(95);
  });

  it('starts the primary sport at 85 and everything else at 10', () => {
    const a = athlete({ primarySport: 'soccer' });
    expect(startingFamiliarity(a, 'soccer')).toBe(85);
    expect(startingFamiliarity(a, 'basketball')).toBe(10);
  });
});

describe('ageFactor', () => {
  it('is full rate at 22 and decays 0.02 a year either side', () => {
    expect(ageFactor(22)).toBeCloseTo(1.25, 10);
    expect(ageFactor(32)).toBeCloseTo(1.05, 10);
  });

  it('bottoms out at 0.55 — a veteran learns slowly, never not at all', () => {
    expect(ageFactor(80)).toBe(FAMILIARITY.ageFactorMin);
    expect(ageFactor(45)).toBeGreaterThanOrEqual(FAMILIARITY.ageFactorMin);
  });

  it('is capped above, so a teenager is not a prodigy by arithmetic', () => {
    expect(ageFactor(16)).toBe(FAMILIARITY.ageFactorMax);
  });

  it('never rises with age', () => {
    for (let age = 16; age < 45; age++) {
      expect(ageFactor(age + 1)).toBeLessThanOrEqual(ageFactor(age));
    }
  });
});

describe('sportComplexity', () => {
  it("reads `05` §3.3's table", () => {
    expect(sportComplexity('basketball')).toBe(1);
    expect(sportComplexity('soccer')).toBe(1.15);
    expect(sportComplexity('football')).toBe(1.3);
    expect(sportComplexity('hockey')).toBe(1.4);
  });

  it("gives an unlisted sport basketball's rate rather than dividing by nothing", () => {
    expect(sportComplexity('testsport')).toBe(1);
  });
});

describe('familiarityGain', () => {
  it('is the formula from `05` §3.3', () => {
    const gain = familiarityGain({ familiarity: 10, minutes: 8, age: 22, sport: 'basketball' });
    expect(gain).toBeCloseTo(0.9 * 8 * 0.9 ** 1.3 * 1.25, 10);
  });

  it('is slower in a more complex sport', () => {
    const common = { familiarity: 10, minutes: 8, age: 22 };
    expect(familiarityGain({ ...common, sport: 'hockey' })).toBeLessThan(
      familiarityGain({ ...common, sport: 'basketball' }),
    );
  });

  it('diminishes as familiarity rises, and is zero at 100', () => {
    const common = { minutes: 8, age: 22, sport: 'basketball' } as const;
    expect(familiarityGain({ ...common, familiarity: 10 })).toBeGreaterThan(
      familiarityGain({ ...common, familiarity: 60 }),
    );
    expect(familiarityGain({ ...common, familiarity: 100 })).toBe(0);
  });

  it('is zero for zero or negative minutes', () => {
    const common = { familiarity: 10, age: 22, sport: 'basketball' } as const;
    expect(familiarityGain({ ...common, minutes: 0 })).toBe(0);
    expect(familiarityGain({ ...common, minutes: -90 })).toBe(0);
  });

  it('clamps a familiarity outside 0–100 rather than producing a complex number', () => {
    const common = { minutes: 8, age: 22, sport: 'basketball' } as const;
    expect(familiarityGain({ ...common, familiarity: 140 })).toBe(0);
    expect(Number.isFinite(familiarityGain({ ...common, familiarity: -20 }))).toBe(true);
  });
});

describe('the pace `05` §3.3 claims', () => {
  const novice = { familiarity: 10, minutesPerMatch: MATCH_MINUTES, age: 22, sport: 'soccer' };

  it('reaches competent in roughly fifteen matches', () => {
    const matches = matchesToReach({ ...novice, cap: 95, target: 65 });
    expect(matches).toBeGreaterThanOrEqual(10);
    expect(matches).toBeLessThanOrEqual(22);
  });

  it('approaches the cap in roughly fifty', () => {
    const matches = matchesToReach({ ...novice, cap: 95, target: 90 });
    expect(matches).toBeGreaterThanOrEqual(35);
    expect(matches).toBeLessThanOrEqual(75);
  });

  it('moves most visibly in the first few matches (US-5.3)', () => {
    const after = (n: number) => projectFamiliarity({ ...novice, cap: 95, matches: n });
    const firstThree = after(3) - after(0);
    const nextThree = after(6) - after(3);
    const muchLater = after(33) - after(30);
    expect(firstThree).toBeGreaterThan(nextThree);
    expect(nextThree).toBeGreaterThan(muchLater);
  });

  it('shrinks the rating penalty as it goes (`05` §3, US-5.3)', () => {
    const novicePenalty = 1 - familiarityMultiplier(10);
    const laterPenalty =
      1 - familiarityMultiplier(projectFamiliarity({ ...novice, cap: 95, matches: 15 }));
    expect(laterPenalty).toBeLessThan(novicePenalty / 2);
  });

  it('would reach competent in a single match if `minutes` were read as game minutes', () => {
    // The unit is what the pace hangs on, so the wrong reading is pinned here too — this is the
    // trap the decision note in `PROGRESS.md` records, made visible rather than described.
    const wrong = matchesToReach({ ...novice, minutesPerMatch: 32, cap: 95, target: 65 }) as number;
    const right = matchesToReach({ ...novice, cap: 95, target: 65 }) as number;
    expect(wrong).toBeLessThanOrEqual(3);
    expect(right).toBeGreaterThan(wrong * 4);
  });
});

describe('learningMinutes', () => {
  it('converts box-score game minutes to real ones', () => {
    expect(learningMinutes(48, 4)).toBe(12);
    expect(learningMinutes(48, 1)).toBe(48);
  });

  it('passes minutes through when there is no compression to apply', () => {
    expect(learningMinutes(30, 0)).toBe(30);
  });
});

describe('applyMinutes', () => {
  it('moves familiarity and banks the minutes, without mutating the athlete', () => {
    const a = athlete({ primarySport: 'basketball', age: 22, sportSkills: {} });
    const { skill, change } = applyMinutes(a, 'soccer', MATCH_MINUTES);

    expect(change.before).toBe(10);
    expect(change.gained).toBeGreaterThan(0);
    expect(change.after).toBe(change.before + change.gained);
    expect(skill.familiarity).toBe(change.after);
    expect(skill.minutesPlayed).toBeCloseTo(MATCH_MINUTES, 10);
    expect(a.sportSkills.soccer).toBeUndefined();
  });

  it("stops at the sport's cap and says so", () => {
    const a = athlete({
      primarySport: 'basketball',
      sportSkills: {
        soccer: { familiarity: 94.9, level: 1, xp: 0, subSkills: {}, minutesPlayed: 0 },
      },
    });
    const { change } = applyMinutes(a, 'soccer', 90);
    expect(change.after).toBe(95);
    expect(change.atCap).toBe(true);
  });

  it('lets the primary sport past 95 but not past 100', () => {
    const a = athlete({
      primarySport: 'basketball',
      sportSkills: {
        basketball: { familiarity: 96, level: 1, xp: 0, subSkills: {}, minutesPlayed: 0 },
      },
    });
    const { change } = applyMinutes(a, 'basketball', 400);
    expect(change.after).toBe(100);
    expect(change.atCap).toBe(true);
  });

  it('keeps a benched athlete exactly where they were', () => {
    const a = athlete({ sportSkills: {} });
    const { change, skill } = applyMinutes(a, 'soccer', 0);
    expect(change.gained).toBe(0);
    expect(change.atCap).toBe(false);
    expect(skill.minutesPlayed).toBe(0);
  });

  it('accumulates across matches', () => {
    let a = athlete({ primarySport: 'basketball', sportSkills: {} });
    for (let match = 0; match < 5; match++) {
      const { skill } = applyMinutes(a, 'soccer', MATCH_MINUTES);
      a = { ...a, sportSkills: { ...a.sportSkills, soccer: skill } };
    }
    expect(a.sportSkills.soccer?.minutesPlayed).toBeCloseTo(MATCH_MINUTES * 5, 6);
    expect(a.sportSkills.soccer?.familiarity).toBeCloseTo(
      projectFamiliarity({
        familiarity: 10,
        minutesPerMatch: MATCH_MINUTES,
        age: 25,
        sport: 'soccer',
        cap: 95,
        matches: 5,
      }),
      6,
    );
  });
});

describe('matchesToReach', () => {
  const base = { familiarity: 10, minutesPerMatch: MATCH_MINUTES, age: 25, sport: 'soccer' };

  it('is zero when the athlete is already there', () => {
    expect(matchesToReach({ ...base, familiarity: 80, cap: 95, target: 65 })).toBe(0);
  });

  it('is null for a target above the cap', () => {
    expect(matchesToReach({ ...base, cap: 95, target: 100 })).toBeNull();
  });

  it('is null when no minutes are being played', () => {
    expect(matchesToReach({ ...base, minutesPerMatch: 0, cap: 95, target: 50 })).toBeNull();
  });

  it("takes an older athlete longer (`05` §3.3's age factor)", () => {
    const young = matchesToReach({ ...base, age: 20, cap: 95, target: 70 }) as number;
    const old = matchesToReach({ ...base, age: 38, cap: 95, target: 70 }) as number;
    expect(old).toBeGreaterThan(young);
  });
});

describe('familiarityBand', () => {
  it('gives every level a word, so colour never carries it alone', () => {
    expect(familiarityBand(0)).toBe('novice');
    expect(familiarityBand(10)).toBe('novice');
    expect(familiarityBand(30)).toBe('learning');
    expect(familiarityBand(65)).toBe('competent');
    expect(familiarityBand(85)).toBe('comfortable');
    expect(familiarityBand(95)).toBe('natural');
    expect(familiarityBand(100)).toBe('natural');
  });
});
