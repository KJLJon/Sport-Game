/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.7 — Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode,
 *          hidden
 * @story   US-8.1 — Unlock achievements as I play
 * @story   US-8.2 — Browse my achievements
 * @design  05-data-model.md §6 (the hidden row — "win after trailing by 20+")
 *
 * Purpose: the ones the gallery shows as "???" until they happen.
 *
 * **A hidden achievement has to be reachable by accident.** The whole pleasure of one is that it
 * fires when you were not trying, so every condition here is something a player might do in the
 * course of a match they were playing for its own sake — a comeback, a blow-out, a last-second
 * winner. Nothing here requires a plan, because a hidden achievement you would have to plan is one
 * nobody will ever see.
 *
 * **The comeback needs the deficit, and the deficit is not in the final score.** It is in the
 * stream: the biggest gap the player was behind by at any point. `MATCH_FINISHED` cannot carry it,
 * so it is read as a match-scoped def that watches the running box score go the wrong way and then
 * come back — the one place in this build where an achievement genuinely needs the sequence rather
 * than the totals.
 */
import { EventKind } from '../../engine/match/events.ts';
import { teamLine } from '../../modes/live/box-score.ts';
import { MetaKind } from '../types.ts';
import { def, detailNumber, detailString, onEvent, onMeta, wonIt } from '../conditions.ts';
import type { AchievementDef, EvalContext } from '../types.ts';

/** How far behind the player is right now, or a negative number when they are ahead. */
function deficit(ctx: EvalContext): number {
  if (ctx.playerSide === -1) return 0;
  const mine = teamLine(ctx.box, ctx.playerSide).points;
  const theirs = teamLine(ctx.box, ctx.playerSide === 0 ? 1 : 0).points;
  return theirs - mine;
}

export const hiddenAchievements: readonly AchievementDef[] = [
  def({
    id: 'hidden.comeback',
    category: 'basketball',
    title: 'Never in Doubt',
    description: 'Lead a basketball match after trailing by 20 or more.',
    hidden: true,
    // The two halves — fall behind, then lead — are ordered inside `comebackFrom`, which fires only
    // on the second. `scope: 'match'` is what makes "then" mean anything: the pair has to happen
    // inside one match.
    scope: 'match',
    reward: { coins: 1200 },
    evaluate: comebackFrom(20, 'basketball'),
  }),
  def({
    id: 'hidden.soccer-comeback',
    category: 'soccer',
    title: 'Backs to the Wall',
    description: 'Lead a soccer match after trailing by two goals or more.',
    hidden: true,
    scope: 'match',
    reward: { coins: 1200 },
    evaluate: comebackFrom(2, 'soccer'),
  }),
  def({
    id: 'hidden.shutout-win',
    category: 'basketball',
    title: 'Not a Single One',
    description: 'Win a match in which the opponent never scored.',
    hidden: true,
    reward: { coins: 900 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event) => wonIt(event) && (detailNumber(event, 'theirScore') ?? 1) === 0,
    ),
  }),
  def({
    id: 'hidden.every-starter-scored',
    category: 'onboarding',
    title: 'Everybody Eats',
    description: 'Have 5 different athletes score in one match.',
    hidden: true,
    target: 5,
    scope: 'match',
    reward: { coins: 700 },
    evaluate: distinctScorers(),
  }),
  def({
    id: 'hidden.foul-free',
    category: 'onboarding',
    title: 'Impeccable',
    description: 'Win a match without committing a single foul.',
    hidden: true,
    reward: { coins: 800 },
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event, ctx) =>
        wonIt(event) &&
        ![...ctx.box.lines.values()].some((line) => line.side === ctx.playerSide && line.fouls > 0),
    ),
  }),
  def({
    id: 'hidden.rout',
    category: 'onboarding',
    title: 'Merciless',
    description: 'Win a match by 40 points or 8 goals.',
    hidden: true,
    reward: { coins: 900 },
    evaluate: onMeta(MetaKind.MATCH_FINISHED, (event) => {
      const margin = detailNumber(event, 'margin') ?? 0;
      return detailString(event, 'sport') === 'soccer' ? margin >= 8 : margin >= 40;
    }),
  }),
  def({
    id: 'hidden.by-committee',
    category: 'difficulty',
    title: 'By Committee',
    description: 'Win on Legend with nobody scoring more than a third of your points.',
    hidden: true,
    reward: { coins: 1400 },
    evaluate: onMeta(MetaKind.MATCH_FINISHED, (event, ctx) => {
      if (!wonIt(event) || ctx.difficulty !== 'legend') return false;
      const mine = [...ctx.box.lines.values()].filter((line) => line.side === ctx.playerSide);
      const total = mine.reduce((sum, line) => sum + line.points, 0);
      // Three scorers minimum, or "nobody scored a third" is true of a team that barely scored.
      if (total < 3 || mine.filter((line) => line.points > 0).length < 3) return false;
      return mine.every((line) => line.points * 3 <= total);
    }),
  }),
];

/**
 * The comeback, as two ordered facts inside one match: fall this far behind, and *then* lead.
 *
 * Only the second half scores, so the achievement is a one-shot rather than a two-step whose
 * progress bar would read "1 / 2" for a deficit — which is not progress towards anything a player
 * wants. The flag lives in a closure because it is the ordering, not the count, that matters; a
 * stale flag from an abandoned match can at worst let the *next* lead count, and the deficit has to
 * have happened for it to be set at all.
 */
function comebackFrom(points: number, sport: string): AchievementDef['evaluate'] {
  let trailed = false;
  let lastMatchStep = -1;

  return (event, ctx) => {
    if (ctx.sport !== sport || ctx.playerSide === -1) return null;
    const step = (event as { step?: number }).step ?? 0;
    // A step that goes backwards means a new match started; forget the previous one's deficit.
    if (step < lastMatchStep) trailed = false;
    lastMatchStep = step;

    const behind = deficit(ctx);
    if (!trailed && behind >= points) {
      trailed = true;
      return null;
    }
    if (trailed && behind < 0) {
      trailed = false;
      return 1;
    }
    return null;
  };
}

/** One point per athlete who scores for the first time in this match. */
function distinctScorers(): AchievementDef['evaluate'] {
  return onEvent(EventKind.SCORE, (event, ctx) => {
    const line = event.actor === undefined ? undefined : ctx.box.lines.get(event.actor);
    if (line === undefined || line.side !== ctx.playerSide) return false;
    // Their first points: the box score was updated before the defs ran, so "exactly this basket"
    // is the test for a scorer who had none before it.
    return line.points === (event.value ?? 2);
  });
}
