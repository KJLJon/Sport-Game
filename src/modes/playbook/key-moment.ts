/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.5 — Key-moment detection → arcade invocation → result fed back into resolution
 * @story   US-15.4 — Play the big moments myself
 * @design  09-modes-and-arcade.md §2.4 (key moments → arcade), §3.3 (structure of a run),
 *          §7 (reward parity)
 * @invariant INV-8 (determinism), INV-9 (one event stream), INV-10 (window size comes from the
 *            athlete), INV-12 (reward rate parity across modes)
 *
 * Purpose: the join between the turn engine and the arcade seam. An adapter proposes a moment; this
 * turns it into a real, calibrated arcade run, and turns what the player did back into something
 * `applyKeyMoment` can use.
 *
 * **The second caller of the arcade seam, and the first outside the hub.** Everything goes through
 * `startRun(game, config)` in `modes/arcade/modes.ts`, so a modifier, a calibration rule, or a
 * scoring change applied in one place is applied here too. If a key moment ever needs its own entry
 * point, the seam is wrong.
 *
 * **A key moment is unrewarded, and that is INV-12 talking.** The match already pays for this
 * possession through the event stream and `applyMatch`. Paying arcade coins on top would make
 * Playbook-with-key-moments the efficient farm, which is exactly what `09` §7 forbids. So the run
 * is `practice`: `isRewarded('practice')` is already `false`, and the reason is stated once here
 * rather than re-derived at each caller.
 *
 * **The run's own events are thrown away.** The arcade session emits `SportEvent`s for T-4.10's
 * progression, and the possession they describe is the same possession the turn is about — keeping
 * both would book the shot twice. `applyKeyMoment` builds the replacement events; this file never
 * forwards the run's (INV-9: one stream, one shot).
 */
import type { InputFrame } from '../../engine/input/types.ts';
import type { ArcadeRun } from '../arcade/session.ts';
import { startRun } from '../arcade/modes.ts';
import type { ArcadeConfig, ArcadeGameDef, ArcadeRunRules } from '../arcade/types.ts';
import type {
  ArcadeInvocation,
  KeyMomentOutcome,
  PlaybookAthlete,
  PlaybookState,
} from './types.ts';

/** One attempt and it is over: a key moment is a moment, not a round (`09` §2.4). */
export const KEY_MOMENT_RULES: ArcadeRunRules = { lives: 1, seconds: null };

/** The athlete a moment belongs to, or `undefined` when the id is not on the floor. */
export function findAthlete<S>(
  state: PlaybookState<S>,
  id: number | undefined,
): PlaybookAthlete | undefined {
  if (id === undefined) return undefined;
  for (const squad of state.squads) {
    const found = squad.players.find((player) => player.id === id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The run's configuration. The athlete and the difficulty are all `calibrate()` will ever see, and
 * that is INV-10 stated as a call site: there is no personal best in scope to pass even by mistake.
 */
export function keyMomentConfig<S>(
  state: PlaybookState<S>,
  invocation: ArcadeInvocation,
  seed: string,
): ArcadeConfig | null {
  const athlete = findAthlete(state, invocation.actor);
  if (athlete === undefined) return null;

  return {
    mode: 'practice',
    // Derived from the match seed and the turn, so replaying a match replays its key moments too.
    seed: `${seed}:key-${state.turn}`,
    athlete: athlete.athlete,
    difficulty: state.difficulty,
    rules: KEY_MOMENT_RULES,
  };
}

/** Starts the moment. `null` when the sport has no game by that id, which is a bug worth seeing. */
export function startKeyMoment<S>(
  games: readonly ArcadeGameDef[],
  state: PlaybookState<S>,
  invocation: ArcadeInvocation,
  seed: string,
): ArcadeRun | null {
  const game = games.find((candidate) => candidate.id === invocation.game);
  const config = keyMomentConfig(state, invocation, seed);
  if (game === undefined || config === null) return null;
  return startRun(game, config);
}

/** What the caller passes to `settleKeyMoment()`. */
export type KeyMomentResult = Omit<KeyMomentOutcome, 'invocation' | 'simWouldHave'>;

/**
 * Reads a finished — or first-attempt — run as an outcome.
 *
 * A run with no attempt at all is a miss with zero quality rather than an exception: the player may
 * have backgrounded the app, and losing the possession is a better answer than losing the match.
 */
export function outcomeOf(run: ArcadeRun): KeyMomentResult {
  const last = run.view().lastOutcome;
  if (last === null) return { made: false, quality: 0 };
  return { made: last.made, quality: last.quality };
}

/** True once the moment has been decided — one attempt is the whole run. */
export function attemptLanded(run: ArcadeRun): boolean {
  return run.finished || run.view().attempts > 0;
}

/**
 * Drives a moment to its single attempt with a supplied input, for the headless callers — the
 * parity harness and the tests. The screen steps the run itself, from real frames.
 */
export function playKeyMoment(
  run: ArcadeRun,
  input: (step: number) => InputFrame,
  dt = 1 / 60,
  maxSteps = 3600,
): KeyMomentResult {
  for (let step = 0; step < maxSteps && !attemptLanded(run); step += 1) {
    run.step(input(step), dt);
  }
  return outcomeOf(run);
}
