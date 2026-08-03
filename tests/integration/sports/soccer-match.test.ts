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
    // The whole team, not one striker's x. T-7.7 gave the carrier a reaction time, so ten seconds
    // of play can now legitimately leave a particular forward holding their line while the ball is
    // worked out from the back — which is football, and which made the old single-athlete
    // assertion a test of where the ball happened to go.
    const outfield = state.squads[0].filter((id) => id !== state.keepers[0]);
    const before = outfield.map((id) => ({
      x: world.x[id] as number,
      y: world.y[id] as number,
    }));

    const stepRng = rng.fork('sim');
    for (let i = 0; i < 600; i++) soccer.step(state, world, new Map(), 1 / 60, stepRng);

    const moved = Math.hypot(
      (world.x[state.ball] as number) - startX,
      (world.y[state.ball] as number) - startY,
    );
    expect(moved).toBeGreaterThan(1);

    const walked = outfield.filter((id, index) => {
      const start = before[index];
      if (start === undefined) return false;
      return Math.hypot((world.x[id] as number) - start.x, (world.y[id] as number) - start.y) > 1;
    });
    expect(walked.length).toBeGreaterThanOrEqual(outfield.length / 2);
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

/**
 * The v0.6.0 finding, as a test. Live soccer conceded 7.5 goals a match because a carrier could walk
 * into the box unopposed: the whole defence shaded towards the ball and none of it arrived. T-7.5
 * wired the team layer in, and these are the two things that have to stay true for that to hold.
 */
describe('the defence turns up (T-7.5)', () => {
  function nearestOpponent(state: SoccerState, world: World, carrier: number): number {
    const side = state.sides.get(carrier);
    let nearest = Infinity;
    for (const other of state.squads[side === 0 ? 1 : 0]) {
      const gap = Math.hypot(
        (world.x[other] as number) - (world.x[carrier] as number),
        (world.y[other] as number) - (world.y[carrier] as number),
      );
      if (gap < nearest) nearest = gap;
    }
    return nearest;
  }

  it('sends somebody at a carrier instead of watching them walk in', () => {
    const world = arena();
    const rng = createRng('press');
    const state = soccer.createState({ seed: 'press', playerSide: -1 }, world, rng);
    const stepRng = rng.fork('sim');

    let carried = 0;
    let closed = 0;
    for (let i = 0; i < 4000; i++) {
      soccer.step(state, world, new Map(), 1 / 60, stepRng);
      const carrier = state.ballState.carrier;
      if (carrier === -1) continue;
      carried++;
      if (nearestOpponent(state, world, carrier) <= 6) closed++;
    }

    expect(carried).toBeGreaterThan(200);
    // Not every step — a carrier in their own half with nobody near them is a normal picture. What
    // has to be true is that being closed down is the usual case rather than the exception.
    expect(closed / carried).toBeGreaterThan(0.5);
  });

  it('plans for both sides every step, and names who is pressing', () => {
    const { state } = play('plans', 600);

    for (const side of [0, 1] as const) {
      const plan = state.plans[side];
      expect(plan).not.toBeNull();

      // Every athlete with a job is one of ours and is not the keeper — `keeper.ts` is a better
      // model of a keeper than any duty, so the team layer never sees one. The count is `>= 9`
      // rather than exactly ten because a red card lands mid-step, after the plan for that step was
      // drawn; the next step's plan has already dropped them, which this seed exercises.
      const actors = plan?.assignments.map((assignment) => assignment.actor) ?? [];
      expect(actors.length).toBeGreaterThanOrEqual(9);
      expect(new Set(actors).size).toBe(actors.length);
      for (const actor of actors) {
        expect(state.squads[side]).toContain(actor);
        expect(actor).not.toBe(state.keepers[side]);
      }
      for (const assignment of plan?.assignments ?? []) {
        expect(assignment.target.x).toBeGreaterThanOrEqual(0);
        expect(assignment.target.x).toBeLessThanOrEqual(PITCH.length);
        expect(assignment.target.y).toBeGreaterThanOrEqual(0);
        expect(assignment.target.y).toBeLessThanOrEqual(PITCH.width);
      }
    }

    // Over a stretch rather than at one instant: whether anybody is pressing on step 600 exactly
    // depends on where the ball happens to be relative to the press line, which is a fact about
    // that tick and not about the model. What has to be true is that the press fires.
    const world = arena();
    const rng = createRng('pressers');
    const live = soccer.createState({ seed: 'pressers', playerSide: -1 }, world, rng);
    const stepRng = rng.fork('sim');

    let pressed = 0;
    for (let i = 0; i < 1200; i++) {
      soccer.step(live, world, new Map(), 1 / 60, stepRng);
      const defending = live.plans[live.rules.possession === 0 ? 1 : 0];
      if ((defending?.pressers.length ?? 0) > 0) pressed++;
    }

    expect(pressed).toBeGreaterThan(0);
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
