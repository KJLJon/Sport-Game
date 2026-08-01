/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.2 — Role system: per-sport role tables driving off-ball movement and responsibility
 * @story   US-7.1 — Play against the computer
 * @design  06-game-design.md §5 (the Team / Role / Athlete layers)
 * @invariant INV-5 (no sport-specific branching in engine core), INV-8 (determinism)
 *
 * Purpose: the middle layer of `06` §5's three. The team decides the shape and the phase; the
 * athlete decides what to do with the ball right now; this decides **where a position should be
 * and what it is responsible for** in between. It is the layer that turns four athletes standing
 * around the ball into a team with a shape.
 *
 * A duty answers three questions for one role in one phase of play:
 *
 * 1. *Where do I belong?* — an anchor as a fraction of the field, measured from the end this side
 *    defends, so one table serves both sides and every field size.
 * 2. *How far do I follow the ball?* — `ballShade` slides the anchor towards the ball and `leash`
 *    says how far from home that is allowed to drag a role. A centre-back who chases the ball into
 *    the opposite corner is not defending; a centre-back who ignores it is not either.
 * 3. *What am I for?* — `job` names the responsibility, and it is the part sports actually branch
 *    on. The engine never reads it; it carries it.
 *
 * Nothing here knows what a sport is (INV-5) and nothing here draws a random number (INV-8): the
 * same duty and the same ball give the same spot, always.
 */

export const PlayPhase = {
  /** We have it, at the back, working it out. */
  BUILD_UP: 'buildUp',
  /** We have it, in their half. */
  ATTACK: 'attack',
  /** It just changed hands, either way. The phase nobody's shape is ready for. */
  TRANSITION: 'transition',
  /** They have it. */
  DEFEND: 'defend',
} as const;

export type PlayPhase = (typeof PlayPhase)[keyof typeof PlayPhase];

export const PLAY_PHASES: readonly PlayPhase[] = [
  PlayPhase.BUILD_UP,
  PlayPhase.ATTACK,
  PlayPhase.TRANSITION,
  PlayPhase.DEFEND,
];

/**
 * What a role is responsible for, in the phase it holds this duty. Sports read this and decide what
 * it means for them — `runBehind` is a back-cut in basketball and a run in behind the last man in
 * soccer — which is exactly the split `04` §5 asks for.
 */
export const RoleJob = {
  /** Get open for the ball where the carrier can find you. */
  SUPPORT: 'support',
  /** Stretch them: run past the defence, or out to the corner. */
  RUN_BEHIND: 'runBehind',
  /** Hold the width or the spacing so somebody else has room. */
  HOLD_SHAPE: 'holdShape',
  /** Go and get the ball. */
  PRESS: 'press',
  /** Stay with your man. */
  MARK: 'mark',
  /** Hold the space behind the press — help defence, the covering centre-back. */
  COVER: 'cover',
  /** Attack the rebound, the second ball, the loose one. */
  CRASH: 'crash',
} as const;

export type RoleJob = (typeof RoleJob)[keyof typeof RoleJob];

/** A point as a fraction of the field: `x` from the end this side defends, `y` across it. */
export interface Fraction {
  readonly x: number;
  readonly y: number;
}

/** A point in world units (metres). */
export interface Spot {
  x: number;
  y: number;
}

export interface RoleDuty {
  /** Where this role belongs, as a fraction of the field from the end it defends. */
  readonly anchor: Fraction;
  /** How far the ball drags the anchor, `0` (ignores it) to `1` (stands on it). */
  readonly ballShade: number;
  /** How far from the anchor that drag may take the role, as a fraction of the field. */
  readonly leash: number;
  /** What this role is for in this phase. */
  readonly job: RoleJob;
  /**
   * How readily this role abandons its spot to compete for the ball, `0–1`. The team layer scales
   * it by difficulty's aggression (T-7.7); the duty says who is *supposed* to be the one to go.
   */
  readonly urgency: number;
}

/** One role's duties, one per phase. Every phase is present: a role always has a job. */
export type RoleDuties = Readonly<Record<PlayPhase, RoleDuty>>;

/** A sport's whole table: role id → its four duties. */
export type DutyTable = Readonly<Record<string, RoleDuties>>;

export interface FieldSize {
  readonly width: number;
  readonly height: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * The phase of play, from possession alone.
 *
 * `stepsSinceChange` is what makes transition a phase rather than an instant: for a beat after the
 * ball changes hands, *both* teams are in a shape built for the other situation, and that beat is
 * where counter-attacks and fast breaks live. A sport passes the beat it counts in.
 *
 * @spec-ref 06-game-design.md §5 — "phase of play (build-up / attack / transition / defend)"
 */
export function phaseFor(options: {
  /** The side this is being asked for. */
  readonly side: 0 | 1;
  /** Who has the ball, or `-1` for nobody. */
  readonly possession: 0 | 1 | -1;
  /** How far the ball is up this side's attacking direction, `0–1`. */
  readonly ballAdvance: number;
  /** Steps since possession last changed. */
  readonly stepsSinceChange: number;
  /** How many steps count as transition. */
  readonly transitionSteps: number;
  /** Fraction of the field beyond which build-up has become attack. */
  readonly attackFrom?: number;
}): PlayPhase {
  if (options.stepsSinceChange < options.transitionSteps) return PlayPhase.TRANSITION;
  if (options.possession !== options.side) return PlayPhase.DEFEND;
  return options.ballAdvance >= (options.attackFrom ?? 0.5) ? PlayPhase.ATTACK : PlayPhase.BUILD_UP;
}

/**
 * Where a role should be, in metres.
 *
 * The anchor is shaded towards the ball by `ballShade` and then pulled back onto the leash, in that
 * order. Doing it the other way round — clamping the ball position to the leash — gives a role that
 * sits at the end of its rope pointing at the ball, which looks like a dog and not like a defender.
 */
export function dutySpot(
  duty: RoleDuty,
  ball: { readonly x: number; readonly y: number },
  field: FieldSize,
  side: 0 | 1,
  out: Spot = { x: 0, y: 0 },
): Spot {
  // Fractions are measured from the end this side defends, so side 1 reads the field backwards.
  const anchorX = side === 0 ? duty.anchor.x * field.width : (1 - duty.anchor.x) * field.width;
  const anchorY = side === 0 ? duty.anchor.y * field.height : (1 - duty.anchor.y) * field.height;

  const shadedX = anchorX + (ball.x - anchorX) * duty.ballShade;
  const shadedY = anchorY + (ball.y - anchorY) * duty.ballShade;

  const leashX = duty.leash * field.width;
  const leashY = duty.leash * field.height;

  out.x = clamp(shadedX, anchorX - leashX, anchorX + leashX);
  out.y = clamp(shadedY, anchorY - leashY, anchorY + leashY);
  // A role dragged off the field is worse than one out of position.
  out.x = clamp(out.x, 0, field.width);
  out.y = clamp(out.y, 0, field.height);
  return out;
}

/**
 * Nudges a target away from teammates who are already on it.
 *
 * This is the whole of "spacing" as a shared idea: a role table can only say where a position
 * *belongs*, and two roles whose duties overlap in some phase will both be right and both be in the
 * same place. The push is along the line between them, so it never fights the anchor — it only
 * decides which of two athletes stands where.
 */
export function spaced(
  target: Spot,
  teammates: readonly { readonly x: number; readonly y: number }[],
  minGap: number,
  field: FieldSize,
): Spot {
  if (minGap <= 0) return target;

  for (const mate of teammates) {
    const dx = target.x - mate.x;
    const dy = target.y - mate.y;
    const distance = Math.hypot(dx, dy);
    if (distance >= minGap) continue;

    // Exactly on top of each other has no direction to push along; step off along the field's
    // long axis rather than picking a random one, which would cost determinism for nothing.
    const push = distance < 1e-6 ? { x: 1, y: 0 } : { x: dx / distance, y: dy / distance };
    const shortfall = minGap - distance;
    target.x = clamp(target.x + push.x * shortfall, 0, field.width);
    target.y = clamp(target.y + push.y * shortfall, 0, field.height);
  }

  return target;
}

/** The duty for a role in a phase, or `undefined` for a role the table does not know. */
export function dutyFor(table: DutyTable, role: string, phase: PlayPhase): RoleDuty | undefined {
  return table[role]?.[phase];
}

/**
 * Builds a role's four duties from one base duty and per-phase overrides. Most roles differ from
 * themselves in only one or two fields between phases, and writing four near-identical literals is
 * how a table acquires a typo nobody notices for a phase.
 */
export function duties(
  base: RoleDuty,
  overrides: Partial<Record<PlayPhase, Partial<RoleDuty>>> = {},
): RoleDuties {
  const build = (phase: PlayPhase): RoleDuty => ({ ...base, ...overrides[phase] });
  return {
    [PlayPhase.BUILD_UP]: build(PlayPhase.BUILD_UP),
    [PlayPhase.ATTACK]: build(PlayPhase.ATTACK),
    [PlayPhase.TRANSITION]: build(PlayPhase.TRANSITION),
    [PlayPhase.DEFEND]: build(PlayPhase.DEFEND),
  };
}
