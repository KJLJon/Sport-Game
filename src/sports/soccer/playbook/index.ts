/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.14 — Soccer Playbook: `PlaybookAdapter` + phase turns
 * @task    T-6.19 — Soccer Playbook: intent controls — tempo, width, risk, press, focus
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
 * **The one thing the seam did not carry, and how T-6.19 settled it.** Five intent dimensions do not
 * fit in one `CallId`. The choice was between encoding them into the id — `tempo:direct|width:wide`
 * — and giving `PlaybookCall` an optional `intents` map. The map won: it costs one optional field
 * that every sport not setting it ignores, and it keeps `call` meaning what it has always meant, so
 * narration, match history, and T-6.22's read window never learn what a dimension is. The composite
 * id would have put a parser between the CPU and its own decision, and made `PlaybookCall.call` mean
 * something no `CallOption.id` from `calls()` ever equals.
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
import type { Athlete } from '../../../athletes/types.ts';
import type { TurnDiagram } from '../../../modes/playbook/diagram.ts';
import { SOCCER_RULES, TIMING, stepsToGameSeconds } from '../rules.ts';
import {
  DEFAULT_INTENTS,
  callFrom,
  callOptionsFor,
  composeEffect,
  dimensionsFor,
  optionsFor,
  type SoccerIntents,
} from './intents.ts';
import { buildDiagram } from './diagram.ts';
import { narrateTurn } from './narration.ts';
import { OPENING_PHASE, nextPhase, type SoccerPhase } from './phases.ts';
import {
  createSoccerPlaybookState,
  drainStamina,
  intentsOf,
  keyRating,
  phaseOutcomeOf,
  resolvePhaseTurn,
  type SoccerPlaybookState,
} from './resolution.ts';
import { soccerSquads } from './squad.ts';

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

/** The role a side is in this turn — which decides which four intents it is asked about. */
function roleOf(state: PlaybookState<SoccerPlaybookState>, side: Side): 'offence' | 'defence' {
  return side === state.possession ? 'offence' : 'defence';
}

/**
 * The call sheet: every option on every dimension this side is asked about, tagged with its
 * `dimension` so the screen can lay it out as four rows of chips rather than one long list.
 */
function callsFor(state: PlaybookState<SoccerPlaybookState>, side: Side): readonly CallOption[] {
  return callOptionsFor(roleOf(state, side));
}

/**
 * A baseline opponent, so a match can be played and simulated. **T-6.22 owns the Playbook CPU** and
 * replaces this with one that reads the human's tendencies and answers per difficulty.
 *
 * What it does now is set each dimension to the option its own squad is built for, scoring every
 * option by the ratings it names (`IntentOption.keys`) with a seeded wobble, and taking the best.
 * That is one honest coach and a deliberately unobservant opponent: it never looks at what the other
 * side is doing, which is exactly the line `modes/playbook/types.ts` draws between `coach` and
 * `autoCall` and the gap T-6.22 fills.
 */
function baselineCall(
  state: PlaybookState<SoccerPlaybookState>,
  side: Side,
  rng: Rng,
): PlaybookCall {
  const role = roleOf(state, side);
  const players = state.squads[side === 1 ? 1 : 0].players;
  const mean = (keys: readonly string[]): number =>
    players.reduce((total, player) => total + keyRating(player, keys), 0) / players.length;

  const chosen: Record<string, string> = { ...DEFAULT_INTENTS };
  for (const dimension of dimensionsFor(role)) {
    let best = DEFAULT_INTENTS[dimension];
    let bestScore = -Infinity;
    for (const option of optionsFor(dimension)) {
      // Forked by dimension *and* option so adding an option later cannot shift the ones beside it.
      const score = mean(option.keys) + rng.fork(`${dimension}:${option.id}`).gaussian(0, 5);
      if (score > bestScore) {
        bestScore = score;
        best = option.id;
      }
    }
    chosen[dimension] = best;
  }

  const intents = chosen as unknown as SoccerIntents;
  if (intents.focus !== 'focus-player') return callFrom(side === 1 ? 1 : 0, role, intents);

  // Naming an athlete needs an athlete. Attacking, it is whoever the CPU rates highest on the ball;
  // defending, it is the opponent it rates highest — the closest this baseline comes to a read.
  const marks = role === 'offence' ? players : state.squads[side === 1 ? 0 : 1].players;
  const pick = marks
    .slice(1)
    .reduce((bestSoFar, player) =>
      keyRating(player, ['finishing', 'dribbling', 'offBall']) >
      keyRating(bestSoFar, ['finishing', 'dribbling', 'offBall'])
        ? player
        : bestSoFar,
    );
  return callFrom(side === 1 ? 1 : 0, role, intents, pick.id);
}

export const soccerPlaybook: SoccerPlaybook = {
  turnKind: 'phase',

  // How a roster becomes two elevens. `SportModule.meta.squadSize` already says how many athletes
  // that takes, so this member is only the mapping — and it is what lets the Playbook screen start
  // a soccer match without importing a soccer symbol by name (INV-5).
  squads(
    home: readonly Athlete[],
    away: readonly Athlete[],
  ): readonly [PlaybookSquad, PlaybookSquad] {
    return soccerSquads(home, away);
  },

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

  diagram(state: PlaybookState<SoccerPlaybookState>, resolution: TurnResolution): TurnDiagram {
    return buildDiagram(state, resolution);
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

    // The same merge `resolve()` did, on the same untouched inputs — so what is remembered is
    // exactly what was played, and a player who changed one chip keeps the other four (`09` §2.3).
    const offIntents = intentsOf(state, attacking, resolution.calls.offence);
    const defIntents = intentsOf(state, defending, resolution.calls.defence);

    state.detail.phase = nextPhase(phase, phaseOutcomeOf(resolution.outcome)).phase;
    state.detail.period = state.period;
    state.detail.intent[attacking] = offIntents;
    state.detail.intent[defending] = defIntents;
    if (resolution.events.some((turnEvent) => turnEvent.kind === 'shot')) {
      state.detail.shots[attacking] += 1;
    }

    drainStamina(state.squads[attacking].players, composeEffect(offIntents, 'offence').effort);
    drainStamina(state.squads[defending].players, composeEffect(defIntents, 'defence').effort);
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

export {
  DEFAULT_INTENTS,
  INTENT_DIMENSIONS,
  INTENT_OPTIONS,
  callFrom,
  callOptionsFor,
  composeEffect,
  dimensionsFor,
  headlineDimension,
  intentsFrom,
  optionsFor,
} from './intents.ts';
export type { IntentDimension, IntentOption, SoccerIntents } from './intents.ts';
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
export { soccerSquad } from './squad.ts';
export { soccerSquads };
export { buildDiagram } from './diagram.ts';
export type { SoccerPhase } from './phases.ts';
export type { SoccerPlaybookState } from './resolution.ts';
