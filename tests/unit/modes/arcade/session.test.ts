/**
 * T-4.1 — the arcade run: lifecycle, lives, clock, scoring, streaks, events, and the result.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_FRAME } from '../../../../src/engine/input/types.ts';
import { EventKind } from '../../../../src/engine/match/events.ts';
import {
  ArcadeRun,
  READY_SECONDS,
  isRewarded,
  rulesFor,
} from '../../../../src/modes/arcade/session.ts';
import { PRACTICE_RULES } from '../../../../src/modes/arcade/types.ts';
import type { ArcadeHost } from '../../../../src/modes/arcade/types.ts';
import {
  arcadeConfig,
  fakeGame,
  madeAttempt,
  missedAttempt,
  pressFrame,
} from '../../../helpers/arcade.ts';

/** Steps a run to completion (or to `maxSteps`) at a fixed 60 Hz. */
function play(run: ArcadeRun, steps = 600): void {
  for (let i = 0; i < steps && !run.finished; i++) run.step(EMPTY_FRAME, 1 / 60);
}

describe('ArcadeRun lifecycle', () => {
  it('starts in ready and runs once the countdown expires', () => {
    const run = new ArcadeRun(fakeGame(), arcadeConfig());
    expect(run.view().phase).toBe('ready');
    expect(run.view().countdown).toBeCloseTo(READY_SECONDS, 5);

    run.step(EMPTY_FRAME, READY_SECONDS + 0.01);
    expect(run.view().phase).toBe('running');
  });

  it('a press during the countdown starts the run immediately', () => {
    const run = new ArcadeRun(fakeGame(), arcadeConfig());
    run.step(pressFrame(), 1 / 60);
    expect(run.view().phase).toBe('running');
  });

  it('does not advance the clock while it is still counting down', () => {
    const run = new ArcadeRun(fakeGame(), arcadeConfig());
    run.step(EMPTY_FRAME, 0.5);
    expect(run.view().elapsed).toBe(0);
  });

  it('ignores non-positive time steps', () => {
    const run = new ArcadeRun(fakeGame(), arcadeConfig());
    expect(run.step(EMPTY_FRAME, 0)).toEqual([]);
    expect(run.view().phase).toBe('ready');
  });

  it('reports no result until it is over', () => {
    const run = new ArcadeRun(fakeGame(), arcadeConfig());
    expect(run.result()).toBeNull();
    run.quit();
    expect(run.result()?.reason).toBe('quit');
  });
});

describe('scoring and lives', () => {
  it('adds points, counts makes, and tracks the best streak', () => {
    let calls = 0;
    const run = new ArcadeRun(
      fakeGame({
        onUpdate: (host: ArcadeHost) => {
          calls++;
          if (calls <= 3) host.attempt(madeAttempt(10));
          else if (calls === 4) host.attempt(missedAttempt());
          else if (calls === 5) host.attempt(madeAttempt(10));
        },
      }),
      arcadeConfig(),
    );

    run.start();
    for (let i = 0; i < 5; i++) run.step(EMPTY_FRAME, 1 / 60);

    const view = run.view();
    expect(view.score).toBe(40);
    expect(view.attempts).toBe(5);
    expect(view.made).toBe(4);
    expect(view.bestStreak).toBe(3);
    expect(view.streak).toBe(1);
    expect(view.lives).toBe(2);
  });

  it('ends the run when the last life goes', () => {
    const run = new ArcadeRun(fakeGame({ scored: { lives: 2, seconds: null } }), arcadeConfig());
    run.start();
    play(run, 10);

    // The fake game does nothing on its own, so drive the misses directly through the host.
    const misser = new ArcadeRun(
      fakeGame({
        scored: { lives: 2, seconds: null },
        onUpdate: (host) => host.attempt(missedAttempt()),
      }),
      arcadeConfig(),
    );
    misser.start();
    play(misser, 10);

    expect(run.finished).toBe(false);
    expect(misser.finished).toBe(true);
    expect(misser.result()?.reason).toBe('lives');
    expect(misser.result()?.attempts).toBe(2);
  });

  it('never subtracts points for a bad attempt', () => {
    const run = new ArcadeRun(
      fakeGame({ onUpdate: (host) => host.attempt({ ...missedAttempt(), points: -50 }) }),
      arcadeConfig(),
    );
    run.start();
    run.step(EMPTY_FRAME, 1 / 60);
    expect(run.view().score).toBe(0);
  });

  it('honours costsLife: false', () => {
    const run = new ArcadeRun(
      fakeGame({ onUpdate: (host) => host.attempt({ ...missedAttempt(), costsLife: false }) }),
      arcadeConfig(),
    );
    run.start();
    play(run, 20);
    expect(run.finished).toBe(false);
    expect(run.view().lives).toBe(3);
  });

  it('awards bonuses without counting them as attempts', () => {
    const run = new ArcadeRun(
      fakeGame({ onUpdate: (host) => host.bonus(25, 'Rhythm') }),
      arcadeConfig(),
    );
    run.start();
    run.step(EMPTY_FRAME, 1 / 60);
    expect(run.view().score).toBe(25);
    expect(run.view().attempts).toBe(0);
    expect(run.view().lastOutcome?.label).toBe('Rhythm');
  });

  it('ignores attempts and bonuses outside the running phase', () => {
    let host: ArcadeHost | null = null;
    const run = new ArcadeRun(
      fakeGame({
        onUpdate: (h) => {
          host = h;
        },
      }),
      arcadeConfig(),
    );
    run.start();
    run.step(EMPTY_FRAME, 1 / 60);
    run.quit();

    host?.attempt(madeAttempt(99));
    host?.bonus(99);
    expect(run.view().score).toBe(0);
  });
});

describe('the clock', () => {
  it('ends a clock-limited run on the buzzer, counting the last attempt', () => {
    const run = new ArcadeRun(
      fakeGame({
        scored: { lives: null, seconds: 1 },
        onUpdate: (host) => host.attempt(madeAttempt(5)),
      }),
      arcadeConfig(),
    );
    run.start();
    play(run);

    expect(run.finished).toBe(true);
    expect(run.result()?.reason).toBe('clock');
    expect(run.view().remaining).toBe(0);
    // 60 steps at 1/60 s, and the attempt on the final step still counts.
    expect(run.result()?.attempts).toBe(60);
  });

  it('reports null remaining for a lives-limited run', () => {
    const run = new ArcadeRun(fakeGame(), arcadeConfig());
    expect(run.view().remaining).toBeNull();
  });
});

describe('stars and the result', () => {
  it('rates the run against the game thresholds', () => {
    let calls = 0;
    const run = new ArcadeRun(
      fakeGame({
        stars: [10, 20, 30],
        onUpdate: (host) => {
          if (++calls <= 2) host.attempt(madeAttempt(10));
        },
      }),
      arcadeConfig(),
    );
    run.start();
    play(run, 5);
    expect(run.stars).toBe(2);
    expect(run.view().toNextStar).toBe(10);
    run.finish();
    expect(run.result()?.stars).toBe(2);
  });

  it('collects the events an attempt carried, stamped with the run step', () => {
    let calls = 0;
    const run = new ArcadeRun(
      fakeGame({
        onUpdate: (host) => {
          if (++calls === 3) host.attempt(madeAttempt());
        },
      }),
      arcadeConfig(),
    );
    run.start();
    const produced = [
      run.step(EMPTY_FRAME, 0.1),
      run.step(EMPTY_FRAME, 0.1),
      run.step(EMPTY_FRAME, 0.1),
    ];

    expect(produced[0]).toEqual([]);
    expect(produced[2]).toHaveLength(1);
    expect(produced[2]?.[0]?.kind).toBe(EventKind.SCORE);
    expect(produced[2]?.[0]?.step).toBe(3);
    expect(run.events()).toHaveLength(1);
  });

  it('carries the run identity into the result', () => {
    const config = arcadeConfig({ seed: 'daily-2026-07-28', difficulty: 'legend' });
    const run = new ArcadeRun(fakeGame({ id: 'test.free-throw' }), config);
    run.start();
    run.step(EMPTY_FRAME, 0.5);
    run.finish();

    const result = run.result();
    expect(result).toMatchObject({
      game: 'test.free-throw',
      sport: 'testsport',
      mode: 'scored',
      seed: 'daily-2026-07-28',
      athleteId: config.athlete.id,
      difficulty: 'legend',
      rewarded: true,
    });
    expect(result?.seconds).toBeCloseTo(0.5, 5);
  });

  it('finishing twice keeps the first reason', () => {
    const run = new ArcadeRun(fakeGame(), arcadeConfig());
    run.quit();
    run.finish('complete');
    expect(run.result()?.reason).toBe('quit');
  });
});

describe('modes', () => {
  it('practice is unlimited and unrewarded', () => {
    const game = fakeGame();
    const config = arcadeConfig({ mode: 'practice' });
    expect(rulesFor(game, config)).toEqual(PRACTICE_RULES);
    expect(isRewarded('practice')).toBe(false);

    const run = new ArcadeRun(
      fakeGame({ onUpdate: (host) => host.attempt(missedAttempt()) }),
      config,
    );
    run.start();
    play(run, 100);
    expect(run.finished).toBe(false);
    expect(run.view().lives).toBeNull();
  });

  it('daily runs use the game rules and are rewarded', () => {
    const game = fakeGame();
    expect(rulesFor(game, arcadeConfig({ mode: 'daily' }))).toEqual(game.scored);
    expect(isRewarded('daily')).toBe(true);
  });

  it('an explicit rules override wins over the mode', () => {
    const game = fakeGame();
    const rules = { lives: null, seconds: 12 };
    expect(rulesFor(game, arcadeConfig({ mode: 'practice', rules }))).toEqual(rules);
  });
});

describe('determinism (INV-8)', () => {
  it('two runs of the same seed with the same inputs agree exactly', () => {
    const build = (): ArcadeRun =>
      new ArcadeRun(
        fakeGame({
          onUpdate: (host) => {
            // A rating-free coin flip out of the run's own generator: identical seeds must agree.
            host.attempt(host.rng.bool(0.5) ? madeAttempt(7) : missedAttempt());
          },
          scored: { lives: null, seconds: 2 },
        }),
        arcadeConfig({ seed: 'fixed' }),
      );

    const a = build();
    const b = build();
    a.start();
    b.start();
    play(a);
    play(b);

    expect(a.result()?.score).toBe(b.result()?.score);
    expect(a.result()?.made).toBe(b.result()?.made);
    expect(a.result()?.bestStreak).toBe(b.result()?.bestStreak);
  });

  it('a different seed produces a different run', () => {
    const build = (seed: string): ArcadeRun => {
      const run = new ArcadeRun(
        fakeGame({
          onUpdate: (host) => host.attempt(host.rng.bool(0.5) ? madeAttempt(7) : missedAttempt()),
          scored: { lives: null, seconds: 2 },
        }),
        arcadeConfig({ seed }),
      );
      run.start();
      play(run);
      return run;
    };

    expect(build('one').result()?.score).not.toBe(build('two').result()?.score);
  });
});

describe('the view', () => {
  it('reports the game view only once the run is going', () => {
    const run = new ArcadeRun(fakeGame(), arcadeConfig());
    expect(run.view().game.caption).toBe('');
    run.start();
    run.step(EMPTY_FRAME, 1 / 60);
    expect(run.view().game.caption).toBe('Go');
    expect(run.view().prompt).toBe('Tap to score.');
  });

  it('draws through to the session when the game knows how', () => {
    const run = new ArcadeRun(fakeGame(), arcadeConfig());
    // The fake game defines no `draw`; calling it must be a no-op rather than a crash.
    expect(() =>
      run.draw({} as never, { width: 100, height: 100, mirror: false, reducedMotion: false }),
    ).not.toThrow();
  });
});
