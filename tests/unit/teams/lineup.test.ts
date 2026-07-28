/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.12 — Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best
 * @story   US-6.2 — Set a lineup
 * @design  05-data-model.md §3.4 (overall and position fit)
 *
 * Purpose: auto-fill is an assignment problem, and the naive answer is biased toward whichever
 * position happens to be first in the table — the same shape of bug as tie-breaking in entity-id
 * order. That property is what this file is mostly for.
 */
import { describe, expect, it } from 'vitest';
import {
  assess,
  assessSquad,
  autoFill,
  lineupStatus,
  lineupStrength,
  place,
  type LineupSlot,
} from '../../../src/teams/lineup.ts';
import { newSquad, type Squad } from '../../../src/teams/types.ts';
import {
  BASKETBALL_PHYSICAL,
  BASKETBALL_POSITION_WEIGHTS,
  BASKETBALL_WEIGHTS,
} from '../../../src/sports/basketball/weights.ts';
import { athlete, attributes } from '../../helpers/athletes.ts';
import type { Athlete } from '../../../src/athletes/types.ts';

const NOW = Date.UTC(2026, 6, 28);
const DAY = 24 * 60 * 60 * 1000;

const tables = {
  weights: BASKETBALL_WEIGHTS,
  physicalModifiers: BASKETBALL_PHYSICAL,
  positionWeights: BASKETBALL_POSITION_WEIGHTS,
};

const SLOTS: LineupSlot[] = [
  { id: 'PG', name: 'Point Guard', x: 0.34, y: 0.5 },
  { id: 'SG', name: 'Shooting Guard', x: 0.28, y: 0.2 },
  { id: 'SF', name: 'Small Forward', x: 0.28, y: 0.8 },
  { id: 'PF', name: 'Power Forward', x: 0.17, y: 0.34 },
  { id: 'C', name: 'Centre', x: 0.14, y: 0.55 },
];

const guard = (id: string): Athlete =>
  athlete({
    id,
    heightCm: 183,
    attributes: attributes(45, {
      coordination: 92,
      accuracy: 88,
      awareness: 88,
      agility: 90,
      speed: 86,
      acceleration: 86,
    }),
  });

const big = (id: string): Athlete =>
  athlete({
    id,
    heightCm: 214,
    weightKg: 118,
    attributes: attributes(45, { strength: 94, vertical: 92, awareness: 72 }),
  });

function roster(list: readonly Athlete[]): Map<string, Athlete> {
  return new Map(list.map((a) => [a.id, a]));
}

describe('assess', () => {
  it('judges an athlete by the slot they are in, not by their best', () => {
    const centre = big('c1');
    const atCentre = assess(centre, 'basketball', 'C', tables);
    const atPoint = assess(centre, 'basketball', 'PG', tables);

    expect(atCentre.rating).toBeGreaterThan(atPoint.rating);
    expect(atCentre.fit).toBe(1);
    expect(atPoint.fit).toBeLessThan(1);
  });

  it('warns below the threshold and never above it (`05` §3.4)', () => {
    expect(assess(big('c1'), 'basketball', 'PG', tables).warn).toBe(true);
    expect(assess(big('c1'), 'basketball', 'C', tables).warn).toBe(false);
  });

  it('has no opinion where the sport declares no weights for a slot', () => {
    const result = assess(guard('g1'), 'basketball', 'SWEEPER', tables);
    expect(result.fit).toBe(1);
    expect(result.warn).toBe(false);
  });

  it('does not divide by zero for an athlete with nothing at all', () => {
    const empty = athlete({ attributes: attributes(1), heightCm: 150 });
    expect(assess(empty, 'basketball', 'PG', tables).fit).toBeGreaterThan(0);
  });
});

describe('autoFill', () => {
  it('sends the big to the paint and the guard to the perimeter', () => {
    const { starters } = autoFill({
      slots: SLOTS,
      candidates: [guard('g1'), guard('g2'), guard('g3'), big('b1'), big('b2')],
      sport: 'basketball',
      tables,
      now: NOW,
    });

    expect(starters.C).toMatch(/^b/);
    expect(starters.PG).toMatch(/^g/);
  });

  it('fills every slot when there are enough athletes', () => {
    const { starters } = autoFill({
      slots: SLOTS,
      candidates: [guard('g1'), guard('g2'), guard('g3'), big('b1'), big('b2')],
      sport: 'basketball',
      tables,
      now: NOW,
    });
    expect(Object.keys(starters).sort()).toEqual(['C', 'PF', 'PG', 'SF', 'SG']);
  });

  it('never names the same athlete twice', () => {
    const { starters, bench } = autoFill({
      slots: SLOTS,
      candidates: Array.from({ length: 9 }, (_, i) =>
        i % 2 === 0 ? guard(`g${i}`) : big(`b${i}`),
      ),
      sport: 'basketball',
      tables,
      now: NOW,
    });
    const named = [...Object.values(starters), ...bench];
    expect(new Set(named).size).toBe(named.length);
  });

  it('does not favour whichever position happens to be first in the table', () => {
    // The naive "walk the slots and give each its best remaining athlete" makes PG outrank every
    // other position. Reversing the slot order must not change the assignment.
    const candidates = [guard('g1'), guard('g2'), guard('g3'), big('b1'), big('b2')];
    const forwards = autoFill({ slots: SLOTS, candidates, sport: 'basketball', tables, now: NOW });
    const backwards = autoFill({
      slots: [...SLOTS].reverse(),
      candidates,
      sport: 'basketball',
      tables,
      now: NOW,
    });
    expect(backwards.starters).toEqual(forwards.starters);
  });

  it('does not depend on the order the candidates arrive in', () => {
    const candidates = [guard('g1'), guard('g2'), guard('g3'), big('b1'), big('b2')];
    const forwards = autoFill({ slots: SLOTS, candidates, sport: 'basketball', tables, now: NOW });
    const shuffled = autoFill({
      slots: SLOTS,
      candidates: [...candidates].reverse(),
      sport: 'basketball',
      tables,
      now: NOW,
    });
    expect(shuffled.starters).toEqual(forwards.starters);
  });

  it('skips injured and suspended athletes by default (US-6.3)', () => {
    const hurt = { ...big('b1'), condition: { stamina: 100, injuredUntil: NOW + 3 * DAY } };
    const banned = { ...big('b2'), condition: { stamina: 100, suspendedGames: 2 } };
    const { starters, bench } = autoFill({
      slots: SLOTS,
      candidates: [guard('g1'), guard('g2'), guard('g3'), guard('g4'), guard('g5'), hurt, banned],
      sport: 'basketball',
      tables,
      now: NOW,
    });

    const named = [...Object.values(starters), ...bench];
    expect(named).not.toContain('b1');
    expect(named).not.toContain('b2');
  });

  it('can be told to ignore availability, for a preview of a full-strength side', () => {
    const hurt = { ...big('b1'), condition: { stamina: 100, injuredUntil: NOW + 3 * DAY } };
    const { starters } = autoFill({
      slots: SLOTS,
      candidates: [guard('g1'), guard('g2'), guard('g3'), guard('g4'), hurt],
      sport: 'basketball',
      tables,
      now: NOW,
      skipUnavailable: false,
    });
    expect(Object.values(starters)).toContain('b1');
  });

  it('leaves slots empty rather than inventing athletes for them', () => {
    const { starters } = autoFill({
      slots: SLOTS,
      candidates: [guard('g1'), big('b1')],
      sport: 'basketball',
      tables,
      now: NOW,
    });
    expect(Object.keys(starters)).toHaveLength(2);
  });

  it('benches the best of the rest, honouring the bench size', () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      guard(`g${String(i).padStart(2, '0')}`),
    );
    const { bench } = autoFill({
      slots: SLOTS,
      candidates,
      sport: 'basketball',
      tables,
      now: NOW,
      benchSize: 3,
    });
    expect(bench).toHaveLength(3);
  });

  it('copes with nobody at all', () => {
    const result = autoFill({
      slots: SLOTS,
      candidates: [],
      sport: 'basketball',
      tables,
      now: NOW,
    });
    expect(result).toEqual({ starters: {}, bench: [] });
  });
});

describe('assessSquad and lineupStrength', () => {
  const squad = (): Squad => ({
    ...newSquad('t1', 'basketball', NOW),
    starters: { PG: 'g1', SG: 'g2', SF: 'g3', PF: 'b1', C: 'b2' },
  });

  const people = roster([guard('g1'), guard('g2'), guard('g3'), big('b1'), big('b2')]);

  it('describes every slot, filled or not', () => {
    const assessments = assessSquad({
      squad: { ...squad(), starters: { PG: 'g1' } },
      slots: SLOTS,
      roster: people,
      sport: 'basketball',
      tables,
      now: NOW,
    });

    expect(assessments).toHaveLength(5);
    expect(assessments[0]?.athlete?.id).toBe('g1');
    expect(assessments[1]?.athlete).toBeNull();
    expect(assessments[1]?.rating).toBe(0);
  });

  it('treats a slot pointing at a deleted athlete as empty', () => {
    const assessments = assessSquad({
      squad: { ...squad(), starters: { PG: 'ghost' } },
      slots: SLOTS,
      roster: people,
      sport: 'basketball',
      tables,
      now: NOW,
    });
    expect(assessments[0]?.athlete).toBeNull();
  });

  it('flags an athlete who cannot play, in words (US-6.3)', () => {
    const hurt = new Map(people);
    hurt.set('g1', { ...guard('g1'), condition: { stamina: 100, injuredUntil: NOW + 2 * DAY } });

    const assessments = assessSquad({
      squad: squad(),
      slots: SLOTS,
      roster: hurt,
      sport: 'basketball',
      tables,
      now: NOW,
    });
    expect(assessments[0]?.unavailable).toContain('Injured');
  });

  it('averages the filled slots, counting empty ones as zero', () => {
    const full = assessSquad({
      squad: squad(),
      slots: SLOTS,
      roster: people,
      sport: 'basketball',
      tables,
      now: NOW,
    });
    const partial = assessSquad({
      squad: { ...squad(), starters: { PG: 'g1' } },
      slots: SLOTS,
      roster: people,
      sport: 'basketball',
      tables,
      now: NOW,
    });

    expect(lineupStrength(full)).toBeGreaterThan(lineupStrength(partial));
    expect(lineupStrength([])).toBe(0);
  });
});

describe('place', () => {
  const base = (): Squad => ({
    ...newSquad('t1', 'basketball', NOW),
    starters: { PG: 'g1', SG: 'g2' },
    bench: ['g3'],
  });

  it('puts an athlete into an empty slot and takes them off the bench', () => {
    const result = place(base(), 'SF', 'g3', NOW + 1);
    expect(result.starters.SF).toBe('g3');
    expect(result.bench).not.toContain('g3');
    expect(result.updatedAt).toBe(NOW + 1);
  });

  it('swaps two occupied slots rather than cloning an athlete', () => {
    const result = place(base(), 'SG', 'g1', NOW);
    expect(result.starters.SG).toBe('g1');
    expect(result.starters.PG).toBe('g2');
    expect(Object.values(result.starters).filter((id) => id === 'g1')).toHaveLength(1);
  });

  it('vacates the old slot when moving into an empty one', () => {
    const result = place(base(), 'C', 'g1', NOW);
    expect(result.starters.C).toBe('g1');
    expect(result.starters.PG).toBeUndefined();
  });

  it('clears a slot', () => {
    const result = place(base(), 'PG', null, NOW);
    expect(result.starters.PG).toBeUndefined();
    expect(result.starters.SG).toBe('g2');
  });
});

describe('lineupStatus', () => {
  const people = roster([guard('g1'), guard('g2'), guard('g3'), big('b1'), big('b2')]);
  const full: Squad = {
    ...newSquad('t1', 'basketball', NOW),
    starters: { PG: 'g1', SG: 'g2', SF: 'g3', PF: 'b1', C: 'b2' },
  };

  const assessFor = (squad: Squad, at = people) =>
    assessSquad({ squad, slots: SLOTS, roster: at, sport: 'basketball', tables, now: NOW });

  it('counts empty slots, singular and plural', () => {
    const one = { ...full, starters: { ...full.starters, C: '' } };
    expect(lineupStatus(assessFor(one), one, 5).message).toBe('One slot still empty');

    const three = { ...full, starters: { PG: 'g1', SG: 'g2' } };
    expect(lineupStatus(assessFor(three), three, 5).message).toBe('3 slots still empty');
  });

  it('names anyone who cannot play', () => {
    const hurt = new Map(people);
    hurt.set('b2', {
      ...big('b2'),
      displayName: 'Blocked',
      condition: { stamina: 100, suspendedGames: 1 },
    });
    const status = lineupStatus(assessFor(full, hurt), full, 5);
    expect(status.ready).toBe(false);
    expect(status.message).toContain('Blocked');
  });

  it('refuses a lineup naming somebody twice', () => {
    const doubled = { ...full, starters: { ...full.starters, C: 'g1' } };
    const status = lineupStatus(assessFor(doubled), doubled, 5);
    expect(status.ready).toBe(false);
    expect(status.message).toContain('named twice');
  });

  it('is ready but warns when someone is out of position — never blocks (`05` §3.4)', () => {
    const misplaced: Squad = {
      ...full,
      starters: { PG: 'b1', SG: 'g2', SF: 'g3', PF: 'g1', C: 'b2' },
    };
    const status = lineupStatus(assessFor(misplaced), misplaced, 5);
    expect(status.ready).toBe(true);
    expect(status.message).toContain('out of position');
  });

  it('says plainly when everything is right', () => {
    const best = autoFill({
      slots: SLOTS,
      candidates: [...people.values()],
      sport: 'basketball',
      tables,
      now: NOW,
    });
    const squad: Squad = { ...full, starters: best.starters };
    expect(lineupStatus(assessFor(squad), squad, 5)).toEqual({
      ready: true,
      message: 'Ready to play',
    });
  });
});
