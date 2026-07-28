/**
 * Arcade fixtures: a mini-game that does exactly what a test tells it to, so the framework can be
 * exercised without any real game's mechanic getting in the way.
 */
import type { InputFrame } from '../../src/engine/input/types.ts';
import { Button, makeFrame } from '../../src/engine/input/types.ts';
import { EventKind } from '../../src/engine/match/events.ts';
import { calibrateWindow } from '../../src/modes/arcade/calibration.ts';
import type {
  ArcadeAttempt,
  ArcadeConfig,
  ArcadeGameDef,
  ArcadeGameView,
  ArcadeHost,
  ArcadeRunRules,
  ArcadeSession,
} from '../../src/modes/arcade/types.ts';
import { athlete } from './athletes.ts';

export interface FakeGameOptions {
  readonly id?: string;
  readonly scored?: ArcadeRunRules;
  readonly stars?: readonly [number, number, number];
  /** Called every update; the test decides what the game does. */
  readonly onUpdate?: (host: ArcadeHost, input: InputFrame, dt: number) => void;
  readonly rating?: number;
}

/** A game whose whole mechanic is "do what `onUpdate` says". */
export function fakeGame(options: FakeGameOptions = {}): ArcadeGameDef {
  return {
    id: options.id ?? 'test.game',
    sport: 'testsport',
    name: 'Test Game',
    blurb: 'A game for tests.',
    durationSeconds: 30,
    unlockAchievement: 'test.unlock',
    scored: options.scored ?? { lives: 3, seconds: null },
    stars: options.stars ?? [10, 20, 30],
    ratings: ['accuracy'],
    calibrate: (_subject, difficulty) =>
      calibrateWindow({ rating: options.rating ?? 60, familiarity: 50, difficulty }),
    mount: (host: ArcadeHost): ArcadeSession => ({
      prompt: 'Tap to score.',
      update(input, dt) {
        options.onUpdate?.(host, input, dt);
      },
      view: (): ArcadeGameView => ({ meter: 0.5, target: { from: 0.4, to: 0.6 }, caption: 'Go' }),
    }),
  };
}

export function arcadeConfig(overrides: Partial<ArcadeConfig> = {}): ArcadeConfig {
  return {
    mode: 'scored',
    seed: 'test-seed',
    athlete: athlete(),
    difficulty: 'pro',
    ...overrides,
  };
}

/** A made attempt worth `points`, carrying one score event for progression. */
export function madeAttempt(points = 10): ArcadeAttempt {
  return {
    made: true,
    points,
    quality: 1,
    label: 'Swish',
    events: [{ kind: EventKind.SCORE, step: 0, side: 0, value: 2 }],
  };
}

export function missedAttempt(): ArcadeAttempt {
  return { made: false, points: 0, quality: 0, label: 'Missed' };
}

/** A frame with the primary button freshly pressed. */
export function pressFrame(previous?: InputFrame): InputFrame {
  return makeFrame(0, 0, Button.A, previous);
}
