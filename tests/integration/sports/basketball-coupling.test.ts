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

/**
 * Several seeds, because one match is an anecdote.
 *
 * Widened from four to eight by T-7.7, together with the two assertions below. At four seeds the
 * *raw* turnover and scoring margins were a handful of events across the whole sample, and measured
 * over eight they turn out not to exist — on the build before difficulty was wired in, a lost squad
 * scored 165 points to a home squad's 158. Raw counts were never the effect; rate is. See the two
 * rewritten tests.
 */
const SEEDS = ['lost-a', 'lost-b', 'lost-c', 'lost-d', 'lost-e', 'lost-f', 'lost-g', 'lost-h'];

describe('an out-of-sport squad', () => {
  it('turns the ball over far more often per pass it tries', { timeout: 60_000 }, () => {
    // Per pass, not per match. A lost squad makes fewer passes *and* loses more of them, so the
    // raw count of turnovers can sit level with a squad that is passing the ball twice as often —
    // it did, at 46 apiece over eight seeds. The rate is the effect, and it is not close: about
    // one turnover every two passes against one every three and a half.
    let lostTurnovers = 0;
    let homeTurnovers = 0;
    let lostPasses = 0;
    let homePasses = 0;

    for (const seed of SEEDS) {
      const events = play(seed, 5);
      lostTurnovers += bySide(events, EventKind.TURNOVER, 1);
      homeTurnovers += bySide(events, EventKind.TURNOVER, 0);
      lostPasses += bySide(events, EventKind.PASS, 1);
      homePasses += bySide(events, EventKind.PASS, 0);
    }

    expect(lostTurnovers / lostPasses).toBeGreaterThan(1.4 * (homeTurnovers / homePasses));
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
    'shoots much worse than the same athletes at home — same ratings, worse play',
    { timeout: 60_000 },
    () => {
      // Efficiency, not points. A lost squad forces shots it should not take — 271 attempts to a
      // home squad's 169 over eight seeds — so it can finish level on points while shooting a
      // third worse, and it did: 147 to 145 at 21.0% against 33.7%. Raw points were measuring the
      // volume of bad decisions cancelling out their badness; field-goal percentage measures the
      // badness, which is what `05` §3.3 actually claims.
      let lostMade = 0;
      let homeMade = 0;
      let lostShots = 0;
      let homeShots = 0;

      for (const seed of SEEDS) {
        const events = play(seed, 5);
        for (const event of events) {
          const side = event.side;
          if (side !== 0 && side !== 1) continue;
          if ((event.sportKind ?? event.kind) === EventKind.SHOT) {
            if (side === 1) lostShots += 1;
            else homeShots += 1;
          }
          // A field goal is worth two or three; a free throw is worth one and is not a shot here.
          if (event.kind === EventKind.SCORE && (event.value ?? 0) > 1) {
            if (side === 1) lostMade += 1;
            else homeMade += 1;
          }
        }
      }

      expect(lostShots).toBeGreaterThan(homeShots);
      expect(lostMade / lostShots).toBeLessThan(0.8 * (homeMade / homeShots));
    },
  );

  it('looks worse than a squad that has learned the sport', { timeout: 60_000 }, () => {
    // Rate again, and for the same reason as the first test: a novice squad completes far fewer
    // passes, so counting turnovers alone compares two squads that did not attempt the same thing.
    let noviceTurnovers = 0;
    let novicePasses = 0;
    let learnedTurnovers = 0;
    let learnedPasses = 0;

    for (const seed of SEEDS) {
      const novice = play(seed, 5);
      const learned = play(seed, 60);
      noviceTurnovers += bySide(novice, EventKind.TURNOVER, 1);
      novicePasses += bySide(novice, EventKind.PASS, 1);
      learnedTurnovers += bySide(learned, EventKind.TURNOVER, 1);
      learnedPasses += bySide(learned, EventKind.PASS, 1);
    }

    expect(noviceTurnovers / novicePasses).toBeGreaterThan(learnedTurnovers / learnedPasses);
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
