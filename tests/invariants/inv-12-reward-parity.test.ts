/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.13 — Arcade balance: daily reward caps, anti-farm verification (INV-12)
 * @story   US-16.6 — Not be able to farm it
 * @design  09-modes-and-arcade.md §7 (balance across modes), 12-quality-and-testing.md §3
 * @invariant INV-12 — reward rate per minute is within ±25% across modes
 *
 * Purpose: the half of INV-12 that can be checked today, and an honest statement of the half that
 * cannot.
 *
 * **What is checked.** XP and familiarity per real minute, arcade against a match with the same
 * minutes and the same events. `09` §7 wants arcade to pay *least* per minute while staying inside
 * ±25% of the other modes, and the two together bracket the rate tightly: below 0.75 the invariant
 * fails, at 1.0 arcade is no longer the least. There is exactly one number in that range and this
 * file is why it is 0.8.
 *
 * **What is not, yet.** Coins. `src/economy/` is empty until T-8.9, so there is no Live coin rate to
 * compare against and no wallet to compare it in. What can be asserted about coins today is that
 * arcade's own payout is *bounded* — which is `09` §3.3's actual anti-farm mechanism — and that is
 * checked here. The cross-mode coin half of INV-12 becomes checkable at T-8.9 and Playbook's third
 * mode joins at T-5.11; this file is where all three meet.
 */
import { describe, expect, it } from 'vitest';
import { ARCADE_LEARNING_RATE, arcadeProgression } from '../../src/modes/arcade/progression.ts';
import { DAILY_COIN_CAP, awardRun } from '../../src/modes/arcade/rewards.ts';
import { emptyDay } from '../../src/modes/arcade/records.ts';
import { applyMatch } from '../../src/athletes/progression.ts';
import { BASKETBALL_XP_AWARDS } from '../../src/sports/basketball/xp.ts';
import { BASKETBALL_ARCADE } from '../../src/sports/basketball/arcade/index.ts';
import { ARCADE_ACTOR } from '../../src/sports/basketball/arcade/shared.ts';
import { startRun } from '../../src/modes/arcade/modes.ts';
import type { ArcadeResult } from '../../src/modes/arcade/types.ts';
import { arcadeConfig } from '../helpers/arcade.ts';
import { athlete, attributes } from '../helpers/athletes.ts';
import { drive, humanPlayer } from '../helpers/arcade-drive.ts';

/** ±25%, as `12` §3 states it. */
const TOLERANCE = 0.25;

const SUBJECT = athlete({ id: 'inv12', attributes: attributes(70) });

function play(gameIndex: number): ArcadeResult {
  const game = BASKETBALL_ARCADE[gameIndex]!;
  const run = startRun(game, arcadeConfig({ athlete: SUBJECT, seed: `inv12:${game.id}` }));
  drive(run, { press: humanPlayer({ seed: 'inv12' }), steps: 9000 });
  run.finish();
  return { ...run.result()!, athleteId: SUBJECT.id };
}

/** XP per real minute for a result, played as arcade and as a match. */
function ratesFor(result: ArcadeResult): { readonly arcade: number; readonly match: number } {
  const minutes = result.seconds / 60;

  const arcade = arcadeProgression({
    result,
    athlete: SUBJECT,
    awards: BASKETBALL_XP_AWARDS,
  });

  const match = applyMatch({
    sport: 'basketball',
    events: result.events,
    awards: BASKETBALL_XP_AWARDS,
    entities: new Map([[ARCADE_ACTOR, SUBJECT]]),
    minutes: new Map([[ARCADE_ACTOR, minutes]]),
  }).get(ARCADE_ACTOR);

  return {
    arcade: (arcade?.report.skill.xpGained ?? 0) / minutes,
    match: (match?.report.skill.xpGained ?? 0) / minutes,
  };
}

describe('INV-12 — reward rate per minute across modes', () => {
  it('arcade XP per minute is within ±25% of a match’s, for every game', () => {
    for (let i = 0; i < BASKETBALL_ARCADE.length; i++) {
      const { arcade, match } = ratesFor(play(i));
      const ratio = arcade / match;
      expect(ratio, `${BASKETBALL_ARCADE[i]?.id} ratio ${ratio.toFixed(3)}`).toBeGreaterThanOrEqual(
        1 - TOLERANCE,
      );
      expect(ratio, `${BASKETBALL_ARCADE[i]?.id} ratio ${ratio.toFixed(3)}`).toBeLessThanOrEqual(
        1 + TOLERANCE,
      );
    }
  });

  it('and arcade is nonetheless the *least* per minute (09 §7)', () => {
    for (let i = 0; i < BASKETBALL_ARCADE.length; i++) {
      const { arcade, match } = ratesFor(play(i));
      expect(arcade, BASKETBALL_ARCADE[i]?.id).toBeLessThan(match);
    }
  });

  it('the rate itself is inside the band the invariant allows', () => {
    expect(ARCADE_LEARNING_RATE).toBeGreaterThanOrEqual(1 - TOLERANCE);
    expect(ARCADE_LEARNING_RATE).toBeLessThan(1);
  });
});

describe('INV-12 — arcade cannot be farmed (US-16.6)', () => {
  it('a whole day of nothing but arcade is bounded, whatever is played', () => {
    const results = BASKETBALL_ARCADE.map((_, index) => play(index));
    let day = emptyDay('2026-07-28');

    // Three hundred runs — several hours of solid play across all five games.
    for (let i = 0; i < 300; i++) {
      day = awardRun(results[i % results.length]!, day).day;
    }

    expect(day.coins).toBeLessThanOrEqual(DAILY_COIN_CAP);
  });

  it('the second hour of grinding pays essentially nothing', () => {
    const result = play(0);
    let day = emptyDay('2026-07-28');
    let firstTen = 0;

    for (let i = 0; i < 10; i++) {
      const reward = awardRun(result, day);
      firstTen += reward.coins;
      day = reward.day;
    }

    let nextFifty = 0;
    for (let i = 0; i < 50; i++) {
      const reward = awardRun(result, day);
      nextFifty += reward.coins;
      day = reward.day;
    }

    expect(nextFifty).toBeLessThan(firstTen * 0.05);
  });

  it('practice is unlimited *and* free — it never consumes the day’s ceiling', () => {
    const practice: ArcadeResult = { ...play(0), mode: 'practice', rewarded: false };
    let day = emptyDay('2026-07-28');
    for (let i = 0; i < 500; i++) day = awardRun(practice, day).day;

    expect(day.coins).toBe(0);
    expect(day.runs).toEqual({});
  });
});
