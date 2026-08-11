/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.7 — Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode,
 *          hidden
 * @story   US-8.4 — Cross-sport achievements exist and are prominent
 * @design  05-data-model.md §6 (the four cross-sport rows, and the reward sizes that make them
 *          prominent), §3.3 (familiarity), 01-plan.md (the signature feature)
 *
 * Purpose: the achievements about the thing this game is actually for — one athlete, several sports.
 *
 * **These are the biggest rewards in the build, and that is the point.** `US-8.4` asks for the
 * signature feature to be "prominent", and prominence in an achievement list is measured in coins:
 * "Wrong Sport, Right Athlete" pays 1 500 where a hat-trick pays 500, so the gallery makes the case
 * for trying your striker at power forward before the player has thought of it themselves.
 *
 * **They are also the defs that need the athlete behind the entity.** Every other category can be
 * answered from the events alone; these need to know that the athlete who just scored 30 is a
 * soccer player. `EvalContext.athleteOf` is the join, and a match played by rolled athletes simply
 * cannot earn them — which is correct, because there is no athlete of yours in it.
 */
import { EventKind } from '../../engine/match/events.ts';
import { sportSkillFor } from '../../athletes/types.ts';
import { MetaKind } from '../types.ts';
import {
  actorAthlete,
  def,
  detailNumber,
  detailString,
  lineFor,
  onEvent,
  onMeta,
} from '../conditions.ts';
import type { AchievementDef } from '../types.ts';

export const crossSportAchievements: readonly AchievementDef[] = [
  def({
    id: 'cross.wrong-sport-right-athlete',
    category: 'crossSport',
    title: 'Wrong Sport, Right Athlete',
    description: 'Score 30+ in a basketball match with a soccer-primary athlete.',
    scope: 'match',
    reward: { coins: 1500, pack: 'gold' },
    evaluate: onEvent(EventKind.SCORE, (event, ctx) => {
      if (ctx.sport !== 'basketball') return false;
      const athlete = actorAthlete(event, ctx);
      if (athlete === undefined || athlete.primarySport !== 'soccer') return false;
      return (lineFor(ctx, event.actor)?.points ?? 0) >= 30;
    }),
  }),
  def({
    id: 'cross.the-other-way',
    category: 'crossSport',
    title: 'The Other Way Round',
    description: 'Score a hat-trick in soccer with a basketball-primary athlete.',
    scope: 'match',
    reward: { coins: 1500 },
    evaluate: onEvent(EventKind.SCORE, (event, ctx) => {
      if (ctx.sport !== 'soccer') return false;
      const athlete = actorAthlete(event, ctx);
      if (athlete === undefined || athlete.primarySport !== 'basketball') return false;
      return (lineFor(ctx, event.actor)?.points ?? 0) >= 3;
    }),
  }),
  def({
    id: 'cross.naturalised',
    category: 'crossSport',
    title: 'Naturalised',
    description: "Take an athlete's non-primary familiarity to its cap.",
    reward: { coins: 2000, pack: 'elite' },
    evaluate: onMeta(
      MetaKind.FAMILIARITY_CAPPED,
      (event) => detailString(event, 'sport') !== detailString(event, 'primarySport'),
    ),
  }),
  def({
    id: 'cross.decathlete',
    category: 'crossSport',
    title: 'Decathlete',
    description: 'Play the same athlete in every sport the build has.',
    reward: { coins: 1200 },
    evaluate: onMeta(MetaKind.SPORT_PLAYED, (event) => event.detail?.['everySport'] === true),
  }),
  def({
    id: 'cross.convert',
    category: 'crossSport',
    title: 'Convert',
    description: "Have an athlete's secondary-sport overall exceed their primary.",
    reward: { coins: 1800 },
    evaluate: onMeta(MetaKind.CONVERTED),
  }),
  def({
    id: 'cross.both-sports-day',
    category: 'crossSport',
    title: 'Double Header',
    description: 'Win a match in two different sports.',
    reward: { coins: 700 },
    // `sportsWon` is computed from the match history when the event is built, not counted here: a
    // set of sports kept inside a def would forget itself on the next reload, and a player who
    // wins at basketball today and at soccer tomorrow would never be credited.
    evaluate: onMeta(
      MetaKind.MATCH_FINISHED,
      (event) => (detailNumber(event, 'sportsWon') ?? 0) >= 2,
    ),
  }),
  def({
    id: 'cross.utility',
    category: 'crossSport',
    title: 'Utility Player',
    description: 'Score in both sports with the same athlete.',
    reward: { coins: 900 },
    evaluate: onMeta(
      MetaKind.SPORT_PLAYED,
      (event) => (detailNumber(event, 'scoringSports') ?? 0) >= 2,
    ),
  }),
  def({
    id: 'cross.transferable',
    category: 'crossSport',
    title: 'Transferable Skills',
    description:
      'Play a match with an athlete who has 50+ familiarity in a sport that is not theirs.',
    reward: { coins: 800 },
    // Read off the athlete during the match rather than from a meta event: familiarity is a fact
    // about who is on the floor, and `athleteOf` is exactly the join that answers it.
    evaluate: (event, ctx) => {
      const actor = (event as { actor?: number }).actor;
      if (actor === undefined) return null;
      const athlete = ctx.athleteOf(actor);
      if (athlete === undefined || athlete.primarySport === ctx.sport) return null;
      return sportSkillFor(athlete, ctx.sport).familiarity >= 50 ? 1 : null;
    },
  }),
];
