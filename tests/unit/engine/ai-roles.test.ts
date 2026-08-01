/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.2 — Role system: per-sport role tables driving off-ball movement and responsibility
 * @story   US-7.1 — Play against the computer
 * @design  06-game-design.md §5
 */
import { describe, expect, it } from 'vitest';
import {
  PLAY_PHASES,
  PlayPhase,
  RoleJob,
  dutyFor,
  dutySpot,
  duties,
  phaseFor,
  spaced,
  type RoleDuty,
} from '../../../src/engine/ai/roles.ts';
import { BASKETBALL_DUTIES } from '../../../src/sports/basketball/duties.ts';
import { lineOf, soccerDuties } from '../../../src/sports/soccer/duties.ts';
import { FORMATIONS, formation } from '../../../src/sports/soccer/formations.ts';

const FIELD = { width: 100, height: 50 };

const duty = (over: Partial<RoleDuty> = {}): RoleDuty => ({
  anchor: { x: 0.5, y: 0.5 },
  ballShade: 0.5,
  leash: 0.2,
  job: RoleJob.SUPPORT,
  urgency: 0.5,
  ...over,
});

describe('phaseFor', () => {
  const base = {
    side: 0 as const,
    possession: 0 as const,
    ballAdvance: 0.2,
    stepsSinceChange: 500,
    transitionSteps: 90,
  };

  it('is transition for a beat after the ball changes hands, whoever has it', () => {
    expect(phaseFor({ ...base, stepsSinceChange: 0 })).toBe(PlayPhase.TRANSITION);
    expect(phaseFor({ ...base, stepsSinceChange: 89, possession: 1 })).toBe(PlayPhase.TRANSITION);
    expect(phaseFor({ ...base, stepsSinceChange: 90 })).toBe(PlayPhase.BUILD_UP);
  });

  it('is defend whenever the other side has it', () => {
    expect(phaseFor({ ...base, possession: 1 })).toBe(PlayPhase.DEFEND);
    expect(phaseFor({ ...base, possession: -1 })).toBe(PlayPhase.DEFEND);
  });

  it('turns build-up into attack once the ball is up the pitch', () => {
    expect(phaseFor({ ...base, ballAdvance: 0.49 })).toBe(PlayPhase.BUILD_UP);
    expect(phaseFor({ ...base, ballAdvance: 0.51 })).toBe(PlayPhase.ATTACK);
    expect(phaseFor({ ...base, ballAdvance: 0.51, attackFrom: 0.7 })).toBe(PlayPhase.BUILD_UP);
  });

  it('answers for the other side too, from the same possession', () => {
    expect(phaseFor({ ...base, side: 1 })).toBe(PlayPhase.DEFEND);
    expect(phaseFor({ ...base, side: 1, possession: 1 })).toBe(PlayPhase.BUILD_UP);
  });
});

describe('dutySpot', () => {
  it('reads fractions from the end the side defends, so one table serves both', () => {
    const home = dutySpot(
      duty({ anchor: { x: 0.2, y: 0.25 }, ballShade: 0 }),
      { x: 0, y: 0 },
      FIELD,
      0,
    );
    const away = dutySpot(
      duty({ anchor: { x: 0.2, y: 0.25 }, ballShade: 0 }),
      { x: 0, y: 0 },
      FIELD,
      1,
    );
    expect(home).toEqual({ x: 20, y: 12.5 });
    expect(away).toEqual({ x: 80, y: 37.5 });
  });

  it('slides towards the ball by exactly the shade', () => {
    const spot = dutySpot(duty({ ballShade: 0.5, leash: 1 }), { x: 90, y: 10 }, FIELD, 0);
    expect(spot.x).toBeCloseTo(70, 6);
    expect(spot.y).toBeCloseTo(17.5, 6);
  });

  it('never lets the ball drag a role further than its leash', () => {
    const spot = dutySpot(duty({ ballShade: 1, leash: 0.1 }), { x: 100, y: 50 }, FIELD, 0);
    expect(spot.x).toBeCloseTo(60, 6);
    expect(spot.y).toBeCloseTo(30, 6);
  });

  it('ignores the ball entirely at zero shade', () => {
    const anchored = duty({ ballShade: 0 });
    expect(dutySpot(anchored, { x: 0, y: 0 }, FIELD, 0)).toEqual(
      dutySpot(anchored, { x: 100, y: 50 }, FIELD, 0),
    );
  });

  it('keeps a role on the field', () => {
    const spot = dutySpot(
      duty({ anchor: { x: 0.02, y: 0.02 }, leash: 0.5 }),
      { x: -40, y: -40 },
      FIELD,
      0,
    );
    expect(spot.x).toBeGreaterThanOrEqual(0);
    expect(spot.y).toBeGreaterThanOrEqual(0);
  });

  it('writes into a caller’s object, so the hot path allocates nothing', () => {
    const out = { x: 0, y: 0 };
    expect(dutySpot(duty(), { x: 10, y: 10 }, FIELD, 0, out)).toBe(out);
  });
});

describe('spaced', () => {
  it('pushes a target off a teammate standing on it', () => {
    const target = spaced({ x: 50, y: 25 }, [{ x: 52, y: 25 }], 5, FIELD);
    expect(target.x).toBeCloseTo(47, 6);
    expect(target.y).toBeCloseTo(25, 6);
  });

  it('leaves a target that is already clear alone', () => {
    expect(spaced({ x: 50, y: 25 }, [{ x: 70, y: 25 }], 5, FIELD)).toEqual({ x: 50, y: 25 });
  });

  it('is deterministic when two athletes are exactly on top of each other (INV-8)', () => {
    const once = spaced({ x: 50, y: 25 }, [{ x: 50, y: 25 }], 4, FIELD);
    const twice = spaced({ x: 50, y: 25 }, [{ x: 50, y: 25 }], 4, FIELD);
    expect(once).toEqual(twice);
  });

  it('does nothing when no gap is asked for', () => {
    expect(spaced({ x: 1, y: 1 }, [{ x: 1, y: 1 }], 0, FIELD)).toEqual({ x: 1, y: 1 });
  });
});

describe('duties()', () => {
  it('fills every phase from the base', () => {
    const built = duties(duty());
    expect(Object.keys(built).sort()).toEqual([...PLAY_PHASES].sort());
  });

  it('applies overrides per phase without touching the others', () => {
    const built = duties(duty(), { [PlayPhase.DEFEND]: { job: RoleJob.MARK } });
    expect(built[PlayPhase.DEFEND].job).toBe(RoleJob.MARK);
    expect(built[PlayPhase.ATTACK].job).toBe(RoleJob.SUPPORT);
  });
});

describe('the basketball table', () => {
  it('covers all five positions in all four phases', () => {
    expect(Object.keys(BASKETBALL_DUTIES).sort()).toEqual(['C', 'PF', 'PG', 'SF', 'SG']);
    for (const role of Object.keys(BASKETBALL_DUTIES)) {
      for (const phase of PLAY_PHASES) {
        expect(dutyFor(BASKETBALL_DUTIES, role, phase), `${role} in ${phase}`).toBeDefined();
      }
    }
  });

  it('gives the guards a longer leash than the big men', () => {
    const leash = (role: string, phase = PlayPhase.DEFEND) =>
      dutyFor(BASKETBALL_DUTIES, role, phase)!.leash;
    expect(leash('PG')).toBeGreaterThan(leash('C'));
    expect(leash('SG')).toBeGreaterThan(leash('PF'));
  });

  it('sends everyone the other way when the ball is lost', () => {
    for (const role of Object.keys(BASKETBALL_DUTIES)) {
      const attacking = dutyFor(BASKETBALL_DUTIES, role, PlayPhase.ATTACK)!;
      const defending = dutyFor(BASKETBALL_DUTIES, role, PlayPhase.DEFEND)!;
      expect(defending.anchor.x, role).toBeLessThan(attacking.anchor.x);
    }
  });

  it('leaves somebody at the back on a break and sends somebody forward', () => {
    const jobs = Object.entries(BASKETBALL_DUTIES).map(
      ([role, table]) => [role, table[PlayPhase.TRANSITION].job] as const,
    );
    expect(jobs.filter(([, job]) => job === RoleJob.COVER).length).toBeGreaterThan(0);
    expect(jobs.filter(([, job]) => job === RoleJob.RUN_BEHIND).length).toBeGreaterThan(0);
  });

  it('never asks anybody to stand off the court', () => {
    for (const table of Object.values(BASKETBALL_DUTIES)) {
      for (const phase of PLAY_PHASES) {
        const { anchor } = table[phase];
        expect(anchor.x).toBeGreaterThan(0);
        expect(anchor.x).toBeLessThan(1);
        expect(anchor.y).toBeGreaterThan(0);
        expect(anchor.y).toBeLessThan(1);
      }
    }
  });
});

describe('the soccer table', () => {
  it('derives duties for every role of every formation', () => {
    for (const shape of FORMATIONS) {
      const table = soccerDuties(shape.id);
      expect(Object.keys(table).sort()).toEqual(shape.roles.map((role) => role.id).sort());
      for (const role of shape.roles) {
        for (const phase of PLAY_PHASES) {
          expect(dutyFor(table, role.id, phase), `${shape.id} ${role.id} ${phase}`).toBeDefined();
        }
      }
    }
  });

  it('reads a role’s line off the pitch rather than off its name', () => {
    const shape = formation('4-3-3');
    const at = (id: string) => shape.roles.find((role) => role.id === id)!;
    expect(lineOf(at('gk'))).toBe('keeper');
    expect(lineOf(at('lcb'))).toBe('defence');
    expect(lineOf(at('lcm'))).toBe('midfield');
    expect(lineOf(at('cf'))).toBe('attack');
  });

  it('pushes up in attack and drops in defence, role by role', () => {
    const table = soccerDuties('4-3-3');
    for (const role of formation('4-3-3').roles) {
      const attack = table[role.id]![PlayPhase.ATTACK];
      const defend = table[role.id]![PlayPhase.DEFEND];
      expect(attack.anchor.x, role.id).toBeGreaterThanOrEqual(defend.anchor.x);
    }
  });

  it('narrows the block towards the middle when defending', () => {
    const table = soccerDuties('4-4-2');
    const wide = formation('4-4-2').roles.filter((role) => role.y < 0.2 || role.y > 0.8);
    expect(wide.length).toBeGreaterThan(0);
    for (const role of wide) {
      const defending = table[role.id]![PlayPhase.DEFEND].anchor.y;
      expect(Math.abs(defending - 0.5), role.id).toBeLessThan(Math.abs(role.y - 0.5));
    }
  });

  it('lets the shape stretch in transition and nowhere else', () => {
    const table = soccerDuties();
    for (const role of Object.keys(table)) {
      const transition = table[role]![PlayPhase.TRANSITION].leash;
      expect(transition).toBeGreaterThan(table[role]![PlayPhase.DEFEND].leash);
    }
  });

  it('has the forwards press and the back line mark', () => {
    const table = soccerDuties('4-3-3');
    expect(table['cf']![PlayPhase.DEFEND].job).toBe(RoleJob.PRESS);
    expect(table['lcb']![PlayPhase.DEFEND].job).toBe(RoleJob.MARK);
    expect(table['gk']![PlayPhase.DEFEND].job).toBe(RoleJob.COVER);
  });
});
