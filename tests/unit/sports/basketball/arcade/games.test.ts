/**
 * T-4.5–4.9 — the contract every basketball mini-game keeps, asserted once for all five. A game
 * that violates one of these is broken in a way its own test would probably not notice.
 */
import { describe, expect, it } from 'vitest';
import { BASKETBALL_ARCADE } from '../../../../../src/sports/basketball/arcade/index.ts';
import { duplicateIds } from '../../../../../src/modes/arcade/registry.ts';
import { startRun } from '../../../../../src/modes/arcade/modes.ts';
import { DIFFICULTIES } from '../../../../../src/modes/difficulty.ts';
import { newSportSkill } from '../../../../../src/athletes/types.ts';
import { ARCADE_UNLOCKS_BY_ID } from '../../../../../src/achievements/ids.ts';
import { arcadeConfig } from '../../../../helpers/arcade.ts';
import { athlete, attributes } from '../../../../helpers/athletes.ts';
import { drive, pressEvery, pressInBand, pressNever } from '../../../../helpers/arcade-drive.ts';
import { recordingCanvas } from '../../../../helpers/canvas.ts';

const LAYOUT = { width: 390, height: 700, mirror: false, reducedMotion: false };

describe('the set', () => {
  it('is the five games 09 §3.2 names', () => {
    expect(BASKETBALL_ARCADE.map((game) => game.id)).toEqual([
      'bball.free-throw',
      'bball.three-point',
      'bball.fast-break',
      'bball.buzzer-beater',
      'bball.pickpocket',
    ]);
  });

  it('has no colliding ids', () => {
    expect(duplicateIds(BASKETBALL_ARCADE)).toEqual([]);
  });

  it('every game is unlocked by playing, and names an unlock the hub can explain', () => {
    for (const game of BASKETBALL_ARCADE) {
      expect(ARCADE_UNLOCKS_BY_ID.has(game.unlockAchievement)).toBe(true);
    }
  });

  it('every game fits 09 §3.1’s 20–90 second envelope', () => {
    for (const game of BASKETBALL_ARCADE) {
      expect(game.durationSeconds).toBeGreaterThanOrEqual(20);
      expect(game.durationSeconds).toBeLessThanOrEqual(90);
    }
  });

  it('every game has ascending star thresholds and a one-line blurb', () => {
    for (const game of BASKETBALL_ARCADE) {
      expect(game.stars[0]).toBeLessThan(game.stars[1]);
      expect(game.stars[1]).toBeLessThan(game.stars[2]);
      expect(game.blurb.length).toBeGreaterThan(10);
      expect(game.blurb.length).toBeLessThan(90);
    }
  });

  it('every game ends a scored run somehow — lives, a clock, or both', () => {
    for (const game of BASKETBALL_ARCADE) {
      expect(game.scored.lives !== null || game.scored.seconds !== null).toBe(true);
    }
  });

  it('every prompt is a single short line, because nothing here requires reading', () => {
    for (const game of BASKETBALL_ARCADE) {
      const run = startRun(game, arcadeConfig());
      const prompt = run.view().prompt;
      expect(prompt.split(' ').length).toBeLessThanOrEqual(10);
      expect(prompt).not.toContain('\n');
    }
  });
});

describe('calibration (INV-10)', () => {
  it('every game reads ratings basketball actually defines', () => {
    const defined = new Set([
      'finishing',
      'midRange',
      'threePoint',
      'freeThrow',
      'ballHandling',
      'passing',
      'perimeterD',
      'interiorD',
      'rebounding',
      'courtSpeed',
    ]);
    for (const game of BASKETBALL_ARCADE) {
      for (const rating of game.ratings) expect(defined.has(rating)).toBe(true);
    }
  });

  it('a better athlete gets a wider window in every game, at every difficulty', () => {
    const weak = athlete({ attributes: attributes(25) });
    const strong = athlete({ attributes: attributes(90) });

    for (const game of BASKETBALL_ARCADE) {
      for (const difficulty of DIFFICULTIES) {
        const a = game.calibrate(weak, difficulty);
        const b = game.calibrate(strong, difficulty);
        expect(b.windowSeconds).toBeGreaterThan(a.windowSeconds);
        expect(b.reactionSeconds).toBeGreaterThan(a.reactionSeconds);
      }
    }
  });

  it('learning basketball widens the window in every game (US-16.3)', () => {
    const cold = athlete({ primarySport: 'soccer' });
    const warm = athlete({
      ...cold,
      sportSkills: { ...cold.sportSkills, basketball: newSportSkill(80) },
    });

    for (const game of BASKETBALL_ARCADE) {
      expect(game.calibrate(warm, 'pro').rating).toBeGreaterThan(
        game.calibrate(cold, 'pro').rating,
      );
    }
  });
});

describe('every game plays', () => {
  it('produces attempts, events, and a result from a competent player', () => {
    // A capable athlete, deliberately: every game resolves a good release through the athlete's own
    // outcome band, so an average athlete on a three-life game can genuinely finish on nothing. That
    // is the fairness rule working, not a bug — but it makes "a good run scores" a claim about the
    // athlete as much as about the input, so the test states which athlete it means.
    const capable = athlete({ attributes: attributes(88) });

    for (const game of BASKETBALL_ARCADE) {
      const run = startRun(game, arcadeConfig({ seed: `play:${game.id}`, athlete: capable }));
      drive(run, { press: pressInBand, steps: 6000 });
      run.finish();

      const result = run.result();
      expect(result?.game, game.id).toBe(game.id);
      expect(result?.attempts, game.id).toBeGreaterThan(0);
      expect(result?.events.length, game.id).toBeGreaterThan(0);
      expect(result?.score, game.id).toBeGreaterThan(0);
    }
  });

  it('ends on its own terms rather than running forever', () => {
    for (const game of BASKETBALL_ARCADE) {
      const run = startRun(game, arcadeConfig({ seed: `end:${game.id}` }));
      drive(run, { press: pressEvery(7), steps: 8000 });
      expect(run.finished, game.id).toBe(true);
    }
  });

  it('a player who never touches the screen still finishes, and scores nothing', () => {
    for (const game of BASKETBALL_ARCADE) {
      const run = startRun(game, arcadeConfig({ seed: `idle:${game.id}` }));
      drive(run, { press: pressNever, steps: 12_000 });
      expect(run.finished, game.id).toBe(true);
      expect(run.view().score, game.id).toBe(0);
    }
  });

  it('is deterministic: the same seed and the same inputs give the same run (INV-8)', () => {
    for (const game of BASKETBALL_ARCADE) {
      const play = (): number => {
        const run = startRun(game, arcadeConfig({ seed: `fixed:${game.id}` }));
        drive(run, { press: pressEvery(11), steps: 6000 });
        run.finish();
        return run.result()?.score ?? -1;
      };
      expect(play(), game.id).toBe(play());
    }
  });

  it('emits events in the shape Live emits them, with no mode field to branch on (INV-9)', () => {
    for (const game of BASKETBALL_ARCADE) {
      const run = startRun(game, arcadeConfig({ seed: `events:${game.id}` }));
      drive(run, { press: pressInBand, steps: 6000 });

      for (const event of run.events()) {
        expect(Object.keys(event), game.id).not.toContain('mode');
        expect(typeof event.kind, game.id).toBe('string');
        expect(typeof event.step, game.id).toBe('number');
      }
    }
  });

  it('draws without reaching outside the Canvas2D slice, mirrored or not', () => {
    for (const game of BASKETBALL_ARCADE) {
      const run = startRun(game, arcadeConfig({ seed: `draw:${game.id}` }));
      drive(run, { press: pressInBand, steps: 200 });

      for (const mirror of [false, true]) {
        const canvas = recordingCanvas();
        expect(() => run.draw(canvas, { ...LAYOUT, mirror })).not.toThrow();
        expect(canvas.calls.length, game.id).toBeGreaterThan(0);
      }
    }
  });
});
