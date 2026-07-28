/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.2 — Resolution model: ratings → matchup → outcome distribution → sampled events
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §2.2, 06-game-design.md §3.1
 * @invariant INV-8 (determinism), INV-9 (one event stream), INV-11 (cross-mode parity)
 *
 * The model, one piece at a time, and then the whole possession. The claims worth pinning are the
 * ones `09` §2.2 makes in words: ratings beat mind-games, no call hard-counters another, and every
 * defensive call's stated trade is real in both directions.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../../src/engine/rng.ts';
import { applyEvent, createBoxScore, teamLine } from '../../../../../src/modes/live/box-score.ts';
import type { CallPair, PlaybookState } from '../../../../../src/modes/playbook/types.ts';
import {
  basketballSquads,
  createBasketballPlaybook,
} from '../../../../../src/sports/basketball/playbook/index.ts';
import {
  DEFENSIVE_PROFILES,
  OFFENSIVE_PROFILES,
  areaOf,
  defensiveProfile,
  offensiveProfile,
} from '../../../../../src/sports/basketball/playbook/calls.ts';
import {
  RESOLUTION,
  because,
  describeOutcome,
  drainStamina,
  matchupEdge,
  primaryDefender,
  primaryOption,
  releaseFor,
  resolvePossession,
  shooterRatings,
  zoneValue,
  type BasketballPlaybookState,
} from '../../../../../src/sports/basketball/playbook/resolution.ts';
import { evenRosters, roster } from '../../../../../tools/playbook-rosters.ts';

type State = PlaybookState<BasketballPlaybookState>;

function stateFor(seed = 'res', possession: 0 | 1 = 0): State {
  const [home, away] = evenRosters(seed);
  const match = createBasketballPlaybook({ seed, squads: basketballSquads(home, away) });
  match.state.possession = possession;
  return match.state;
}

function pair(offence: string, defence: string, target?: number): CallPair {
  return {
    offence: { side: 0, call: offence, ...(target === undefined ? {} : { target }) },
    defence: { side: 1, call: defence },
  };
}

/** Resolves `count` possessions of one matchup and returns the aggregate. */
function batch(offence: string, defence: string, count = 400, seed = 'batch') {
  const state = stateFor(seed);
  let points = 0;
  let turnovers = 0;
  let makes = 0;
  let attempts = 0;
  let threes = 0;
  let freeThrows = 0;

  for (let i = 0; i < count; i += 1) {
    const resolution = resolvePossession({
      state,
      calls: pair(offence, defence),
      rng: createRng(`${seed}-${i}`),
    });
    points += resolution.points;
    if (resolution.outcome === 'stolen' || resolution.outcome === 'turnover') turnovers += 1;
    for (const entry of resolution.events) {
      if (entry.kind !== 'shot') continue;
      if ((entry.detail ?? {}).zone === 'freeThrow') {
        freeThrows += 1;
        continue;
      }
      attempts += 1;
      if ((entry.value ?? 2) === 3) threes += 1;
      if ((entry.detail ?? {}).made === true) makes += 1;
    }
  }

  return {
    pointsPer: points / count,
    turnoverRate: turnovers / count,
    fieldGoalRate: attempts === 0 ? 0 : makes / attempts,
    threeShare: attempts === 0 ? 0 : threes / attempts,
    freeThrowsPer: freeThrows / count,
  };
}

describe('the pieces', () => {
  it('splits zones into the three places a defence can be', () => {
    expect(areaOf('restricted')).toBe('rim');
    expect(areaOf('paint')).toBe('rim');
    expect(areaOf('midRange')).toBe('mid');
    expect(areaOf('cornerThree')).toBe('three');
    expect(areaOf('heave')).toBe('three');
  });

  it('values a zone the way the court does', () => {
    expect(zoneValue('restricted')).toBe(2);
    expect(zoneValue('midRange')).toBe(2);
    expect(zoneValue('wingThree')).toBe(3);
    expect(zoneValue('heave')).toBe(3);
  });

  it('falls back to the least opinionated call for an id it does not know', () => {
    expect(offensiveProfile('nonsense').id).toBe('motion');
    expect(defensiveProfile('nonsense').id).toBe('man');
  });

  it('gives every catalogue entry a profile, and every profile a catalogue entry', () => {
    for (const profile of OFFENSIVE_PROFILES) {
      expect(offensiveProfile(profile.id).id).toBe(profile.id);
    }
    for (const profile of DEFENSIVE_PROFILES) {
      expect(defensiveProfile(profile.id).id).toBe(profile.id);
    }
  });
});

describe('who takes the shot', () => {
  const players = basketballSquads(roster('pick-home', 'average'), roster('pick-away'))[0].players;

  it('takes the named athlete when the call is targeted', () => {
    const wanted = players[3];
    expect(wanted).toBeDefined();
    expect(primaryOption(players, offensiveProfile('isolation'), wanted?.id).id).toBe(wanted?.id);
  });

  it('ignores a target who is not on the floor', () => {
    expect(primaryOption(players, offensiveProfile('isolation'), 9999)).toBeDefined();
  });

  it('otherwise picks whoever is best at what the play asks for', () => {
    for (const call of ['spot-up', 'post-up', 'push'] as const) {
      const profile = offensiveProfile(call);
      const chosen = primaryOption(players, profile, undefined);
      const best = Math.max(...players.map((p) => p.ratings[profile.picks] ?? 50));
      expect(chosen.ratings[profile.picks] ?? 50).toBe(best);
    }
  });

  it('runs the play at the defender best equipped to stop it', () => {
    const profile = offensiveProfile('post-up');
    const defender = primaryDefender(players, profile);
    const best = Math.max(...players.map((p) => p.ratings[profile.defendKey] ?? 50));
    expect(defender.ratings[profile.defendKey] ?? 50).toBe(best);
  });
});

describe('the matchup', () => {
  it('is zero for an even matchup and signed the obvious way', () => {
    expect(matchupEdge(60, 60, 1)).toBeCloseTo(0, 6);
    expect(matchupEdge(80, 50, 1)).toBeGreaterThan(0);
    expect(matchupEdge(50, 80, 1)).toBeLessThan(0);
  });

  it('never leaves a hopeless mismatch at zero, or a total one at certainty', () => {
    expect(matchupEdge(99, 1, 1)).toBeLessThan(0.5);
    expect(matchupEdge(1, 99, 1)).toBeGreaterThan(-0.5);
  });

  it('costs a tired athlete part of their edge', () => {
    expect(matchupEdge(70, 60, 0.5)).toBeLessThan(matchupEdge(70, 60, 1));
  });

  it('moves about a sixth of a possession for a twenty-point edge (`09` §2.2)', () => {
    expect(matchupEdge(70, 50, 1)).toBeGreaterThan(0.1);
    expect(matchupEdge(70, 50, 1)).toBeLessThan(0.25);
  });
});

describe('release', () => {
  const ratings = shooterRatings({
    id: 0,
    athlete: roster('rel')[0] as never,
    ratings: {},
    role: 'PG',
    stamina: 1,
  });

  function mean(key: number, composure: number): number {
    const rng = createRng('release');
    let total = 0;
    for (let i = 0; i < 500; i += 1) total += releaseFor({ ...ratings, composure }, key, rng);
    return total / 500;
  }

  it('centres on the shooter’s own rating', () => {
    expect(mean(90, 50)).toBeGreaterThan(mean(30, 50));
  });

  it('stays inside `0–1` whatever it draws', () => {
    const rng = createRng('clamp');
    for (let i = 0; i < 400; i += 1) {
      const value = releaseFor({ ...ratings, composure: 1 }, 99, rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('narrows for a composed shooter rather than shifting them', () => {
    const spread = (composure: number): number => {
      const rng = createRng('spread');
      const values = Array.from({ length: 600 }, () =>
        releaseFor({ ...ratings, composure }, 60, rng),
      );
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      return Math.sqrt(values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length);
    };
    expect(spread(95)).toBeLessThan(spread(5));
  });
});

describe('a possession, end to end', () => {
  it('emits a possession event naming the call, and a shot with its zone', () => {
    const resolution = resolvePossession({
      state: stateFor(),
      calls: pair('spot-up', 'man'),
      rng: createRng('one'),
    });
    const possession = resolution.events.find((entry) => entry.kind === 'possession');
    expect(possession?.detail).toMatchObject({ call: 'spot-up' });
    expect(resolution.actor).toBeDefined();
  });

  it('never scores negative points, and its scores add up to its points', () => {
    for (let i = 0; i < 200; i += 1) {
      const resolution = resolvePossession({
        state: stateFor(),
        calls: pair('pick-roll', 'press'),
        rng: createRng(`sum-${i}`),
      });
      expect(resolution.points).toBeGreaterThanOrEqual(0);
      const summed = (resolution.scores ?? []).reduce((sum, score) => sum + score.points, 0);
      expect(summed).toBe(resolution.points);
    }
  });

  it('books a free-throw trip as one-pointers with a free-throw shot event', () => {
    let found = false;
    for (let i = 0; i < 400 && !found; i += 1) {
      const resolution = resolvePossession({
        state: stateFor(),
        calls: pair('post-up', 'protect-rim'),
        rng: createRng(`ft-${i}`),
      });
      const freeThrows = resolution.events.filter(
        (entry) => entry.kind === 'shot' && (entry.detail ?? {}).zone === 'freeThrow',
      );
      if (freeThrows.length === 0) continue;
      found = true;
      expect(resolution.events.some((entry) => entry.kind === 'foul')).toBe(true);
      for (const score of resolution.scores ?? []) {
        if (score.points !== 1) expect([2, 3]).toContain(score.points);
      }
      expect(freeThrows.every((entry) => entry.value === 1)).toBe(true);
    }
    expect(found).toBe(true);
  });

  it('always says who came down with a missed shot, and agrees with itself about possession', () => {
    for (let i = 0; i < 300; i += 1) {
      const resolution = resolvePossession({
        state: stateFor(),
        calls: pair('motion', 'zone'),
        rng: createRng(`reb-${i}`),
      });
      const rebound = resolution.events.find((entry) => entry.kind === 'rebound');
      if (rebound === undefined) {
        // No rebound means the ball went in or somebody went to the line.
        expect(resolution.retainsPossession).toBe(false);
        continue;
      }
      const offensive = (rebound.detail ?? {}).kind === 'offensive';
      expect(resolution.retainsPossession).toBe(offensive);
      expect(rebound.side).toBe(offensive ? resolution.attacking : 1 - resolution.attacking);
    }
  });

  it('blames somebody for a steal and nobody for a violation', () => {
    let steals = 0;
    let violations = 0;
    for (let i = 0; i < 400; i += 1) {
      const resolution = resolvePossession({
        state: stateFor(),
        calls: pair('push', 'press'),
        rng: createRng(`to-${i}`),
      });
      const turnover = resolution.events.find((entry) => entry.kind === 'turnover');
      if (turnover === undefined) continue;
      if (resolution.outcome === 'stolen') {
        steals += 1;
        expect(turnover.actor).toBeDefined();
        expect(resolution.events.some((entry) => entry.sportKind === 'basketball.steal')).toBe(
          true,
        );
      } else {
        violations += 1;
        expect(turnover.actor).toBeUndefined();
        expect((turnover.detail ?? {}).kind).toBe('violation');
      }
    }
    expect(steals).toBeGreaterThan(0);
    expect(violations).toBeGreaterThan(0);
  });

  it('spends less clock on a turnover than on a possession that got a shot up', () => {
    const state = stateFor();
    const full = offensiveProfile('motion').seconds;
    for (let i = 0; i < 200; i += 1) {
      const resolution = resolvePossession({
        state,
        calls: pair('motion', 'press'),
        rng: createRng(`clock-${i}`),
      });
      if (resolution.outcome === 'stolen' || resolution.outcome === 'turnover') {
        expect(resolution.seconds).toBeLessThan(full);
      }
    }
  });

  it('is deterministic for a seed', () => {
    const a = resolvePossession({
      state: stateFor(),
      calls: pair('isolation', 'double'),
      rng: createRng('d'),
    });
    const b = resolvePossession({
      state: stateFor(),
      calls: pair('isolation', 'double'),
      rng: createRng('d'),
    });
    expect(a).toEqual(b);
  });
});

describe('the calls actually mean what they say (`09` §2.2)', () => {
  it('2-3 Zone suppresses the rim and concedes the three', () => {
    const rimVsMan = batch('post-up', 'man');
    const rimVsZone = batch('post-up', 'zone');
    expect(rimVsZone.pointsPer).toBeLessThan(rimVsMan.pointsPer);

    const threeVsMan = batch('spot-up', 'man');
    const threeVsZone = batch('spot-up', 'zone');
    expect(threeVsZone.pointsPer).toBeGreaterThan(threeVsMan.pointsPer);
  });

  it('Protect the Rim cuts finishing and concedes mid-range', () => {
    expect(batch('post-up', 'protect-rim').pointsPer).toBeLessThan(
      batch('post-up', 'man').pointsPer,
    );
    expect(batch('isolation', 'protect-rim').pointsPer).toBeGreaterThan(
      batch('isolation', 'man').pointsPer,
    );
  });

  it('Press forces turnovers and concedes easy buckets when it breaks', () => {
    expect(batch('motion', 'press').turnoverRate).toBeGreaterThan(
      batch('motion', 'man').turnoverRate,
    );
    const broken = Array.from({ length: 400 }, (_, i) =>
      resolvePossession({
        state: stateFor(),
        calls: pair('motion', 'press'),
        rng: createRng(`broken-${i}`),
      }),
    ).filter((resolution) => resolution.outcome === 'broken-press-layup');
    expect(broken.length).toBeGreaterThan(0);
  });

  it('Double the Star blunts the athlete it is on and opens up everyone else', () => {
    const state = stateFor();
    const star = state.squads[0].players[0];
    expect(star).toBeDefined();

    const doubled = (target: number | undefined): number => {
      let points = 0;
      for (let i = 0; i < 400; i += 1) {
        points += resolvePossession({
          state,
          calls: {
            offence: { side: 0, call: 'isolation', target: star?.id ?? 0 },
            defence: { side: 1, call: 'double', ...(target === undefined ? {} : { target }) },
          },
          rng: createRng(`dbl-${i}`),
        }).points;
      }
      return points / 400;
    };

    expect(doubled(star?.id)).toBeLessThan(doubled(undefined));
  });

  it('never lets a defensive call hard-counter an offensive one', () => {
    // Soft rock-paper-scissors: the worst matchup in the grid still scores, and the best one is not
    // more than about twice the worst. `09` §2.2 — "calls shift probability distributions".
    const results = OFFENSIVE_PROFILES.flatMap((offence) =>
      DEFENSIVE_PROFILES.map((defence) => batch(offence.id, defence.id, 150, 'grid').pointsPer),
    );
    const low = Math.min(...results);
    const high = Math.max(...results);
    expect(low).toBeGreaterThan(0.5);
    expect(high / low).toBeLessThan(2.2);
  });

  it('lets ratings beat the mind-game: a strong roster outscores a weak one in every matchup', () => {
    const strongState = (() => {
      const match = createBasketballPlaybook({
        seed: 'tiers',
        squads: basketballSquads(roster('s', 'strong'), roster('w', 'weak')),
      });
      match.state.possession = 0;
      return match.state;
    })();
    const weakState = (() => {
      const match = createBasketballPlaybook({
        seed: 'tiers',
        squads: basketballSquads(roster('w', 'weak'), roster('s', 'strong')),
      });
      match.state.possession = 0;
      return match.state;
    })();

    const score = (state: State): number => {
      let points = 0;
      for (let i = 0; i < 300; i += 1) {
        points += resolvePossession({
          state,
          calls: pair('motion', 'man'),
          rng: createRng(`tier-${i}`),
        }).points;
      }
      return points / 300;
    };

    expect(score(strongState)).toBeGreaterThan(score(weakState));
  });
});

describe('the event stream is Live’s (INV-9)', () => {
  it('builds a box score with Live’s own reader and nothing else', () => {
    const [home, away] = evenRosters('box');
    const match = createBasketballPlaybook({
      seed: 'box',
      squads: basketballSquads(home, away),
      playerSide: -1,
      keyMoments: 'off',
    });

    let guard = 0;
    while (!match.finished && guard < 600) {
      for (const side of [0, 1] as const) {
        const call = match.autoCall(side);
        if (call !== null) match.submit(call);
      }
      match.resolve();
      match.advance();
      guard += 1;
    }

    const box = createBoxScore();
    for (const entry of match.events) applyEvent(box, entry);
    const line = teamLine(box, 0);

    expect(line.points).toBe(match.view().score[0]);
    expect(line.fieldGoalsAttempted).toBeGreaterThan(30);
    expect(line.assists).toBeGreaterThan(0);
    expect(line.rebounds).toBeGreaterThan(10);
    expect(line.freeThrowsAttempted).toBeGreaterThan(0);
    expect(line.players.length).toBe(5);
  });

  it('carries no event kind Live does not also emit', () => {
    const [home, away] = evenRosters('kinds');
    const match = createBasketballPlaybook({
      seed: 'kinds',
      squads: basketballSquads(home, away),
      playerSide: -1,
    });
    for (let i = 0; i < 40; i += 1) {
      for (const side of [0, 1] as const) {
        const call = match.autoCall(side);
        if (call !== null) match.submit(call);
      }
      match.resolve();
      match.advance();
    }

    const allowed = new Set([
      'match.start',
      'period.start',
      'period.end',
      'match.end',
      'possession',
      'shot',
      'score',
      'pass',
      'turnover',
      'foul',
      'rebound',
      'sport',
    ]);
    for (const entry of match.events) expect(allowed.has(entry.kind)).toBe(true);
  });
});

describe('the small pieces that make a turn readable', () => {
  it('names the outcome the way narration will read it', () => {
    const base = {
      made: true,
      value: 2,
      andOne: false,
      trip: false,
      broken: false,
      points: 2,
    } as const;
    expect(describeOutcome(base)).toBe('made-two');
    expect(describeOutcome({ ...base, value: 3, points: 3 })).toBe('made-three');
    expect(describeOutcome({ ...base, andOne: true })).toBe('and-one');
    expect(describeOutcome({ ...base, broken: true })).toBe('broken-press-layup');
    expect(describeOutcome({ ...base, made: false, points: 0 })).toBe('missed-two');
    expect(describeOutcome({ ...base, made: false, trip: true, points: 2 })).toBe('free-throws');
    expect(describeOutcome({ ...base, made: false, trip: true, points: 0 })).toBe(
      'missed-free-throws',
    );
  });

  it('says why, and says the loudest true thing first', () => {
    const base = {
      broken: false,
      contest: 0.45,
      edge: 0,
      offence: offensiveProfile('motion'),
      defence: defensiveProfile('man'),
      doubled: false,
    };
    expect(because({ ...base, broken: true })).toMatch(/press broke/);
    expect(because({ ...base, doubled: true })).toMatch(/Two bodies/);
    expect(because({ ...base, contest: 0.1 })).toBe('Wide open.');
    expect(because({ ...base, contest: 0.9 })).toBe('Smothered.');
    expect(because({ ...base, edge: 0.3 })).toMatch(/mismatch/);
    expect(because({ ...base, edge: -0.3 })).toMatch(/wrong matchup/);
    expect(because(base)).toBe('An even look.');
  });
});

describe('stamina', () => {
  it('drains with effort and never falls through the floor', () => {
    const players = basketballSquads(roster('sta'), roster('sta2'))[0].players;
    for (let i = 0; i < 200; i += 1) drainStamina(players, 0.4);
    for (const player of players) expect(player.stamina).toBe(RESOLUTION.staminaFloor);
  });

  it('recovers when the effort is less than the recovery', () => {
    const players = basketballSquads(roster('rec'), roster('rec2'))[0].players;
    for (const player of players) player.stamina = 0.6;
    drainStamina(players, 0);
    for (const player of players) expect(player.stamina).toBeGreaterThan(0.6);
  });

  it('never climbs above fresh', () => {
    const players = basketballSquads(roster('cap'), roster('cap2'))[0].players;
    for (let i = 0; i < 50; i += 1) drainStamina(players, 0);
    for (const player of players) expect(player.stamina).toBe(1);
  });
});
