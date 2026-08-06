/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @story   US-9.1 — Earn coins
 * @story   US-9.5 — Understand my economy at a glance
 * @design  05-data-model.md §1 (the `economy` store — one keyless record), §5
 * @invariant INV-3 (the key comes from the store name, which `storage/scope.ts` namespaces)
 *
 * Purpose: the wallet against real IndexedDB, and specifically the case a unit test cannot reach —
 * two credits issued in the same tick.
 *
 * Both match screens credit from a `.then()` on the shared database promise, and an arcade run can
 * settle while a match is still writing. Read-modify-write without serialisation loses one of them,
 * silently, and the player is simply short. That test is the reason this repository has a queue.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EconomyRepository, ECONOMY_KEY } from '../../../src/economy/repository.ts';
import { emptyEconomy } from '../../../src/economy/types.ts';
import { MATCH_RECORD_VERSION, type MatchRecord } from '../../../src/stats/types.ts';
import { Database, deleteDatabase } from '../../../src/storage/idb.ts';
import { exportBackup } from '../../../src/storage/backup.ts';

const AT = Date.UTC(2026, 7, 5, 12, 0, 0);

function match(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'm1',
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
    ...overrides,
  };
}

describe('EconomyRepository', () => {
  let db: Database;
  let economy: EconomyRepository;

  beforeEach(async () => {
    await deleteDatabase();
    db = await Database.open();
    economy = new EconomyRepository(db);
  });

  afterEach(async () => {
    db.close();
    await deleteDatabase();
  });

  it('reads an untouched install as an empty wallet', async () => {
    expect(await economy.state()).toEqual(emptyEconomy());
    expect(await economy.balance()).toBe(0);
    expect(await economy.recent()).toEqual([]);
  });

  it('persists a credit', async () => {
    await economy.earn(250, 'match', 'Basketball · Live · Won', AT);
    expect(await economy.balance()).toBe(250);

    // A second repository over the same database sees it — it is in the store, not in the object.
    expect(await new EconomyRepository(db).balance()).toBe(250);
  });

  it('does not lose a credit issued in the same tick as another', async () => {
    await Promise.all([
      economy.earn(100, 'match', 'one', AT),
      economy.earn(100, 'arcade', 'two', AT),
      economy.earn(100, 'achievement', 'three', AT),
    ]);

    const state = await economy.state();
    expect(state.balance).toBe(300);
    expect(state.entryCount).toBe(3);
    expect(state.ledger.map((entry) => entry.id).sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('refuses a spend it cannot afford and leaves the balance alone', async () => {
    await economy.earn(500, 'match', 'won', AT);
    expect(await economy.spend(750, 'pack', 'Bronze pack', AT)).toBeNull();
    expect(await economy.balance()).toBe(500);

    const afforded = await economy.spend(500, 'pack', 'Bronze pack', AT);
    expect(afforded?.balance).toBe(0);
    expect((await economy.state()).totalSpent).toBe(500);
  });

  it('settles a match once and pays the day bonus once', async () => {
    const first = await economy.settleMatch(match(), { detail: 'Basketball · Live', at: AT });
    const second = await economy.settleMatch(match({ id: 'm2' }), {
      detail: 'Basketball · Live',
      at: AT + 1000,
    });

    expect(first.items.map((item) => item.id)).toContain('first-win');
    expect(second.items.map((item) => item.id)).not.toContain('first-win');
    expect(await economy.balance()).toBe(first.total + second.total);
  });

  it('stores the wallet where a backup will find it', async () => {
    await economy.earn(250, 'match', 'won', AT);

    // Keyless singletons live under their own store name; `backup.ts` reads them that way.
    expect(ECONOMY_KEY).toBe('economy');
    const backup = await exportBackup(db, { now: AT });
    expect(backup.stores['economy']).toHaveLength(1);
    expect((backup.stores['economy']?.[0] as { balance: number }).balance).toBe(250);
  });

  it('empties the wallet on request', async () => {
    await economy.earn(250, 'match', 'won', AT);
    await economy.clear();
    expect(await economy.state()).toEqual(emptyEconomy());
  });
});
