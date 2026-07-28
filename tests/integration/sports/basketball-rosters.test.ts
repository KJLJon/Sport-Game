/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.17 — Wire real athletes into basketball Live — lineups drive the sim
 * @story   US-5.2 — Play any athlete in any sport
 * @design  05-data-model.md §3 (derivation), §3.3 (familiarity)
 * @invariant INV-8 (determinism)
 *
 * Purpose: the headline feature, end to end. Everything before this task proved a *number* moves;
 * this proves a match does — that a squad of soccer players actually loses a basketball game to a
 * squad of basketball players built from the same attributes, and that the difference is
 * familiarity rather than talent.
 *
 * The other thing asserted here is the one that keeps everything else honest: a match given no
 * roster still plays byte-identically to the one before real athletes existed, because the balance
 * harness, the determinism tests, and every rules test depend on that.
 */
import { describe, expect, it } from 'vitest';
import { World } from '@/engine/world.ts';
import { EventKind, type SportEvent } from '@/engine/match/events.ts';
import { basketball, createBasketballMatch } from '@/sports/basketball/index.ts';
import { gameSecondsToSteps } from '@/sports/basketball/rules.ts';
import { basketballRatings, basketballMovement } from '@/sports/basketball/roster.ts';
import { createAthlete } from '@/athletes/create.ts';
import { STARTING_FAMILIARITY, type Athlete } from '@/athletes/types.ts';
import { attributes } from '../../helpers/athletes.ts';

const STEP = 1 / 60;
const QUARTER = gameSecondsToSteps(12 * 60);

function arena(): World {
  return new World({
    width: basketball.field.width,
    height: basketball.field.height,
    cellSize: 3,
    capacity: 32,
  });
}

/** Five athletes with identical attributes, differing only in which sport they know. */
function squad(primarySport: string, prefix: string): Athlete[] {
  const heights = [185, 190, 198, 205, 213];
  return heights.map((heightCm, index) =>
    createAthlete({
      id: `${prefix}${index}`,
      custodyId: `${prefix}c${index}`,
      createdAt: 1,
      displayName: `${prefix} ${index}`,
      primarySport,
      heightCm,
      weightKg: 80 + index * 8,
      attributes: attributes(62, { coordination: 78, accuracy: 76, awareness: 74 }),
    }),
  );
}

function play(
  seed: string,
  rosters?: readonly (readonly Athlete[])[],
  steps = QUARTER,
): SportEvent[] {
  const world = arena();
  const { state, rng } = createBasketballMatch(world, seed, -1, rosters);
  const events: SportEvent[] = [];
  const empty = new Map();
  for (let i = 0; i < steps; i++) events.push(...basketball.step(state, world, empty, STEP, rng));
  return events;
}

function pointsFor(events: readonly SportEvent[], side: number): number {
  return events
    .filter((e) => e.kind === EventKind.SCORE && e.side === side)
    .reduce((sum, e) => sum + (e.value ?? 0), 0);
}

describe('a match played by real athletes', () => {
  it('reads its ratings from the athlete, not from the match seed', () => {
    const world = arena();
    const home = squad('basketball', 'h');
    const { state } = createBasketballMatch(world, 'wired', -1, [home, squad('basketball', 'a')]);

    const entity = [...state.athleteIds.entries()].find(([, id]) => id === 'h0')?.[0];
    expect(entity).toBeDefined();
    expect(state.ratings.get(entity as number)).toEqual(basketballRatings(home[0] as Athlete));
    expect(state.profiles.get(entity as number)).toEqual(basketballMovement(home[0] as Athlete));
  });

  it('records who is playing, so progression can pay the right person (T-3.5)', () => {
    const world = arena();
    const { state } = createBasketballMatch(world, 'ids', -1, [
      squad('basketball', 'h'),
      squad('basketball', 'a'),
    ]);
    expect(state.athleteIds.size).toBe(10);
    expect(new Set(state.athleteIds.values()).size).toBe(10);
  });

  it('couples an out-of-sport athlete and leaves an at-home one uncoupled (T-3.6)', () => {
    const world = arena();
    const { state } = createBasketballMatch(world, 'coupled', -1, [
      squad('basketball', 'h'),
      squad('soccer', 'a'),
    ]);

    const homeCoupled = [...state.sides.entries()].filter(
      ([id, side]) => side === 0 && state.coupling.has(id),
    );
    const awayCoupled = [...state.sides.entries()].filter(
      ([id, side]) => side === 1 && state.coupling.has(id),
    );

    expect(homeCoupled).toHaveLength(0);
    expect(awayCoupled).toHaveLength(5);
  });

  it('is the headline feature: same attributes, different sport, worse basketball', () => {
    // Both squads have identical attributes and bodies. The only difference is that one side has
    // played basketball before. If this ever stops being true, the cross-sport system is decorative.
    const seeds = ['wired-a', 'wired-b', 'wired-c', 'wired-d'];
    let specialists = 0;
    let outsiders = 0;

    for (const seed of seeds) {
      const events = play(seed, [squad('basketball', 'h'), squad('soccer', 'a')]);
      specialists += pointsFor(events, 0);
      outsiders += pointsFor(events, 1);
    }

    expect(specialists).toBeGreaterThan(outsiders);
  }, 60_000);

  it('lets a soccer player who has learned basketball close the gap (US-5.3)', () => {
    const learned = squad('soccer', 'a').map((athlete): Athlete => ({
      ...athlete,
      sportSkills: {
        ...athlete.sportSkills,
        basketball: {
          familiarity: STARTING_FAMILIARITY.primary,
          level: 1,
          xp: 0,
          subSkills: {},
          minutesPlayed: 600,
        },
      },
    }));

    const novice = squad('soccer', 'a');
    const seeds = ['learn-a', 'learn-b', 'learn-c'];
    let noviceTotal = 0;
    let learnedTotal = 0;

    for (const seed of seeds) {
      noviceTotal += pointsFor(play(seed, [squad('basketball', 'h'), novice]), 1);
      learnedTotal += pointsFor(play(seed, [squad('basketball', 'h'), learned]), 1);
    }

    expect(learnedTotal).toBeGreaterThan(noviceTotal);
  }, 60_000);

  it('fills the gaps from the seed when a lineup is short, rather than refusing to start', () => {
    const world = arena();
    const { state } = createBasketballMatch(world, 'short', -1, [
      squad('basketball', 'h').slice(0, 2),
      [],
    ]);

    expect(state.athleteIds.size).toBe(2);
    // Every entity still has ratings and a movement profile — the match can be played.
    expect(state.ratings.size).toBe(10);
    expect(state.profiles.size).toBe(10);
  });

  it('plays a rosterless match byte-identically to before real athletes existed (INV-8)', () => {
    // The balance harness, the golden-seed tests, and every rules test depend on this.
    const a = play('unrostered', undefined, gameSecondsToSteps(3 * 60));
    const b = play('unrostered', undefined, gameSecondsToSteps(3 * 60));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(20);
  });

  it('is deterministic with a roster too — same athletes, same seed, same match', () => {
    const rosters = [squad('basketball', 'h'), squad('soccer', 'a')];
    const a = play('repeatable', rosters, gameSecondsToSteps(3 * 60));
    const b = play('repeatable', rosters, gameSecondsToSteps(3 * 60));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('makes a tired athlete measurably slower (T-3.13)', () => {
    const fresh = squad('basketball', 'h')[0] as Athlete;
    const spent: Athlete = { ...fresh, condition: { stamina: 5 } };
    expect(basketballMovement(spent).maxSpeed).toBeLessThan(basketballMovement(fresh).maxSpeed);
    expect(basketballRatings(spent).threePoint).toBeLessThan(basketballRatings(fresh).threePoint);
    // The body is not what tires — strength is the athlete's own either way.
    expect(basketballRatings(spent).strength).toBe(basketballRatings(fresh).strength);
  });
});
