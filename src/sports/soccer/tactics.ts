/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.5 — Soccer Live AI depth: build-up phases, press lines, offside trap, counter-attacks
 * @story   US-4.3 — Face a CPU that plays soccer
 * @design  06-game-design.md §3.2 (soccer), §5 (Team / Role / Athlete), §7 (aggression)
 * @invariant INV-1 (difficulty reaches this only as aggression, never as a rating), INV-8 (determinism)
 *
 * Purpose: the soccer half of the team layer — what T-7.3's engine-side `plan()` means on a pitch.
 * Four things, and the first two are what v0.6.0 was missing:
 *
 * 1. **Press lines.** How high this team starts hunting the ball and how many it sends, from the
 *    formation's own aggression and the level's. v0.6.0 conceded 7.5 goals a match on shots taken
 *    from on top of the keeper, because nobody was ever sent at the carrier: the whole defence
 *    shaded towards the ball and none of it arrived.
 * 2. **The block.** Out of possession the shape compacts; in possession it runs long. A back line
 *    forty metres from its midfield is a back line playing on its own.
 * 3. **The offside trap.** The back line steps up when the ball is far from it, which is the only
 *    defensive tool in the sport that converts *position* into a turnover. `offside.ts` already
 *    enforces the rule; nothing had ever tried to use it.
 * 4. **Counter-attacks.** In the transition after winning it, the forward line pushes beyond its own
 *    duty. The duty table gives a longer leash in transition; this gives it a direction.
 *
 * Difficulty reaches all of this through `aggression` alone — `06` §7's passive → relentless row —
 * and no function here takes a rating (INV-1).
 */
import type { Assignment, TeamShape } from '../../engine/ai/team.ts';
import { PITCH } from './pitch.ts';
import { lineOf, type Line } from './duties.ts';
import { formation, type FormationRole } from './formations.ts';

export const TACTICS = {
  /**
   * How high the press starts, as a fraction of the pitch from the end this side defends, at the
   * two ends of the aggression range. A passive side waits inside its own half; a relentless one
   * hunts the ball into the opposition box.
   */
  pressLinePassive: 0.42,
  pressLineRelentless: 0.95,
  /** How many leave the shape to go to the ball, at the two ends of the same range. */
  pressCountPassive: 1,
  pressCountRelentless: 3,
  /** Metres: nobody sprints further than this to press, however keen. */
  pressRange: 32,

  /** How far the block compacts out of possession, `0–1`. */
  compactness: 0.16,
  /** Metres two teammates' targets are kept apart, so eleven roles are not five. */
  spacing: 6,
  /** Metres in front of a mark a marker stands, goal side. */
  markStandoff: 1.4,
  /** Metres a challenger must beat the incumbent marker by before a mark changes hands. */
  markHysteresis: 4,
  /** Metres beyond which a defender would rather hold shape than chase a man across the pitch. */
  markRange: 30,
  /** How many may leave their man to cover the danger, and from how far. */
  helpCount: 1,
  helpRange: 14,
  helpDepth: 0.45,

  /**
   * How far in front of the deepest attacker the trap line sits, in metres. Small: the whole value
   * of a trap is that it is tight, and a trap set five metres early is a high line and nothing more.
   */
  trapMargin: 1.5,
  /**
   * Metres from the back line to the ball beyond which the trap is on. Inside it, stepping up
   * leaves a through-ball rolling into an empty net rather than catching anybody.
   */
  trapFrom: 22,
  /** The highest the trap will ever push a back line, as a fraction of the pitch. */
  trapCeiling: 0.62,

  /** How far up the pitch a counter pushes the forward line, as a fraction of what is left. */
  counterPush: 0.35,
} as const;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * (t < 0 ? 0 : t > 1 ? 1 : t);
}

/**
 * How this team plays out of possession, from the formation's own aggression and the level's.
 *
 * Multiplied rather than averaged: a passive formation on Legend should still be a passive
 * formation, and `06` §7's aggression row is meant to change *how hard the same team competes*,
 * not to replace its manager.
 *
 * @spec-ref 06-game-design.md §7 — defensive aggression / pressing: passive → relentless
 */
export function soccerShape(formationId: string, aggression: number): TeamShape {
  const keenness = Math.max(
    0,
    Math.min(1, formation(formationId).aggression * (0.45 + aggression)),
  );

  return {
    spacing: TACTICS.spacing,
    compactness: TACTICS.compactness,
    pressCount: Math.round(lerp(TACTICS.pressCountPassive, TACTICS.pressCountRelentless, keenness)),
    pressLine: lerp(TACTICS.pressLinePassive, TACTICS.pressLineRelentless, keenness),
    pressRange: TACTICS.pressRange,
    markStandoff: TACTICS.markStandoff,
    markHysteresis: TACTICS.markHysteresis,
    markRange: TACTICS.markRange,
    helpCount: TACTICS.helpCount,
    helpRange: TACTICS.helpRange,
    helpDepth: TACTICS.helpDepth,
  };
}

/** Which line every role of a formation plays in, keyed by role id. Built once per formation. */
export function linesOf(formationId: string): ReadonlyMap<string, Line> {
  const lines = new Map<string, Line>();
  for (const role of formation(formationId).roles as readonly FormationRole[]) {
    lines.set(role.id, lineOf(role));
  }
  return lines;
}

/** How far up this side's attacking direction an x is, `0` (own goal line) to `1` (theirs). */
function advanceOf(x: number, side: 0 | 1): number {
  const fraction = x / PITCH.length;
  const value = side === 0 ? fraction : 1 - fraction;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** An x at a fraction of the pitch measured up this side's attacking direction. */
function xAt(advance: number, side: 0 | 1): number {
  return (side === 0 ? advance : 1 - advance) * PITCH.length;
}

export interface TrapInput {
  /** Where the ball is, in metres along the pitch. */
  readonly ballX: number;
  /** The deepest attacker's x — the one the line has to stay in front of. */
  readonly deepestAttackerX: number;
  /** The side setting the trap. */
  readonly side: 0 | 1;
}

/**
 * Where the back line should stand to play an attacker offside, or `null` for "not on".
 *
 * The trap is the only defensive tool in soccer that turns *position* into a turnover, and the two
 * conditions are exactly the ones that make it work: the ball has to be far enough away that
 * stepping up cannot be beaten by a simple pass, and the line has to end up in front of the
 * attacker rather than level with them.
 *
 * @spec-ref 06-game-design.md §3.2 — offside is enforced; this is the first thing to exploit it
 */
export function trapLine(input: TrapInput): number | null {
  const lineAdvance = advanceOf(input.deepestAttackerX, input.side);
  const ballAdvance = advanceOf(input.ballX, input.side);

  // Stepping up in front of the ball is not a trap, it is a gap.
  if (ballAdvance <= lineAdvance) return null;
  if (Math.abs(input.ballX - input.deepestAttackerX) < TACTICS.trapFrom) return null;

  const target = xAt(
    Math.min(lineAdvance + TACTICS.trapMargin / PITCH.length, TACTICS.trapCeiling),
    input.side,
  );
  return target;
}

export interface TacticalContext {
  readonly side: 0 | 1;
  /** Role id → the line it plays in, from `linesOf()`. */
  readonly lines: ReadonlyMap<string, Line>;
  /** Where the trap line is, or `null` when the trap is off. */
  readonly trapX: number | null;
  /** Whether this team has just won the ball and is countering. */
  readonly countering: boolean;
}

/**
 * Soccer's own pass over the engine's plan: the trap on the back line, the counter on the forwards.
 *
 * Applied to the plan rather than folded into the duty table because both are *situations* rather
 * than positions — the same centre-back in the same phase steps up or drops depending on where the
 * ball is, and a duty anchor has nowhere to say so.
 *
 * Mutates the assignment targets in place; the plan is soccer's for the rest of the step.
 */
export function applyTactics(assignments: readonly Assignment[], context: TacticalContext): void {
  for (const assignment of assignments) {
    const line = context.lines.get(assignment.role);
    if (line === undefined || line === 'keeper') continue;

    if (context.trapX !== null && line === 'defence') {
      // Step up, never drop: the trap raises a line, and a defender already ahead of it is
      // somebody who has been dragged out and is on their way back.
      const stepped =
        context.side === 0
          ? Math.max(assignment.target.x, context.trapX)
          : Math.min(assignment.target.x, context.trapX);
      assignment.target.x = stepped;
      continue;
    }

    if (context.countering && line === 'attack') {
      // The break is worth nothing if the forwards are still where the shape said. Push them at
      // the space behind the defence that a team which has just lost the ball is leaving open.
      const ahead = xAt(1, context.side);
      assignment.target.x += (ahead - assignment.target.x) * TACTICS.counterPush;
    }
  }
}
