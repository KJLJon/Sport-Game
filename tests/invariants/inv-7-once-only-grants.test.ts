/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.6 — Achievement engine: declarative defs, event-stream evaluation, progress,
 *          once-only grants (INV-7)
 * @story   US-8.3 — Be rewarded for achievements
 * @design  05-data-model.md §6 ("grants are recorded once-only and are idempotent across
 *          migrations"), 12-quality-and-testing.md §3
 * @invariant INV-7 — achievement rewards are granted at most once, across any migration path
 *
 * Purpose: the invariant, against a real database, in the four ways it can be broken.
 *
 * A double grant is the kind of bug that is invisible until somebody notices their coin balance
 * does not add up, and by then it has happened to everyone. The cases here are the ones a wallet
 * can actually meet: settling twice, being killed between the unlock and the payment, an app
 * restart, and a backup restored on top of a save that had already been paid.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AchievementRepository, grantPending } from '../../src/achievements/repository.ts';
import { settleAchievements, matchMetaEvents } from '../../src/achievements/session.ts';
import { def, onMeta } from '../../src/achievements/conditions.ts';
import { MetaKind, type AchievementDef } from '../../src/achievements/types.ts';
import { EconomyRepository } from '../../src/economy/repository.ts';
import { Database, deleteDatabase } from '../../src/storage/idb.ts';
import { appDatabase, closeAppDatabase } from '../../src/storage/app-db.ts';
import { MATCH_RECORD_VERSION, type MatchRecord } from '../../src/stats/types.ts';
import { NO_ASSISTS } from '../../src/modes/assists.ts';

const AT = Date.UTC(2026, 7, 6, 10, 0, 0);

const FIRST_MATCH: AchievementDef = def({
  id: 'inv7.first-match',
  category: 'onboarding',
  title: 'First Whistle',
  description: 'Finish your first match.',
  reward: { coins: 200 },
  evaluate: onMeta(MetaKind.MATCH_FINISHED),
});

const WITH_PACK: AchievementDef = def({
  id: 'inv7.pack-reward',
  category: 'onboarding',
  title: 'Starter Pack',
  description: 'Finish your first match.',
  reward: { coins: 100, pack: 'bronze' },
  evaluate: onMeta(MetaKind.MATCH_FINISHED),
});

const DEFS = [FIRST_MATCH, WITH_PACK];

function record(): MatchRecord {
  return {
    id: 'inv7',
    schemaVersion: MATCH_RECORD_VERSION,
    playedAt: AT,
    sportId: 'basketball',
    mode: 'live',
    difficulty: 'pro',
    score: [60, 50],
    playerSide: 0,
    teamNames: ['Home', 'Away'],
    periodsPlayed: 4,
    lines: [],
  };
}

function context() {
  return {
    at: AT,
    sport: 'basketball' as const,
    difficulty: 'pro' as const,
    playerSide: 0 as const,
    assists: NO_ASSISTS,
    athleteOf: () => undefined,
  };
}

async function settle() {
  return settleAchievements({
    db: await appDatabase(),
    events: [],
    meta: matchMetaEvents(record()),
    context: context(),
    defs: DEFS,
  });
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('INV-7 — an achievement pays exactly once', () => {
  it('pays on the match that unlocked it', async () => {
    const settled = await settle();
    expect(settled.unlocked.map((entry) => entry.def.id).sort()).toEqual([
      'inv7.first-match',
      'inv7.pack-reward',
    ]);

    const { economy } = await appDatabase();
    expect((await economy.state()).balance).toBe(300);
    expect((await economy.state()).owedPacks).toEqual(['bronze']);
  });

  it('does not pay again on the next match', async () => {
    await settle();
    const second = await settle();

    expect(second.unlocked).toHaveLength(0);
    expect(second.grants).toHaveLength(0);
    const { economy } = await appDatabase();
    expect((await economy.state()).balance).toBe(300);
    expect((await economy.state()).owedPacks).toEqual(['bronze']);
  });

  it('does not pay again when the app restarts', async () => {
    await settle();
    await closeAppDatabase();

    const db = await appDatabase();
    expect(await grantPending(db.achievements, db.economy, DEFS, AT)).toEqual([]);
    expect((await db.economy.state()).balance).toBe(300);
  });

  it('finishes a grant that was interrupted between the unlock and the payment', async () => {
    // Exactly the state a kill in the middle leaves: unlocked on disk, never credited.
    const db = await appDatabase();
    await db.achievements.put({
      id: FIRST_MATCH.id,
      progress: 1,
      unlockedAt: AT,
      rewardedAt: null,
    });

    const granted = await grantPending(db.achievements, db.economy, DEFS, AT);
    expect(granted.map((entry) => entry.def.id)).toEqual([FIRST_MATCH.id]);
    expect((await db.economy.state()).balance).toBe(200);

    // …and the retry that follows it pays nothing.
    expect(await grantPending(db.achievements, db.economy, DEFS, AT)).toEqual([]);
    expect((await db.economy.state()).balance).toBe(200);
  });

  it('never pays for a record that claims to be paid but was never unlocked', async () => {
    // A hand-edited or corrupted record. `normaliseRecord` refuses to believe the `rewardedAt`,
    // and a locked achievement is not granted at all — so this is not a way to conjure coins.
    const database = await Database.open();
    const achievements = new AchievementRepository(database);
    const economy = new EconomyRepository(database);
    await database.put('achievements', {
      id: FIRST_MATCH.id,
      progress: 0,
      unlockedAt: null,
      rewardedAt: AT,
    });

    expect((await achievements.get(FIRST_MATCH.id)).rewardedAt).toBeNull();
    expect(await grantPending(achievements, economy, DEFS, AT)).toEqual([]);
    expect((await economy.state()).balance).toBe(0);
    database.close();
  });

  it('does not pay for a def this build no longer has', async () => {
    const db = await appDatabase();
    await db.achievements.put({ id: 'gone.away', progress: 1, unlockedAt: AT, rewardedAt: null });

    expect(await grantPending(db.achievements, db.economy, DEFS, AT)).toEqual([]);
    expect((await db.economy.state()).balance).toBe(0);
    // Kept unlocked and unpaid, so a build that has the def again pays it then.
    expect((await db.achievements.get('gone.away')).rewardedAt).toBeNull();
  });

  it('survives two settlements racing in the same tick', async () => {
    await Promise.all([settle(), settle()]);
    const { economy } = await appDatabase();
    expect((await economy.state()).balance).toBe(300);
  });
});
