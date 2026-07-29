/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.6 — Expectation comparison ("the sim would have made it") + post-match reporting
 * @story   US-15.5 — See how my decisions and my hands actually did
 * @design  09-modes-and-arcade.md §2.4, §2.5
 *
 * The report only counts; the counterfactual was recorded at settle time. These pin the counting,
 * and pin that the honest half of "honest and funny" stays honest when the number is unkind.
 */
import { describe, expect, it } from 'vitest';
import {
  buildReport,
  describeCalls,
  describeKeyMoments,
  describeLuck,
  keyMomentsFor,
} from '../../../../src/modes/playbook/report.ts';
import type {
  KeyMomentOutcome,
  PlaybookState,
  TurnResolution,
} from '../../../../src/modes/playbook/types.ts';
import { PlaybookMatch } from '../../../../src/modes/playbook/match.ts';
import { FAKE_RULES, fakeAdapter, squads, type FakeDetail } from '../../../helpers/playbook.ts';

function moment(made: boolean, simMade: boolean, simPoints: number): KeyMomentOutcome {
  return {
    invocation: { game: 'g', actor: 0, leverage: 0.9, prompt: 'x' },
    made,
    quality: made ? 0.8 : 0.2,
    simWouldHave: simMade,
    simPoints,
  };
}

function turn(overrides: Partial<TurnResolution> = {}): TurnResolution {
  return {
    turn: 0,
    calls: { offence: { side: 0, call: 'motion' }, defence: { side: 1, call: 'man' } },
    attacking: 0,
    outcome: 'made-two',
    actor: 0,
    points: 2,
    seconds: 16,
    retainsPossession: false,
    events: [],
    expectation: { successChance: 0.5, expectedPoints: 1, because: 'An even look.' },
    ...overrides,
  };
}

const STATE = { turn: 0 } as unknown as PlaybookState<unknown>;

describe('call lines', () => {
  it('reports points per possession, best first', () => {
    const report = buildReport(STATE, [
      turn({ calls: call('spot-up'), points: 3 }),
      turn({ calls: call('spot-up'), points: 0 }),
      turn({ calls: call('post-up'), points: 2 }),
      turn({ calls: call('post-up'), points: 2 }),
    ]);

    expect(report.sides[0].calls.map((line) => line.call)).toEqual(['post-up', 'spot-up']);
    expect(report.sides[0].calls[0]).toMatchObject({ turns: 2, points: 4, perTurn: 2 });
    expect(report.sides[0].calls[1]?.perTurn).toBe(1.5);
  });

  it('carries what the model expected of each call, so the comparison is available', () => {
    const report = buildReport(STATE, [
      turn({ calls: call('motion'), points: 0, expectation: exp(0.4, 1.2) }),
    ]);
    expect(report.sides[0].calls[0]?.expectedPerTurn).toBeCloseTo(1.2, 6);
  });

  it('keeps each side’s possessions to itself', () => {
    const report = buildReport(STATE, [
      turn({ attacking: 0, points: 3 }),
      turn({ attacking: 1, points: 2 }),
      turn({ attacking: 1, points: 2 }),
    ]);
    expect(report.sides[0]).toMatchObject({ turns: 1, points: 3 });
    expect(report.sides[1]).toMatchObject({ turns: 2, points: 4 });
    expect(report.winner).toBe(1);
  });

  it('calls a draw a draw', () => {
    expect(
      buildReport(STATE, [turn({ points: 2 }), turn({ attacking: 1, points: 2 })]).winner,
    ).toBe(-1);
  });
});

describe('the key-moment comparison (`09` §2.4)', () => {
  it('counts what you made against what the sim would have', () => {
    const line = keyMomentsFor(
      [
        turn({ points: 3, fromKeyMoment: moment(true, false, 0) }),
        turn({ points: 0, fromKeyMoment: moment(false, true, 3) }),
        turn({ points: 2, fromKeyMoment: moment(true, true, 2) }),
      ],
      0,
    );
    expect(line).toMatchObject({ played: 3, made: 2, simWouldHaveMade: 2 });
  });

  it('is the exact point difference, not a reconstruction', () => {
    const line = keyMomentsFor(
      [
        turn({ points: 3, fromKeyMoment: moment(true, false, 0) }),
        turn({ points: 0, fromKeyMoment: moment(false, true, 2) }),
      ],
      0,
    );
    expect(line.pointSwing).toBe(1);
  });

  it('reports a negative swing without softening it', () => {
    const line = keyMomentsFor(
      [
        turn({ points: 0, fromKeyMoment: moment(false, true, 3) }),
        turn({ points: 0, fromKeyMoment: moment(false, true, 2) }),
      ],
      0,
    );
    expect(line.pointSwing).toBe(-5);
    expect(describeKeyMoments(line)).toContain('cost you 5 points');
  });

  it('attributes a steal to the side that made it, not the side with the ball', () => {
    const stolen = turn({
      attacking: 0,
      outcome: 'stolen',
      points: 0,
      fromKeyMoment: moment(true, false, 2),
    });
    expect(keyMomentsFor([stolen], 1).played).toBe(1);
    expect(keyMomentsFor([stolen], 0).played).toBe(0);
  });

  it('averages the quality of what was played', () => {
    const line = keyMomentsFor(
      [
        turn({ fromKeyMoment: moment(true, true, 2) }),
        turn({ points: 0, fromKeyMoment: moment(false, false, 0) }),
      ],
      0,
    );
    expect(line.quality).toBeCloseTo(0.5, 6);
  });

  it('says nothing happened when nothing did', () => {
    const line = keyMomentsFor([turn()], 0);
    expect(line.played).toBe(0);
    expect(describeKeyMoments(line)).toBe('No key moments this match.');
  });

  it('says so plainly when you matched the sim', () => {
    const line = keyMomentsFor([turn({ points: 2, fromKeyMoment: moment(true, true, 2) })], 0);
    expect(describeKeyMoments(line)).toContain('exactly the same');
  });

  it('says so when you beat it', () => {
    const line = keyMomentsFor([turn({ points: 3, fromKeyMoment: moment(true, false, 0) })], 0);
    expect(describeKeyMoments(line)).toContain('3 points up on it');
  });

  it('does not call the same tally the same match when the points differ', () => {
    // One made three where the sim would have missed; one missed two where it would have scored.
    const line = keyMomentsFor(
      [
        turn({ points: 3, fromKeyMoment: moment(true, false, 0) }),
        turn({ points: 0, fromKeyMoment: moment(false, true, 2) }),
      ],
      0,
    );
    expect(line).toMatchObject({ made: 1, simWouldHaveMade: 1, pointSwing: 1 });
    expect(describeKeyMoments(line)).not.toContain('exactly the same');
    expect(describeKeyMoments(line)).toContain('1 points up on it');
  });

  it('says it came out even when the tally differs but the points do not', () => {
    // Two made — a two and a free throw the sim would have missed — against one missed three it
    // would have made. Three moments to its one, and the same points.
    const line = keyMomentsFor(
      [
        turn({ points: 2, fromKeyMoment: moment(true, false, 0) }),
        turn({ points: 0, fromKeyMoment: moment(false, true, 3) }),
        turn({ points: 1, fromKeyMoment: moment(true, false, 0) }),
      ],
      0,
    );
    expect(line).toMatchObject({ made: 2, simWouldHaveMade: 1, pointSwing: 0 });
    expect(describeKeyMoments(line)).toContain('came out even');
  });
});

describe('the words', () => {
  it('names the best and worst call', () => {
    const report = buildReport(STATE, [
      turn({ calls: call('spot-up'), points: 3 }),
      turn({ calls: call('post-up'), points: 0 }),
    ]);
    const text = describeCalls(report.sides[0]);
    expect(text).toContain('spot-up paid best');
    expect(text).toContain('post-up paid worst');
  });

  it('does not name one call twice when there was only one', () => {
    const report = buildReport(STATE, [turn({ calls: call('motion'), points: 2 })]);
    expect(describeCalls(report.sides[0])).toBe('motion paid best at 2.00 points a possession.');
  });

  it('has something to say about a side that never had the ball', () => {
    const report = buildReport(STATE, [turn({ attacking: 0 })]);
    expect(describeCalls(report.sides[1])).toBe('No possessions to report on.');
  });

  it('states luck as a number, in both directions', () => {
    const lucky = buildReport(STATE, [turn({ points: 12, expectation: exp(0.5, 1) })]);
    const unlucky = buildReport(STATE, [turn({ points: 0, expectation: exp(0.5, 9) })]);
    expect(describeLuck(lucky.sides[0])).toContain('11 more than the model expected');
    expect(describeLuck(unlucky.sides[0])).toContain('9 fewer than the model expected');
  });

  it('does not claim luck for a couple of points either way', () => {
    const report = buildReport(STATE, [turn({ points: 2, expectation: exp(0.5, 1) })]);
    expect(describeLuck(report.sides[0])).toBe('You scored about what the model expected.');
  });
});

describe('the swing turn', () => {
  it('is the possession furthest from what was expected of it', () => {
    const big = turn({ turn: 4, points: 3, expectation: exp(0.2, 0.4) });
    const report = buildReport(STATE, [turn({ points: 2, expectation: exp(0.9, 1.9) }), big]);
    expect(report.swingTurn?.turn).toBe(4);
  });

  it('is null for a match with no turns', () => {
    expect(buildReport(STATE, []).swingTurn).toBeNull();
  });
});

describe('against a real match', () => {
  it('reports the same points the match scored', () => {
    const match = new PlaybookMatch<FakeDetail>({
      seed: 'report',
      adapter: fakeAdapter({ keyMoments: true, appliesKeyMoment: true }),
      sport: 'testsport',
      rules: FAKE_RULES,
      squads: squads(),
      keyMoments: 'every',
    });

    let guard = 0;
    while (!match.finished && guard < 200) {
      for (const side of [0, 1] as const) {
        const call = match.autoCall(side);
        if (call !== null) match.submit(call);
      }
      match.resolve();
      if (match.phase === 'key-moment')
        match.settleKeyMoment({ made: guard % 2 === 0, quality: 0.6 });
      match.advance();
      guard += 1;
    }

    const report = buildReport(match.state, match.turns);
    expect(report.sides[0].points).toBe(match.view().score[0]);
    expect(report.sides[1].points).toBe(match.view().score[1]);
    expect(report.turns).toBe(match.turns.length);
    expect(report.sides[0].keyMoments.played).toBeGreaterThan(0);
  });
});

function call(id: string): TurnResolution['calls'] {
  return { offence: { side: 0, call: id }, defence: { side: 1, call: 'man' } };
}

function exp(chance: number, points: number): TurnResolution['expectation'] {
  return { successChance: chance, expectedPoints: points, because: 'x' };
}
