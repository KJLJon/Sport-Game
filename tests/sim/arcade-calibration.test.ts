/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.2 — Calibration: ratings + familiarity → window sizes and speeds (INV-10)
 * @task    T-4.5 — Free Throw · T-4.6 Three-Point · T-4.7 Buzzer Beater · T-4.8 Fast Break
 * @task    T-4.9 — Pickpocket
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §2.4 (the fairness rule)
 *
 * Purpose: Gate 4's "calibration demonstrably reflects the chosen athlete", demonstrated rather than
 * asserted. Every game is played many times by a *human-like* player — fixed timing precision,
 * fixed reaction latency — across four athlete tiers, and the score has to rise with the athlete.
 *
 * Why it is measured this way: a bot with perfect timing collects its athlete's ceiling on every
 * attempt and therefore cannot tell a novice from a specialist, so a batch driven by one would pass
 * this file while the actual game failed the gate. Two real design bugs were found by driving it
 * with a human instead — see the T-4.5 and T-4.9 notes in `PROGRESS.md`.
 */
import { describe, expect, it } from 'vitest';
import { BASKETBALL_ARCADE } from '../../src/sports/basketball/arcade/index.ts';
import { startRun } from '../../src/modes/arcade/modes.ts';
import { starsFor } from '../../src/modes/arcade/scoring.ts';
import { newSportSkill } from '../../src/athletes/types.ts';
import { arcadeConfig } from '../helpers/arcade.ts';
import { athlete, attributes } from '../helpers/athletes.ts';
import { drive, humanPlayer } from '../helpers/arcade-drive.ts';
import type { ArcadeGameDef } from '../../src/modes/arcade/types.ts';
import type { Athlete } from '../../src/athletes/types.ts';

const RUNS = 24;

function medianScore(game: ArcadeGameDef, subject: Athlete, tag: string): number {
  const scores: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const run = startRun(game, arcadeConfig({ seed: `${tag}:${game.id}:${i}`, athlete: subject }));
    drive(run, { press: humanPlayer({ seed: `human:${i}` }), steps: 9000 });
    run.finish();
    scores.push(run.result()?.score ?? 0);
  }
  scores.sort((a, b) => a - b);
  return scores[Math.floor(scores.length / 2)] ?? 0;
}

describe('the athlete decides how well the run goes', () => {
  const tiers = [30, 50, 70, 92];

  for (const game of BASKETBALL_ARCADE) {
    it(`${game.name}: a better athlete scores better, with the same hands`, () => {
      const medians = tiers.map((level) =>
        medianScore(game, athlete({ attributes: attributes(level) }), `tier${level}`),
      );

      for (let i = 1; i < medians.length; i++) {
        expect(
          medians[i],
          `${game.name} ${tiers[i]} vs ${tiers[i - 1]}: ${medians.join(' → ')}`,
        ).toBeGreaterThan(medians[i - 1] ?? 0);
      }
    });
  }
});

describe('the star thresholds mean something', () => {
  for (const game of BASKETBALL_ARCADE) {
    it(`${game.name}: a specialist reaches three stars and a novice does not`, () => {
      const novice = medianScore(game, athlete({ attributes: attributes(30) }), 'novice');
      const star = medianScore(game, athlete({ attributes: attributes(92) }), 'star');

      expect(starsFor(star, game.stars), `${game.name} star median ${star}`).toBeGreaterThanOrEqual(
        2,
      );
      expect(starsFor(novice, game.stars), `${game.name} novice median ${novice}`).toBeLessThan(3);
    });
  }
});

describe('practising a second sport shows up in the score (09 §3.4)', () => {
  it('the same athlete scores better at basketball once they have learned it', () => {
    const game = BASKETBALL_ARCADE[0]!;
    const cold = athlete({ primarySport: 'soccer', attributes: attributes(70) });
    const learned = athlete({
      ...cold,
      sportSkills: { ...cold.sportSkills, basketball: newSportSkill(90) },
    });

    expect(medianScore(game, learned, 'learned')).toBeGreaterThan(medianScore(game, cold, 'cold'));
  });
});
