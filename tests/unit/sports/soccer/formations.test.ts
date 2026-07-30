/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.10 — Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase
 * @story   US-4.1 — Play an 11v11 soccer match
 * @design  06-game-design.md §3.2
 *
 * Purpose: that shape actually changes with the phase. A back four standing in the same place
 * whether the team is attacking or defending is a screensaver, so the phase drift is what most of
 * this pins — plus that every formation is eleven players and mirrors cleanly.
 */
import { describe, expect, it } from 'vitest';
import { CENTRE_X, PITCH } from '@/sports/soccer/pitch.ts';
import {
  DEFAULT_FORMATION,
  FORMATIONS,
  defensiveLineX,
  formation,
  phaseFor,
  roleSpot,
  shapeFor,
  soccerRoles,
  type PlayPhase,
} from '@/sports/soccer/formations.ts';

const PHASES: readonly PlayPhase[] = ['attacking', 'building', 'defending'];

describe('the formation data', () => {
  it('offers the three shapes 03 asks for', () => {
    expect(FORMATIONS.map((f) => f.id)).toEqual(['4-4-2', '4-3-3', '3-5-2']);
  });

  it('puts eleven players in every one, with a goalkeeper and unique roles', () => {
    for (const shape of FORMATIONS) {
      expect(shape.roles).toHaveLength(11);
      expect(shape.roles[0]?.id).toBe('gk');
      expect(new Set(shape.roles.map((r) => r.id)).size).toBe(11);
    }
  });

  it('keeps every authored position on the pitch', () => {
    for (const shape of FORMATIONS) {
      for (const role of shape.roles) {
        expect(role.x).toBeGreaterThanOrEqual(0);
        expect(role.x).toBeLessThanOrEqual(1);
        expect(role.y).toBeGreaterThanOrEqual(0);
        expect(role.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('falls back to the first shape for a name it does not know', () => {
    expect(formation('4-2-3-1').id).toBe('4-4-2');
    expect(formation(DEFAULT_FORMATION).id).toBe('4-4-2');
  });

  it('makes 4-3-3 the pressing shape and 3-5-2 the one with the busiest players', () => {
    const pressing = formation('4-3-3').aggression;
    expect(pressing).toBeGreaterThan(formation('4-4-2').aggression);

    const wingBack = formation('3-5-2').roles.find((r) => r.id === 'lwb');
    const everyone = FORMATIONS.flatMap((f) => f.roles);
    expect(wingBack?.push).toBe(Math.max(...everyone.map((r) => r.push)));
    expect(wingBack?.drop).toBe(Math.max(...everyone.map((r) => r.drop)));
  });

  it('exposes the roles through the seam RoleTable', () => {
    const table = soccerRoles();
    expect(table.roles).toHaveLength(11);
    expect(table.roles[0]).toMatchObject({ id: 'gk', name: 'Goalkeeper' });
    expect(soccerRoles('3-5-2').roles.map((r) => r.id)).toContain('lwb');
  });
});

describe('shape by phase', () => {
  it('pushes forward with the ball and drops without it', () => {
    const role = formation('4-4-2').roles.find((r) => r.id === 'lb');
    expect(role).toBeDefined();

    const attacking = roleSpot(role!, 'attacking', 0);
    const building = roleSpot(role!, 'building', 0);
    const defending = roleSpot(role!, 'defending', 0);

    expect(attacking.x).toBeGreaterThan(building.x);
    expect(defending.x).toBeLessThan(building.x);
  });

  it('tucks a wide player in when defending, and not otherwise', () => {
    const wing = formation('4-3-3').roles.find((r) => r.id === 'lw');
    const base = roleSpot(wing!, 'building', 0);
    const defending = roleSpot(wing!, 'defending', 0);
    // Started in the left channel, so tucking in means moving towards the centre.
    expect(defending.y).toBeGreaterThan(base.y);
    expect(roleSpot(wing!, 'attacking', 0).y).toBeCloseTo(base.y, 6);
  });

  it('tucks from whichever side of the centre the role starts on', () => {
    const right = formation('4-3-3').roles.find((r) => r.id === 'rw');
    const base = roleSpot(right!, 'building', 0);
    expect(roleSpot(right!, 'defending', 0).y).toBeLessThan(base.y);
  });

  it('is not a screensaver — every outfielder really shifts between phases', () => {
    for (const shape of FORMATIONS) {
      const attacking = shapeFor(shape.id, 'attacking', 0);
      const defending = shapeFor(shape.id, 'defending', 0);

      // Outfielders move several metres; the keeper barely moves, which is also correct.
      for (let i = 1; i < 11; i++) {
        const shift = Math.abs(
          (attacking[i] as { x: number }).x - (defending[i] as { x: number }).x,
        );
        expect(shift).toBeGreaterThan(5);
      }
      const keeperShift = Math.abs(
        (attacking[0] as { x: number }).x - (defending[0] as { x: number }).x,
      );
      expect(keeperShift).toBeLessThan(5);
    }
  });

  it('keeps everybody on the pitch in every phase, both ends', () => {
    for (const shape of FORMATIONS) {
      for (const phase of PHASES) {
        for (const side of [0, 1] as const) {
          for (const spot of shapeFor(shape.id, phase, side)) {
            expect(spot.x).toBeGreaterThanOrEqual(0);
            expect(spot.x).toBeLessThanOrEqual(PITCH.length);
            expect(spot.y).toBeGreaterThanOrEqual(0);
            expect(spot.y).toBeLessThanOrEqual(PITCH.width);
          }
        }
      }
    }
  });

  it('mirrors for the side attacking the other way', () => {
    for (const phase of PHASES) {
      const low = shapeFor('4-4-2', phase, 0);
      const high = shapeFor('4-4-2', phase, 1);
      low.forEach((spot, i) => {
        expect(PITCH.length - (high[i] as { x: number }).x).toBeCloseTo(spot.x, 6);
        expect((high[i] as { y: number }).y).toBeCloseTo(spot.y, 6);
      });
    }
  });
});

describe('the defensive line', () => {
  it('sits deeper when defending than when attacking', () => {
    expect(defensiveLineX('4-4-2', 'defending', 0)).toBeLessThan(
      defensiveLineX('4-4-2', 'attacking', 0),
    );
  });

  it('is higher for the more aggressive shape', () => {
    expect(defensiveLineX('4-3-3', 'attacking', 0)).toBeGreaterThan(
      defensiveLineX('4-4-2', 'attacking', 0),
    );
  });

  it('ignores the goalkeeper, who is not the line', () => {
    const line = defensiveLineX('4-4-2', 'building', 0);
    const keeper = shapeFor('4-4-2', 'building', 0)[0] as { x: number };
    expect(line).toBeGreaterThan(keeper.x);
  });

  it('mirrors at the other end', () => {
    expect(PITCH.length - defensiveLineX('4-4-2', 'defending', 1)).toBeCloseTo(
      defensiveLineX('4-4-2', 'defending', 0),
      6,
    );
  });
});

describe('reading the phase', () => {
  it('is defending whenever the other side has it', () => {
    expect(phaseFor(0, 1, 20)).toBe('defending');
    expect(phaseFor(0, 1, 90)).toBe('defending');
    expect(phaseFor(0, -1, 50)).toBe('defending');
  });

  it('is building with the ball in your own half, not attacking', () => {
    expect(phaseFor(0, 0, 20)).toBe('building');
    expect(phaseFor(1, 1, 90)).toBe('building');
  });

  it('is attacking with the ball in theirs', () => {
    expect(phaseFor(0, 0, 80)).toBe('attacking');
    expect(phaseFor(1, 1, 20)).toBe('attacking');
  });

  it('treats the halfway line as not yet attacking', () => {
    expect(phaseFor(0, 0, CENTRE_X)).toBe('building');
  });
});
