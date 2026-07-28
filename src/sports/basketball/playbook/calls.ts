/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.2 — Resolution model: ratings → matchup → outcome distribution → sampled events
 * @task    T-5.4 — Basketball play catalogue (offence + defence calls) and call-selection UI
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §2.2 (basketball possession turns)
 *
 * Purpose: `09` §2.2's two tables, as data. Six offensive calls and five defensive ones, each
 * carrying both the words the call sheet shows and the numbers resolution reads — one definition,
 * so a call cannot say one thing and do another.
 *
 * **Rock-paper-scissors is soft, and these numbers are how.** No defensive call zeroes an offensive
 * one. A defence shifts a contest by a fifth, a turnover rate by a few points, the shot's zone by a
 * step — never more. `09` §2.2 is explicit that ratings beat mind-games, because the moment a call
 * hard-counters another the roster stops mattering and the mode becomes a guessing game.
 *
 * **Why the shot profile lives on the call.** A play *is* the shot it tends to produce: Post Up is
 * a shot from the block, Spot-Up is a shot from the wing. Putting the zone, the distance, and the
 * movement on the call means the resolution model reads one table instead of carrying a switch over
 * call ids, and adding a seventh play is adding a row.
 */
import type { ShotMovementName } from '../shooting.ts';
import type { ShotZone } from '../court.ts';
import type { CallId, CallOption } from '../../../modes/playbook/types.ts';

/** Which contest a defensive call is shifting. Zones collapse to three places on the floor. */
export const SHOT_AREAS = ['rim', 'mid', 'three'] as const;
export type ShotArea = (typeof SHOT_AREAS)[number];

export function areaOf(zone: ShotZone): ShotArea {
  if (zone === 'restricted' || zone === 'paint') return 'rim';
  if (zone === 'midRange') return 'mid';
  return 'three';
}

/** What an offensive call tends to produce, before the defence has its say. */
export interface OffensiveProfile {
  readonly id: CallId;
  /** The shot this play is trying to get. */
  readonly zone: ShotZone;
  /** Metres from the rim. Zone and distance travel together so neither can drift. */
  readonly distance: number;
  readonly movement: ShotMovementName;
  /**
   * The rating that decides *who takes it*. Post Up wants the strongest body, Spot-Up the best
   * shooter — which is what makes calling a play a statement about your roster.
   */
  readonly picks: string;
  /** The rating the primary matchup is contested on. */
  readonly attackKey: string;
  /** The defensive rating that resists it (`09` §2.2's "keys off" column). */
  readonly defendKey: string;
  /** Chance of losing it before a shot goes up, for an even matchup. */
  readonly turnover: number;
  /** Chance of drawing a shooting foul, for an even matchup. */
  readonly foul: number;
  /** Game seconds the possession burns. Push Tempo is fast; Motion works the clock. */
  readonly seconds: number;
  /** Stamina this costs the side running it, per turn. */
  readonly effort: number;
  /** Share of the offensive rebound contest this play gives up by design — a three is a long miss. */
  readonly crashDelta: number;
  /**
   * Share of this play's makes that came off a pass. Isolation and Post Up are self-created;
   * Motion and Spot-Up are not. Without this every basket is assisted, which is not basketball.
   */
  readonly assisted: number;
}

/**
 * `09` §2.2's offensive table. The `keys off` column becomes `picks`/`attackKey`/`defendKey`; the
 * `best when` column becomes the blurb the call sheet shows.
 *
 * @spec-ref 09-modes-and-arcade.md §2.2 — Isolation, Pick & Roll, Post Up, Motion, Spot-Up, Push
 */
export const OFFENSIVE_PROFILES: readonly OffensiveProfile[] = [
  {
    id: 'isolation',
    zone: 'midRange',
    distance: 5.2,
    movement: 'offDribble',
    picks: 'ballHandling',
    attackKey: 'ballHandling',
    defendKey: 'perimeterD',
    turnover: 0.11,
    foul: 0.1,
    seconds: 17,
    effort: 0.04,
    crashDelta: -0.04,
    assisted: 0.15,
  },
  {
    id: 'pick-roll',
    zone: 'paint',
    distance: 3.4,
    movement: 'offDribble',
    picks: 'passing',
    attackKey: 'passing',
    defendKey: 'interiorD',
    turnover: 0.13,
    foul: 0.11,
    seconds: 14,
    effort: 0.05,
    crashDelta: 0.02,
    assisted: 0.72,
  },
  {
    id: 'post-up',
    zone: 'restricted',
    distance: 1.9,
    movement: 'set',
    picks: 'strength',
    attackKey: 'strength',
    defendKey: 'interiorD',
    turnover: 0.12,
    foul: 0.16,
    seconds: 16,
    effort: 0.06,
    crashDelta: 0.06,
    assisted: 0.24,
  },
  {
    id: 'motion',
    zone: 'midRange',
    distance: 5.8,
    movement: 'set',
    picks: 'awareness',
    attackKey: 'passing',
    defendKey: 'perimeterD',
    turnover: 0.1,
    foul: 0.08,
    seconds: 19,
    effort: 0.04,
    crashDelta: 0,
    assisted: 0.82,
  },
  {
    id: 'spot-up',
    zone: 'wingThree',
    distance: 7.4,
    movement: 'set',
    picks: 'threePoint',
    attackKey: 'threePoint',
    defendKey: 'perimeterD',
    turnover: 0.09,
    foul: 0.05,
    seconds: 15,
    effort: 0.03,
    crashDelta: -0.08,
    assisted: 0.86,
  },
  {
    id: 'push',
    zone: 'restricted',
    distance: 1.6,
    movement: 'offDribble',
    picks: 'courtSpeed',
    attackKey: 'courtSpeed',
    defendKey: 'interiorD',
    turnover: 0.15,
    foul: 0.13,
    seconds: 8,
    effort: 0.08,
    crashDelta: -0.02,
    assisted: 0.52,
  },
];

/** What a defensive call does to the possession it is defending. */
export interface DefensiveProfile {
  readonly id: CallId;
  /** Added to the contest level in each area, `0–1` before clamping. Positive is harder to score. */
  readonly contest: Readonly<Record<ShotArea, number>>;
  /** Added to the offence's turnover chance. */
  readonly turnover: number;
  /** Added to the offence's foul chance — an aggressive scheme fouls more. */
  readonly foul: number;
  /** Multiplier on the defence's share of the rebound. */
  readonly rebound: number;
  /** Stamina this costs the side running it. */
  readonly effort: number;
  /** Stamina it costs the *offence* to play against. */
  readonly imposes: number;
  /**
   * Chance the scheme is broken outright, conceding an uncontested shot at the rim. This is the
   * cost `09` §2.2 names for Press, and the reason it is not simply the best call.
   */
  readonly broken: number;
  /** Penalty applied to the targeted athlete's matchup, for `Double the Star`. */
  readonly doubleTeam?: number;
  /** What everyone else gains while the double is away. */
  readonly opensTeammates?: number;
}

/**
 * `09` §2.2's defensive table. Man is the baseline — every number is zero — and everything else is
 * a trade stated in its own row.
 *
 * @spec-ref 09-modes-and-arcade.md §2.2 — Man, 2-3 Zone, Press, Double the Star, Protect the Rim
 */
export const DEFENSIVE_PROFILES: readonly DefensiveProfile[] = [
  {
    id: 'man',
    contest: { rim: 0, mid: 0, three: 0 },
    turnover: 0,
    foul: 0,
    rebound: 1,
    effort: 0.04,
    imposes: 0,
    broken: 0.01,
  },
  {
    // "Suppresses drives, concedes threes."
    id: 'zone',
    contest: { rim: 0.16, mid: 0.04, three: -0.14 },
    turnover: -0.01,
    foul: -0.02,
    rebound: 0.94,
    effort: 0.03,
    imposes: 0,
    broken: 0.01,
  },
  {
    // "Forces turnovers, drains stamina, concedes easy buckets when broken."
    id: 'press',
    contest: { rim: -0.06, mid: -0.02, three: -0.02 },
    turnover: 0.06,
    foul: 0.03,
    rebound: 0.96,
    effort: 0.11,
    imposes: 0.06,
    broken: 0.1,
  },
  {
    // "Blunts one athlete, opens their teammates."
    id: 'double',
    contest: { rim: 0.04, mid: 0.04, three: 0.02 },
    turnover: 0.03,
    foul: 0.01,
    rebound: 0.97,
    effort: 0.06,
    imposes: 0.02,
    broken: 0.04,
    doubleTeam: 0.22,
    opensTeammates: 0.12,
  },
  {
    // "Cuts finishing, concedes mid-range."
    id: 'protect-rim',
    contest: { rim: 0.19, mid: -0.09, three: -0.02 },
    turnover: -0.01,
    foul: 0.02,
    rebound: 1.04,
    effort: 0.04,
    imposes: 0,
    broken: 0.01,
  },
];

/** The call sheet's own words. `09` §2.2's "best when" and "effect" columns, verbatim in spirit. */
export const BASKETBALL_CALLS: readonly CallOption[] = [
  {
    id: 'isolation',
    name: 'Isolation',
    side: 'offence',
    blurb: 'Best when you have a star mismatch.',
    keys: ['ballHandling', 'finishing'],
    targeted: true,
  },
  {
    id: 'pick-roll',
    name: 'Pick & Roll',
    side: 'offence',
    blurb: 'Best when they are defending man.',
    keys: ['passing', 'finishing'],
    targeted: true,
  },
  {
    id: 'post-up',
    name: 'Post Up',
    side: 'offence',
    blurb: 'Best when you have size inside.',
    keys: ['strength', 'finishing'],
    targeted: true,
  },
  {
    id: 'motion',
    name: 'Motion',
    side: 'offence',
    blurb: 'Best with a balanced roster and no star.',
    keys: ['passing', 'awareness'],
  },
  {
    id: 'spot-up',
    name: 'Spot-Up / Three-Set',
    side: 'offence',
    blurb: 'Best with shooters, against a packed paint.',
    keys: ['threePoint', 'awareness'],
    targeted: true,
  },
  {
    id: 'push',
    name: 'Push Tempo',
    side: 'offence',
    blurb: 'Best after a stop, with stamina in hand.',
    keys: ['courtSpeed', 'stamina'],
  },
  {
    id: 'man',
    name: 'Man',
    side: 'defence',
    blurb: 'Baseline. Strong perimeter defenders shine.',
    keys: ['perimeterD'],
  },
  {
    id: 'zone',
    name: '2-3 Zone',
    side: 'defence',
    blurb: 'Suppresses drives, concedes threes.',
    keys: ['interiorD', 'rebounding'],
  },
  {
    id: 'press',
    name: 'Press',
    side: 'defence',
    blurb: 'Forces turnovers, drains stamina, concedes easy buckets when broken.',
    keys: ['perimeterD', 'courtSpeed'],
  },
  {
    id: 'double',
    name: 'Double the Star',
    side: 'defence',
    blurb: 'Blunts one athlete, opens their teammates.',
    keys: ['perimeterD', 'awareness'],
    targeted: true,
  },
  {
    id: 'protect-rim',
    name: 'Protect the Rim',
    side: 'defence',
    blurb: 'Cuts finishing, concedes mid-range.',
    keys: ['interiorD', 'vertical'],
  },
];

const OFFENCE_BY_ID = new Map(OFFENSIVE_PROFILES.map((profile) => [profile.id, profile]));
const DEFENCE_BY_ID = new Map(DEFENSIVE_PROFILES.map((profile) => [profile.id, profile]));

/** Motion and Man are the fallbacks: an unrecognised call plays the least opinionated thing. */
export function offensiveProfile(id: CallId): OffensiveProfile {
  return OFFENCE_BY_ID.get(id) ?? (OFFENSIVE_PROFILES[3] as OffensiveProfile);
}

export function defensiveProfile(id: CallId): DefensiveProfile {
  return DEFENCE_BY_ID.get(id) ?? (DEFENSIVE_PROFILES[0] as DefensiveProfile);
}

export function callOption(id: CallId): CallOption | undefined {
  return BASKETBALL_CALLS.find((call) => call.id === id);
}
