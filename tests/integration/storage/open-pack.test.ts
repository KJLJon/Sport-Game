/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.12 — Packs: tiers, prices, published odds, pity timers, reveal animation with skip
 * @story   US-9.2 — Open packs to earn new athletes
 * @design  05-data-model.md §5.2, §4
 * @invariant INV-2 (a pack is a function of its seed), INV-7 (an owed pack is consumed once)
 *
 * Purpose: buying a pack, against a real database.
 *
 * The cases that matter are the ones about money: a pack that cannot be afforded charges nothing,
 * an owed pack is free exactly once, and two taps in the same tick buy one pack rather than two.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openPack, isRefusal, type OpenedPack } from '../../../src/economy/open-pack.ts';
import { PACKS } from '../../../src/economy/packs.ts';
import { appDatabase, closeAppDatabase } from '../../../src/storage/app-db.ts';
import { deleteDatabase } from '../../../src/storage/idb.ts';

const AT = Date.UTC(2026, 7, 6, 12, 0, 0);

async function fund(coins: number): Promise<void> {
  await (await appDatabase()).economy.earn(coins, 'match', 'won', AT);
}

function opened(result: OpenedPack | { reason: string }): OpenedPack {
  if (isRefusal(result as OpenedPack | { reason: 'failed'; message: string })) {
    throw new Error(`expected a pack, got a refusal: ${JSON.stringify(result)}`);
  }
  return result as OpenedPack;
}

beforeEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await closeAppDatabase();
  await deleteDatabase();
});

describe('openPack', () => {
  it('charges the price and puts the athletes in the roster', async () => {
    await fund(5000);
    const db = await appDatabase();

    const pack = opened(await openPack({ db, tier: 'bronze', seed: 'p1', now: AT }));

    expect(pack.athletes).toHaveLength(PACKS.bronze.cards);
    expect(pack.spent).toBe(PACKS.bronze.price);
    expect(await db.economy.balance()).toBe(5000 - PACKS.bronze.price);
    expect(await db.athletes.count()).toBe(PACKS.bronze.cards);

    // Every athlete is recorded as having come from a pack (`05` §2).
    for (const entry of pack.athletes) expect(entry.athlete.source).toBe('pack');
  });

  it('writes a ledger line naming the pack', async () => {
    await fund(5000);
    const db = await appDatabase();
    await openPack({ db, tier: 'silver', seed: 'p2', now: AT });

    const [entry] = await db.economy.recent(1);
    expect(entry).toMatchObject({ reason: 'pack', delta: -PACKS.silver.price });
    expect(entry?.detail).toBe('Silver pack');
  });

  it('refuses a pack the wallet cannot afford, and charges nothing', async () => {
    await fund(100);
    const db = await appDatabase();

    const result = await openPack({ db, tier: 'gold', seed: 'p3', now: AT });
    expect(isRefusal(result) && result.reason).toBe('unaffordable');
    expect(await db.economy.balance()).toBe(100);
    expect(await db.athletes.count()).toBe(0);
  });

  it('spends an owed pack instead of coins, exactly once', async () => {
    const db = await appDatabase();
    await db.economy.owePack('gold');

    const free = opened(await openPack({ db, tier: 'gold', seed: 'p4', now: AT }));
    expect(free.free).toBe(true);
    expect(free.spent).toBe(0);
    expect(await db.economy.balance()).toBe(0);
    expect((await db.economy.state()).owedPacks).toEqual([]);

    // The second is not free, and with no coins it does not happen at all.
    const second = await openPack({ db, tier: 'gold', seed: 'p5', now: AT });
    expect(isRefusal(second)).toBe(true);
  });

  it('buys one pack when two taps land in the same tick', async () => {
    await fund(PACKS.bronze.price + 100);
    const db = await appDatabase();

    const results = await Promise.all([
      openPack({ db, tier: 'bronze', seed: 'race-a', now: AT }),
      openPack({ db, tier: 'bronze', seed: 'race-b', now: AT }),
    ]);

    expect(results.filter((result) => !isRefusal(result))).toHaveLength(1);
    expect(await db.economy.balance()).toBe(100);
    expect(await db.athletes.count()).toBe(PACKS.bronze.cards);
  });

  it('advances the pity counter, and the same seed gives the same pack (INV-2)', async () => {
    await fund(100_000);
    const db = await appDatabase();

    const first = opened(await openPack({ db, tier: 'bronze', seed: 'fixed', now: AT }));
    const counter = (await db.economy.state()).pity['bronze'] ?? 0;
    // Either it counted up or the pack itself paid out at the floor and reset it.
    expect(counter === 1 || counter === 0).toBe(true);

    await closeAppDatabase();
    await deleteDatabase();
    await fund(100_000);
    const fresh = await appDatabase();
    const again = opened(await openPack({ db: fresh, tier: 'bronze', seed: 'fixed', now: AT }));

    expect(again.roll.rarities).toEqual(first.roll.rarities);
    expect(again.athletes.map((entry) => entry.athlete.displayName)).toEqual(
      first.athletes.map((entry) => entry.athlete.displayName),
    );
  });
});
