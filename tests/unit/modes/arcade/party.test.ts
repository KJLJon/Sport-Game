/**
 * T-4.11 — party rounds: seeded fairness, ranking, and the elimination format.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUNDS,
  currentTurn,
  eliminatedAfter,
  partyWinner,
  passPrompt,
  recordTurn,
  roundSeed,
  standings,
  startParty,
  turnConfig,
  type PartyFormat,
  type PartyState,
} from '../../../../src/modes/arcade/party.ts';
import type { ArcadeResult } from '../../../../src/modes/arcade/types.ts';
import { athlete } from '../../../helpers/athletes.ts';

const PLAYERS = [
  { id: 'p1', name: 'Ana' },
  { id: 'p2', name: 'Dad' },
  { id: 'p3', name: 'Sam' },
];

function party(format: PartyFormat = 'rounds', rounds = DEFAULT_ROUNDS): PartyState {
  return startParty({
    game: 'bball.free-throw',
    players: PLAYERS,
    format,
    rounds,
    seed: 'party-1',
    athlete: athlete({ id: 'shared' }),
    difficulty: 'pro',
  });
}

function score(state: PartyState, points: number): PartyState {
  const turn = currentTurn(state);
  const result: ArcadeResult = {
    game: 'bball.free-throw',
    sport: 'basketball',
    mode: 'scored',
    seed: turn?.seed ?? '',
    athleteId: 'shared',
    difficulty: 'pro',
    score: points,
    stars: 1,
    attempts: 20,
    made: 10,
    bestStreak: 3,
    seconds: 40,
    reason: 'complete',
    events: [],
    rewarded: true,
  };
  return recordTurn(state, result);
}

describe('seeded fairness (09 §4)', () => {
  it('gives everyone in a round the identical seed', () => {
    let state = party();
    const seeds: string[] = [];

    for (let i = 0; i < PLAYERS.length; i++) {
      seeds.push(currentTurn(state)?.seed ?? '');
      state = score(state, 100 * (i + 1));
    }

    expect(new Set(seeds).size).toBe(1);
    expect(seeds[0]).toBe(roundSeed('party-1', 1));
  });

  it('changes the seed between rounds', () => {
    expect(roundSeed('party-1', 1)).not.toBe(roundSeed('party-1', 2));
  });

  it('gives everyone the identical athlete — a party is between people, not collections', () => {
    let state = party();
    const first = turnConfig(state);
    state = score(state, 100);
    const second = turnConfig(state);

    expect(first?.athlete.id).toBe(second?.athlete.id);
    expect(first?.seed).toBe(second?.seed);
    expect(first?.difficulty).toBe(second?.difficulty);
    expect(first?.mode).toBe('scored');
  });
});

describe('turn order', () => {
  it('goes round the seats, then starts the next round', () => {
    let state = party();
    expect(currentTurn(state)?.player.name).toBe('Ana');
    expect(currentTurn(state)?.remainingThisRound).toBe(3);

    state = score(state, 10);
    expect(currentTurn(state)?.player.name).toBe('Dad');

    state = score(state, 20);
    state = score(state, 30);
    expect(currentTurn(state)?.round).toBe(2);
    expect(currentTurn(state)?.player.name).toBe('Ana');
  });

  it('names the person the device is going to', () => {
    const turn = currentTurn(party())!;
    expect(passPrompt(turn, 'bball.free-throw')).toBe('Pass to Ana — round 1, free-throw');
  });

  it('is over after the last round of a best-of-N', () => {
    let state = party('rounds', 2);
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < PLAYERS.length; i++) state = score(state, 10 * (i + 1));
    }
    expect(state.finished).toBe(true);
    expect(currentTurn(state)).toBeNull();
    expect(turnConfig(state)).toBeNull();
  });

  it('a party of one is over before it starts', () => {
    const state = startParty({
      game: 'bball.free-throw',
      players: [PLAYERS[0]!],
      format: 'rounds',
      rounds: 3,
      seed: 's',
      athlete: athlete(),
      difficulty: 'pro',
    });
    expect(state.finished).toBe(true);
    expect(recordTurn(state, {} as ArcadeResult)).toBe(state);
  });
});

describe('elimination', () => {
  it('knocks out the lowest scorer each round until one is left', () => {
    let state = party('elimination');

    state = score(state, 300); // Ana
    state = score(state, 200); // Dad
    state = score(state, 100); // Sam — out
    expect(state.eliminated).toEqual(['p3']);
    expect(state.active).toEqual(['p1', 'p2']);

    state = score(state, 50); // Ana — out
    state = score(state, 400); // Dad
    expect(state.eliminated).toEqual(['p3', 'p1']);
    expect(state.finished).toBe(true);
    expect(partyWinner(state)?.name).toBe('Dad');
  });

  it('eliminates nobody when everyone ties, rather than picking on the first seat', () => {
    let state = party('elimination');
    state = score(state, 100);
    state = score(state, 100);
    state = score(state, 100);

    expect(state.eliminated).toEqual([]);
    expect(state.active).toHaveLength(3);
    expect(state.finished).toBe(false);
  });

  it('sends everyone tied at the bottom out together', () => {
    let state = party('elimination');
    state = score(state, 500);
    state = score(state, 100);
    state = score(state, 100);

    expect([...state.eliminated].sort()).toEqual(['p2', 'p3']);
    expect(state.finished).toBe(true);
  });

  it('reports who a round would knock out before the round is filed', () => {
    let state = party('elimination');
    state = score(state, 300);
    state = score(state, 100);
    // Only two of three have played; the third has not scored yet.
    expect(eliminatedAfter(state, 1)).toEqual(['p2']);
  });
});

describe('standings', () => {
  it('ranks on total, then on the best single round', () => {
    let state = party('rounds', 2);
    state = score(state, 100); // Ana
    state = score(state, 150); // Dad
    state = score(state, 50); // Sam
    state = score(state, 200); // Ana → 300
    state = score(state, 150); // Dad → 300
    state = score(state, 500); // Sam → 550

    const table = standings(state);
    expect(table.map((row) => row.player.name)).toEqual(['Sam', 'Ana', 'Dad']);
    expect(table[0]?.place).toBe(1);
    // Ana and Dad both total 300; Ana's best round is higher, so she is second outright.
    expect(table[1]?.best).toBe(200);
    expect(table[2]?.place).toBe(3);
  });

  it('shares a place on a genuine tie, and reports no winner for a tied top', () => {
    let state = party('rounds', 1);
    state = score(state, 100);
    state = score(state, 100);
    state = score(state, 10);

    const table = standings(state);
    expect(table[0]?.place).toBe(1);
    expect(table[1]?.place).toBe(1);
    expect(table[2]?.place).toBe(3);
    expect(partyWinner(state)).toBeNull();
  });

  it('counts a player who has not played yet as zero rather than omitting them', () => {
    const table = standings(party());
    expect(table).toHaveLength(3);
    for (const row of table) {
      expect(row.total).toBe(0);
      expect(row.rounds).toBe(0);
      expect(row.eliminated).toBe(false);
    }
  });

  it('has no winner while the party is still going', () => {
    expect(partyWinner(party())).toBeNull();
  });
});
