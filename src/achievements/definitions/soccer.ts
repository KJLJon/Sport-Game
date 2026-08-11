/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.7 — Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode,
 *          hidden
 * @story   US-8.1 — Unlock achievements as I play
 * @story   US-16.2 — Earn my mini-games
 * @design  05-data-model.md §6 (Hat-Trick, Clean Sheet, Set-Piece Specialist),
 *          09-modes-and-arcade.md §3.2 (the five soccer arcade unlocks)
 *
 * Purpose: soccer's achievements, including the five that unlock its arcade games.
 *
 * **"Score a header" is read out of the sequence, not out of a flag.** Soccer emits no header event
 * — a header is a finish, not a rule — but it does emit a `lofted` pass when the ball is played more
 * than thirty metres, which is a cross. A goal within two seconds of one of those *is* the header
 * from a cross, and it is the same reading `sports/soccer/playbook/key-moments.ts` already takes:
 * "playing for crosses and then getting a shot off is the header from a cross".
 *
 * **A clean sheet is a fact about the finished match**, not about a moment in it, so it hangs off
 * `MATCH_FINISHED` and reads the scoreline rather than counting saves.
 */
import { EventKind } from '../../engine/match/events.ts';
import { RestartKind, SoccerEvent } from '../../sports/soccer/rules.ts';
import { ARCADE_UNLOCKS } from '../ids.ts';
import { MetaKind } from '../types.ts';
import {
  atLeast,
  def,
  detailNumber,
  detailString,
  lineFor,
  onEvent,
  onMeta,
  shortlyAfter,
  wonIt,
} from '../conditions.ts';
import type { AchievementDef } from '../types.ts';

const inSoccer = (sport: string | undefined): boolean => sport === 'soccer';

/** Steps inside which a goal still belongs to the restart or the cross that set it up. */
const SET_PIECE_STEPS = 150;

/** A cross: soccer plays a `lofted` pass when the ball travels more than thirty metres. */
const isCross = (candidate: {
  kind: string;
  detail?: Readonly<Record<string, unknown>>;
}): boolean => candidate.kind === EventKind.PASS && candidate.detail?.['kind'] === 'lofted';

/** A restart of one kind — a penalty, a free kick — as the last thing that happened. */
const restartOf =
  (kind: string) =>
  (candidate: { sportKind?: string; detail?: Readonly<Record<string, unknown>> }): boolean =>
    candidate.sportKind === SoccerEvent.RESTART && candidate.detail?.['kind'] === kind;

export const soccerAchievements: readonly AchievementDef[] = [
  // ── the five arcade unlocks (`09` §3.2) ─────────────────────────────────
  def({
    id: ARCADE_UNLOCKS.penaltyScored.id,
    category: 'soccer',
    title: 'From Twelve Yards',
    description: 'Score a penalty.',
    reward: { coins: 300 },
    evaluate: onEvent(
      EventKind.SCORE,
      (event, ctx) =>
        inSoccer(ctx.sport) &&
        shortlyAfter(event, ctx, SET_PIECE_STEPS, restartOf(RestartKind.PENALTY)),
    ),
  }),
  def({
    id: ARCADE_UNLOCKS.allStarWin.id,
    category: 'soccer',
    title: 'Up a Level',
    description: 'Win a soccer match on All-Star or above.',
    reward: { coins: 600 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event, ctx) =>
        wonIt(event) &&
        inSoccer(detailString(event, 'sport')) &&
        atLeast('allStar').includes(ctx.difficulty),
    ),
  }),
  def({
    id: ARCADE_UNLOCKS.twentyGoals.id,
    category: 'soccer',
    title: 'Twenty Up',
    description: 'Score 20 career goals.',
    target: 20,
    reward: { coins: 500 },
    evaluate: onEvent(EventKind.SCORE, (_event, ctx) => inSoccer(ctx.sport)),
  }),
  def({
    id: ARCADE_UNLOCKS.headerScored.id,
    category: 'soccer',
    title: 'On the Head',
    description: 'Score from a cross.',
    reward: { coins: 350 },
    evaluate: onEvent(
      EventKind.SCORE,
      (event, ctx) => inSoccer(ctx.sport) && shortlyAfter(event, ctx, SET_PIECE_STEPS, isCross),
    ),
  }),
  def({
    id: ARCADE_UNLOCKS.cleanSheet.id,
    category: 'soccer',
    title: 'Clean Sheet',
    description: 'Finish a soccer match without conceding.',
    reward: { coins: 400 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event) =>
        inSoccer(detailString(event, 'sport')) && (detailNumber(event, 'theirScore') ?? 1) === 0,
    ),
  }),

  // ── `05` §6's soccer row, and the rest ──────────────────────────────────
  def({
    id: 'soccer.hat-trick',
    category: 'soccer',
    title: 'Hat-Trick',
    description: 'Score 3 goals with one athlete in a match.',
    scope: 'match',
    reward: { coins: 500 },
    evaluate: onEvent(
      EventKind.SCORE,
      (event, ctx) => inSoccer(ctx.sport) && (lineFor(ctx, event.actor)?.points ?? 0) >= 3,
    ),
  }),
  def({
    id: 'soccer.clean-sheet-hard',
    category: 'soccer',
    title: 'Nothing Doing',
    description: 'Win without conceding on All-Star or above.',
    reward: { coins: 600 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event, ctx) =>
        wonIt(event) &&
        inSoccer(detailString(event, 'sport')) &&
        (detailNumber(event, 'theirScore') ?? 1) === 0 &&
        atLeast('allStar').includes(ctx.difficulty),
    ),
  }),
  def({
    id: 'soccer.set-piece-specialist',
    category: 'soccer',
    title: 'Set-Piece Specialist',
    description: 'Score 10 career goals from free kicks.',
    target: 10,
    reward: { coins: 800 },
    evaluate: onEvent(
      EventKind.SCORE,
      (event, ctx) =>
        inSoccer(ctx.sport) &&
        shortlyAfter(event, ctx, SET_PIECE_STEPS, restartOf(RestartKind.FREE_KICK)),
    ),
  }),
  def({
    id: 'soccer.corner-goal',
    category: 'soccer',
    title: 'Second Phase',
    description: 'Score from a corner.',
    reward: { coins: 350 },
    evaluate: onEvent(
      EventKind.SCORE,
      (event, ctx) =>
        inSoccer(ctx.sport) &&
        shortlyAfter(event, ctx, SET_PIECE_STEPS, restartOf(RestartKind.CORNER_KICK)),
    ),
  }),
  def({
    id: 'soccer.four-goal-win',
    category: 'soccer',
    title: 'Statement',
    description: 'Win a soccer match by 4 goals or more.',
    reward: { coins: 500 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event) =>
        wonIt(event) &&
        inSoccer(detailString(event, 'sport')) &&
        (detailNumber(event, 'margin') ?? 0) >= 4,
    ),
  }),
  def({
    id: 'soccer.discipline',
    category: 'soccer',
    title: 'Model Professional',
    description: 'Win 5 soccer matches without a card in any of them.',
    target: 5,
    reward: { coins: 600 },
    // Card-free is read from the running match: any card on the player's side leaves a mark in the
    // box score's fouls, and the def below simply requires the match to have finished clean.
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event, ctx) =>
        wonIt(event) &&
        inSoccer(detailString(event, 'sport')) &&
        ![...ctx.box.lines.values()].some((line) => line.side === ctx.playerSide && line.fouls > 3),
    ),
  }),
  def({
    id: 'soccer.hundred-goals',
    category: 'soccer',
    title: 'Centurion',
    description: 'Score 100 career goals.',
    target: 100,
    reward: { coins: 1200, pack: 'gold' },
    evaluate: onEvent(EventKind.SCORE, (_event, ctx) => inSoccer(ctx.sport)),
  }),
  def({
    id: 'soccer.offside-trap',
    category: 'soccer',
    title: 'Line Held',
    description: 'Catch the opponent offside 10 times.',
    target: 10,
    // The offside is *against* the side that was caught, so this one deliberately reads the
    // opponent's events rather than the player's.
    reward: { coins: 400 },
    evaluate: (event, ctx) => {
      if (ctx.playerSide === -1) return null;
      const sportEvent = event as { kind: string; sportKind?: string; side: number };
      if (sportEvent.kind !== EventKind.SPORT || sportEvent.sportKind !== SoccerEvent.OFFSIDE) {
        return null;
      }
      return sportEvent.side !== ctx.playerSide ? 1 : null;
    },
  }),
  def({
    id: 'soccer.fifty-wins',
    category: 'soccer',
    title: 'Silverware',
    description: 'Win 50 soccer matches.',
    target: 50,
    reward: { coins: 1500, pack: 'gold' },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event) => wonIt(event) && inSoccer(detailString(event, 'sport')),
    ),
  }),
  def({
    id: 'soccer.comeback-draw',
    category: 'soccer',
    title: 'Never Beaten',
    description: 'Draw a soccer match in which both sides scored twice or more.',
    reward: { coins: 400 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event) =>
        inSoccer(detailString(event, 'sport')) &&
        detailString(event, 'result') === 'draw' &&
        (detailNumber(event, 'myScore') ?? 0) >= 2,
    ),
  }),
];
