/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.9 — Achievement UI: gallery, filters, progress bars, in-match toast, post-match
 *          summary
 * @story   US-8.2 — Browse my achievements
 * @design  10-ui-ux.md §10 (states), §11 (labels, nothing by colour alone)
 * @invariant INV-11 (every control has a real label; locked is a word)
 *
 * Purpose: that the gallery says how far along you are, that the filters narrow the list without
 * hiding the total, and that a hidden achievement keeps its secret until it does not.
 *
 * The hidden case is the one worth pinning down: "???" is the whole reason a hidden achievement is
 * fun, and a refactor that rendered `def.title` unconditionally would spoil seven of them silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_FILTERS,
  achievementsScreen,
  filterAchievements,
  summaryLine,
} from '@/ui/screens/achievements.ts';
import { ACHIEVEMENTS } from '@/achievements/registry.ts';
import { appDatabase, closeAppDatabase } from '@/storage/app-db.ts';
import { deleteDatabase } from '@/storage/idb.ts';
import { lockedRecord, type AchievementRecord } from '@/achievements/types.ts';

const AT = 1_800_000_000_000;

function context() {
  const host = document.createElement('main');
  document.body.replaceChildren(host);
  return { host, params: {}, query: {}, navigate: vi.fn() };
}

function unlocked(id: string): AchievementRecord {
  return { id, progress: 1, unlockedAt: AT, rewardedAt: AT };
}

async function store(...records: AchievementRecord[]): Promise<void> {
  await (await appDatabase()).achievements.putMany(records);
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('filtering', () => {
  const records = new Map([['onboarding.first-whistle', unlocked('onboarding.first-whistle')]]);

  it('shows everything by default, in registry order', () => {
    const shown = filterAchievements(ACHIEVEMENTS, records, ALL_FILTERS);
    expect(shown).toHaveLength(ACHIEVEMENTS.length);
    expect(shown[0]?.id).toBe(ACHIEVEMENTS[0]?.id);
  });

  it('narrows by category', () => {
    const shown = filterAchievements(ACHIEVEMENTS, records, {
      ...ALL_FILTERS,
      category: 'crossSport',
    });
    expect(shown.length).toBeGreaterThan(0);
    for (const def of shown) expect(def.category).toBe('crossSport');
  });

  it('narrows by sport, which is not the same as by category', () => {
    const shown = filterAchievements(ACHIEVEMENTS, records, { ...ALL_FILTERS, sport: 'soccer' });
    expect(shown.length).toBeGreaterThan(0);
    for (const def of shown) expect(def.category).toBe('soccer');
    // Cross-sport achievements belong to no single sport and are correctly excluded.
    expect(shown.some((def) => def.category === 'crossSport')).toBe(false);
  });

  it('narrows by completion, both ways', () => {
    const done = filterAchievements(ACHIEVEMENTS, records, {
      ...ALL_FILTERS,
      completion: 'unlocked',
    });
    const todo = filterAchievements(ACHIEVEMENTS, records, {
      ...ALL_FILTERS,
      completion: 'locked',
    });

    expect(done.map((def) => def.id)).toEqual(['onboarding.first-whistle']);
    expect(todo).toHaveLength(ACHIEVEMENTS.length - 1);
  });
});

describe('the summary line', () => {
  it('counts unlocks and the coins they paid', () => {
    const first = ACHIEVEMENTS[0];
    expect(first).toBeDefined();
    const records = new Map([[first!.id, unlocked(first!.id)]]);

    expect(summaryLine(ACHIEVEMENTS, records)).toBe(
      `1 of ${ACHIEVEMENTS.length} unlocked · ${(first?.reward.coins ?? 0).toLocaleString('en-US')} coins earned`,
    );
  });

  it('counts nothing on a fresh save', () => {
    expect(summaryLine(ACHIEVEMENTS, new Map())).toBe(
      `0 of ${ACHIEVEMENTS.length} unlocked · 0 coins earned`,
    );
  });

  it('does not count progress as an unlock', () => {
    const first = ACHIEVEMENTS[0];
    const records = new Map([[first!.id, { ...lockedRecord(first!.id), progress: 3 }]]);
    expect(summaryLine(ACHIEVEMENTS, records)).toContain(`0 of ${ACHIEVEMENTS.length}`);
  });
});

describe('the gallery screen', () => {
  it('lists every achievement, locked ones included', async () => {
    const ctx = context();
    await achievementsScreen().mount(ctx);

    expect(ctx.host.querySelectorAll('.achievement')).toHaveLength(ACHIEVEMENTS.length);
    expect(ctx.host.querySelector('.achievements__summary')?.textContent).toContain(
      `0 of ${ACHIEVEMENTS.length}`,
    );
  });

  it('says "Locked" in words, not only in a tint (INV-11)', async () => {
    const ctx = context();
    await achievementsScreen().mount(ctx);

    const first = ctx.host.querySelector('.achievement');
    expect(first?.getAttribute('data-state')).toBe('locked');
    expect(first?.querySelector('.achievement__status')?.textContent).toBe('Locked');
  });

  it('keeps a hidden achievement hidden until it is unlocked', async () => {
    const secret = ACHIEVEMENTS.find((def) => def.hidden);
    expect(secret).toBeDefined();

    const before = context();
    await achievementsScreen().mount(before);
    expect(before.host.textContent).not.toContain(secret!.title);
    expect(before.host.textContent).toContain('???');

    await store(unlocked(secret!.id));
    const after = context();
    await achievementsScreen().mount(after);
    expect(after.host.textContent).toContain(secret!.title);
  });

  it('draws a progress bar with the numbers beside it', async () => {
    const multi = ACHIEVEMENTS.find((def) => def.target > 1);
    expect(multi).toBeDefined();
    await store({ id: multi!.id, progress: 1, unlockedAt: null, rewardedAt: null });

    const ctx = context();
    await achievementsScreen().mount(ctx);

    const bar = ctx.host.querySelector('.achievement__progress');
    expect(bar?.getAttribute('role')).toBe('progressbar');
    expect(bar?.getAttribute('aria-valuemax')).toBe(String(multi!.target));
    expect(bar?.querySelector('.achievement__progress-text')?.textContent).toBe(
      `1 / ${multi!.target}`,
    );
  });

  it('labels every filter (INV-11)', async () => {
    const ctx = context();
    await achievementsScreen().mount(ctx);

    const selects = [...ctx.host.querySelectorAll<HTMLSelectElement>('.achievements__select')];
    expect(selects).toHaveLength(3);
    for (const field of selects) {
      expect(ctx.host.querySelector(`label[for="${field.id}"]`)?.textContent).toBeTruthy();
    }
  });

  it('filters the list without hiding the total', async () => {
    const ctx = context();
    await achievementsScreen().mount(ctx);

    const completion = ctx.host.querySelector<HTMLSelectElement>('#achievements-completion');
    completion!.value = 'unlocked';
    completion!.dispatchEvent(new Event('change'));

    expect(ctx.host.querySelectorAll('.achievement')).toHaveLength(0);
    expect(ctx.host.querySelector('.achievements__none')?.textContent).toContain('Nothing matches');
    // The count is of everything, not of what survived the filter.
    expect(ctx.host.querySelector('.achievements__summary')?.textContent).toContain(
      `of ${ACHIEVEMENTS.length}`,
    );
  });
});
