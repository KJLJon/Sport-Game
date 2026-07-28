/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.4 — Practice / scored / daily modes; seeded daily challenge
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.3 (personal bests per athlete and overall)
 *
 * Purpose: the arcade record store against real IndexedDB. The cases that matter are the ones a
 * unit test with a fake store would not catch: that a per-athlete best and the overall best stay in
 * step, and that a practice run leaves no trace at all.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ANY_ATHLETE,
  ArcadeRepository,
  emptyDay,
  improveBest,
  type ArcadeBest,
} from '../../../src/modes/arcade/records.ts';
import type { ArcadeResult } from '../../../src/modes/arcade/types.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';

const THRESHOLDS: readonly [number, number, number] = [10, 20, 30];

function result(overrides: Partial<ArcadeResult> = {}): ArcadeResult {
  return {
    game: 'bball.free-throw',
    sport: 'basketball',
    mode: 'scored',
    seed: 'seed',
    athleteId: 'athlete-1',
    difficulty: 'pro',
    score: 25,
    stars: 2,
    attempts: 10,
    made: 8,
    bestStreak: 5,
    seconds: 42,
    reason: 'lives',
    events: [],
    rewarded: true,
    ...overrides,
  };
}

describe('improveBest', () => {
  it('records a first run as an improvement', () => {
    const update = improveBest(undefined, result(), 'athlete-1', THRESHOLDS, 100);
    expect(update.improved).toBe(true);
    expect(update.best).toMatchObject({ score: 25, stars: 2, runs: 1, bestStreak: 5 });
  });

  it('equalling a best is not beating it', () => {
    const first = improveBest(undefined, result({ score: 25 }), 'a', THRESHOLDS, 1).best;
    const again = improveBest(first, result({ score: 25 }), 'a', THRESHOLDS, 2);
    expect(again.improved).toBe(false);
    expect(again.best.score).toBe(25);
    expect(again.best.runs).toBe(2);
  });

  it('keeps the higher score and the longer streak independently', () => {
    const first = improveBest(
      undefined,
      result({ score: 40, bestStreak: 2 }),
      'a',
      THRESHOLDS,
      1,
    ).best;
    const second = improveBest(first, result({ score: 10, bestStreak: 9 }), 'a', THRESHOLDS, 2);
    expect(second.best.score).toBe(40);
    expect(second.best.bestStreak).toBe(9);
    expect(second.best.stars).toBe(3);
  });
});

describe('ArcadeRepository', () => {
  let db: Database;
  let repo: ArcadeRepository;

  beforeEach(async () => {
    await deleteDatabase();
    db = await Database.open();
    repo = new ArcadeRepository(db);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase();
  });

  it('files a run against both the athlete and the overall record', async () => {
    const update = await repo.recordRun(result({ score: 25 }), THRESHOLDS, 1);
    expect(update?.improved).toBe(true);

    expect((await repo.best('bball.free-throw', 'athlete-1'))?.score).toBe(25);
    expect((await repo.overallBest('bball.free-throw'))?.score).toBe(25);
  });

  it('keeps the overall record when a different athlete does worse', async () => {
    await repo.recordRun(result({ athleteId: 'star', score: 90 }), THRESHOLDS, 1);
    const second = await repo.recordRun(result({ athleteId: 'rookie', score: 12 }), THRESHOLDS, 2);

    expect(second?.improved).toBe(true); // a first run for that athlete
    expect((await repo.best('bball.free-throw', 'rookie'))?.score).toBe(12);
    expect((await repo.overallBest('bball.free-throw'))?.score).toBe(90);
  });

  it('records nothing for a practice run', async () => {
    expect(
      await repo.recordRun(result({ mode: 'practice', rewarded: false }), THRESHOLDS),
    ).toBeNull();
    expect(await repo.best('bball.free-throw', 'athlete-1')).toBeUndefined();
    expect(await repo.overallBest('bball.free-throw')).toBeUndefined();
  });

  it('lists a game’s athlete bests highest first, without the overall record', async () => {
    await repo.recordRun(result({ athleteId: 'a', score: 10 }), THRESHOLDS, 1);
    await repo.recordRun(result({ athleteId: 'b', score: 30 }), THRESHOLDS, 2);
    await repo.recordRun(result({ athleteId: 'c', score: 20 }), THRESHOLDS, 3);

    const bests = await repo.bestsForGame('bball.free-throw');
    expect(bests.map((best: ArcadeBest) => best.athleteId)).toEqual(['b', 'c', 'a']);
    expect(bests.some((best) => best.athleteId === ANY_ATHLETE)).toBe(false);
  });

  it('reads every game’s overall best in one go, for the hub grid', async () => {
    await repo.recordRun(result({ game: 'bball.free-throw', score: 15 }), THRESHOLDS, 1);
    await repo.recordRun(result({ game: 'bball.three-point', score: 55 }), THRESHOLDS, 2);

    const bests = await repo.overallBests();
    expect(bests.get('bball.free-throw')?.score).toBe(15);
    expect(bests.get('bball.three-point')?.score).toBe(55);
    expect(bests.size).toBe(2);
  });

  it('returns an empty day rather than undefined, so callers never branch on it', async () => {
    expect(await repo.day('2026-07-28')).toEqual(emptyDay('2026-07-28'));

    await repo.putDay({ ...emptyDay('2026-07-28'), coins: 40, paidGames: ['bball.free-throw'] });
    const stored = await repo.day('2026-07-28');
    expect(stored.coins).toBe(40);
    expect(stored.paidGames).toEqual(['bball.free-throw']);
  });

  it('clears everything arcade owns and nothing else', async () => {
    await repo.recordRun(result(), THRESHOLDS, 1);
    await repo.putDay({ ...emptyDay('2026-07-28'), coins: 10 });

    await repo.clear();
    expect(await repo.best('bball.free-throw', 'athlete-1')).toBeUndefined();
    expect((await repo.day('2026-07-28')).coins).toBe(0);
  });
});
