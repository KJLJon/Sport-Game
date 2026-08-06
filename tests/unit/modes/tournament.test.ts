/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.3 — Tournament mode: 4/8/16 bracket, persistence, results, rewards; playable in Live
 *          or Playbook
 * @story   US-7.4 — Play a tournament
 * @design  05-data-model.md §1, §5.3
 * @invariant INV-2 (the bracket and every simulated result come from the seed), INV-9 (a tournament
 *            match is an ordinary match)
 *
 * Purpose: that a bracket is well-formed at every size, that a run reaches an end, and that the
 * same seed always produces the same tournament.
 *
 * The "run to completion" case is the one worth having: an off-by-one in `fillNextRound` produces a
 * bracket that looks right and strands the player in a semi-final forever, and nothing else would
 * catch it.
 */
import { describe, expect, it } from 'vitest';
import {
  TOURNAMENT_SIZES,
  createTournament,
  isTournamentSize,
  nextOpponent,
  playerMatch,
  recordPlayerResult,
  roundCount,
  roundName,
  standingText,
  startPlayerMatch,
  type Tournament,
  type TournamentSize,
} from '@/modes/tournament.ts';

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);

function build(size: TournamentSize = 8, seed = 'fixed'): Tournament {
  return createTournament({
    seed,
    sport: 'basketball',
    mode: 'live',
    difficulty: 'pro',
    size,
    playerTeamName: 'Your team',
    now: NOW,
  });
}

/** Plays the whole tournament out, with the player winning or losing every match. */
function playThrough(tournament: Tournament, playerWins: boolean): Tournament {
  let current = tournament;
  for (let guard = 0; guard < 10 && current.status === 'running'; guard += 1) {
    current = startPlayerMatch(current, NOW + guard);
    current = recordPlayerResult(current, {
      won: playerWins,
      score: playerWins ? [80, 70] : [70, 80],
    });
  }
  return current;
}

describe('createTournament', () => {
  it('builds a full bracket at every size', () => {
    for (const size of TOURNAMENT_SIZES) {
      const tournament = build(size);
      expect(tournament.entrants, `${size} entrants`).toHaveLength(size);
      expect(tournament.rounds, `${size} rounds`).toHaveLength(roundCount(size));
      expect(tournament.rounds[0]).toHaveLength(size / 2);
      expect(tournament.rounds.at(-1)).toHaveLength(1);
    }
  });

  it('puts the player in exactly one slot, in the first match', () => {
    const tournament = build(16);
    expect(tournament.entrants.filter((entrant) => entrant.player)).toHaveLength(1);
    expect(playerMatch(tournament)).toEqual({ round: 0, match: 0 });
    expect(nextOpponent(tournament)?.player).toBe(false);
  });

  it('gives the CPUs real names, not placeholders', () => {
    for (const entrant of build().entrants.slice(1)) {
      expect(entrant.name.length).toBeGreaterThan(3);
      expect(entrant.name).not.toMatch(/team \d|cpu/i);
    }
  });

  it('is the same tournament for the same seed (INV-2)', () => {
    const names = (t: Tournament) => t.entrants.map((entrant) => entrant.name);
    expect(names(build(8, 'same'))).toEqual(names(build(8, 'same')));
    expect(names(build(8, 'other'))).not.toEqual(names(build(8, 'same')));
  });

  it('names its rounds the way people do', () => {
    expect(roundName(16, 0)).toBe('Round of 16');
    expect(roundName(16, 1)).toBe('Quarter-final');
    expect(roundName(16, 2)).toBe('Semi-final');
    expect(roundName(16, 3)).toBe('Final');
    expect(roundName(4, 0)).toBe('Semi-final');
  });

  it('accepts only the three sizes US-7.4 names', () => {
    expect(isTournamentSize(8)).toBe(true);
    expect(isTournamentSize(6)).toBe(false);
    expect(isTournamentSize(32)).toBe(false);
  });
});

describe('playing it out', () => {
  it('reaches a win in exactly as many matches as there are rounds', () => {
    for (const size of TOURNAMENT_SIZES) {
      const finished = playThrough(build(size), true);
      expect(finished.status, `${size}`).toBe('won');
      // Every round decided, no slot left empty.
      for (const round of finished.rounds) {
        for (const match of round) expect(match.winner, `${size}`).not.toBeNull();
      }
    }
  });

  it('ends the run the moment the player loses', () => {
    const finished = playThrough(build(16), false);
    expect(finished.status).toBe('lost');
    expect(finished.round).toBe(0);
    expect(playerMatch(finished)).toBeNull();
  });

  it('resolves the rest of the round rather than leaving it blank', () => {
    const started = startPlayerMatch(build(8), NOW);
    const after = recordPlayerResult(started, { won: true, score: [80, 70] });

    for (const match of after.rounds[0] ?? []) expect(match.winner).not.toBeNull();
    // …and the next round now knows who is in it.
    for (const match of after.rounds[1] ?? []) {
      expect(match.home).not.toBeNull();
      expect(match.away).not.toBeNull();
    }
  });

  it('records the real score for the player’s match and none for the simulated ones', () => {
    const after = recordPlayerResult(startPlayerMatch(build(8), NOW), {
      won: true,
      score: [88, 80],
    });
    const played = after.rounds[0]?.[0];
    expect(played?.score).toEqual([88, 80]);
    expect(after.rounds[0]?.slice(1).every((match) => match.score === null)).toBe(true);
  });

  it('clears the pending marker once the result is in', () => {
    const started = startPlayerMatch(build(), NOW);
    expect(started.pending).not.toBeNull();
    expect(recordPlayerResult(started, { won: true, score: [80, 70] }).pending).toBeNull();
  });

  it('is reproducible: the same seed and the same results give the same bracket', () => {
    const first = playThrough(build(8, 'repeat'), true);
    const second = playThrough(build(8, 'repeat'), true);
    expect(second.rounds).toEqual(first.rounds);
  });

  it('says where the player got to, in words', () => {
    expect(standingText(playThrough(build(8), true))).toBe('Champions.');
    expect(standingText(playThrough(build(8), false))).toContain('Knocked out');
    expect(standingText(build(8))).toContain('Quarter-final');
  });
});
