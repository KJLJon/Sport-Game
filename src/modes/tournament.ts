/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.3 — Tournament mode: 4/8/16 bracket, persistence, results, rewards; playable in Live
 *          or Playbook
 * @story   US-7.4 — Play a tournament
 * @design  05-data-model.md §1 (the `progress` store holds tournament state), §5.3 (a tournament
 *          win pays 1 500 and a Gold pack), 09-modes-and-arcade.md §7
 * @invariant INV-2 (the bracket and every CPU result are seeded), INV-9 (a tournament match is an
 *            ordinary match — the mode is a field, never a branch)
 *
 * Purpose: a single-elimination bracket, the state that survives a session, and how a result moves
 * it forward.
 *
 * **A tournament match is an ordinary match.** The bracket says who plays whom; the match is played
 * by whichever mode the player chose, through exactly the same screens, and comes back as an
 * ordinary `MatchRecord`. Nothing in `modes/live/` or `modes/playbook/` knows a tournament exists,
 * which is INV-9 holding at a level above a single match.
 *
 * **The other half of the round is simulated, not skipped.** Three of the four semi-finalists in an
 * 8-team bracket are CPUs playing each other, and their results come from a seeded weighted coin
 * against their generated strength — so a bracket is reproducible from its seed, and the opponent
 * you meet in the final is the one the bracket always said it would be.
 *
 * **Persistence is one record in `progress`.** There is exactly one tournament at a time, the same
 * reasoning `modes/checkpoint.ts` gives for the interrupted match: a value that is fetched whole and
 * never queried does not need a store of its own.
 */
import { createRng, type Rng } from '../engine/rng.ts';
import { generateCpuTeam } from '../teams/cpu-team.ts';
import type { Database } from '../storage/idb.ts';
import type { SportId } from '../sports/types.ts';
import type { Difficulty } from '../modes/difficulty.ts';
import type { StatMode } from '../stats/types.ts';

/** `US-7.4` — 4, 8, or 16 teams. */
export const TOURNAMENT_SIZES = [4, 8, 16] as const;
export type TournamentSize = (typeof TOURNAMENT_SIZES)[number];

export function isTournamentSize(value: number): value is TournamentSize {
  return (TOURNAMENT_SIZES as readonly number[]).includes(value);
}

/** The key the single record lives under in `progress`. */
export const TOURNAMENT_KEY = 'tournament';

/** Bumped when the shape changes. An unreadable tournament is dropped, not migrated. */
export const TOURNAMENT_VERSION = 1;

/** `05` §5.3 — "Tournament win: 1 500 + one Gold pack". */
export const TOURNAMENT_PRIZE_COINS = 1500;

export interface TournamentEntrant {
  readonly id: string;
  readonly name: string;
  /** `true` for the player's own team. Exactly one entrant has it. */
  readonly player: boolean;
  /** 1–99, the CPU's notional strength. Decides simulated results; unused for the player. */
  readonly strength: number;
}

export interface BracketMatch {
  /** Indices into `entrants`, or `null` for a slot the previous round has not filled yet. */
  readonly home: number | null;
  readonly away: number | null;
  /** The winner's entrant index, or `null` while unplayed. */
  readonly winner: number | null;
  /** The score, when it was actually played rather than simulated. */
  readonly score: readonly [number, number] | null;
}

export interface Tournament {
  readonly schemaVersion: number;
  readonly id: string;
  readonly seed: string;
  readonly sport: SportId;
  readonly mode: StatMode;
  readonly difficulty: Difficulty;
  readonly size: TournamentSize;
  readonly entrants: readonly TournamentEntrant[];
  /** `rounds[r][m]`. Round 0 is the first round; the last round has one match. */
  readonly rounds: readonly (readonly BracketMatch[])[];
  readonly round: number;
  readonly startedAt: number;
  /** Set while the player is away playing their match, so the result can be claimed on return. */
  readonly pending: {
    readonly round: number;
    readonly match: number;
    readonly since: number;
  } | null;
  readonly status: 'running' | 'won' | 'lost';
}

/** How many rounds a bracket of this size has. 4 → 2, 8 → 3, 16 → 4. */
export function roundCount(size: TournamentSize): number {
  return Math.log2(size);
}

/** "Final", "Semi-final", "Quarter-final", or "Round of 16". */
export function roundName(size: TournamentSize, round: number): string {
  const remaining = size / 2 ** round;
  if (remaining === 2) return 'Final';
  if (remaining === 4) return 'Semi-final';
  if (remaining === 8) return 'Quarter-final';
  return `Round of ${remaining}`;
}

export interface CreateTournamentOptions {
  readonly seed: string;
  readonly sport: SportId;
  readonly mode: StatMode;
  readonly difficulty: Difficulty;
  readonly size: TournamentSize;
  readonly playerTeamName: string;
  readonly now: number;
}

/**
 * A fresh bracket.
 *
 * The player is always entrant 0 and always in the first match of the first round, so "your next
 * match" never needs searching for and the bracket reads top-down. The CPUs are generated from the
 * tournament seed, so the same seed always produces the same field — which is what makes a
 * tournament something you could share.
 */
export function createTournament(options: CreateTournamentOptions): Tournament {
  const rng = createRng(options.seed);
  const entrants: TournamentEntrant[] = [
    { id: 'player', name: options.playerTeamName, player: true, strength: 60 },
  ];

  for (let index = 1; index < options.size; index += 1) {
    const cpu = generateCpuTeam({
      seed: `${options.seed}:cpu-${index}`,
      sportId: options.sport,
      size: 5,
      difficulty: options.difficulty,
      createdAt: options.now,
    });
    entrants.push({
      id: cpu.team.id,
      name: cpu.team.name,
      player: false,
      // A spread wide enough that the bracket has favourites and underdogs, narrow enough that
      // nobody is a walkover.
      strength: 45 + rng.fork(`strength-${index}`).int(0, 40),
    });
  }

  const rounds: BracketMatch[][] = [];
  const first: BracketMatch[] = [];
  for (let index = 0; index < options.size; index += 2) {
    first.push({ home: index, away: index + 1, winner: null, score: null });
  }
  rounds.push(first);

  for (let round = 1; round < roundCount(options.size); round += 1) {
    const previous = rounds[round - 1] as BracketMatch[];
    rounds.push(
      Array.from({ length: previous.length / 2 }, () => ({
        home: null,
        away: null,
        winner: null,
        score: null,
      })),
    );
  }

  return {
    schemaVersion: TOURNAMENT_VERSION,
    id: `t-${options.now.toString(36)}`,
    seed: options.seed,
    sport: options.sport,
    mode: options.mode,
    difficulty: options.difficulty,
    size: options.size,
    entrants,
    rounds,
    round: 0,
    startedAt: options.now,
    pending: null,
    status: 'running',
  };
}

/** The match the player is in this round, or `null` when they are out. */
export function playerMatch(tournament: Tournament): { round: number; match: number } | null {
  const round = tournament.rounds[tournament.round];
  if (round === undefined) return null;

  for (let index = 0; index < round.length; index += 1) {
    const match = round[index] as BracketMatch;
    if (match.winner !== null) continue;
    if (isPlayer(tournament, match.home) || isPlayer(tournament, match.away)) {
      return { round: tournament.round, match: index };
    }
  }
  return null;
}

function isPlayer(tournament: Tournament, index: number | null): boolean {
  return index !== null && tournament.entrants[index]?.player === true;
}

/** The opponent the player faces this round, or `null`. */
export function nextOpponent(tournament: Tournament): TournamentEntrant | null {
  const slot = playerMatch(tournament);
  if (slot === null) return null;
  const match = tournament.rounds[slot.round]?.[slot.match];
  if (match === undefined) return null;
  const index = isPlayer(tournament, match.home) ? match.away : match.home;
  return index === null ? null : (tournament.entrants[index] ?? null);
}

/** Marks that the player has gone off to play their match. */
export function startPlayerMatch(tournament: Tournament, now: number): Tournament {
  const slot = playerMatch(tournament);
  if (slot === null) return tournament;
  return { ...tournament, pending: { round: slot.round, match: slot.match, since: now } };
}

/**
 * Records the player's result and resolves the rest of the round, then advances.
 *
 * The whole round settles at once: the player's match with the real result, every CPU match with a
 * seeded weighted coin. Resolving them lazily would mean a bracket whose later rounds changed
 * depending on when the player looked at it, which is the opposite of reproducible.
 */
export function recordPlayerResult(
  tournament: Tournament,
  result: { readonly won: boolean; readonly score: readonly [number, number] },
): Tournament {
  const slot = tournament.pending ?? playerMatch(tournament);
  if (slot === null) return tournament;

  const rounds = tournament.rounds.map((round) => [...round]);
  const current = rounds[slot.round];
  const match = current?.[slot.match];
  if (current === undefined || match === undefined) return tournament;

  const playerIndex = isPlayer(tournament, match.home) ? match.home : match.away;
  const otherIndex = isPlayer(tournament, match.home) ? match.away : match.home;
  const winner = result.won ? playerIndex : otherIndex;

  current[slot.match] = { ...match, winner, score: [result.score[0], result.score[1]] };

  const rng = createRng(`${tournament.seed}:round-${slot.round}`);
  for (let index = 0; index < current.length; index += 1) {
    const other = current[index] as BracketMatch;
    if (index === slot.match || other.winner !== null) continue;
    current[index] = { ...other, winner: simulate(tournament, other, rng.fork(`match-${index}`)) };
  }

  const advanced = fillNextRound(tournament, rounds, slot.round);
  const stillIn = current.some((entry) => isPlayer(tournament, entry.winner));
  const isFinal = slot.round === tournament.rounds.length - 1;

  return {
    ...advanced,
    pending: null,
    // A knocked-out player stays on the round they went out in: `round` is "where this run got
    // to", and advancing it would have the results screen name a round they never played.
    round: isFinal || !stillIn ? slot.round : slot.round + 1,
    status: !stillIn ? 'lost' : isFinal ? 'won' : 'running',
  };
}

/** A CPU-versus-CPU result: a coin weighted by the two strengths, from the bracket's own seed. */
function simulate(tournament: Tournament, match: BracketMatch, rng: Rng): number | null {
  if (match.home === null) return match.away;
  if (match.away === null) return match.home;

  const home = tournament.entrants[match.home]?.strength ?? 50;
  const away = tournament.entrants[match.away]?.strength ?? 50;
  // A ten-point strength gap is about a 60/40 match — favourites win more often without the
  // bracket becoming a seeding table read out loud.
  const chance = 0.5 + (home - away) / 100;
  return rng.next() < Math.min(0.9, Math.max(0.1, chance)) ? match.home : match.away;
}

function fillNextRound(
  tournament: Tournament,
  rounds: BracketMatch[][],
  round: number,
): Tournament {
  const next = rounds[round + 1];
  const current = rounds[round];
  if (next === undefined || current === undefined) return { ...tournament, rounds };

  for (let index = 0; index < next.length; index += 1) {
    const home = current[index * 2]?.winner ?? null;
    const away = current[index * 2 + 1]?.winner ?? null;
    next[index] = { ...(next[index] as BracketMatch), home, away };
  }
  return { ...tournament, rounds };
}

/** Reading and writing the one tournament. Mirrors `modes/checkpoint.ts`. */
export async function saveTournament(db: Database, tournament: Tournament): Promise<void> {
  await db.put('progress', tournament, TOURNAMENT_KEY);
}

export async function readTournament(db: Database): Promise<Tournament | null> {
  const stored = await db.get<Tournament>('progress', TOURNAMENT_KEY);
  if (stored === undefined) return null;
  // A tournament from an older build is dropped rather than migrated: it describes a run in
  // progress, and a wrong bracket is worse than no bracket.
  if (stored.schemaVersion !== TOURNAMENT_VERSION) return null;
  return stored;
}

export async function clearTournament(db: Database): Promise<void> {
  await db.delete('progress', TOURNAMENT_KEY);
}

/** How far the player got, in words — the line the results screen leads with. */
export function standingText(tournament: Tournament): string {
  if (tournament.status === 'won') return 'Champions.';
  if (tournament.status === 'lost') {
    return `Knocked out in the ${roundName(tournament.size, tournament.round).toLowerCase()}.`;
  }
  return `${roundName(tournament.size, tournament.round)} — ${
    nextOpponent(tournament)?.name ?? 'awaiting an opponent'
  }.`;
}
