/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.10 — Roster browser: search, sort, filter, bulk select
 * @story   US-5.5 — Edit and delete profiles
 * @design  05-data-model.md §2 (athlete), §3.4 (overall), 10-ui-ux.md §7 (screen map)
 * @invariant INV-2 (no Math.random), INV-8 (determinism)
 *
 * Purpose: the roster browser's filtering, sorting, and summary-count logic, kept out of the
 * screen so it can be tested exhaustively without a DOM. Nothing here reads the clock or storage
 * on its own — `now` is always a parameter — so a test can pin every edge case (an athlete whose
 * suspension ends at exactly `now`, a roster that is all ties) without timing games.
 */
import { cardOverall, type CardSport } from '../ui/components/athlete-card.ts';
import { rateableSport } from '../sports/catalogue.ts';
import type { SportId } from '../sports/types.ts';
import { matchesQuery, normaliseForSearch } from './repository.ts';
import { RARITIES, isAvailable, sportSkillFor, type Athlete, type Rarity } from './types.ts';

export type SortKey = 'name' | 'rating' | 'rarity' | 'recent' | 'familiarity';
export type SortDirection = 'asc' | 'desc';

export interface RosterFilter {
  readonly query?: string;
  /** Filters on the athlete's PRIMARY sport. Empty or omitted means every sport. */
  readonly sports?: readonly SportId[];
  readonly rarities?: readonly Rarity[];
  /** `isAvailable(athlete, now)` — hides the injured and suspended. */
  readonly availableOnly?: boolean;
  /** `'include'` (default) keeps everything; `'exclude'`/`'only'` split on `athlete.sandbox`. */
  readonly sandbox?: 'include' | 'exclude' | 'only';
}

/**
 * Every athlete matching `filter`, in the input's order. Never mutates `athletes` — the caller's
 * array (often straight from `AthleteRepository.getAll()`) is read only.
 *
 * A filter dimension left `undefined` or given an empty list is not applied at all — that is what
 * "an empty filter returns everything" means. A *non-empty* list that names nothing in the roster
 * (an unrecognised sport id, say) filters to nothing, same as any other list membership test: it
 * is never treated as "no filter" just because it happened to match zero records.
 */
export function filterRoster(
  athletes: readonly Athlete[],
  filter: RosterFilter,
  now: number,
): Athlete[] {
  const query = filter.query ?? '';
  const sandboxMode = filter.sandbox ?? 'include';

  return athletes.filter((athlete) => {
    if (!matchesQuery(athlete, query)) return false;
    if (filter.sports !== undefined && filter.sports.length > 0) {
      if (!filter.sports.includes(athlete.primarySport)) return false;
    }
    if (filter.rarities !== undefined && filter.rarities.length > 0) {
      if (!filter.rarities.includes(athlete.rarity)) return false;
    }
    if (filter.availableOnly === true && !isAvailable(athlete, now)) return false;
    if (sandboxMode === 'exclude' && athlete.sandbox) return false;
    if (sandboxMode === 'only' && !athlete.sandbox) return false;
    return true;
  });
}

type SortValue = number | string;

/**
 * Ratings are per sport, so "sort by rating" needs one. With no sport chosen, each athlete is
 * ranked on its *own* primary sport — the roster orders by "how good is this athlete, at what they
 * actually play" rather than silently defaulting every card to one sport's table.
 */
function ratingValue(athlete: Athlete, sport: SportId | undefined): number {
  const resolved = rateableSport(sport ?? athlete.primarySport);
  if (resolved === undefined) return 0;
  return cardOverall(athlete, resolved as CardSport).overall;
}

/** Same per-sport default as `ratingValue`, for the same reason. */
function familiarityValue(athlete: Athlete, sport: SportId | undefined): number {
  return sportSkillFor(athlete, sport ?? athlete.primarySport).familiarity;
}

function sortValue(athlete: Athlete, key: SortKey, sport: SportId | undefined): SortValue {
  switch (key) {
    case 'name':
      return normaliseForSearch(athlete.displayName);
    case 'recent':
      return athlete.createdAt;
    case 'rarity':
      // RARITIES is common → legendary; its declared order, never alphabetical.
      return RARITIES.indexOf(athlete.rarity);
    case 'rating':
      return ratingValue(athlete, sport);
    case 'familiarity':
      return familiarityValue(athlete, sport);
  }
}

function compareSortValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * The deterministic tiebreak every sort falls back on: name, then id. Never left to
 * `Array.prototype.sort`'s stability — that is an implementation detail of the engine, not a
 * contract — so two athletes with identical sort keys still land in the same order every time,
 * on every engine, forever.
 */
function tiebreak(a: Athlete, b: Athlete): number {
  const byName = normaliseForSearch(a.displayName).localeCompare(normaliseForSearch(b.displayName));
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

/**
 * A new, sorted array — `athletes` is never mutated. Total and stable: every pair of athletes
 * compares to a definite, reproducible order, including a roster that is all ties on `key`.
 */
export function sortRoster(
  athletes: readonly Athlete[],
  key: SortKey,
  direction: SortDirection = 'asc',
  sport?: SportId,
): Athlete[] {
  const decorated = athletes.map((athlete) => ({ athlete, value: sortValue(athlete, key, sport) }));

  decorated.sort((a, b) => {
    const primary = compareSortValues(a.value, b.value);
    const ordered = direction === 'desc' ? -primary : primary;
    return ordered !== 0 ? ordered : tiebreak(a.athlete, b.athlete);
  });

  return decorated.map((entry) => entry.athlete);
}

export interface RosterCounts {
  readonly total: number;
  /** Keyed by primary sport id; only sports actually present in the roster appear. */
  readonly bySport: Readonly<Record<string, number>>;
  /** Every declared rarity, `RARITIES`' order, zero included — so a filter chip always has a count. */
  readonly byRarity: Readonly<Record<Rarity, number>>;
  readonly sandbox: number;
  readonly unavailable: number;
}

/**
 * Summary counts for the roster browser's filter chips and header line. `now` defaults to
 * `Date.now()` for callers that just want "right now"; tests pass a fixed value so an
 * injured-until-exactly-`now` edge case is reproducible rather than a coin flip on wall-clock time.
 */
export function rosterCounts(athletes: readonly Athlete[], now: number = Date.now()): RosterCounts {
  const bySport: Record<string, number> = {};
  const byRarity = Object.fromEntries(RARITIES.map((rarity) => [rarity, 0])) as Record<
    Rarity,
    number
  >;
  let sandbox = 0;
  let unavailable = 0;

  for (const athlete of athletes) {
    bySport[athlete.primarySport] = (bySport[athlete.primarySport] ?? 0) + 1;
    byRarity[athlete.rarity] += 1;
    if (athlete.sandbox) sandbox += 1;
    if (!isAvailable(athlete, now)) unavailable += 1;
  }

  return { total: athletes.length, bySport, byRarity, sandbox, unavailable };
}
