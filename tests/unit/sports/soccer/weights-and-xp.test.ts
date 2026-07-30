/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.13 — Soccer derivation weights, sub-skills, familiarity tuning
 * @story   US-5.2 — Play any athlete in any sport
 * @story   US-5.3 — Watch an athlete learn a new sport
 * @design  05-data-model.md §3.2 (soccer weights), §3.3 (XP), §3.4 (position weights)
 *
 * Purpose: the two ways a weight table goes wrong silently. A row that does not sum to 1.0 puts the
 * rating off the 1–99 scale without anything failing, and a rating *name* that does not exist trains
 * a sub-skill derivation never reads — both are typos that produce a plausible-looking game.
 */
import { describe, expect, it } from 'vitest';
import { FORMATIONS } from '@/sports/soccer/formations.ts';
import {
  SOCCER_DEFAULT_POSITION,
  SOCCER_PHYSICAL,
  SOCCER_POSITION_WEIGHTS,
  SOCCER_WEIGHTS,
} from '@/sports/soccer/weights.ts';
import { SOCCER_XP_AWARDS } from '@/sports/soccer/xp.ts';
import { soccer } from '@/sports/soccer/index.ts';

const RATINGS = Object.keys(SOCCER_WEIGHTS);

describe('the derived rating table', () => {
  it('has every row summing to 1.0', () => {
    for (const [rating, row] of Object.entries(SOCCER_WEIGHTS)) {
      const total = Object.values(row).reduce((sum, value) => sum + value, 0);
      expect(total, `${rating} weights`).toBeCloseTo(1, 6);
    }
  });

  it('gives soccer the twelve ratings 05 §3.2 names', () => {
    expect(RATINGS).toHaveLength(12);
    expect(RATINGS).toContain('goalkeeping');
    expect(RATINGS).toContain('crossing');
    expect(RATINGS).toContain('offBall');
  });

  it('only modifies ratings that exist', () => {
    for (const rating of Object.keys(SOCCER_PHYSICAL.heightCm?.perUnit ?? {})) {
      expect(RATINGS).toContain(rating);
    }
  });
});

describe('the position table', () => {
  it('has every row summing to 1.0', () => {
    for (const [position, row] of Object.entries(SOCCER_POSITION_WEIGHTS)) {
      const total = Object.values(row).reduce((sum, value) => sum + value, 0);
      expect(total, `${position} weights`).toBeCloseTo(1, 6);
    }
  });

  it('only weights ratings that exist', () => {
    for (const [position, row] of Object.entries(SOCCER_POSITION_WEIGHTS)) {
      for (const rating of Object.keys(row)) {
        expect(RATINGS, `${position} → ${rating}`).toContain(rating);
      }
    }
  });

  it('covers every role in every formation', () => {
    for (const shape of FORMATIONS) {
      for (const role of shape.roles) {
        expect(SOCCER_POSITION_WEIGHTS[role.id], `${shape.id} → ${role.id}`).toBeDefined();
      }
    }
  });

  it('makes a keeper mostly goalkeeping, so playing one out of position is visibly a choice', () => {
    const gk = SOCCER_POSITION_WEIGHTS['gk'] ?? {};
    expect(gk['goalkeeping']).toBeGreaterThan(0.5);
    // And nobody else is weighted on it at all.
    for (const [position, row] of Object.entries(SOCCER_POSITION_WEIGHTS)) {
      if (position === 'gk') continue;
      expect(row['goalkeeping'] ?? 0, position).toBe(0);
    }
  });

  it('names a fallback row that exists', () => {
    expect(SOCCER_POSITION_WEIGHTS[SOCCER_DEFAULT_POSITION]).toBeDefined();
  });

  it('weights a striker on finishing and a centre back on defending', () => {
    const striker = SOCCER_POSITION_WEIGHTS['ls'] ?? {};
    const back = SOCCER_POSITION_WEIGHTS['cb'] ?? {};
    expect(striker['finishing'] ?? 0).toBeGreaterThan(back['finishing'] ?? 0);
    expect(back['tackling'] ?? 0).toBeGreaterThan(striker['tackling'] ?? 0);
  });
});

describe('the XP table', () => {
  it('only trains ratings that exist', () => {
    for (const rule of SOCCER_XP_AWARDS) {
      if (rule.rating !== undefined) expect(RATINGS, rule.kind).toContain(rule.rating);
      if (rule.targetRating !== undefined) expect(RATINGS).toContain(rule.targetRating);
    }
  });

  it('never awards negative XP', () => {
    for (const rule of SOCCER_XP_AWARDS) {
      expect(rule.xp).toBeGreaterThanOrEqual(0);
      expect(rule.targetXp ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it('pays an attempt less than a goal, but not nothing', () => {
    const attempt = SOCCER_XP_AWARDS.find((r) => r.when?.['zone'] === 'penaltyArea');
    const goal = SOCCER_XP_AWARDS.find((r) => r.kind === 'score');
    expect(attempt?.xp).toBeGreaterThan(0);
    expect(goal?.xp).toBeGreaterThan(attempt?.xp ?? 0);
  });

  it('trains crossing only from a cross, which is why it is its own pass type', () => {
    const crossing = SOCCER_XP_AWARDS.filter((r) => r.rating === 'crossing');
    expect(crossing).toHaveLength(1);
    expect(crossing[0]?.when?.['kind']).toBe('cross');
  });

  it('pays a save, because the keeper has to be able to learn too', () => {
    const save = SOCCER_XP_AWARDS.find((r) => r.rating === 'goalkeeping');
    expect(save?.xp).toBeGreaterThan(0);
  });
});

describe('the module exposes all of it through the seam', () => {
  it('carries the weights, the physical modifiers, the positions, and the XP', () => {
    expect(soccer.ratingWeights).toBe(SOCCER_WEIGHTS);
    expect(soccer.physicalModifiers).toBe(SOCCER_PHYSICAL);
    expect(soccer.positionWeights).toBe(SOCCER_POSITION_WEIGHTS);
    expect(soccer.xpAwards).toBe(SOCCER_XP_AWARDS);
  });
});
