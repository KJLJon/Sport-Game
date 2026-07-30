/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.14 — Soccer Playbook: `PlaybookAdapter` + phase turns
 * @task    T-6.19 — Soccer Playbook: intent controls — tempo, width, risk, press, focus
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §2.3 (phase turns), §7 (balance across modes)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-9 (one event stream)
 *
 * Purpose: turns a phase and a pair of intents into what happened — who it was about, whether the
 * ball went forward, and the events that say so.
 *
 * **This is the baseline, and T-6.20 replaces its middle.** The task split on 2026-07-30 put the
 * phase turn here and the resolution model in T-6.20, which cannot mean "soccer has no resolution
 * until then" — a phase graph nothing walks is untestable. So the graph, the actor selection, the
 * events, and the expectation are final, and what T-6.20 swaps is `PHASE_ODDS`: a table of base
 * probabilities becomes `passOutcome()` and `shotProbability()` from soccer's Live models, the way
 * basketball's `resolution.ts` already calls `shotProbability()` rather than owning a second curve
 * (`09` §7). Everything either side of that swap stays put, which is the point of doing it in this
 * order.
 *
 * **Draw order is fixed and named.** Each stage draws from its own labelled fork — `advance`,
 * `create`, `finish`, `rebound` — so T-6.20 inserting a stage cannot shift the stages after it
 * (INV-8; `engine/rng.ts` on forking by label rather than by draw order).
 */
import { EventKind, event, type Side, type SportEvent } from '../../../engine/match/events.ts';
import type { Rng } from '../../../engine/rng.ts';
import type { EntityId } from '../../../engine/world.ts';
import type {
  CallPair,
  PlaybookAthlete,
  PlaybookCall,
  PlaybookSquad,
  PlaybookState,
  TurnExpectation,
  TurnResolution,
} from '../../../modes/playbook/types.ts';
import { SoccerEvent } from '../rules.ts';
import { DEFAULT_INTENTS, composeEffect, intentsFrom, type SoccerIntents } from './intents.ts';
import {
  OPENING_PHASE,
  PHASE_TURN_SECONDS,
  phaseName,
  type PhaseOutcome,
  type SoccerPhase,
} from './phases.ts';
import { channelOf, keeperOf, outfieldOf, type Channel } from './squad.ts';

/** What soccer tracks between turns. The engine owns the clock, the score, and possession. */
export interface SoccerPlaybookState {
  /** Where the ball is on the ladder. `phases.ts` decides what may follow it. */
  phase: SoccerPhase;
  /** The period `phase` belongs to. A new half kicks off from the opening phase. */
  period: number;
  /**
   * The full set of intents each side last set, indexed by side. `09` §2.3's intents persist until
   * changed, so something has to remember them across a turn the player did not touch, and across a
   * turn where they changed one chip and left the other four alone; this is that something.
   */
  intent: [SoccerIntents, SoccerIntents];
  /** Shots taken per side, for the box score's sanity and T-6.21's narration. */
  shots: [number, number];
}

/**
 * The one thing the player says about a turn beyond the intent, and what narration reads.
 *
 * Richer than `PhaseOutcome` on purpose: the graph cares only that a shot did not go in, while the
 * player very much wants to know whether the keeper saved it. `phaseOutcomeOf()` collapses the one
 * into the other, so there is exactly one place the two vocabularies meet.
 */
export const TURN_OUTCOMES = [
  'advance',
  'chance',
  'corner',
  'goal',
  'saved',
  'off-target',
  'blocked',
  'lost',
] as const;
export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

/** The graph's view of a turn outcome. Total: an unknown string is a loss of possession. */
export function phaseOutcomeOf(outcome: string): PhaseOutcome {
  switch (outcome) {
    case 'advance':
      return 'advance';
    case 'chance':
      return 'chance';
    case 'corner':
      return 'setPiece';
    case 'goal':
      return 'goal';
    case 'saved':
    case 'off-target':
    case 'blocked':
      return 'blocked';
    default:
      return 'lost';
  }
}

/**
 * Baseline odds, for an even matchup and balanced intents on both sides.
 *
 * These are the figures `phases.ts`' turn-budget derivation is solved against — change one and the
 * expected turn count moves, which `adapter.test.ts` will notice. They are also the whole of what
 * T-6.20 replaces.
 *
 * **Where this baseline actually lands**, over 40 CPU-vs-CPU matches between even squads:
 * **20.6 turns** in normal time and **1.8 goals** a match. The turn count is what `09` §2.3 asks
 * for. The goals are short of a real ~2.7, and deliberately not chased here: the shortfall is in how
 * often a possession reaches the box, not in how often a chance is taken, so closing it by raising
 * `chanceGoal` would buy the scoreline by making every chance a coin flip. **T-6.18 owns the fix**,
 * with T-6.20's swap to Live's own models landing in between and moving the shape again.
 *
 * @spec-ref 09-modes-and-arcade.md §2.3 — a typical match is 18–24 turns
 */
export const PHASE_ODDS = {
  /** Chance a build-up gets out of the defensive third. */
  buildUpAdvance: 0.62,
  /** Chance a progression turn reaches the final third. */
  progressionAdvance: 0.5,
  /** Chance a final-third turn works a clear opening. */
  finalThirdChance: 0.62,
  /** Chance it wins a corner or a dangerous free kick instead. */
  finalThirdSetPiece: 0.16,

  /**
   * Chance a `chance` phase ends in the net. High as a per-*shot* number and about right as a
   * per-*phase* one: a chance turn is a spell of pressure in and around the box, not one attempt.
   */
  chanceGoal: 0.6,
  /** Chance a set piece ends in the net. */
  setPieceGoal: 0.18,
  /** Share of the shots that do not go in which come back as a corner. */
  chanceCorner: 0.3,
  setPieceCorner: 0.22,
  /** Of the shots that neither score nor win a corner, the share the keeper actually saves. */
  savedShare: 0.55,
  /** …and of the rest, the share that was blocked rather than dragged wide. */
  blockedShare: 0.45,
} as const;

/**
 * Tuning that is about the *matchup* rather than the phase.
 *
 * `matchupDivisor` is deliberately basketball's 25 — the same rating gap should mean the same thing
 * in both sports' Playbooks, or the ladder in `03` is measuring two different scales.
 */
export const SOCCER_RESOLUTION = {
  matchupDivisor: 25,
  /** How far an edge can push a probability, per unit of edge. */
  climbFromEdge: 0.07,
  createFromEdge: 0.07,
  finishFromEdge: 0.09,
  /** Ceiling on the edge itself, so a 90-vs-10 mismatch is decisive and not certain. */
  maxEdge: 2,
  /** Stamina's weight in the edge. A tired side loses the second ball. */
  staminaWeight: 0.5,

  /** Probability bounds. Nothing in soccer is ever certain, including a tap-in. */
  floor: 0.08,
  ceiling: 0.9,
} as const;

/** Which ratings a phase is decided by, for each side. */
const PHASE_KEYS: Readonly<
  Record<SoccerPhase, { readonly attack: readonly string[]; readonly defend: readonly string[] }>
> = {
  buildUp: { attack: ['shortPass', 'longPass'], defend: ['tackling', 'pace'] },
  progression: { attack: ['shortPass', 'dribbling', 'offBall'], defend: ['tackling', 'marking'] },
  finalThird: { attack: ['crossing', 'offBall', 'dribbling'], defend: ['marking', 'tackling'] },
  chance: { attack: ['finishing', 'shotPower'], defend: ['goalkeeping', 'marking'] },
  setPiece: { attack: ['crossing', 'heading', 'shotPower'], defend: ['goalkeeping', 'heading'] },
};

/** True when the defending side's key man is the goalkeeper rather than an outfielder. */
function keeperDecides(phase: SoccerPhase): boolean {
  return phase === 'chance' || phase === 'setPiece';
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function bounded(chance: number): number {
  return clamp(chance, SOCCER_RESOLUTION.floor, SOCCER_RESOLUTION.ceiling);
}

/** One athlete's average across a phase's key ratings. Missing keys read as an average athlete. */
export function keyRating(athlete: PlaybookAthlete, keys: readonly string[]): number {
  let total = 0;
  for (const key of keys) total += athlete.ratings[key] ?? 50;
  return total / keys.length;
}

/**
 * Where the focus intent points, once the id has been read (T-6.19).
 *
 * `channel` is a flank or the middle; `athlete` is a named player. Both null when nobody is being
 * steered, which is what an unrecognised or absent focus reads as.
 */
export interface FocusBias {
  readonly channel: Channel | null;
  readonly athlete: EntityId | null;
}

export const NO_FOCUS: FocusBias = { channel: null, athlete: null };

/**
 * How hard the focus intent pulls, in rating points on the selection score.
 *
 * Deliberately about the size of a real rating gap and no bigger: focusing on the left should mean
 * your left-sided players see more of the ball, not that your best striker stops existing. The
 * marking figure is larger than the channel one because marking somebody is a much more specific
 * instruction than pointing at a flank.
 */
export const FOCUS_PULL = {
  channel: 10,
  /** Added to the named athlete's own side's selection score — play through them. */
  favour: 12,
  /** Subtracted from a marked athlete's selection score — they are being followed around. */
  marked: 14,
  /** What being marked costs the marked athlete once they *do* get on the ball. */
  createPenalty: 0.06,
  finishPenalty: 0.05,
} as const;

/**
 * Who the turn is about: the outfielder best suited to the phase, with a small seeded wobble so a
 * match is not eleven turns of the same name. The wobble is smaller than a real rating gap, so the
 * best player still gets the ball most of the time — `09` §2.2's "ratings beat mind-games", applied
 * to selection rather than to outcome.
 *
 * `focus` is where T-6.19's fifth intent lands, and the only one of the five that moves *who* rather
 * than *how likely*: pointing at a flank adds to everyone in that channel, naming an athlete adds to
 * them, and being named by the *other* side subtracts.
 */
export function primaryFor(
  squad: PlaybookSquad,
  keys: readonly string[],
  rng: Rng,
  own: FocusBias = NO_FOCUS,
  opposing: FocusBias = NO_FOCUS,
): PlaybookAthlete {
  const candidates = outfieldOf(squad);
  let best = candidates[0] as PlaybookAthlete;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    let score = keyRating(candidate, keys) + rng.gaussian(0, 6);
    if (own.channel !== null && channelOf(candidate.role) === own.channel) {
      score += FOCUS_PULL.channel;
    }
    if (own.athlete === candidate.id) score += FOCUS_PULL.favour;
    if (opposing.athlete === candidate.id) score -= FOCUS_PULL.marked;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** What the focus dimension of a set of intents points at. */
export function focusBias(intents: SoccerIntents, target?: EntityId): FocusBias {
  switch (intents.focus) {
    case 'focus-left':
      return { channel: 'left', athlete: null };
    case 'focus-right':
      return { channel: 'right', athlete: null };
    case 'focus-centre':
      return { channel: 'centre', athlete: null };
    case 'focus-player':
      return { channel: null, athlete: target ?? null };
    default:
      return NO_FOCUS;
  }
}

/** How far one side is ahead in this phase, in logistic-ish units, clamped. */
export function matchupEdge(attack: number, defend: number, stamina: number): number {
  const raw = (attack - defend) / SOCCER_RESOLUTION.matchupDivisor;
  const tired = (stamina - 1) * SOCCER_RESOLUTION.staminaWeight;
  return clamp(raw + tired, -SOCCER_RESOLUTION.maxEdge, SOCCER_RESOLUTION.maxEdge);
}

export interface ResolveInput {
  readonly state: PlaybookState<SoccerPlaybookState>;
  readonly calls: CallPair;
  readonly rng: Rng;
  /** The phase the turn is played in. The adapter reads it off the state; tests pass it directly. */
  readonly phase: SoccerPhase;
}

/**
 * Resolves one phase turn.
 *
 * The shape is the same for every phase — pick the two athletes the phase is about, price the
 * matchup, draw — and only the branch after the draw differs, which is what keeps the five phases
 * from becoming five models.
 */
export function resolvePhaseTurn(input: ResolveInput): TurnResolution {
  const { state, calls, rng, phase } = input;
  const attacking: Side = state.possession === 1 ? 1 : 0;
  const defendingSide: Side = attacking === 1 ? 0 : 1;
  const attackers = state.squads[attacking];
  const defenders = state.squads[defendingSide];

  const keys = PHASE_KEYS[phase];

  // The five intents each side is playing, remembered from before and overlaid with this turn's
  // call — so a player who changed one chip has still said all five things (`09` §2.3).
  const offIntents = intentsOf(state, attacking, calls.offence);
  const defIntents = intentsOf(state, defendingSide, calls.defence);
  const attack = composeEffect(offIntents, 'offence');
  const defend = composeEffect(defIntents, 'defence');

  const offFocus = focusBias(offIntents, calls.offence.target);
  const defFocus = focusBias(defIntents, calls.defence.target);

  const actor = primaryFor(attackers, keys.attack, rng.fork('actor'), offFocus, defFocus);
  const defender = keeperDecides(phase)
    ? keeperOf(defenders)
    : primaryFor(defenders, keys.defend, rng.fork('defender'), defFocus, offFocus);

  // Being marked is the one way focus reaches the odds as well as the selection: naming an athlete
  // follows them, and it still costs them something on the occasions they get on the ball anyway.
  const marked = defFocus.athlete === actor.id;

  const edge = matchupEdge(
    keyRating(actor, keys.attack),
    keyRating(defender, keys.defend),
    actor.stamina,
  );

  const seconds = Math.round(PHASE_TURN_SECONDS[phase] * attack.duration);
  const events: SportEvent[] = [
    event(EventKind.POSSESSION, 0, attacking, {
      actor: actor.id,
      detail: {
        phase,
        tempo: offIntents.tempo,
        press: defIntents.press,
        width: offIntents.width,
        risk: offIntents.risk,
        focus: offIntents.focus,
        marked,
      },
    }),
  ];

  const finish = (
    outcome: TurnOutcome,
    points: number,
    expectation: TurnExpectation,
  ): TurnResolution => ({
    turn: state.turn,
    calls,
    attacking,
    outcome,
    actor: actor.id,
    target: defender.id,
    points,
    seconds,
    retainsPossession: retains(outcome),
    events,
    expectation,
  });

  if (phase === 'buildUp' || phase === 'progression') {
    const base = phase === 'buildUp' ? PHASE_ODDS.buildUpAdvance : PHASE_ODDS.progressionAdvance;
    const chance = bounded(
      base + edge * SOCCER_RESOLUTION.climbFromEdge + attack.climb - defend.climb,
    );
    const advanced = rng.fork('advance').bool(chance);
    events.push(
      advanced
        ? event(EventKind.PASS, 0, attacking, { actor: actor.id, detail: { phase } })
        : event(EventKind.TURNOVER, 0, attacking, { actor: actor.id, target: defender.id }),
    );
    return finish(advanced ? 'advance' : 'lost', 0, {
      successChance: chance,
      expectedPoints: 0,
      because: because(phase, actor, defender, edge, attacking === state.playerSide),
    });
  }

  if (phase === 'finalThird') {
    const chanceOdds = bounded(
      PHASE_ODDS.finalThirdChance +
        edge * SOCCER_RESOLUTION.createFromEdge +
        attack.create -
        defend.create -
        (marked ? FOCUS_PULL.createPenalty : 0),
    );
    const worked = rng.fork('create').bool(chanceOdds);
    if (worked) {
      events.push(event(EventKind.PASS, 0, attacking, { actor: actor.id, detail: { phase } }));
      return finish('chance', 0, {
        successChance: chanceOdds,
        expectedPoints: 0,
        because: because(phase, actor, defender, edge, attacking === state.playerSide),
      });
    }
    // The consolation is a set piece, drawn from its own fork so the branch above cannot move it.
    const setPieceOdds = Math.max(
      0.02,
      PHASE_ODDS.finalThirdSetPiece + attack.setPiece - defend.setPiece,
    );
    const wonSetPiece = rng
      .fork('set-piece')
      .bool(Math.min(1, setPieceOdds / Math.max(0.05, 1 - chanceOdds)));
    if (wonSetPiece) {
      events.push(
        event(EventKind.SPORT, 0, attacking, {
          sportKind: SoccerEvent.RESTART,
          actor: actor.id,
          detail: { kind: 'cornerKick', phase },
        }),
      );
      return finish('corner', 0, {
        successChance: chanceOdds,
        expectedPoints: 0,
        because: because(phase, actor, defender, edge, attacking === state.playerSide),
      });
    }
    events.push(event(EventKind.TURNOVER, 0, attacking, { actor: actor.id, target: defender.id }));
    return finish('lost', 0, {
      successChance: chanceOdds,
      expectedPoints: 0,
      because: because(phase, actor, defender, edge, attacking === state.playerSide),
    });
  }

  // ── A shot: `chance` or `setPiece`. ──
  const base = phase === 'chance' ? PHASE_ODDS.chanceGoal : PHASE_ODDS.setPieceGoal;
  const goalOdds = bounded(
    base +
      edge * SOCCER_RESOLUTION.finishFromEdge +
      attack.finish -
      defend.finish -
      (marked ? FOCUS_PULL.finishPenalty : 0),
  );
  const scored = rng.fork('finish').bool(goalOdds);

  events.push(
    event(EventKind.SHOT, 0, attacking, {
      actor: actor.id,
      target: defender.id,
      value: 1,
      detail: { phase, made: scored, chance: Math.round(goalOdds * 100) / 100 },
    }),
  );

  const expectation: TurnExpectation = {
    successChance: goalOdds,
    expectedPoints: goalOdds,
    because: because(phase, actor, defender, edge, attacking === state.playerSide),
  };

  if (scored) return finish('goal', 1, expectation);

  const cornerShare = phase === 'chance' ? PHASE_ODDS.chanceCorner : PHASE_ODDS.setPieceCorner;
  const rebound = rng.fork('rebound');
  if (rebound.bool(cornerShare)) {
    events.push(
      event(EventKind.SPORT, 0, attacking, {
        sportKind: SoccerEvent.RESTART,
        actor: actor.id,
        detail: { kind: 'cornerKick', phase },
      }),
    );
    return finish('corner', 0, expectation);
  }

  if (rebound.bool(PHASE_ODDS.savedShare)) {
    events.push(event(EventKind.SAVE, 0, defendingSide, { actor: defender.id, target: actor.id }));
    return finish('saved', 0, expectation);
  }

  return finish(rebound.bool(PHASE_ODDS.blockedShare) ? 'blocked' : 'off-target', 0, expectation);
}

/**
 * The intents a side is playing this turn: what they had set, overlaid with what this call says.
 *
 * Lives here rather than on the adapter because `apply()` has to arrive at exactly the same answer
 * when it writes the set back — and a pure function called twice with the same inputs is a cheaper
 * guarantee of that than passing the result between two members of the seam.
 */
export function intentsOf(
  state: PlaybookState<SoccerPlaybookState>,
  side: Side,
  call: PlaybookCall,
): SoccerIntents {
  const previous = state.detail.intent[side === 1 ? 1 : 0] ?? DEFAULT_INTENTS;
  return intentsFrom(previous, call);
}

/** Whether the attacking side still has the ball after this outcome. */
function retains(outcome: TurnOutcome): boolean {
  return outcome === 'advance' || outcome === 'chance' || outcome === 'corner';
}

/**
 * The one line naming what drove the number (`TurnExpectation.because`). Written from the reading
 * side's point of view, so "we" is always the person holding the phone.
 */
function because(
  phase: SoccerPhase,
  actor: PlaybookAthlete,
  defender: PlaybookAthlete,
  edge: number,
  playerAttacking: boolean,
): string {
  const label = phaseName(phase, playerAttacking);
  const who = actor.athlete.displayName;
  const against = defender.athlete.displayName;
  if (edge > 0.5) return `${label}: ${who} has the better of ${against}.`;
  if (edge < -0.5) return `${label}: ${against} has ${who} well covered.`;
  return `${label}: ${who} against ${against}, and little between them.`;
}

/**
 * Stamina, spent and recovered. Both sides work — a high press costs the pressing side more than a
 * patient build-up costs the side playing it, which is the trade `09` §2.3's press line describes.
 */
export function drainStamina(players: readonly PlaybookAthlete[], effort: number): void {
  for (const player of players) {
    player.stamina = clamp(
      player.stamina - effort + SOCCER_STAMINA.recovery,
      SOCCER_STAMINA.floor,
      1,
    );
  }
}

export const SOCCER_STAMINA = {
  /** Recovered every turn, whatever the side was doing. */
  recovery: 0.012,
  /** Nobody plays at zero (`06` §3.2's fatigue slows a player, it does not remove them). */
  floor: 0.45,
} as const;

/** The state a match starts from. Exported so the tests do not have to build one by hand. */
export function createSoccerPlaybookState(): SoccerPlaybookState {
  return {
    phase: OPENING_PHASE,
    period: 1,
    intent: [DEFAULT_INTENTS, DEFAULT_INTENTS],
    shots: [0, 0],
  };
}
