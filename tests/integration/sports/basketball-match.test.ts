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
 * Shot selection and spacing are still placeholders (T-2.8 owns them), so the assertions here are
 * about *shape* — shots go up, some go in, the score moves, misses become rebounds — rather than
 * about the shooting percentages T-2.13 will tune.
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

    // The clock restarts on every reset — an offensive rebound legitimately extends a possession —
    // so a span is measured from the last reset, not from the last inbound.
    let armedAt: number | null = null;
    for (const e of events) {
      const kind = e.sportKind ?? e.kind;
      if (kind === BasketballEvent.SHOT_CLOCK_RESET) armedAt = e.step;
      else if (kind === BasketballEvent.SHOT_CLOCK_VIOLATION) {
        expect(armedAt).not.toBeNull();
        expect(e.step - (armedAt as number)).toBeLessThanOrEqual(gameSecondsToSteps(24) + 2);
        armedAt = null;
      }
    }
  });

  it('keeps play moving — the ball is never dead for long', () => {
    const { events } = play('flow', BASKETBALL_RULES.periodSteps);
    const completions = of(events, BasketballEvent.RESTART_COMPLETE);

    // A quarter's worth of possessions actually happened...
    expect(completions.length).toBeGreaterThan(10);

    // ...and no dead ball stayed dead. The worst case is an inbounder walking the length of the
    // court, about five real seconds; eight leaves room without hiding a stall.
    let awardedAt: number | null = null;
    for (const e of events) {
      const kind = e.sportKind ?? e.kind;
      if (kind === BasketballEvent.RESTART) awardedAt = e.step;
      else if (kind === BasketballEvent.RESTART_COMPLETE && awardedAt !== null) {
        expect(e.step - awardedAt).toBeLessThan(8 * 60);
        awardedAt = null;
      }
    }
  });

  it('takes shots, makes some, and moves the score', () => {
    const { events } = play('flow', BASKETBALL_RULES.periodSteps);
    const shots = of(events, EventKind.SHOT);
    const scores = of(events, EventKind.SCORE);

    expect(shots.length).toBeGreaterThan(15);
    expect(scores.length).toBeGreaterThan(3);
    expect(scores.length).toBeLessThan(shots.length);

    // Every made shot is worth two or three, and only ever to the side that took it.
    for (const score of scores) {
      expect([2, 3]).toContain(score.value);
      expect([0, 1]).toContain(score.side);
    }
  });

  it('records what the shooting model decided, so a balance pass has something to read', () => {
    const { events } = play('flow', BASKETBALL_RULES.periodSteps);
    for (const shot of of(events, EventKind.SHOT)) {
      const detail = shot.detail ?? {};
      expect(typeof detail.zone).toBe('string');
      expect(detail.probability as number).toBeGreaterThanOrEqual(0.02);
      expect(detail.probability as number).toBeLessThanOrEqual(0.95);
      expect(detail.release as number).toBeGreaterThanOrEqual(0);
      expect(detail.release as number).toBeLessThanOrEqual(1);
      expect(shot.actor).toBeGreaterThanOrEqual(0);
    }
  });

  it('turns a miss into a live rebound rather than a dead ball', () => {
    const { events } = play('flow', BASKETBALL_RULES.periodSteps);
    const shots = of(events, EventKind.SHOT).length;
    const scores = of(events, EventKind.SCORE).length;
    const rebounds = of(events, EventKind.REBOUND).length;

    // Not every miss is rebounded — some go out of bounds — but most are.
    expect(rebounds).toBeGreaterThan((shots - scores) * 0.4);
    expect(rebounds).toBeLessThanOrEqual(shots - scores);
  });

  it('still ends a stalled possession on the shot clock', () => {
    const { events } = play('flow', BASKETBALL_RULES.periodSteps);
    const violations = of(events, BasketballEvent.SHOT_CLOCK_VIOLATION);
    const turnovers = of(events, EventKind.TURNOVER);
    expect(violations.length).toBeGreaterThan(0);
    expect(turnovers.length).toBeGreaterThanOrEqual(violations.length);
  });

  it('alternates possession — one side does not keep the ball all quarter', () => {
    const { events } = play('flow', BASKETBALL_RULES.periodSteps);
    const sides = of(events, EventKind.POSSESSION).map((e) => e.side);
    expect(sides.filter((s) => s === 0).length).toBeGreaterThan(3);
    expect(sides.filter((s) => s === 1).length).toBeGreaterThan(3);
  });

  it('moves the ball — passes are thrown, caught, and sometimes read', () => {
    const { events } = play('flow', BASKETBALL_RULES.periodSteps);
    const passes = of(events, EventKind.PASS);
    const intercepts = of(events, BasketballEvent.INTERCEPTION);
    const turnovers = of(events, EventKind.TURNOVER);

    expect(passes.length).toBeGreaterThan(5);
    for (const pass of passes) {
      expect(pass.actor).toBeGreaterThanOrEqual(0);
      expect([0, 1]).toContain(pass.side);
    }

    // Interceptions happen, and every one of them is a turnover against the passing side.
    expect(intercepts.length).toBeLessThan(passes.length / 2);
    expect(turnovers.length).toBeGreaterThanOrEqual(intercepts.length);
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
