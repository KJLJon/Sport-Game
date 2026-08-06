/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.6 — Achievement engine: declarative defs, event-stream evaluation, progress,
 *          once-only grants (INV-7)
 * @task    T-8.7 — Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode,
 *          hidden
 * @story   US-8.1 — Unlock achievements as I play
 * @design  05-data-model.md §6 (the def shape), 02-user-stories.md E8
 *
 * Purpose: the handful of combinators every achievement is written with, so that seventy-five defs
 * are seventy-five *rows* rather than seventy-five closures.
 *
 * Every one of them answers the same question — "does this event count, and for how much" — and
 * they exist because the alternative is seventy-five hand-written `evaluate` functions, each with
 * its own way of forgetting to check whose side the event was on. That check is the bug this file
 * prevents: an achievement that fires when the *opponent* makes three threes is wrong in a way
 * nobody would notice until somebody complained.
 */
import { EventKind, type SportEvent } from '../engine/match/events.ts';
import { teamLine, type PlayerLine } from '../modes/live/box-score.ts';
import { assistsOff } from '../modes/assists.ts';
import { DIFFICULTIES, type Difficulty } from '../modes/difficulty.ts';
import type { Athlete } from '../athletes/types.ts';
import {
  isMetaEvent,
  type AchievementCategory,
  type AchievementDef,
  type AchievementEvent,
  type AchievementReward,
  type AchievementScope,
  type EvalContext,
  type MetaKindName,
} from './types.ts';

/** What a def looks like before the defaults are filled in. */
export interface DefSpec {
  readonly id: string;
  readonly category: AchievementCategory;
  readonly title: string;
  readonly description: string;
  readonly reward: AchievementReward;
  readonly evaluate: AchievementDef['evaluate'];
  readonly target?: number;
  readonly scope?: AchievementScope;
  readonly hidden?: boolean;
}

/** Fills in the defaults: one-shot, career-scoped, not hidden. */
export function def(spec: DefSpec): AchievementDef {
  return {
    id: spec.id,
    category: spec.category,
    title: spec.title,
    description: spec.description,
    hidden: spec.hidden ?? false,
    target: spec.target ?? 1,
    scope: spec.scope ?? 'career',
    reward: spec.reward,
    evaluate: spec.evaluate,
  };
}

/** True when the event belongs to the side the player is on. Neutral events belong to nobody. */
export function isPlayers(event: SportEvent, ctx: EvalContext): boolean {
  return ctx.playerSide !== -1 && event.side === ctx.playerSide;
}

/** A match event of one kind, on the player's side. The default reading of every in-match def. */
export function onEvent(
  kind: SportEvent['kind'],
  predicate?: (event: SportEvent, ctx: EvalContext) => boolean,
  amount: (event: SportEvent, ctx: EvalContext) => number = () => 1,
): AchievementDef['evaluate'] {
  return (event, ctx) => {
    if (isMetaEvent(event)) return null;
    const sportEvent = event;
    if (sportEvent.kind !== kind) return null;
    if (!isPlayers(sportEvent, ctx)) return null;
    if (predicate !== undefined && !predicate(sportEvent, ctx)) return null;
    return amount(sportEvent, ctx);
  };
}

/** A sport's own event — `sportKind`, e.g. `'soccer.header'`. Still the player's side only. */
export function onSportEvent(
  sportKind: string,
  predicate?: (event: SportEvent, ctx: EvalContext) => boolean,
): AchievementDef['evaluate'] {
  return onEvent(EventKind.SPORT, (event, ctx) => {
    if (event.sportKind !== sportKind) return false;
    return predicate === undefined || predicate(event, ctx);
  });
}

/** Something that happened outside a match. */
export function onMeta(
  kind: MetaKindName,
  predicate?: (event: Extract<AchievementEvent, { at: number }>, ctx: EvalContext) => boolean,
  amount: (event: Extract<AchievementEvent, { at: number }>, ctx: EvalContext) => number = () => 1,
): AchievementDef['evaluate'] {
  return (event, ctx) => {
    if (!isMetaEvent(event) || event.kind !== kind) return null;
    if (predicate !== undefined && !predicate(event, ctx)) return null;
    return amount(event, ctx);
  };
}

/** A number out of a meta event's `detail`, or `undefined` when it is not there. */
export function detailNumber(
  event: AchievementEvent,
  key: string,
  fallback?: number,
): number | undefined {
  const value = isMetaEvent(event) ? event.detail?.[key] : event.detail?.[key];
  return typeof value === 'number' ? value : fallback;
}

export function detailString(event: AchievementEvent, key: string): string | undefined {
  const value = isMetaEvent(event) ? event.detail?.[key] : event.detail?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function detailFlag(event: AchievementEvent, key: string): boolean {
  const value = isMetaEvent(event) ? event.detail?.[key] : event.detail?.[key];
  return value === true;
}

/** True when the match this event belongs to was won by the player. Reads the finished record. */
export function wonIt(event: AchievementEvent): boolean {
  return detailString(event, 'result') === 'win';
}

/** Levels at or above one, so "All-Star or above" is a list rather than a comparison. */
export function atLeast(difficulty: Difficulty): readonly Difficulty[] {
  return DIFFICULTIES.slice(DIFFICULTIES.indexOf(difficulty));
}

/** The player's own line for an athlete in the running match, if they have one. */
export function lineFor(ctx: EvalContext, entity: number | undefined): PlayerLine | undefined {
  if (entity === undefined) return undefined;
  const line = ctx.box.lines.get(entity);
  return line !== undefined && line.side === ctx.playerSide ? line : undefined;
}

/** The player's team totals in the running match. */
export function myTeam(ctx: EvalContext): ReturnType<typeof teamLine> | null {
  if (ctx.playerSide === -1) return null;
  return teamLine(ctx.box, ctx.playerSide);
}

/** The athlete behind an event's actor, when the match knows one. */
export function actorAthlete(event: SportEvent, ctx: EvalContext): Athlete | undefined {
  return event.actor === undefined ? undefined : ctx.athleteOf(event.actor);
}

/** True when the player finished the match with every assist turned off (US-7.3, `05` §5.3). */
export function unaided(ctx: EvalContext): boolean {
  return assistsOff(ctx.assists);
}

/**
 * True when something matching `predicate` happened on the player's side within `steps` of the
 * event being evaluated.
 *
 * This is how a *sequence* is expressed without any def keeping state: a fast break is points
 * scored moments after a takeaway, a header is a goal moments after the ball was floated in. Both
 * are already in the stream in the right order; all a def needs is a window to look back through.
 */
export function shortlyAfter(
  event: SportEvent,
  ctx: EvalContext,
  steps: number,
  predicate: (candidate: SportEvent) => boolean,
): boolean {
  for (let index = ctx.recent.length - 1; index >= 0; index -= 1) {
    const candidate = ctx.recent[index];
    if (candidate === undefined || candidate === event) continue;
    if (event.step - candidate.step > steps) return false;
    if (candidate.side === event.side && predicate(candidate)) return true;
  }
  return false;
}

/** Simulation steps inside which one event still counts as a consequence of another. */
export const TRANSITION_STEPS = 180;
