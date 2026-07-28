/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.13 — Stamina, injury, suspension, availability
 * @story   US-6.3 — See fatigue and availability
 * @design  05-data-model.md §2 (condition)
 *
 * Purpose: US-6.3's three promises, asserted rather than assumed — stamina drains and recovers,
 * a fresh athlete is degraded by nothing at all, and injuries and suspensions block selection for
 * the stated duration and then stop.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/engine/rng.ts';
import {
  afterMatch,
  afterRest,
  availability,
  fatigueMultiplier,
  rollInjury,
  staminaBand,
  staminaDrain,
  staminaRecovery,
  withInjury,
  withSuspension,
} from '../../../src/athletes/condition.ts';
import { CONDITION } from '../../../src/athletes/tuning.ts';
import { athlete, attributes } from '../../helpers/athletes.ts';

const NOW = Date.UTC(2026, 6, 28);
const DAY = CONDITION.dayMs;
/** A starter's real minutes in one match (`06` §3.1's 4× compression on 32 game minutes). */
const MATCH_MINUTES = 8;

describe('availability', () => {
  it('lets a healthy athlete play', () => {
    const state = availability(athlete(), NOW);
    expect(state).toMatchObject({ available: true, reason: null, label: 'Available' });
  });

  it('blocks an injured athlete and says when they are back', () => {
    const hurt = athlete({ condition: { stamina: 100, injuredUntil: NOW + 5 * DAY } });
    const state = availability(hurt, NOW);
    expect(state.available).toBe(false);
    expect(state.reason).toBe('injured');
    expect(state.label).toBe('Injured — back in 5 days');
  });

  it('says "tomorrow" rather than "in 1 days"', () => {
    const hurt = athlete({ condition: { stamina: 100, injuredUntil: NOW + DAY / 2 } });
    expect(availability(hurt, NOW).label).toBe('Injured — back tomorrow');
  });

  it('clears an injury the moment it lapses', () => {
    const hurt = athlete({ condition: { stamina: 100, injuredUntil: NOW } });
    expect(availability(hurt, NOW).available).toBe(true);
  });

  it('blocks a suspended athlete and counts in matches, not days', () => {
    const banned = athlete({ condition: { stamina: 100, suspendedGames: 3 } });
    const state = availability(banned, NOW);
    expect(state.reason).toBe('suspended');
    expect(state.label).toBe('Suspended — 3 matches left');
    expect(state.remaining).toBe(3);
  });

  it('says "one match left" rather than "1 matches left"', () => {
    const banned = athlete({ condition: { stamina: 100, suspendedGames: 1 } });
    expect(availability(banned, NOW).label).toBe('Suspended — one match left');
  });

  it('reports the injury when both apply, because a suspension count would be a lie', () => {
    const both = athlete({
      condition: { stamina: 100, injuredUntil: NOW + 9 * DAY, suspendedGames: 2 },
    });
    expect(availability(both, NOW).reason).toBe('injured');
  });
});

describe('fatigueMultiplier', () => {
  it('costs a fresh athlete precisely nothing', () => {
    expect(fatigueMultiplier(100)).toBe(1);
    expect(fatigueMultiplier(CONDITION.fatigueFrom)).toBe(1);
  });

  it('degrades below the threshold, to a floor rather than to nothing', () => {
    expect(fatigueMultiplier(30)).toBeLessThan(1);
    expect(fatigueMultiplier(0)).toBeCloseTo(CONDITION.fatigueFloor, 10);
    expect(fatigueMultiplier(0)).toBeGreaterThan(0.5);
  });

  it('never rises as stamina falls', () => {
    for (let s = 0; s < 100; s++) {
      expect(fatigueMultiplier(s + 1)).toBeGreaterThanOrEqual(fatigueMultiplier(s));
    }
  });

  it('clamps outside 0–100', () => {
    expect(fatigueMultiplier(-50)).toBe(fatigueMultiplier(0));
    expect(fatigueMultiplier(400)).toBe(1);
  });
});

describe('staminaBand', () => {
  it('gives every level a word, so the bar is never colour alone (`10` §11)', () => {
    expect(staminaBand(100)).toBe('fresh');
    expect(staminaBand(60)).toBe('working');
    expect(staminaBand(30)).toBe('tiring');
    expect(staminaBand(5)).toBe('spent');
  });
});

describe('staminaDrain', () => {
  it('costs more the longer they play', () => {
    const short = staminaDrain({ minutes: 4, enduranceAttribute: 50 });
    const long = staminaDrain({ minutes: 8, enduranceAttribute: 50 });
    expect(long).toBeCloseTo(short * 2, 10);
  });

  it('is why `stamina` is one of the eleven — endurance roughly halves the cost', () => {
    const weak = staminaDrain({ minutes: MATCH_MINUTES, enduranceAttribute: 20 });
    const strong = staminaDrain({ minutes: MATCH_MINUTES, enduranceAttribute: 95 });
    expect(strong).toBeLessThan(weak);
    expect(strong / weak).toBeLessThan(0.8);
    expect(strong / weak).toBeGreaterThan(0.4);
  });

  it('scales with intensity, which modes hand in rather than this file knowing', () => {
    const base = staminaDrain({ minutes: 8, enduranceAttribute: 50 });
    expect(staminaDrain({ minutes: 8, enduranceAttribute: 50, intensity: 2 })).toBeCloseTo(
      base * 2,
      10,
    );
    expect(staminaDrain({ minutes: 8, enduranceAttribute: 50, intensity: 0 })).toBe(0);
  });

  it('is zero for zero or negative minutes', () => {
    expect(staminaDrain({ minutes: 0, enduranceAttribute: 50 })).toBe(0);
    expect(staminaDrain({ minutes: -30, enduranceAttribute: 50 })).toBe(0);
  });

  it('leaves a typical starter tired but not spent after one match', () => {
    // The tuning target: a match should cost enough to make substitutions a decision, and not so
    // much that a starter is unusable by the fourth quarter.
    const drain = staminaDrain({ minutes: MATCH_MINUTES, enduranceAttribute: 55 });
    expect(100 - drain).toBeGreaterThan(70);
    expect(100 - drain).toBeLessThan(90);
  });
});

describe('staminaRecovery', () => {
  it('recovers more from more rest', () => {
    const one = staminaRecovery({ matchesRested: 1, enduranceAttribute: 50, age: 25 });
    expect(staminaRecovery({ matchesRested: 3, enduranceAttribute: 50, age: 25 })).toBeCloseTo(
      one * 3,
      10,
    );
  });

  it("outpaces a match's drain, so a squad is not a treadmill", () => {
    const drain = staminaDrain({ minutes: MATCH_MINUTES, enduranceAttribute: 50 });
    expect(staminaRecovery({ matchesRested: 1, enduranceAttribute: 50, age: 25 })).toBeGreaterThan(
      drain,
    );
  });

  it('slows with age, but not below the floor', () => {
    const young = staminaRecovery({ matchesRested: 1, enduranceAttribute: 50, age: 24 });
    const old = staminaRecovery({ matchesRested: 1, enduranceAttribute: 50, age: 38 });
    expect(old).toBeLessThan(young);
    expect(old / young).toBeGreaterThanOrEqual(CONDITION.recoveryAgeFloor - 1e-9);
  });

  it('is zero for no rest', () => {
    expect(staminaRecovery({ matchesRested: 0, enduranceAttribute: 50, age: 25 })).toBe(0);
  });
});

describe('afterMatch', () => {
  it('drains a player who played and leaves a bench player fresh', () => {
    const starter = athlete({ condition: { stamina: 100 } });
    expect(afterMatch(starter, { minutes: MATCH_MINUTES, played: true }).stamina).toBeLessThan(100);
    expect(afterMatch(starter, { minutes: MATCH_MINUTES, played: false }).stamina).toBe(100);
  });

  it('never drains below zero', () => {
    const spent = athlete({ condition: { stamina: 2 } });
    expect(afterMatch(spent, { minutes: 90, played: true }).stamina).toBe(0);
  });

  it('serves a suspension whether or not the athlete could have played', () => {
    // A suspension is served by the team's match going ahead — otherwise it is a benching.
    const banned = athlete({ condition: { stamina: 100, suspendedGames: 2 } });
    expect(afterMatch(banned, { minutes: 0, played: false }).suspendedGames).toBe(1);

    const last = athlete({ condition: { stamina: 100, suspendedGames: 1 } });
    expect(afterMatch(last, { minutes: 0, played: false }).suspendedGames).toBe(0);
  });

  it('leaves an unsuspended athlete without a suspension field', () => {
    const clean = afterMatch(athlete({ condition: { stamina: 100 } }), {
      minutes: 8,
      played: true,
    });
    expect(clean.suspendedGames).toBeUndefined();
  });

  it('makes a tired athlete measurably worse in the sim (US-6.3)', () => {
    let current = athlete({ condition: { stamina: 100 }, attributes: attributes(40) });
    for (let match = 0; match < 4; match++) {
      current = { ...current, condition: afterMatch(current, { minutes: 12, played: true }) };
    }
    expect(current.condition.stamina).toBeLessThan(CONDITION.fatigueFrom);
    expect(fatigueMultiplier(current.condition.stamina)).toBeLessThan(1);
  });
});

describe('afterRest', () => {
  it('recovers stamina without exceeding full', () => {
    const tired = athlete({ condition: { stamina: 40 } });
    expect(afterRest(tired, 1, NOW).stamina).toBeGreaterThan(40);
    expect(afterRest(tired, 20, NOW).stamina).toBe(100);
  });

  it('clears a lapsed injury from the record rather than leaving a stale date', () => {
    const healed = athlete({ condition: { stamina: 50, injuredUntil: NOW - DAY } });
    expect(afterRest(healed, 1, NOW).injuredUntil).toBeUndefined();
  });

  it('keeps an injury that has not lapsed', () => {
    const hurt = athlete({ condition: { stamina: 50, injuredUntil: NOW + 3 * DAY } });
    expect(afterRest(hurt, 1, NOW).injuredUntil).toBe(NOW + 3 * DAY);
  });
});

describe('rollInjury', () => {
  it('is seeded and reproducible (INV-2)', () => {
    const options = { stamina: 50, severity: 1, now: NOW };
    expect(rollInjury(createRng('hit'), options)).toEqual(rollInjury(createRng('hit'), options));
  });

  it('is rare — squad admin is not the game', () => {
    const rng = createRng('season');
    let injuries = 0;
    for (let contact = 0; contact < 1_000; contact++) {
      if (rollInjury(rng, { stamina: 80, severity: 1, now: NOW }) !== null) injuries++;
    }
    expect(injuries).toBeGreaterThan(0);
    expect(injuries).toBeLessThan(60);
  });

  it('is likelier when tired, which is what makes a substitution a real decision', () => {
    const count = (stamina: number): number => {
      const rng = createRng(`tired-${stamina}`);
      let hits = 0;
      for (let i = 0; i < 4_000; i++) {
        if (rollInjury(rng, { stamina, severity: 1, now: NOW }) !== null) hits++;
      }
      return hits;
    };
    expect(count(5)).toBeGreaterThan(count(100));
  });

  it('never happens without contact', () => {
    const rng = createRng('nothing');
    for (let i = 0; i < 200; i++) {
      expect(rollInjury(rng, { stamina: 10, severity: 0, now: NOW })).toBeNull();
    }
  });

  it('lasts a stated number of days, inside the tuned range', () => {
    const rng = createRng('durations');
    for (let i = 0; i < 500; i++) {
      const injury = rollInjury(rng, { stamina: 5, severity: 8, now: NOW });
      if (injury === null) continue;
      expect(injury.days).toBeGreaterThanOrEqual(CONDITION.injuryDays.min);
      expect(injury.days).toBeLessThanOrEqual(CONDITION.injuryDays.max);
      expect(injury.until).toBe(NOW + injury.days * DAY);
    }
  });
});

describe('applying injuries and suspensions', () => {
  it('never shortens an injury already running', () => {
    const long = { stamina: 50, injuredUntil: NOW + 10 * DAY };
    expect(withInjury(long, { until: NOW + 2 * DAY, days: 2 }).injuredUntil).toBe(NOW + 10 * DAY);
    expect(withInjury(long, { until: NOW + 20 * DAY, days: 20 }).injuredUntil).toBe(NOW + 20 * DAY);
  });

  it('accumulates suspensions — two red cards is not one suspension', () => {
    let condition = withSuspension({ stamina: 100 }, 2);
    expect(condition.suspendedGames).toBe(2);
    condition = withSuspension(condition, 3);
    expect(condition.suspendedGames).toBe(5);
  });

  it('ignores a negative suspension rather than crediting matches back', () => {
    expect(withSuspension({ stamina: 100, suspendedGames: 2 }, -5).suspendedGames).toBe(2);
  });
});
