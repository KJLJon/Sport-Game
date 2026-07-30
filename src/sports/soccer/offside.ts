/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.3 — Offside detection and enforcement
 * @story   US-4.1 — Play an 11v11 soccer match
 * @design  06-game-design.md §3.2 (rules: offside), 04-architecture.md §5 (the sport module seam)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: Law 11, and only Law 11. Where the offside line is, who is beyond it, and whether that
 * turns into a free kick.
 *
 * **The whole law turns on one instant.** Offside is judged at the moment the ball is *played by a
 * teammate*, not at the moment it arrives — a striker who is level when the pass leaves and ten
 * metres clear when it reaches them is onside, and that is the single fact every argument about
 * offside is really about. So this module is built as a two-part transaction: `captureOffside()`
 * freezes the picture the instant a pass is struck, and `judgeOffside()` reads that frozen picture
 * when someone next touches the ball. Nothing recomputes positions in between, which is what makes
 * the rule right by construction rather than by careful sequencing in the caller.
 *
 * That instant is a contract with the passing suite (T-6.5): the pass calls `captureOffside` as it
 * releases, and hands the snapshot to whatever eventually receives.
 *
 * **What "involved in active play" means here.** The Law lists three ways: interfering with play,
 * interfering with an opponent, and gaining an advantage. This models the first — a player who was
 * in an offside position when the ball was played becomes the first attacker to touch it — because
 * it is the overwhelming majority of calls, it is objectively decidable, and the other two require
 * judging intent, which is not a thing a simulation can do honestly. Flagged rather than hidden:
 * a player standing offside who lets the ball run to an onside teammate is not penalised here, and
 * in a real match sometimes would be.
 *
 * **Three restarts cannot be offside**: a throw-in, a goal kick, and a corner. That exemption lives
 * in the snapshot rather than in the caller, so there is one place to be wrong about it.
 */
import { EventKind, event, type Side, type SportEvent } from '../../engine/match/events.ts';
import type { EntityId } from '../../engine/world.ts';
import { CENTRE_X, PITCH, type Side as PitchSide } from './pitch.ts';
import { RestartKind, SoccerEvent, opponent, type Restart, type RestartKindName } from './rules.ts';

/** The minimum a player needs to be ahead by. Level is onside, and level is a band, not a plane. */
const LEVEL_TOLERANCE = 0.15;

/** One position the law cares about. Deliberately not an entity: the law is about coordinates. */
export interface PlayerPosition {
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
}

/**
 * How far towards the goal a side is attacking a point is. The whole law is comparisons on this
 * one number, which is what stops every predicate below from carrying its own `side === 0 ? …`.
 */
export function attackDepth(x: number, attackingSide: PitchSide): number {
  return attackingSide === 0 ? x : PITCH.length - x;
}

/** The restarts Law 11 exempts. */
const EXEMPT: readonly RestartKindName[] = [
  RestartKind.THROW_IN,
  RestartKind.GOAL_KICK,
  RestartKind.CORNER_KICK,
];

export function isOffsideExempt(kind: RestartKindName): boolean {
  return EXEMPT.includes(kind);
}

/**
 * The offside line, as an attacking depth: the second-last defender, or the halfway line, whichever
 * is deeper into the defending half.
 *
 * "Second-last" counts the goalkeeper, who is usually but not always the last — a keeper caught
 * upfield is exactly the case the phrase is worded to cover, and sorting rather than special-casing
 * the keeper is what gets that right for free.
 *
 * With fewer than two defenders on the pitch the line is the halfway line, which is the safe answer:
 * it can only ever make a call *less* likely, and a squad that small is a practice mode, not a match.
 */
export function offsideLine(
  defenders: readonly PlayerPosition[],
  attackingSide: PitchSide,
): number {
  const depths = defenders
    .map((defender) => attackDepth(defender.x, attackingSide))
    .sort((a, b) => b - a);
  const secondLast = depths.length >= 2 ? (depths[1] as number) : Number.NEGATIVE_INFINITY;
  return Math.max(secondLast, attackDepth(CENTRE_X, attackingSide));
}

/**
 * Whether a point is in an offside position, given the line and where the ball was played from.
 *
 * Three conditions, all of which must hold, and each of which is a real match situation people
 * forget: past the second-last defender, past the ball, and inside the opponents' half. A player
 * level with either the line or the ball is onside — hence `LEVEL_TOLERANCE`, because deciding a
 * match on a centimetre is a bug even when it is technically the Law.
 */
export function isInOffsidePosition(
  x: number,
  attackingSide: PitchSide,
  line: number,
  ballX: number,
): boolean {
  const depth = attackDepth(x, attackingSide);
  if (depth <= attackDepth(CENTRE_X, attackingSide) + LEVEL_TOLERANCE) return false;
  if (depth <= attackDepth(ballX, attackingSide) + LEVEL_TOLERANCE) return false;
  return depth > line + LEVEL_TOLERANCE;
}

/**
 * The picture at the moment the ball was played, and the only thing `judgeOffside` is allowed to
 * look at. Plain data, so it survives a snapshot, a replay, and the P2P wire.
 */
export interface OffsideSnapshot {
  /** The side that played the ball. */
  readonly side: PitchSide;
  /** Who played it — never flagged, however far forward they then run. */
  readonly passer: EntityId;
  readonly line: number;
  readonly ballX: number;
  /** Teammates in an offside position at that instant, and where they were standing. */
  readonly flagged: readonly PlayerPosition[];
  /** True when the ball came from a throw-in, goal kick, or corner. */
  readonly exempt: boolean;
}

/**
 * Freezes the picture as the ball is played.
 *
 * `restartKind` is the restart the ball is being played *from*, or `null` in open play. Passing it
 * here rather than checking it at judgement time is deliberate: by the time the ball arrives the
 * restart is long over, and the exemption would have to be remembered anyway.
 */
export function captureOffside(
  side: PitchSide,
  passer: EntityId,
  ballX: number,
  attackers: readonly PlayerPosition[],
  defenders: readonly PlayerPosition[],
  restartKind: RestartKindName | null = null,
): OffsideSnapshot {
  const exempt = restartKind !== null && isOffsideExempt(restartKind);
  const line = offsideLine(defenders, side);

  const flagged = exempt
    ? []
    : attackers.filter(
        (attacker) => attacker.id !== passer && isInOffsidePosition(attacker.x, side, line, ballX),
      );

  return { side, passer, line, ballX, flagged, exempt };
}

/**
 * Whether the player who just touched the ball was offside when it was played.
 *
 * The receiver is looked up by id in the frozen list, never re-measured. That is the whole point of
 * the snapshot: by now they have moved.
 */
export function judgeOffside(snapshot: OffsideSnapshot, receiver: EntityId): boolean {
  if (snapshot.exempt) return false;
  if (receiver === snapshot.passer) return false;
  return snapshot.flagged.some((player) => player.id === receiver);
}

/** Where a flagged player was standing when the ball was played — where the free kick is taken. */
export function offenceSpot(
  snapshot: OffsideSnapshot,
  receiver: EntityId,
): PlayerPosition | undefined {
  return snapshot.flagged.find((player) => player.id === receiver);
}

/**
 * The offence: an indirect free kick to the defending side, from where the offside player was
 * standing when the ball was played — not from where they were flagged, which is a distinction that
 * matters on a fifty-metre through ball.
 *
 * Returns the restart and the events, for the module's `step()` to hand to `awardRestart`. Nothing
 * here touches `RulesState`, so offside stays a judgement rather than a mutation.
 */
export interface OffsideOffence {
  readonly restart: Restart;
  readonly events: readonly SportEvent[];
}

export function offsideOffence(
  snapshot: OffsideSnapshot,
  receiver: EntityId,
  step: number,
): OffsideOffence | null {
  if (!judgeOffside(snapshot, receiver)) return null;

  const spot = offenceSpot(snapshot, receiver);
  if (spot === undefined) return null;

  const defending = opponent(snapshot.side);
  const restart: Restart = {
    kind: RestartKind.FREE_KICK,
    side: defending,
    x: spot.x,
    y: spot.y,
    reason: 'offside',
  };

  return {
    restart,
    events: [
      {
        kind: EventKind.SPORT,
        sportKind: SoccerEvent.OFFSIDE,
        step,
        side: snapshot.side as Side,
        actor: receiver,
        target: snapshot.passer,
        x: spot.x,
        y: spot.y,
      },
      event(EventKind.TURNOVER, step, snapshot.side, {
        actor: receiver,
        detail: { reason: 'offside' },
      }),
    ],
  };
}
