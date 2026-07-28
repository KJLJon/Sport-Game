/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.6 — Behavioural coupling: familiarity → decision noise, control error, reaction penalty
 * @story   US-5.2 — Play any athlete in any sport
 * @design  05-data-model.md §3.3 (behavioural coupling)
 * @invariant INV-8 (determinism)
 *
 * Purpose: `05` §3.3's claim is behavioural — "an out-of-sport athlete visibly looks lost before
 * they look merely weak" — so the unit tests on the curve are not enough. This drives real matches
 * through the real module with one side made novice and the other left at home, and asserts the
 * difference shows up in the event stream: more turnovers, more deflected passes, worse shooting.
 *
 * Both sides keep identical ratings. Nothing here changes a number an athlete has; only how they
 * decide, handle, and react. That is the whole distinction the task exists to draw.
 */
import { describe, expect, it } from 'vitest';
import { World } from '@/engine/world.ts';
import { EventKind, type SportEvent } from '@/engine/match/events.ts';
import { basketball, createBasketballMatch } from '@/sports/basketball/index.ts';
import { couplingFor } from '@/athletes/coupling.ts';
import { gameSecondsToSteps } from '@/sports/basketball/rules.ts';

const STEP = 1 / 60;
/** Long enough for the differences to be statistical rather than anecdotal. */
const QUARTER = gameSecondsToSteps(12 * 60);

function arena(): World {
  return new World({
    width: basketball.field.width,
    height: basketball.field.height,
    cellSize: 3,
    capacity: 32,
  });
}

/** Plays a match with `familiarity` applied to side 1 only; side 0 is always at home. */
function play(seed: string, familiarity: number | null, steps = QUARTER): SportEvent[] {
  const world = arena();
  const { state, rng } = createBasketballMatch(world, seed);

  if (familiarity !== null) {
    const coupling = couplingFor(familiarity);
    for (const [entity, side] of state.sides) {
      if (side === 1) state.coupling.set(entity, coupling);
    }
  }

  const events: SportEvent[] = [];
  const empty = new Map();
  for (let i = 0; i < steps; i++) events.push(...basketball.step(state, world, empty, STEP, rng));
  return events;
}

function bySide(events: readonly SportEvent[], kind: string, side: number): number {
  return events.filter((e) => (e.sportKind ?? e.kind) === kind && e.side === side).length;
}

/** Several seeds, because one match is an anecdote. */
const SEEDS = ['lost-a', 'lost-b', 'lost-c', 'lost-d'];

describe('an out-of-sport squad', () => {
  it('turns the ball over more than the side at home', { timeout: 60_000 }, () => {
    let lost = 0;
    let home = 0;

    for (const seed of SEEDS) {
      const events = play(seed, 5);
      lost += bySide(events, EventKind.TURNOVER, 1);
      home += bySide(events, EventKind.TURNOVER, 0);
    }

    expect(lost).toBeGreaterThan(home);
  });

  it('completes fewer passes, because first touch is where it shows', { timeout: 60_000 }, () => {
    let lost = 0;
    let home = 0;

    for (const seed of SEEDS) {
      const events = play(seed, 5);
      lost += bySide(events, EventKind.PASS, 1);
      home += bySide(events, EventKind.PASS, 0);
    }

    expect(lost).toBeLessThan(home);
  });

  it(
    'scores less than the same athletes at home — same ratings, worse play',
    { timeout: 60_000 },
    () => {
      let lost = 0;
      let home = 0;

      for (const seed of SEEDS) {
        const events = play(seed, 5);
        lost += events
          .filter((e) => e.kind === EventKind.SCORE && e.side === 1)
          .reduce((sum, e) => sum + (e.value ?? 0), 0);
        home += events
          .filter((e) => e.kind === EventKind.SCORE && e.side === 0)
          .reduce((sum, e) => sum + (e.value ?? 0), 0);
      }

      expect(lost).toBeLessThan(home);
    },
  );

  it('looks worse than a squad that has learned the sport', { timeout: 60_000 }, () => {
    let novice = 0;
    let learned = 0;

    for (const seed of SEEDS) {
      novice += bySide(play(seed, 5), EventKind.TURNOVER, 1);
      learned += bySide(play(seed, 60), EventKind.TURNOVER, 1);
    }

    expect(novice).toBeGreaterThan(learned);
  });
});

describe('an at-home squad', () => {
  it(
    'plays a byte-identical match to one with no coupling at all (INV-8)',
    { timeout: 60_000 },
    () => {
      // The design promise: a fully familiar athlete consumes no random draw for coupling, so the
      // whole PRNG stream is unchanged. If this fails, every golden-seed test is about to.
      const uncoupled = play('identity', null, gameSecondsToSteps(3 * 60));
      const atHome = play('identity', 100, gameSecondsToSteps(3 * 60));
      expect(JSON.stringify(atHome)).toBe(JSON.stringify(uncoupled));
    },
  );

  it('is unaffected by the other side being lost', { timeout: 60_000 }, () => {
    // Side 0 never gets a coupling, so its own behaviour is driven only by the game state it is
    // handed — which does change. This is the honest version: assert it still plays basketball.
    const events = play('one-sided', 5);
    expect(events.filter((e) => e.kind === EventKind.SHOT && e.side === 0).length).toBeGreaterThan(
      10,
    );
  });
});
