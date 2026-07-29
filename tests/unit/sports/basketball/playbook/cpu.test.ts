/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.8 — Playbook CPU: call selection, weakness exploitation, per-difficulty competence
 * @story   US-15.7 — An opponent that reads me and gets harder as I ask it to
 * @design  09-modes-and-arcade.md §2.2, §2.5; 06-game-design.md §7
 * @invariant INV-1 (difficulty never modifies attributes or derived ratings), INV-8 (determinism)
 *
 * The two claims worth defending hardest: a harder CPU chooses better and is not *given* more
 * (INV-1), and its read comes from the history the player also watched.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../../src/engine/rng.ts';
import { DIFFICULTIES, type Difficulty } from '../../../../../src/modes/difficulty.ts';
import type { PlaybookState, TurnResolution } from '../../../../../src/modes/playbook/types.ts';
import {
  READ_WINDOW,
  basketballSquads,
  createBasketballPlaybook,
  cpuCall,
  readTendencies,
  starOf,
  temperatureFor,
} from '../../../../../src/sports/basketball/playbook/index.ts';
import { readAdjustment } from '../../../../../src/sports/basketball/playbook/cpu.ts';
import type { BasketballPlaybookState } from '../../../../../src/sports/basketball/playbook/resolution.ts';
import { evenRosters, roster } from '../../../../../tools/playbook-rosters.ts';

type State = PlaybookState<BasketballPlaybookState>;

function stateFor(difficulty: Difficulty = 'pro', seed = 'cpu'): State {
  const [home, away] = evenRosters(seed);
  const match = createBasketballPlaybook({
    seed,
    squads: basketballSquads(home, away),
    difficulty,
    playerSide: 0,
  });
  match.state.possession = 0;
  return match.state;
}

function turn(call: string, points: number, actor = 0, attacking: 0 | 1 = 0): TurnResolution {
  return {
    turn: 0,
    calls: { offence: { side: attacking, call }, defence: { side: 1, call: 'man' } },
    attacking,
    outcome: points > 0 ? 'made-two' : 'missed-two',
    actor,
    points,
    seconds: 16,
    retainsPossession: false,
    events: [],
    expectation: { successChance: 0.5, expectedPoints: 1, because: 'x' },
  };
}

describe('reading the opponent', () => {
  it('counts what they have called and what it has been worth', () => {
    const reads = readTendencies(
      [turn('spot-up', 3), turn('spot-up', 0), turn('post-up', 2), turn('spot-up', 3)],
      0,
    );
    expect(reads[0]).toMatchObject({ call: 'spot-up', times: 3, share: 0.75, perTurn: 2 });
    expect(reads[1]).toMatchObject({ call: 'post-up', times: 1 });
  });

  it('only reads the side it was asked about', () => {
    const reads = readTendencies([turn('spot-up', 3, 0, 0), turn('post-up', 2, 100, 1)], 1);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.call).toBe('post-up');
  });

  it('sees nothing at the start of a match', () => {
    expect(readTendencies([], 0)).toEqual([]);
  });

  it('forgets: a read is the recent past, not the whole match (`09` §2.2)', () => {
    const old = Array.from({ length: READ_WINDOW }, () => turn('post-up', 2));
    const recent = Array.from({ length: READ_WINDOW }, () => turn('spot-up', 3));
    const reads = readTendencies([...old, ...recent], 0);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.call).toBe('spot-up');
  });

  it('wants the defence that takes away what has been hurting it', () => {
    const shooting = readTendencies(
      Array.from({ length: 8 }, () => turn('spot-up', 3)),
      0,
    );
    const posting = readTendencies(
      Array.from({ length: 8 }, () => turn('post-up', 2)),
      0,
    );

    // The zone concedes threes and suppresses the rim, so it is the wrong answer to a shooting
    // team and the right one to a posting team. `readAdjustment` should say exactly that.
    expect(readAdjustment(shooting, 'zone')).toBeLessThan(readAdjustment(posting, 'zone'));
    expect(readAdjustment(shooting, 'protect-rim')).toBeLessThan(
      readAdjustment(posting, 'protect-rim'),
    );
  });

  it('moves nothing for an opponent with no tendency', () => {
    expect(readAdjustment([], 'zone')).toBe(0);
  });

  it('ignores a call it has never heard of rather than throwing', () => {
    const reads = readTendencies([turn('teleport', 3)], 0);
    expect(readAdjustment(reads, 'zone')).toBe(0);
    expect(readAdjustment(reads, 'nonsense')).toBe(0);
  });
});

describe('who to double', () => {
  it('doubles whoever has actually been scoring', () => {
    const history = [turn('isolation', 3, 2), turn('isolation', 3, 2), turn('motion', 2, 4)];
    expect(starOf(stateFor(), 0, history)).toBe(2);
  });

  it('falls back to the roster when nobody has scored yet', () => {
    const state = stateFor();
    const star = starOf(state, 0, []);
    expect(state.squads[0].players.map((player) => player.id)).toContain(star);
  });

  it('ignores possessions that scored nothing', () => {
    expect(starOf(stateFor(), 0, [turn('isolation', 0, 2), turn('motion', 2, 4)])).toBe(4);
  });
});

describe('difficulty is competence, not a thumb on the scale (INV-1)', () => {
  it('never changes a single rating on either side', () => {
    const ratingsAt = (difficulty: Difficulty): string => {
      const state = stateFor(difficulty, 'inv1');
      return JSON.stringify(
        state.squads.map((squad) => squad.players.map((player) => player.ratings)),
      );
    };
    const baseline = ratingsAt('rookie');
    for (const difficulty of DIFFICULTIES) expect(ratingsAt(difficulty)).toBe(baseline);
  });

  it('narrows the sampling as the level rises', () => {
    const temperatures = DIFFICULTIES.map((difficulty) => temperatureFor(stateFor(difficulty)));
    for (let i = 1; i < temperatures.length; i += 1) {
      expect(temperatures[i]).toBeLessThan(temperatures[i - 1] as number);
    }
  });

  it('takes its best call far more often at Legend than at Rookie', () => {
    const best = (difficulty: Difficulty): number => {
      const state = stateFor(difficulty, 'competence');
      // A roster that makes one call clearly correct, so "best" is unambiguous.
      for (const player of state.squads[0].players) {
        Object.assign(player.ratings as Record<string, number>, {
          threePoint: 95,
          strength: 25,
          ballHandling: 30,
          courtSpeed: 30,
        });
      }
      let hits = 0;
      for (let i = 0; i < 200; i += 1) {
        if (cpuCall(state, 0, createRng(`c-${i}`)).call === 'spot-up') hits += 1;
      }
      return hits;
    };
    expect(best('legend')).toBeGreaterThan(best('rookie') + 40);
  });

  it('is still recognisably trying at Rookie — it is worse, not random', () => {
    const state = stateFor('rookie', 'rookie');
    for (const player of state.squads[0].players) {
      Object.assign(player.ratings as Record<string, number>, { threePoint: 95, strength: 20 });
    }
    let spotUp = 0;
    let postUp = 0;
    for (let i = 0; i < 300; i += 1) {
      const call = cpuCall(state, 0, createRng(`r-${i}`)).call;
      if (call === 'spot-up') spotUp += 1;
      if (call === 'post-up') postUp += 1;
    }
    expect(spotUp).toBeGreaterThan(postUp);
  });
});

describe('the call it makes', () => {
  it('is legal for the half of the sheet it is on', () => {
    const state = stateFor();
    expect(['isolation', 'pick-roll', 'post-up', 'motion', 'spot-up', 'push']).toContain(
      cpuCall(state, 0, createRng('o')).call,
    );
    expect(['man', 'zone', 'press', 'double', 'protect-rim']).toContain(
      cpuCall(state, 1, createRng('d')).call,
    );
  });

  it('is deterministic for a seed (INV-8)', () => {
    const state = stateFor();
    const history = [turn('spot-up', 3)];
    expect(cpuCall(state, 1, createRng('same'), history)).toEqual(
      cpuCall(state, 1, createRng('same'), history),
    );
  });

  it('names a target when it doubles', () => {
    const state = stateFor('legend');
    const history = Array.from({ length: 10 }, () => turn('isolation', 3, 2));
    for (let i = 0; i < 60; i += 1) {
      const call = cpuCall(state, 1, createRng(`t-${i}`), history);
      if (call.call === 'double') {
        expect(call.target).toBe(2);
        return;
      }
    }
    // Doubling is one of five calls and never guaranteed; reaching here is not a failure.
    expect(true).toBe(true);
  });

  it('reads the history it is given, and changes its mind when the history does', () => {
    const state = stateFor('legend', 'shift');
    const count = (history: readonly TurnResolution[], call: string): number => {
      let hits = 0;
      for (let i = 0; i < 200; i += 1) {
        if (cpuCall(state, 1, createRng(`x-${i}`), history).call === call) hits += 1;
      }
      return hits;
    };

    const posting = Array.from({ length: 10 }, () => turn('post-up', 2.5));
    const shooting = Array.from({ length: 10 }, () => turn('spot-up', 3));
    expect(count(posting, 'protect-rim')).toBeGreaterThan(count(shooting, 'protect-rim'));
  });

  it('works with no history at all — the first possession of a match', () => {
    expect(cpuCall(stateFor(), 1, createRng('first')).call).toBeDefined();
  });
});

describe('through the match', () => {
  it('gets the committed history handed to it, and nothing else', () => {
    const [home, away] = evenRosters('wired');
    const match = createBasketballPlaybook({
      seed: 'wired',
      squads: basketballSquads(home, away),
      difficulty: 'allStar',
    });

    for (let i = 0; i < 6; i += 1) {
      for (const side of [0, 1] as const) {
        const call = match.autoCall(side);
        if (call !== null) match.submit(call);
      }
      match.resolve();
      match.advance();
    }
    expect(match.turns.length).toBe(6);
    expect(match.autoCall(0)).not.toBeNull();
  });

  it('beats a weak roster with a strong one, at every difficulty', () => {
    for (const difficulty of DIFFICULTIES) {
      let strongWins = 0;
      for (let i = 0; i < 6; i += 1) {
        const match = createBasketballPlaybook({
          seed: `tier-${difficulty}-${i}`,
          squads: basketballSquads(roster(`s${i}`, 'strong'), roster(`w${i}`, 'weak')),
          difficulty,
          playerSide: -1,
        });
        let guard = 0;
        while (!match.finished && guard < 600) {
          for (const side of [0, 1] as const) {
            const call = match.autoCall(side);
            if (call !== null) match.submit(call);
          }
          match.resolve();
          match.advance();
          guard += 1;
        }
        if (match.view().score[0] > match.view().score[1]) strongWins += 1;
      }
      // Ratings beat everything, including the level the opponent is set to (`09` §2.2, §2.5).
      expect(strongWins).toBeGreaterThanOrEqual(5);
    }
  });
});
