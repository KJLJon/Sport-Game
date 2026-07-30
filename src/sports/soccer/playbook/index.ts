/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.14 — Soccer Playbook: `PlaybookAdapter` + phase turns
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §2.3 (soccer: phase turns), §5 (mode architecture)
 * @invariant INV-5 (no sport branching outside the sport module), INV-8 (determinism),
 *            INV-9 (one event stream, no mode field)
 *
 * Purpose: soccer's `PlaybookAdapter` — the object `SportModule.playbook` points at, and the first
 * adapter in the project that is not basketball's.
 *
 * **This is what T-5.1's seam was for, so it is worth saying what held.** The turn engine
 * (`modes/playbook/match.ts`) needed no change to run a sport whose turns are phases of play rather
 * than possessions, whose clock counts one half at a time, whose scores are worth one point, and
 * whose calls persist between turns. The two members that made that true are `turnKind`, which was
 * already `'possession' | 'phase'`, and `CallOption.persists`, which T-5.1 added on the strength of
 * `09` §2.3 alone. `TurnResolution.retainsPossession` carries the whole of soccer's continuous
 * possession: a phase that climbs the ladder retains, one that is lost does not, and the engine
 * flips sides without knowing what a ladder is.
 *
 * **The one thing the seam does not carry**, recorded here rather than worked around: five intent
 * dimensions do not fit in one `CallId`. `calls.ts` explains the two options; T-6.19 picks one.
 *
 * Everything here is assembly. A rule that lives in this file rather than in `phases.ts`,
 * `calls.ts`, `resolution.ts`, or `narration.ts` is a mistake worth fixing.
 */
import type { Rng } from '../../../engine/rng.ts';
import type { Side } from '../../../engine/match/events.ts';
import { PlaybookMatch } from '../../../modes/playbook/match.ts';
import type { Difficulty } from '../../../modes/difficulty.ts';
import type {
  ArcadeInvocation,
  CallOption,
  CallPair,
  KeyMomentFrequency,
  NarrationLine,
  PlaybookAdapter,
  PlaybookCall,
  PlaybookSetup,
  PlaybookSquad,
  PlaybookState,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import { SOCCER_RULES, TIMING, stepsToGameSeconds } from '../rules.ts';
import {
  DEFAULT_PRESS,
  DEFAULT_TEMPO,
  PRESS_PROFILES,
  SOCCER_CALLS,
  TEMPO_PROFILES,
  pressProfile,
  tempoProfile,
} from './calls.ts';
import { narrateTurn } from './narration.ts';
import { OPENING_PHASE, nextPhase, type SoccerPhase } from './phases.ts';
import {
  createSoccerPlaybookState,
  drainStamina,
  keyRating,
  phaseOutcomeOf,
  resolvePhaseTurn,
  type SoccerPlaybookState,
} from './resolution.ts';

export type SoccerPlaybook = PlaybookAdapter<SoccerPlaybookState>;

/** Halves of extra time a level match plays before it is left level. See `isFinished` below. */
export const EXTRA_TIME_HALVES = 2;

/**
 * The phase this turn is played in.
 *
 * A half break is the one thing `SoccerPlaybookState.phase` cannot see coming: the turn engine
 * commits a turn, calls `apply()`, *then* spends the clock and may roll the period over, so the
 * period change always arrives after the state was last written. Reading it lazily here — rather
 * than trying to catch it in `apply()` — is why the second half kicks off from the halfway line
 * instead of resuming whatever the first half was interrupted mid-way through.
 */
function currentPhase(state: PlaybookState<SoccerPlaybookState>): SoccerPhase {
  return state.period === state.detail.period ? state.detail.phase : OPENING_PHASE;
}

/** What this side may call: the three tempos if they have the ball, the three press lines if not. */
function callsFor(state: PlaybookState<SoccerPlaybookState>, side: Side): readonly CallOption[] {
  const wanted = side === state.possession ? 'offence' : 'defence';
  return SOCCER_CALLS.filter((call) => call.side === wanted);
}

/**
 * A baseline opponent, so a match can be played and simulated. **T-6.22 owns the Playbook CPU** and
 * replaces this with one that reads the human's tendencies and answers per difficulty.
 *
 * What it does now is pick the intent its own squad is built for — a side of passers keeps it, a
 * side of runners goes direct, a side of tacklers presses — with a seeded wobble so it is not a
 * constant. That is a defensible coach and a deliberately unobservant opponent.
 */
function baselineCall(
  state: PlaybookState<SoccerPlaybookState>,
  side: Side,
  rng: Rng,
): PlaybookCall {
  const attacking = side === state.possession;
  const players = state.squads[side === 1 ? 1 : 0].players;
  const mean = (keys: readonly string[]): number =>
    players.reduce((total, player) => total + keyRating(player, keys), 0) / players.length;

  if (attacking) {
    const patient = mean(['shortPass', 'offBall']) + rng.fork('patient').gaussian(0, 5);
    const direct = mean(['longPass', 'pace']) + rng.fork('direct').gaussian(0, 5);
    if (Math.abs(patient - direct) < 4) return { side, call: DEFAULT_TEMPO };
    return { side, call: patient > direct ? TEMPO_PROFILES.patient.id : TEMPO_PROFILES.direct.id };
  }

  const press = mean(['tackling', 'pace']) + rng.fork('press').gaussian(0, 5);
  const block = mean(['marking', 'heading']) + rng.fork('block').gaussian(0, 5);
  if (Math.abs(press - block) < 4) return { side, call: DEFAULT_PRESS };
  return { side, call: press > block ? PRESS_PROFILES.high.id : PRESS_PROFILES.deep.id };
}

export const soccerPlaybook: SoccerPlaybook = {
  turnKind: 'phase',

  // The same clock Live shows, at the same compression: a Playbook half is forty-five game minutes
  // spent one phase of play at a time. `secondsPerStep` is soccer's own compression and nothing
  // else, so a Playbook half and a Live half are the same number of simulation steps (INV-11).
  clock: {
    periodSeconds: TIMING.halfGameSeconds,
    overtimeSeconds: TIMING.extraTimeGameSeconds,
    secondsPerStep: stepsToGameSeconds(1),
  },

  createState(setup: PlaybookSetup): SoccerPlaybookState {
    void setup;
    return createSoccerPlaybookState();
  },

  calls: callsFor,

  resolve(state: PlaybookState<SoccerPlaybookState>, calls: CallPair, rng: Rng): TurnResolution {
    return resolvePhaseTurn({ state, calls, rng, phase: currentPhase(state) });
  },

  /**
   * No key moments yet. **T-6.22 owns them** and `09` §2.4's soccer row — penalty, direct free
   * kick, one-on-one, header from a cross, goal-line save — needs the arcade games T-6.15 and
   * T-6.23–T-6.26 build, none of which exist. Proposing a moment whose mini-game is missing would
   * make the screen fall back to the sim's outcome on every turn, which is worse than not asking.
   */
  keyMoment(): ArcadeInvocation | null {
    return null;
  },

  /**
   * Two halves of extra time, and then the match is over however it stands.
   *
   * **This is covering a real defect, and it is worth naming rather than absorbing.**
   * `MatchStateMachine` keeps offering another overtime period while the score is level and
   * `MatchRules.overtimeSteps` is set, which is right for basketball — a tied basketball game plays
   * OT after OT until somebody leads — and wrong for soccer, which plays exactly two extra halves
   * and then takes penalties. Nothing capped it, so a level soccer match ran until the turn engine's
   * `MAX_TURNS` guard caught it: the worst seed in the T-6.14 batch reached **period 15**.
   *
   * Live has the same bug for the same reason and is not fixed here — T-6.14 owns a Playbook
   * adapter, not soccer's Live clock. It is logged in `PROGRESS.md` as a Phase 6 gap for T-6.17 to
   * take, where an engine-side `maxOvertimePeriods` on `MatchRules` would serve every sport instead
   * of one mode of one.
   *
   * A match still level after extra time is a draw for now. The shootout that should decide it is
   * T-6.15's Penalty Shootout arcade game, and wiring it in is T-6.22's key-moment work.
   *
   * @spec-ref 06-game-design.md §3.2 — "extra time then penalties"
   */
  isFinished(state: PlaybookState<SoccerPlaybookState>): boolean {
    return state.period > SOCCER_RULES.periods + EXTRA_TIME_HALVES;
  },

  narrate(state: PlaybookState<SoccerPlaybookState>, resolution: TurnResolution): NarrationLine {
    return narrateTurn(state, resolution);
  },

  /**
   * Where the ball is next, what it cost, and what each side asked for.
   *
   * The phase transition is derived from the outcome rather than carried on the resolution, so the
   * graph in `phases.ts` is the only thing that decides what follows what — including for a
   * resolution that came back from an arcade key moment in T-6.22.
   */
  apply(state: PlaybookState<SoccerPlaybookState>, resolution: TurnResolution): void {
    const attacking = resolution.attacking === 1 ? 1 : 0;
    const defending = attacking === 1 ? 0 : 1;
    const phase = currentPhase(state);

    state.detail.phase = nextPhase(phase, phaseOutcomeOf(resolution.outcome)).phase;
    state.detail.period = state.period;
    state.detail.intent[attacking] = resolution.calls.offence.call;
    state.detail.intent[defending] = resolution.calls.defence.call;
    if (resolution.events.some((turnEvent) => turnEvent.kind === 'shot')) {
      state.detail.shots[attacking] += 1;
    }

    drainStamina(
      state.squads[attacking].players,
      tempoProfile(resolution.calls.offence.call).effort,
    );
    drainStamina(
      state.squads[defending].players,
      pressProfile(resolution.calls.defence.call).effort,
    );
  },

  autoCall: baselineCall,
};

/**
 * A soccer Playbook match, ready to take calls. The one door — the turn screen, the hot-seat flow,
 * and the balance harness all come through here, so the rules and the clock cannot differ between
 * them.
 */
export function createSoccerPlaybook(options: {
  readonly seed: string;
  readonly squads: readonly [PlaybookSquad, PlaybookSquad];
  readonly playerSide?: Side;
  readonly difficulty?: Difficulty;
  readonly keyMoments?: KeyMomentFrequency;
}): PlaybookMatch<SoccerPlaybookState> {
  return new PlaybookMatch<SoccerPlaybookState>({
    seed: options.seed,
    adapter: soccerPlaybook,
    sport: 'soccer',
    rules: SOCCER_RULES,
    squads: options.squads,
    ...(options.playerSide === undefined ? {} : { playerSide: options.playerSide }),
    ...(options.difficulty === undefined ? {} : { difficulty: options.difficulty }),
    ...(options.keyMoments === undefined ? {} : { keyMoments: options.keyMoments }),
  });
}

export { SOCCER_CALLS, pressProfile, tempoProfile } from './calls.ts';
export { narrateTurn } from './narration.ts';
export {
  PHASE_TURN_SECONDS,
  SOCCER_PHASES,
  nextPhase,
  phaseBallX,
  phaseName,
  phaseThird,
} from './phases.ts';
export { PHASE_ODDS, phaseOutcomeOf, resolvePhaseTurn } from './resolution.ts';
export { soccerSquad, soccerSquads } from './squad.ts';
export type { SoccerPhase } from './phases.ts';
export type { SoccerPlaybookState } from './resolution.ts';
