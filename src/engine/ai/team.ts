/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.3 — Team coordination: formation shape, phase of play, pressing triggers, help defence, transition
 * @story   US-7.1 — Play against the computer
 * @design  06-game-design.md §5 (the Team layer: "formation shape, phase of play, pressing triggers")
 * @invariant INV-1 (difficulty never touches attributes or ratings), INV-5 (no sport-specific
 *            branching in engine core), INV-2 / INV-8 (nothing here draws a number; determinism)
 *
 * Purpose: the top of `06` §5's three layers. T-7.2 gave every role a duty; this decides what the
 * eleven of them are doing **as a team** this tick — the phase of play, the shape that phase asks
 * for, who leaves it to go and press, who picks up whom, and who slides across to cover.
 *
 * The whole layer is one call: `plan()` returns an assignment per athlete, and the sport turns each
 * assignment into steering and options (T-7.4, T-7.5). The engine decides *where* and *what for*;
 * the sport decides what a press looks like when it arrives.
 *
 * Four things the duty table cannot say on its own, and this is where each lives:
 *
 * - **Shape is a team property.** A duty can say where one role belongs; only the team can say the
 *   block is too stretched. `compactness` pulls every target towards the unit's own centre, which
 *   is the difference between eleven individually-correct positions and a defensive block.
 * - **Somebody has to go.** Roles all shading towards the ball is not a press — it is eleven people
 *   watching. The press picks a *named* few, by urgency and proximity, and the rest keep the shape
 *   behind them. This is the thing whose absence let a carrier walk into the box in v0.6.0.
 * - **Marks are one-to-one.** Each defender picks up one attacker and each attacker is picked up
 *   once; `marking.ts` holds the matching and its stickiness.
 * - **Help costs something.** A helper is a defender who has left their man, so help is capped, is
 *   never taken off the ball, and never comes from the athlete whose man is the danger.
 *
 * Difficulty does not appear here (INV-1). A level reaches the team layer by handing it a different
 * `TeamShape` — a lower press line, fewer pressers, a looser block — which is `06` §7's
 * "defensive aggression / pressing: passive → relentless" and touches no rating on the way.
 */
import type { EntityId } from '../world.ts';
import { assignMarks, goalSideSpot, type Marks } from './marking.ts';
import {
  PlayPhase,
  RoleJob,
  dutyFor,
  dutySpot,
  phaseFor,
  spaced,
  type DutyTable,
  type FieldSize,
  type Fraction,
  type RoleDuty,
  type Spot,
} from './roles.ts';

/** One of ours, as the team layer needs to see them. */
export interface TeamActor {
  readonly id: EntityId;
  /** The role id this athlete is playing — a key into the sport's `DutyTable`. */
  readonly role: string;
  readonly x: number;
  readonly y: number;
}

/** One of theirs. The team layer needs no more of an opponent than where they are. */
export interface Opponent {
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
}

/** The world as one team sees it, this tick. */
export interface TeamSituation {
  readonly mates: readonly TeamActor[];
  readonly opponents: readonly Opponent[];
  readonly ball: { readonly x: number; readonly y: number };
  /** Which side has it, or `-1` for a loose ball. */
  readonly possession: 0 | 1 | -1;
  /** Who is carrying it, if anybody. The most dangerous opponent, and the head of the help line. */
  readonly carrier?: EntityId;
  /**
   * A press cue the sport spotted and the engine could not: a heavy touch, a pass played backwards,
   * a throw-in to a marked man. It fires the press regardless of the press line.
   *
   * @spec-ref 06-game-design.md §5 — "pressing triggers"
   */
  readonly trigger?: boolean;
}

/** Why an athlete is where the plan says, beyond the duty. */
export const TeamIntent = {
  /** Holding the shape the duty asked for. */
  SHAPE: 'shape',
  /** Gone to the ball. */
  PRESS: 'press',
  /** On a man. */
  MARK: 'mark',
  /** Left their man to cover the danger. */
  HELP: 'help',
} as const;

export type TeamIntent = (typeof TeamIntent)[keyof typeof TeamIntent];

/** What one athlete is doing this tick. */
export interface Assignment {
  readonly actor: EntityId;
  readonly role: string;
  /** The job to execute — the duty's, unless the team overrode it to press or cover. */
  readonly job: RoleJob;
  /** Why: the duty, the press, a man, or the cover. */
  readonly intent: TeamIntent;
  /** Where to be, in metres. */
  readonly target: Spot;
  /** The opponent being marked, or `null`. */
  readonly mark: EntityId | null;
  /** How readily this athlete abandons the target to compete, `0–1`, straight from the duty. */
  readonly urgency: number;
}

export interface TeamPlan {
  readonly phase: PlayPhase;
  /** Steps since possession last changed hands — how deep into transition this is. */
  readonly sinceChange: number;
  /** Whether the press fired this tick, and so whether `pressers` is meaningful. */
  readonly pressing: boolean;
  readonly pressers: readonly EntityId[];
  readonly assignments: readonly Assignment[];
}

/**
 * How this team plays, in the numbers the layer actually reads. A sport builds one of these from
 * its own tuning and the difficulty level's aggression (T-7.7); nothing here scales anything by a
 * rating, and there is no field through which one could arrive (INV-1).
 */
export interface TeamShape {
  /** Metres two teammates' targets are kept apart. `0` switches spacing off. */
  readonly spacing: number;
  /**
   * How far every target is pulled towards the unit's centre when defending, `0` (each role stands
   * exactly where its duty says) to `1` (everybody on the same spot). This is the block.
   */
  readonly compactness: number;
  /** How many leave the shape to go to the ball. `0` never presses. */
  readonly pressCount: number;
  /**
   * How high the press starts, as a fraction of the field from the end this side defends. `0.5`
   * presses only in our own half; `1` presses anywhere. `06` §7's passive → relentless row.
   */
  readonly pressLine: number;
  /** Metres: nobody sprints further than this to press. */
  readonly pressRange: number;
  /** Metres in front of a mark a marker stands, on the goal side. */
  readonly markStandoff: number;
  /** Metres a challenger must beat the incumbent marker by before a mark changes hands. */
  readonly markHysteresis: number;
  /** Metres beyond which a marker would rather hold shape than chase a man. */
  readonly markRange: number;
  /** How many may leave their man to cover the danger. */
  readonly helpCount: number;
  /** Metres from the carrier-to-goal line within which an athlete is close enough to help. */
  readonly helpRange: number;
  /** How far down the carrier-to-goal line the help stands, `0` (on the carrier) to `1` (on the goal). */
  readonly helpDepth: number;
}

/**
 * Defaults on a soccer-sized pitch. Every one of them is a sport's to override — they exist so a
 * partial shape is a legal thing to pass, not because 12 metres is right for a basketball court.
 */
export const TEAM_SHAPE: TeamShape = {
  spacing: 0,
  compactness: 0.18,
  pressCount: 1,
  pressLine: 0.6,
  pressRange: 25,
  markStandoff: 1.2,
  markHysteresis: 1.5,
  markRange: Number.POSITIVE_INFINITY,
  helpCount: 1,
  helpRange: 12,
  helpDepth: 0.45,
};

export interface TeamOptions {
  readonly side: 0 | 1;
  readonly table: DutyTable;
  readonly field: FieldSize;
  /** Steps after a change of possession that still count as transition. The sport's own beat. */
  readonly transitionSteps: number;
  /** Fraction of the field beyond which build-up has become attack. */
  readonly attackFrom?: number;
  /** The goal this side defends, as a fraction of the field. Defaults to the middle of its end. */
  readonly goal?: Fraction;
  readonly shape?: Partial<TeamShape>;
}

export interface TeamCoordinator {
  /** The plan for this tick. Call once per simulation step, before the athletes decide. */
  plan(situation: TeamSituation): TeamPlan;
  /** The last plan, for the dev overlay and for a sport that wants it twice in a step. */
  last(): TeamPlan | null;
  /** Forgets possession and marks: a restart, a new period, a new match. */
  reset(): void;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * How far up this side's attacking direction a point is, `0` (our goal line) to `1` (theirs).
 * Side 1 attacks the other way, so it reads the field backwards — the one place the engine needs
 * to know a side has a direction, and the reason every fraction in a duty table is one-sided.
 */
export function advance(x: number, width: number, side: 0 | 1): number {
  if (width <= 0) return 0;
  const fraction = x / width;
  return clamp(side === 0 ? fraction : 1 - fraction, 0, 1);
}

/**
 * Pulls a set of targets towards their own centre. Applied to the whole unit rather than per role,
 * because compactness is the one property no individual can hold: each of eleven roles can be in
 * exactly the right place and the shape still be forty metres too long.
 */
export function compact(targets: readonly Spot[], factor: number): void {
  if (factor <= 0 || targets.length === 0) return;
  const pull = Math.min(1, factor);

  let cx = 0;
  let cy = 0;
  for (const target of targets) {
    cx += target.x;
    cy += target.y;
  }
  cx /= targets.length;
  cy /= targets.length;

  for (const target of targets) {
    target.x += (cx - target.x) * pull;
    target.y += (cy - target.y) * pull;
  }
}

/** The closest point to `point` on the segment `from`–`to`, and how far away it is. */
export function nearestOnSegment(
  point: { readonly x: number; readonly y: number },
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number; readonly distance: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq < 1e-9
      ? 0
      : clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq, 0, 1);
  const x = from.x + dx * t;
  const y = from.y + dy * t;
  return { x, y, distance: Math.hypot(point.x - x, point.y - y) };
}

interface Working {
  readonly actor: TeamActor;
  readonly duty: RoleDuty;
  target: Spot;
  job: RoleJob;
  intent: TeamIntent;
  mark: EntityId | null;
}

/**
 * Creates a team's coordinator. One per side, kept for the life of the match: the possession clock
 * and the marking assignments are its memory, and both are what make the shape stable rather than
 * recomputed from nothing sixty times a second.
 */
export function createTeam(options: TeamOptions): TeamCoordinator {
  const shape: TeamShape = { ...TEAM_SHAPE, ...options.shape };
  const { side, table, field } = options;
  const goalFraction = options.goal ?? { x: 0, y: 0.5 };
  // Fractions are measured from the end this side defends, exactly as a duty's anchor is.
  const goal = {
    x: side === 0 ? goalFraction.x * field.width : (1 - goalFraction.x) * field.width,
    y: side === 0 ? goalFraction.y * field.height : (1 - goalFraction.y) * field.height,
  };

  let sinceChange = options.transitionSteps;
  let lastPossession: 0 | 1 | -1 | null = null;
  let marks: Marks = new Map<EntityId, EntityId>();
  let latest: TeamPlan | null = null;

  return {
    plan(situation) {
      const { mates, opponents, ball } = situation;

      // A loose ball is not a change of possession — it is the *question* of one, and treating it
      // as an answer restarts transition twice on every deflection.
      if (situation.possession !== -1) {
        if (lastPossession !== null && situation.possession !== lastPossession) sinceChange = 0;
        else sinceChange += 1;
        lastPossession = situation.possession;
      } else {
        sinceChange += 1;
      }

      const ballAdvance = advance(ball.x, field.width, side);
      const phase = phaseFor({
        side,
        possession: situation.possession,
        ballAdvance,
        stepsSinceChange: sinceChange,
        transitionSteps: options.transitionSteps,
        ...(options.attackFrom === undefined ? {} : { attackFrom: options.attackFrom }),
      });

      // 1. Shape: where each duty says its role belongs, given where the ball is.
      const working: Working[] = [];
      for (const actor of mates) {
        const duty = dutyFor(table, actor.role, phase);
        // A role the table does not know gets no assignment at all, rather than a made-up one: the
        // sport keeps whatever it was doing, and the missing row is visible instead of plausible.
        if (duty === undefined) continue;
        working.push({
          actor,
          duty,
          target: dutySpot(duty, ball, field, side),
          job: duty.job,
          intent: TeamIntent.SHAPE,
          mark: null,
        });
      }

      if (working.length === 0) {
        const empty: TeamPlan = {
          phase,
          sinceChange,
          pressing: false,
          pressers: [],
          assignments: [],
        };
        latest = empty;
        return empty;
      }

      const defending = phase === PlayPhase.DEFEND || situation.possession !== side;

      // 2. The block. Only when we do not have it: a team in possession wants to be *long*, and
      //    compacting an attack is how a build-up turns into eleven athletes in one half.
      if (defending) {
        const recovering = phase === PlayPhase.TRANSITION;
        compact(
          working.map((entry) => entry.target),
          recovering ? shape.compactness * 0.5 : shape.compactness,
        );
      }

      // 3. The press. Named athletes go to the ball; everybody else holds the shape behind them.
      const pressers: EntityId[] = [];
      const triggered =
        shape.pressCount > 0 &&
        situation.possession !== side &&
        (situation.trigger === true || ballAdvance <= shape.pressLine);

      if (triggered) {
        const candidates = working
          .map((entry) => ({
            entry,
            distance: Math.hypot(entry.actor.x - ball.x, entry.actor.y - ball.y),
          }))
          .filter(
            (candidate) =>
              candidate.distance <= shape.pressRange && candidate.entry.duty.urgency > 0,
          )
          // Keenest first, and the tie broken by id so the same world always sends the same
          // athletes (INV-8). Urgency divides the distance so a role that is *supposed* to go beats
          // one that merely happens to be a metre closer.
          .sort(
            (a, b) =>
              a.distance / a.entry.duty.urgency - b.distance / b.entry.duty.urgency ||
              Number(a.entry.actor.id) - Number(b.entry.actor.id),
          );

        for (const candidate of candidates.slice(0, Math.floor(shape.pressCount))) {
          candidate.entry.job = RoleJob.PRESS;
          candidate.entry.intent = TeamIntent.PRESS;
          candidate.entry.target = { x: ball.x, y: ball.y };
          pressers.push(candidate.entry.actor.id);
        }
      }

      // 4. Marks. Everybody the duty table says marks, who is not already on the ball.
      if (defending) {
        const markers = working
          .filter(
            (entry) =>
              entry.intent === TeamIntent.SHAPE &&
              (entry.job === RoleJob.MARK || entry.job === RoleJob.COVER),
          )
          .map((entry) => ({
            id: entry.actor.id,
            x: entry.actor.x,
            y: entry.actor.y,
            urgency: entry.duty.urgency,
          }));

        const markables = opponents.map((opponent) => ({
          id: opponent.id,
          x: opponent.x,
          y: opponent.y,
          danger: opponent.id === situation.carrier ? 1 : 0,
        }));

        marks = assignMarks(markers, markables, {
          previous: marks,
          hysteresis: shape.markHysteresis,
          range: shape.markRange,
        });

        const byId = new Map(opponents.map((opponent) => [opponent.id, opponent]));
        for (const entry of working) {
          const markId = marks.get(entry.actor.id);
          if (markId === undefined) continue;
          const target = byId.get(markId);
          if (target === undefined) continue;
          entry.mark = markId;
          entry.job = RoleJob.MARK;
          entry.intent = TeamIntent.MARK;
          entry.target = goalSideSpot(target, goal, shape.markStandoff);
        }
      } else {
        marks = new Map<EntityId, EntityId>();
      }

      // 5. Help. The line from the carrier to the goal is the danger; whoever is closest to it and
      //    is not the reason it exists slides across to sit on it.
      if (defending && shape.helpCount > 0) {
        const carrier =
          situation.carrier === undefined
            ? undefined
            : opponents.find((opponent) => opponent.id === situation.carrier);
        const danger = carrier ?? { x: ball.x, y: ball.y, id: -1 as EntityId };

        const helpers = working
          .filter((entry) => entry.intent !== TeamIntent.PRESS)
          // Never help off the ball: the athlete marking the carrier *is* the defence.
          .filter((entry) => entry.mark === null || entry.mark !== situation.carrier)
          .map((entry) => ({
            entry,
            near: nearestOnSegment(entry.actor, danger, goal),
          }))
          .filter((candidate) => candidate.near.distance <= shape.helpRange)
          .sort(
            (a, b) =>
              a.near.distance - b.near.distance ||
              Number(a.entry.actor.id) - Number(b.entry.actor.id),
          );

        for (const helper of helpers.slice(0, Math.floor(shape.helpCount))) {
          helper.entry.job = RoleJob.COVER;
          helper.entry.intent = TeamIntent.HELP;
          helper.entry.mark = null;
          helper.entry.target = {
            x: danger.x + (goal.x - danger.x) * shape.helpDepth,
            y: danger.y + (goal.y - danger.y) * shape.helpDepth,
          };
        }
      }

      // 6. Spacing, last, so nothing above can put two athletes on the same square metre. Pressers
      //    are exempt: two of them converging on the ball is the point of sending two.
      if (shape.spacing > 0) {
        const placed: Spot[] = [];
        for (const entry of working) {
          if (entry.intent === TeamIntent.PRESS) {
            placed.push(entry.target);
            continue;
          }
          spaced(entry.target, placed, shape.spacing, field);
          placed.push(entry.target);
        }
      }

      const plan: TeamPlan = {
        phase,
        sinceChange,
        pressing: pressers.length > 0,
        pressers,
        assignments: working.map((entry) => ({
          actor: entry.actor.id,
          role: entry.actor.role,
          job: entry.job,
          intent: entry.intent,
          target: entry.target,
          mark: entry.mark,
          urgency: entry.duty.urgency,
        })),
      };
      latest = plan;
      return plan;
    },

    last() {
      return latest;
    },

    reset() {
      sinceChange = options.transitionSteps;
      lastPossession = null;
      marks = new Map<EntityId, EntityId>();
      latest = null;
    },
  };
}

/** One athlete's assignment out of a plan, or `undefined` if the table had no duty for their role. */
export function assignmentFor(plan: TeamPlan, actor: EntityId): Assignment | undefined {
  return plan.assignments.find((assignment) => assignment.actor === actor);
}
