/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.2 — Role system: per-sport role tables driving off-ball movement and responsibility
 * @story   US-7.1 — Play against the computer, US-3.3 — Face a CPU that plays basketball
 * @design  06-game-design.md §5 (Team / Role / Athlete), 03 §Phase 7
 * @invariant INV-5 (the engine holds the shape of a duty; only this file knows it is basketball)
 *
 * Purpose: what each of the five positions is *for*, in each phase of play. The spots in
 * `cpu.ts` — `offensiveSpot`, `zoneSpot` — say where an athlete stands; this says why, and it is
 * what T-7.4 reads to give the CPU off-ball movement instead of five athletes orbiting the ball.
 *
 * Fractions are measured from the basket this side defends, so `x: 0.85` is deep in the *other*
 * team's half. `y` runs across the floor, `0.5` being the middle.
 *
 * **Why the guards' leash is long and the centre's is short.** A leash is how far the ball may drag
 * a position off its anchor, and it is the one number that stops a role table from collapsing into
 * "everyone follows the ball". A point guard genuinely does go and get it; a centre who leaves the
 * paint to chase a ball on the wing has given up the rebound and the rim in one movement.
 */
import { PlayPhase, RoleJob, duties, type DutyTable } from '../../engine/ai/roles.ts';

/**
 * The five, keyed by `RoleTable` id. Deliberately the same ids the seam already publishes, so a
 * lineup screen, the renderer, and the AI all name a position the same way.
 *
 * @spec-ref 06-game-design.md §5 — "what this position should be doing in this phase"
 */
export const BASKETBALL_DUTIES: DutyTable = {
  PG: duties(
    {
      anchor: { x: 0.72, y: 0.5 },
      ballShade: 0.55,
      leash: 0.3,
      job: RoleJob.SUPPORT,
      urgency: 0.8,
    },
    {
      // Bringing it up: high, central, and the one who actually goes and gets it.
      [PlayPhase.BUILD_UP]: { anchor: { x: 0.6, y: 0.5 }, ballShade: 0.7, urgency: 1 },
      // First back, always. A point guard who crashes the glass is why teams give up fast breaks.
      [PlayPhase.TRANSITION]: { anchor: { x: 0.55, y: 0.5 }, job: RoleJob.COVER, urgency: 0.5 },
      [PlayPhase.DEFEND]: { anchor: { x: 0.28, y: 0.5 }, job: RoleJob.MARK, urgency: 0.9 },
    },
  ),
  SG: duties(
    {
      anchor: { x: 0.78, y: 0.16 },
      ballShade: 0.4,
      leash: 0.24,
      job: RoleJob.HOLD_SHAPE,
      urgency: 0.5,
    },
    {
      // Spot up: the shooter's job off the ball is to be *findable*, not to be near the ball.
      [PlayPhase.ATTACK]: { job: RoleJob.SUPPORT, ballShade: 0.3 },
      // Run the lane. The wing who fills it is the reason a break is worth starting.
      [PlayPhase.TRANSITION]: {
        anchor: { x: 0.86, y: 0.14 },
        job: RoleJob.RUN_BEHIND,
        urgency: 0.7,
      },
      [PlayPhase.DEFEND]: { anchor: { x: 0.22, y: 0.2 }, job: RoleJob.MARK, urgency: 0.8 },
    },
  ),
  SF: duties(
    {
      anchor: { x: 0.78, y: 0.84 },
      ballShade: 0.4,
      leash: 0.24,
      job: RoleJob.HOLD_SHAPE,
      urgency: 0.55,
    },
    {
      [PlayPhase.ATTACK]: { job: RoleJob.SUPPORT, ballShade: 0.3 },
      [PlayPhase.TRANSITION]: {
        anchor: { x: 0.86, y: 0.86 },
        job: RoleJob.RUN_BEHIND,
        urgency: 0.7,
      },
      [PlayPhase.DEFEND]: { anchor: { x: 0.22, y: 0.8 }, job: RoleJob.MARK, urgency: 0.85 },
    },
  ),
  PF: duties(
    {
      anchor: { x: 0.83, y: 0.34 },
      ballShade: 0.3,
      leash: 0.18,
      job: RoleJob.CRASH,
      urgency: 0.6,
    },
    {
      [PlayPhase.BUILD_UP]: { anchor: { x: 0.74, y: 0.3 }, job: RoleJob.HOLD_SHAPE, urgency: 0.4 },
      // Trailer, not sprinter: the four arrives after the break, which is when the rebound arrives.
      [PlayPhase.TRANSITION]: { anchor: { x: 0.6, y: 0.4 }, job: RoleJob.SUPPORT, urgency: 0.5 },
      [PlayPhase.DEFEND]: { anchor: { x: 0.16, y: 0.36 }, job: RoleJob.COVER, urgency: 0.75 },
    },
  ),
  C: duties(
    {
      anchor: { x: 0.87, y: 0.55 },
      ballShade: 0.22,
      leash: 0.14,
      job: RoleJob.CRASH,
      urgency: 0.5,
    },
    {
      [PlayPhase.BUILD_UP]: { anchor: { x: 0.78, y: 0.55 }, job: RoleJob.HOLD_SHAPE, urgency: 0.3 },
      // Last back. Somebody has to protect the rim while four people run.
      [PlayPhase.TRANSITION]: { anchor: { x: 0.5, y: 0.5 }, job: RoleJob.COVER, urgency: 0.35 },
      // The rim, and the help. `shouldHelp()` in cpu.ts is this duty in code.
      [PlayPhase.DEFEND]: { anchor: { x: 0.12, y: 0.5 }, job: RoleJob.COVER, urgency: 0.7 },
    },
  ),
};

/**
 * How many steps after a change of possession still counts as transition, for basketball. A fast
 * break is decided in about a second and a half, and a shape that resets instantly never gives one
 * up — nor ever scores on one.
 */
export const BASKETBALL_TRANSITION_STEPS = 90;
