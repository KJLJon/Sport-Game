/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.2 — Match setup screens for Live and Playbook: sport, teams, difficulty, length,
 *          rules toggles
 * @story   US-10.2 — Set up an exhibition
 * @design  09-modes-and-arcade.md §1 (the three modes), §2.5 (one difficulty ladder),
 *          10-ui-ux.md §8.1 (pick a sport, then how to play)
 * @invariant INV-5 (no sport-specific branching outside the sport), INV-6 (difficulty never
 *            touches an attribute), INV-8 (the opponent is a function of its seed)
 *
 * Purpose: what a player chooses before an exhibition, in one place, so Live and Playbook ask the
 * same questions and encode the answers the same way.
 *
 * **Why a shared model rather than two screens.** T-5.10 built Playbook's setup and T-8.2 adds
 * Live's; the overlap is everything except key moments and turn speed. Two independent screens
 * would drift — one would grow a period-length control the other lacked — and `09` §1 is explicit
 * that the modes differ in *how* a match is played, not in what a match is.
 *
 * **A setup is a link.** Every choice round-trips through query parameters, so a configured match
 * is shareable, the back button works, and a resumed match (T-8.4) can be described by a URL rather
 * than by a snapshot of a screen's internal state.
 *
 * **What is deliberately not here: an injuries toggle.** `US-10.2` names three rules toggles —
 * fouls, offside, injuries — and only two of them exist to switch. Injuries live in
 * `athletes/condition.ts` as an *availability* state that a match reads and never writes: nothing
 * in either sport's simulation injures anybody. A toggle for it would be a control that does
 * nothing, which `modes/live/screen.ts` already argues is worse than no control at all. It arrives
 * when in-match injuries do.
 */
import { DIFFICULTIES, type Difficulty } from './difficulty.ts';
import { DEFAULT_SPORT, isPlayable } from '../sports/playable.ts';
import type { SportId } from '../sports/types.ts';

/**
 * How long a period runs, as a multiplier on the sport's own `MatchRules.periodSteps`.
 *
 * A multiplier rather than a number of minutes, because "a period" is a quarter in one sport and a
 * half in another and the engine counts steps, not minutes. The sport keeps its own idea of a
 * proper match and this scales it.
 */
export const MATCH_LENGTHS = ['quick', 'short', 'full'] as const;
export type MatchLength = (typeof MATCH_LENGTHS)[number];

export const LENGTH_SCALE: Readonly<Record<MatchLength, number>> = {
  quick: 0.25,
  short: 0.5,
  full: 1,
};

export const LENGTH_LABELS: Readonly<Record<MatchLength, string>> = {
  quick: 'Quick',
  short: 'Short',
  full: 'Full',
};

export const LENGTH_BLURBS: Readonly<Record<MatchLength, string>> = {
  quick: 'A quarter of a real match. Good for a bus ride.',
  short: 'Half length. Long enough for the game to turn.',
  full: 'The sport’s own match length.',
};

/**
 * Per-match rule switches. A sport reads the ones it implements and ignores the rest, which is what
 * lets one bag serve every sport without the bag knowing which sport it is in (INV-5).
 *
 * Both default to **on**: the toggles exist to let a player make a match simpler, and the sport's
 * real laws are the honest default.
 */
export interface RuleOptions {
  /** Whistle for fouls. Off means contact is never punished — both sports read this. */
  readonly fouls: boolean;
  /** Flag offside. Only a sport that has an offside law reads it; the others ignore it. */
  readonly offside: boolean;
}

export const DEFAULT_RULE_OPTIONS: RuleOptions = { fouls: true, offside: true };

/** Everything an exhibition needs, in both modes. */
export interface MatchSetupChoice {
  readonly sport: SportId;
  /** The player's team id, or `null` for "whoever I have" — see `resolveRosters`. */
  readonly teamId: string | null;
  /**
   * The seed the CPU opponent is generated from (T-7.9). Changing it re-rolls the opponent, which
   * is what the "Another opponent" button does; keeping it means the same opponent every time the
   * link is opened (INV-8).
   */
  readonly opponentSeed: string;
  readonly difficulty: Difficulty;
  readonly length: MatchLength;
  readonly rules: RuleOptions;
}

export const DEFAULT_MATCH_SETUP: MatchSetupChoice = {
  sport: DEFAULT_SPORT,
  teamId: null,
  opponentSeed: 'opponent-1',
  difficulty: 'pro',
  length: 'full',
  rules: DEFAULT_RULE_OPTIONS,
};

/**
 * The choice as query parameters.
 *
 * Only what differs from the default is written, so a plain `#/play/live/soccer` stays plain and a
 * link is readable. A parameter nobody set is a parameter nobody has to understand.
 */
export function encodeSetup(choice: MatchSetupChoice): Record<string, string> {
  const query: Record<string, string> = {};
  if (choice.teamId !== null) query['team'] = choice.teamId;
  if (choice.opponentSeed !== DEFAULT_MATCH_SETUP.opponentSeed) query['vs'] = choice.opponentSeed;
  if (choice.difficulty !== DEFAULT_MATCH_SETUP.difficulty) query['difficulty'] = choice.difficulty;
  if (choice.length !== DEFAULT_MATCH_SETUP.length) query['length'] = choice.length;
  if (!choice.rules.fouls) query['fouls'] = 'off';
  if (!choice.rules.offside) query['offside'] = 'off';
  return query;
}

/**
 * A choice back out of query parameters, with every unreadable value falling back to its default.
 *
 * Nothing here throws. A hand-edited or truncated link is a thing that happens, and the right
 * response to `?difficulty=impossible` is a match at Pro, not an error screen.
 */
export function decodeSetup(
  query: Readonly<Record<string, string | undefined>>,
  sport?: string,
): MatchSetupChoice {
  const team = query['team'];
  return {
    sport: isPlayable(sport) ? (sport as SportId) : DEFAULT_MATCH_SETUP.sport,
    teamId: team === undefined || team === '' ? null : team,
    opponentSeed: query['vs'] ?? DEFAULT_MATCH_SETUP.opponentSeed,
    difficulty: readDifficulty(query['difficulty']),
    length: readLength(query['length']),
    rules: {
      fouls: query['fouls'] !== 'off',
      offside: query['offside'] !== 'off',
    },
  };
}

function readDifficulty(value: string | undefined): Difficulty {
  return DIFFICULTIES.includes(value as Difficulty)
    ? (value as Difficulty)
    : DEFAULT_MATCH_SETUP.difficulty;
}

function readLength(value: string | undefined): MatchLength {
  return MATCH_LENGTHS.includes(value as MatchLength)
    ? (value as MatchLength)
    : DEFAULT_MATCH_SETUP.length;
}

/** The route a configured Live match lives at. Query order is stable so links compare equal. */
export function liveMatchHref(choice: MatchSetupChoice): string {
  return withQuery(`#/play/live/${choice.sport}`, encodeSetup(choice));
}

export function withQuery(base: string, query: Readonly<Record<string, string>>): string {
  const keys = Object.keys(query).sort();
  if (keys.length === 0) return base;
  return `${base}?${keys.map((key) => `${key}=${encodeURIComponent(query[key] as string)}`).join('&')}`;
}

/**
 * Scales a sport's period length by the chosen match length.
 *
 * Rounded to a whole step and floored at one, because a zero-step period is a match that ends
 * before it starts — and `quick` on a sport with a very short period could reach it.
 */
export function scalePeriodSteps(periodSteps: number, length: MatchLength): number {
  return Math.max(1, Math.round(periodSteps * LENGTH_SCALE[length]));
}
