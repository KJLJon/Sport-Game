/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.3 — Team coordination: formation shape, phase of play, pressing triggers, help defence, transition
 * @story   US-7.1 — Play against the computer
 * @design  06-game-design.md §5
 */
import { describe, expect, it } from 'vitest';
import { PlayPhase, RoleJob, duties, type DutyTable } from '../../../src/engine/ai/roles.ts';
import {
  TeamIntent,
  advance,
  assignmentFor,
  compact,
  createTeam,
  nearestOnSegment,
  type Opponent,
  type TeamActor,
  type TeamOptions,
  type TeamPlan,
  type TeamSituation,
} from '../../../src/engine/ai/team.ts';

const FIELD = { width: 100, height: 50 };
const TRANSITION_STEPS = 10;

/**
 * Three roles, one per band, with jobs that differ by phase the way a real table's do: the back
 * marks when defending, the midfielder presses, the forward runs.
 */
const TABLE: DutyTable = {
  back: duties(
    { anchor: { x: 0.15, y: 0.5 }, ballShade: 0.2, leash: 0.2, job: RoleJob.SUPPORT, urgency: 0.3 },
    {
      [PlayPhase.DEFEND]: { job: RoleJob.MARK },
      [PlayPhase.TRANSITION]: { job: RoleJob.COVER },
    },
  ),
  mid: duties(
    { anchor: { x: 0.5, y: 0.5 }, ballShade: 0.4, leash: 0.3, job: RoleJob.SUPPORT, urgency: 0.9 },
    { [PlayPhase.DEFEND]: { job: RoleJob.MARK } },
  ),
  fwd: duties(
    {
      anchor: { x: 0.8, y: 0.5 },
      ballShade: 0.4,
      leash: 0.3,
      job: RoleJob.RUN_BEHIND,
      urgency: 0.5,
    },
    { [PlayPhase.DEFEND]: { job: RoleJob.PRESS } },
  ),
};

const actor = (id: number, role: string, x: number, y = 25): TeamActor => ({ id, role, x, y });
const opponent = (id: number, x: number, y = 25): Opponent => ({ id, x, y });

const team = (over: Partial<TeamOptions> = {}) =>
  createTeam({
    side: 0,
    table: TABLE,
    field: FIELD,
    transitionSteps: TRANSITION_STEPS,
    ...over,
  });

const situation = (over: Partial<TeamSituation> = {}): TeamSituation => ({
  mates: [actor(1, 'back', 15), actor(2, 'mid', 50), actor(3, 'fwd', 80)],
  opponents: [opponent(11, 30), opponent(12, 55), opponent(13, 70)],
  ball: { x: 50, y: 25 },
  possession: 0,
  ...over,
});

/** Runs enough steps for the transition beat to expire, and returns the last plan. */
function settle(coordinator: ReturnType<typeof team>, input: TeamSituation): TeamPlan {
  let plan = coordinator.plan(input);
  for (let step = 0; step < TRANSITION_STEPS; step++) plan = coordinator.plan(input);
  return plan;
}

describe('advance', () => {
  it('measures how far up a side attacks, each from its own end', () => {
    expect(advance(25, 100, 0)).toBeCloseTo(0.25);
    expect(advance(25, 100, 1)).toBeCloseTo(0.75);
  });

  it('is zero on a field with no width rather than infinite', () => {
    expect(advance(10, 0, 0)).toBe(0);
  });

  it('clamps a ball that has left the field', () => {
    expect(advance(120, 100, 0)).toBe(1);
    expect(advance(-20, 100, 0)).toBe(0);
  });
});

describe('compact', () => {
  it('pulls every target towards the unit centre without moving the centre', () => {
    const targets = [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ];

    compact(targets, 0.5);

    expect(targets[0]).toEqual({ x: 25, y: 12.5 });
    expect(targets[1]).toEqual({ x: 75, y: 37.5 });
  });

  it('does nothing at zero and everything at one', () => {
    const loose = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    compact(loose, 0);
    expect(loose[0]).toEqual({ x: 0, y: 0 });

    compact(loose, 2);
    expect(loose[0]).toEqual({ x: 5, y: 5 });
    expect(loose[1]).toEqual({ x: 5, y: 5 });
  });

  it('survives an empty unit', () => {
    expect(() => compact([], 0.5)).not.toThrow();
  });
});

describe('nearestOnSegment', () => {
  it('finds the foot of the perpendicular', () => {
    const near = nearestOnSegment({ x: 5, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 });

    expect(near.x).toBeCloseTo(5);
    expect(near.distance).toBeCloseTo(4);
  });

  it('clamps to the ends rather than running off the line', () => {
    expect(nearestOnSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }).x).toBe(0);
    expect(nearestOnSegment({ x: 50, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }).x).toBe(10);
  });

  it('treats a segment of no length as the point it is', () => {
    const near = nearestOnSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 });

    expect(near.distance).toBeCloseTo(5);
  });
});

describe('phase of play', () => {
  it('opens out of transition rather than in it — a kick-off is not a turnover', () => {
    expect(team().plan(situation()).phase).not.toBe(PlayPhase.TRANSITION);
  });

  it('enters transition when the ball changes hands and leaves it on the sport own beat', () => {
    const coordinator = team();
    coordinator.plan(situation());

    const lost = coordinator.plan(situation({ possession: 1 }));
    expect(lost.phase).toBe(PlayPhase.TRANSITION);
    expect(lost.sinceChange).toBe(0);

    let plan = lost;
    for (let step = 0; step < TRANSITION_STEPS - 1; step++) {
      plan = coordinator.plan(situation({ possession: 1 }));
    }
    expect(plan.phase).toBe(PlayPhase.TRANSITION);

    expect(coordinator.plan(situation({ possession: 1 })).phase).toBe(PlayPhase.DEFEND);
  });

  it('does not restart transition on a loose ball — a deflection is not a turnover', () => {
    const coordinator = team();
    settle(coordinator, situation({ possession: 1 }));

    const loose = coordinator.plan(situation({ possession: -1 }));
    expect(loose.phase).toBe(PlayPhase.DEFEND);

    const regained = coordinator.plan(situation({ possession: 1 }));
    expect(regained.phase).toBe(PlayPhase.DEFEND);
  });

  it('separates build-up from attack by where the ball is', () => {
    const deep = settle(team(), situation({ ball: { x: 20, y: 25 } }));
    expect(deep.phase).toBe(PlayPhase.BUILD_UP);

    const high = settle(team(), situation({ ball: { x: 80, y: 25 } }));
    expect(high.phase).toBe(PlayPhase.ATTACK);
  });
});

describe('shape', () => {
  it('puts every role where its duty says, and skips a role the table has never heard of', () => {
    const plan = settle(
      team({ shape: { compactness: 0 } }),
      situation({ mates: [actor(1, 'back', 15), actor(9, 'sweeper', 5)] }),
    );

    expect(plan.assignments).toHaveLength(1);
    expect(assignmentFor(plan, 9)).toBeUndefined();
    // Anchor 0.15 of 100, shaded a fifth of the way to a ball on halfway.
    expect(assignmentFor(plan, 1)?.target.x).toBeCloseTo(15 + (50 - 15) * 0.2);
  });

  it('compacts the block when defending and lets the shape run long in possession', () => {
    const input = situation({ possession: 1, ball: { x: 20, y: 25 } });
    const blocked = settle(team({ shape: { pressCount: 0, helpCount: 0 } }), input);
    const spread = settle(team({ shape: { pressCount: 0, helpCount: 0, compactness: 0 } }), input);

    const width = (plan: TeamPlan) =>
      Math.max(...plan.assignments.map((a) => a.target.x)) -
      Math.min(...plan.assignments.map((a) => a.target.x));

    expect(width(blocked)).toBeLessThan(width(spread));
  });

  it('keeps two roles with the same duty off each other when spacing is on', () => {
    const twins: DutyTable = { twin: TABLE.back! };
    const plan = settle(
      team({
        table: twins,
        shape: { spacing: 6, pressCount: 0, helpCount: 0, compactness: 0 },
      }),
      situation({ mates: [actor(1, 'twin', 15), actor(2, 'twin', 15)], possession: 0 }),
    );

    const [first, second] = plan.assignments;
    const gap = Math.hypot(
      (first?.target.x ?? 0) - (second?.target.x ?? 0),
      (first?.target.y ?? 0) - (second?.target.y ?? 0),
    );
    expect(gap).toBeGreaterThanOrEqual(6 - 1e-6);
  });

  it('reads the field backwards for the other side', () => {
    const plan = settle(
      team({ side: 1, shape: { compactness: 0 } }),
      situation({ mates: [actor(1, 'back', 85)], ball: { x: 50, y: 25 }, possession: 1 }),
    );

    expect(assignmentFor(plan, 1)?.target.x).toBeCloseTo(85 - (85 - 50) * 0.2);
  });
});

describe('pressing triggers', () => {
  const chasing = situation({ possession: 1, ball: { x: 40, y: 25 }, carrier: 11 });

  it('sends the named few and leaves everybody else in the shape', () => {
    const plan = settle(team({ shape: { pressCount: 1, helpCount: 0 } }), chasing);

    expect(plan.pressing).toBe(true);
    expect(plan.pressers).toEqual([2]);
    expect(assignmentFor(plan, 2)?.job).toBe(RoleJob.PRESS);
    expect(assignmentFor(plan, 2)?.target).toEqual({ x: 40, y: 25 });
    expect(assignmentFor(plan, 3)?.intent).not.toBe(TeamIntent.PRESS);
  });

  it('sends more when the shape says to press harder', () => {
    const plan = settle(team({ shape: { pressCount: 2, helpCount: 0 } }), chasing);

    expect(plan.pressers).toHaveLength(2);
  });

  it('never presses the ball it already has', () => {
    const plan = settle(team({ shape: { pressCount: 2 } }), situation({ possession: 0 }));

    expect(plan.pressing).toBe(false);
    expect(plan.pressers).toEqual([]);
  });

  it('holds the line when the ball is above it, and goes anyway on the cue the sport spots', () => {
    const high = situation({ possession: 1, ball: { x: 90, y: 25 }, carrier: 13 });

    expect(settle(team({ shape: { pressLine: 0.6, helpCount: 0 } }), high).pressing).toBe(false);
    expect(
      settle(team({ shape: { pressLine: 0.6, helpCount: 0 } }), { ...high, trigger: true })
        .pressing,
    ).toBe(true);
    expect(settle(team({ shape: { pressLine: 1, helpCount: 0 } }), high).pressing).toBe(true);
  });

  it('will not send somebody from the other end of the field', () => {
    const plan = settle(
      team({ shape: { pressRange: 5, helpCount: 0 } }),
      situation({ possession: 1, ball: { x: 40, y: 25 }, carrier: 11 }),
    );

    expect(plan.pressing).toBe(false);
  });

  it('chases a loose ball, which belongs to nobody', () => {
    const plan = settle(
      team({ shape: { helpCount: 0 } }),
      situation({ possession: -1, ball: { x: 40, y: 25 } }),
    );

    expect(plan.pressing).toBe(true);
  });

  it('sends nobody at all when the shape says never', () => {
    expect(settle(team({ shape: { pressCount: 0 } }), chasing).pressing).toBe(false);
  });
});

describe('marking', () => {
  const defending = situation({
    possession: 1,
    ball: { x: 30, y: 25 },
    carrier: 11,
    opponents: [opponent(11, 30), opponent(12, 40, 10)],
  });

  it('puts markers goal-side of a man, and the carrier is picked up first', () => {
    const plan = settle(
      team({ shape: { pressCount: 0, helpCount: 0, markStandoff: 2 } }),
      defending,
    );

    const marked = plan.assignments.filter((assignment) => assignment.mark !== null);
    expect(marked.map((assignment) => assignment.mark)).toContain(11);
    for (const assignment of marked) {
      expect(assignment.intent).toBe(TeamIntent.MARK);
      expect(assignment.job).toBe(RoleJob.MARK);
    }

    const onCarrier = marked.find((assignment) => assignment.mark === 11);
    // Two metres in front of a carrier on x=30, towards a goal on x=0.
    expect(onCarrier?.target.x).toBeCloseTo(28);
  });

  it('does not mark anybody while we have the ball', () => {
    const plan = settle(team(), situation({ possession: 0 }));

    expect(plan.assignments.every((assignment) => assignment.mark === null)).toBe(true);
  });

  it('keeps a mark from tick to tick as the attacker moves', () => {
    const coordinator = team({ shape: { pressCount: 0, helpCount: 0, markHysteresis: 8 } });
    const first = settle(coordinator, defending);
    const held = first.assignments.find((assignment) => assignment.mark === 12);

    // The attacker drifts past the other defender; the mark should not change hands for it.
    const drifted = coordinator.plan({
      ...defending,
      opponents: [opponent(11, 30), opponent(12, 18, 25)],
    });

    expect(drifted.assignments.find((assignment) => assignment.mark === 12)?.actor).toBe(
      held?.actor,
    );
  });

  it('forgets its marks and its possession clock on reset', () => {
    const coordinator = team();
    settle(coordinator, defending);
    expect(coordinator.last()).not.toBeNull();

    coordinator.reset();
    expect(coordinator.last()).toBeNull();
    expect(coordinator.plan(defending).phase).not.toBe(PlayPhase.TRANSITION);
  });
});

describe('help defence', () => {
  const danger = situation({
    possession: 1,
    ball: { x: 30, y: 25 },
    carrier: 11,
    opponents: [opponent(11, 30, 25), opponent(12, 90, 5)],
    mates: [actor(1, 'back', 12, 25), actor(2, 'mid', 20, 22), actor(3, 'fwd', 60, 25)],
  });

  it('slides somebody onto the line between the carrier and the goal', () => {
    const plan = settle(
      team({ shape: { pressCount: 0, helpCount: 1, helpRange: 20, helpDepth: 0.5 } }),
      danger,
    );

    const helper = plan.assignments.find((assignment) => assignment.intent === TeamIntent.HELP);
    expect(helper).toBeDefined();
    expect(helper?.job).toBe(RoleJob.COVER);
    expect(helper?.mark).toBeNull();
    expect(helper?.target.x).toBeCloseTo(15);
  });

  it('never helps off the ball — the carrier keeps their marker', () => {
    const plan = settle(team({ shape: { pressCount: 0, helpCount: 3, helpRange: 60 } }), danger);

    const onCarrier = plan.assignments.find((assignment) => assignment.mark === 11);
    expect(onCarrier).toBeDefined();
    expect(onCarrier?.intent).toBe(TeamIntent.MARK);
  });

  it('caps how many leave their man', () => {
    const plan = settle(team({ shape: { pressCount: 0, helpCount: 1, helpRange: 60 } }), danger);

    expect(
      plan.assignments.filter((assignment) => assignment.intent === TeamIntent.HELP),
    ).toHaveLength(1);
  });

  it('sends nobody from too far away to arrive', () => {
    const plan = settle(team({ shape: { pressCount: 0, helpCount: 2, helpRange: 5 } }), {
      ...danger,
      // The same three, but on the far touchline: nobody is within reach of the danger line.
      mates: [actor(1, 'back', 12, 48), actor(2, 'mid', 20, 47), actor(3, 'fwd', 60, 45)],
    });

    expect(plan.assignments.some((assignment) => assignment.intent === TeamIntent.HELP)).toBe(
      false,
    );
  });

  it('covers the ball itself when nobody is carrying it', () => {
    const plan = settle(
      team({ shape: { pressCount: 0, helpCount: 1, helpRange: 30, helpDepth: 0.5 } }),
      // The same picture with the ball on the floor: the danger line starts at the ball itself.
      situation({
        possession: 1,
        ball: danger.ball,
        mates: danger.mates,
        opponents: danger.opponents,
      }),
    );

    const helper = plan.assignments.find((assignment) => assignment.intent === TeamIntent.HELP);
    expect(helper?.target.x).toBeCloseTo(15);
  });
});

describe('determinism', () => {
  it('two coordinators fed the same match agree on every tick (INV-8)', () => {
    const a = team({ shape: { spacing: 4, pressCount: 2, helpCount: 1 } });
    const b = team({ shape: { spacing: 4, pressCount: 2, helpCount: 1 } });

    for (let step = 0; step < 40; step++) {
      const input = situation({
        possession: step < 12 ? 0 : step < 20 ? -1 : 1,
        ball: { x: 20 + step, y: 25 - step * 0.3 },
        ...(step >= 20 ? { carrier: 11 } : {}),
        opponents: [opponent(11, 30 - step * 0.5), opponent(12, 55), opponent(13, 70)],
      });

      expect(a.plan(input)).toEqual(b.plan(input));
    }
  });

  it('plans nothing at all for a team with nobody on the field', () => {
    const plan = team().plan(situation({ mates: [] }));

    expect(plan.assignments).toEqual([]);
    expect(plan.pressers).toEqual([]);
    expect(plan.pressing).toBe(false);
  });
});
