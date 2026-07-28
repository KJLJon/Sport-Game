/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.5 — Sport skill XP: levels, sub-skills, event-driven awards, diminishing returns
 * @story   US-5.3 — Watch an athlete learn a new sport
 * @design  05-data-model.md §3.3
 *
 * Purpose: levels, the event→sub-skill mapping, and both kinds of diminishing return — the level
 * curve, and the within-session decay that stops one repeated action from being the fastest way
 * to a maxed sub-skill.
 */
import { describe, expect, it } from 'vitest';
import { EventKind, event, type SportEvent } from '../../../src/engine/match/events.ts';
import {
  applySession,
  applySessionTo,
  awardsForEvent,
  collectSession,
  cumulativeXpForLevel,
  emptySession,
  levelProgress,
  xpForLevel,
  xpFromMinutes,
} from '../../../src/athletes/xp.ts';
import { XP } from '../../../src/athletes/tuning.ts';
import { ATHLETE_BOUNDS, newSportSkill, type SportSkill } from '../../../src/athletes/types.ts';
import { BASKETBALL_XP_AWARDS } from '../../../src/sports/basketball/xp.ts';
import { BASKETBALL_WEIGHTS } from '../../../src/sports/basketball/weights.ts';
import { BasketballEvent } from '../../../src/sports/basketball/rules.ts';
import { athlete } from '../../helpers/athletes.ts';

function skill(overrides: Partial<SportSkill> = {}): SportSkill {
  return { ...newSportSkill(50), ...overrides };
}

function shot(zone: string, actor = 1): SportEvent {
  return event(EventKind.SHOT, 0, 0, { actor, detail: { zone } });
}

describe('the level curve (`05` §3.3)', () => {
  it('costs 100 to leave level 1 and grows as level^1.6', () => {
    expect(xpForLevel(1)).toBe(100);
    expect(xpForLevel(2)).toBeCloseTo(100 * 2 ** 1.6, 6);
    expect(xpForLevel(10)).toBeCloseTo(100 * 10 ** 1.6, 6);
  });

  it('is a diminishing return — the last level costs ~100× the first', () => {
    expect(xpForLevel(19) / xpForLevel(1)).toBeGreaterThan(50);
  });

  it('is infinite at the cap, so nothing can level past 20', () => {
    expect(xpForLevel(ATHLETE_BOUNDS.level.max)).toBe(Infinity);
  });

  it('never gets cheaper', () => {
    for (let level = 1; level < ATHLETE_BOUNDS.level.max - 1; level++) {
      expect(xpForLevel(level + 1)).toBeGreaterThan(xpForLevel(level));
    }
  });

  it('accumulates without ever including the infinite cap', () => {
    expect(cumulativeXpForLevel(1)).toBe(0);
    expect(cumulativeXpForLevel(3)).toBeCloseTo(xpForLevel(1) + xpForLevel(2), 6);
    expect(Number.isFinite(cumulativeXpForLevel(ATHLETE_BOUNDS.level.max))).toBe(true);
    expect(cumulativeXpForLevel(999)).toBe(cumulativeXpForLevel(ATHLETE_BOUNDS.level.max));
  });
});

describe('levelProgress', () => {
  it('reports how far into the current level the athlete is', () => {
    const progress = levelProgress(skill({ level: 2, xp: 100 }));
    expect(progress.level).toBe(2);
    expect(progress.levelCost).toBeCloseTo(xpForLevel(2), 6);
    expect(progress.fraction).toBeCloseTo(100 / xpForLevel(2), 6);
    expect(progress.atCap).toBe(false);
  });

  it('reads full at the cap rather than dividing by infinity', () => {
    const progress = levelProgress(skill({ level: 20, xp: 0 }));
    expect(progress.atCap).toBe(true);
    expect(progress.fraction).toBe(1);
  });

  it('survives a record that is out of range', () => {
    expect(levelProgress(skill({ level: 0, xp: -50 })).level).toBe(1);
    expect(levelProgress(skill({ level: 99, xp: 0 })).level).toBe(20);
    expect(levelProgress(skill({ level: 2, xp: -50 })).fraction).toBe(0);
  });
});

describe('xpFromMinutes', () => {
  it('pays for time on the field, and never for negative time', () => {
    expect(xpFromMinutes(10)).toBe(10 * XP.perMinute);
    expect(xpFromMinutes(0)).toBe(0);
    expect(xpFromMinutes(-10)).toBe(0);
  });
});

describe('awardsForEvent', () => {
  it('maps a three to three-point XP and a layup to finishing (`05` §3.3)', () => {
    expect(awardsForEvent(shot('cornerThree'), BASKETBALL_XP_AWARDS)).toEqual([
      { entity: 1, rating: 'threePoint', xp: 6 },
    ]);
    expect(awardsForEvent(shot('restricted'), BASKETBALL_XP_AWARDS)).toEqual([
      { entity: 1, rating: 'finishing', xp: 4 },
    ]);
  });

  it('pays an attempt less than a make, but not nothing', () => {
    const attempt = awardsForEvent(shot('midRange'), BASKETBALL_XP_AWARDS)[0]?.xp ?? 0;
    const make =
      awardsForEvent(event(EventKind.SCORE, 0, 0, { actor: 1, value: 2 }), BASKETBALL_XP_AWARDS)[0]
        ?.xp ?? 0;
    expect(attempt).toBeGreaterThan(0);
    expect(make).toBeGreaterThan(attempt);
  });

  it('pays the target as well as the actor when the rule says so', () => {
    const pass = event(EventKind.PASS, 0, 0, { actor: 1, target: 2 });
    expect(awardsForEvent(pass, BASKETBALL_XP_AWARDS)).toEqual([
      { entity: 1, rating: 'passing', xp: 3 },
      { entity: 2, rating: 'ballHandling', xp: 1 },
    ]);
  });

  it('matches a sport-specific event by its `sportKind`', () => {
    const steal = event(EventKind.SPORT, 0, 0, {
      actor: 4,
      sportKind: BasketballEvent.STEAL,
    });
    expect(awardsForEvent(steal, BASKETBALL_XP_AWARDS)).toEqual([
      { entity: 4, rating: 'perimeterD', xp: 7 },
    ]);
  });

  it('awards nothing for an event no rule matches, or one with no actor', () => {
    expect(awardsForEvent(event(EventKind.MATCH_START, 0, -1), BASKETBALL_XP_AWARDS)).toEqual([]);
    expect(awardsForEvent(shot('nowhere'), BASKETBALL_XP_AWARDS)).toEqual([]);
    expect(
      awardsForEvent(event(EventKind.REBOUND, 0, 0, { detail: {} }), BASKETBALL_XP_AWARDS),
    ).toEqual([]);
  });

  it("trains a heave's minutes but no sub-skill — flinging it is not a skill", () => {
    expect(awardsForEvent(shot('heave'), BASKETBALL_XP_AWARDS)).toEqual([{ entity: 1, xp: 1 }]);
  });

  it('names only sub-skills basketball actually derives', () => {
    for (const rule of BASKETBALL_XP_AWARDS) {
      if (rule.rating !== undefined) expect(BASKETBALL_WEIGHTS[rule.rating]).toBeDefined();
      if (rule.targetRating !== undefined) {
        expect(BASKETBALL_WEIGHTS[rule.targetRating]).toBeDefined();
      }
    }
  });
});

describe('collectSession', () => {
  const minutes = new Map([[1, 8]]);

  it('tallies actions and adds the minutes XP', () => {
    const session = collectSession(
      [shot('cornerThree'), shot('cornerThree'), shot('midRange')],
      BASKETBALL_XP_AWARDS,
      minutes,
    );
    const mine = session.get(1);
    expect(mine?.actions).toEqual({ threePoint: 2, midRange: 1 });
    expect(mine?.xp).toBeGreaterThan(xpFromMinutes(8));
    expect(mine?.minutes).toBe(8);
  });

  it('gives a bench athlete a session worth exactly nothing', () => {
    const session = collectSession([], BASKETBALL_XP_AWARDS, new Map([[9, 0]]));
    expect(session.get(9)).toEqual({ minutes: 0, actions: {}, xp: 0 });
  });

  it('still pays an athlete who did something without being on the minutes list', () => {
    const session = collectSession([shot('midRange', 7)], BASKETBALL_XP_AWARDS, new Map());
    expect(session.get(7)?.actions).toEqual({ midRange: 1 });
    expect(session.get(7)?.minutes).toBe(0);
  });

  it("decays repeated identical actions — forty threes is not forty threes' worth", () => {
    const forty = Array.from({ length: 40 }, () => shot('cornerThree'));
    const one = collectSession([shot('cornerThree')], BASKETBALL_XP_AWARDS, new Map()).get(1)?.xp;
    const many = collectSession(forty, BASKETBALL_XP_AWARDS, new Map()).get(1)?.xp;

    expect(many).toBeLessThan((one as number) * 40);
    expect(many).toBeGreaterThan(one as number);
  });

  it('does not decay a varied match the way it decays a farmed one', () => {
    const zones = ['cornerThree', 'midRange', 'restricted', 'freeThrow'];
    const varied = Array.from({ length: 40 }, (_, i) => shot(zones[i % zones.length] as string));
    const farmed = Array.from({ length: 40 }, () => shot('cornerThree'));

    const variedXp = collectSession(varied, BASKETBALL_XP_AWARDS, new Map()).get(1)?.xp as number;
    const farmedXp = collectSession(farmed, BASKETBALL_XP_AWARDS, new Map()).get(1)?.xp as number;
    expect(variedXp).toBeGreaterThan(farmedXp);
  });

  it("decays each athlete separately — one athlete's grind does not tax another's", () => {
    const events = [shot('cornerThree', 1), shot('cornerThree', 1), shot('cornerThree', 2)];
    const sessions = collectSession(events, BASKETBALL_XP_AWARDS, new Map());
    const first = collectSession([shot('cornerThree', 2)], BASKETBALL_XP_AWARDS, new Map()).get(2);
    expect(sessions.get(2)?.xp).toBe(first?.xp);
  });
});

describe('applySession', () => {
  it('banks XP without levelling when there is not enough', () => {
    const { skill: after, change } = applySession(skill({ level: 1, xp: 0 }), {
      minutes: 8,
      actions: { threePoint: 3 },
      xp: 50,
    });
    expect(after.level).toBe(1);
    expect(after.xp).toBe(50);
    expect(change.levelsGained).toBe(0);
    expect(change.subSkillsGained).toEqual({});
  });

  it('levels up and carries the remainder', () => {
    const { skill: after, change } = applySession(skill({ level: 1, xp: 0 }), {
      minutes: 8,
      actions: { threePoint: 5 },
      xp: 130,
    });
    expect(after.level).toBe(2);
    expect(after.xp).toBe(30);
    expect(change.levelsGained).toBe(1);
    expect(change.subSkillsGained).toEqual({ threePoint: XP.pointsPerLevel });
  });

  it('can level more than once from one big session', () => {
    const { change } = applySession(skill({ level: 1, xp: 0 }), {
      minutes: 100,
      actions: { passing: 4 },
      xp: xpForLevel(1) + xpForLevel(2) + xpForLevel(3),
    });
    expect(change.levelsGained).toBe(3);
  });

  it('spends points on what the athlete actually did, most-used first (`05` §3.3)', () => {
    const { change } = applySession(skill({ level: 1, xp: 0 }), {
      minutes: 8,
      actions: { rebounding: 9, threePoint: 1 },
      xp: xpForLevel(1),
    });
    expect(change.subSkillsGained).toEqual({ rebounding: 2 });
  });

  it('moves a point on when the most-used sub-skill is already maxed', () => {
    const { skill: after } = applySession(
      skill({ level: 1, xp: 0, subSkills: { rebounding: ATHLETE_BOUNDS.subSkill.max } }),
      { minutes: 8, actions: { rebounding: 9, passing: 2 }, xp: xpForLevel(1) },
    );
    expect(after.subSkills.rebounding).toBe(ATHLETE_BOUNDS.subSkill.max);
    expect(after.subSkills.passing).toBe(2);
  });

  it('reports points as wasted when everything trained is capped, rather than dropping them', () => {
    const { change } = applySession(
      skill({ level: 1, xp: 0, subSkills: { passing: ATHLETE_BOUNDS.subSkill.max } }),
      { minutes: 8, actions: { passing: 3 }, xp: xpForLevel(1) },
    );
    expect(change.pointsWasted).toBe(XP.pointsPerLevel);
    expect(change.subSkillsGained).toEqual({});
  });

  it('wastes the points of a level earned doing nothing in particular', () => {
    const { change } = applySession(skill({ level: 1, xp: 0 }), {
      minutes: 200,
      actions: {},
      xp: xpForLevel(1),
    });
    expect(change.levelsGained).toBe(1);
    expect(change.pointsWasted).toBe(XP.pointsPerLevel);
  });

  it('stops dead at level 20 however much XP arrives', () => {
    const { skill: after, change } = applySession(skill({ level: 20, xp: 0 }), {
      minutes: 500,
      actions: { passing: 10 },
      xp: 10_000_000,
    });
    expect(after.level).toBe(20);
    expect(after.xp).toBe(0);
    expect(change.levelsGained).toBe(0);
  });

  it('leaves `minutesPlayed` alone — familiarity owns it, and two owners double-count', () => {
    const before = skill({ minutesPlayed: 40 });
    expect(applySession(before, emptySession(8)).skill.minutesPlayed).toBe(40);
  });

  it("reads the athlete's record for a sport they have never played", () => {
    const { skill: after } = applySessionTo(athlete({ sportSkills: {} }), 'soccer', {
      minutes: 8,
      actions: {},
      xp: 10,
    });
    expect(after.level).toBe(1);
    expect(after.xp).toBe(10);
  });

  it('is a diminishing return end to end: the same session levels a novice, not a veteran', () => {
    const session = { minutes: 8, actions: { passing: 5 }, xp: 400 };
    expect(applySession(skill({ level: 1, xp: 0 }), session).change.levelsGained).toBeGreaterThan(
      applySession(skill({ level: 12, xp: 0 }), session).change.levelsGained,
    );
  });
});
