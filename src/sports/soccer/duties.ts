/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.2 — Role system: per-sport role tables driving off-ball movement and responsibility
 * @story   US-7.1 — Play against the computer, US-4.3 — Face a CPU that plays soccer
 * @design  06-game-design.md §5 (Team / Role / Athlete)
 * @invariant INV-5 (the engine holds the shape of a duty; only this file knows it is soccer)
 *
 * Purpose: what each position in a formation is responsible for, in each phase of play.
 *
 * **Derived from the formation rather than written out beside it.** `formations.ts` already carries
 * every role's home spot and how far it pushes, drops, and tucks — three formations' worth, and a
 * fourth would be a table nobody remembered to extend. So the duties are computed from that data
 * plus the line the role plays in, and adding a formation gives it duties for free. The cost is
 * that a duty cannot be hand-tuned for one role in one formation; the benefit is that the two can
 * never disagree about where a left back stands, which is the failure that actually happens.
 *
 * Phases map onto `formations.ts`'s own three shapes: build-up and attack both read as `building`
 * and `attacking`, defend as `defending`, and transition takes the shape the team is *leaving* —
 * which is the point of transition. The jobs are what this file adds on top.
 */
import {
  PlayPhase,
  RoleJob,
  duties,
  type DutyTable,
  type RoleDuties,
  type RoleJob as Job,
} from '../../engine/ai/roles.ts';
import { DEFAULT_FORMATION, formation, type FormationRole } from './formations.ts';

/** Which band of the pitch a role belongs to. Everything else here follows from it. */
export type Line = 'keeper' | 'defence' | 'midfield' | 'attack';

/**
 * The line a role plays in, from where it stands. By position rather than by id, so a formation
 * that names a role `cdm` or `wb` is classified correctly without this file knowing the word.
 */
export function lineOf(role: FormationRole): Line {
  if (role.id === 'gk') return 'keeper';
  if (role.x < 0.3) return 'defence';
  if (role.x < 0.62) return 'midfield';
  return 'attack';
}

/** Who goes and gets the ball, per line. A back four that all presses is not a back four. */
const URGENCY: Readonly<Record<Line, number>> = {
  keeper: 0.1,
  defence: 0.5,
  midfield: 0.8,
  attack: 0.6,
};

/** What each line is for, per phase. */
const JOBS: Readonly<Record<Line, Readonly<Record<PlayPhase, Job>>>> = {
  keeper: {
    [PlayPhase.BUILD_UP]: RoleJob.SUPPORT,
    [PlayPhase.ATTACK]: RoleJob.COVER,
    [PlayPhase.TRANSITION]: RoleJob.COVER,
    [PlayPhase.DEFEND]: RoleJob.COVER,
  },
  defence: {
    // A back line in build-up is the outlet, not a spectator — it is where the ball starts.
    [PlayPhase.BUILD_UP]: RoleJob.SUPPORT,
    [PlayPhase.ATTACK]: RoleJob.HOLD_SHAPE,
    [PlayPhase.TRANSITION]: RoleJob.COVER,
    [PlayPhase.DEFEND]: RoleJob.MARK,
  },
  midfield: {
    [PlayPhase.BUILD_UP]: RoleJob.SUPPORT,
    [PlayPhase.ATTACK]: RoleJob.SUPPORT,
    // The counter is won or lost in midfield, in both directions.
    [PlayPhase.TRANSITION]: RoleJob.PRESS,
    [PlayPhase.DEFEND]: RoleJob.PRESS,
  },
  attack: {
    [PlayPhase.BUILD_UP]: RoleJob.HOLD_SHAPE,
    [PlayPhase.ATTACK]: RoleJob.RUN_BEHIND,
    [PlayPhase.TRANSITION]: RoleJob.RUN_BEHIND,
    // Forwards defend from the front: they start the press, they do not track runners.
    [PlayPhase.DEFEND]: RoleJob.PRESS,
  },
};

/**
 * How much the ball drags each line off its spot. Rising up the pitch on purpose: a back four holds
 * its shape and slides together, and a forward chases what a back four would be mad to chase.
 */
const BALL_SHADE: Readonly<Record<Line, number>> = {
  keeper: 0.12,
  defence: 0.22,
  midfield: 0.45,
  attack: 0.5,
};

function dutiesFor(role: FormationRole): RoleDuties {
  const line = lineOf(role);
  // The leash is the role's own freedom, out of `formations.ts`: how far it pushes up, drops back,
  // and tucks in is exactly the licence its manager gives it, and the largest of the three is how
  // far it may be dragged in any direction.
  const leash = Math.max(role.push, role.drop, role.tuck);

  return duties(
    {
      anchor: { x: role.x, y: role.y },
      ballShade: BALL_SHADE[line],
      leash,
      job: JOBS[line][PlayPhase.BUILD_UP],
      urgency: URGENCY[line],
    },
    {
      [PlayPhase.BUILD_UP]: {
        anchor: { x: Math.max(0.04, role.x - role.drop), y: role.y },
        job: JOBS[line][PlayPhase.BUILD_UP],
      },
      [PlayPhase.ATTACK]: {
        anchor: { x: Math.min(0.96, role.x + role.push), y: role.y },
        job: JOBS[line][PlayPhase.ATTACK],
      },
      [PlayPhase.TRANSITION]: {
        // Nobody's shape is right in transition, so nobody's leash is short: this is the phase
        // where a full back is suddenly the widest attacker and a striker the first defender.
        leash: leash * 1.6,
        job: JOBS[line][PlayPhase.TRANSITION],
        urgency: Math.min(1, URGENCY[line] + 0.15),
      },
      [PlayPhase.DEFEND]: {
        anchor: {
          x: Math.max(0.03, role.x - role.drop),
          // Tucking in is what makes a defensive block a block: every role narrows towards the
          // middle by its own licence, so the far side of the pitch is deliberately conceded.
          y: role.y + (0.5 - role.y) * role.tuck,
        },
        job: JOBS[line][PlayPhase.DEFEND],
      },
    },
  );
}

/** Every role of a formation, with its duties. Keyed by role id, like the seam's `RoleTable`. */
export function soccerDuties(formationId: string = DEFAULT_FORMATION): DutyTable {
  const table: Record<string, RoleDuties> = {};
  for (const role of formation(formationId).roles) table[role.id] = dutiesFor(role);
  return table;
}

/**
 * Steps after a change of possession that still count as transition, for soccer. Longer than
 * basketball's: a soccer team is spread over a hundred metres and takes correspondingly longer to
 * be in the wrong shape about it.
 */
export const SOCCER_TRANSITION_STEPS = 150;
