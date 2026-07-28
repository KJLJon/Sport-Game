/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.6 — Behavioural coupling: familiarity → decision noise, control error, reaction penalty in-sim
 * @story   US-5.2 — Play any athlete in any sport
 * @design  05-data-model.md §3.3 (behavioural coupling), 06-game-design.md §7 (difficulty)
 * @invariant INV-2 (seeded PRNG only), INV-7 (difficulty never modifies attributes or ratings)
 *
 * Purpose: the other half of the familiarity penalty. `05` §3.3: "Low familiarity is not only a
 * smaller number: it also adds decision noise, increases control error on first touch and handling,
 * and lengthens reaction latency in the AI layer, so an out-of-sport athlete visibly looks lost
 * before they look merely weak."
 *
 * That sentence is the acceptance criterion, and it is the reason the feature is worth building at
 * all. A sprinter dropped into basketball whose only symptom is a lower number reads as *nerfed*;
 * one who hesitates, mishandles the ball, and reacts late reads as *out of their depth*, which is
 * the fantasy the whole cross-sport system exists to sell.
 *
 * **This is not difficulty.** CLAUDE.md §8.6 forbids difficulty touching attributes or derived
 * ratings; this touches neither — it perturbs decisions and timing, from a value that is a property
 * of the athlete, not of the settings. The two stack without either one having to know about the
 * other.
 *
 * **A fully familiar athlete costs nothing.** Every factor below is exactly zero at the familiarity
 * an athlete has in their own sport, so call sites can skip their random draw entirely rather than
 * drawing and discarding. That is not an optimisation: consuming a draw that changes nothing would
 * shift the whole PRNG stream and break every golden-seed determinism test for no behaviour.
 */
import { COUPLING } from './tuning.ts';
import { ATHLETE_BOUNDS, clamp } from './types.ts';

/**
 * How lost an athlete is, `0` at home and `1` for a complete novice. The curve is deliberately
 * steeper than the rating penalty's: ratings fall to 55% at zero familiarity, but *looking* lost
 * should fade out well before an athlete is fully familiar, so a competent-but-learning athlete
 * plays cleanly and merely a little worse.
 */
export function lostness(familiarity: number): number {
  const f = clamp(familiarity, ATHLETE_BOUNDS.familiarity.min, ATHLETE_BOUNDS.familiarity.max);
  const raw = (COUPLING.fadeOut - f) / COUPLING.fadeOut;
  return clamp(raw, 0, 1) ** COUPLING.exponent;
}

/** Everything the sim reads off familiarity. All three are zero for an athlete at home. */
export interface Coupling {
  /** How lost, `0`–`1`. Exposed so a sport can couple something these three do not cover. */
  readonly lostness: number;
  /**
   * Standard deviation of the noise added to a decision's expected value, in points. A lost
   * athlete does not decide *wrongly* on purpose — they misjudge, and sometimes that is right.
   */
  readonly decisionNoise: number;
  /** `0`–`1`. Scales up the error on a first touch, a catch, and ball handling. */
  readonly controlError: number;
  /** `0`–`1`. Scales *down* the per-step chance of acting on a decision — reaction latency. */
  readonly reactionPenalty: number;
}

export function couplingFor(familiarity: number): Coupling {
  const lost = lostness(familiarity);
  return {
    lostness: lost,
    decisionNoise: lost * COUPLING.decisionNoise,
    controlError: lost * COUPLING.controlError,
    reactionPenalty: lost * COUPLING.reactionPenalty,
  };
}

/** Nothing coupled — an athlete in their own sport, and the default before T-3.17 wires rosters. */
export const NO_COUPLING: Coupling = {
  lostness: 0,
  decisionNoise: 0,
  controlError: 0,
  reactionPenalty: 0,
};

/**
 * Scales a `0`–`1` control quality down by the athlete's control error. Used on catches, first
 * touches, and handling — the places `05` §3.3 names.
 */
export function degradeControl(control: number, coupling: Coupling): number {
  return control * (1 - coupling.controlError);
}

/**
 * Scales a per-step chance of acting on a decision. A lost athlete sees the pass late; they do not
 * see a different pass.
 */
export function delayReaction(chancePerStep: number, coupling: Coupling): number {
  return chancePerStep * (1 - coupling.reactionPenalty);
}

/**
 * Widens a timing window's spread — how far off the ideal release a CPU athlete lands. Returns the
 * multiplier rather than the perturbed value, so the caller keeps its single existing random draw
 * and the PRNG stream is unchanged when nothing is coupled.
 */
export function timingSpread(coupling: Coupling): number {
  return 1 + coupling.controlError * COUPLING.timingSpread;
}
