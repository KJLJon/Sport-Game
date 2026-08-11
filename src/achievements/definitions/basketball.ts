/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.7 — Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode,
 *          hidden
 * @story   US-8.1 — Unlock achievements as I play
 * @story   US-16.2 — Earn my mini-games
 * @design  05-data-model.md §6 (Downtown, Glass Cleaner, Perfect Line),
 *          09-modes-and-arcade.md §3.2 (the five basketball arcade unlocks)
 *
 * Purpose: basketball's achievements, including the five that unlock its arcade games.
 *
 * **The five arcade ids are load-bearing.** `modes/arcade/registry.ts` gates each game on an id from
 * `achievements/ids.ts`, and the requirement text a locked tile shows lives there too. So these defs
 * must use exactly those ids and must mean exactly what the tile says — a def that says something
 * different from the tile is a game the player cannot work out how to unlock. There is a test.
 *
 * **"Fast-break points" and the sequence window.** `09` §3.2 asks for ten of them, and the sim emits
 * no such event: a fast break is not a *thing* the rules produce, it is points scored moments after
 * winning the ball back. That is exactly what `shortlyAfter` reads out of the stream — a basket
 * within three seconds of the player's own steal or defensive rebound — so the achievement is
 * honest without the sport having to learn a new vocabulary for it.
 */
import { EventKind } from '../../engine/match/events.ts';
import { BasketballEvent } from '../../sports/basketball/rules.ts';
import { ARCADE_UNLOCKS } from '../ids.ts';
import { MetaKind } from '../types.ts';
import {
  TRANSITION_STEPS,
  atLeast,
  def,
  detailNumber,
  detailString,
  lineFor,
  myTeam,
  onEvent,
  onMeta,
  onSportEvent,
  shortlyAfter,
  wonIt,
} from '../conditions.ts';
import type { AchievementDef } from '../types.ts';

/** A match event that belongs to basketball, so a soccer goal never counts towards one of these. */
const inBasketball = (sport: string | undefined): boolean => sport === 'basketball';

export const basketballAchievements: readonly AchievementDef[] = [
  // ── the five arcade unlocks (`09` §3.2) ─────────────────────────────────
  def({
    id: ARCADE_UNLOCKS.freeThrowMade.id,
    category: 'basketball',
    title: 'From the Line',
    description: 'Make a free throw in any mode.',
    reward: { coins: 150 },
    evaluate: onEvent(
      EventKind.SCORE,
      (event, ctx) => event.value === 1 && inBasketball(ctx.sport),
    ),
  }),
  def({
    id: ARCADE_UNLOCKS.threeThrees.id,
    category: 'basketball',
    title: 'Downtown',
    description: 'Make 3 three-pointers in one match.',
    target: 3,
    scope: 'match',
    reward: { coins: 400 },
    evaluate: onEvent(
      EventKind.SCORE,
      (event, ctx) => event.value === 3 && inBasketball(ctx.sport),
    ),
  }),
  def({
    id: ARCADE_UNLOCKS.closeWin.id,
    category: 'basketball',
    title: 'Nail-Biter',
    description: 'Win a basketball match by 3 points or fewer.',
    reward: { coins: 400 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event) =>
        wonIt(event) &&
        inBasketball(detailString(event, 'sport')) &&
        (detailNumber(event, 'margin') ?? 99) <= 3,
    ),
  }),
  def({
    id: ARCADE_UNLOCKS.fastBreakPoints.id,
    category: 'basketball',
    title: 'Out in Transition',
    description: 'Score 10 fast-break points.',
    target: 10,
    reward: { coins: 400 },
    evaluate: onEvent(
      EventKind.SCORE,
      (event, ctx) =>
        inBasketball(ctx.sport) &&
        shortlyAfter(
          event,
          ctx,
          TRANSITION_STEPS,
          (candidate) =>
            candidate.sportKind === BasketballEvent.STEAL ||
            (candidate.kind === EventKind.REBOUND && candidate.detail?.['kind'] !== 'offensive'),
        ),
      (event) => event.value ?? 2,
    ),
  }),
  def({
    id: ARCADE_UNLOCKS.fiveSteals.id,
    category: 'basketball',
    title: 'Quick Hands',
    description: 'Record 5 steals.',
    target: 5,
    reward: { coins: 350 },
    evaluate: onSportEvent(BasketballEvent.STEAL),
  }),

  // ── `05` §6's basketball row, and the rest ──────────────────────────────
  def({
    id: 'bball.glass-cleaner',
    category: 'basketball',
    title: 'Glass Cleaner',
    description: 'Grab 20 rebounds with one athlete in a match.',
    scope: 'match',
    reward: { coins: 500 },
    evaluate: onEvent(
      EventKind.REBOUND,
      (event, ctx) => (lineFor(ctx, event.actor)?.rebounds ?? 0) >= 20,
    ),
  }),
  def({
    id: 'bball.perfect-line',
    category: 'basketball',
    title: 'Perfect Line',
    description: 'Make 10 free throws in a match without missing one.',
    scope: 'match',
    reward: { coins: 600 },
    evaluate: onEvent(EventKind.SCORE, (event, ctx) => {
      if (event.value !== 1) return false;
      const line = lineFor(ctx, event.actor);
      return (
        line !== undefined &&
        line.freeThrowsMade >= 10 &&
        line.freeThrowsAttempted === line.freeThrowsMade
      );
    }),
  }),
  def({
    id: 'bball.thirty-point-game',
    category: 'basketball',
    title: 'Thirty Burger',
    description: 'Score 30 points with one athlete in a match.',
    scope: 'match',
    reward: { coins: 500 },
    evaluate: onEvent(
      EventKind.SCORE,
      (event, ctx) => (lineFor(ctx, event.actor)?.points ?? 0) >= 30,
    ),
  }),
  def({
    id: 'bball.double-double',
    category: 'basketball',
    title: 'Double-Double',
    description: 'Reach double figures in two categories with one athlete in a match.',
    scope: 'match',
    reward: { coins: 450 },
    evaluate: (event, ctx) => {
      if (typeof (event as { actor?: number }).actor !== 'number') return null;
      const line = lineFor(ctx, (event as { actor?: number }).actor);
      if (line === undefined) return null;
      const tens = [line.points, line.rebounds, line.assists, line.steals, line.blocks].filter(
        (value) => value >= 10,
      ).length;
      return tens >= 2 ? 1 : null;
    },
  }),
  def({
    id: 'bball.dime-dropper',
    category: 'basketball',
    title: 'Dime Dropper',
    description: 'Record 10 assists with one athlete in a match.',
    scope: 'match',
    reward: { coins: 450 },
    evaluate: onEvent(EventKind.SCORE, (_event, ctx) => {
      // An assist is credited to the passer when the basket lands, so the basket is the event that
      // can see the tenth one.
      for (const line of ctx.box.lines.values()) {
        if (line.side === ctx.playerSide && line.assists >= 10) return true;
      }
      return false;
    }),
  }),
  def({
    id: 'bball.rejected',
    category: 'basketball',
    title: 'Not In My House',
    description: 'Record 25 career blocks.',
    target: 25,
    reward: { coins: 400 },
    evaluate: onSportEvent(BasketballEvent.BLOCK),
  }),
  def({
    id: 'bball.century',
    category: 'basketball',
    title: 'Century',
    description: 'Score 100 points as a team in one match.',
    scope: 'match',
    reward: { coins: 500 },
    evaluate: onEvent(EventKind.SCORE, (_event, ctx) => (myTeam(ctx)?.points ?? 0) >= 100),
  }),
  def({
    id: 'bball.sharpshooter',
    category: 'basketball',
    title: 'Sharpshooter',
    description: 'Make 100 career three-pointers.',
    target: 100,
    reward: { coins: 800 },
    evaluate: onEvent(
      EventKind.SCORE,
      (event, ctx) => event.value === 3 && inBasketball(ctx.sport),
    ),
  }),
  def({
    id: 'bball.clean-hands',
    category: 'basketball',
    title: 'Clean Hands',
    description: 'Win a basketball match with 5 team turnovers or fewer.',
    reward: { coins: 400 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event, ctx) =>
        wonIt(event) && inBasketball(detailString(event, 'sport')) && turnovers(ctx) <= 5,
    ),
  }),
  def({
    id: 'bball.hard-way',
    category: 'basketball',
    title: 'The Hard Way',
    description: 'Win a basketball match on All-Star or above.',
    reward: { coins: 700 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event, ctx) =>
        wonIt(event) &&
        inBasketball(detailString(event, 'sport')) &&
        atLeast('allStar').includes(ctx.difficulty),
    ),
  }),
  def({
    id: 'bball.fifty-wins',
    category: 'basketball',
    title: 'Franchise',
    description: 'Win 50 basketball matches.',
    target: 50,
    reward: { coins: 1500, pack: 'gold' },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event) => wonIt(event) && inBasketball(detailString(event, 'sport')),
    ),
  }),
];

/** Team turnovers, attributed and unattributed alike — the number a coach would say out loud. */
function turnovers(ctx: Parameters<AchievementDef['evaluate']>[1]): number {
  const team = myTeam(ctx);
  if (team === null) return 0;
  const side = ctx.playerSide === 1 ? 1 : 0;
  return team.turnovers + ctx.box.teamTurnovers[side];
}
