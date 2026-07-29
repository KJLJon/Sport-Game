/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.10 — Match state machine + `SportEvent` bus
 * @story   US-2.4 — Play a match that feels like the sport
 * @design  04-architecture.md §6, 09-modes-and-arcade.md §5
 * @invariant INV-8, INV-9
 *
 * Purpose: the clock, the phase transitions including the illegal ones, overtime, and the bus's
 * two contracts — synchronous delivery, and one listener's failure never taking the match down.
 */
import { describe, expect, it, vi } from 'vitest';
import { EventBus, EventKind, event, type SportEvent } from '@/engine/match/events.ts';
import { MatchPhase, MatchStateMachine, type MatchRules } from '@/engine/match/state-machine.ts';

const RULES: MatchRules = { periods: 4, periodSteps: 60, overtimeSteps: 30 };

function machine(overrides: Partial<MatchRules> = {}) {
  const bus = new EventBus();
  return { match: new MatchStateMachine({ ...RULES, ...overrides }, bus), bus };
}

function runSteps(match: MatchStateMachine, count: number) {
  for (let i = 0; i < count; i++) match.step();
}

describe('EventBus', () => {
  it('delivers synchronously, in subscription order', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on(() => order.push('first'));
    bus.on(() => order.push('second'));

    bus.emit(event(EventKind.SHOT, 1, 0));
    expect(order).toEqual(['first', 'second']);
  });

  it('unsubscribes', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const off = bus.on(listener);

    bus.emit(event(EventKind.SHOT, 1, 0));
    off();
    bus.emit(event(EventKind.SHOT, 2, 0));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('contains a listener that throws', () => {
    const bus = new EventBus();
    const survivor = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    bus.on(() => {
      throw new Error('a broken achievement rule');
    });
    bus.on(survivor);

    expect(() => bus.emit(event(EventKind.SCORE, 1, 0))).not.toThrow();
    expect(survivor).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('survives a listener that unsubscribes during delivery', () => {
    const bus = new EventBus();
    const second = vi.fn();
    const off = bus.on(() => off());
    bus.on(second);

    bus.emit(event(EventKind.SHOT, 1, 0));
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps a history and filters it by kind', () => {
    const bus = new EventBus();
    bus.emit(event(EventKind.SHOT, 1, 0));
    bus.emit(event(EventKind.SCORE, 2, 0, { value: 2 }));
    bus.emit(event(EventKind.SHOT, 3, 1));

    expect(bus.history()).toHaveLength(3);
    expect(bus.filter(EventKind.SHOT)).toHaveLength(2);
    expect(bus.filter(EventKind.SCORE)[0]?.value).toBe(2);
  });

  it('bounds its history and says how much it dropped', () => {
    const bus = new EventBus(4);
    for (let i = 0; i < 10; i++) bus.emit(event(EventKind.PASS, i, 0));

    expect(bus.history()).toHaveLength(4);
    expect(bus.droppedCount).toBe(6);
    expect(bus.history()[0]?.step).toBe(6);
  });

  it('emits a batch in order', () => {
    const bus = new EventBus();
    const seen: SportEvent[] = [];
    bus.on((e) => seen.push(e));

    bus.emitAll([event(EventKind.PASS, 1, 0), event(EventKind.SHOT, 1, 0)]);
    expect(seen.map((e) => e.kind)).toEqual([EventKind.PASS, EventKind.SHOT]);
  });

  it('clears', () => {
    const bus = new EventBus(2);
    for (let i = 0; i < 5; i++) bus.emit(event(EventKind.PASS, i, 0));
    bus.clear();

    expect(bus.history()).toHaveLength(0);
    expect(bus.droppedCount).toBe(0);
  });

  it('carries no mode field for a consumer to branch on (INV-9)', () => {
    const sample = event(EventKind.SHOT, 12, 0, { actor: 3, value: 6.4, x: 5, y: 9 });
    expect(Object.keys(sample)).not.toContain('mode');
    expect(Object.keys(sample)).not.toContain('source');
  });
});

describe('match phases', () => {
  it('starts in pre-match and goes live on start', () => {
    const { match } = machine();
    expect(match.currentPhase).toBe(MatchPhase.PRE_MATCH);
    expect(match.isRunning).toBe(false);

    match.start();
    expect(match.currentPhase).toBe(MatchPhase.LIVE);
    expect(match.currentPeriod).toBe(1);
    expect(match.isRunning).toBe(true);
  });

  it('announces the match and the first period', () => {
    const { match, bus } = machine();
    match.start();

    expect(bus.history().map((e) => e.kind)).toEqual([
      EventKind.MATCH_START,
      EventKind.PERIOD_START,
    ]);
  });

  it('does not run the clock before the match starts', () => {
    const { match } = machine();
    runSteps(match, 10);
    expect(match.steps).toBe(0);
  });

  it('holds the period clock during a stoppage by default', () => {
    const { match } = machine();
    match.start();
    runSteps(match, 10);

    match.stoppage('foul');
    runSteps(match, 20);
    expect(match.stepInPeriod).toBe(10);
    expect(match.steps).toBe(30);

    match.resume();
    runSteps(match, 5);
    expect(match.stepInPeriod).toBe(15);
  });

  it('runs the clock through stoppages when the sport says so', () => {
    const { match } = machine({ clockRunsInStoppage: true });
    match.start();
    match.stoppage('throw-in');
    runSteps(match, 10);

    expect(match.stepInPeriod).toBe(10);
  });

  it('breaks between periods and resumes into the next one', () => {
    const { match, bus } = machine();
    match.start();
    runSteps(match, 60);

    expect(match.currentPhase).toBe(MatchPhase.PERIOD_BREAK);
    expect(bus.filter(EventKind.PERIOD_END)).toHaveLength(1);

    match.nextPeriod();
    expect(match.currentPhase).toBe(MatchPhase.LIVE);
    expect(match.currentPeriod).toBe(2);
    expect(match.stepInPeriod).toBe(0);
  });

  it('rejects an illegal transition rather than quietly allowing it', () => {
    const { match } = machine();
    // `preMatch → live` is a legal edge — it is how start() works — so nextPeriod() has to guard
    // itself, or a mistaken call before kick-off would silently begin the match at period 2.
    expect(() => match.nextPeriod()).toThrow(/requires a period break/);

    match.start();
    expect(() => match.resume()).toThrow(/requires a stoppage/);

    match.abandon();
    expect(() => match.stoppage('late')).toThrow(/Illegal match transition/);
  });

  it('reports the steps left in the period', () => {
    const { match } = machine();
    match.start();
    runSteps(match, 25);
    expect(match.stepsRemaining).toBe(35);
  });
});

describe('scoring and result', () => {
  it('moves the score only through addScore, and emits every time', () => {
    const { match, bus } = machine();
    match.start();

    match.addScore(0, 3, 7);
    match.addScore(1, 2);

    expect(match.homeScore).toBe(3);
    expect(match.awayScore).toBe(2);

    const scores = bus.filter(EventKind.SCORE);
    expect(scores).toHaveLength(2);
    expect(scores[0]?.actor).toBe(7);
    expect(scores[1]?.side).toBe(1);
  });

  it('ignores a score for the neutral side', () => {
    const { match } = machine();
    match.start();
    match.addScore(-1, 3);

    expect(match.homeScore).toBe(0);
    expect(match.awayScore).toBe(0);
  });

  it('has no result until it is final', () => {
    const { match } = machine();
    match.start();
    expect(match.result()).toBeNull();
  });

  it('finishes after the last period and reports the winner', () => {
    const { match, bus } = machine();
    match.start();
    match.addScore(0, 10);

    for (let period = 0; period < 4; period++) {
      runSteps(match, 60);
      if (!match.isFinished) match.nextPeriod();
    }

    expect(match.isFinished).toBe(true);
    expect(match.result()).toEqual({
      homeScore: 10,
      awayScore: 0,
      winner: 0,
      periodsPlayed: 4,
      steps: 240,
    });
    expect(bus.filter(EventKind.MATCH_END)).toHaveLength(1);
  });

  it('plays overtime when tied, using the overtime length', () => {
    const { match } = machine();
    match.start();

    for (let period = 0; period < 4; period++) {
      runSteps(match, 60);
      if (!match.isFinished) match.nextPeriod();
    }

    // Tied after regulation, so the loop's last nextPeriod() opened overtime rather than the
    // match ending.
    expect(match.isFinished).toBe(false);
    expect(match.currentPhase).toBe(MatchPhase.LIVE);
    expect(match.currentPeriod).toBe(5);

    runSteps(match, 29);
    expect(match.isFinished).toBe(false);

    match.addScore(1, 2);
    runSteps(match, 1);
    expect(match.isFinished).toBe(true);
    expect(match.result()?.winner).toBe(1);
  });

  it('allows a draw when the sport has no overtime', () => {
    const { match } = machine({ periods: 2, overtimeSteps: 0 });
    match.start();
    runSteps(match, 60);
    match.nextPeriod();
    runSteps(match, 60);

    expect(match.isFinished).toBe(true);
    expect(match.result()?.winner).toBe(-1);
  });

  it('abandons early and stays abandoned', () => {
    const { match, bus } = machine();
    match.start();
    match.addScore(0, 5);
    match.abandon();
    match.abandon();

    expect(match.isFinished).toBe(true);
    expect(bus.filter(EventKind.MATCH_END)).toHaveLength(1);
    expect(match.result()?.winner).toBe(0);
  });
});

describe('period extension', () => {
  it('lengthens the period in progress and nothing else', () => {
    const { match } = machine();
    match.start();
    expect(match.extension).toBe(0);
    expect(match.stepsRemaining).toBe(60);

    match.extendPeriod(20);
    expect(match.extension).toBe(20);
    expect(match.stepsRemaining).toBe(80);

    runSteps(match, 60);
    expect(match.currentPhase).toBe(MatchPhase.LIVE);
    runSteps(match, 20);
    expect(match.currentPhase).toBe(MatchPhase.PERIOD_BREAK);
  });

  it('accumulates, rounds, and ignores a non-positive request', () => {
    const { match } = machine();
    match.start();
    match.extendPeriod(10);
    match.extendPeriod(5.4);
    expect(match.extension).toBe(15);
    match.extendPeriod(0);
    match.extendPeriod(-30);
    expect(match.extension).toBe(15);
  });

  it('is allowed during a stoppage, since that is when a referee decides it', () => {
    const { match } = machine();
    match.start();
    match.stoppage('injury');
    match.extendPeriod(30);
    expect(match.extension).toBe(30);
  });

  it('refuses to reopen a period that is not in progress', () => {
    const { match } = machine();
    expect(() => match.extendPeriod(10)).toThrow(/requires a period in progress/);
    match.start();
    runSteps(match, 60);
    expect(match.currentPhase).toBe(MatchPhase.PERIOD_BREAK);
    expect(() => match.extendPeriod(10)).toThrow(/requires a period in progress/);
  });

  it('clears at the next period, so extra time is not inherited', () => {
    const { match } = machine();
    match.start();
    match.extendPeriod(25);
    runSteps(match, 85);
    match.nextPeriod();
    expect(match.extension).toBe(0);
    expect(match.stepsRemaining).toBe(60);
  });
});

describe('snapshot and restore', () => {
  it('round-trips an extended period, and treats an older snapshot as unextended', () => {
    const { match } = machine();
    match.start();
    match.extendPeriod(25);
    runSteps(match, 40);

    const resumed = new MatchStateMachine(RULES, new EventBus());
    resumed.restore(match.snapshot());
    expect(resumed.extension).toBe(25);
    expect(resumed.stepsRemaining).toBe(45);

    // A snapshot written before extensions existed still restores.
    const { periodExtension: _dropped, ...old } = match.snapshot();
    const legacy = new MatchStateMachine(RULES, new EventBus());
    legacy.restore(old);
    expect(legacy.extension).toBe(0);
  });

  it('round-trips the clock and score', () => {
    const { match } = machine();
    match.start();
    runSteps(match, 40);
    match.addScore(0, 7);
    match.addScore(1, 4);

    const snapshot = match.snapshot();

    const resumed = new MatchStateMachine(RULES, new EventBus());
    resumed.restore(snapshot);

    expect(resumed.currentPhase).toBe(MatchPhase.LIVE);
    expect(resumed.stepInPeriod).toBe(40);
    expect(resumed.homeScore).toBe(7);
    expect(resumed.awayScore).toBe(4);
    expect(resumed.steps).toBe(40);
  });

  it('resumes to the same finish as an uninterrupted run', () => {
    const play = (interrupt: boolean) => {
      let match = new MatchStateMachine(RULES, new EventBus());
      match.start();

      for (let period = 0; period < 4; period++) {
        runSteps(match, 30);
        if (interrupt && period === 1) {
          const snapshot = match.snapshot();
          match = new MatchStateMachine(RULES, new EventBus());
          match.restore(snapshot);
        }
        runSteps(match, 30);
        if (!match.isFinished) match.nextPeriod();
      }

      return match.snapshot();
    };

    expect(play(true)).toEqual(play(false));
  });
});
