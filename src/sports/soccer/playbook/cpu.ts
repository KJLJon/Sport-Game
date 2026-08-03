/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.22 — Soccer Playbook: key moments → arcade, and the Playbook CPU's call selection
 * @story   US-15.7 — An opponent that reads me and gets harder as I ask it to
 * @design  09-modes-and-arcade.md §2.3 (the five intents), §2.2 (soft counters, not hard ones),
 *          §2.5 (one difficulty ladder), 06-game-design.md §7 (the difficulty table)
 * @invariant INV-1 (difficulty never modifies athlete attributes or derived ratings),
 *            INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: the soccer Playbook opponent. It replaces `index.ts`'s `baselineCall`, which set each
 * dimension to whatever its own squad was built for and never once looked across the halfway line.
 *
 * **Four decisions, not one.** Basketball's CPU picks a call from a sheet; soccer's picks a value on
 * each of four dimensions (`09` §2.3). They are scored and sampled independently, which is the
 * honest model: a coach who decides to press high has not thereby decided how wide to play, and
 * bundling them would have invented thirty-six composite "calls" the player never sees.
 *
 * **Difficulty is competence, never a thumb on the scale.** INV-1 again: the CPU reads the same
 * ratings, resolves through the same model, and the only thing a level changes is the temperature it
 * samples its own scoring at. A Rookie CPU sees exactly the board a Legend does and picks worse.
 *
 * **The read is memory, and it decays.** It counts what the opponent has set on each dimension over
 * a recent window — the same history the player watched — and leans against it. `09` §2.2 wants
 * *soft* counters, so a read moves a score by about the size of one intent's own effect and never
 * more: pressing correctly should beat pressing wrongly, and should not beat a better squad.
 *
 * **What is not here.** The key moments (`09` §2.4's penalty, direct free kick, one-on-one, header
 * from a cross, goal-line save) are the other half of T-6.22 and wait on the arcade games T-6.15 and
 * T-6.23–T-6.27, which do not exist yet. `soccerPlaybook.keyMoment()` still returns `null`, and it
 * says why in its own comment — proposing a moment whose mini-game is missing makes the screen fall
 * back to the sim on every turn, which is worse than not asking.
 */
import type { Rng } from '../../../engine/rng.ts';
import type { Side } from '../../../engine/match/events.ts';
import type { EntityId } from '../../../engine/world.ts';
import { difficultyProfile } from '../../../modes/difficulty.ts';
import type {
  CallId,
  PlaybookAthlete,
  PlaybookCall,
  PlaybookState,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import { levelOf } from '../../../modes/playbook/types.ts';
import {
  DEFAULT_INTENTS,
  callFrom,
  dimensionsFor,
  intentOption,
  optionsFor,
  type IntentDimension,
  type IntentEffect,
  type IntentOption,
  type SoccerIntents,
} from './intents.ts';
import type { SoccerPhase } from './phases.ts';
import { keyRating, type SoccerPlaybookState } from './resolution.ts';
import { outfieldOf } from './squad.ts';

type State = PlaybookState<SoccerPlaybookState>;
type Role = 'offence' | 'defence';

/**
 * How many recent turns the read covers.
 *
 * Ten rather than basketball's twelve, because a soccer match is 22 turns where a basketball one is
 * near 200: twelve turns would be half the match and no longer a *recent* tendency at all. Ten is
 * about a half, which is the unit a coach actually adjusts on.
 */
export const SOCCER_READ_WINDOW = 10;

/** Probability-shift units the softmax is measured in, at zero noise. */
const BASE_TEMPERATURE = 0.012;

/**
 * How much `decisionNoise` widens it. At Legend (0.04) the CPU is close to taking its best option;
 * at Rookie (0.35) it is sampling most of the row.
 */
const NOISE_TO_TEMPERATURE = 0.3;

/**
 * What a 20-point rating edge on what an option asks for is worth, in the same odds-shift units the
 * effects are written in.
 *
 * `INTENT_OPTIONS`' figures are 0.05-ish and deliberately so, so this makes ratings and tactics
 * matter about equally — `09` §2.2's "ratings beat mind-games" without making the mind-games
 * pointless. A squad twenty points better at crossing should want to cross; it should not want to
 * cross into a packed box.
 */
const FIT_WEIGHT = 0.05;

/**
 * How hard a read is allowed to push, in the same units.
 *
 * Sized against the numbers it has to argue with rather than picked. In a build-up phase a high
 * press denies `climb` 0.08 and a deep block concedes 0.05, so the intrinsic gap between the best
 * and worst press line is **0.13**. `PRESS_COUNTERS` puts the two counters at opposite ends
 * (+1 / −1), so a fully committed opponent moves them apart by `2 × READ_WEIGHT` = **0.16** — just
 * enough to flip the choice, and only when the tendency is near-total.
 *
 * That is what `09` §2.2's "soft counter" has to mean to be worth anything: at 0.06 the read never
 * flipped a call at all and was decoration, and much above 0.08 it would beat the squad. A 20-point
 * rating edge is `FIT_WEIGHT` on each of two options — 0.1 — so a side genuinely built to press
 * still presses through a read telling it not to, which is the right way round.
 */
const READ_WEIGHT = 0.08;

/** What a tired squad pays for an option that asks for work. */
const EFFORT_WEIGHT = 0.6;

/**
 * The one relationship the effect figures cannot express: tempo against press line.
 *
 * `IntentEffect` says what an option is worth on its own, which is enough for everything except a
 * genuine counter — and `09` §2.3 describes exactly one, in words: a high press wins the ball high
 * against a side that plays out, and is bypassed by one that goes long. Nothing in `attack`/`defend`
 * encodes "against", so it is written down here rather than smuggled into a number that means
 * something else.
 *
 * Read as: the press line in the row, facing the tempo in the column, is worth this much extra
 * (negative is worse). Symmetrical by construction — every row and column sums to zero — so the
 * read is a redistribution, never a free gain, and a CPU facing a balanced opponent chooses on the
 * merits alone.
 *
 * @spec-ref 09-modes-and-arcade.md §2.3 — "press line — how high to win the ball back"
 */
export const PRESS_COUNTERS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  high: { patient: 1, 'balanced-tempo': 0, direct: -1 },
  mid: { patient: 0, 'balanced-tempo': 0, direct: 0 },
  deep: { patient: -1, 'balanced-tempo': 0, direct: 1 },
};

/** The mirror of it, for the attacking side choosing a tempo against a press it has been shown. */
export function tempoCounter(tempo: CallId, press: CallId): number {
  return -(PRESS_COUNTERS[press]?.[tempo] ?? 0);
}

/** What one side has been setting on one dimension lately, most-used first. */
export interface IntentRead {
  readonly option: CallId;
  readonly times: number;
  /** Share of the window this option accounts for, `0–1`. */
  readonly share: number;
}

/**
 * What the opponent has been setting, per dimension. Reads only committed turns — exactly the
 * history the player also watched happen — and never the pending resolution or the generator.
 *
 * `role` is the role the *opponent* was in on those turns: their tempo is on the turns they were
 * attacking, their press line on the turns they were not.
 */
export function readIntents(
  turns: readonly TurnResolution[],
  side: Side,
  dimension: IntentDimension,
  role: Role,
  window = SOCCER_READ_WINDOW,
): IntentRead[] {
  const wanted = turns
    .filter((turn) => (role === 'offence' ? turn.attacking === side : turn.attacking !== side))
    .slice(-window);
  if (wanted.length === 0) return [];

  const tally = new Map<CallId, number>();
  for (const turn of wanted) {
    const call = role === 'offence' ? turn.calls.offence : turn.calls.defence;
    const id = call.intents?.[dimension] ?? DEFAULT_INTENTS[dimension];
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }

  return [...tally.entries()]
    .map(([option, times]) => ({ option, times, share: times / wanted.length }))
    .sort((a, b) => b.share - a.share || a.option.localeCompare(b.option));
}

/**
 * The shift in the odds this option is worth, in the phase the turn is actually being played in.
 *
 * A build-up turn is decided by `climb` and nothing else, so an option chosen for what it does to a
 * shot is a wasted decision there. Reading the phase is most of what separates this from
 * `baselineCall`, which scored every option the same way in every phase of the match.
 */
export function phaseValue(effect: IntentEffect, phase: SoccerPhase): number {
  if (phase === 'buildUp' || phase === 'progression') return effect.climb;
  if (phase === 'finalThird') return effect.create + effect.setPiece * 0.4;
  return effect.finish;
}

/**
 * What stretching the turn is worth, given the scoreboard.
 *
 * The one piece of match awareness the CPU has, and the one every real coach has: a side in front
 * wants the clock gone and a side behind wants turns. `duration` is the only effect that is about
 * time rather than probability, so it is priced separately rather than folded into `phaseValue`.
 */
export function clockValue(effect: IntentEffect, state: State, side: Side): number {
  const mine = state.score[side === 1 ? 1 : 0];
  const theirs = state.score[side === 1 ? 0 : 1];
  if (mine === theirs) return 0;
  // `duration` multiplies, so `> 1` is a longer turn: worth having when ahead, costly when behind.
  return (effect.duration - 1) * (mine > theirs ? 1 : -1) * 0.5;
}

/** How suited this squad is to what an option asks for, in the same units as an effect. */
export function squadFit(players: readonly PlaybookAthlete[], keys: readonly string[]): number {
  if (keys.length === 0 || players.length === 0) return 0;
  const mean =
    players.reduce((total, player) => total + keyRating(player, keys), 0) / players.length;
  return ((mean - 50) / 20) * FIT_WEIGHT * 0.05 * 20;
}

/** Mean stamina, `0–1`. A tired side should stop pressing before it stops running. */
function tiredness(players: readonly PlaybookAthlete[]): number {
  if (players.length === 0) return 0;
  return 1 - players.reduce((total, player) => total + player.stamina, 0) / players.length;
}

/** Everything an option is worth to this side, this turn, before the read. */
export function scoreOption(
  option: IntentOption,
  state: State,
  side: Side,
  role: Role,
  phase: SoccerPhase,
): number {
  const players = state.squads[side === 1 ? 1 : 0].players;
  const effect = role === 'offence' ? option.attack : option.defend;
  return (
    phaseValue(effect, phase) +
    (role === 'offence' ? clockValue(effect, state, side) : 0) +
    squadFit(players, option.keys) -
    effect.effort * tiredness(players) * EFFORT_WEIGHT
  );
}

/**
 * What the read adds to an option.
 *
 * Three relationships, and no more, because each of them is something a player can *notice*:
 * the press line against the tempo it faces, the focus channel against the channel it faces, and
 * width against width. Anything subtler than that is a CPU that appears to cheat.
 */
export function readValue(
  option: IntentOption,
  turns: readonly TurnResolution[],
  opponent: Side,
  role: Role,
): number {
  let value = 0;

  if (option.dimension === 'press') {
    for (const read of readIntents(turns, opponent, 'tempo', 'offence')) {
      value += (PRESS_COUNTERS[option.id]?.[read.option] ?? 0) * read.share;
    }
  }

  if (option.dimension === 'tempo') {
    for (const read of readIntents(turns, opponent, 'press', 'defence')) {
      value += tempoCounter(option.id, read.option) * read.share;
    }
  }

  if (option.dimension === 'focus') {
    // Defending, follow the channel they keep playing through. Attacking, go somewhere else.
    const theirs = readIntents(
      turns,
      opponent,
      'focus',
      role === 'offence' ? 'defence' : 'offence',
    );
    for (const read of theirs) {
      if (read.option === option.id) value += role === 'offence' ? -0.6 : 1;
    }
  }

  if (option.dimension === 'width') {
    // Meeting width with width: a side that keeps crossing is defended by a side that goes out to
    // meet it, and attacking into a stretched defence is worth doing centrally.
    const theirs = readIntents(
      turns,
      opponent,
      'width',
      role === 'offence' ? 'defence' : 'offence',
    );
    for (const read of theirs) {
      if (read.option === option.id) value += role === 'offence' ? -0.4 : 0.7;
    }
  }

  return value * READ_WEIGHT;
}

/**
 * Temperature for a difficulty. Higher noise, wider sampling, worse decisions.
 *
 * Per side (T-7.10): the two CPUs in a regression batch are playing at different levels, and a
 * temperature read off the match rather than off the caller would give them the same one.
 */
export function temperatureFor(state: State, side: Side = state.playerSide === 1 ? 0 : 1): number {
  return (
    BASE_TEMPERATURE + difficultyProfile(levelOf(state, side)).decisionNoise * NOISE_TO_TEMPERATURE
  );
}

interface Scored {
  readonly id: CallId;
  readonly score: number;
}

/** Samples a scored row at a temperature. Shared by every difficulty; only the width differs. */
function sample(scored: readonly Scored[], temperature: number, rng: Rng): CallId {
  const ordered = [...scored].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const top = (ordered[0] as Scored).score;
  const weights = ordered.map((candidate) => Math.exp((candidate.score - top) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  let ticket = rng.float(0, total);
  for (const [index, candidate] of ordered.entries()) {
    ticket -= weights[index] ?? 0;
    if (ticket <= 0) return candidate.id;
  }
  return (ordered[0] as Scored).id;
}

/** Every option on one dimension, scored. Exported because it is what the tests read. */
export function scoreDimension(
  dimension: IntentDimension,
  state: State,
  side: Side,
  role: Role,
  phase: SoccerPhase,
  turns: readonly TurnResolution[],
): { id: CallId; score: number }[] {
  const opponent: Side = side === 1 ? 0 : 1;
  return optionsFor(dimension).map((option) => ({
    id: option.id,
    score: scoreOption(option, state, side, role, phase) + readValue(option, turns, opponent, role),
  }));
}

/**
 * Who to follow, when the CPU's focus lands on an athlete.
 *
 * Defending, it is whoever has actually been on the ball and hurting — scorers first, then the
 * athlete the opponent's phases keep finding. Attacking, it is the CPU's own best on-ball player.
 * Points and appearances, not the roster sheet: the CPU is reading the match.
 */
export function markTarget(
  state: State,
  side: Side,
  role: Role,
  turns: readonly TurnResolution[],
  window = SOCCER_READ_WINDOW,
): EntityId | undefined {
  const watched: Side = role === 'offence' ? side : side === 1 ? 0 : 1;
  const recent = turns.filter((turn) => turn.attacking === watched).slice(-window);

  const scored = new Map<EntityId, number>();
  const touched = new Map<EntityId, number>();
  for (const turn of recent) {
    if (turn.actor === undefined) continue;
    touched.set(turn.actor, (touched.get(turn.actor) ?? 0) + 1);
    if (turn.points > 0) scored.set(turn.actor, (scored.get(turn.actor) ?? 0) + turn.points);
  }

  const best = (tally: Map<EntityId, number>): EntityId | undefined => {
    let winner: EntityId | undefined;
    let most = 0;
    for (const [id, count] of tally) {
      if (count > most) {
        most = count;
        winner = id;
      }
    }
    return winner;
  };

  const fromMatch = best(scored) ?? best(touched);
  if (fromMatch !== undefined) return fromMatch;

  // Nothing to read yet — an opening turn. Fall back to the squad, which is the only thing anyone
  // could know at kick-off, and exactly what a scouting report would say.
  const squad = state.squads[watched === 1 ? 1 : 0];
  const candidates = outfieldOf(squad);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((bestSoFar, player) =>
    keyRating(player, ['finishing', 'dribbling', 'offBall']) >
    keyRating(bestSoFar, ['finishing', 'dribbling', 'offBall'])
      ? player
      : bestSoFar,
  ).id;
}

/**
 * The CPU's call: a value on each of the four dimensions it is asked about, scored, read, and
 * sampled at its difficulty's temperature.
 *
 * Each dimension draws from its own labelled fork, so adding a dimension later cannot shift the
 * ones beside it — the same rule `engine/rng.ts` states for every other seeded decision (INV-8).
 */
export function cpuCall(
  state: State,
  side: Side,
  rng: Rng,
  turns: readonly TurnResolution[] = [],
): PlaybookCall {
  const role: Role = side === state.possession ? 'offence' : 'defence';
  const phase = state.detail.phase;

  const chosen: Record<string, CallId> = { ...DEFAULT_INTENTS };
  for (const dimension of dimensionsFor(role)) {
    chosen[dimension] = sample(
      scoreDimension(dimension, state, side, role, phase, turns),
      temperatureFor(state, side),
      rng.fork(dimension),
    );
  }

  const intents = chosen as unknown as SoccerIntents;
  if (intentOption(intents.focus)?.targeted !== true)
    return callFrom(side === 1 ? 1 : 0, role, intents);

  const target = markTarget(state, side, role, turns);
  return callFrom(side === 1 ? 1 : 0, role, intents, target);
}
