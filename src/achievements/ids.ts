/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.1 — Arcade framework: `ArcadeGameDef`, host, session lifecycle, scoring, star ratings
 * @story   US-16.2 — Earn my mini-games
 * @design  09-modes-and-arcade.md §3.2 (the launch set and what unlocks each game)
 *
 * Purpose: the achievement identifiers arcade unlocks refer to, and the plain-language description
 * of each one. The achievement *system* — evaluation against the event stream, storage, and the
 * unlock ceremony — is Phase 8; what Phase 4 needs is the vocabulary, so that a game definition can
 * name its unlock and a locked tile can say what earns it (US-16.2).
 *
 * Every entry here is earned by **playing**. There is no id whose condition involves a purchase, and
 * `09` §3.2 is explicit that there never will be.
 */

export type AchievementId = string;

/** What a locked arcade tile shows: the condition, in the words the player will see. */
export interface AchievementSummary {
  readonly id: AchievementId;
  /** Imperative, short, and checkable — "Make a free throw in any mode". */
  readonly requirement: string;
  /**
   * The game this opens, by display name (T-8.8).
   *
   * Here rather than looked up from the catalogue because the unlock *moment* — "Free Throw
   * unlocked — you can practise this any time now" — is shown on a post-match screen that has no
   * business loading two sport modules to find out what it just gave you. `09` §3.2 pairs the game
   * and the achievement in one table anyway, and a test asserts these names match the real defs.
   */
  readonly game: string;
}

/**
 * The ten arcade unlocks from `09` §3.2. Soccer's five are declared now even though its games
 * arrive in Phase 6: the ids are part of the spec's table, and declaring them together keeps the
 * table readable as a table.
 */
export const ARCADE_UNLOCKS = {
  freeThrowMade: {
    id: 'bball.free-throw-made',
    requirement: 'Make a free throw in any mode',
    game: 'Free Throw',
  },
  threeThrees: {
    id: 'bball.three-threes',
    requirement: 'Make 3 three-pointers in one match',
    game: 'Three-Point Contest',
  },
  closeWin: {
    id: 'bball.close-win',
    requirement: 'Win a match by 3 points or fewer',
    game: 'Buzzer Beater',
  },
  fastBreakPoints: {
    id: 'bball.fast-break-10',
    requirement: 'Score 10 fast-break points',
    game: 'Fast Break',
  },
  fiveSteals: {
    id: 'bball.five-steals',
    requirement: 'Record 5 steals',
    game: 'Pickpocket',
  },
  penaltyScored: {
    id: 'soccer.penalty-scored',
    requirement: 'Score a penalty',
    game: 'Penalty Shootout',
  },
  allStarWin: {
    id: 'soccer.all-star-win',
    requirement: 'Win a match on All-Star or above',
    game: 'Free Kick',
  },
  twentyGoals: {
    id: 'soccer.career-20-goals',
    requirement: 'Score 20 career goals',
    game: 'One-on-One',
  },
  headerScored: {
    id: 'soccer.header-scored',
    requirement: 'Score a header',
    game: 'Header',
  },
  cleanSheet: {
    id: 'soccer.clean-sheet',
    requirement: 'Keep a clean sheet',
    game: 'Last Line',
  },
} as const satisfies Readonly<Record<string, AchievementSummary>>;

export type ArcadeUnlockKey = keyof typeof ARCADE_UNLOCKS;

/** Every arcade unlock, keyed by id — what the hub looks a locked tile up in. */
export const ARCADE_UNLOCKS_BY_ID: ReadonlyMap<AchievementId, AchievementSummary> = new Map(
  Object.values(ARCADE_UNLOCKS).map((entry) => [entry.id, entry]),
);

/**
 * What earns an achievement, in the words a locked tile shows. Unknown ids get an honest fallback
 * rather than an empty string — a tile that says nothing is worse than one that says "keep playing".
 */
export function requirementFor(id: AchievementId): string {
  return ARCADE_UNLOCKS_BY_ID.get(id)?.requirement ?? 'Keep playing to unlock this';
}

/** The arcade game an achievement opens, or `undefined` when it opens none (T-8.8). */
export function unlocksGame(id: AchievementId): string | undefined {
  return ARCADE_UNLOCKS_BY_ID.get(id)?.game;
}
