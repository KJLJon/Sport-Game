/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.11 — `SportModule` interface + a trivial test sport proving the seam
 * @story   US-14.4 — Add a sport without touching the engine
 * @design  04-architecture.md §5
 * @invariant INV-5, INV-8, INV-9
 *
 * Purpose: that the seam actually holds — the registry has no sport names in it, the test sport
 * plays a whole match through the engine without the engine knowing what it is, and the same seed
 * produces the same match twice.
 */
import { describe, expect, it } from 'vitest';
import { World, NO_ENTITY } from '@/engine/world.ts';
import { type createRng } from '@/engine/rng.ts';
import { EventKind } from '@/engine/match/events.ts';
import { EMPTY_FRAME, makeFrame, Button } from '@/engine/input/types.ts';
import { MatchStateMachine } from '@/engine/match/state-machine.ts';
import { SportRegistry, type SportModule } from '@/sports/types.ts';
import { createTestMatch, testSport, type TestSportState } from '@/sports/testsport/index.ts';

const STEP = 1 / 60;

function arena(): World {
  return new World({
    width: testSport.field.width,
    height: testSport.field.height,
    cellSize: 4,
    capacity: 32,
  });
}

/** Runs `steps` of the sport with no inputs, collecting what it emitted. */
function simulate(
  world: World,
  state: TestSportState,
  rng: ReturnType<typeof createRng>,
  steps: number,
) {
  const events = [];
  const noInputs = new Map();
  for (let i = 0; i < steps; i++) {
    events.push(...testSport.step(state, world, noInputs, STEP, rng));
  }
  return events;
}

describe('SportRegistry', () => {
  it('registers and retrieves by id', () => {
    const registry = new SportRegistry();
    registry.register(testSport as SportModule);

    expect(registry.get('testsport')).toBe(testSport);
    expect(registry.require('testsport')).toBe(testSport);
    expect(registry.size).toBe(1);
    expect(registry.ids()).toEqual(['testsport']);
  });

  it('refuses a duplicate registration', () => {
    const registry = new SportRegistry();
    registry.register(testSport as SportModule);
    expect(() => registry.register(testSport as SportModule)).toThrow(/already registered/);
  });

  it('returns undefined for an unknown sport, and throws when required', () => {
    const registry = new SportRegistry();
    expect(registry.get('quidditch')).toBeUndefined();
    expect(() => registry.require('quidditch')).toThrow(/Unknown sport/);
  });
});

describe('the test sport through the seam', () => {
  it('populates the world with two squads and a ball', () => {
    const world = arena();
    const { state } = createTestMatch(world, 'setup');

    expect(world.count).toBe(testSport.meta.squadSize * 2 + 1);
    expect(state.ball).toBeGreaterThanOrEqual(0);
    expect([...state.sides.values()].filter((side) => side === 0)).toHaveLength(3);
    expect([...state.sides.values()].filter((side) => side === 1)).toHaveLength(3);
  });

  it('starts every athlete inside the field', () => {
    const world = arena();
    createTestMatch(world, 'bounds');

    world.forEach((id) => {
      expect(world.inBounds(world.x[id] as number, world.y[id] as number)).toBe(true);
    });
  });

  it('gives the player an athlete to control, and none when spectating', () => {
    const world = arena();
    expect(createTestMatch(world, 'control', 0).state.controlled).not.toBe(NO_ENTITY);
    expect(createTestMatch(arena(), 'control', -1).state.controlled).toBe(NO_ENTITY);
  });

  it('converges on the ball and takes possession', () => {
    const world = arena();
    const { state, rng } = createTestMatch(world, 'chase');

    const events = simulate(world, state, rng, 240);
    expect(events.some((e) => e.kind === EventKind.POSSESSION)).toBe(true);
    expect(state.ballState.carrier).not.toBe(NO_ENTITY);
  });

  it('carries the ball to a goal and scores', () => {
    const world = arena();
    const { state, rng } = createTestMatch(world, 'score');

    const events = simulate(world, state, rng, 60 * 20);
    const scores = events.filter((e) => e.kind === EventKind.SCORE);

    expect(scores.length).toBeGreaterThan(0);
    expect(scores[0]?.value).toBe(1);
    expect([0, 1]).toContain(scores[0]?.side);
  });

  it('resets to the centre after a score', () => {
    const world = arena();
    const { state, rng } = createTestMatch(world, 'reset');

    for (let i = 0; i < 60 * 20; i++) {
      const events = testSport.step(state, world, new Map(), STEP, rng);
      if (events.some((e) => e.kind === EventKind.SCORE)) {
        expect(state.ballState.carrier).toBe(NO_ENTITY);
        expect(world.x[state.ball] as number).toBeCloseTo(testSport.field.width / 2, 6);
        return;
      }
    }

    throw new Error('no score in 20 seconds — the sport is not doing its one job');
  });

  it('keeps everything inside the field for a whole half', () => {
    const world = arena();
    const { state, rng } = createTestMatch(world, 'containment');
    simulate(world, state, rng, 60 * 60);

    world.forEach((id) => {
      if ((world.kind[id] as number) !== 0) return;
      expect(world.x[id] as number).toBeGreaterThanOrEqual(0);
      expect(world.x[id] as number).toBeLessThanOrEqual(testSport.field.width);
      expect(world.y[id] as number).toBeGreaterThanOrEqual(0);
      expect(world.y[id] as number).toBeLessThanOrEqual(testSport.field.height);
    });
  });

  it('responds to player input', () => {
    const world = arena();
    const { state, rng } = createTestMatch(world, 'input', 0);
    const controlled = state.controlled;
    const startY = world.y[controlled] as number;

    const inputs = new Map([[controlled, makeFrame(0, -1, Button.MODIFIER)]]);
    for (let i = 0; i < 30; i++) testSport.step(state, world, inputs, STEP, rng);

    expect(world.y[controlled] as number).toBeLessThan(startY);
  });

  it('passes on request, releasing possession', () => {
    const world = arena();
    const { state, rng } = createTestMatch(world, 'pass');
    simulate(world, state, rng, 240);

    const carrier = state.ballState.carrier;
    expect(carrier).not.toBe(NO_ENTITY);

    const events = testSport.resolveAction(state, world, carrier, { kind: 'pass', power: 9 }, rng);
    expect(events[0]?.kind).toBe(EventKind.PASS);
    expect(state.ballState.carrier).toBe(NO_ENTITY);
  });

  it('ignores a pass from someone who does not have the ball', () => {
    const world = arena();
    const { state, rng } = createTestMatch(world, 'nopass');
    expect(testSport.resolveAction(state, world, 0, { kind: 'pass' }, rng)).toEqual([]);
  });

  it('offers AI options and scores carrying above chasing', () => {
    const world = arena();
    const { state, rng } = createTestMatch(world, 'ai');
    simulate(world, state, rng, 240);

    const carrier = state.ballState.carrier;
    const options: { kind: string }[] = [];
    testSport.ai.options(state, world, carrier, options);

    expect(options.map((o) => o.kind)).toContain('carry');
    expect(testSport.ai.score(state, world, carrier, { kind: 'carry' })).toBeGreaterThan(
      testSport.ai.score(state, world, carrier, { kind: 'chase' }),
    );
  });
});

describe('determinism through the seam (INV-8)', () => {
  function fingerprint(seed: string, steps: number): string {
    const world = arena();
    const { state, rng } = createTestMatch(world, seed);
    simulate(world, state, rng, steps);

    const parts: string[] = [];
    world.forEach((id) => {
      parts.push(
        `${id}:${(world.x[id] as number).toFixed(6)}:${(world.y[id] as number).toFixed(6)}`,
      );
    });
    parts.push(`carrier:${state.ballState.carrier}`);
    return parts.join('|');
  }

  it('produces an identical world from an identical seed', () => {
    expect(fingerprint('golden-match', 1200)).toBe(fingerprint('golden-match', 1200));
  });

  it('produces a different world from a different seed', () => {
    expect(fingerprint('seed-a', 600)).not.toBe(fingerprint('seed-b', 600));
  });

  it('produces identical event streams', () => {
    const run = () => {
      const world = arena();
      const { state, rng } = createTestMatch(world, 'events');
      return simulate(world, state, rng, 900).map((e) => `${e.kind}@${e.step}:${e.side}`);
    };

    expect(run()).toEqual(run());
  });
});

describe('the engine driving a sport it does not know', () => {
  it('plays a full match through the state machine', () => {
    const world = arena();
    const { state, rng } = createTestMatch(world, 'full-match');
    const match = new MatchStateMachine(testSport.rules);
    const inputs = new Map([[0, EMPTY_FRAME]]);

    match.start();
    let guard = 0;

    while (!match.isFinished && guard++ < 60 * 60 * 4) {
      if (match.isRunning) {
        for (const sportEvent of testSport.step(state, world, inputs, STEP, rng)) {
          if (sportEvent.kind === EventKind.SCORE) {
            match.addScore(sportEvent.side as 0 | 1, sportEvent.value ?? 1, sportEvent.actor);
          }
        }
      }

      match.step();
      if (match.currentPhase === 'periodBreak') match.nextPeriod();
    }

    const result = match.result();
    expect(result).not.toBeNull();
    expect(result?.periodsPlayed).toBe(testSport.rules.periods);
    expect(Number.isInteger(result?.homeScore)).toBe(true);
    expect(Number.isInteger(result?.awayScore)).toBe(true);
    // Every point on the board arrived as an event: the score cannot move any other way.
    expect(match.bus.filter(EventKind.SCORE).length).toBe(
      (result?.homeScore ?? 0) + (result?.awayScore ?? 0),
    );
  });
});
