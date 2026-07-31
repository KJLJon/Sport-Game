/**
 * T-6.15 — Penalty Shootout, and the contract soccer's arcade set keeps.
 *
 * Written as a set-wide contract from the first game rather than as one game's test, because
 * T-6.23–T-6.27 add four more against the same rules and the point of the file is that they cannot
 * quietly disagree. Basketball's `arcade/games.test.ts` is the same shape, and the overlap is
 * deliberate: these are claims about `ArcadeGameDef`, so every set has to make them.
 */
import { describe, expect, it } from 'vitest';
import {
  FREE_KICK_DISTANCE,
  FREE_KICK_ROUNDS,
  ONE_ON_ONE_ROUNDS,
  ROUNDS_PER_RUN,
  SOCCER_ARCADE,
  pickSide,
  windLabel,
} from '../../../../../src/sports/soccer/arcade/index.ts';
import { SOCCER_XP_AWARDS } from '../../../../../src/sports/soccer/xp.ts';
import { SOCCER_WEIGHTS } from '../../../../../src/sports/soccer/weights.ts';
import { soccer } from '../../../../../src/sports/soccer/index.ts';
import { duplicateIds } from '../../../../../src/modes/arcade/registry.ts';
import { startRun } from '../../../../../src/modes/arcade/modes.ts';
import { DIFFICULTIES } from '../../../../../src/modes/difficulty.ts';
import { EventKind } from '../../../../../src/engine/match/events.ts';
import { newSportSkill } from '../../../../../src/athletes/types.ts';
import { ARCADE_UNLOCKS_BY_ID } from '../../../../../src/achievements/ids.ts';
import { arcadeConfig } from '../../../../helpers/arcade.ts';
import { athlete, attributes } from '../../../../helpers/athletes.ts';
import { drive, pressEvery, pressInBand, pressNever } from '../../../../helpers/arcade-drive.ts';
import { recordingCanvas } from '../../../../helpers/canvas.ts';

const LAYOUT = { width: 390, height: 700, mirror: false, reducedMotion: false };

function soccerAthlete(rating: number): ReturnType<typeof athlete> {
  return athlete({
    primarySport: 'soccer',
    attributes: attributes(rating),
    sportSkills: { soccer: newSportSkill(75) },
  });
}

describe('the set', () => {
  it('is what has actually been built, and says nothing about what has not', () => {
    // T-6.25 and T-6.26 add Header and Last Line. Until they exist, the array is the three that do
    // — an absent thing is absent, not stubbed.
    expect(SOCCER_ARCADE.map((game) => game.id)).toEqual([
      'soccer.penalty-shootout',
      'soccer.free-kick',
      'soccer.one-on-one',
    ]);
    expect(soccer.arcade).toBe(SOCCER_ARCADE);
  });

  it('has no colliding ids', () => {
    expect(duplicateIds(SOCCER_ARCADE)).toEqual([]);
  });

  it('every game is unlocked by playing, and names an unlock the hub can explain', () => {
    for (const game of SOCCER_ARCADE) {
      expect(ARCADE_UNLOCKS_BY_ID.has(game.unlockAchievement)).toBe(true);
    }
  });

  it('every game fits 09 §3.1’s 20–90 second envelope', () => {
    for (const game of SOCCER_ARCADE) {
      expect(game.durationSeconds).toBeGreaterThanOrEqual(20);
      expect(game.durationSeconds).toBeLessThanOrEqual(90);
    }
  });

  it('every game has ascending star thresholds and a one-line blurb', () => {
    for (const game of SOCCER_ARCADE) {
      expect(game.stars[0]).toBeLessThan(game.stars[1]);
      expect(game.stars[1]).toBeLessThan(game.stars[2]);
      expect(game.blurb.length).toBeGreaterThan(10);
      expect(game.blurb.length).toBeLessThan(90);
    }
  });

  it('every game ends a scored run somehow — lives, a clock, or both', () => {
    for (const game of SOCCER_ARCADE) {
      expect(game.scored.lives !== null || game.scored.seconds !== null).toBe(true);
    }
  });

  it('every prompt is a single short line, because nothing here requires reading', () => {
    for (const game of SOCCER_ARCADE) {
      const run = startRun(game, arcadeConfig());
      const prompt = run.view().prompt;
      expect(prompt.split(' ').length).toBeLessThanOrEqual(10);
      expect(prompt).not.toContain('\n');
    }
  });
});

describe('calibration (INV-10)', () => {
  it('every game reads ratings soccer actually defines', () => {
    for (const game of SOCCER_ARCADE) {
      for (const rating of game.ratings) {
        expect(Object.keys(SOCCER_WEIGHTS), rating).toContain(rating);
      }
    }
  });

  it('a better athlete gets a wider window, at every difficulty', () => {
    const weak = soccerAthlete(25);
    const strong = soccerAthlete(90);

    for (const game of SOCCER_ARCADE) {
      for (const difficulty of DIFFICULTIES) {
        expect(game.calibrate(strong, difficulty).windowSeconds).toBeGreaterThan(
          game.calibrate(weak, difficulty).windowSeconds,
        );
        expect(game.calibrate(strong, difficulty).reactionSeconds).toBeGreaterThan(
          game.calibrate(weak, difficulty).reactionSeconds,
        );
      }
    }
  });

  it('learning soccer widens the window (US-16.3)', () => {
    const cold = athlete({ primarySport: 'basketball' });
    const warm = athlete({
      ...cold,
      sportSkills: { ...cold.sportSkills, soccer: newSportSkill(80) },
    });

    for (const game of SOCCER_ARCADE) {
      expect(game.calibrate(warm, 'pro').rating).toBeGreaterThan(
        game.calibrate(cold, 'pro').rating,
      );
    }
  });

  it('takes the athlete and the difficulty and nothing else — INV-10 is the signature', () => {
    for (const game of SOCCER_ARCADE) {
      expect(game.calibrate.length).toBe(2);
    }
  });
});

describe('every game plays', () => {
  it('produces attempts, events, and a result from a competent player', () => {
    const capable = soccerAthlete(88);

    for (const game of SOCCER_ARCADE) {
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
    for (const game of SOCCER_ARCADE) {
      const run = startRun(game, arcadeConfig({ seed: `end:${game.id}` }));
      drive(run, { press: pressEvery(7), steps: 8000 });
      expect(run.finished, game.id).toBe(true);
    }
  });

  it('a player who never touches the screen still finishes, and scores nothing', () => {
    for (const game of SOCCER_ARCADE) {
      const run = startRun(game, arcadeConfig({ seed: `idle:${game.id}` }));
      drive(run, { press: pressNever, steps: 12_000 });
      expect(run.finished, game.id).toBe(true);
      expect(run.view().score, game.id).toBe(0);
    }
  });

  it('is deterministic: the same seed and the same inputs give the same run (INV-8)', () => {
    for (const game of SOCCER_ARCADE) {
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
    for (const game of SOCCER_ARCADE) {
      const run = startRun(game, arcadeConfig({ seed: `events:${game.id}` }));
      drive(run, { press: pressInBand, steps: 6000 });

      for (const event of run.events()) {
        expect(Object.keys(event), game.id).not.toContain('mode');
        expect(typeof event.kind, game.id).toBe('string');
        expect(typeof event.step, game.id).toBe('number');
      }
    }
  });

  it('emits only zones soccer’s XP table knows, so a run actually trains something', () => {
    const known = new Set(
      SOCCER_XP_AWARDS.filter((award) => award.kind === EventKind.SHOT).map(
        (award) => award.when?.['zone'],
      ),
    );

    for (const game of SOCCER_ARCADE) {
      const run = startRun(
        game,
        arcadeConfig({ seed: `zones:${game.id}`, athlete: soccerAthlete(80) }),
      );
      drive(run, { press: pressInBand, steps: 6000 });

      const shots = run.events().filter((event) => event.kind === EventKind.SHOT);
      expect(shots.length, game.id).toBeGreaterThan(0);
      for (const shot of shots) expect(known, game.id).toContain(shot.detail?.['zone']);
    }
  });

  it('draws without reaching outside the Canvas2D slice, mirrored or not', () => {
    for (const game of SOCCER_ARCADE) {
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

describe('Penalty Shootout in particular', () => {
  const game = SOCCER_ARCADE[0]!;

  it('swaps roles every round, which is the thing `09` §3.2 asked for', () => {
    // Odd rounds are taken and even ones are kept, so exactly half the attempts — rounded up,
    // because a run starts by taking — put a shot on goal. Stated against the run's own attempt
    // count rather than against `ROUNDS_PER_RUN`: a three-life run usually ends before ten rounds,
    // and a test that assumed otherwise would be asserting the athlete rather than the alternation.
    for (const seed of ['swap-a', 'swap-b', 'swap-c']) {
      const run = startRun(game, arcadeConfig({ seed, athlete: soccerAthlete(85) }));
      drive(run, { press: pressInBand, steps: 8000 });
      run.finish();

      const attempts = run.result()?.attempts ?? 0;
      const shots = run.events().filter((event) => event.kind === EventKind.SHOT).length;
      expect(attempts, seed).toBeGreaterThan(1);
      expect(attempts, seed).toBeLessThanOrEqual(ROUNDS_PER_RUN);
      expect(shots, seed).toBe(Math.ceil(attempts / 2));
      // And the other half really were kept, rather than being taken silently.
      expect(attempts - shots, seed).toBeGreaterThan(0);
    }
  });

  it('scores saves as well as goals, so the defending half is worth playing', () => {
    // A keeper who commits gets some of them; over a batch of seeds at least one run must record a
    // save, or the second half of the game is unwinnable rather than hard.
    let saves = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const run = startRun(
        game,
        arcadeConfig({ seed: `save-${seed}`, athlete: soccerAthlete(88) }),
      );
      drive(run, { press: pressEvery(9), steps: 8000 });
      saves += run.events().filter((event) => event.kind === EventKind.SAVE).length;
    }
    expect(saves).toBeGreaterThan(0);
  });

  it('never lets the aim band leave the goal frame, whatever the keeper does', () => {
    // Sampled *while* the run advances — the band moves with the keeper's read, so a check at one
    // instant would only ever see one of the two shapes it can take.
    let sampled = 0;
    const run = startRun(game, arcadeConfig({ seed: 'band', athlete: soccerAthlete(70) }));
    drive(run, {
      steps: 4000,
      press: (current) => {
        const target = current.view().game.target;
        if (target !== null) {
          sampled += 1;
          expect(target.from).toBeGreaterThanOrEqual(0);
          expect(target.to).toBeLessThanOrEqual(1);
          expect(target.to).toBeGreaterThan(target.from);
        }
        return false;
      },
    });
    expect(sampled).toBeGreaterThan(100);
  });

  it('splits the goal into three even thirds — the keeper has no favourite side', () => {
    expect(pickSide(0)).toBe('left');
    expect(pickSide(0.5)).toBe('centre');
    expect(pickSide(0.99)).toBe('right');
    // A draw of exactly 1 must not fall off the end.
    expect(pickSide(1)).toBe('right');
  });

  it('is harder on a worse athlete, and the run still completes', () => {
    const score = (rating: number): number => {
      let total = 0;
      for (let seed = 0; seed < 8; seed += 1) {
        const run = startRun(
          game,
          arcadeConfig({ seed: `r${seed}`, athlete: soccerAthlete(rating) }),
        );
        drive(run, { press: pressInBand, steps: 8000 });
        run.finish();
        total += run.result()?.score ?? 0;
      }
      return total;
    };
    expect(score(90)).toBeGreaterThan(score(30));
  });
});

describe('Free Kick in particular', () => {
  const game = SOCCER_ARCADE[1]!;

  it('says what the wind is doing in words, not in an arrow alone', () => {
    // `10` §11 — nothing in an arcade game is conveyed by a glyph or a colour on its own.
    expect(windLabel(0)).toBe('still');
    expect(windLabel(0.01)).toBe('still');
    expect(windLabel(-0.05)).toContain('←');
    expect(windLabel(0.05)).toContain('→');
    expect(windLabel(0.1)).toContain('strong');
    expect(windLabel(-0.1)).toContain('strong');
    expect(windLabel(0.04)).toContain('light');
  });

  it('keeps the aim band inside the meter whatever the wind and the keeper do', () => {
    // The band is the gap *shifted back by the wind*, so it is the one thing in the game that can be
    // pushed off the end of the track. Sampled while the run advances, because both inputs are
    // redrawn every round.
    let sampled = 0;
    const run = startRun(game, arcadeConfig({ seed: 'fk-band', athlete: soccerAthlete(70) }));
    drive(run, {
      steps: 4000,
      press: (current) => {
        const target = current.view().game.target;
        if (target !== null) {
          sampled += 1;
          expect(target.from).toBeGreaterThanOrEqual(0);
          expect(target.to).toBeLessThanOrEqual(1);
          expect(target.to).toBeGreaterThan(target.from);
        }
        return false;
      },
    });
    expect(sampled).toBeGreaterThan(100);
  });

  it('pays for the distance, so the long ones are worth wanting', () => {
    // Kicks are drawn across `FREE_KICK_DISTANCE`, and a goal from the far end is worth more than
    // one from the near end. Asserted against the range rather than against a single kick, because
    // which distance a round draws is the run's business.
    expect(FREE_KICK_DISTANCE.max).toBeGreaterThan(FREE_KICK_DISTANCE.min);

    const distances = new Set<number>();
    for (let seed = 0; seed < 6; seed += 1) {
      const run = startRun(
        game,
        arcadeConfig({ seed: `fk-dist-${seed}`, athlete: soccerAthlete(80) }),
      );
      drive(run, { press: pressInBand, steps: 6000 });
      for (const event of run.events()) {
        if (event.kind === EventKind.SHOT && event.value !== undefined) distances.add(event.value);
      }
    }

    expect(distances.size).toBeGreaterThan(3);
    for (const distance of distances) {
      expect(distance).toBeGreaterThanOrEqual(FREE_KICK_DISTANCE.min);
      expect(distance).toBeLessThanOrEqual(FREE_KICK_DISTANCE.max);
    }
  });

  it('never runs past its own kick count, however well it is played', () => {
    const run = startRun(game, arcadeConfig({ seed: 'fk-rounds', athlete: soccerAthlete(95) }));
    drive(run, { press: pressInBand, steps: 12_000 });
    run.finish();
    expect(run.result()?.attempts ?? 0).toBeLessThanOrEqual(FREE_KICK_ROUNDS);
  });

  it('rewards a competent player and still lets a poor one finish', () => {
    const score = (rating: number): number => {
      let total = 0;
      for (let seed = 0; seed < 8; seed += 1) {
        const run = startRun(
          game,
          arcadeConfig({ seed: `fk-${seed}`, athlete: soccerAthlete(rating) }),
        );
        drive(run, { press: pressInBand, steps: 8000 });
        run.finish();
        total += run.result()?.score ?? 0;
      }
      return total;
    };
    expect(score(90)).toBeGreaterThan(score(30));
  });
});

describe('One-on-One in particular', () => {
  const game = SOCCER_ARCADE[2]!;

  it('wants the touch late, because the keeper has to commit before it beats them', () => {
    // The window's *position* is the lesson the game teaches, so it is asserted rather than left to
    // a constant nobody reads. Sampled across the approach of several rounds.
    let sampled = 0;
    const run = startRun(game, arcadeConfig({ seed: 'oo-late', athlete: soccerAthlete(70) }));
    drive(run, {
      steps: 4000,
      press: (current) => {
        const { meter, target } = current.view().game;
        // The approach runs from 0 upward and its band never bounces, so a sample taken while the
        // marker is still climbing is unambiguously the touch band rather than the finishing meter's.
        if (meter !== null && target !== null && meter < 0.05) {
          sampled += 1;
          expect((target.from + target.to) / 2).toBeGreaterThan(0.5);
        }
        return false;
      },
    });
    expect(sampled).toBeGreaterThan(10);
  });

  it('a better touch opens more goal — the two taps are cause and effect', () => {
    // The claim the whole game rests on: the finishing band after a good touch is wider than after
    // a poor one, for the *same* athlete on the *same* seed. Driven by pressing at a fixed point in
    // the approach, early (a poor touch) against on time (a good one).
    const openingAfter = (at: number): number => {
      let touched = false;
      let widest = 0;
      const run = startRun(game, arcadeConfig({ seed: 'oo-open', athlete: soccerAthlete(80) }));
      drive(run, {
        steps: 600,
        press: (current) => {
          const { meter, target } = current.view().game;
          if (meter === null || target === null) return false;
          if (!touched) {
            // Still in the approach: press once the marker reaches the asked-for point.
            if (meter >= at) {
              touched = true;
              return true;
            }
            return false;
          }
          widest = Math.max(widest, target.to - target.from);
          return false;
        },
      });
      return widest;
    };

    const poor = openingAfter(0.4);
    const good = openingAfter(0.67);
    expect(good).toBeGreaterThan(poor);
  });

  it('a chance not taken is a chance smothered, and it costs a life', () => {
    // Standing still through the approach must resolve rather than hang — the keeper arrives.
    const run = startRun(game, arcadeConfig({ seed: 'oo-idle', athlete: soccerAthlete(80) }));
    drive(run, { press: pressNever, steps: 3000 });
    expect(run.finished).toBe(true);
    expect(run.view().lastOutcome?.label).toBe('Smothered');
  });

  it('never runs past its own chance count', () => {
    const run = startRun(game, arcadeConfig({ seed: 'oo-rounds', athlete: soccerAthlete(95) }));
    drive(run, { press: pressInBand, steps: 12_000 });
    run.finish();
    expect(run.result()?.attempts ?? 0).toBeLessThanOrEqual(ONE_ON_ONE_ROUNDS);
  });

  it('rewards a competent player and still lets a poor one finish', () => {
    const score = (rating: number): number => {
      let total = 0;
      for (let seed = 0; seed < 8; seed += 1) {
        const run = startRun(
          game,
          arcadeConfig({ seed: `oo-${seed}`, athlete: soccerAthlete(rating) }),
        );
        drive(run, { press: pressInBand, steps: 8000 });
        run.finish();
        total += run.result()?.score ?? 0;
      }
      return total;
    };
    expect(score(90)).toBeGreaterThan(score(30));
  });
});
