/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.2 — Resolution model: ratings → matchup → outcome distribution → sampled events
 * @task    T-5.4 — Basketball play catalogue (offence + defence calls) and call-selection UI
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §2.2 (possession turns), §5 (mode architecture)
 * @invariant INV-5 (no sport branching outside the sport module), INV-8 (determinism)
 *
 * Purpose: basketball's `PlaybookAdapter` — the object `SportModule.playbook` points at. It wires
 * the call catalogue (`calls.ts`), the resolution model (`resolution.ts`), the narration
 * (`narration.ts`), and the key-moment detector (`key-moments.ts`) into the five members `09` §5
 * names, plus the three the turn engine needs.
 *
 * Everything here is assembly. If a rule lives in this file rather than in one of the four modules
 * beside it, that is a mistake worth fixing rather than a pattern worth following.
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
  KeyMomentOutcome,
  NarrationLine,
  PlaybookAdapter,
  PlaybookCall,
  PlaybookSetup,
  PlaybookSquad,
  PlaybookState,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import { BASKETBALL_RULES, TIMING, stepsToGameSeconds } from '../rules.ts';
import { BASKETBALL_CALLS, defensiveProfile, offensiveProfile } from './calls.ts';
import { drainStamina, resolvePossession, type BasketballPlaybookState } from './resolution.ts';

export type BasketballPlaybook = PlaybookAdapter<BasketballPlaybookState>;

function createState(setup: PlaybookSetup): BasketballPlaybookState {
  void setup;
  return { teamFouls: [0, 0], lastWasStop: false, period: 1 };
}

/** What this side may call: the offence's six if they have the ball, the defence's five if not. */
function callsFor(
  state: PlaybookState<BasketballPlaybookState>,
  side: Side,
): readonly CallOption[] {
  const wanted = side === state.possession ? 'offence' : 'defence';
  return BASKETBALL_CALLS.filter((call) => call.side === wanted);
}

/**
 * The CPU's call, until T-5.8 gives it a brain. Uniform over the catalogue on purpose: a
 * placeholder that quietly favoured one call would look like tuning and be mistaken for it, and
 * T-5.8's regression harness needs a flat baseline to measure a real CPU against.
 */
function autoCall(
  state: PlaybookState<BasketballPlaybookState>,
  side: Side,
  rng: Rng,
): PlaybookCall {
  const options = callsFor(state, side);
  const chosen = rng.pick(options) ?? options[0];
  return { side, call: chosen?.id ?? 'motion' };
}

/**
 * The adapter. `keyMoment` and `narrate` are filled in by T-5.5 and T-5.3 respectively; until then
 * they answer honestly rather than plausibly — no key moments, and a line that says what the
 * outcome was without pretending to be commentary.
 */
export const basketballPlaybook: BasketballPlaybook = {
  turnKind: 'possession',

  // The same clock Live shows, at the same compression — a Playbook quarter is twelve game minutes
  // spent one possession at a time, which is what makes possession counts comparable (INV-11).
  clock: {
    periodSeconds: TIMING.quarterGameSeconds,
    overtimeSeconds: TIMING.overtimeGameSeconds,
    secondsPerStep: stepsToGameSeconds(1),
  },

  createState,

  calls: callsFor,

  resolve(
    state: PlaybookState<BasketballPlaybookState>,
    calls: CallPair,
    rng: Rng,
  ): TurnResolution {
    return resolvePossession({ state, calls, rng });
  },

  keyMoment(): ArcadeInvocation | null {
    return null;
  },

  narrate(resolution: TurnResolution): NarrationLine {
    return {
      text: resolution.outcome.replace(/-/g, ' '),
      tone: resolution.points > 0 ? 'good' : 'neutral',
    };
  },

  applyKeyMoment(
    _state: PlaybookState<BasketballPlaybookState>,
    resolution: TurnResolution,
    outcome: KeyMomentOutcome,
  ): TurnResolution {
    return { ...resolution, fromKeyMoment: outcome };
  },

  /**
   * Fatigue, team fouls, and the stop flag Push Tempo reads. The offence works, the defence works
   * at whatever its scheme costs, and everybody recovers a little — so a press is expensive for
   * both sides, which is the trade `09` §2.2 describes.
   */
  apply(state: PlaybookState<BasketballPlaybookState>, resolution: TurnResolution): void {
    const attacking = resolution.attacking === 1 ? 1 : 0;
    const defending = attacking === 1 ? 0 : 1;
    drainStamina(
      state.squads[attacking].players,
      offensiveProfile(resolution.calls.offence.call).effort,
    );
    drainStamina(
      state.squads[defending].players,
      defensiveProfile(resolution.calls.defence.call).effort,
    );

    state.detail.lastWasStop = resolution.points === 0;
    if (resolution.outcome === 'and-one' || resolution.outcome.startsWith('free-throw')) {
      state.detail.teamFouls[defending] += 1;
    }
    if (state.period !== state.detail.period) {
      state.detail.teamFouls[0] = 0;
      state.detail.teamFouls[1] = 0;
      state.detail.period = state.period;
    }
  },

  autoCall,
};

/**
 * A basketball Playbook match, ready to take calls. The one door — the turn screen, the hot-seat
 * flow, and the balance harness all come through here, so the rules and the clock cannot differ
 * between them.
 */
export function createBasketballPlaybook(options: {
  readonly seed: string;
  readonly squads: readonly [PlaybookSquad, PlaybookSquad];
  readonly playerSide?: Side;
  readonly difficulty?: Difficulty;
  readonly keyMoments?: KeyMomentFrequency;
}): PlaybookMatch<BasketballPlaybookState> {
  return new PlaybookMatch<BasketballPlaybookState>({
    seed: options.seed,
    adapter: basketballPlaybook,
    sport: 'basketball',
    rules: BASKETBALL_RULES,
    squads: options.squads,
    ...(options.playerSide === undefined ? {} : { playerSide: options.playerSide }),
    ...(options.difficulty === undefined ? {} : { difficulty: options.difficulty }),
    ...(options.keyMoments === undefined ? {} : { keyMoments: options.keyMoments }),
  });
}

export { BASKETBALL_CALLS } from './calls.ts';
export { basketballSquad, basketballSquads, playbookRatings } from './squad.ts';
export type { BasketballPlaybookState } from './resolution.ts';
