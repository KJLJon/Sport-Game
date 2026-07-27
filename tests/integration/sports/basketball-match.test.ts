/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.2 — Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts
 * @story   US-3.1 — Play a 5v5 basketball match
 * @design  06-game-design.md §3.1, 12-quality-and-testing.md §3 (INV-8)
 * @invariant INV-8 (determinism)
 *
 * Purpose: the rule book driven through the real module, the real world, and the real clock for a
 * full quarter. The unit tests prove each count fires; this proves they compose — that a match
 * keeps moving, that no possession outlives the shot clock, and that the same seed replays exactly.
 *
 * There is no scoring yet (T-2.3), so every possession here ends in a violation. That is the
 * honest state of the sport at T-2.2 and the test asserts it rather than pretending otherwise.
 */
import { describe, expect, it } from 'vitest';
import { World } from '@/engine/world.ts';
import { EventBus, EventKind, type SportEvent } from '@/engine/match/events.ts';
import { MatchStateMachine } from '@/engine/match/state-machine.ts';
import { basketball, createBasketballMatch } from '@/sports/basketball/index.ts';
import { COURT } from '@/sports/basketball/court.ts';
import {
  BASKETBALL_RULES,
  BasketballEvent,
  gameSecondsToSteps,
} from '@/sports/basketball/rules.ts';

const STEP = 1 / 60;

function arena(): World {
  return new World({
    width: basketball.field.width,
    height: basketball.field.height,
    cellSize: 3,
    capacity: 32,
  });
}

/** Steps a match for `steps` ticks with no input, returning everything it emitted. */
function play(seed: string, steps: number): { events: SportEvent[]; world: World } {
  const world = arena();
  const { state, rng } = createBasketballMatch(world, seed);
  const events: SportEvent[] = [];
  const empty = new Map();
  for (let i = 0; i < steps; i++) {
    events.push(...basketball.step(state, world, empty, STEP, rng));
  }
  return { events, world };
}

function of(events: readonly SportEvent[], kind: string): SportEvent[] {
  return events.filter((e) => (e.sportKind ?? e.kind) === kind);
}

describe('a basketball match', () => {
  it('spawns ten athletes and a ball on a FIBA court', () => {
    const world = arena();
    const { state } = createBasketballMatch(world, 'setup');
    expect(state.sides.size).toBe(10);
    expect(world.count).toBe(11);
    expect(world.width).toBe(28);
    expect(world.height).toBe(15);
    expect(state.rules.restart?.kind).toBe('tipOff');
  });

  it('opens with a tip-off that gives somebody the ball', () => {
    const { events } = play('tip', 200);
    const possessions = of(events, EventKind.POSSESSION);
    expect(possessions.length).toBeGreaterThan(0);
    expect([0, 1]).toContain(possessions[0]?.side);
  });

  it('never lets a possession outlive the shot clock', () => {
    const { events } = play('quarter', BASKETBALL_RULES.periodSteps);
    const live = events.filter(
      (e) =>
        (e.sportKind ?? e.kind) === BasketballEvent.RESTART_COMPLETE ||
        (e.sportKind ?? e.kind) === BasketballEvent.SHOT_CLOCK_VIOLATION,
    );

    let liveSince: number | null = null;
    for (const e of live) {
      if ((e.sportKind ?? e.kind) === BasketballEvent.RESTART_COMPLETE) {
        liveSince = e.step;
      } else if (liveSince !== null) {
        expect(e.step - liveSince).toBeLessThanOrEqual(gameSecondsToSteps(24) + 2);
        liveSince = null;
      }
    }
  });

  it('keeps play moving — the ball is never dead for long', () => {
    const { events } = play('flow', BASKETBALL_RULES.periodSteps);
    const restarts = of(events, BasketballEvent.RESTART);
    const completions = of(events, BasketballEvent.RESTART_COMPLETE);

    // Every restart is put back in play, give or take one still pending at the buzzer.
    expect(completions.length).toBeGreaterThanOrEqual(restarts.length - 1);
    // And a quarter's worth of possessions actually happened.
    expect(completions.length).toBeGreaterThan(10);
  });

  it('turns every possession over on the shot clock while there is no scoring yet', () => {
    const { events } = play('flow', BASKETBALL_RULES.periodSteps);
    const violations = of(events, BasketballEvent.SHOT_CLOCK_VIOLATION);
    const turnovers = of(events, EventKind.TURNOVER);
    expect(violations.length).toBeGreaterThan(10);
    expect(turnovers.length).toBe(violations.length);
    // Nobody has scored, because nobody can shoot yet.
    expect(of(events, EventKind.SCORE)).toHaveLength(0);
  });

  it('alternates possession — one side does not keep the ball all quarter', () => {
    const { events } = play('flow', BASKETBALL_RULES.periodSteps);
    const sides = of(events, EventKind.POSSESSION).map((e) => e.side);
    expect(sides.filter((s) => s === 0).length).toBeGreaterThan(3);
    expect(sides.filter((s) => s === 1).length).toBeGreaterThan(3);
  });

  it('keeps every athlete on the court', () => {
    const { world } = play('bounds', 3000);
    world.forEach((id) => {
      if ((world.kind[id] as number) !== 0) return;
      expect(world.x[id] as number).toBeGreaterThanOrEqual(0);
      expect(world.x[id] as number).toBeLessThanOrEqual(COURT.length);
      expect(world.y[id] as number).toBeGreaterThanOrEqual(0);
      expect(world.y[id] as number).toBeLessThanOrEqual(COURT.width);
    });
  });

  it('replays identically from the same seed, and differently from another (INV-8)', () => {
    const a = play('golden-seed', 2400);
    const b = play('golden-seed', 2400);
    const c = play('another-seed', 2400);

    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    expect(JSON.stringify(c.events)).not.toBe(JSON.stringify(a.events));
  });

  it('runs a whole quarter through the match clock without the two disagreeing', () => {
    const world = arena();
    const bus = new EventBus();
    const machine = new MatchStateMachine(BASKETBALL_RULES, bus);
    const { state, rng } = createBasketballMatch(world, 'clocked');
    const empty = new Map();

    machine.start();
    while (machine.isRunning) {
      bus.emitAll(basketball.step(state, world, empty, STEP, rng));
      machine.step();
    }

    expect(machine.currentPeriod).toBe(1);
    expect(machine.currentPhase).toBe('periodBreak');
    expect(state.step).toBe(BASKETBALL_RULES.periodSteps);
    expect(bus.filter(EventKind.PERIOD_END)).toHaveLength(1);
  });
});
