/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.5 — Sport skill XP: levels, sub-skills, event-driven awards, diminishing returns
 * @story   US-5.3 — Watch an athlete learn a new sport
 * @design  05-data-model.md §3.3
 * @invariant INV-6 (no mode-specific branching)
 *
 * Purpose: the door every mode comes through. The thing most worth pinning here is that minutes
 * are banked exactly once — familiarity and XP both read them, and only one of them may store
 * them — and that an athlete visibly develops into what they are actually used for.
 */
import { describe, expect, it } from 'vitest';
import { EventKind, event, type SportEvent } from '../../../src/engine/match/events.ts';
import { applyMatch, applyPlay, learnedSubSkills } from '../../../src/athletes/progression.ts';
import { deriveRatings } from '../../../src/athletes/derivation.ts';
import { xpForLevel } from '../../../src/athletes/xp.ts';
import { learningMinutes } from '../../../src/athletes/familiarity.ts';
import { BASKETBALL_XP_AWARDS } from '../../../src/sports/basketball/xp.ts';
import {
  BASKETBALL_PHYSICAL,
  BASKETBALL_POSITION_WEIGHTS,
  BASKETBALL_WEIGHTS,
} from '../../../src/sports/basketball/weights.ts';
import { athlete } from '../../helpers/athletes.ts';
import type { Athlete } from '../../../src/athletes/types.ts';

const MATCH_MINUTES = learningMinutes(32, 4);

const tables = {
  weights: BASKETBALL_WEIGHTS,
  physicalModifiers: BASKETBALL_PHYSICAL,
  positionWeights: BASKETBALL_POSITION_WEIGHTS,
};

function shot(zone: string, actor: number): SportEvent {
  return event(EventKind.SHOT, 0, 0, { actor, detail: { zone } });
}

describe('applyPlay', () => {
  it('banks the minutes exactly once', () => {
    const before = athlete({ primarySport: 'basketball', sportSkills: {} });
    const { athlete: after } = applyPlay(before, 'soccer', {
      minutes: MATCH_MINUTES,
      actions: {},
      xp: 10,
    });
    expect(after.sportSkills.soccer?.minutesPlayed).toBeCloseTo(MATCH_MINUTES, 10);
  });

  it('moves familiarity and XP together, and reports both', () => {
    const before = athlete({ primarySport: 'basketball', age: 22, sportSkills: {} });
    const { athlete: after, report } = applyPlay(before, 'soccer', {
      minutes: MATCH_MINUTES,
      actions: { pace: 4 },
      xp: xpForLevel(1),
    });

    expect(report.familiarity.before).toBe(10);
    expect(report.familiarity.gained).toBeGreaterThan(0);
    expect(report.skill.levelsGained).toBe(1);
    expect(after.sportSkills.soccer?.familiarity).toBe(report.familiarity.after);
    expect(after.sportSkills.soccer?.level).toBe(2);
  });

  it('does not mutate the athlete it was given', () => {
    const before = athlete({ sportSkills: {} });
    applyPlay(before, 'soccer', { minutes: 20, actions: {}, xp: 500 });
    expect(before.sportSkills.soccer).toBeUndefined();
  });

  it('leaves other sports untouched', () => {
    const before = athlete({ primarySport: 'basketball' });
    const { athlete: after } = applyPlay(before, 'soccer', { minutes: 8, actions: {}, xp: 40 });
    expect(after.sportSkills.basketball).toEqual(before.sportSkills.basketball);
  });

  it('makes an athlete measurably better at the sport over a season (US-5.3)', () => {
    let current: Athlete = athlete({
      primarySport: 'basketball',
      age: 22,
      sportSkills: {},
      heightCm: 190,
    });
    const before = deriveRatings(current, 'soccer', { weights: BASKETBALL_WEIGHTS });

    for (let match = 0; match < 20; match++) {
      current = applyPlay(current, 'soccer', {
        minutes: MATCH_MINUTES,
        actions: { passing: 6, threePoint: 2 },
        xp: 300,
      }).athlete;
    }

    const after = deriveRatings(current, 'soccer', { weights: BASKETBALL_WEIGHTS });
    expect(current.sportSkills.soccer?.familiarity).toBeGreaterThan(60);
    expect(after.passing).toBeGreaterThan(before.passing as number);
    // Developed into what they were used for: passing outgrew the untrained ratings.
    expect(learnedSubSkills(current, 'soccer')[0]?.rating).toBe('passing');
  });
});

describe('applyMatch', () => {
  const guard = athlete({ id: 'guard', primarySport: 'basketball' });
  const bench = athlete({ id: 'bench', primarySport: 'basketball' });
  const entities = new Map([
    [1, guard],
    [2, bench],
  ]);

  it('pays whoever played, from one event stream, without asking what mode it was', () => {
    const results = applyMatch({
      sport: 'basketball',
      events: [shot('cornerThree', 1), shot('cornerThree', 1), shot('midRange', 1)],
      awards: BASKETBALL_XP_AWARDS,
      entities,
      minutes: new Map([
        [1, MATCH_MINUTES],
        [2, 0],
      ]),
    });

    expect(results.get(1)?.report.skill.xpGained).toBeGreaterThan(0);
    expect(results.get(1)?.report.familiarity.gained).toBeGreaterThan(0);
    expect(results.get(2)?.report.skill.xpGained).toBe(0);
    expect(results.get(2)?.report.familiarity.gained).toBe(0);
  });

  it('gives a result for every athlete on the sheet, ball-toucher or not', () => {
    const results = applyMatch({
      sport: 'basketball',
      events: [],
      awards: BASKETBALL_XP_AWARDS,
      entities,
      minutes: new Map([[1, MATCH_MINUTES]]),
    });
    expect([...results.keys()].sort()).toEqual([1, 2]);
  });

  it("scales rewards without a mode branch — T-4.10's reduced arcade rate", () => {
    const options = {
      sport: 'basketball',
      events: [shot('cornerThree', 1)],
      awards: BASKETBALL_XP_AWARDS,
      entities,
      minutes: new Map([[1, MATCH_MINUTES]]),
    } as const;

    const full = applyMatch({ ...options });
    const reduced = applyMatch({ ...options, rate: 0.25 });

    expect(reduced.get(1)?.report.skill.xpGained).toBeCloseTo(
      (full.get(1)?.report.skill.xpGained as number) * 0.25,
      6,
    );
    expect(reduced.get(1)?.report.familiarity.gained).toBeLessThan(
      full.get(1)?.report.familiarity.gained as number,
    );
  });

  it('ignores events belonging to entities nobody is playing', () => {
    const results = applyMatch({
      sport: 'basketball',
      events: [shot('cornerThree', 99)],
      awards: BASKETBALL_XP_AWARDS,
      entities,
      minutes: new Map([[1, MATCH_MINUTES]]),
    });
    expect(results.has(99)).toBe(false);
  });
});

describe('learnedSubSkills', () => {
  it('lists what has actually been learned, largest first, and nothing else', () => {
    const a = athlete({
      sportSkills: {
        basketball: {
          familiarity: 85,
          level: 4,
          xp: 0,
          subSkills: { passing: 3, threePoint: 7, rebounding: 0 },
          minutesPlayed: 300,
        },
      },
    });
    expect(learnedSubSkills(a, 'basketball')).toEqual([
      { rating: 'threePoint', points: 7 },
      { rating: 'passing', points: 3 },
    ]);
    expect(learnedSubSkills(a, 'soccer')).toEqual([]);
  });
});

describe('the derived rating the whole chain feeds', () => {
  it('turns learned sub-skill into rating points (`05` §3)', () => {
    let current = athlete({ primarySport: 'basketball', age: 22 });
    const before = deriveRatings(current, 'basketball', tables).threePoint as number;

    for (let match = 0; match < 30; match++) {
      current = applyPlay(current, 'basketball', {
        minutes: MATCH_MINUTES,
        actions: { threePoint: 12 },
        xp: 600,
      }).athlete;
    }

    const after = deriveRatings(current, 'basketball', tables).threePoint as number;
    expect(after).toBeGreaterThan(before);
    expect(current.sportSkills.basketball?.subSkills.threePoint).toBeGreaterThan(0);
  });
});
