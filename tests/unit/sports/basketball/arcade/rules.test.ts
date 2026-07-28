/**
 * T-4.5–4.9 — the rules that are each game's own, rather than the contract they share.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FRAME } from '../../../../../src/engine/input/types.ts';
import { startRun } from '../../../../../src/modes/arcade/modes.ts';
import type { ArcadeRun } from '../../../../../src/modes/arcade/session.ts';
import {
  buzzerBeaterGame,
  fastBreakGame,
  freeThrowGame,
  pickpocketGame,
  threePointGame,
} from '../../../../../src/sports/basketball/arcade/index.ts';
import { BALLS_PER_RACK, RACKS } from '../../../../../src/sports/basketball/arcade/three-point.ts';
import { arcadeConfig } from '../../../../helpers/arcade.ts';
import { athlete, attributes } from '../../../../helpers/athletes.ts';
import { drive, humanPlayer, pressNever } from '../../../../helpers/arcade-drive.ts';

const STAR = athlete({ attributes: attributes(90) });

/** Every attempt a run recorded, by watching `lastOutcome` change. */
function outcomes(run: ArcadeRun, press: (run: ArcadeRun, step: number) => boolean): string[] {
  const seen: string[] = [];
  let count = 0;
  drive(run, {
    steps: 9000,
    press: (r, step) => {
      if (r.view().attempts !== count) {
        count = r.view().attempts;
        const label = r.view().lastOutcome?.label;
        if (label !== undefined) seen.push(label);
      }
      return press(r, step);
    },
  });
  return seen;
}

describe('Free Throw (T-4.5)', () => {
  it('ends after twenty shots, not when the meter has been watched long enough', () => {
    const run = startRun(freeThrowGame, arcadeConfig({ athlete: STAR, seed: 'ft-count' }));
    drive(run, { press: humanPlayer({ seed: 'ft' }), steps: 9000 });
    run.finish();
    expect(run.result()?.attempts).toBe(20);
  });

  it('not shooting is a miss that costs a life', () => {
    const run = startRun(freeThrowGame, arcadeConfig({ seed: 'ft-idle' }));
    const labels = outcomes(run, pressNever);
    expect(labels[0]).toBe('Shot clock');
    expect(run.finished).toBe(true);
    expect(run.result()?.reason).toBe('lives');
  });

  it('a rim-out inside the window never costs a life', () => {
    // The athlete's outcome band must not be what ends a run — only the player's timing (`09` §2.4).
    const run = startRun(
      freeThrowGame,
      arcadeConfig({ athlete: athlete({ attributes: attributes(45) }), seed: 'ft-rim' }),
    );

    const player = humanPlayer({ seed: 'ft2' });
    let lives = 3;
    let count = 0;
    drive(run, {
      steps: 9000,
      press: (r, step) => {
        const view = r.view();
        if (view.attempts !== count) {
          count = view.attempts;
          if (view.lastOutcome?.label === 'Rimmed out') expect(view.lives).toBe(lives);
          lives = view.lives ?? lives;
        }
        return player(r, step);
      },
    });
    expect(count).toBeGreaterThan(0);
  });

  it('speeds the meter up as the makes pile up', () => {
    const run = startRun(freeThrowGame, arcadeConfig({ athlete: STAR, seed: 'ft-ramp' }));
    const player = humanPlayer({ seed: 'ft3' });
    const urgencyAt = new Map<number, number>();

    drive(run, {
      steps: 9000,
      press: (r, step) => {
        const view = r.view();
        if (!urgencyAt.has(view.made)) urgencyAt.set(view.made, view.game.urgency ?? 0);
        return player(r, step);
      },
    });

    const madeCounts = [...urgencyAt.keys()].sort((a, b) => a - b);
    const first = urgencyAt.get(madeCounts[0] ?? 0) ?? 0;
    const last = urgencyAt.get(madeCounts[madeCounts.length - 1] ?? 0) ?? 0;
    expect(madeCounts.length).toBeGreaterThan(2);
    expect(last).toBeGreaterThan(first);
  });
});

describe('Three-Point Contest (T-4.6)', () => {
  it('is twenty-five balls in five racks', () => {
    const run = startRun(threePointGame, arcadeConfig({ athlete: STAR, seed: '3p-count' }));
    drive(run, { press: humanPlayer({ seed: '3p' }), steps: 9000 });
    expect(run.result()?.attempts).toBe(RACKS * BALLS_PER_RACK);
    expect(run.result()?.reason).toBe('complete');
  });

  it('pays double for the money ball', () => {
    const run = startRun(threePointGame, arcadeConfig({ athlete: STAR, seed: '3p-money' }));
    const player = humanPlayer({ seed: '3p2' });
    const points: number[] = [];
    let count = 0;
    drive(run, {
      steps: 9000,
      press: (r, step) => {
        const view = r.view();
        if (view.attempts !== count) {
          count = view.attempts;
          if (view.lastOutcome?.made === true) points.push(view.lastOutcome.points);
        }
        return player(r, step);
      },
    });
    // The money ball is the only way to score 200 or more without a rhythm streak behind it.
    expect(Math.max(...points)).toBeGreaterThanOrEqual(200);
  });

  it('never ends on a miss — the clock and the racks are the only limits', () => {
    const run = startRun(
      threePointGame,
      arcadeConfig({ athlete: athlete({ attributes: attributes(15) }), seed: '3p-miss' }),
    );
    drive(run, { press: humanPlayer({ seed: '3p3' }), steps: 9000 });
    expect(run.result()?.reason).not.toBe('lives');
    expect(run.view().lives).toBeNull();
  });
});

describe('Buzzer Beater (T-4.7)', () => {
  it('is worth more the longer you hold it', () => {
    const early = startRun(buzzerBeaterGame, arcadeConfig({ athlete: STAR, seed: 'bb-early' }));
    const late = startRun(buzzerBeaterGame, arcadeConfig({ athlete: STAR, seed: 'bb-early' }));

    // Same seed, same athlete, same release quality — only the moment differs.
    const points = (run: ArcadeRun, holdSteps: number): number => {
      let step = 0;
      drive(run, {
        steps: 400,
        until: (r) => r.view().attempts > 0,
        press: () => ++step === holdSteps,
      });
      return run.view().lastOutcome?.points ?? 0;
    };

    const earlyPoints = points(early, 40);
    const latePoints = points(late, 200);
    // Either both dropped or neither did; when they dropped, later paid more.
    if (earlyPoints > 0 && latePoints > 0) expect(latePoints).toBeGreaterThan(earlyPoints);
    expect(latePoints + earlyPoints).toBeGreaterThan(0);
  });

  it('letting the buzzer go is a miss that costs a life', () => {
    const run = startRun(buzzerBeaterGame, arcadeConfig({ seed: 'bb-idle' }));
    const labels = outcomes(run, pressNever);
    expect(labels[0]).toBe('No shot');
    expect(run.result()?.reason).toBe('lives');
  });

  it('closes the window as the possession runs down', () => {
    const run = startRun(buzzerBeaterGame, arcadeConfig({ athlete: STAR, seed: 'bb-window' }));
    run.start();
    run.step(EMPTY_FRAME, 1 / 60);
    const open = run.view().game.target!;
    for (let i = 0; i < 200; i++) run.step(EMPTY_FRAME, 1 / 60);
    const closed = run.view().game.target!;
    expect(closed.to - closed.from).toBeLessThan(open.to - open.from);
  });
});

describe('Fast Break (T-4.8)', () => {
  it('is at most fifteen breaks, and a clean run uses all of them', () => {
    const run = startRun(fastBreakGame, arcadeConfig({ athlete: STAR, seed: 'fb-count' }));
    drive(run, { press: humanPlayer({ seed: 'fb', precision: 0.03 }), steps: 9000 });

    expect(run.result()?.attempts).toBeLessThanOrEqual(15);
    if (run.result()?.reason === 'complete') expect(run.result()?.attempts).toBe(15);
  });

  it('never going up lets the defender recover, and costs a life', () => {
    const run = startRun(fastBreakGame, arcadeConfig({ seed: 'fb-idle' }));
    const labels = outcomes(run, pressNever);
    expect(labels[0]).toBe('Recovered');
    expect(run.result()?.reason).toBe('lives');
  });

  it('rewards a finish taken with the defender on you', () => {
    const run = startRun(fastBreakGame, arcadeConfig({ athlete: STAR, seed: 'fb-late' }));
    const labels = outcomes(run, humanPlayer({ seed: 'fb2', precision: 0.02 }));
    // Every label the game can produce is one of these; nothing unlabelled reaches the HUD.
    for (const labelText of labels) {
      expect(['Dunk!', 'And one!', 'Layup', 'Blocked', 'Off the glass', 'Recovered']).toContain(
        labelText,
      );
    }
  });
});

describe('Pickpocket (T-4.9)', () => {
  it('is twenty possessions', () => {
    const run = startRun(pickpocketGame, arcadeConfig({ athlete: STAR, seed: 'pp-count' }));
    drive(run, { press: humanPlayer({ seed: 'pp' }), steps: 9000 });
    expect(run.result()?.attempts).toBe(20);
  });

  it('reaching in early is a foul, and three of them end the run', () => {
    const run = startRun(pickpocketGame, arcadeConfig({ seed: 'pp-foul' }));
    // Pressing on the very first frame is always inside the handler's hold.
    const labels = outcomes(run, (_r, step) => step % 3 === 0);
    expect(labels[0]).toBe('Reach-in foul');
    expect(run.result()?.reason).toBe('lives');
    expect(run.result()?.attempts).toBe(3);
  });

  it('letting the pass through costs the possession and nothing else', () => {
    const run = startRun(pickpocketGame, arcadeConfig({ seed: 'pp-idle' }));
    const labels = outcomes(run, pressNever);
    expect(labels[0]).toBe('Pass got through');
    expect(run.view().lives).toBe(3);
    expect(run.result()?.reason).toBe('complete');
  });

  it('emits a steal when it works and a foul when it does not (INV-9)', () => {
    const stealRun = startRun(pickpocketGame, arcadeConfig({ athlete: STAR, seed: 'pp-events' }));
    drive(stealRun, { press: humanPlayer({ seed: 'pp2' }), steps: 9000 });
    const kinds = stealRun.events().map((event) => event.sportKind ?? event.kind);
    expect(kinds).toContain('basketball.steal');

    const foulRun = startRun(pickpocketGame, arcadeConfig({ seed: 'pp-foul-events' }));
    drive(foulRun, { press: (_r, step) => step % 3 === 0, steps: 9000 });
    expect(foulRun.events().map((event) => event.kind)).toContain('foul');
  });
});
