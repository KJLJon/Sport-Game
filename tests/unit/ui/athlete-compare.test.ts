/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.9 — Cross-sport compare view with projections for unplayed sports
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @design  10-ui-ux.md §6 (cross-sport compare), §10, §11
 *
 * Purpose: the compare view's job is to be *honest* about two numbers that mean different things,
 * so that is what is asserted: that the projection is the derivation's own arithmetic rather than
 * an estimate, that a sport this build cannot play says so, and that the ordering answers a
 * question about the athlete rather than about the save file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  athleteCompareScreen,
  compareSports,
  comparisonRow,
  describeGap,
  standoutRatings,
  type SportComparison,
} from '../../../src/ui/screens/athlete-compare.ts';
import {
  RATEABLE_SPORTS,
  rateableSport,
  type RateableSport,
} from '../../../src/sports/catalogue.ts';
import { projectRatings } from '../../../src/athletes/derivation.ts';
import { cardOverall, type CardSport } from '../../../src/ui/components/athlete-card.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { CURRENT_SCHEMA_VERSION } from '../../../src/storage/migrations.ts';
import { athlete, attributes } from '../../helpers/athletes.ts';

const doc = document;
const sports = [...RATEABLE_SPORTS];
const soccer = rateableSport('soccer') as CardSport;

function text(node: HTMLElement): string {
  return node.textContent ?? '';
}

function context(id: string, navigate = vi.fn()) {
  const host = doc.createElement('div');
  doc.body.replaceChildren(host);
  return { host, params: { id }, query: {}, navigate };
}

describe('compareSports', () => {
  const subject = athlete({ primarySport: 'basketball', sportSkills: {} });

  it("covers every rateable sport, the athlete's own first", () => {
    const rows = compareSports(subject, sports);
    expect(rows).toHaveLength(sports.length);
    expect(rows[0]?.sport.id).toBe('basketball');
  });

  it('ranks the rest by potential, not by what happens to have been played', () => {
    // Ranking on today's number would sort by the save file rather than by the athlete.
    const played = athlete({
      primarySport: 'basketball',
      sportSkills: {
        basketball: { familiarity: 100, level: 5, xp: 0, subSkills: {}, minutesPlayed: 500 },
      },
    });
    const rows = compareSports(played, sports).slice(1);
    expect(rows.map((r) => r.potential)).toEqual(
      [...rows.map((r) => r.potential)].sort((a, b) => b - a),
    );
  });

  it("reports the projection as derivation's own arithmetic, not an estimate", () => {
    const row = compareSports(subject, sports).find((r) => r.sport.id === 'soccer');
    const ceiling = cardOverall(
      {
        ...subject,
        sportSkills: {
          soccer: { familiarity: 100, level: 1, xp: 0, subSkills: {}, minutesPlayed: 0 },
        },
      },
      soccer,
    );
    expect(row?.potential).toBe(ceiling.overall);
  });

  it('rates an athlete below their ceiling wherever they are not fully familiar', () => {
    for (const row of compareSports(subject, sports)) {
      expect(row.current).toBeLessThanOrEqual(row.potential);
    }
  });

  it('marks a sport the athlete has never played', () => {
    const rows = compareSports(subject, sports);
    expect(rows.find((r) => r.sport.id === 'soccer')?.unplayed).toBe(true);
    expect(rows.find((r) => r.sport.id === 'soccer')?.band).toBe('novice');
  });

  it('estimates how many matches it would take to reach the cap', () => {
    const row = compareSports(subject, sports).find((r) => r.sport.id === 'soccer');
    expect(row?.matchesToCap).toBeGreaterThan(0);
  });

  it('reports nothing left to close once an athlete is capped', () => {
    const capped = athlete({
      primarySport: 'basketball',
      sportSkills: {
        basketball: { familiarity: 100, level: 1, xp: 0, subSkills: {}, minutesPlayed: 90 },
      },
    });
    const row = compareSports(capped, sports).find((r) => r.sport.id === 'basketball');
    expect(row?.matchesToCap).toBe(0);
    expect(row?.current).toBe(row?.potential);
  });

  it('is empty rather than throwing when given no sports', () => {
    expect(compareSports(subject, [])).toEqual([]);
  });
});

describe('standoutRatings', () => {
  it('names the ratings the athlete would be best at, largest first', () => {
    const shooter = athlete({ attributes: attributes(50, { accuracy: 95, coordination: 90 }) });
    const lines = standoutRatings(shooter, soccer);
    expect(lines).toHaveLength(3);

    const projected = projectRatings(shooter, 'soccer', soccer.tables);
    const best = Math.max(...Object.values(projected));
    expect(lines[0]).toContain(String(best));
  });

  it('honours a different limit', () => {
    expect(standoutRatings(athlete(), soccer, 1)).toHaveLength(1);
  });
});

describe('describeGap', () => {
  const base: SportComparison = {
    sport: soccer,
    current: 50,
    potential: 70,
    position: null,
    familiarity: 10,
    band: 'novice',
    unplayed: true,
    matchesToCap: 42,
  };

  it('says a never-played number is mostly penalty', () => {
    const line = describeGap(base, 20);
    expect(line).toContain('Never played');
    expect(line).toContain('mostly the penalty');
    expect(line).toContain('42 matches');
  });

  it('quantifies the gap for a sport already being learned', () => {
    const line = describeGap({ ...base, unplayed: false, band: 'learning' }, 12);
    expect(line).toContain('Learning familiarity');
    expect(line).toContain('12 points below their ceiling');
  });

  it('says plainly when there is no gap left', () => {
    expect(describeGap({ ...base, matchesToCap: 0 }, 0)).toBe('At their ceiling in soccer.');
  });

  it('omits the estimate when there is no reachable answer', () => {
    const line = describeGap({ ...base, matchesToCap: null }, 20);
    expect(line).not.toContain('matches of play');
  });
});

describe('comparisonRow', () => {
  const subject = athlete({ primarySport: 'basketball', sportSkills: {} });

  it('shows both numbers with words saying which is which (`10` §11)', () => {
    const row = comparisonRow(doc, subject, compareSports(subject, sports)[1] as SportComparison);
    expect(text(row)).toContain('Today');
    expect(text(row)).toContain('If they learned it');
  });

  it("marks the athlete's own sport by data attribute, not by colour alone", () => {
    const own = comparisonRow(doc, subject, compareSports(subject, sports)[0] as SportComparison);
    expect(own.dataset.own).toBe('true');
    expect(text(own)).toContain('(primary)');
  });

  it('says a sport this build cannot play is a projection', () => {
    // Every real sport is playable as of T-6.10, so this uses a stand-in for Phase 11's hockey:
    // rateable, not yet playable. The behaviour has to keep working for the next sport to arrive.
    const unplayable = { ...(sports[1] as RateableSport), id: 'hockey', playable: false };
    const rows = compareSports(subject, [...sports, unplayable]);
    const projected = rows.find((r) => r.sport.id === 'hockey') as SportComparison;
    const row = comparisonRow(doc, subject, projected);
    expect(text(row)).toContain('not playable yet');
  });
});

describe('the compare screen', () => {
  beforeEach(async () => {
    await closeAppDatabase();
    await deleteDatabase();
  });

  afterEach(async () => {
    await closeAppDatabase();
    await deleteDatabase();
  });

  it('lists every sport for an athlete that exists', async () => {
    const { athletes } = await appDatabase();
    await athletes.put(athlete({ id: 'a1', displayName: 'R. Example' }));

    const ctx = context('a1');
    await athleteCompareScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('R. Example across every sport');
    expect(ctx.host.querySelectorAll('.compare-card')).toHaveLength(RATEABLE_SPORTS.length);
    expect(ctx.host.querySelector('a[href="#/squad/athlete/a1"]')).not.toBeNull();
  });

  it('offers a way out when the athlete is gone (`10` §10)', async () => {
    await appDatabase();
    const navigate = vi.fn();
    const ctx = context('missing', navigate);
    await athleteCompareScreen().mount(ctx);

    expect(ctx.host.textContent).toContain('No such athlete');
    (ctx.host.querySelector('button, a') as HTMLElement | null)?.click();
    expect(navigate).toHaveBeenCalledWith('/squad');
  });

  it('says the roster could not be opened, and that nothing was lost', async () => {
    const db = await Database.open();
    await db.put('meta', { schemaVersion: CURRENT_SCHEMA_VERSION + 5 }, 'meta');
    db.close();

    const ctx = context('a1');
    await athleteCompareScreen().mount(ctx);

    expect(ctx.host.querySelector('[role="alert"]')?.textContent).toContain(
      'Nothing has been changed or lost',
    );
  });
});
