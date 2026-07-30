/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.20 — Soccer Playbook: resolution model, reusing Live's shooting and passing
 * @story   US-15.2 — Call plays and see them resolve
 * @design  09-modes-and-arcade.md §7 (ratings are the constant), 06-game-design.md §3.2
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism),
 *            INV-11 (Live and Playbook agree for the same rosters)
 *
 * Purpose: the bridge between a phase turn and soccer's *own* Live models. Everything here answers
 * one question — what would `passing.ts`, `shooting.ts`, and `keeper.ts` say about this phase? — and
 * `resolution.ts` walks the graph on the answers.
 *
 * **Why this file exists at all, when basketball needed no equivalent.** Basketball's Playbook calls
 * `shotProbability()` directly, because basketball's Live shot model *is* a probability. Soccer's is
 * not: `takeShot()` puts a ball in the air with a placement error on it, and whether that is a goal
 * is then decided by geometry and by a goalkeeper who dives at it. There is no number to borrow. So
 * the reuse `09` §7 asks for has to be *composition* rather than a call — set up the same shot the
 * Live sim would set up, put it through the same `placementError`, the same `shotSpeed`, the same
 * `keeperSpot` and `saveOutcome`, and read off what happened. Five Live functions, no second curve.
 *
 * That is a stronger form of the guarantee, not a weaker one. Tuning `SHOOTING.baseError` or
 * `KEEPER.diveSpeed` now moves Playbook too, which is exactly what `09` §7 is for and what a
 * hand-fitted table could never promise.
 *
 * **The same for passing, with one honest abstraction.** A phase of play is minutes long and many
 * passes; the model plays out a *representative sequence* — how many passes and of what kind comes
 * from the tempo intent, and each one goes through Live's `passError()` at Live's `PASS_PROFILES`.
 * The sequence is what makes tempo mechanical rather than numeric: patient is three short balls,
 * direct is one lofted one, and the difference in risk falls out of `PASS_PROFILES`' own figures
 * instead of being asserted by a tuning constant.
 *
 * **Calibration is separate from the model, and labelled.** A physical model does not land on a
 * target distribution by itself, and `09` §2.3's 18–24 turns is a target distribution. So the model
 * produces a raw probability and `MODEL_CALIBRATION` shifts it onto the band T-6.14 derived. The
 * split is the point: the *shape* comes from the Live models and moves when they are tuned, and the
 * *centre* is one named number per phase that T-6.18 owns.
 */
import type { Rng } from '../../../engine/rng.ts';
import { PASS_PROFILES, passError, type PassKind, type PasserRatings } from '../passing.ts';
import { SHOOTING, placementError, shotSpeed, type ShooterRatings } from '../shooting.ts';
import { KEEPER, keeperSpot, saveChance, saveOutcome, type SaveResult } from '../keeper.ts';
import { CENTRE_Y, PITCH, goalOpenness, shotDistance, type Side as PitchSide } from '../pitch.ts';
import { PHASE_TURN_SECONDS, phaseBallX, type SoccerPhase } from './phases.ts';
import type { Channel } from './squad.ts';

/* ------------------------------------------------------------------ passing */

/**
 * The sequence of passes a phase is carried by.
 *
 * `count` is what makes the risk compound and `distance` is what makes each one hard, so a tempo is
 * a genuine trade rather than a modifier: three short balls are each nearly certain and there are
 * three of them, one lofted ball is one roll of a much worse die.
 */
export interface PassPlan {
  readonly kind: PassKind;
  /** Metres each pass covers. */
  readonly distance: number;
  readonly count: number;
}

/** Tuning for the passing half. Distances come from the pitch; only the risk figures are here. */
export const PASS_MODEL = {
  /** Metres either side of a receiver a ball can arrive and still be controlled. */
  controlRadius: 2.2,
  /** How much of that pressure takes away. */
  controlFromPressure: 0.45,

  /** Chance a pass of each kind is read and cut out, before distance and pressure. */
  interceptBase: { short: 0.045, through: 0.1, lofted: 0.075, cross: 0.09 } as Readonly<
    Record<PassKind, number>
  >,
  /** Metres of pass length worth one unit of interception risk — a long ball is a readable one. */
  interceptPerMetre: 1 / 200,
  interceptFromPressure: 0.1,
  /** How much a rating edge buys back. */
  interceptFromEdge: 0.03,
  interceptFloor: 0.01,
  interceptCeiling: 0.45,

  /** A cross travels further than the ground it gains — it comes in from the flank. */
  crossReach: 1.6,
} as const;

/**
 * How a tempo carries the ball through a phase.
 *
 * The span is the pitch distance the phase actually covers, from `phaseBallX`, so a build-up's
 * passes are as long as a build-up is and nothing here restates the geometry.
 */
export function passPlanFor(
  phase: SoccerPhase,
  tempo: string,
  width: string,
  span: number,
): PassPlan {
  // The final third is where the width intent stops being a modifier and becomes a different ball:
  // playing wide means a cross, which is a longer, loopier, harder pass out of `PASS_PROFILES`.
  if (phase === 'finalThird') {
    if (width === 'wide')
      return { kind: 'cross', distance: span * PASS_MODEL.crossReach, count: 1 };
    if (tempo === 'patient') return { kind: 'short', distance: span / 2, count: 2 };
    return { kind: 'through', distance: span, count: 1 };
  }

  if (tempo === 'patient') return { kind: 'short', distance: span / 3, count: 3 };
  if (tempo === 'direct') {
    return phase === 'buildUp'
      ? { kind: 'lofted', distance: span, count: 1 }
      : { kind: 'through', distance: span, count: 1 };
  }
  return { kind: 'short', distance: span / 2, count: 2 };
}

/**
 * The chance one pass of this plan finds its man: Live's own `passError`, read as geometry.
 *
 * `passError` returns an *angular* error, so the lateral miss at the receiver is `angle × distance`
 * — which is why a long ball struck with the same technique arrives further from where it was aimed.
 * Treating that as the standard deviation of a normal draw and asking for the chance it lands inside
 * the receiver's control radius is the whole of the conversion, and it is the reason a long pass gets
 * harder without anybody writing down that a long pass is harder.
 */
export function passCompletion(plan: PassPlan, ratings: PasserRatings, pressure: number): number {
  const error = passError(PASS_PROFILES[plan.kind], ratings, plan.distance, pressure);
  const sigma = Math.max(0.01, error.angle * plan.distance);
  const tolerance =
    PASS_MODEL.controlRadius * (1 - PASS_MODEL.controlFromPressure * clamp01(pressure));
  return erf(tolerance / (sigma * Math.SQRT2));
}

/** The chance one pass of this plan is cut out. Distance and pressure raise it; class lowers it. */
export function interceptChance(plan: PassPlan, pressure: number, edge: number): number {
  const raw =
    PASS_MODEL.interceptBase[plan.kind] +
    plan.distance * PASS_MODEL.interceptPerMetre +
    clamp01(pressure) * PASS_MODEL.interceptFromPressure -
    edge * PASS_MODEL.interceptFromEdge;
  return clamp(raw, PASS_MODEL.interceptFloor, PASS_MODEL.interceptCeiling);
}

/**
 * The chance the whole sequence comes off: every pass found its man and none was cut out.
 *
 * Compounding is deliberate and is where a patient tempo pays for its safety — three near-certain
 * passes are not certain, which is the honest reason a possession breaks down in midfield.
 */
export function sequenceSuccess(
  plan: PassPlan,
  ratings: PasserRatings,
  pressure: number,
  edge: number,
): number {
  const perPass =
    passCompletion(plan, ratings, pressure) * (1 - interceptChance(plan, pressure, edge));
  return Math.pow(clamp01(perPass), plan.count);
}

/* ----------------------------------------------------------------- shooting */

/**
 * Where the phase's shot is taken from, and how it is struck.
 *
 * The position comes from `phaseBallX` — the same number the diagram will draw and the same one
 * `phaseThird` is checked against — plus a lateral offset, so a set piece is the wide, tight-angle
 * chance it should be and a worked opening is central.
 */
export interface ShotSetup {
  readonly x: number;
  readonly y: number;
  readonly distance: number;
  readonly openness: number;
  readonly power: number;
  readonly pressure: number;
}

export const SHOT_MODEL = {
  /** Metres off centre a worked chance and a set piece are taken from. */
  chanceOffset: 6,
  setPieceOffset: 13,

  /** Power a shooter with no `shotPower` at all winds up to, and what a perfect one adds. */
  powerFloor: 0.45,
  powerSpan: 0.3,
  /** Spread on the draw. Playbook has no meter, so the athlete's own execution stands in for it. */
  powerSpread: 0.15,

  /** Where a shot is aimed, as a fraction across the mouth and up it, before error. */
  aimAcross: 0.72,
  aimLow: 0.3,
  /** A better finisher goes higher into the corner, where a keeper has further to travel. */
  aimHighFromFinishing: 0.35,

  /** Chance a body gets in the way, before the defender's own quality and the angle. */
  blockBase: 0.11,
  blockFromMarking: 1 / 600,
  blockFromOpenness: 0.1,

  /**
   * How far off their line the keeper stands, `0–1` into `KEEPER.maxAdvance`.
   *
   * Low on purpose. `saveChance` measures the dive from the keeper's y to the *aim* point, which
   * `keeper.ts` documents as the right measurement only for a keeper on their line — the intercept
   * point is what an advanced keeper should be judged against, and computing it needs the launch
   * velocity threaded through (the same gap T-6.9 logged for the chip). Keeping the Playbook keeper
   * near their line makes the two agree instead of quietly flattering the shooter.
   */
  keeperAggression: 0.35,

  /**
   * How many attempts a phase of pressure is worth.
   *
   * **This is the reconciliation of two things that did not fit.** `09` §2.3 asks for 18–24 turns a
   * match, and a real match has around 25 shots in it; one attempt per `chance` turn cannot produce
   * both, and the measured result was 5.8 shots and 1.45 goals a match. A `chance` phase is minutes
   * of pressure in and around the box, so it gets *several* attempts — the ball comes back, someone
   * else has a go — and the phase ends at the first one that goes in. The turn budget is untouched
   * because it is still one turn.
   *
   * Drawn as `1 + bool(second) + bool(third)`, so a chance averages 2.2 attempts and a set piece
   * 1.45 — a corner is one delivery and occasionally a scramble.
   */
  chanceSecond: 0.68,
  chanceThird: 0.5,
  setPieceSecond: 0.45,
  /** Ceiling, so a tuning mistake cannot turn one turn into a shooting gallery. */
  maxAttempts: 3,
} as const;

/** Where the shot comes from, given the phase and where the attack was focused. */
export function shotSetupFor(
  phase: SoccerPhase,
  side: PitchSide,
  ratings: ShooterRatings,
  channel: Channel | null,
  pressure: number,
  rng: Rng,
): ShotSetup {
  const offset = phase === 'setPiece' ? SHOT_MODEL.setPieceOffset : SHOT_MODEL.chanceOffset;
  const lean = channel === 'left' ? -1 : channel === 'right' ? 1 : rng.fork('side').bool() ? 1 : -1;
  const x = phaseBallX(phase, side);
  const y = CENTRE_Y + lean * offset * (channel === 'centre' ? 0.35 : 1);

  const power = clamp01(
    SHOT_MODEL.powerFloor +
      SHOT_MODEL.powerSpan * (ratings.shotPower / 100) +
      rng.fork('power').gaussian(0, SHOT_MODEL.powerSpread),
  );

  return {
    x,
    y,
    distance: shotDistance(x, y, side),
    openness: goalOpenness(x, y, side),
    power,
    pressure: clamp01(pressure),
  };
}

/** What a Playbook shot came to. `blocked` never reaches the keeper; the rest are their business. */
export type ShotResult = 'goal' | 'saved' | 'parried' | 'off-target' | 'blocked';

/**
 * The shot, put through Live's own models.
 *
 * Draw order is fixed and each stage takes its own labelled fork: block → placement → keeper. A
 * shot that is blocked never reaches the goalkeeper, which is why the block is drawn first rather
 * than folded into the save.
 */
export interface ShotInput {
  readonly setup: ShotSetup;
  readonly shooter: ShooterRatings;
  readonly keeper: { readonly goalkeeping: number };
  readonly defenderMarking: number;
  readonly side: PitchSide;
}

/** Everything about the shot that does not need a draw: where it is aimed and how hard. */
function aimFor(input: ShotInput): {
  readonly aimY: number;
  readonly aimZ: number;
  readonly error: { across: number; up: number };
  readonly speed: number;
  readonly flight: number;
  readonly keeperY: number;
  readonly block: number;
} {
  const { setup, shooter, defenderMarking, side } = input;
  const error = placementError(shooter, setup.distance, setup.power, setup.pressure);

  // Aim across the keeper: a shot from the left of the box goes to the right-hand post.
  const across = (setup.y > CENTRE_Y ? -1 : 1) * SHOT_MODEL.aimAcross;
  const up = SHOT_MODEL.aimLow + SHOT_MODEL.aimHighFromFinishing * (shooter.finishing / 100);

  const speed = shotSpeed(shooter, setup.power);
  const spot = keeperSpot(setup.x, setup.y, side, SHOT_MODEL.keeperAggression);

  return {
    aimY: CENTRE_Y + across * (PITCH.goalWidth / 2 - 0.35),
    aimZ: Math.max(0.1, up * (PITCH.goalHeight - 0.35)),
    error,
    speed,
    flight: Math.max(0.05, setup.distance / Math.max(1, speed)),
    keeperY: spot.y,
    block: clamp(
      SHOT_MODEL.blockBase +
        defenderMarking * SHOT_MODEL.blockFromMarking -
        setup.openness * SHOT_MODEL.blockFromOpenness,
      0.02,
      0.4,
    ),
  };
}

/**
 * What this shot was worth before anybody drew for it — soccer's xG, from the same three stages the
 * draw walks: it gets past a body, it hits the frame, and the keeper does not.
 *
 * Analytic rather than sampled, because `TurnExpectation` is read on every turn and `09` §2.4's
 * honest counterfactual is worth exactly as much as it is cheap. The frame term is the normal CDF of
 * the placement error against the distance from the aim point to each post and to the bar, which is
 * the same geometry the draw uses and not a second model of it.
 */
export function expectedGoalChance(input: ShotInput): number {
  const aim = aimFor(input);
  const half = PITCH.goalWidth / 2;

  const inside = (from: number, to: number, sigma: number): number =>
    0.5 *
    (erf(Math.max(0, from) / (Math.max(0.01, sigma) * Math.SQRT2)) +
      erf(Math.max(0, to) / (Math.max(0.01, sigma) * Math.SQRT2)));

  const offCentre = aim.aimY - CENTRE_Y;
  const acrossHit = inside(half - offCentre, half + offCentre, aim.error.across);
  const upHit = inside(aim.aimZ, PITCH.goalHeight - aim.aimZ, aim.error.up);

  const beatsKeeper =
    1 - saveChance(input.keeper, { y: aim.keeperY }, { y: aim.aimY, z: aim.aimZ }, aim.flight);

  return clamp01((1 - aim.block) * acrossHit * upHit * beatsKeeper);
}

/**
 * One attempt, put through Live's own models.
 *
 * Draw order is fixed and each stage takes its own labelled fork: block → placement → keeper. A
 * shot that is blocked never reaches the goalkeeper, which is why the block is drawn first rather
 * than folded into the save.
 */
export function resolveShot(input: ShotInput & { readonly rng: Rng }): {
  readonly result: ShotResult;
  readonly onTarget: boolean;
  readonly expected: number;
} {
  const { setup, shooter, keeper, rng } = input;
  const aim = aimFor(input);
  const expected = expectedGoalChance(input);

  if (rng.fork('block').bool(aim.block)) {
    return { result: 'blocked', onTarget: false, expected };
  }

  const aimRng = rng.fork('aim');
  const actualY = aim.aimY + aimRng.gaussian(0, aim.error.across);
  const actualZ = aim.aimZ + aimRng.gaussian(0, aim.error.up);

  const onTarget =
    Math.abs(actualY - CENTRE_Y) < PITCH.goalWidth / 2 && actualZ > 0 && actualZ < PITCH.goalHeight;
  if (!onTarget) return { result: 'off-target', onTarget: false, expected };

  const outcome: SaveResult = saveOutcome(
    keeper,
    { y: aim.keeperY },
    { y: actualY, z: actualZ },
    aim.flight,
    aim.speed,
    rng.fork('keeper'),
  );

  void setup;
  void shooter;
  if (outcome === 'beaten') return { result: 'goal', onTarget: true, expected };
  return { result: outcome === 'parried' ? 'parried' : 'saved', onTarget: true, expected };
}

/** How notable a non-scoring attempt is, for picking which one the phase is remembered by. */
const NOTABILITY: Readonly<Record<ShotResult, number>> = {
  goal: 4,
  parried: 3,
  saved: 2,
  blocked: 1,
  'off-target': 0,
};

/** One attempt and what it came to, for the box score and T-6.21's narration. */
export interface Attempt {
  readonly result: ShotResult;
  readonly onTarget: boolean;
  readonly expected: number;
}

/**
 * A phase of pressure: several attempts, ending at the first one that goes in.
 *
 * The phase is remembered by its most notable attempt — a save is a better account of a spell than
 * the scuffed follow-up after it — and its `expected` is the chance *any* of them went in, which is
 * what `09` §2.4's counterfactual has to be compared against.
 */
export function resolvePressure(
  input: ShotInput & { readonly phase: SoccerPhase; readonly rng: Rng },
): {
  readonly result: ShotResult;
  readonly attempts: readonly Attempt[];
  readonly expected: number;
} {
  const { phase, rng } = input;
  const count = attemptCount(phase, rng.fork('attempts'));

  const attempts: Attempt[] = [];
  let survives = 1;
  for (let index = 0; index < count; index += 1) {
    const attempt = resolveShot({ ...input, rng: rng.fork(`attempt-${index}`) });
    attempts.push(attempt);
    survives *= 1 - attempt.expected;
    if (attempt.result === 'goal') break;
  }

  const best = attempts.reduce((one, other) =>
    NOTABILITY[other.result] > NOTABILITY[one.result] ? other : one,
  );
  return { result: best.result, attempts, expected: 1 - survives };
}

/** How many goes a phase of pressure gets. */
export function attemptCount(phase: SoccerPhase, rng: Rng): number {
  if (phase !== 'chance') return rng.fork('second').bool(SHOT_MODEL.setPieceSecond) ? 2 : 1;
  let count = 1;
  if (rng.fork('second').bool(SHOT_MODEL.chanceSecond)) count += 1;
  if (rng.fork('third').bool(SHOT_MODEL.chanceThird)) count += 1;
  return Math.min(SHOT_MODEL.maxAttempts, count);
}

/* -------------------------------------------------------------- calibration */

/**
 * What the model has to be shifted by to land on the turn budget `09` §2.3 asks for.
 *
 * **All three are zero, and that is the headline result of T-6.20.** The hook was built expecting to
 * need it — a physical model does not land on a target distribution by itself — and the measurement
 * said otherwise: with the Live passing model driving the climb and the create, the baseline batch
 * came back at **21.98 turns** in normal time, which is the middle of the 18–24 band T-6.14 derived
 * from a hand-fitted table. Two independent routes to the same number is the strongest evidence
 * available that the phase durations are right.
 *
 * The field is kept, with its zeros, because **T-6.18 owns it** and a balance pass wants one named
 * number per phase to hold. A non-zero value here means the model and the budget have drifted apart
 * and somebody chose the budget, which is a decision worth being able to see.
 */
export const MODEL_CALIBRATION = {
  buildUp: 0,
  progression: 0,
  finalThird: 0,
} as const;

/* ------------------------------------------------------------------- shared */

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/**
 * The error function, Abramowitz & Stegun 7.1.26 — max absolute error 1.5 × 10⁻⁷.
 *
 * Here because `passCompletion` needs the normal CDF and nothing else in the project has wanted one
 * yet. Kept local rather than put in `engine/` for exactly that reason: one caller is not a seam.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-z * z));
}

/** The pitch distance a phase covers, for the pass plan. */
export function spanOf(phase: SoccerPhase, side: PitchSide): number {
  const next =
    phase === 'buildUp' ? 'progression' : phase === 'progression' ? 'finalThird' : 'chance';
  return Math.abs(phaseBallX(next, side) - phaseBallX(phase, side));
}

/** Re-exported so `resolution.ts` has one import for everything the model needs. */
export { PHASE_TURN_SECONDS, KEEPER, SHOOTING };
