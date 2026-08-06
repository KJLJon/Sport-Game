/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.7 — Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode,
 *          hidden
 * @story   US-8.1 — Unlock achievements as I play
 * @story   US-8.3 — Be rewarded for achievements
 * @design  05-data-model.md §6 (the difficulty, collection and economy rows), §5 (the economy),
 *          06-game-design.md §7 (the four levels)
 *
 * Purpose: the categories that are about the save rather than about a sport — difficulty, the
 * collection, the economy, and the two P2P ones.
 *
 * **The difficulty ones read `ctx.difficulty`, never a rating.** INV-1 says difficulty may not touch
 * an attribute; the mirror of that here is that an achievement about difficulty is about the level
 * the match was played at and nothing else, so "No Help Needed" checks the level and the assists and
 * asks nothing about who was playing.
 *
 * **Every economy achievement is about spending or collecting, never about earning coins.** An
 * achievement that paid coins for having coins would be a loop, and `05` §5.5 exists to keep the
 * economy closed. Selling and buying are sinks and moves; the balance is never a target.
 */
import { DIFFICULTIES } from '../../modes/difficulty.ts';
import { MetaKind } from '../types.ts';
import { def, detailNumber, detailString, onMeta, unaided, wonIt } from '../conditions.ts';
import type { AchievementDef } from '../types.ts';

/** A win at one level. `05` §6's "Step Up" is these four collected. */
function winAt(id: string, title: string, difficulty: string, coins: number): AchievementDef {
  return def({
    id,
    category: 'difficulty',
    title,
    description: `Win a match on ${difficulty}.`,
    reward: { coins },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event, ctx) => wonIt(event) && ctx.difficulty === difficulty,
    ),
  });
}

export const difficultyAchievements: readonly AchievementDef[] = [
  winAt('difficulty.rookie', 'Getting Started', 'rookie', 200),
  winAt('difficulty.pro', 'Turning Pro', 'pro', 300),
  winAt('difficulty.all-star', 'All-Star', 'allStar', 500),
  winAt('difficulty.legend', 'Legend', 'legend', 900),
  def({
    id: 'difficulty.step-up',
    category: 'difficulty',
    title: 'Step Up',
    description: 'Win one match on each difficulty.',
    // One shot, not four: the condition already asks "have you won on all of them", so a target of
    // four would mean four more wins *after* the fourth level fell. Found by the test that checks a
    // multi-step description names its own target.
    reward: { coins: 700, pack: 'silver' },
    // Counted from the history, like the cross-sport ones: `levelsWon` is computed when the event
    // is built, because a set of levels kept in a def would forget itself between sessions.
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event) => (detailNumber(event, 'levelsWon') ?? 0) >= DIFFICULTIES.length,
    ),
  }),
  def({
    id: 'difficulty.no-help-needed',
    category: 'difficulty',
    title: 'No Help Needed',
    description: 'Win on Legend with every assist disabled.',
    reward: { coins: 2000, pack: 'elite' },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event, ctx) => wonIt(event) && ctx.difficulty === 'legend' && unaided(ctx),
    ),
  }),
  def({
    id: 'difficulty.unaided-five',
    category: 'difficulty',
    title: 'On My Own',
    description: 'Win 5 matches with every assist disabled.',
    target: 5,
    reward: { coins: 900 },
    evaluate: onMeta(MetaKind.MATCH_FINISHED, (event, ctx) => wonIt(event) && unaided(ctx)),
  }),
  def({
    id: 'difficulty.tournament',
    category: 'difficulty',
    title: 'Champion',
    description: 'Win a tournament.',
    reward: { coins: 1500, pack: 'gold' },
    evaluate: onMeta(MetaKind.TOURNAMENT_WON),
  }),
];

export const collectionAchievements: readonly AchievementDef[] = [
  def({
    id: 'collection.scout',
    category: 'collection',
    title: 'Scout',
    description: 'Own 25 athletes.',
    reward: { coins: 400 },
    evaluate: onMeta(MetaKind.ROSTER_SIZE, (event) => (detailNumber(event, 'size') ?? 0) >= 25),
  }),
  def({
    id: 'collection.director',
    category: 'collection',
    title: 'Director of Football',
    description: 'Own 50 athletes.',
    reward: { coins: 900 },
    evaluate: onMeta(MetaKind.ROSTER_SIZE, (event) => (detailNumber(event, 'size') ?? 0) >= 50),
  }),
  def({
    id: 'collection.golden-ticket',
    category: 'collection',
    title: 'Golden Ticket',
    description: 'Pull a Legendary from a pack.',
    reward: { coins: 1000 },
    evaluate: onMeta(
      MetaKind.ATHLETE_ACQUIRED,
      (event) =>
        detailString(event, 'rarity') === 'legendary' && detailString(event, 'from') === 'pack',
    ),
  }),
  def({
    id: 'collection.epic-pull',
    category: 'collection',
    title: 'Worth the Wait',
    description: 'Pull an Epic from a pack.',
    reward: { coins: 500 },
    evaluate: onMeta(
      MetaKind.ATHLETE_ACQUIRED,
      (event) => detailString(event, 'rarity') === 'epic' && detailString(event, 'from') === 'pack',
    ),
  }),
  def({
    id: 'collection.first-pack',
    category: 'collection',
    title: 'Rip It Open',
    description: 'Open your first pack.',
    reward: { coins: 200 },
    evaluate: onMeta(MetaKind.PACK_OPENED),
  }),
  def({
    id: 'collection.ten-packs',
    category: 'collection',
    title: 'Collector',
    description: 'Open 10 packs.',
    target: 10,
    reward: { coins: 700 },
    evaluate: onMeta(MetaKind.PACK_OPENED),
  }),
  def({
    id: 'collection.elite-pack',
    category: 'collection',
    title: 'Big Spender',
    description: 'Open an Elite pack.',
    reward: { coins: 600 },
    evaluate: onMeta(MetaKind.PACK_OPENED, (event) => detailString(event, 'tier') === 'elite'),
  }),
  def({
    id: 'collection.hoarder',
    category: 'collection',
    title: 'Everybody In',
    description: 'Own 100 athletes.',
    reward: { coins: 1500, pack: 'gold' },
    evaluate: onMeta(MetaKind.ROSTER_SIZE, (event) => (detailNumber(event, 'size') ?? 0) >= 100),
  }),
];

export const economyAchievements: readonly AchievementDef[] = [
  def({
    id: 'economy.first-sale',
    category: 'economy',
    title: 'Moving On',
    description: 'Sell an athlete.',
    reward: { coins: 150 },
    evaluate: onMeta(MetaKind.ATHLETE_SOLD),
  }),
  def({
    id: 'economy.liquidation',
    category: 'economy',
    title: 'Liquidation',
    description: 'Sell 20 athletes.',
    target: 20,
    reward: { coins: 300 },
    evaluate: onMeta(MetaKind.ATHLETE_SOLD),
  }),
  def({
    id: 'economy.bargain-hunter',
    category: 'economy',
    title: 'Bargain Hunter',
    description: 'Buy a market listing below 95% of its value.',
    reward: { coins: 500 },
    evaluate: onMeta(
      MetaKind.MARKET_PURCHASE,
      (event) => (detailNumber(event, 'priceRatio') ?? 1) < 0.95,
    ),
  }),
  def({
    id: 'economy.market-regular',
    category: 'economy',
    title: 'Market Regular',
    description: 'Buy 10 athletes from the market.',
    target: 10,
    reward: { coins: 600 },
    evaluate: onMeta(MetaKind.MARKET_PURCHASE),
  }),
  def({
    id: 'economy.first-coins',
    category: 'economy',
    title: 'Paid',
    description: 'Finish a match on All-Star or above for the bigger payout.',
    reward: { coins: 250 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (_event, ctx) => ctx.difficulty === 'allStar' || ctx.difficulty === 'legend',
    ),
  }),
  def({
    id: 'economy.daily-habit',
    category: 'economy',
    title: 'Daily Habit',
    description: 'Take the first-win-of-the-day bonus 7 times.',
    target: 7,
    reward: { coins: 800 },
    evaluate: onMeta(MetaKind.MATCH_FINISHED, (event) => event.detail?.['firstWinToday'] === true),
  }),
  def({
    id: 'economy.arcade-cap',
    category: 'economy',
    title: 'Practice Makes Perfect',
    description: 'Finish 25 scored arcade runs.',
    target: 25,
    reward: { coins: 500 },
    evaluate: onMeta(MetaKind.ARCADE_RUN, (event) => (detailNumber(event, 'stars') ?? 0) >= 1),
  }),
  def({
    id: 'economy.three-stars',
    category: 'economy',
    title: 'Three Stars',
    description: 'Earn three stars in an arcade game.',
    reward: { coins: 400 },
    evaluate: onMeta(MetaKind.ARCADE_RUN, (event) => (detailNumber(event, 'stars') ?? 0) >= 3),
  }),
  def({
    id: 'economy.star-collector',
    category: 'economy',
    title: 'Star Collector',
    description: 'Earn three stars in an arcade game 5 times.',
    target: 5,
    reward: { coins: 1200, pack: 'silver' },
    evaluate: onMeta(MetaKind.ARCADE_RUN, (event) => (detailNumber(event, 'stars') ?? 0) >= 3),
  }),
];

export const p2pAchievements: readonly AchievementDef[] = [
  def({
    id: 'p2p.handshake',
    category: 'p2p',
    title: 'Handshake',
    description: 'Complete a peer-to-peer match.',
    reward: { coins: 800 },
    evaluate: onMeta(MetaKind.P2P_MATCH),
  }),
  def({
    id: 'p2p.fair-trade',
    category: 'p2p',
    title: 'Fair Trade',
    description: 'Complete a peer trade.',
    reward: { coins: 600 },
    evaluate: onMeta(MetaKind.P2P_TRADE),
  }),
];
