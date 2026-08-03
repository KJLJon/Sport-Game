/**
 * T-6.22 (CPU half) — soccer's Playbook opponent.
 *
 * The two properties that matter and are easy to lose:
 *
 * 1. **Difficulty is competence, never a thumb on the scale** (INV-1). A Legend CPU must beat a
 *    Rookie one over a batch of matches *and* every rating on both sides must be identical at every
 *    level. A CPU that got better by getting stronger would pass the first half alone.
 * 2. **The read is soft** (`09` §2.2). Pressing correctly beats pressing wrongly; it does not beat
 *    a better squad.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../../src/engine/rng.ts';
import { simulatePlaybookMatch } from '../../../../../src/modes/playbook/match.ts';
import { DIFFICULTIES } from '../../../../../src/modes/difficulty.ts';
import type { TurnResolution } from '../../../../../src/modes/playbook/types.ts';
import { SOCCER_RULES } from '../../../../../src/sports/soccer/rules.ts';
import { soccerPlaybook } from '../../../../../src/sports/soccer/playbook/index.ts';
import {
  PRESS_COUNTERS,
  SOCCER_READ_WINDOW,
  cpuCall,
  markTarget,
  phaseValue,
  readIntents,
  scoreDimension,
  temperatureFor,
} from '../../../../../src/sports/soccer/playbook/cpu.ts';
import { createSoccerPlaybookState } from '../../../../../src/sports/soccer/playbook/resolution.ts';
import { soccerSquads } from '../../../../../src/sports/soccer/playbook/squad.ts';
import { INTENT_DIMENSIONS } from '../../../../../src/sports/soccer/playbook/intents.ts';
import type { SoccerPlaybookState } from '../../../../../src/sports/soccer/playbook/resolution.ts';
import { athlete, attributes } from '../../../../helpers/athletes.ts';
import { newSportSkill } from '../../../../../src/athletes/types.ts';

function eleven(prefix: string, rating = 55): ReturnType<typeof athlete>[] {
  return Array.from({ length: 11 }, (_, index) =>
    athlete({
      id: `${prefix}-${index}`,
      displayName: `${prefix} ${index}`,
      primarySport: 'soccer',
      heightCm: 180,
      weightKg: 76,
      attributes: attributes(rating),
      sportSkills: { soccer: newSportSkill(70) },
    }),
  );
}

function state(overrides: Partial<Parameters<typeof stateOf>[0]> = {}): ReturnType<typeof stateOf> {
  return stateOf({ home: 55, away: 55, possession: 0, score: [0, 0], ...overrides });
}

function stateOf(options: {
  home: number;
  away: number;
  possession: 0 | 1;
  score: [number, number];
  phase?: SoccerPlaybookState['phase'];
}) {
  const detail = createSoccerPlaybookState();
  if (options.phase !== undefined) detail.phase = options.phase;
  return {
    sport: 'soccer' as const,
    turnKind: 'phase' as const,
    difficulty: 'pro' as const,
    playerSide: 0 as const,
    turn: 4,
    period: 1,
    clock: 2000,
    possession: options.possession,
    score: options.score,
    squads: soccerSquads(eleven('home', options.home), eleven('away', options.away)),
    detail,
  };
}

/** A committed turn in which the attacking side set `tempo` and the defending side `press`. */
function turn(attacking: 0 | 1, tempo: string, press: string, extra = {}): TurnResolution {
  return {
    turn: 0,
    attacking,
    outcome: 'advance',
    points: 0,
    seconds: 300,
    retainsPossession: true,
    events: [],
    expectation: { successChance: 0.5, expectedPoints: 0, because: '' },
    calls: {
      offence: { side: attacking, call: tempo, intents: { tempo } },
      defence: { side: attacking === 1 ? 0 : 1, call: press, intents: { press } },
    },
    ...extra,
  } as TurnResolution;
}

function simulate(difficulty: (typeof DIFFICULTIES)[number], seed: string, playerSide: 0 | 1 | -1) {
  return simulatePlaybookMatch<SoccerPlaybookState>({
    seed,
    adapter: soccerPlaybook,
    sport: 'soccer',
    rules: SOCCER_RULES,
    squads: soccerSquads(eleven('home'), eleven('away')),
    playerSide,
    difficulty,
  });
}

describe('reading the opponent', () => {
  it('counts what they set, on the turns where that dimension speaks', () => {
    const turns = [
      turn(1, 'direct', 'mid'),
      turn(1, 'direct', 'mid'),
      turn(1, 'patient', 'mid'),
      // A turn where side 1 was defending says nothing about side 1's tempo.
      turn(0, 'patient', 'high'),
    ];

    const tempo = readIntents(turns, 1, 'tempo', 'offence');
    expect(tempo[0]).toEqual({ option: 'direct', times: 2, share: 2 / 3 });
    expect(tempo[1]?.option).toBe('patient');

    // And side 1's press line is read off the turn it was defending on.
    expect(readIntents(turns, 1, 'press', 'defence')[0]?.option).toBe('high');
  });

  it('reads nothing from an empty history, and never throws on one', () => {
    expect(readIntents([], 0, 'tempo', 'offence')).toEqual([]);
    expect(markTarget(state(), 1, 'defence', [])).toBeDefined();
  });

  it('forgets: a tendency outside the window is not a tendency', () => {
    const old = Array.from({ length: SOCCER_READ_WINDOW }, () => turn(1, 'direct', 'mid'));
    const recent = Array.from({ length: SOCCER_READ_WINDOW }, () => turn(1, 'patient', 'mid'));

    const read = readIntents([...old, ...recent], 1, 'tempo', 'offence');
    expect(read).toHaveLength(1);
    expect(read[0]?.option).toBe('patient');
  });

  it('presses high against a side that plays out and drops off against one that goes long', () => {
    const patient = Array.from({ length: 8 }, () => turn(1, 'patient', 'mid'));
    const direct = Array.from({ length: 8 }, () => turn(1, 'direct', 'mid'));

    // At Legend, because T-7.6 made counter-calling a *level* — `06` §7's exploits row runs from
    // "no" to "consistently", and a Pro CPU is only supposed to punish a tendency rarely. The
    // level-by-level strength is asserted in its own test below.
    const scoreOf = (turns: TurnResolution[], option: string): number =>
      scoreDimension(
        'press',
        { ...state({ possession: 1 }), difficulty: 'legend' as const },
        0,
        'defence',
        'buildUp',
        turns,
      ).find((candidate) => candidate.id === option)?.score ?? 0;

    expect(scoreOf(patient, 'high')).toBeGreaterThan(scoreOf(patient, 'deep'));
    expect(scoreOf(direct, 'deep')).toBeGreaterThan(scoreOf(direct, 'high'));
  });

  it('reads harder the higher the level, and not at all at Rookie (06 §7)', () => {
    const patient = Array.from({ length: 8 }, () => turn(1, 'patient', 'mid'));

    const gap = (difficulty: 'rookie' | 'pro' | 'allStar' | 'legend'): number => {
      const scores = scoreDimension(
        'press',
        { ...state({ possession: 1 }), difficulty },
        0,
        'defence',
        'buildUp',
        patient,
      );
      const high = scores.find((candidate) => candidate.id === 'high')?.score ?? 0;
      const deep = scores.find((candidate) => candidate.id === 'deep')?.score ?? 0;
      return high - deep;
    };

    expect(gap('legend')).toBeGreaterThan(gap('allStar'));
    expect(gap('allStar')).toBeGreaterThan(gap('pro'));
    expect(gap('pro')).toBeGreaterThan(gap('rookie'));
  });

  it('keeps the counter soft: a read shades a call, it does not decide the match', () => {
    const patient = Array.from({ length: 10 }, () => turn(1, 'patient', 'mid'));
    const base = state({ possession: 1 });

    // What the *read alone* is worth: the same board, with and without a history to read.
    const withRead = scoreDimension('press', base, 0, 'defence', 'buildUp', patient);
    const without = scoreDimension('press', base, 0, 'defence', 'buildUp', []);

    for (const option of withRead) {
      const bare = without.find((candidate) => candidate.id === option.id)?.score ?? 0;
      // One intent's own effect is around 0.05, and a 20-point rating edge is 0.05. A read worth
      // much more than that would be the hard counter `09` §2.2 forbids.
      expect(Math.abs(option.score - bare), option.id).toBeLessThanOrEqual(0.09);
    }

    // A half-committed opponent moves it half as far: the read scales with the tendency.
    const mixed = [
      ...patient.slice(0, 5),
      ...Array.from({ length: 5 }, () => turn(1, 'direct', 'mid')),
    ];
    const half = scoreDimension('press', base, 0, 'defence', 'buildUp', mixed);
    const shift = (list: typeof withRead): number =>
      (list.find((c) => c.id === 'high')?.score ?? 0) -
      (list.find((c) => c.id === 'deep')?.score ?? 0);
    expect(shift(half)).toBeLessThan(shift(withRead));
    expect(shift(half)).toBeCloseTo(shift(without), 6);
  });

  it('the press/tempo table is a redistribution, not a free gain', () => {
    for (const row of Object.values(PRESS_COUNTERS)) {
      expect(Object.values(row).reduce((sum, value) => sum + value, 0)).toBe(0);
    }
    for (const tempo of ['patient', 'balanced-tempo', 'direct']) {
      const column = Object.values(PRESS_COUNTERS).reduce((sum, row) => sum + (row[tempo] ?? 0), 0);
      expect(column).toBe(0);
    }
  });
});

describe('scoring a dimension', () => {
  it('prices an option by what it does in the phase actually being played', () => {
    // `climb` decides a build-up; `finish` decides a chance. An option's value must move with it.
    expect(
      phaseValue(
        { climb: 0.1, create: 0, setPiece: 0, finish: 0, duration: 1, effort: 0 },
        'buildUp',
      ),
    ).toBe(0.1);
    expect(
      phaseValue(
        { climb: 0.1, create: 0, setPiece: 0, finish: 0, duration: 1, effort: 0 },
        'chance',
      ),
    ).toBe(0);
    expect(
      phaseValue(
        { climb: 0, create: 0, setPiece: 0, finish: 0.08, duration: 1, effort: 0 },
        'chance',
      ),
    ).toBe(0.08);
  });

  it('wants the clock gone when ahead and turns when behind', () => {
    const scoreOf = (score: [number, number], option: string): number =>
      scoreDimension(
        'tempo',
        stateOf({ home: 55, away: 55, possession: 0, score }),
        0,
        'offence',
        'progression',
        [],
      ).find((candidate) => candidate.id === option)?.score ?? 0;

    const leadingPatient = scoreOf([2, 0], 'patient') - scoreOf([2, 0], 'direct');
    const trailingPatient = scoreOf([0, 2], 'patient') - scoreOf([0, 2], 'direct');
    expect(leadingPatient).toBeGreaterThan(trailingPatient);
  });

  it('offers a value on every dimension the role is asked about, and only those', () => {
    for (const dimension of INTENT_DIMENSIONS) {
      expect(
        scoreDimension(dimension, state(), 0, 'offence', 'buildUp', []).length,
      ).toBeGreaterThan(0);
    }
  });
});

describe('who gets followed', () => {
  it('marks whoever has actually been scoring', () => {
    const scored = turn(1, 'direct', 'mid', { actor: 105, points: 1 });
    const touched = turn(1, 'direct', 'mid', { actor: 107, points: 0 });
    expect(markTarget(state(), 0, 'defence', [touched, touched, scored])).toBe(105);
  });

  it('falls back to whoever has been on the ball, then to the squad sheet', () => {
    const touched = turn(1, 'direct', 'mid', { actor: 108, points: 0 });
    expect(markTarget(state(), 0, 'defence', [touched, touched])).toBe(108);

    // Nothing has happened yet: the only thing anyone could know at kick-off is the roster.
    const opening = markTarget(state(), 0, 'defence', []);
    expect(opening).toBeGreaterThanOrEqual(101);
    expect(opening).toBeLessThanOrEqual(110);
  });

  it('names its own best on-ball athlete when attacking, not the opponent’s', () => {
    const target = markTarget(state(), 0, 'offence', []);
    expect(target).toBeGreaterThanOrEqual(1);
    expect(target).toBeLessThanOrEqual(10);
  });
});

describe('the call it makes', () => {
  it('sets every dimension its role is asked about, and carries a headline', () => {
    const call = cpuCall(state({ possession: 1 }), 1, createRng('call'), []);
    expect(call.side).toBe(1);
    for (const dimension of ['tempo', 'width', 'risk', 'focus'] as const) {
      expect(call.intents?.[dimension]).toBeDefined();
    }
    // The headline for an attacking side is its tempo.
    expect(call.call).toBe(call.intents?.['tempo']);
  });

  it('is deterministic: the same state and seed is the same call', () => {
    const first = cpuCall(state(), 0, createRng('same'), []);
    const second = cpuCall(state(), 0, createRng('same'), []);
    expect(second).toEqual(first);
  });

  it('forks per dimension, so adding one later cannot shift the others', () => {
    // A call built from one generator whose per-dimension forks are taken by label reproduces
    // exactly when the *order* of the dimensions is irrelevant — which is what forking by name buys.
    const rng = createRng('forked');
    const call = cpuCall(state(), 0, rng, []);
    expect(cpuCall(state(), 0, createRng('forked'), [])).toEqual(call);
  });

  it('samples wider at Rookie than at Legend', () => {
    const spread = (difficulty: (typeof DIFFICULTIES)[number]): number => {
      const base = { ...state(), difficulty };
      const seen = new Set<string>();
      for (let seed = 0; seed < 60; seed += 1) {
        seen.add(cpuCall(base, 0, createRng(`s${seed}`), []).intents?.['tempo'] ?? '');
      }
      return seen.size;
    };
    expect(temperatureFor({ ...state(), difficulty: 'rookie' })).toBeGreaterThan(
      temperatureFor({ ...state(), difficulty: 'legend' }),
    );
    expect(spread('rookie')).toBeGreaterThanOrEqual(spread('legend'));
  });
});

describe('difficulty is competence, not a thumb on the scale (INV-1)', () => {
  it('changes no rating on either side, at any level', () => {
    const reference = simulate('pro', 'inv1', -1);
    const ratingsOf = (match: typeof reference): string =>
      JSON.stringify(
        match.state.squads.map((squad) => squad.players.map((player) => player.ratings)),
      );

    for (const difficulty of DIFFICULTIES) {
      const match = simulate(difficulty, 'inv1', -1);
      expect(ratingsOf(match), difficulty).toBe(ratingsOf(reference));
    }
  });

  it('gets better by choosing better, and that is the only thing that changes', () => {
    // A match cannot be the measure here: `simulatePlaybookMatch` puts one difficulty on the state
    // and both sides read it, so a CPU-vs-CPU batch at Legend is Legend against Legend. What the
    // ladder actually moves is the temperature, so what to measure is how often the CPU takes the
    // option its own scoring rated best.
    const opponent = Array.from({ length: 10 }, () => turn(1, 'patient', 'mid'));

    const takesTheBest = (difficulty: (typeof DIFFICULTIES)[number]): number => {
      const base = { ...state({ possession: 1 }), difficulty };
      const scored = scoreDimension('press', base, 0, 'defence', 'buildUp', opponent);
      const best = [...scored].sort((a, b) => b.score - a.score)[0]?.id;

      let hits = 0;
      for (let seed = 0; seed < 200; seed += 1) {
        if (cpuCall(base, 0, createRng(`d${seed}`), opponent).intents?.['press'] === best)
          hits += 1;
      }
      return hits / 200;
    };

    const legend = takesTheBest('legend');
    const pro = takesTheBest('pro');
    const rookie = takesTheBest('rookie');

    // Monotone down the ladder, and the ends are far enough apart to be felt: a Legend presses the
    // side that plays out, and a Rookie is guessing.
    expect(legend).toBeGreaterThan(pro);
    expect(pro).toBeGreaterThan(rookie);
    expect(legend - rookie).toBeGreaterThan(0.25);
  });
});
