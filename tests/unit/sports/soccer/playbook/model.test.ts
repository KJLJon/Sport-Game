/**
 * T-6.20 — the bridge from a phase turn to soccer's own Live models.
 *
 * The point of the task is that Playbook and Live read the same *model* rather than the same
 * numbers (`09` §7), so the tests that matter are the ones that would fail if somebody quietly
 * introduced a second curve: tuning `SHOOTING.baseError` or `KEEPER.diveSpeed` has to move Playbook,
 * and a longer or riskier pass has to get harder because `PASS_PROFILES` says so.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../../src/engine/rng.ts';
import { PASS_PROFILES } from '../../../../../src/sports/soccer/passing.ts';
import { KEEPER } from '../../../../../src/sports/soccer/keeper.ts';
import { PITCH } from '../../../../../src/sports/soccer/pitch.ts';
import {
  MODEL_CALIBRATION,
  PASS_MODEL,
  SHOT_MODEL,
  attemptCount,
  erf,
  expectedGoalChance,
  interceptChance,
  passCompletion,
  passPlanFor,
  resolvePressure,
  resolveShot,
  sequenceSuccess,
  shotSetupFor,
  spanOf,
  type PassPlan,
  type ShotInput,
} from '../../../../../src/sports/soccer/playbook/model.ts';

const AVERAGE = { shortPass: 55, longPass: 55, crossing: 55 };
const SHOOTER = { finishing: 55, shotPower: 55, coordination: 55 };

describe('erf', () => {
  it('matches the values it has to be right about', () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(0.5)).toBeCloseTo(0.5205, 4);
    expect(erf(1)).toBeCloseTo(0.8427, 4);
    expect(erf(2)).toBeCloseTo(0.9953, 4);
    expect(erf(-1)).toBeCloseTo(-0.8427, 4);
    expect(erf(5)).toBeCloseTo(1, 6);
  });
});

describe('the pass plan is where tempo and width become mechanical', () => {
  it('turns a tempo into a number of passes of a kind, not into a modifier', () => {
    const span = 34;
    expect(passPlanFor('buildUp', 'patient', 'balanced-width', span)).toEqual({
      kind: 'short',
      distance: span / 3,
      count: 3,
    });
    expect(passPlanFor('buildUp', 'balanced-tempo', 'balanced-width', span)).toMatchObject({
      kind: 'short',
      count: 2,
    });
    expect(passPlanFor('buildUp', 'direct', 'balanced-width', span)).toEqual({
      kind: 'lofted',
      distance: span,
      count: 1,
    });
    // Out of the defensive third a direct ball is hit long; through midfield it is played through.
    expect(passPlanFor('progression', 'direct', 'balanced-width', span).kind).toBe('through');
  });

  it('makes the width intent buy a different pass in the final third', () => {
    const span = 12.6;
    expect(passPlanFor('finalThird', 'balanced-tempo', 'wide', span).kind).toBe('cross');
    expect(passPlanFor('finalThird', 'balanced-tempo', 'narrow', span).kind).toBe('through');
    expect(passPlanFor('finalThird', 'patient', 'narrow', span).kind).toBe('short');
    // A cross comes in from the flank, so it is longer than the ground it gains.
    expect(passPlanFor('finalThird', 'balanced-tempo', 'wide', span).distance).toBeGreaterThan(
      span,
    );
  });

  it('takes the span from the pitch rather than restating it', () => {
    for (const side of [0, 1] as const) {
      expect(spanOf('buildUp', side)).toBeCloseTo(spanOf('buildUp', side === 0 ? 1 : 0), 6);
      expect(spanOf('buildUp', side)).toBeGreaterThan(spanOf('finalThird', side));
      expect(spanOf('buildUp', side)).toBeLessThan(PITCH.length);
    }
  });
});

describe('pass completion is Live’s `passError`, read as geometry', () => {
  it('gets harder with distance, because the angular error opens out', () => {
    const near: PassPlan = { kind: 'short', distance: 8, count: 1 };
    const far: PassPlan = { kind: 'short', distance: 30, count: 1 };
    expect(passCompletion(far, AVERAGE, 0.3)).toBeLessThan(passCompletion(near, AVERAGE, 0.3));
  });

  it('gets harder under pressure, and easier with the rating the pass is struck with', () => {
    const plan: PassPlan = { kind: 'lofted', distance: 30, count: 1 };
    expect(passCompletion(plan, AVERAGE, 0.9)).toBeLessThan(passCompletion(plan, AVERAGE, 0.1));

    const good = { shortPass: 90, longPass: 90, crossing: 90 };
    expect(passCompletion(plan, good, 0.4)).toBeGreaterThan(passCompletion(plan, AVERAGE, 0.4));

    // …and `lofted` is struck with `longPass`, so raising `shortPass` alone must not help it.
    expect(PASS_PROFILES.lofted.rating).toBe('longPass');
    const lopsided = { shortPass: 99, longPass: 55, crossing: 55 };
    expect(passCompletion(plan, lopsided, 0.4)).toBeCloseTo(passCompletion(plan, AVERAGE, 0.4), 10);
  });

  it('ranks the four pass kinds the way `PASS_PROFILES` does', () => {
    const at = (kind: PassPlan['kind']): number =>
      passCompletion({ kind, distance: 22, count: 1 }, AVERAGE, 0.4);
    // A through ball is the risky one — `PASS_PROFILES` says so with `weightError`, and the same
    // profile's `baseError` is what this reads.
    expect(at('short')).toBeGreaterThan(at('through'));
    expect(at('short')).toBeGreaterThan(at('lofted'));
    expect(at('lofted')).toBeGreaterThan(at('cross'));
  });

  it('reads a longer, loftier ball as easier to cut out', () => {
    const short: PassPlan = { kind: 'short', distance: 10, count: 1 };
    const long: PassPlan = { kind: 'lofted', distance: 35, count: 1 };
    expect(interceptChance(long, 0.4, 0)).toBeGreaterThan(interceptChance(short, 0.4, 0));
    expect(interceptChance(short, 0.9, 0)).toBeGreaterThan(interceptChance(short, 0.1, 0));
    // Class buys it back, and the bounds hold whatever is thrown at them.
    expect(interceptChance(short, 0.4, 2)).toBeLessThan(interceptChance(short, 0.4, -2));
    expect(interceptChance(long, 1, -50)).toBeLessThanOrEqual(PASS_MODEL.interceptCeiling);
    expect(interceptChance(short, 0, 50)).toBeGreaterThanOrEqual(PASS_MODEL.interceptFloor);
  });

  it('compounds across a sequence, which is what a patient tempo pays for its safety with', () => {
    const one: PassPlan = { kind: 'short', distance: 11, count: 1 };
    const three: PassPlan = { kind: 'short', distance: 11, count: 3 };
    expect(sequenceSuccess(three, AVERAGE, 0.4, 0)).toBeLessThan(
      sequenceSuccess(one, AVERAGE, 0.4, 0),
    );
    expect(sequenceSuccess(three, AVERAGE, 0.4, 0)).toBeGreaterThan(0);
    expect(sequenceSuccess(one, AVERAGE, 0.4, 0)).toBeLessThanOrEqual(1);
  });
});

describe('the shot is Live’s shooting, keeper included', () => {
  const input = (overrides: Partial<ShotInput> = {}): ShotInput => {
    const setup = shotSetupFor('chance', 0, SHOOTER, null, 0.4, createRng('setup'));
    return {
      setup,
      shooter: SHOOTER,
      keeper: { goalkeeping: 55 },
      defenderMarking: 55,
      side: 0,
      ...overrides,
    };
  };

  it('sets the shot up from the phase’s own position on the pitch', () => {
    const chance = shotSetupFor('chance', 0, SHOOTER, null, 0.4, createRng('a'));
    const setPiece = shotSetupFor('setPiece', 0, SHOOTER, null, 0.4, createRng('a'));

    expect(chance.distance).toBeGreaterThan(0);
    // A set piece is the wider, tighter-angle chance.
    expect(setPiece.openness).toBeLessThan(chance.openness);
    expect(Math.abs(setPiece.y - PITCH.width / 2)).toBeGreaterThan(
      Math.abs(chance.y - PITCH.width / 2),
    );
  });

  it('puts the shot on the focused flank', () => {
    const left = shotSetupFor('chance', 0, SHOOTER, 'left', 0.4, createRng('a'));
    const right = shotSetupFor('chance', 0, SHOOTER, 'right', 0.4, createRng('a'));
    expect(left.y).toBeLessThan(PITCH.width / 2);
    expect(right.y).toBeGreaterThan(PITCH.width / 2);
  });

  it('winds up harder for a shooter with the power to', () => {
    const weak = shotSetupFor(
      'chance',
      0,
      { ...SHOOTER, shotPower: 10 },
      null,
      0.4,
      createRng('p'),
    );
    const strong = shotSetupFor(
      'chance',
      0,
      { ...SHOOTER, shotPower: 95 },
      null,
      0.4,
      createRng('p'),
    );
    expect(strong.power).toBeGreaterThan(weak.power);
  });

  it('rates a better finisher’s chance higher, and a better keeper’s lower', () => {
    const base = expectedGoalChance(input());
    expect(expectedGoalChance(input({ shooter: { ...SHOOTER, finishing: 95 } }))).toBeGreaterThan(
      base,
    );
    expect(expectedGoalChance(input({ keeper: { goalkeeping: 95 } }))).toBeLessThan(base);
    expect(expectedGoalChance(input({ defenderMarking: 99 }))).toBeLessThan(base);
  });

  it('rates a shot from further out lower, through Live’s own placement error', () => {
    const near = shotSetupFor('chance', 0, SHOOTER, null, 0.2, createRng('n'));
    const far = { ...near, distance: near.distance + 20 };
    expect(expectedGoalChance(input({ setup: far }))).toBeLessThan(
      expectedGoalChance(input({ setup: near })),
    );
  });

  it('produces every outcome a shot can have, and nothing else', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 400; seed += 1) {
      const setup = shotSetupFor('chance', 0, SHOOTER, null, 0.4, createRng(`s-${seed}`));
      seen.add(resolveShot({ ...input({ setup }), rng: createRng(`r-${seed}`) }).result);
    }
    expect([...seen].sort()).toEqual(['blocked', 'goal', 'off-target', 'parried', 'saved']);
  });

  it('agrees with its own expectation over many draws — the model is not lying about its odds', () => {
    let goals = 0;
    let expected = 0;
    for (let seed = 0; seed < 1500; seed += 1) {
      const setup = shotSetupFor('chance', 0, SHOOTER, null, 0.4, createRng(`s-${seed}`));
      const shot = resolveShot({ ...input({ setup }), rng: createRng(`r-${seed}`) });
      if (shot.result === 'goal') goals += 1;
      expected += shot.expected;
    }
    // The analytic xG and the sampled rate have to agree, or `09` §2.4's counterfactual is fiction.
    expect(goals / 1500).toBeCloseTo(expected / 1500, 1);
  });

  it('lets a shot the keeper only parries come back', () => {
    let parried = 0;
    for (let seed = 0; seed < 400; seed += 1) {
      const setup = shotSetupFor('chance', 0, SHOOTER, null, 0.4, createRng(`s-${seed}`));
      if (resolveShot({ ...input({ setup }), rng: createRng(`r-${seed}`) }).result === 'parried') {
        parried += 1;
      }
    }
    expect(parried).toBeGreaterThan(0);
    // `keeper.ts` is what decides it: a held ball needs both a comfortable margin and a slow shot.
    expect(KEEPER.holdSpeed).toBeGreaterThan(0);
  });
});

describe('a phase of pressure is several attempts', () => {
  it('averages more than one go at it, and never more than the ceiling', () => {
    let total = 0;
    for (let seed = 0; seed < 500; seed += 1) {
      const count = attemptCount('chance', createRng(`a-${seed}`));
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(SHOT_MODEL.maxAttempts);
      total += count;
    }
    expect(total / 500).toBeGreaterThan(1.5);
    expect(total / 500).toBeLessThan(3);
  });

  it('gives a set piece fewer goes than a worked chance', () => {
    const mean = (phase: 'chance' | 'setPiece'): number => {
      let total = 0;
      for (let seed = 0; seed < 400; seed += 1)
        total += attemptCount(phase, createRng(`m-${seed}`));
      return total / 400;
    };
    expect(mean('setPiece')).toBeLessThan(mean('chance'));
  });

  it('stops at the first one that goes in', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const setup = shotSetupFor('chance', 0, SHOOTER, null, 0.3, createRng(`s-${seed}`));
      const spell = resolvePressure({
        setup,
        shooter: SHOOTER,
        keeper: { goalkeeping: 40 },
        defenderMarking: 40,
        side: 0,
        phase: 'chance',
        rng: createRng(`p-${seed}`),
      });
      const goals = spell.attempts.filter((one) => one.result === 'goal');
      expect(goals.length).toBeLessThanOrEqual(1);
      if (goals.length === 1) {
        expect(spell.attempts.at(-1)?.result).toBe('goal');
        expect(spell.result).toBe('goal');
      }
    }
  });

  it('is remembered by its most notable attempt, not its last', () => {
    // A spell that produced a save and then a scuffed one is a save, which is the better account.
    let sawSaveAfterMiss = false;
    for (let seed = 0; seed < 400 && !sawSaveAfterMiss; seed += 1) {
      const setup = shotSetupFor('chance', 0, SHOOTER, null, 0.4, createRng(`s-${seed}`));
      const spell = resolvePressure({
        setup,
        shooter: SHOOTER,
        keeper: { goalkeeping: 70 },
        defenderMarking: 55,
        side: 0,
        phase: 'chance',
        rng: createRng(`p-${seed}`),
      });
      const last = spell.attempts.at(-1)?.result;
      if (spell.attempts.length > 1 && last === 'off-target' && spell.result !== 'off-target') {
        sawSaveAfterMiss = true;
      }
    }
    expect(sawSaveAfterMiss).toBe(true);
  });

  it('reports the chance that *any* of them went in', () => {
    const setup = shotSetupFor('chance', 0, SHOOTER, null, 0.4, createRng('x'));
    const spell = resolvePressure({
      setup,
      shooter: SHOOTER,
      keeper: { goalkeeping: 55 },
      defenderMarking: 55,
      side: 0,
      phase: 'chance',
      rng: createRng('y'),
    });
    const survives = spell.attempts.reduce((total, one) => total * (1 - one.expected), 1);
    expect(spell.expected).toBeCloseTo(1 - survives, 10);
    expect(spell.expected).toBeGreaterThanOrEqual(spell.attempts[0]?.expected ?? 0);
  });
});

describe('calibration', () => {
  it('is zero on every phase, which is the T-6.20 result worth keeping', () => {
    // The Live passing model lands the turn count in `09` §2.3's band on its own — two independent
    // routes to the same number. A non-zero figure here means the model and the budget drifted and
    // somebody chose the budget; T-6.18 owns that decision.
    expect(MODEL_CALIBRATION.buildUp).toBe(0);
    expect(MODEL_CALIBRATION.progression).toBe(0);
    expect(MODEL_CALIBRATION.finalThird).toBe(0);
  });
});
