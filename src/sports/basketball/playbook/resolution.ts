/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.2 — Resolution model: ratings → matchup → outcome distribution → sampled events
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §2.2 (possession turns), §7 (balance across modes),
 *          06-game-design.md §3.1 (the shooting model)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-9 (one event stream),
 *            INV-11 (Live and Playbook agree within tolerance for the same rosters)
 *
 * Purpose: turns a pair of calls into a possession — who took it, from where, against whom, whether
 * it went in, and the events that say so.
 *
 * **The one decision that makes INV-11 achievable: the shot is Live's shot.** `shotProbability()`
 * from `shooting.ts` is the same function the Live sim calls, given the same shape of input. `09`
 * §7 asks that "Playbook resolution, Live simulation, and arcade calibration all read the same
 * derived ratings"; the cheapest way to guarantee that is to read the same *model*, not merely the
 * same numbers. Playbook's job is therefore to decide the *circumstances* of a shot — zone,
 * distance, contest, movement, release — and to hand them to the model Live already uses. Two
 * separate curves, however carefully tuned, would drift the first time either was touched.
 *
 * **What stands in for the release meter.** Live gets `release` from the player's timing. A Playbook
 * turn has no meter, so the athlete's own execution stands in: a good shooter releases well most of
 * the time, a poor one does not, and the spread is a seeded draw. That is the honest analogue —
 * anything flatter would make ratings matter less in Playbook than in Live, which is exactly what
 * INV-11 exists to catch.
 *
 * **Draw order is fixed and named.** Broken scheme → turnover → foul → shot → rebound. Each stage
 * draws from its own labelled fork, so inserting a stage later cannot shift the stages after it
 * (INV-8; see `engine/rng.ts` on forking by label).
 */
import { EventKind, event, type Side, type SportEvent } from '../../../engine/match/events.ts';
import type { EntityId } from '../../../engine/world.ts';
import type { Rng } from '../../../engine/rng.ts';
import type {
  CallPair,
  PlaybookAthlete,
  PlaybookState,
  TurnExpectation,
  TurnResolution,
  TurnScore,
} from '../../../modes/playbook/types.ts';
import { freeThrowProbability } from '../defence.ts';
import { shotProbability, type ShooterRatings } from '../shooting.ts';
import type { ShotZone } from '../court.ts';
import {
  areaOf,
  defensiveProfile,
  offensiveProfile,
  type DefensiveProfile,
  type OffensiveProfile,
} from './calls.ts';

/** What the sport tracks between turns. Small on purpose — the engine owns everything shared. */
export interface BasketballPlaybookState {
  /** Team fouls this period, per side. Feeds the bonus, exactly as the Live rule book does. */
  readonly teamFouls: [number, number];
  /** Whether the last turn ended in a stop, which is what makes Push Tempo worth calling. */
  lastWasStop: boolean;
  /** The period the fouls above belong to; a change resets them, as the rule book does. */
  period: number;
}

/**
 * Tuning. One table, for the same reason `SHOOTING` is one table: a balance pass that has to hunt
 * for numbers is a balance pass that does not happen.
 *
 * @spec-ref 09-modes-and-arcade.md §2.2 — "calls shift probability distributions"
 */
export const RESOLUTION = {
  /** Rating difference that is worth one logistic unit. Matches `contest()`'s divisor in T-1.5. */
  matchupDivisor: 25,
  /** How much of the matchup edge moves the turnover rate. */
  turnoverFromEdge: 0.09,
  /** How much of it moves the foul rate — a beaten defender fouls. */
  foulFromEdge: 0.05,
  /** How much of it moves the contest. The single biggest lever ratings have on a possession. */
  contestFromEdge: 0.3,

  /** Contest an average defender applies before the call and the matchup have their say. */
  baseContest: 0.42,
  /** Contest a broken scheme applies: nobody there. */
  brokenContest: 0.05,

  /** Release quality floor, for a 0-rated shooter with an average draw. */
  releaseFloor: 0.62,
  /** Added at rating 100. */
  releaseSpan: 0.3,
  /** Spread of the release draw. Composure narrows it. */
  releaseSpread: 0.16,
  releaseSpreadFromComposure: 0.0009,

  /** Share of missed shots the offence rebounds, for two even teams. */
  offensiveReboundBase: 0.27,
  /** How much a rebounding-rating edge moves that share. */
  reboundFromEdge: 0.22,

  /** Free-throw release: the line is the one shot nobody contests, so execution is nearly all of it. */
  freeThrowRelease: 0.88,
  /** Chance a shooting foul happened on a shot that went in — the and-one. */
  andOneShare: 0.22,

  /** Stamina recovered per turn spent not running. */
  recovery: 0.03,
  /** Stamina floor. Nobody plays at zero; `06` §3.1's fatigue never fully switches an athlete off. */
  staminaFloor: 0.45,

  /** Late-clock pressure a possession carries by default. Playbook has no live shot clock. */
  clockPressure: 0.15,
} as const;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function rating(athlete: PlaybookAthlete, key: string): number {
  return athlete.ratings[key] ?? 50;
}

function teamAverage(players: readonly PlaybookAthlete[], key: string): number {
  if (players.length === 0) return 50;
  let total = 0;
  for (const player of players) total += rating(player, key);
  return total / players.length;
}

/** The five ratings the shooting model reads, pulled out of a derived-rating bag. */
export function shooterRatings(athlete: PlaybookAthlete): ShooterRatings {
  return {
    finishing: rating(athlete, 'finishing'),
    midRange: rating(athlete, 'midRange'),
    threePoint: rating(athlete, 'threePoint'),
    freeThrow: rating(athlete, 'freeThrow'),
    composure: rating(athlete, 'composure'),
  };
}

/** 2 or 3, from the zone alone — the same split `court.ts` makes by geometry. */
export function zoneValue(zone: ShotZone): 2 | 3 {
  return zone === 'restricted' || zone === 'paint' || zone === 'midRange' ? 2 : 3;
}

/**
 * Who takes it. A targeted call takes the named athlete when they are on the floor; otherwise the
 * play picks whoever is best at what the play asks for, which is what makes a call a statement
 * about the roster rather than a die roll.
 */
export function primaryOption(
  players: readonly PlaybookAthlete[],
  profile: OffensiveProfile,
  target: EntityId | undefined,
): PlaybookAthlete {
  if (target !== undefined) {
    const named = players.find((player) => player.id === target);
    if (named !== undefined) return named;
  }

  let best = players[0] as PlaybookAthlete;
  for (const player of players) {
    if (rating(player, profile.picks) > rating(best, profile.picks)) best = player;
  }
  return best;
}

/** The defender the play runs at: whoever the opponent's scheme puts in the way. */
export function primaryDefender(
  players: readonly PlaybookAthlete[],
  profile: OffensiveProfile,
): PlaybookAthlete {
  let best = players[0] as PlaybookAthlete;
  for (const player of players) {
    if (rating(player, profile.defendKey) > rating(best, profile.defendKey)) best = player;
  }
  return best;
}

/**
 * The matchup, `-0.5 … +0.5`. Positive favours the offence. Logistic over a rating difference, the
 * same shape `contest()` uses in the engine — a 20-point edge is worth about a sixth of a
 * possession, and even a hopeless mismatch leaves something on the table.
 */
export function matchupEdge(attack: number, defend: number, stamina: number): number {
  const tired = (1 - clamp(stamina, 0, 1)) * 8;
  return logistic((attack - defend - tired) / RESOLUTION.matchupDivisor) - 0.5;
}

/** How well the shooter got it off. Rating sets the centre; composure narrows the spread. */
export function releaseFor(ratings: ShooterRatings, key: number, rng: Rng): number {
  const centre = RESOLUTION.releaseFloor + RESOLUTION.releaseSpan * (key / 100);
  const spread = Math.max(
    0.04,
    RESOLUTION.releaseSpread - ratings.composure * RESOLUTION.releaseSpreadFromComposure,
  );
  return clamp(rng.gaussian(centre, spread), 0, 1);
}

/** Which rating a shot from this zone is judged on — the same mapping `ratingForZone` makes. */
function keyRatingFor(ratings: ShooterRatings, zone: ShotZone): number {
  if (zone === 'restricted' || zone === 'paint') return ratings.finishing;
  if (zone === 'midRange') return ratings.midRange;
  return ratings.threePoint;
}

export interface ResolveInput {
  readonly state: PlaybookState<BasketballPlaybookState>;
  readonly calls: CallPair;
  readonly rng: Rng;
}

/**
 * One possession. Everything a turn is: the branch, the shot, the rebound, and the events that
 * describe them.
 */
export function resolvePossession(input: ResolveInput): TurnResolution {
  const { state, calls, rng } = input;
  const attacking = state.possession === 1 ? 1 : 0;
  const defendingSide: Side = attacking === 1 ? 0 : 1;
  const attackers = state.squads[attacking].players;
  const defenders = state.squads[defendingSide].players;

  const offence = offensiveProfile(calls.offence.call);
  const defence = defensiveProfile(calls.defence.call);

  const shooter = primaryOption(attackers, offence, calls.offence.target);
  const defender = primaryDefender(defenders, offence);
  const doubled = calls.defence.target !== undefined && calls.defence.target === shooter.id;

  // The matchup, before the defensive scheme's own opinion.
  let edge = matchupEdge(
    rating(shooter, offence.attackKey),
    rating(defender, offence.defendKey),
    shooter.stamina,
  );
  if (defence.doubleTeam !== undefined) {
    edge -= doubled ? defence.doubleTeam : -(defence.opensTeammates ?? 0);
  }

  const events: SportEvent[] = [
    event(EventKind.POSSESSION, 0, attacking, { actor: shooter.id, detail: { call: offence.id } }),
  ];

  // ── 1. Did the scheme break? A broken press is a layup, which is the price `09` §2.2 names. ──
  const broken = rng.fork('broken').bool(defence.broken);

  // ── 2. Turnover. ──
  const turnoverChance = broken
    ? 0
    : clamp(offence.turnover + defence.turnover - edge * RESOLUTION.turnoverFromEdge, 0.01, 0.45);
  if (rng.fork('turnover').bool(turnoverChance)) {
    return turnover({
      state,
      calls,
      shooter,
      defender,
      defendingSide,
      offence,
      defence,
      events,
      rng,
    });
  }

  // ── 3. Shooting foul. ──
  const foulChance = broken
    ? 0
    : clamp(offence.foul + defence.foul + edge * RESOLUTION.foulFromEdge, 0.01, 0.4);
  const fouled = rng.fork('foul').bool(foulChance);

  // ── 4. The shot. Live's own model, given Playbook's circumstances. ──
  const zone: ShotZone = broken ? 'restricted' : offence.zone;
  const ratings = shooterRatings(shooter);
  const release = releaseFor(ratings, keyRatingFor(ratings, zone), rng.fork('release'));
  const contest = broken
    ? RESOLUTION.brokenContest
    : clamp(
        RESOLUTION.baseContest + defence.contest[areaOf(zone)] - edge * RESOLUTION.contestFromEdge,
        0,
        1,
      );

  const chance = shotProbability({
    ratings,
    distance: broken ? 1.4 : offence.distance,
    zone,
    contest,
    release,
    movement: broken ? 'offDribble' : offence.movement,
    stamina: shooter.stamina,
    clockPressure: RESOLUTION.clockPressure,
  });

  const value = zoneValue(zone);
  const made = rng.fork('shot').bool(chance);

  events.push(
    event(EventKind.SHOT, 0, attacking, {
      actor: shooter.id,
      target: defender.id,
      value,
      detail: { zone, contest: Math.round(contest * 100) / 100, made },
    }),
  );

  const scores: TurnScore[] = [];
  let points = 0;
  if (made) {
    points += value;
    scores.push({ points: value, actor: shooter.id });
    // Some baskets are created, not assisted — `09` §2.2's Isolation and Post Up mostly are. The
    // pass is emitted *before* the shot so the box score's assist window sees it in order.
    const passer = primaryPasser(attackers, shooter);
    if (!broken && passer.id !== shooter.id && rng.fork('assist').bool(offence.assisted)) {
      events.splice(events.length - 1, 0, passEvent(attacking, passer.id, shooter.id));
    }
  }

  // ── 5. Free throws: a foul on a miss is a trip, a foul on a make is an and-one. ──
  const andOne = fouled && made && rng.fork('and-one').bool(RESOLUTION.andOneShare);
  const trip = fouled && !made;
  if (andOne || trip) {
    events.push(
      event(EventKind.FOUL, 0, defendingSide, { actor: defender.id, target: shooter.id }),
    );
    const attempts = andOne ? 1 : value;
    const ftRng = rng.fork('free-throws');
    for (let i = 0; i < attempts; i += 1) {
      const ftChance = freeThrowProbability(
        { freeThrow: ratings.freeThrow, composure: ratings.composure },
        RESOLUTION.freeThrowRelease,
      );
      const ftMade = ftRng.bool(ftChance);
      events.push(
        event(EventKind.SHOT, 0, attacking, {
          actor: shooter.id,
          value: 1,
          detail: { zone: 'freeThrow', made: ftMade },
        }),
      );
      if (ftMade) {
        points += 1;
        scores.push({ points: 1, actor: shooter.id });
      }
    }
  }

  // ── 6. The rebound, when the ball came off the rim and nobody was at the line. ──
  let retains = false;
  if (!made && !trip) {
    const offensiveShare = clamp(
      RESOLUTION.offensiveReboundBase +
        offence.crashDelta +
        matchupEdge(
          teamAverage(attackers, 'rebounding'),
          teamAverage(defenders, 'rebounding') * defence.rebound,
          1,
        ) *
          RESOLUTION.reboundFromEdge,
      0.05,
      0.6,
    );
    const rebRng = rng.fork('rebound');
    retains = rebRng.bool(offensiveShare);
    const board = bestAt(retains ? attackers : defenders, 'rebounding', rebRng);
    events.push(
      event(EventKind.REBOUND, 0, retains ? attacking : defendingSide, {
        actor: board.id,
        detail: { kind: retains ? 'offensive' : 'defensive' },
      }),
    );
  }

  const outcome = describeOutcome({ made, value, andOne, trip, broken, points });
  const expectation: TurnExpectation = {
    successChance: chance,
    expectedPoints: chance * value * (1 - turnoverChance),
    because: because({ broken, contest, edge, offence, defence, doubled }),
  };

  return {
    turn: state.turn,
    calls,
    attacking,
    outcome,
    actor: shooter.id,
    target: defender.id,
    points,
    scores,
    seconds: broken ? Math.min(offence.seconds, 7) : offence.seconds,
    retainsPossession: retains,
    events,
    expectation,
  };
}

interface TurnoverInput {
  readonly state: PlaybookState<BasketballPlaybookState>;
  readonly calls: CallPair;
  readonly shooter: PlaybookAthlete;
  readonly defender: PlaybookAthlete;
  readonly defendingSide: Side;
  readonly offence: OffensiveProfile;
  readonly defence: DefensiveProfile;
  readonly events: SportEvent[];
  readonly rng: Rng;
}

/**
 * A lost possession. A press takes it off you and somebody gets the steal; a broken-down set is a
 * team turnover with nobody to blame, which is what the box score's `teamTurnovers` is for.
 */
function turnover(input: TurnoverInput): TurnResolution {
  const { state, calls, shooter, defender, defendingSide, offence, defence, events, rng } = input;
  const attacking = state.possession === 1 ? 1 : 0;
  const stolen = rng.fork('steal').bool(0.55 + defence.turnover * 2);

  events.push(
    stolen
      ? event(EventKind.TURNOVER, 0, attacking, { actor: shooter.id, target: defender.id })
      : event(EventKind.TURNOVER, 0, attacking, { detail: { kind: 'violation' } }),
  );
  if (stolen) {
    events.push(
      event(EventKind.SPORT, 0, defendingSide, {
        sportKind: 'basketball.steal',
        actor: defender.id,
      }),
    );
  }

  return {
    turn: state.turn,
    calls,
    attacking,
    outcome: stolen ? 'stolen' : 'turnover',
    actor: shooter.id,
    target: defender.id,
    points: 0,
    scores: [],
    // A turnover ends a possession early — it is the one outcome that does not use the clock up.
    seconds: Math.max(4, Math.round(offence.seconds * 0.6)),
    retainsPossession: false,
    events,
    expectation: {
      successChance: 0,
      expectedPoints: 0,
      because: stolen ? 'The pass was read.' : 'The set broke down.',
    },
  };
}

/** The best rebounder on the floor, with the tie broken seeded rather than by array order. */
function bestAt(players: readonly PlaybookAthlete[], key: string, rng: Rng): PlaybookAthlete {
  let best = players[0] as PlaybookAthlete;
  let bestScore = -Infinity;
  for (const player of players) {
    const score = (player.ratings[key] ?? 50) + rng.float(0, 12);
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return best;
}

/** Whoever most likely made the pass: the best passer who is not the shooter. */
function primaryPasser(
  players: readonly PlaybookAthlete[],
  shooter: PlaybookAthlete,
): PlaybookAthlete {
  let best = shooter;
  let bestScore = -Infinity;
  for (const player of players) {
    if (player.id === shooter.id) continue;
    const score = player.ratings['passing'] ?? 50;
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return best;
}

function passEvent(side: Side, from: EntityId, to: EntityId): SportEvent {
  return event(EventKind.PASS, 0, side, { actor: from, target: to });
}

interface OutcomeInput {
  readonly made: boolean;
  readonly value: 2 | 3;
  readonly andOne: boolean;
  readonly trip: boolean;
  readonly broken: boolean;
  readonly points: number;
}

/** The sport's own name for what happened. Narration (T-5.3) reads this and nothing else. */
export function describeOutcome(input: OutcomeInput): string {
  if (input.made && input.andOne) return 'and-one';
  if (input.made && input.broken) return 'broken-press-layup';
  if (input.made) return input.value === 3 ? 'made-three' : 'made-two';
  if (input.trip) return input.points === 0 ? 'missed-free-throws' : 'free-throws';
  return input.value === 3 ? 'missed-three' : 'missed-two';
}

interface BecauseInput {
  readonly broken: boolean;
  readonly contest: number;
  readonly edge: number;
  readonly offence: OffensiveProfile;
  readonly defence: DefensiveProfile;
  readonly doubled: boolean;
}

/** One line naming what actually drove the number — `09` §2.4's honesty, at turn scale. */
export function because(input: BecauseInput): string {
  if (input.broken) return 'The press broke and nobody was home.';
  if (input.doubled) return 'Two bodies on him all the way.';
  if (input.contest < 0.25) return 'Wide open.';
  if (input.contest > 0.65) return 'Smothered.';
  if (input.edge > 0.12) return 'A mismatch, and they went at it.';
  if (input.edge < -0.12) return 'The wrong matchup to attack.';
  return 'An even look.';
}

/** Stamina after a turn: the side running the play works, the side that just watched recovers. */
export function drainStamina(players: readonly PlaybookAthlete[], effort: number): void {
  for (const player of players) {
    player.stamina = clamp(
      player.stamina - effort + RESOLUTION.recovery,
      RESOLUTION.staminaFloor,
      1,
    );
  }
}
