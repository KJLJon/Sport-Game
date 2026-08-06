/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set, 8 — Modes hub, progression, achievements
 * @task    T-4.3 — Arcade hub: grid, locked/unlocked states, personal bests, athlete picker
 * @task    T-8.8 — Arcade unlock wiring: achievements gate arcade games, with a clear unlock moment
 * @story   US-16.2 — Earn my mini-games
 * @design  09-modes-and-arcade.md §3.2 (everything is unlocked by playing, never by paying)
 * @invariant INV-3 (all storage through `src/storage/`)
 *
 * Purpose: whether a game is unlocked, and what a locked tile says instead.
 *
 * **The interim rule is over (T-8.8).** From T-4.3 until now `ACHIEVEMENTS_LANDED` was `false`:
 * nothing wrote an unlock, so locking every game would have made Gate 4's "a child can start one
 * unaided" unreachable, and the hub opened everything through one greppable boolean rather than a
 * quietly permissive check. T-8.6 and T-8.7 built the system and the ten defs; the flag is now
 * `true` and this module tells the truth. It is kept rather than deleted because it is the switch a
 * future sport's arcade set flips on itself, and because the shape of the shortcut is worth
 * remembering.
 */
import { requirementFor, type AchievementId } from '../../achievements/ids.ts';
import type { Database } from '../../storage/idb.ts';
import type { ArcadeGameDef } from './types.ts';

/**
 * True since T-8.8: achievements are evaluated, stored, and awarded, so a locked game is a game the
 * player has genuinely not earned yet — and every one of the ten is earnable by playing (`09` §3.2).
 */
export const ACHIEVEMENTS_LANDED = true;

/** The part of `achievements/types.ts`'s record this module needs. Narrow on purpose. */
export interface StoredUnlock {
  readonly id: AchievementId;
  readonly unlockedAt: number | null;
}

export interface UnlockState {
  readonly unlocked: boolean;
  /** What earns it, for a locked tile. Empty when the game is already unlocked. */
  readonly requirement: string;
}

export function unlockStateFor(
  game: ArcadeGameDef,
  unlocked: ReadonlySet<AchievementId>,
): UnlockState {
  if (!ACHIEVEMENTS_LANDED || unlocked.has(game.unlockAchievement)) {
    return { unlocked: true, requirement: '' };
  }
  return { unlocked: false, requirement: requirementFor(game.unlockAchievement) };
}

/**
 * Every achievement actually earned on this device.
 *
 * `unlockedAt === null` is a record with *progress* and no unlock — three of five steals, say — and
 * the store is full of them. Counting one as earned would open a game the player is still working
 * towards, which is the whole feature backwards.
 */
export async function earnedAchievements(db: Database): Promise<ReadonlySet<AchievementId>> {
  const records = await db.getAll<StoredUnlock>('achievements');
  return new Set(records.filter((record) => record.unlockedAt !== null).map((record) => record.id));
}

/**
 * The game an achievement unlocks, if it unlocks one — the other direction of `unlockAchievement`.
 *
 * This is what turns an unlock into a *moment* (T-8.8): the post-match panel can say "Free Throw
 * unlocked — you can practise this any time now" instead of leaving the player to notice a tile
 * that stopped being grey. `09` §3.2 asks for exactly that sentence.
 */
export function gameUnlockedBy(
  achievementId: AchievementId,
  games: readonly ArcadeGameDef[],
): ArcadeGameDef | undefined {
  return games.find((game) => game.unlockAchievement === achievementId);
}

/** Unlock state for a whole catalogue, keyed by game id — one read for the hub grid. */
export function unlockStates(
  games: readonly ArcadeGameDef[],
  unlocked: ReadonlySet<AchievementId>,
): ReadonlyMap<string, UnlockState> {
  return new Map(games.map((game) => [game.id, unlockStateFor(game, unlocked)]));
}
