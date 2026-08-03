/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.4 — Basketball Live AI depth: pick-and-roll, cuts, zone vs man, rating-driven shot selection
 * @story   US-3.3 — Face a CPU that plays basketball
 * @design  06-game-design.md §3.1 (schemes), §5 (utility scoring)
 * @invariant INV-1 (difficulty never touches a rating), INV-8 (determinism)
 *
 * Purpose: that each of the four is a *judgement*. The tests that matter are the ones where the
 * right answer is counter-intuitive: a stretch big pops rather than rolls, a wide-open shooter does
 * not cut, a screen for an unguarded handler is never set, and a team that cannot shoot takes shots
 * a better team would pass up.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '@/engine/rng.ts';
import { COURT, attackedBasket } from '@/sports/basketball/court.ts';
import {
  OFFBALL,
  RollChoice,
  cutUrge,
  possessionValueFor,
  rollOrPop,
  rollTarget,
  schemeFor,
  screenChoice,
  type CutLook,
  type ScreenLook,
} from '@/sports/basketball/offball.ts';
import type { BasketballRatings } from '@/sports/basketball/roster.ts';

const AVERAGE: BasketballRatings = {
  finishing: 55,
  midRange: 55,
  threePoint: 55,
  freeThrow: 70,
  composure: 55,
  passing: 55,
  ballHandling: 55,
  perimeterD: 55,
  interiorD: 55,
  agility: 55,
  strength: 55,
  vertical: 55,
  rebounding: 55,
  discipline: 55,
};

const rated = (over: Partial<BasketballRatings>): BasketballRatings => ({ ...AVERAGE, ...over });

const STRETCH = rated({ threePoint: 78, finishing: 55 });
const RIM_RUNNER = rated({ threePoint: 40, finishing: 82 });

describe('rollOrPop', () => {
  it('sends the stretch big to the arc and the rim runner to the rim', () => {
    expect(rollOrPop(STRETCH)).toBe(RollChoice.POP);
    expect(rollOrPop(RIM_RUNNER)).toBe(RollChoice.ROLL);
  });

  it('rolls on a tie — a roll ends at the rim, and that is the better shot', () => {
    expect(rollOrPop(AVERAGE)).toBe(RollChoice.ROLL);
    expect(rollOrPop(rated({ threePoint: 60, finishing: 55 }))).toBe(RollChoice.ROLL);
    expect(rollOrPop(rated({ threePoint: 61, finishing: 55 }))).toBe(RollChoice.POP);
  });

  it('reads the ratings and nothing else (INV-1)', () => {
    // No parameter through which a difficulty could arrive.
    expect(rollOrPop).toHaveLength(1);
  });
});

describe('rollTarget', () => {
  const side = 0 as const;
  const basket = attackedBasket(side);

  it('rolls to the rim from wherever the screener is', () => {
    const target = rollTarget(RollChoice.ROLL, { x: 18, y: 7.5 }, side, { x: 20, y: 7.5 });
    const away = Math.hypot(target.x - basket.x, target.y - basket.y);

    expect(away).toBeCloseTo(OFFBALL.rollDistance);
  });

  it('stays put when the roll is already at the rim', () => {
    const at = { x: basket.x + 1, y: basket.y };
    expect(rollTarget(RollChoice.ROLL, at, side, at)).toEqual(at);
  });

  it('pops away from the basket, behind the handler', () => {
    const handler = { x: 18, y: 7.5 };
    const target = rollTarget(RollChoice.POP, handler, side);

    expect(Math.hypot(target.x - basket.x, target.y - basket.y)).toBeGreaterThan(
      Math.hypot(handler.x - basket.x, handler.y - basket.y),
    );
  });

  it('never pops somebody off the court', () => {
    const target = rollTarget(RollChoice.POP, { x: COURT.length - 1, y: 0.6 }, side);

    expect(target.x).toBeLessThanOrEqual(COURT.length);
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.y).toBeLessThanOrEqual(COURT.width);
  });

  it('handles a handler standing on the rim', () => {
    expect(rollTarget(RollChoice.POP, basket, side)).toEqual({ x: basket.x, y: basket.y });
  });
});

describe('screenChoice', () => {
  const look = (over: Partial<ScreenLook> = {}): ScreenLook => ({
    id: 5,
    distance: 5,
    handlerSeparation: 1.5,
    ratings: RIM_RUNNER,
    big: true,
    ...over,
  });

  it('sets one for a pressured handler', () => {
    expect(screenChoice([look()])?.id).toBe(5);
  });

  it('sets none at all for a handler nobody is guarding', () => {
    // The whole point: a screen here brings a second defender into the space the handler was
    // about to drive into.
    expect(screenChoice([look({ handlerSeparation: 9 })])).toBeNull();
  });

  it('prefers the big who is close enough to arrive', () => {
    const chosen = screenChoice([
      look({ id: 4, distance: 14 }),
      look({ id: 5, distance: 4 }),
      look({ id: 6, distance: 9 }),
    ]);

    expect(chosen?.id).toBe(5);
  });

  it('prefers a big to a guard, all else equal', () => {
    const chosen = screenChoice([look({ id: 1, big: false }), look({ id: 5, big: true })]);

    expect(chosen?.id).toBe(5);
  });

  it('reports an urge the caller can scale a rate by', () => {
    const chosen = screenChoice([look()]);

    expect(chosen?.urge).toBeGreaterThan(0);
    expect(chosen?.urge).toBeLessThanOrEqual(1);
  });

  it('is the same decision twice from the same seeded stream (INV-8)', () => {
    const looks = [look({ id: 4, distance: 6 }), look({ id: 5, distance: 5 })];
    const a = screenChoice(looks, { noise: 0.3, rng: createRng('screen').fork('ai') });
    const b = screenChoice(looks, { noise: 0.3, rng: createRng('screen').fork('ai') });

    expect(a).toEqual(b);
  });

  it('has nobody to choose from on an empty floor', () => {
    expect(screenChoice([])).toBeNull();
  });
});

describe('cutUrge', () => {
  const look = (over: Partial<CutLook> = {}): CutLook => ({
    toBasket: 7,
    separation: 3,
    laneGap: 3.5,
    toBall: 6,
    ratings: RIM_RUNNER,
    inSight: true,
    ...over,
  });

  it('wants the cut when the defender has let go and the lane is open', () => {
    expect(cutUrge(look())).toBeGreaterThan(0.3);
  });

  it('will not cut with a defender in your chest', () => {
    expect(cutUrge(look({ separation: 1 }))).toBe(0);
  });

  it('will not cut from the rim, where there is nowhere to go', () => {
    expect(cutUrge(look({ toBasket: OFFBALL.cutFrom - 0.5 }))).toBe(0);
  });

  it('will not cut behind the handler back', () => {
    expect(cutUrge(look({ inSight: false }))).toBe(0);
  });

  it('will not cut into a lane with a defender standing in it', () => {
    expect(cutUrge(look({ laneGap: 1.4 }))).toBe(0);
  });

  it('sends the finisher rather than the shooter who cannot finish', () => {
    const finisher = cutUrge(look({ ratings: RIM_RUNNER }));
    const shooter = cutUrge(look({ ratings: rated({ finishing: 35, threePoint: 85 }) }));

    expect(finisher).toBeGreaterThan(shooter);
  });

  it('wants it less from further away, where the pass is harder', () => {
    expect(cutUrge(look({ toBall: 5 }))).toBeGreaterThan(cutUrge(look({ toBall: 13 })));
  });
});

describe('possessionValueFor', () => {
  const five = (ratings: BasketballRatings) => [ratings, ratings, ratings, ratings, ratings];

  it('asks a good shooting team to pass up shots a poor one should take', () => {
    const good = possessionValueFor(five(rated({ threePoint: 80, midRange: 78, finishing: 80 })));
    const poor = possessionValueFor(five(rated({ threePoint: 40, midRange: 42, finishing: 45 })));

    expect(good).toBeGreaterThan(poor);
    expect(poor).toBeLessThan(OFFBALL.possessionValue);
    expect(good).toBeGreaterThan(OFFBALL.possessionValue);
  });

  it('stays inside the spread it is allowed', () => {
    const extreme = possessionValueFor(
      five(rated({ threePoint: 99, midRange: 99, finishing: 99 })),
    );

    expect(extreme).toBeLessThanOrEqual(OFFBALL.possessionValue + OFFBALL.possessionSpread + 1e-9);
  });

  it('falls back to the tuned constant for an empty floor', () => {
    expect(possessionValueFor([])).toBe(OFFBALL.possessionValue);
  });
});

describe('schemeFor', () => {
  const five = (threePoint: number) => Array.from({ length: 5 }, () => rated({ threePoint }));

  it('plays man against shooters and zone against a team that cannot shoot', () => {
    expect(schemeFor({ opponents: five(80), fouls: 0 })).toBe('man');
    expect(schemeFor({ opponents: five(45), fouls: 0 })).toBe('zone');
  });

  it('sits down in a zone once the fouls start to matter', () => {
    const shooters = five(OFFBALL.zoneShootingBar + 2);

    expect(schemeFor({ opponents: shooters, fouls: 0 })).toBe('man');
    expect(schemeFor({ opponents: shooters, fouls: OFFBALL.zoneFoulBar + 5 })).toBe('zone');
  });

  it('plays man when it has nobody to read', () => {
    expect(schemeFor({ opponents: [], fouls: 0 })).toBe('man');
  });
});
