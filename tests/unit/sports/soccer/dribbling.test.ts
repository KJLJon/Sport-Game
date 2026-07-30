/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.7 — Dribbling, sprint, shielding, stamina drain
 * @story   US-4.2 — Pass, shoot, dribble, and cross
 * @design  06-game-design.md §3.2
 *
 * Purpose: that sprinting costs something. A sprint button which only makes you faster is a button
 * nobody ever releases, so the three costs — stamina, close control, and turning — are each pinned
 * here, along with stamina never being allowed to touch a rating.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import {
  DRIBBLE,
  createStamina,
  dribbleProfile,
  movementRatingsFor,
  resolveShield,
  shieldOdds,
  shieldPosition,
  stamina,
  staminaFactor,
  tickStamina,
  touchDistance,
  type CarrierRatings,
  type ShieldingRatings,
} from '@/sports/soccer/dribbling.ts';

const AVERAGE: CarrierRatings = { dribbling: 50, pace: 50 };
const ELITE: CarrierRatings = { dribbling: 95, pace: 95 };
const CLUMSY: CarrierRatings = { dribbling: 15, pace: 60 };

const DEFENDER: ShieldingRatings = { tackling: 50, marking: 50 };
const HARD_DEFENDER: ShieldingRatings = { tackling: 95, marking: 95 };

describe('stamina', () => {
  it('starts full for anyone the record has never seen', () => {
    const state = createStamina();
    expect(stamina(state, 7)).toBe(1);
  });

  it('drains under a sprint and empties in about the stated time', () => {
    const state = createStamina();
    const steps = DRIBBLE.sprintDrainSeconds * 60;
    for (let i = 0; i < steps; i++) tickStamina(state, 1, 1);
    expect(stamina(state, 1)).toBeCloseTo(0, 3);
  });

  it('recovers at a walk, and never past full', () => {
    const state = createStamina();
    for (let i = 0; i < 60 * 60; i++) tickStamina(state, 1, 1);
    const spent = stamina(state, 1);
    expect(spent).toBeLessThan(0.8);

    for (let i = 0; i < DRIBBLE.recoverSeconds * 60 * 2; i++) tickStamina(state, 1, 0);
    expect(stamina(state, 1)).toBe(1);
  });

  it('costs something even at a jog', () => {
    const jogging = createStamina();
    const standing = createStamina();
    for (let i = 0; i < 60 * 60; i++) {
      tickStamina(jogging, 1, 0.5);
      tickStamina(standing, 1, 0);
    }
    expect(stamina(jogging, 1)).toBeLessThan(stamina(standing, 1));
  });

  it('never goes below empty', () => {
    const state = createStamina();
    for (let i = 0; i < DRIBBLE.sprintDrainSeconds * 60 * 3; i++) tickStamina(state, 1, 1);
    expect(stamina(state, 1)).toBe(0);
  });

  it('slows an exhausted athlete without stopping them', () => {
    expect(staminaFactor(1)).toBe(1);
    expect(staminaFactor(0)).toBe(DRIBBLE.exhaustedSpeed);
    expect(staminaFactor(0)).toBeGreaterThan(0.5);
    expect(staminaFactor(0.5)).toBeGreaterThan(staminaFactor(0));
  });
});

describe('the profile a carrier moves with', () => {
  it('reads pace as speed and dribbling as agility', () => {
    expect(movementRatingsFor(ELITE)).toEqual({ speed: 95, acceleration: 95, agility: 95 });
    expect(movementRatingsFor(CLUMSY)).toEqual({ speed: 60, acceleration: 60, agility: 15 });
  });

  it('is slower with the ball than without it', () => {
    const carrying = dribbleProfile(AVERAGE, 1, { carrying: true });
    const free = dribbleProfile(AVERAGE, 1, { carrying: false });
    expect(carrying.maxSpeed).toBeLessThan(free.maxSpeed);
  });

  it('costs a good dribbler less of that', () => {
    const eliteLoss =
      dribbleProfile(ELITE, 1, { carrying: false }).maxSpeed -
      dribbleProfile(ELITE, 1, { carrying: true }).maxSpeed;
    const averageLoss =
      dribbleProfile(AVERAGE, 1, { carrying: false }).maxSpeed -
      dribbleProfile(AVERAGE, 1, { carrying: true }).maxSpeed;
    expect(eliteLoss).toBeLessThan(averageLoss);
  });

  it('makes a sprint faster and a sprinting turn slower', () => {
    const jog = dribbleProfile(AVERAGE, 1, { sprinting: false });
    const sprint = dribbleProfile(AVERAGE, 1, { sprinting: true });
    expect(sprint.maxSpeed).toBeGreaterThan(jog.maxSpeed);
    expect(sprint.turnRate).toBeLessThan(jog.turnRate);
  });

  it('slows a tired athlete', () => {
    expect(dribbleProfile(AVERAGE, 0).maxSpeed).toBeLessThan(dribbleProfile(AVERAGE, 1).maxSpeed);
    expect(dribbleProfile(AVERAGE, 0).acceleration).toBeLessThan(
      dribbleProfile(AVERAGE, 1).acceleration,
    );
  });

  it('leaves the rating itself untouched — tiredness is not a demotion', () => {
    const before = { ...AVERAGE };
    dribbleProfile(AVERAGE, 0, { sprinting: true });
    expect(AVERAGE).toEqual(before);
    expect(movementRatingsFor(AVERAGE)).toEqual({ speed: 50, acceleration: 50, agility: 50 });
  });
});

describe('close control', () => {
  it('pushes the ball further ahead at a sprint', () => {
    expect(touchDistance(AVERAGE, true)).toBeGreaterThan(touchDistance(AVERAGE, false));
  });

  it('keeps it closer for a better dribbler', () => {
    expect(touchDistance(ELITE, true)).toBeLessThan(touchDistance(CLUMSY, true));
  });

  it('leaves a poor dribbler at a sprint genuinely dispossessable', () => {
    // Over a metre ahead is far enough for a defender to simply arrive at it first.
    expect(touchDistance(CLUMSY, true)).toBeGreaterThan(1);
    // And an elite one keeps it under close control even flat out.
    expect(touchDistance(ELITE, true)).toBeLessThan(0.9);
  });
});

describe('shielding', () => {
  const carrier = { x: 50, y: 34 };

  it('is best with the body between the defender and the ball', () => {
    const ball = { x: 51, y: 34 };
    const behind = shieldPosition(carrier, ball, { x: 49, y: 34 });
    const goalside = shieldPosition(carrier, ball, { x: 52, y: 34 });
    expect(behind).toBeCloseTo(1, 6);
    expect(goalside).toBeCloseTo(-1, 6);
  });

  it('is neutral side-on', () => {
    expect(shieldPosition(carrier, { x: 51, y: 34 }, { x: 50, y: 36 })).toBeCloseTo(0, 6);
  });

  it('is nothing at all when the ball or the defender is on top of the carrier', () => {
    expect(shieldPosition(carrier, carrier, { x: 49, y: 34 })).toBe(0);
    expect(shieldPosition(carrier, { x: 51, y: 34 }, carrier)).toBe(0);
  });

  it('makes position worth more than the ratings alone', () => {
    const a = { id: 1, ratings: AVERAGE };
    const d = { id: 2, ratings: DEFENDER };
    expect(shieldOdds(a, d, 1)).toBeGreaterThan(shieldOdds(a, d, -1));
    // Evenly matched and square-on, it is close to a coin toss.
    expect(shieldOdds(a, d, 0)).toBeCloseTo(0.5, 2);
  });

  it('still favours the better player from the same position', () => {
    expect(shieldOdds({ id: 1, ratings: ELITE }, { id: 2, ratings: DEFENDER }, 0)).toBeGreaterThan(
      shieldOdds({ id: 1, ratings: CLUMSY }, { id: 2, ratings: DEFENDER }, 0),
    );
    expect(
      shieldOdds({ id: 1, ratings: AVERAGE }, { id: 2, ratings: HARD_DEFENDER }, 0),
    ).toBeLessThan(shieldOdds({ id: 1, ratings: AVERAGE }, { id: 2, ratings: DEFENDER }, 0));
  });

  it('resolves the same way for the same seed, and roughly at the stated odds', () => {
    const a = { id: 1, ratings: ELITE };
    const d = { id: 2, ratings: DEFENDER };
    expect(resolveShield(a, d, 1, createRng('s'))).toBe(resolveShield(a, d, 1, createRng('s')));

    const rng = createRng('many');
    let held = 0;
    for (let i = 0; i < 500; i++) if (resolveShield(a, d, 1, rng)) held++;
    expect(held / 500).toBeGreaterThan(0.6);
  });
});
