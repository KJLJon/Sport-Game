/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.7 — Auto-call assistant coach, fast-forward, turn-speed control
 * @story   US-15.6 — Keep a long match from becoming a chore
 * @design  09-modes-and-arcade.md §2.1 (the Auto-call toggle), §2.2 (what each call keys off)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: the assistant coach — "what would this roster call here?". Scores every call in the
 * catalogue against the squad on the floor and the situation, then samples the scores so a stretch
 * of auto-called possessions does not become the same play forty times.
 *
 * **The coach reads your roster, not your opponent's.** It answers "what suits us" and stops there.
 * Counter-calling, tendency modelling, and per-difficulty competence are T-5.8's CPU, and keeping
 * them apart means the toggle a player leaves on cannot quietly out-think the opponent they are
 * playing against.
 *
 * **Scoring is per-possession points, roughly.** Each call's score is what the resolution model
 * would price it at — the shooter it would pick, the rating that shooter has, the zone's value —
 * so the coach and the model cannot disagree about what a good call is. It deliberately does not
 * *run* the model: a coach that simulated every call would be forty draws per turn and would also
 * see the dice.
 */
import type { Rng } from '../../../engine/rng.ts';
import type { Side } from '../../../engine/match/events.ts';
import type { CallId, PlaybookCall, PlaybookState } from '../../../modes/playbook/types.ts';
import { DEFENSIVE_PROFILES, OFFENSIVE_PROFILES } from './calls.ts';
import {
  RESOLUTION,
  primaryDefender,
  primaryOption,
  zoneValue,
  type BasketballPlaybookState,
} from './resolution.ts';

type State = PlaybookState<BasketballPlaybookState>;

/**
 * Softmax temperature, in points-per-possession. A call this much worse than the best is picked at
 * about a third of its weight; three times this much worse is picked almost never.
 *
 * A flat jitter was tried first and does not work: the gap between the best call and the rest is
 * roster-dependent, so any fixed amount of noise is either invisible on one roster or decisive on
 * another. Two hundred turns of the identical play is not a coach, and neither is a coin toss.
 */
const TEMPERATURE = 0.12;

/** Below this stamina, a call that costs effort is worth less than it looks. */
const TIRED = 0.75;

export interface ScoredCall {
  readonly call: CallId;
  readonly score: number;
  /** One line, for the coach's own explanation on the turn screen. */
  readonly because: string;
}

/** Every offensive call, priced for this squad and this moment, best first. */
export function scoreOffence(state: State, side: Side): ScoredCall[] {
  const attackers = state.squads[side === 1 ? 1 : 0].players;
  const defenders = state.squads[side === 1 ? 0 : 1].players;

  const scored = OFFENSIVE_PROFILES.map((profile) => {
    const shooter = primaryOption(attackers, profile, undefined);
    const defender = primaryDefender(defenders, profile);
    const shooterRating = shooter.ratings[profile.picks] ?? 50;
    const edge =
      ((shooter.ratings[profile.attackKey] ?? 50) - (defender.ratings[profile.defendKey] ?? 50)) /
      RESOLUTION.matchupDivisor;

    // A rough points-per-possession: how good is the athlete this play finds, how good is the
    // matchup, what is the shot worth, and how often does the play simply lose the ball.
    let score =
      zoneValue(profile.zone) *
      (0.28 + (shooterRating / 100) * 0.28 + edge * 0.06) *
      (1 - profile.turnover);
    score += profile.foul * 0.5;

    // Push Tempo is `09` §2.2's "after a stop, stamina in hand" — both halves, or it is just a
    // faster way to turn the ball over.
    if (profile.id === 'push') {
      const rested = attackers.every((player) => player.stamina > TIRED);
      if (!state.detail.lastWasStop || !rested) score -= 0.35;
    }
    if (attackers.some((player) => player.stamina < TIRED)) score -= profile.effort * 2;

    return {
      call: profile.id,
      score,
      because: `${shooter.athlete.displayName} at ${Math.round(shooterRating)} in ${profile.picks}`,
    };
  });

  return scored.sort((a, b) => b.score - a.score || a.call.localeCompare(b.call));
}

/**
 * Every defensive call, priced for this squad. Simpler than the offence on purpose: without reading
 * the opponent's tendencies — T-5.8's job — a defence is mostly a question of who you have.
 */
export function scoreDefence(state: State, side: Side): ScoredCall[] {
  const defenders = state.squads[side === 1 ? 1 : 0].players;
  const mean = (key: string): number => {
    if (defenders.length === 0) return 50;
    let total = 0;
    for (const player of defenders) total += player.ratings[key] ?? 50;
    return total / defenders.length;
  };

  const perimeter = mean('perimeterD');
  const interior = mean('interiorD');
  const speed = mean('courtSpeed');
  const tired = defenders.some((player) => player.stamina < TIRED);

  const scored = DEFENSIVE_PROFILES.map((profile) => {
    let score = 0.5;
    let because = 'A balanced look.';

    if (profile.id === 'man') {
      score += (perimeter - 50) / 120;
      because = 'Our perimeter defenders can hold up.';
    }
    if (profile.id === 'zone') {
      score += (interior - perimeter) / 120;
      because = 'We are better inside than out.';
    }
    if (profile.id === 'protect-rim') {
      score += (interior - 50) / 120;
      because = 'Keep them out of the paint.';
    }
    if (profile.id === 'press') {
      score += (speed - 55) / 110;
      // A pressing team that cannot run is a team conceding layups (`09` §2.2).
      if (tired) score -= 0.35;
      because = 'We have the legs to squeeze them.';
    }
    if (profile.id === 'double') {
      score += (perimeter - 50) / 200;
      because = 'Send a second body at their best.';
    }

    return { call: profile.id, score, because };
  });

  return scored.sort((a, b) => b.score - a.score || a.call.localeCompare(b.call));
}

export function scoreCalls(state: State, side: Side): ScoredCall[] {
  return side === state.possession ? scoreOffence(state, side) : scoreDefence(state, side);
}

/**
 * The coach's call. Samples the scores rather than taking the maximum, so a stretch of auto-called
 * possessions varies without ever being random — and so two replays of one match call the same
 * plays (INV-8).
 */
export function coachCall(state: State, side: Side, rng: Rng): PlaybookCall {
  const scored = scoreCalls(state, side);
  if (scored.length === 0) return { side, call: 'motion' };

  const top = (scored[0] as ScoredCall).score;
  const weights = scored.map((candidate) => Math.exp((candidate.score - top) / TEMPERATURE));
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  let ticket = rng.float(0, total);
  let best = scored[0] as ScoredCall;
  for (const [index, candidate] of scored.entries()) {
    ticket -= weights[index] ?? 0;
    if (ticket <= 0) {
      best = candidate;
      break;
    }
  }

  const profile = OFFENSIVE_PROFILES.find((candidate) => candidate.id === best.call);
  if (profile === undefined) return { side, call: best.call };

  // A targeted call still needs a target, and the coach names the athlete the play would find
  // anyway — so auto-calling never produces a call the player could not have made themselves.
  const attackers = state.squads[side === 1 ? 1 : 0].players;
  return { side, call: best.call, target: primaryOption(attackers, profile, undefined).id };
}

/** What the coach would say about its own choice, for the turn screen's one line. */
export function explainCall(state: State, side: Side, call: CallId): string {
  return scoreCalls(state, side).find((scored) => scored.call === call)?.because ?? '';
}
