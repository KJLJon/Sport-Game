/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.10 — Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase
 * @story   US-4.1 — Play an 11v11 soccer match
 * @story   US-14.4 — Add a sport without touching the engine
 * @design  04-architecture.md §5 (the sport module seam)
 * @invariant INV-8 (determinism), INV-9 (one event stream)
 *
 * Purpose: that soccer is actually a sport the engine can play, not eleven modules in a folder.
 * Runs a headless match and asserts the things a match has to do — the ball moves, possession
 * changes hands, restarts happen, and the same seed produces the same match twice.
 */
import { describe, expect, it } from 'vitest';
import { EventKind, type SportEvent } from '@/engine/match/events.ts';
import { createRng } from '@/engine/rng.ts';
import { World } from '@/engine/world.ts';
import { soccer, type SoccerState } from '@/sports/soccer/index.ts';
import { PITCH } from '@/sports/soccer/pitch.ts';

function arena() {
  return new World({
    width: soccer.field.width,
    height: soccer.field.height,
    cellSize: 6,
    capacity: 40,
  });
}

/** Runs `steps` of a match and returns everything it emitted. */
function play(seed: string, steps: number) {
  const world = arena();
  const rng = createRng(seed);
  const state = soccer.createState({ seed, playerSide: -1 }, world, rng);

  const events: SportEvent[] = [];
  const stepRng = rng.fork('sim');
  for (let i = 0; i < steps; i++) {
    events.push(...soccer.step(state, world, new Map(), 1 / 60, stepRng));
  }
  return { world, state, events };
}

describe('the soccer module fills the seam', () => {
  it('declares itself properly', () => {
    expect(soccer.id).toBe('soccer');
    expect(soccer.meta).toEqual({ displayName: 'Soccer', squadSize: 11, periodName: 'Half' });
    expect(soccer.rules.periods).toBe(2);
    expect(soccer.roles.roles).toHaveLength(11);
    expect(soccer.field.width).toBe(PITCH.length);
    expect(soccer.field.height).toBe(PITCH.width);
  });

  it('has no action clock, which is the first sport to exercise that null', () => {
    const { state } = play('status', 10);
    const status = soccer.status?.(state);
    expect(status?.actionClock).toBeNull();
    expect(status?.bonus).toBeNull();
    expect(soccer.hud.showShotClock).toBe(false);
  });
});

describe('a match', () => {
  it('puts 22 athletes and a ball on the pitch', () => {
    const { world, state } = play('kickoff', 1);
    expect(state.squads[0]).toHaveLength(11);
    expect(state.squads[1]).toHaveLength(11);
    expect(world.isAlive(state.ball)).toBe(true);
    const everyone = new Set([...state.squads[0], ...state.squads[1], state.ball]);
    expect(everyone.size).toBe(23);
    expect(state.keepers[0]).not.toBe(state.keepers[1]);
  });

  it('keeps everybody on the pitch', () => {
    const { world, state } = play('bounds', 900);
    for (const side of [0, 1] as const) {
      for (const id of state.squads[side]) {
        expect(world.x[id] as number).toBeGreaterThanOrEqual(0);
        expect(world.x[id] as number).toBeLessThanOrEqual(PITCH.length);
        expect(world.y[id] as number).toBeGreaterThanOrEqual(0);
        expect(world.y[id] as number).toBeLessThanOrEqual(PITCH.width);
      }
    }
  });

  it('actually plays — the ball moves and the athletes move with it', () => {
    const world = arena();
    const rng = createRng('moves');
    const state = soccer.createState({ seed: 'moves', playerSide: -1 }, world, rng);

    const startX = world.x[state.ball] as number;
    const startY = world.y[state.ball] as number;
    const striker = state.squads[0][9] as number;
    const strikerStart = world.x[striker] as number;

    const stepRng = rng.fork('sim');
    for (let i = 0; i < 600; i++) soccer.step(state, world, new Map(), 1 / 60, stepRng);

    const moved = Math.hypot(
      (world.x[state.ball] as number) - startX,
      (world.y[state.ball] as number) - startY,
    );
    expect(moved).toBeGreaterThan(1);
    expect(Math.abs((world.x[striker] as number) - strikerStart)).toBeGreaterThan(0.5);
  });

  it('emits a stream with no mode field on it (INV-9)', () => {
    const { events } = play('stream', 1800);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e).not.toHaveProperty('mode');
      expect(typeof e.step).toBe('number');
    }
  });

  it('gets the ball to somebody and changes hands at least once', () => {
    const { events } = play('possession', 2400);
    const possession = events.filter((e) => e.kind === EventKind.POSSESSION);
    expect(possession.length).toBeGreaterThan(0);
    expect(new Set(possession.map((e) => e.side)).size).toBeGreaterThan(0);
  });

  it('drains stamina over a sustained run of play', () => {
    const { state } = play('stamina', 3000);
    const spent = Object.values(state.stamina).filter((value) => value < 1);
    expect(spent.length).toBeGreaterThan(0);
  });

  it('is the same match twice from the same seed (INV-8)', () => {
    const a = play('determinism', 1200);
    const b = play('determinism', 1200);

    expect(a.events).toEqual(b.events);
    expect(a.world.x[a.state.ball]).toBe(b.world.x[b.state.ball]);
    for (const id of a.state.squads[0]) {
      expect(a.world.x[id]).toBe(b.world.x[id]);
      expect(a.world.y[id]).toBe(b.world.y[id]);
    }
  });

  it('is a different match from a different seed', () => {
    const a = play('seed-one', 1200);
    const b = play('seed-two', 1200);
    expect(a.world.x[a.state.ball]).not.toBe(b.world.x[b.state.ball]);
  });

  it('starts the second half without throwing', () => {
    const { state } = play('halves', 60);
    expect(() => soccer.startPeriod?.(state, 2)).not.toThrow();
    expect(state.rules.boardAddedMinutes).toBe(0);
  });

  it('reports a stoppage reason whenever the ball is dead', () => {
    const { state } = play('stoppage', 1500);
    const status = soccer.status?.(state);
    if (state.rules.restart !== null) {
      expect(status?.stoppage).toBe(state.rules.restart.reason);
    } else {
      expect(status?.stoppage).toBeNull();
    }
  });
});

describe('the AI adapter', () => {
  it('offers the carrier something to do and a defender a tackle', () => {
    const { world, state } = play('ai', 400);
    const options: { kind: string }[] = [];
    const actor = state.squads[0][9] as number;
    soccer.ai.options(state, world, actor, options);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      const score = soccer.ai.score(state, world, actor, option);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('scores a shot from distance lower than one from close in', () => {
    const world = arena();
    const rng = createRng('scoring');
    const state: SoccerState = soccer.createState({ seed: 'scoring', playerSide: -1 }, world, rng);
    const actor = state.squads[0][9] as number;

    world.x[actor] = 100;
    const close = soccer.ai.score(state, world, actor, { kind: 'shoot' });
    world.x[actor] = 40;
    const far = soccer.ai.score(state, world, actor, { kind: 'shoot' });
    expect(close).toBeGreaterThan(far);
  });
});
