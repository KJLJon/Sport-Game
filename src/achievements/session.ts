/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.6 — Achievement engine: declarative defs, event-stream evaluation, progress,
 *          once-only grants (INV-7)
 * @story   US-8.1 — Unlock achievements as I play
 * @story   US-8.3 — Be rewarded for achievements
 * @design  05-data-model.md §6, 06-game-design.md §4 (post-match summary)
 * @invariant INV-7 (once-only), INV-9 (one stream, no mode branch)
 *
 * Purpose: the one call a finished match makes. Read the records, run the stream through the defs,
 * write back what changed, pay what is owed.
 *
 * **One entry point, called identically by both modes.** Live and Playbook each hand over the same
 * three things — the event history, the meta event that says how the match ended, and a context —
 * and neither has any achievement logic of its own. A third mode joins by calling the same function.
 *
 * **Nothing here throws at a caller.** A match that was played is worth more than a record of it:
 * a failed write costs an unlock, and the next match will re-evaluate anything career-scoped from a
 * stored progress that simply did not advance. Losing the summary screen would cost the match.
 */
import type { AppDatabase } from '../storage/app-db.ts';
import type { SportEvent } from '../engine/match/events.ts';
import type { EntityId } from '../engine/world.ts';
import type { Athlete } from '../athletes/types.ts';
import { resultOf, type MatchRecord } from '../stats/types.ts';
import { DEFAULT_DIFFICULTY } from '../modes/difficulty.ts';
import { defaultAssists } from '../modes/assists.ts';
import type { SportId } from '../sports/types.ts';
import { PLAYABLE_SPORTS } from '../sports/playable.ts';
import { AchievementTracker } from './tracker.ts';
import { grantPending, type AchievementGrant } from './repository.ts';
import { ACHIEVEMENTS } from './registry.ts';
import {
  MetaKind,
  type AchievementDef,
  type AchievementUnlock,
  type MatchContext,
  type MetaEvent,
} from './types.ts';

export interface SettleAchievementsOptions {
  readonly db: AppDatabase;
  /** The match's own history, in order. */
  readonly events: readonly SportEvent[];
  /** What happened around it — the match record, a roster count, a pack that was opened. */
  readonly meta?: readonly MetaEvent[];
  readonly context: MatchContext;
  /** Overridden by tests and the balance harness; nothing in the app passes it. */
  readonly defs?: readonly AchievementDef[];
}

export interface AchievementSettlement {
  readonly unlocked: readonly AchievementUnlock[];
  readonly grants: readonly AchievementGrant[];
}

const NOTHING: AchievementSettlement = { unlocked: [], grants: [] };

/**
 * Evaluates a finished match and pays for whatever it unlocked.
 *
 * The meta events run *after* the match's own, because "finish your first match" is true once the
 * match is over and "score 30 with a soccer-primary athlete" is true during it. Ordering them the
 * other way would make a def that reads both see a finished match that had not happened yet.
 */
export async function settleAchievements(
  options: SettleAchievementsOptions,
): Promise<AchievementSettlement> {
  const defs = options.defs ?? ACHIEVEMENTS;
  if (defs.length === 0) return NOTHING;

  try {
    const { achievements, economy } = options.db;

    // Read, evaluate, and write as one queued step: two settlements racing would otherwise both
    // start from the same stored progress and the second would overwrite the first's.
    const unlocked = await achievements.run(async () => {
      const tracker = new AchievementTracker(defs, (await achievements.byId()).values());
      tracker.beginMatch();

      const found = [
        ...tracker.consumeAll(options.events, options.context),
        ...tracker.consumeAll(options.meta ?? [], options.context),
      ];

      await achievements.putMany(tracker.changed());
      return found;
    });
    // Paid after the records are written, so a crash in between leaves "unlocked, unpaid" — the
    // state `grantPending` is built to resolve — rather than "paid, not recorded" (INV-7).
    const grants = await grantPending(achievements, economy, defs, options.context.at);

    return { unlocked, grants };
  } catch {
    return NOTHING;
  }
}

/**
 * Pays anything left unpaid from a previous run. Called at bootstrap.
 *
 * This is the half of INV-7 that only exists because the app can be killed: an unlock written to
 * disk whose coins were never credited is money the player earned and did not get, and without this
 * call it would sit there forever.
 */
export async function grantOutstanding(
  db: AppDatabase,
  defs: readonly AchievementDef[] = ACHIEVEMENTS,
): Promise<AchievementGrant[]> {
  try {
    return await grantPending(db.achievements, db.economy, defs);
  } catch {
    return [];
  }
}

/**
 * The meta events a finished match produces.
 *
 * Built from the `MatchRecord` rather than from the match object, for the same reason the payout is
 * (T-8.10): the record is the one thing both modes produce identically, so an achievement cannot
 * accidentally depend on how the match was played (INV-9).
 *
 * `SPORT_PLAYED` is emitted once per athlete who appeared, which is what "play the same athlete in
 * every available sport" counts. It carries the athlete and the sport and nothing else — the def
 * decides what to do with the pair.
 */
/**
 * How much history the career-shaped achievements are computed against.
 *
 * The whole store would be correct and would also mean reading five hundred records at the end of
 * every match. Two hundred is far more than any of these thresholds needs — "win on each of four
 * difficulties" is answered by the four most recent wins of each kind — and it is bounded work.
 */
export const HISTORY_FOR_ACHIEVEMENTS = 200;

export interface MatchMetaOptions {
  /** Every match already filed, so career facts are computed where the career is known. */
  readonly history?: readonly MatchRecord[];
  /** Whether the wallet paid the first-win-of-the-day bonus for this match (T-8.10). */
  readonly firstWinToday?: boolean;
}

export function matchMetaEvents(record: MatchRecord, options: MatchMetaOptions = {}): MetaEvent[] {
  const history = options.history ?? [];
  const result = resultOf(record);
  const side = record.playerSide === 1 ? 1 : 0;
  const mine = record.score[side];
  const theirs = record.score[side === 0 ? 1 : 0];

  const past = history.filter((entry) => entry.id !== record.id);
  const sportsWon = new Set<SportId>();
  const levelsWon = new Set<string>();
  for (const entry of past) {
    if (resultOf(entry) !== 'win') continue;
    sportsWon.add(entry.sportId);
    levelsWon.add(entry.difficulty);
  }
  if (result === 'win') {
    sportsWon.add(record.sportId);
    levelsWon.add(record.difficulty);
  }

  const events: MetaEvent[] = [
    {
      kind: MetaKind.MATCH_FINISHED,
      at: record.playedAt,
      detail: {
        // `null` is not a detail value, and a spectated match is not a result. It says so.
        result: result ?? 'none',
        sport: record.sportId,
        difficulty: record.difficulty,
        myScore: mine,
        theirScore: theirs,
        margin: mine - theirs,
        periods: record.periodsPlayed,
        /**
         * How many *different* sports the player has now won in.
         *
         * Computed here, from the history, rather than counted by a def. A def sees one event and
         * has nowhere to keep a set of sports, and a set kept in a closure would forget itself on
         * the next reload — a player who wins at basketball today and soccer tomorrow would never
         * be credited. Career facts belong to whoever holds the career.
         */
        sportsWon: sportsWon.size,
        /** How many different difficulties the player has now won on — `05` §6's "Step Up". */
        levelsWon: levelsWon.size,
        firstWinToday: options.firstWinToday === true,
      },
    },
  ];

  const seen = new Set<string>();
  for (const line of record.lines) {
    if (line.athleteId === null || line.side !== record.playerSide) continue;
    if (seen.has(line.athleteId)) continue;
    seen.add(line.athleteId);

    const played = new Set<SportId>([record.sportId]);
    const scoredIn = new Set<SportId>(line.points > 0 ? [record.sportId] : []);
    for (const entry of past) {
      for (const past_line of entry.lines) {
        if (past_line.athleteId !== line.athleteId) continue;
        played.add(entry.sportId);
        if (past_line.points > 0) scoredIn.add(entry.sportId);
      }
    }

    events.push({
      kind: MetaKind.SPORT_PLAYED,
      at: record.playedAt,
      athleteId: line.athleteId,
      detail: {
        sport: record.sportId,
        points: line.points,
        sportsPlayed: played.size,
        scoringSports: scoredIn.size,
        everySport: played.size >= PLAYABLE_SPORTS.length,
      },
    });
  }

  return events;
}

/**
 * An entity → athlete lookup for the eval context, from the lineup the sport exposes and the
 * rosters the match was given. Returns a function that answers `undefined` for a match played by
 * rolled athletes, which is the correct answer rather than a missing one.
 */
export function entityAthletes(
  lineup: ReadonlyMap<EntityId, string> | undefined,
  rosters: readonly (readonly Athlete[])[] | undefined,
): (entity: EntityId) => Athlete | undefined {
  if (lineup === undefined || rosters === undefined) return () => undefined;

  const byId = new Map<string, Athlete>();
  for (const roster of rosters) for (const athlete of roster) byId.set(athlete.id, athlete);

  return (entity) => {
    const id = lineup.get(entity);
    return id === undefined ? undefined : byId.get(id);
  };
}

/**
 * An eval context for something that happened outside a match — an athlete created, a pack opened.
 *
 * The fields a match supplies are given their "no match" values rather than being made optional: a
 * def that reads `playerSide` outside a match gets `-1`, which every combinator in `conditions.ts`
 * already treats as "not the player's", so a match-shaped def cannot fire on a meta event by
 * accident.
 */
export function outsideMatch(at: number = Date.now(), sport: SportId = 'basketball'): MatchContext {
  return {
    at,
    sport,
    difficulty: DEFAULT_DIFFICULTY,
    playerSide: -1,
    assists: defaultAssists(DEFAULT_DIFFICULTY),
    athleteOf: () => undefined,
  };
}

/**
 * Files meta events that did not come from a match, and pays for whatever they unlocked.
 *
 * The same path as `settleAchievements` — same tracker, same grant — so "create your first athlete"
 * and "win on Legend" are the same kind of thing with the same once-only guarantee.
 */
export async function recordMetaEvents(
  db: AppDatabase,
  events: readonly MetaEvent[],
  defs?: readonly AchievementDef[],
): Promise<AchievementSettlement> {
  if (events.length === 0) return NOTHING;
  return settleAchievements({
    db,
    events: [],
    meta: events,
    context: outsideMatch(events[0]?.at),
    ...(defs === undefined ? {} : { defs }),
  });
}
