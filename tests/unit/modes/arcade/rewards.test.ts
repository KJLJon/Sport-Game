/**
 * T-4.13 — the two rules that stop arcade being the efficient way to earn: a sharp per-game decay
 * and a hard daily ceiling.
 */
import { describe, expect, it } from 'vitest';
import {
  COINS_BY_STARS,
  DAILY_COIN_CAP,
  FIRST_THREE_STAR_BONUS,
  awardRun,
  baseCoins,
  rewardSummary,
} from '../../../../src/modes/arcade/rewards.ts';
import { emptyDay, type ArcadeDay } from '../../../../src/modes/arcade/records.ts';
import type { ArcadeResult, StarCount } from '../../../../src/modes/arcade/types.ts';

function result(overrides: Partial<ArcadeResult> = {}): ArcadeResult {
  return {
    game: 'bball.free-throw',
    sport: 'basketball',
    mode: 'scored',
    seed: 's',
    athleteId: 'a1',
    difficulty: 'pro',
    score: 3500,
    stars: 3,
    attempts: 20,
    made: 16,
    bestStreak: 8,
    seconds: 55,
    reason: 'complete',
    events: [],
    rewarded: true,
    ...overrides,
  };
}

/** Plays `count` runs of one game and returns the day that results. */
function grind(count: number, stars: StarCount = 3, game = 'bball.free-throw'): ArcadeDay {
  let day = emptyDay('2026-07-28');
  for (let i = 0; i < count; i++) day = awardRun(result({ stars, game }), day).day;
  return day;
}

describe('baseCoins', () => {
  it('pays more for more stars', () => {
    expect(baseCoins(0, 0, false)).toBe(COINS_BY_STARS[0]);
    expect(baseCoins(1, 0, false)).toBeLessThan(baseCoins(2, 0, false));
    expect(baseCoins(2, 0, false)).toBeLessThan(baseCoins(3, 0, false));
  });

  it('adds the once-a-day headline for a first three-star', () => {
    expect(baseCoins(3, 0, true) - baseCoins(3, 0, false)).toBe(FIRST_THREE_STAR_BONUS);
  });

  it('decays sharply on repeats — the fourth run is a fraction of the first', () => {
    const first = baseCoins(3, 0, false);
    const fourth = baseCoins(3, 3, false);
    expect(fourth).toBeLessThan(first / 4);
  });
});

describe('awardRun', () => {
  it('pays the headline once per game per day', () => {
    let day = emptyDay('2026-07-28');
    const first = awardRun(result(), day);
    expect(first.firstThreeStar).toBe(true);
    day = first.day;

    const second = awardRun(result(), day);
    expect(second.firstThreeStar).toBe(false);
    expect(second.coins).toBeLessThan(first.coins);
  });

  it('pays the headline again for a different game', () => {
    const day = awardRun(result(), emptyDay('2026-07-28')).day;
    expect(awardRun(result({ game: 'bball.pickpocket' }), day).firstThreeStar).toBe(true);
  });

  it('pays practice nothing, and does not even count it as a run (09 §3.3)', () => {
    const day = emptyDay('2026-07-28');
    const reward = awardRun(result({ mode: 'practice', rewarded: false }), day);

    expect(reward.coins).toBe(0);
    expect(reward.day).toBe(day);
    expect(reward.day.runs['bball.free-throw']).toBeUndefined();
  });

  it('records the daily challenge’s best score', () => {
    let day = awardRun(result({ mode: 'daily', score: 1000 }), emptyDay('2026-07-28')).day;
    expect(day.dailyScore).toBe(1000);

    day = awardRun(result({ mode: 'daily', score: 500 }), day).day;
    expect(day.dailyScore).toBe(1000);
  });

  it('stops at the daily ceiling, and says so', () => {
    const day: ArcadeDay = { ...emptyDay('2026-07-28'), coins: DAILY_COIN_CAP - 10 };
    const reward = awardRun(result(), day);

    expect(reward.coins).toBe(10);
    expect(reward.capped).toBe(true);
    expect(reward.day.coins).toBe(DAILY_COIN_CAP);
  });
});

describe('anti-farm (US-16.6, INV-12)', () => {
  it('a day of grinding one game cannot exceed the cap', () => {
    expect(grind(200).coins).toBeLessThanOrEqual(DAILY_COIN_CAP);
  });

  it('a day of rotating between all five cannot either', () => {
    const games = [
      'bball.free-throw',
      'bball.three-point',
      'bball.fast-break',
      'bball.buzzer-beater',
      'bball.pickpocket',
    ];
    let day = emptyDay('2026-07-28');
    for (let i = 0; i < 200; i++) {
      day = awardRun(result({ game: games[i % games.length] ?? games[0]! }), day).day;
    }
    expect(day.coins).toBeLessThanOrEqual(DAILY_COIN_CAP);
  });

  it('the tenth run of a game is worth almost nothing on its own', () => {
    const day = grind(9);
    const tenth = awardRun(result(), day);
    expect(tenth.base).toBeLessThan(2);
  });

  it('most of a day’s arcade coins come from the first few runs', () => {
    // The shape `09` §3.3 asks for: playing each game well once is worth it; playing one game
    // twenty times is not.
    const early = grind(5).coins;
    const all = grind(60).coins;
    expect(early / all).toBeGreaterThan(0.9);
  });
});

describe('rewardSummary', () => {
  it('names the headline', () => {
    const reward = awardRun(result(), emptyDay('2026-07-28'));
    expect(rewardSummary(reward)).toContain('first three-star of the day');
  });

  it('counts a repeat run', () => {
    const day = grind(2);
    expect(rewardSummary(awardRun(result(), day))).toContain('run 3 today');
  });

  it('says plainly when the day is spent', () => {
    const day: ArcadeDay = { ...emptyDay('2026-07-28'), coins: DAILY_COIN_CAP };
    expect(rewardSummary(awardRun(result(), day))).toContain('come back tomorrow');
  });

  it('says nothing was earned for a zero-star run', () => {
    expect(rewardSummary(awardRun(result({ stars: 0 }), emptyDay('2026-07-28')))).toBe(
      'No coins for this one.',
    );
  });

  it('a run late in the day that pays nothing says so, rather than "+0 coins"', () => {
    expect(rewardSummary(awardRun(result(), grind(10)))).toBe('No coins for this one.');
  });
});
