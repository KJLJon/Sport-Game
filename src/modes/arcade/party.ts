/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.11 — Arcade hot-seat: party rounds, seeded fairness, ranking, elimination formats
 * @story   US-17.2 — Play Arcade party rounds
 * @design  09-modes-and-arcade.md §4 (hot-seat local multiplayer), §3.3
 * @invariant INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: several people taking the same challenge in turn on one device, and the ranking at the
 * end. Pure state: a party is a value, `recordTurn` returns the next one, and nothing here knows
 * about a screen.
 *
 * **Seeded fairness is the whole design.** Everyone in a round plays the *same seed* — the same
 * drift, the same hold times, the same defender recoveries — so the only difference between two
 * scores is the two people. That is `09` §4's "the same seeded challenge in turn" taken literally.
 *
 * **And one athlete for everybody.** The other half of fairness, and the one that is easy to miss:
 * an arcade window is calibrated to the athlete (INV-10), so letting each player bring their own
 * would mean the winner is whoever owns the better card. A party picks one athlete and everybody
 * plays them, exactly as the daily challenge does — the party is a contest between people, not
 * between collections.
 */
import type { Athlete } from '../../athletes/types.ts';
import type { Difficulty } from '../difficulty.ts';
import type { LocalPlayer } from '../local-players.ts';
import type { ArcadeConfig, ArcadeGameId, ArcadeResult, StarCount } from './types.ts';

export const PARTY_FORMATS = ['rounds', 'elimination'] as const;
export type PartyFormat = (typeof PARTY_FORMATS)[number];

export const DEFAULT_ROUNDS = 3;

export interface PartyOptions {
  readonly game: ArcadeGameId;
  readonly players: readonly LocalPlayer[];
  readonly format: PartyFormat;
  /** Best-of-N. Ignored by `elimination`, which runs until one player is left. */
  readonly rounds: number;
  /** The party's seed. Every round's seed is derived from it. */
  readonly seed: string;
  /** The athlete everybody plays. */
  readonly athlete: Athlete;
  readonly difficulty: Difficulty;
}

export interface PartyScore {
  readonly round: number;
  readonly playerId: string;
  readonly score: number;
  readonly stars: StarCount;
}

export interface PartyState {
  readonly options: PartyOptions;
  /** 1-based. */
  readonly round: number;
  /** Index into `active` — whose turn it is. */
  readonly index: number;
  /** Players still in, in seating order. */
  readonly active: readonly string[];
  readonly scores: readonly PartyScore[];
  /** Ids knocked out, in the order they went. */
  readonly eliminated: readonly string[];
  readonly finished: boolean;
}

export interface PartyTurn {
  readonly round: number;
  readonly player: LocalPlayer;
  readonly seed: string;
  /** How many turns are left in this round, including this one. */
  readonly remainingThisRound: number;
}

export interface Standing {
  readonly player: LocalPlayer;
  readonly total: number;
  readonly best: number;
  readonly rounds: number;
  /** 1-based; equal totals share a place, and the next place skips accordingly. */
  readonly place: number;
  readonly eliminated: boolean;
}

/** Every player in a round plays this. */
export function roundSeed(seed: string, round: number): string {
  return `${seed}:r${round}`;
}

export function startParty(options: PartyOptions): PartyState {
  return {
    options,
    round: 1,
    index: 0,
    active: options.players.map((player) => player.id),
    scores: [],
    eliminated: [],
    finished: options.players.length < 2,
  };
}

function playerById(state: PartyState, id: string): LocalPlayer | undefined {
  return state.options.players.find((player) => player.id === id);
}

/** Whose turn it is, and on what seed. `null` once the party is over. */
export function currentTurn(state: PartyState): PartyTurn | null {
  if (state.finished) return null;
  const id = state.active[state.index];
  if (id === undefined) return null;
  const player = playerById(state, id);
  if (player === undefined) return null;

  return {
    round: state.round,
    player,
    seed: roundSeed(state.options.seed, state.round),
    remainingThisRound: state.active.length - state.index,
  };
}

/** The config for the current turn. Every player gets the identical one but for whose turn it is. */
export function turnConfig(state: PartyState): ArcadeConfig | null {
  const turn = currentTurn(state);
  if (turn === null) return null;
  return {
    mode: 'scored',
    seed: turn.seed,
    athlete: state.options.athlete,
    difficulty: state.options.difficulty,
  };
}

/** Scores for one round, lowest first. */
function roundScores(state: PartyState, round: number): readonly PartyScore[] {
  return state.scores.filter((score) => score.round === round).sort((a, b) => a.score - b.score);
}

/**
 * Who goes out after a round. Everyone tied at the lowest score goes — except when that would be
 * everybody, in which case nobody does and the round is replayed by the same field. Eliminating a
 * single arbitrary player out of a tie would make the format depend on seating order, and a
 * three-way tie for last is exactly the moment a party is watching.
 */
export function eliminatedAfter(state: PartyState, round: number): readonly string[] {
  const scores = roundScores(state, round);
  if (scores.length <= 1) return [];

  const lowest = scores[0]?.score ?? 0;
  const going = scores.filter((score) => score.score === lowest).map((score) => score.playerId);
  return going.length >= scores.length ? [] : going;
}

/** Records the current player's run and advances the party. */
export function recordTurn(state: PartyState, result: ArcadeResult): PartyState {
  const turn = currentTurn(state);
  if (turn === null) return state;

  const scores = [
    ...state.scores,
    { round: state.round, playerId: turn.player.id, score: result.score, stars: result.stars },
  ];
  const withScore: PartyState = { ...state, scores };

  // Still someone left to play this round.
  if (state.index + 1 < state.active.length) {
    return { ...withScore, index: state.index + 1 };
  }

  if (state.options.format === 'elimination') {
    const going = new Set(eliminatedAfter(withScore, state.round));
    const active = state.active.filter((id) => !going.has(id));
    return {
      ...withScore,
      round: state.round + 1,
      index: 0,
      active,
      eliminated: [...state.eliminated, ...going],
      finished: active.length <= 1,
    };
  }

  const finished = state.round >= state.options.rounds;
  return { ...withScore, round: state.round + 1, index: 0, finished };
}

/**
 * The table at the end. Ranked on total across the rounds played, then on best single round, then
 * on seating order — so a tie is broken by something a player did rather than by nothing at all.
 */
export function standings(state: PartyState): readonly Standing[] {
  const eliminated = new Set(state.eliminated);

  const rows = state.options.players.map((player) => {
    const mine = state.scores.filter((score) => score.playerId === player.id);
    return {
      player,
      total: mine.reduce((sum, score) => sum + score.score, 0),
      best: mine.reduce((high, score) => Math.max(high, score.score), 0),
      rounds: mine.length,
      eliminated: eliminated.has(player.id),
      place: 0,
    };
  });

  rows.sort((a, b) => b.total - a.total || b.best - a.best);

  let place = 0;
  let previous: { total: number; best: number } | null = null;
  return rows.map((row, index) => {
    if (previous === null || previous.total !== row.total || previous.best !== row.best) {
      place = index + 1;
    }
    previous = { total: row.total, best: row.best };
    return { ...row, place };
  });
}

/** The winner, or `null` while the party is still going or genuinely tied at the top. */
export function partyWinner(state: PartyState): LocalPlayer | null {
  if (!state.finished) return null;
  const table = standings(state);
  const leaders = table.filter((row) => row.place === 1);
  return leaders.length === 1 ? (leaders[0]?.player ?? null) : null;
}

/** The one line the pass-the-device screen shows. */
export function passPrompt(turn: PartyTurn, game: ArcadeGameId): string {
  return `Pass to ${turn.player.name} — round ${turn.round}, ${game.split('.').pop() ?? game}`;
}
