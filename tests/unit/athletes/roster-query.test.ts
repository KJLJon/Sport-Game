/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.10 — Roster browser: search, sort, filter, bulk select
 * @design  05-data-model.md §2, §3.4
 *
 * Purpose: the roster browser's pure filter/sort/count logic, held to 95% coverage (`12` §2)
 * because it is the part of T-3.10 with no DOM to hide behind. Exercises the easy-to-get-wrong
 * requirements directly: stable-and-total sorting on an all-ties roster, `RARITIES`' declared
 * order rather than alphabetical, non-mutation of the input, and an unrecognised filter value
 * producing zero results rather than silently falling back to "everything".
 */
import { describe, expect, it } from 'vitest';
import {
  filterRoster,
  rosterCounts,
  sortRoster,
  type RosterFilter,
} from '../../../src/athletes/roster-query.ts';
import { RARITIES, type Rarity } from '../../../src/athletes/types.ts';
import { athlete } from '../../helpers/athletes.ts';

const NOW = 1_700_000_000_000;

describe('filterRoster', () => {
  it('returns everything for an empty filter', () => {
    const roster = [athlete({ id: 'a' }), athlete({ id: 'b' })];
    expect(filterRoster(roster, {}, NOW)).toEqual(roster);
  });

  it('does not mutate its input', () => {
    const roster = [athlete({ id: 'a', displayName: 'Zed' }), athlete({ id: 'b' })];
    const snapshot = [...roster];
    filterRoster(roster, { query: 'zed' }, NOW);
    expect(roster).toEqual(snapshot);
  });

  it('matches by name, accent- and case-insensitively (delegates to matchesQuery)', () => {
    const roster = [
      athlete({ id: 'a', displayName: 'René Álvarez' }),
      athlete({ id: 'b', displayName: 'Someone Else' }),
    ];
    expect(filterRoster(roster, { query: 'rene alvarez' }, NOW).map((a) => a.id)).toEqual(['a']);
  });

  it('filters by primary sport', () => {
    const roster = [
      athlete({ id: 'a', primarySport: 'basketball' }),
      athlete({ id: 'b', primarySport: 'soccer' }),
    ];
    expect(filterRoster(roster, { sports: ['soccer'] }, NOW).map((a) => a.id)).toEqual(['b']);
  });

  it('an unrecognised sport filters to nothing, not to everything', () => {
    const roster = [athlete({ id: 'a', primarySport: 'basketball' })];
    expect(filterRoster(roster, { sports: ['underwater-hockey'] }, NOW)).toEqual([]);
  });

  it('an empty sports list applies no sport filter at all', () => {
    const roster = [athlete({ id: 'a', primarySport: 'basketball' })];
    expect(filterRoster(roster, { sports: [] }, NOW)).toEqual(roster);
  });

  it('filters by rarity', () => {
    const roster = [
      athlete({ id: 'a', rarity: 'common' }),
      athlete({ id: 'b', rarity: 'legendary' }),
    ];
    expect(filterRoster(roster, { rarities: ['legendary'] }, NOW).map((a) => a.id)).toEqual(['b']);
  });

  it('an unrecognised rarity filters to nothing', () => {
    const roster = [athlete({ id: 'a', rarity: 'common' })];
    expect(filterRoster(roster, { rarities: ['mythical' as Rarity] }, NOW)).toEqual([]);
  });

  it('availableOnly hides the injured and suspended', () => {
    const roster = [
      athlete({ id: 'fit' }),
      athlete({ id: 'injured', condition: { stamina: 100, injuredUntil: NOW + 1 } }),
      athlete({ id: 'suspended', condition: { stamina: 100, suspendedGames: 1 } }),
    ];
    expect(filterRoster(roster, { availableOnly: true }, NOW).map((a) => a.id)).toEqual(['fit']);
  });

  it('availableOnly is a no-op when false or omitted', () => {
    const roster = [
      athlete({ id: 'fit' }),
      athlete({ id: 'injured', condition: { stamina: 100, injuredUntil: NOW + 1 } }),
    ];
    expect(filterRoster(roster, { availableOnly: false }, NOW)).toHaveLength(2);
  });

  it('sandbox "exclude" drops sandbox athletes', () => {
    const roster = [
      athlete({ id: 'fair', sandbox: false }),
      athlete({ id: 'sandbox', sandbox: true }),
    ];
    expect(filterRoster(roster, { sandbox: 'exclude' }, NOW).map((a) => a.id)).toEqual(['fair']);
  });

  it('sandbox "only" keeps just sandbox athletes', () => {
    const roster = [
      athlete({ id: 'fair', sandbox: false }),
      athlete({ id: 'sandbox', sandbox: true }),
    ];
    expect(filterRoster(roster, { sandbox: 'only' }, NOW).map((a) => a.id)).toEqual(['sandbox']);
  });

  it('sandbox "include" (and the default) keeps both', () => {
    const roster = [
      athlete({ id: 'fair', sandbox: false }),
      athlete({ id: 'sandbox', sandbox: true }),
    ];
    expect(filterRoster(roster, { sandbox: 'include' }, NOW)).toHaveLength(2);
    expect(filterRoster(roster, {}, NOW)).toHaveLength(2);
  });

  it('composes every dimension together', () => {
    const roster = [
      athlete({
        id: 'match',
        displayName: 'Star Player',
        primarySport: 'basketball',
        rarity: 'epic',
      }),
      athlete({
        id: 'wrong-name',
        displayName: 'Nope',
        primarySport: 'basketball',
        rarity: 'epic',
      }),
      athlete({
        id: 'wrong-sport',
        displayName: 'Star Player',
        primarySport: 'soccer',
        rarity: 'epic',
      }),
      athlete({
        id: 'wrong-rarity',
        displayName: 'Star Player',
        primarySport: 'basketball',
        rarity: 'common',
      }),
    ];
    const filter: RosterFilter = { query: 'star', sports: ['basketball'], rarities: ['epic'] };
    expect(filterRoster(roster, filter, NOW).map((a) => a.id)).toEqual(['match']);
  });
});

describe('sortRoster', () => {
  it('does not mutate its input', () => {
    const roster = [athlete({ id: 'b', displayName: 'B' }), athlete({ id: 'a', displayName: 'A' })];
    const snapshot = [...roster];
    sortRoster(roster, 'name', 'asc');
    expect(roster).toEqual(snapshot);
  });

  it('sorts by name, ascending and descending', () => {
    const roster = [
      athlete({ id: 'z', displayName: 'Zed' }),
      athlete({ id: 'a', displayName: 'Alba' }),
      athlete({ id: 'm', displayName: 'Mona' }),
    ];
    expect(sortRoster(roster, 'name', 'asc').map((a) => a.id)).toEqual(['a', 'm', 'z']);
    expect(sortRoster(roster, 'name', 'desc').map((a) => a.id)).toEqual(['z', 'm', 'a']);
  });

  it('name sort is accent-insensitive, matching the search normalisation', () => {
    const roster = [
      athlete({ id: 'accented', displayName: 'Émile' }),
      athlete({ id: 'plain', displayName: 'Emile' }),
    ];
    // Stripped of diacritics the two names are identical, so this only proves normalisation
    // happened if the tiebreak (id, ascending) is what decided the order.
    expect(sortRoster(roster, 'name', 'asc').map((a) => a.id)).toEqual(['accented', 'plain']);
  });

  it('sorts by rarity in the declared common→legendary order, not alphabetically', () => {
    const roster = [
      athlete({ id: 'leg', displayName: 'A', rarity: 'legendary' }),
      athlete({ id: 'com', displayName: 'B', rarity: 'common' }),
      athlete({ id: 'rar', displayName: 'C', rarity: 'rare' }),
    ];
    expect(sortRoster(roster, 'rarity', 'asc').map((a) => a.id)).toEqual(['com', 'rar', 'leg']);
    expect(RARITIES).toEqual(['common', 'uncommon', 'rare', 'epic', 'legendary']);
  });

  it('sorts by recency (createdAt)', () => {
    const roster = [
      athlete({ id: 'old', displayName: 'A', createdAt: 1 }),
      athlete({ id: 'new', displayName: 'B', createdAt: 3 }),
      athlete({ id: 'mid', displayName: 'C', createdAt: 2 }),
    ];
    expect(sortRoster(roster, 'recent', 'desc').map((a) => a.id)).toEqual(['new', 'mid', 'old']);
  });

  it('sorts by familiarity in the given sport', () => {
    const low = athlete({ id: 'low', displayName: 'A', primarySport: 'basketball' });
    low.sportSkills.basketball = { ...low.sportSkills.basketball!, familiarity: 20 };
    const high = athlete({ id: 'high', displayName: 'B', primarySport: 'basketball' });
    high.sportSkills.basketball = { ...high.sportSkills.basketball!, familiarity: 90 };

    expect(sortRoster([low, high], 'familiarity', 'asc', 'basketball').map((a) => a.id)).toEqual([
      'low',
      'high',
    ]);
  });

  it("familiarity sort defaults to each athlete's own primary sport when no sport is given", () => {
    const basketballer = athlete({ id: 'bball', displayName: 'A', primarySport: 'basketball' });
    const soccerer = athlete({ id: 'soccer', displayName: 'B', primarySport: 'soccer' });
    // Both start at STARTING_FAMILIARITY.primary (85) in their own primary sport — equal, so the
    // name tiebreak decides, proving the per-athlete default sport was actually used for both.
    expect(sortRoster([soccerer, basketballer], 'familiarity', 'asc').map((a) => a.id)).toEqual([
      'bball',
      'soccer',
    ]);
  });

  it("sorts by rating, defaulting to each athlete's own primary sport", () => {
    const roster = [
      athlete({ id: 'a', displayName: 'A', primarySport: 'basketball' }),
      athlete({ id: 'b', displayName: 'B', primarySport: 'soccer' }),
    ];
    const ascending = sortRoster(roster, 'rating', 'asc');
    const descending = sortRoster(roster, 'rating', 'desc');
    expect(ascending.map((a) => a.id)).toEqual([...descending.map((a) => a.id)].reverse());
    expect(ascending).toHaveLength(2);
  });

  it('rating sort in an unrecognised sport treats every athlete as 0 rather than throwing', () => {
    const roster = [athlete({ id: 'a', displayName: 'B' }), athlete({ id: 'b', displayName: 'A' })];
    // With every rating tied at 0, this also exercises the tiebreak path for 'rating'.
    expect(sortRoster(roster, 'rating', 'asc', 'underwater-hockey').map((a) => a.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('is total and stable on an all-ties input, breaking ties by name then id', () => {
    const roster = [
      athlete({ id: 'z', displayName: 'Same', rarity: 'common', createdAt: 5 }),
      athlete({ id: 'a', displayName: 'Same', rarity: 'common', createdAt: 5 }),
      athlete({ id: 'm', displayName: 'Same', rarity: 'common', createdAt: 5 }),
    ];
    const expected = ['a', 'm', 'z'];
    for (const key of ['name', 'rarity', 'recent', 'rating', 'familiarity'] as const) {
      expect(sortRoster(roster, key, 'asc').map((a) => a.id)).toEqual(expected);
      expect(sortRoster(roster, key, 'desc').map((a) => a.id)).toEqual(expected);
    }
  });

  it('defaults to ascending when no direction is given', () => {
    const roster = [
      athlete({ id: 'z', displayName: 'Zed' }),
      athlete({ id: 'a', displayName: 'Alba' }),
    ];
    expect(sortRoster(roster, 'name').map((a) => a.id)).toEqual(['a', 'z']);
  });
});

describe('rosterCounts', () => {
  it('is all zero for an empty roster', () => {
    expect(rosterCounts([], NOW)).toEqual({
      total: 0,
      bySport: {},
      byRarity: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
      sandbox: 0,
      unavailable: 0,
    });
  });

  it('counts totals, by sport, by rarity, sandbox, and unavailable', () => {
    const roster = [
      athlete({ id: 'a', primarySport: 'basketball', rarity: 'common', sandbox: false }),
      athlete({ id: 'b', primarySport: 'basketball', rarity: 'legendary', sandbox: true }),
      athlete({
        id: 'c',
        primarySport: 'soccer',
        rarity: 'common',
        sandbox: false,
        condition: { stamina: 100, injuredUntil: NOW + 1 },
      }),
    ];

    expect(rosterCounts(roster, NOW)).toEqual({
      total: 3,
      bySport: { basketball: 2, soccer: 1 },
      byRarity: { common: 2, uncommon: 0, rare: 0, epic: 0, legendary: 1 },
      sandbox: 1,
      unavailable: 1,
    });
  });

  it('defaults `now` to the current time rather than requiring a caller to supply one', () => {
    // No explicit `now` — just confirms the default parameter path runs without throwing and
    // produces a sane shape.
    const result = rosterCounts([athlete({ id: 'a' })]);
    expect(result.total).toBe(1);
    expect(result.unavailable).toBe(0);
  });
});
