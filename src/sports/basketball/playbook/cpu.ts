/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.8 — Playbook CPU: call selection, weakness exploitation, per-difficulty competence
 * @story   US-15.7 — An opponent that reads me and gets harder as I ask it to
 * @design  09-modes-and-arcade.md §2.2 (soft rock-paper-scissors), §2.5 (one difficulty ladder),
 *          06-game-design.md §7 (the difficulty table)
 * @invariant INV-1 (difficulty never modifies athlete attributes or derived ratings),
 *            INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: the opponent. Where the assistant coach (`coach.ts`) asks "what suits us", the CPU also
 * asks "what have they been doing, and what did it cost us" — and then plays that answer as well as
 * its difficulty lets it.
 *
 * **Difficulty is competence, never a thumb on the scale.** INV-1 is not a suggestion: the CPU
 * reads the same ratings the player's athletes have, resolves through the same model, and the only
 * thing a level changes is how well it *chooses*. `decisionNoise` widens the softmax it samples
 * from — a Rookie CPU sees the same board and picks worse. There is a test asserting that no
 * rating, on either side, differs by difficulty.
 *
 * **Weakness exploitation is memory, not clairvoyance.** The CPU reads the committed turns, which
 * are exactly what the player also saw happen. It counts what each of their calls has been worth
 * and what its own answers conceded, and it leans accordingly. It never reads the pending
 * resolution, the RNG, or anything the player could not have counted themselves.
 *
 * **A read decays.** `09` §2.2 wants soft counters, and a CPU that permanently punished the third
 * possession of a match would be the hard counter that section forbids. The tendency window is the
 * recent past, so a player who changes what they are doing is out of the read within a few
 * possessions.
 */
import type { Rng } from '../../../engine/rng.ts';
import type { Side } from '../../../engine/match/events.ts';
import { difficultyProfile } from '../../../modes/difficulty.ts';
import type {
  CallId,
  PlaybookCall,
  PlaybookState,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import { levelOf } from '../../../modes/playbook/types.ts';
import { repeatPenalty, scaleRead, varietyStrength } from '../../../modes/playbook/read.ts';
import { DEFENSIVE_PROFILES, OFFENSIVE_PROFILES, areaOf, offensiveProfile } from './calls.ts';
import { scoreDefence, scoreOffence, type ScoredCall } from './coach.ts';
import { primaryOption, zoneValue, type BasketballPlaybookState } from './resolution.ts';

type State = PlaybookState<BasketballPlaybookState>;

/**
 * How many recent possessions the read covers. Twelve is about an eighth of a side's match: long
 * enough to be a tendency rather than a coincidence, short enough that changing your calls gets you
 * out of it inside a couple of minutes.
 */
export const READ_WINDOW = 12;

/** Points-per-possession the softmax is measured in, at zero noise. See `coach.ts`. */
const BASE_TEMPERATURE = 0.06;

/**
 * How much `decisionNoise` widens the temperature. At Legend (0.04) the CPU is close to taking the
 * best call; at Rookie (0.35) it is sampling most of the sheet.
 */
const NOISE_TO_TEMPERATURE = 1.4;

/** How hard a read is allowed to push a call's score, in points-per-possession. */
const READ_WEIGHT = 0.22;

/**
 * How hard leaning on one call is allowed to push it *down*, in the same units.
 *
 * Smaller than the read, deliberately: a CPU that varies harder than it exploits is a CPU choosing
 * worse calls on purpose, which is a different thing from being hard to read.
 *
 * @spec-ref 06-game-design.md §7 — exploits mismatches: no · rarely · often · consistently
 */
const REPEAT_WEIGHT = 0.14;

/** The calls this side has made in the window, on the same side of the ball it is calling now. */
function ownCalls(
  turns: readonly TurnResolution[],
  side: Side,
  defending: boolean,
  window = READ_WINDOW,
): { call: CallId }[] {
  return turns
    .filter((turn) => (turn.attacking === side) !== defending)
    .slice(-window)
    .map((turn) => ({ call: defending ? turn.calls.defence.call : turn.calls.offence.call }));
}

/** What the CPU has noticed about one of the opponent's calls. */
export interface CallRead {
  readonly call: CallId;
  readonly times: number;
  /** Points it has been worth them, per possession. */
  readonly perTurn: number;
  /** Share of the window this call accounts for, `0–1`. */
  readonly share: number;
}

/**
 * What the opponent has been calling lately, most-used first. Reads only committed turns — the same
 * history the player watched.
 */
export function readTendencies(
  turns: readonly TurnResolution[],
  attacking: Side,
  window = READ_WINDOW,
): CallRead[] {
  const recent = turns.filter((turn) => turn.attacking === attacking).slice(-window);
  if (recent.length === 0) return [];

  const tally = new Map<CallId, { times: number; points: number }>();
  for (const turn of recent) {
    const call = turn.calls.offence.call;
    const line = tally.get(call) ?? { times: 0, points: 0 };
    line.times += 1;
    line.points += turn.points;
    tally.set(call, line);
  }

  return [...tally.entries()]
    .map(([call, line]) => ({
      call,
      times: line.times,
      perTurn: line.points / line.times,
      share: line.times / recent.length,
    }))
    .sort((a, b) => b.share - a.share || a.call.localeCompare(b.call));
}

/**
 * The defensive adjustment a read is worth, per call. A defence that suppresses the area the
 * opponent keeps shooting from is worth more; one that concedes it is worth less. The size of the
 * adjustment scales with how *lopsided* the tendency is, so a balanced opponent moves nothing.
 */
export function readAdjustment(reads: readonly CallRead[], defensiveCall: CallId): number {
  const defence = DEFENSIVE_PROFILES.find((profile) => profile.id === defensiveCall);
  if (defence === undefined || reads.length === 0) return 0;

  let adjustment = 0;
  for (const read of reads) {
    const offence = OFFENSIVE_PROFILES.find((profile) => profile.id === read.call);
    if (offence === undefined) continue;
    // A call the opponent leans on *and* which has been paying is the one worth taking away.
    const hurt = Math.max(0, read.perTurn - 1) + 0.4;
    adjustment += defence.contest[areaOf(offence.zone)] * read.share * hurt;
  }

  return adjustment * READ_WEIGHT * 4;
}

/**
 * The offensive adjustment a read of the *defence* is worth. Symmetrical, and the reason the CPU
 * does not simply spam its best play: if the human keeps calling the zone, the CPU should shoot
 * over it.
 */
export function readAdjustmentForOffence(
  turns: readonly TurnResolution[],
  attacking: Side,
  offensiveCall: CallId,
  window = READ_WINDOW,
): number {
  const recent = turns.filter((turn) => turn.attacking === attacking).slice(-window);
  if (recent.length === 0) return 0;

  const offence = offensiveProfile(offensiveCall);
  const area = areaOf(offence.zone);

  let adjustment = 0;
  for (const turn of recent) {
    const defence = DEFENSIVE_PROFILES.find((profile) => profile.id === turn.calls.defence.call);
    if (defence === undefined) continue;
    // A defence that concedes this area is a defence to attack there.
    adjustment -= defence.contest[area] / recent.length;
  }

  return adjustment * READ_WEIGHT * 4;
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

/** Samples a scored sheet at a temperature. Shared by every difficulty; only the width differs. */
function sample(scored: readonly ScoredCall[], temperature: number, rng: Rng): ScoredCall {
  const top = (scored[0] as ScoredCall).score;
  const weights = scored.map((candidate) => Math.exp((candidate.score - top) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  let ticket = rng.float(0, total);
  for (const [index, candidate] of scored.entries()) {
    ticket -= weights[index] ?? 0;
    if (ticket <= 0) return candidate;
  }
  return scored[0] as ScoredCall;
}

/**
 * The CPU's call. Scores the sheet the way the coach does, adds what it has read of the opponent,
 * and samples at its difficulty's temperature.
 *
 * `turns` is the match's committed history. It is passed in rather than read off the state because
 * the state deliberately does not carry it: nothing else needs the log, and a CPU that could reach
 * for arbitrary match state is a CPU that will eventually reach for the pending resolution.
 */
export function cpuCall(
  state: State,
  side: Side,
  rng: Rng,
  turns: readonly TurnResolution[] = [],
): PlaybookCall {
  const defending = side !== state.possession;
  const opponent: Side = side === 1 ? 0 : 1;

  // How hard this level reads, and how hard it works at not being read (T-7.6). Both are `06` §7's
  // exploits row, which had no reader in the project until now: before this, a Rookie CPU punished
  // a repeated call exactly as ruthlessly as a Legend one.
  const level = levelOf(state, side);
  const variety = varietyStrength(level);
  const own = ownCalls(turns, side, defending);

  const sheet = defending ? scoreDefence(state, side) : scoreOffence(state, side);
  const scored = sheet.map((candidate) => ({
    ...candidate,
    score:
      candidate.score +
      scaleRead(
        defending
          ? readAdjustment(readTendencies(turns, opponent), candidate.call)
          : readAdjustmentForOffence(turns, side, candidate.call),
        level,
      ) -
      repeatPenalty(own, candidate.call, REPEAT_WEIGHT, variety, sheet.length),
  }));

  if (scored.length === 0) return { side, call: defending ? 'man' : 'motion' };

  const ordered = [...scored].sort((a, b) => b.score - a.score || a.call.localeCompare(b.call));
  const chosen = sample(ordered, temperatureFor(state, side), rng);

  if (defending) {
    // Double the Star needs somebody to double, and the CPU names the athlete the opponent's own
    // plays keep finding — a read, not a peek.
    if (chosen.call !== 'double') return { side, call: chosen.call };
    const star = starOf(state, opponent, turns);
    return star === undefined
      ? { side, call: chosen.call }
      : { side, call: chosen.call, target: star };
  }

  const profile = OFFENSIVE_PROFILES.find((candidate) => candidate.id === chosen.call);
  if (profile === undefined) return { side, call: chosen.call };
  const attackers = state.squads[side === 1 ? 1 : 0].players;
  return { side, call: chosen.call, target: primaryOption(attackers, profile, undefined).id };
}

/**
 * Who to double: whoever has actually been scoring, falling back to whoever the opponent's best
 * play would find. Points, not ratings — the CPU is reading the match, not the roster sheet.
 */
export function starOf(
  state: State,
  side: Side,
  turns: readonly TurnResolution[],
  window = READ_WINDOW,
): number | undefined {
  const recent = turns.filter((turn) => turn.attacking === side).slice(-window);
  const points = new Map<number, number>();
  for (const turn of recent) {
    if (turn.actor === undefined || turn.points === 0) continue;
    points.set(turn.actor, (points.get(turn.actor) ?? 0) + turn.points);
  }

  let best: number | undefined;
  let bestPoints = 0;
  for (const [actor, scored] of points) {
    if (scored > bestPoints) {
      bestPoints = scored;
      best = actor;
    }
  }
  if (best !== undefined) return best;

  const players = state.squads[side === 1 ? 1 : 0].players;
  let fallback: number | undefined;
  let fallbackRating = -Infinity;
  for (const player of players) {
    const rating = zoneValue('wingThree') * ((player.ratings['threePoint'] ?? 50) / 100);
    if (rating > fallbackRating) {
      fallbackRating = rating;
      fallback = player.id;
    }
  }
  return fallback;
}
