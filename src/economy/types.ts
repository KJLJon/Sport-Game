/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.10 — Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match
 *          payout
 * @story   US-9.1 — Earn coins
 * @story   US-9.5 — Understand my economy at a glance
 * @design  05-data-model.md §1 (the `economy` store), §5 (economy), 10-ui-ux.md §7 (screen map)
 * @invariant INV-3 (every store name comes from `storage/scope.ts` via `idb.ts`)
 *
 * Purpose: what the wallet is, and what a coin movement looks like.
 *
 * **One record, and every coin in it accounted for.** `05` §1 gives the economy a single keyless
 * record, and the balance in it is never written directly: it is the running total of a ledger, so
 * "where did my coins go" has an answer on the screen rather than in a debugger. US-9.5 asks for
 * exactly that view, and a balance with no history behind it could not honestly provide one.
 *
 * **The ledger is capped.** A player who plays daily for a year would otherwise carry thousands of
 * entries in a record fetched whole on every credit. The cap keeps the *recent* history — which is
 * what the screen shows — and the lifetime totals are kept as their own fields so trimming the
 * ledger never makes the summary wrong.
 *
 * **Pity counters and market state are not here yet.** `05` §1 says this record eventually holds
 * them; they arrive with the features that own them (T-8.12, T-8.14), as added fields on the same
 * record. `normaliseEconomy` is what lets a record written by an older build be read by a newer
 * one without a schema migration for every field the economy grows.
 */

/** Bumped when the record's shape changes in a way a reader must know about. */
export const ECONOMY_VERSION = 1;

/**
 * The four pack tiers from `05` §5.2. Their prices, odds, and pity timers are T-8.12's; the *names*
 * live here because an achievement can be rewarded with a pack (T-8.6) and the wallet has to be able
 * to hold one that is owed before there is anything to open it with.
 */
export const PACK_TIERS = ['bronze', 'silver', 'gold', 'elite'] as const;
export type PackTier = (typeof PACK_TIERS)[number];

export function isPackTier(value: unknown): value is PackTier {
  return typeof value === 'string' && (PACK_TIERS as readonly string[]).includes(value);
}

/**
 * Why coins moved. A closed set, because the wallet screen groups by it and an unrecognised reason
 * would be an unlabelled row.
 *
 * Not one reason per mode: `match` covers Live and Playbook alike, because a coin earned in a
 * Playbook match is the same coin (INV-9). `arcade` is separate not because arcade is a special
 * mode but because it is capped daily on its own terms (T-4.13), and the screen has to be able to
 * say so.
 */
export const LEDGER_REASONS = [
  'match',
  'arcade',
  'tournament',
  'achievement',
  'pack',
  'sell',
  'market',
  'adjust',
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export function isLedgerReason(value: unknown): value is LedgerReason {
  return typeof value === 'string' && (LEDGER_REASONS as readonly string[]).includes(value);
}

/** One movement of coins, in or out. */
export interface LedgerEntry {
  /** Unique within this wallet. Sequential rather than random — nothing here may draw (INV-2). */
  readonly id: string;
  readonly at: number;
  /** Signed: positive earns, negative spends. Never zero — a movement of nothing is not recorded. */
  readonly delta: number;
  readonly reason: LedgerReason;
  /** One line a player can read: "Basketball · Live · You win". Never an id. */
  readonly detail: string;
}

export interface EconomyState {
  readonly schemaVersion: number;
  /** Never negative, and always the sum of the movements that have happened. */
  readonly balance: number;
  readonly totalEarned: number;
  readonly totalSpent: number;
  /** How many entries have ever been written. Also where the next entry's id comes from. */
  readonly entryCount: number;
  /**
   * The UTC day (`modes/day.ts`) of the last win that took the first-win-of-the-day bonus, or
   * `null` for a wallet that has never been paid one.
   */
  readonly lastWinDay: string | null;
  /** Newest first, capped at `LEDGER_LIMIT`. */
  readonly ledger: readonly LedgerEntry[];
  /**
   * Packs the player has been given and not yet opened — an achievement reward, a tournament win.
   *
   * Held here rather than granted on the spot because opening one is a screen (T-8.12) and the
   * grant is an event. A pack owed is a pack owed whether or not the player was looking at the
   * store when they earned it, and INV-7 needs the grant recorded exactly once regardless.
   */
  readonly owedPacks: readonly PackTier[];
  /**
   * How many of each tier have been opened since that tier last paid out at its pity floor
   * (`05` §5.2). Reset on trigger, and on any lucky pull that satisfies the floor on its own.
   */
  readonly pity: Readonly<Partial<Record<PackTier, number>>>;
}

/**
 * How many movements the wallet keeps.
 *
 * 120 is a few weeks of daily play, which is far more than "recent earnings and spends" (US-9.5)
 * asks for, and small enough that the record stays a few kilobytes for as long as the app is
 * installed. The lifetime totals outlive the entries that made them.
 */
export const LEDGER_LIMIT = 120;

/** A wallet that has never earned anything. Returned rather than `undefined`, so nothing branches. */
export function emptyEconomy(): EconomyState {
  return {
    schemaVersion: ECONOMY_VERSION,
    balance: 0,
    totalEarned: 0,
    totalSpent: 0,
    entryCount: 0,
    lastWinDay: null,
    ledger: [],
    owedPacks: [],
    pity: {},
  };
}

/** One line of a payout. A multiplier line carries the coins it *added*, so the lines always sum. */
export interface CoinAward {
  readonly id: string;
  /** "Win", "All-Star", "First win today". Shown as written. */
  readonly label: string;
  readonly coins: number;
  /** Set on a line that scaled what came before it, so the screen can print "×1.4". */
  readonly multiplier?: number;
}

/** What a finished match, run, or tournament pays — itemised, because `06` §4 says it must be. */
export interface Payout {
  readonly total: number;
  readonly items: readonly CoinAward[];
}

export const EMPTY_PAYOUT: Payout = { total: 0, items: [] };

function finiteInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

/**
 * Repairs a record read out of storage.
 *
 * Storage is written by whatever build the player last ran, and a wallet is the one record where
 * being wrong costs the player something real. Anything unreadable falls back to the empty wallet's
 * value for that field rather than to `NaN`, and the balance is re-clamped at zero — a negative
 * balance is not a state this app can be in, whatever a corrupted record says.
 */
export function normaliseEconomy(value: unknown): EconomyState {
  if (value === null || typeof value !== 'object') return emptyEconomy();
  const raw = value as Partial<EconomyState>;

  const ledger: LedgerEntry[] = [];
  if (Array.isArray(raw.ledger)) {
    for (const item of raw.ledger as readonly Partial<LedgerEntry>[]) {
      if (item === null || typeof item !== 'object') continue;
      const delta = finiteInt(item.delta, 0);
      if (delta === 0 || !isLedgerReason(item.reason)) continue;
      ledger.push({
        id: typeof item.id === 'string' ? item.id : `e${ledger.length}`,
        at: finiteInt(item.at, 0),
        delta,
        reason: item.reason,
        detail: typeof item.detail === 'string' ? item.detail : '',
      });
    }
  }

  const balance = Math.max(0, finiteInt(raw.balance, 0));
  return {
    schemaVersion: ECONOMY_VERSION,
    balance,
    totalEarned: Math.max(0, finiteInt(raw.totalEarned, balance)),
    totalSpent: Math.max(0, finiteInt(raw.totalSpent, 0)),
    entryCount: Math.max(ledger.length, finiteInt(raw.entryCount, ledger.length)),
    lastWinDay: typeof raw.lastWinDay === 'string' ? raw.lastWinDay : null,
    ledger: ledger.slice(0, LEDGER_LIMIT),
    owedPacks: Array.isArray(raw.owedPacks) ? raw.owedPacks.filter(isPackTier) : [],
    pity: normalisePity(raw.pity),
  };
}

function normalisePity(value: unknown): Readonly<Partial<Record<PackTier, number>>> {
  if (value === null || typeof value !== 'object') return {};
  const out: Partial<Record<PackTier, number>> = {};
  for (const [tier, count] of Object.entries(value as Record<string, unknown>)) {
    if (!isPackTier(tier)) continue;
    const counted = finiteInt(count, 0);
    if (counted > 0) out[tier] = counted;
  }
  return out;
}
