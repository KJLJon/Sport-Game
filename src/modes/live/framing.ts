/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.1 — Follow camera: track the active athlete with lookahead, deadzone, and
 *          speed-scaled framing
 * @task    T-12.2 — Dynamic zoom by phase of play
 * @story   US-2.3 — See what is happening on a small screen
 * @design  04-architecture.md §6 (rendering), 06-game-design.md §4 (match presentation)
 * @invariant INV-5 (no sport-specific branching outside the sport), INV-8 (render never feeds the sim)
 *
 * Purpose: reads a running match into the sport-agnostic `FramingSignal` the camera director wants.
 * This is the only file that knows both what a `World` looks like and what the camera needs, and it
 * is deliberately small — everything it produces is a number the engine could have computed for any
 * sport, which is what keeps `engine/render/framing.ts` free of sports.
 *
 * The one convention it relies on is the entity-kind encoding the sports already share: kind `1` is
 * the ball, everything else is an athlete. That is the same assumption `hud.ts` has made since
 * T-2.10; naming it here is an improvement on repeating the literal.
 */
import type { EntityId, World } from '../../engine/world.ts';
import type { FramingSignal } from '../../engine/render/framing.ts';
import type { Side } from '../../engine/match/events.ts';
import type { MatchView } from './match.ts';

/** The ball's entity kind. Shared by every sport module; see the file header. */
const BALL_KIND = 1;

/**
 * The framing signal for this frame.
 *
 * `pressure` is the distance from the ball to the nearest opponent of whoever holds it. With a
 * loose ball there is no "whoever holds it" and so no duel — a fifty-fifty is contested, but it is
 * contested at a distance the camera should be showing both halves of, which is open play's frame
 * rather than a duel's.
 */
export function framingSignal(world: World, view: MatchView, ball: EntityId): FramingSignal {
  const possession = view.status.possession;
  const controlledId = view.status.controlled;

  const controlled =
    controlledId >= 0 && world.kind[controlledId] !== BALL_KIND
      ? {
          x: world.x[controlledId] as number,
          y: world.y[controlledId] as number,
          vx: world.vx[controlledId] as number,
          vy: world.vy[controlledId] as number,
        }
      : null;

  const ballX = world.x[ball] as number;
  const ballY = world.y[ball] as number;

  return {
    ball: {
      x: ballX,
      y: ballY,
      vx: world.vx[ball] as number,
      vy: world.vy[ball] as number,
    },
    controlled,
    pressure: nearestOpponentDistance(world, ballX, ballY, possession),
    possession,
    stoppage: view.status.stoppage,
  };
}

/**
 * Distance from a point to the closest athlete not on `side`, or `Infinity` when `side` is `-1` or
 * nobody qualifies.
 *
 * Exported because it is the part worth testing on its own: everything else in this file is field
 * copying, and this is the number that decides whether the camera thinks it is watching a duel.
 */
export function nearestOpponentDistance(world: World, x: number, y: number, side: Side): number {
  if (side === -1) return Number.POSITIVE_INFINITY;

  let best = Number.POSITIVE_INFINITY;
  world.forEach((id) => {
    if (world.kind[id] === BALL_KIND) return;
    if ((world.team[id] as Side) === side) return;

    const distance = Math.hypot((world.x[id] as number) - x, (world.y[id] as number) - y);
    if (distance < best) best = distance;
  });
  return best;
}
