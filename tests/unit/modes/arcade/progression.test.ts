/**
 * T-4.10 — a finished run becomes minutes and events, and goes through the same door a match does.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCADE_LEARNING_RATE,
  arcadeProgression,
  progressionSummary,
} from '../../../../src/modes/arcade/progression.ts';
import { applyMatch } from '../../../../src/athletes/progression.ts';
import { BASKETBALL_XP_AWARDS } from '../../../../src/sports/basketball/xp.ts';
import { ARCADE_ACTOR } from '../../../../src/sports/basketball/arcade/shared.ts';
import { BASKETBALL_ARCADE } from '../../../../src/sports/basketball/arcade/index.ts';
import { startRun } from '../../../../src/modes/arcade/modes.ts';
import { newSportSkill, type Athlete } from '../../../../src/athletes/types.ts';
import type { ArcadeResult } from '../../../../src/modes/arcade/types.ts';
import { arcadeConfig } from '../../../helpers/arcade.ts';
import { athlete, attributes } from '../../../helpers/athletes.ts';
import { drive, humanPlayer } from '../../../helpers/arcade-drive.ts';

function playedRun(gameIndex = 0, subject: Athlete = athlete({ attributes: attributes(80) })) {
  const game = BASKETBALL_ARCADE[gameIndex]!;
  const run = startRun(game, arcadeConfig({ athlete: subject, seed: `prog:${game.id}` }));
  drive(run, { press: humanPlayer({ seed: 'p' }), steps: 9000 });
  run.finish();
  return { game, result: run.result()! };
}

describe('arcadeProgression', () => {
  it('turns a run into familiarity and XP for the athlete who played it', () => {
    const subject = athlete({ primarySport: 'soccer', attributes: attributes(80) });
    const learner: Athlete = {
      ...subject,
      sportSkills: { ...subject.sportSkills, basketball: newSportSkill(20) },
    };
    const { result } = playedRun(0, learner);

    const progress = arcadeProgression({
      result: { ...result, athleteId: learner.id },
      athlete: learner,
      awards: BASKETBALL_XP_AWARDS,
    });

    expect(progress).not.toBeNull();
    expect(progress?.report.sport).toBe('basketball');
    expect(progress?.report.skill.xpGained).toBeGreaterThan(0);
    expect(progress?.report.familiarity.gained).toBeGreaterThan(0);
    expect(progress?.athlete.sportSkills['basketball']?.familiarity).toBeGreaterThan(20);
  });

  it('pays nothing at all for practice (09 §3.3)', () => {
    const { result } = playedRun();
    const practice: ArcadeResult = { ...result, mode: 'practice', rewarded: false };
    expect(
      arcadeProgression({ result: practice, athlete: athlete(), awards: BASKETBALL_XP_AWARDS }),
    ).toBeNull();
  });

  it('refuses to credit an athlete who did not play the run', () => {
    const { result } = playedRun();
    expect(
      arcadeProgression({
        result,
        athlete: athlete({ id: 'somebody-else' }),
        awards: BASKETBALL_XP_AWARDS,
      }),
    ).toBeNull();
  });

  it('pays less than the same minutes and events would in a match (09 §7)', () => {
    const subject = athlete({ attributes: attributes(80) });
    const { result } = playedRun(0, subject);
    const scored = { ...result, athleteId: subject.id };

    const arcade = arcadeProgression({
      result: scored,
      athlete: subject,
      awards: BASKETBALL_XP_AWARDS,
    });
    const asMatch = applyMatch({
      sport: 'basketball',
      events: scored.events,
      awards: BASKETBALL_XP_AWARDS,
      entities: new Map([[ARCADE_ACTOR, subject]]),
      minutes: new Map([[ARCADE_ACTOR, scored.seconds / 60]]),
    }).get(ARCADE_ACTOR);

    expect(arcade?.report.skill.xpGained).toBeLessThan(asMatch?.report.skill.xpGained ?? 0);
    expect(ARCADE_LEARNING_RATE).toBeLessThan(1);
  });

  it('is the rate, not a branch: progression itself never learns arcade exists', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../../../src/athletes/progression.ts', import.meta.url), 'utf8'),
    );
    // The word may appear in a comment explaining the rate; it must never appear in a condition.
    expect(source).not.toMatch(/if\s*\([^)]*arcade/i);
  });
});

describe('every arcade event actually trains something', () => {
  it('each game emits zones and kinds the basketball award table knows', () => {
    for (let i = 0; i < BASKETBALL_ARCADE.length; i++) {
      const { result } = playedRun(i);
      const subject = athlete({ attributes: attributes(80) });

      const progress = arcadeProgression({
        result: { ...result, athleteId: subject.id },
        athlete: subject,
        awards: BASKETBALL_XP_AWARDS,
      });

      const actions = progress?.report.skill.subSkillsGained ?? {};
      const trained = Object.keys(actions).length > 0 || (progress?.report.skill.xpGained ?? 0) > 0;
      expect(trained, BASKETBALL_ARCADE[i]?.id).toBe(true);
    }
  });

  it('a zone no award rule knows would train nothing — so none of them use one', () => {
    const known = new Set(
      BASKETBALL_XP_AWARDS.map((rule) => rule.when?.['zone']).filter(
        (zone): zone is string => typeof zone === 'string',
      ),
    );

    for (let i = 0; i < BASKETBALL_ARCADE.length; i++) {
      const { result } = playedRun(i);
      for (const event of result.events) {
        const zone = event.detail?.['zone'];
        if (typeof zone === 'string') expect(known.has(zone), zone).toBe(true);
      }
    }
  });
});

describe('progressionSummary', () => {
  it('says what practice is worth, plainly', () => {
    expect(progressionSummary(null)).toBe('Practice runs are not scored or rewarded.');
  });

  it('shows a fractional familiarity gain rather than rounding it away', () => {
    const subject = athlete({ primarySport: 'soccer', attributes: attributes(80) });
    const learner: Athlete = {
      ...subject,
      sportSkills: { ...subject.sportSkills, basketball: newSportSkill(20) },
    };
    const { result } = playedRun(0, learner);

    const line = progressionSummary(
      arcadeProgression({
        result: { ...result, athleteId: learner.id },
        athlete: learner,
        awards: BASKETBALL_XP_AWARDS,
      }),
    );

    expect(line).toMatch(/^\+\d+ XP/);
    expect(line).toContain('familiarity');
    expect(line).not.toContain('+0 familiarity');
  });
});
