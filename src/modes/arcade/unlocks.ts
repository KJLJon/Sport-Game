/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.3 — Arcade hub: grid, locked/unlocked states, personal bests, athlete picker
 * @story   US-16.2 — Earn my mini-games
 * @design  09-modes-and-arcade.md §3.2 (everything is unlocked by playing, never by paying)
 * @invariant INV-3 (all storage through `src/storage/`)
 *
 * Purpose: whether a game is unlocked, and what a locked tile says instead.
 *
 * **The interim rule, and why it is a named constant.** The achievement *system* — evaluation
 * against the event stream, the store, the unlock ceremony — is Phase 8 (T-8.6/T-8.7). Until it
 * lands nothing ever writes an unlock, so an honest implementation would lock all five games
 * permanently and Gate 4's "a child can start one unaided" would be unreachable. The gate is the
 * point of the phase, so until the system exists the hub opens everything, and it does so through
 * one greppable boolean rather than through a quietly permissive check. Phase 8 flips
 * `ACHIEVEMENTS_LANDED` to `true` and this module starts telling the truth with no other change.
 */
import { requirementFor, type AchievementId } from '../../achievements/ids.ts';
import type { Database } from '../../storage/idb.ts';
import type { ArcadeGameDef } from './types.ts';

/**
 * Flipped to `true` by T-8.6, when something actually writes to the `achievements` store. Until
 * then every arcade game is available, because a hub of five permanently locked tiles is worse than
 * an honest temporary shortcut.
 */
export const ACHIEVEMENTS_LANDED = false;

/** One unlocked achievement, as Phase 8 will store it. Declared here so the read has a shape. */
export interface AchievementRecord {
  readonly id: AchievementId;
  readonly unlockedAt: number;
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

/** Every achievement earned on this device. Empty until Phase 8 starts writing them. */
export async function earnedAchievements(db: Database): Promise<ReadonlySet<AchievementId>> {
  const records = await db.getAll<AchievementRecord>('achievements');
  return new Set(records.map((record) => record.id));
}

/** Unlock state for a whole catalogue, keyed by game id — one read for the hub grid. */
export function unlockStates(
  games: readonly ArcadeGameDef[],
  unlocked: ReadonlySet<AchievementId>,
): ReadonlyMap<string, UnlockState> {
  return new Map(games.map((game) => [game.id, unlockStateFor(game, unlocked)]));
}
