/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.9 — Control switching: auto on turnover, manual cycle, controlled-athlete indicator
 * @story   US-2.2 — Switch which athlete I am controlling
 * @design  06-game-design.md §2 (auto-switch on possession change is an assist, tunable separately
 *          from difficulty), 04-architecture.md §6 (input layer)
 * @invariant INV-1 (difficulty never touches ratings), INV-8 (determinism)
 *
 * Purpose: deciding which of five athletes the player is. Pure policy over positions and possession
 * — no world mutation and no input handling, so "who should I be now" is testable without a match.
 *
 * **Auto-switch is an assist, not a difficulty setting.** `06` §2 lists it alongside aim and pass
 * assist, tunable on its own, and that is how it is modelled here: `autoSwitch` is a flag the caller
 * owns. With it off, the player keeps whoever they picked and cycles by hand — which is the harder
 * and, for some people, the better game.
 */
import { NO_ENTITY, type EntityId } from '../../engine/world.ts';

/** One athlete the player could be, with everything the policy needs to judge them. */
export interface Candidate {
  readonly athlete: EntityId;
  /** Distance to the ball, in metres. */
  readonly toBall: number;
  /** Distance to the basket this athlete's team is defending. */
  readonly toOwnBasket: number;
  /** True if this athlete is carrying it. */
  readonly carrier: boolean;
}

export const CONTROL = {
  /**
   * How much closer to the ball a new candidate has to be before an automatic switch fires.
   *
   * Without it, two athletes a hand's breadth apart trade control every few frames and the player's
   * thumb is attached to nobody. Hysteresis is the whole feature.
   */
  switchMargin: 1.5,
} as const;

/**
 * Who the player should be, given who they are now.
 *
 * On offence it is always whoever has the ball — being the ball-handler is the point. Off the ball
 * it is whoever is nearest it, subject to the hysteresis margin, with distance to your own basket
 * as the tie-break so a scramble does not oscillate.
 */
export function pickControlled(
  candidates: readonly Candidate[],
  current: EntityId,
  autoSwitch: boolean,
): EntityId {
  if (candidates.length === 0) return NO_ENTITY;

  // Off means off: the player keeps whoever they picked and cycles by hand. The only thing that
  // overrides it is their athlete no longer being on the floor.
  if (!autoSwitch && stillPresent(candidates, current)) return current;

  const carrier = candidates.find((c) => c.carrier);
  if (carrier !== undefined) return carrier.athlete;

  let best = candidates[0] as Candidate;
  for (const candidate of candidates) {
    if (better(candidate, best)) best = candidate;
  }

  const held = candidates.find((c) => c.athlete === current);
  if (held === undefined) return best.athlete;
  return best.toBall < held.toBall - CONTROL.switchMargin ? best.athlete : current;
}

/** Manual cycle: the next athlete in a stable order, wrapping. */
export function cycleControlled(order: readonly EntityId[], current: EntityId): EntityId {
  if (order.length === 0) return NO_ENTITY;
  const index = order.indexOf(current);
  return order[(index + 1) % order.length] as EntityId;
}

/**
 * Whether a possession change should force a switch. Separate from `pickControlled` because the
 * caller needs to know a *change* happened, not merely what the answer is now — the HUD flashes the
 * indicator on it (T-2.10) and the audio layer stings it (T-2.12).
 */
export function shouldAutoSwitch(
  previousPossession: number,
  possession: number,
  autoSwitch: boolean,
): boolean {
  return autoSwitch && previousPossession !== possession;
}

function stillPresent(candidates: readonly Candidate[], athlete: EntityId): boolean {
  return candidates.some((c) => c.athlete === athlete);
}

function better(candidate: Candidate, best: Candidate): boolean {
  if (candidate.toBall !== best.toBall) return candidate.toBall < best.toBall;
  if (candidate.toOwnBasket !== best.toOwnBasket) return candidate.toOwnBasket < best.toOwnBasket;
  return candidate.athlete < best.athlete;
}
