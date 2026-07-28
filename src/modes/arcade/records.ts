/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.4 — Practice / scored / daily modes; seeded daily challenge
 * @task    T-4.3 — Arcade hub: grid, locked/unlocked states, personal bests
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.4 — Take a daily challenge
 * @design  09-modes-and-arcade.md §3.3 (personal bests per athlete and overall), 05-data-model.md §1
 * @invariant INV-3 (all storage through `src/storage/`), INV-10 (a record is never a sim input)
 *
 * Purpose: what arcade remembers — a personal best per game per athlete, an overall best per game,
 * and what happened on a given day. The hub reads it, the daily card reads it, and T-4.13's reward
 * caps read it.
 *
 * **Nothing here is ever read by calibration.** These records exist to be *shown*, and the one place
 * that would be tempted to use them — the difficulty window — is forbidden from importing this
 * module by the INV-10 invariant test. A personal best that fed back into difficulty is precisely
 * the rubber-banding `09` §2.4 rules out.
 *
 * The pure half is separated from the stored half deliberately: "is this a new best" is a rule worth
 * testing without a database, and the repository is then thin enough to read in one go.
 */
import type { Database } from '../../storage/idb.ts';
import { starsFor } from './scoring.ts';
import type { ArcadeGameId, ArcadeResult, StarCount } from './types.ts';

/** The key an overall (any-athlete) best is stored under. Not a legal athlete id, deliberately. */
export const ANY_ATHLETE = '*';

export interface ArcadeBest {
  readonly kind: 'best';
  /** `best:<game>:<athlete>`; the athlete is `*` for the overall record. */
  readonly id: string;
  readonly game: ArcadeGameId;
  readonly athleteId: string;
  readonly score: number;
  readonly stars: StarCount;
  /** How many scored runs have gone into this record. Practice runs are not counted. */
  readonly runs: number;
  readonly bestStreak: number;
  readonly updatedAt: number;
}

/** What a day of arcade play added up to — the input to the reward caps (T-4.13). */
export interface ArcadeDay {
  readonly kind: 'day';
  /** `day:<YYYY-MM-DD>`. */
  readonly id: string;
  readonly day: string;
  /** Games that have paid out their first three-star of the day. */
  readonly paidGames: readonly ArcadeGameId[];
  /** Coins granted today across all arcade games. */
  readonly coins: number;
  /** Scored runs today, per game — the diminishing-returns input. */
  readonly runs: Readonly<Record<ArcadeGameId, number>>;
  /** The daily challenge's best score today, or `null` if it has not been played. */
  readonly dailyScore: number | null;
}

export type ArcadeRecord = ArcadeBest | ArcadeDay;

export function bestKey(game: ArcadeGameId, athleteId: string): string {
  return `best:${game}:${athleteId}`;
}

export function dayKey(day: string): string {
  return `day:${day}`;
}

/** A day with nothing in it yet. Returned rather than `undefined`, so callers never branch on it. */
export function emptyDay(day: string): ArcadeDay {
  return { kind: 'day', id: dayKey(day), day, paidGames: [], coins: 0, runs: {}, dailyScore: null };
}

export interface BestUpdate {
  readonly best: ArcadeBest;
  /** True when this run beat what was there — what the "new personal best!" banner reads. */
  readonly improved: boolean;
}

/**
 * The personal best after a run. A run always increments `runs`, and only a higher score replaces
 * the record — equalling a best is not beating it, and telling someone it is cheapens the banner.
 */
export function improveBest(
  previous: ArcadeBest | undefined,
  result: ArcadeResult,
  athleteId: string,
  thresholds: readonly [number, number, number],
  now: number,
): BestUpdate {
  const improved = previous === undefined || result.score > previous.score;
  const score = improved ? result.score : previous.score;

  return {
    improved,
    best: {
      kind: 'best',
      id: bestKey(result.game, athleteId),
      game: result.game,
      athleteId,
      score,
      stars: starsFor(score, thresholds),
      runs: (previous?.runs ?? 0) + 1,
      bestStreak: Math.max(previous?.bestStreak ?? 0, result.bestStreak),
      updatedAt: now,
    },
  };
}

/**
 * Arcade's slice of the database. Practice runs are not recorded at all — `09` §3.3 makes practice
 * unlimited and unrewarded, and a personal best set in practice would make the scored-run record
 * meaningless.
 */
export class ArcadeRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async best(game: ArcadeGameId, athleteId: string): Promise<ArcadeBest | undefined> {
    return this.db.get<ArcadeBest>('arcade', bestKey(game, athleteId));
  }

  /** The best anyone has managed at this game on this device. */
  async overallBest(game: ArcadeGameId): Promise<ArcadeBest | undefined> {
    return this.best(game, ANY_ATHLETE);
  }

  /** Every best for a game, athlete records only, highest first — the hub's leaderboard. */
  async bestsForGame(game: ArcadeGameId): Promise<readonly ArcadeBest[]> {
    const all = await this.db.getAll<ArcadeRecord>('arcade');
    return all
      .filter(
        (record): record is ArcadeBest =>
          record.kind === 'best' && record.game === game && record.athleteId !== ANY_ATHLETE,
      )
      .sort((a, b) => b.score - a.score);
  }

  /** Every game's overall best, keyed by game — one read for the whole hub grid. */
  async overallBests(): Promise<ReadonlyMap<ArcadeGameId, ArcadeBest>> {
    const all = await this.db.getAll<ArcadeRecord>('arcade');
    const out = new Map<ArcadeGameId, ArcadeBest>();
    for (const record of all) {
      if (record.kind === 'best' && record.athleteId === ANY_ATHLETE) out.set(record.game, record);
    }
    return out;
  }

  /**
   * Files a finished run: the athlete's own best and the overall best, both updated in one
   * transaction so a crash between them cannot leave the two disagreeing.
   */
  async recordRun(
    result: ArcadeResult,
    thresholds: readonly [number, number, number],
    now = Date.now(),
  ): Promise<BestUpdate | null> {
    if (!result.rewarded) return null;

    const [mine, overall] = await Promise.all([
      this.best(result.game, result.athleteId),
      this.overallBest(result.game),
    ]);

    const update = improveBest(mine, result, result.athleteId, thresholds, now);
    const overallUpdate = improveBest(overall, result, ANY_ATHLETE, thresholds, now);

    await this.db.putMany('arcade', [{ value: update.best }, { value: overallUpdate.best }]);
    return update;
  }

  async day(day: string): Promise<ArcadeDay> {
    return (await this.db.get<ArcadeDay>('arcade', dayKey(day))) ?? emptyDay(day);
  }

  async putDay(record: ArcadeDay): Promise<void> {
    await this.db.put('arcade', record);
  }

  /** Clears arcade history. Used by erase-all-data; never by an update. */
  async clear(): Promise<void> {
    await this.db.clear('arcade');
  }
}
