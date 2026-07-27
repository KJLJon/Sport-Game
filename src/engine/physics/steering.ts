/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.4 — Movement & steering: seek, arrive, pursue, avoid
 * @story   US-2.1 — Control my athlete with a virtual joystick
 * @design  04-architecture.md §6 (movement), §6 (AI — steering feeds the utility layer)
 * @invariant INV-2, INV-8
 *
 * Purpose: the four behaviours every off-ball decision is built from. Each one answers "what
 * velocity do I want this instant", and `integrate()` decides what the body can actually do about
 * it — so a slow athlete and a quick one running the same behaviour move differently without the
 * behaviour knowing anything about them.
 *
 * Every function writes into a caller-owned `Vec2` and returns it. Nothing here allocates, because
 * these run per entity per step for 22 entities (`01` R2).
 */
import type { EntityId, World } from '../world.ts';
import { limit, type Vec2 } from './movement.ts';

/** Full speed straight at a point. The bluntest behaviour, and the right one surprisingly often. */
export function seek(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  maxSpeed: number,
  out: Vec2,
): Vec2 {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);

  if (distance === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }

  out.x = (dx / distance) * maxSpeed;
  out.y = (dy / distance) * maxSpeed;
  return out;
}

/** Directly away from a point — the same maths with the sign flipped. */
export function flee(
  fromX: number,
  fromY: number,
  awayFromX: number,
  awayFromY: number,
  maxSpeed: number,
  out: Vec2,
): Vec2 {
  seek(fromX, fromY, awayFromX, awayFromY, maxSpeed, out);
  out.x = -out.x;
  out.y = -out.y;
  return out;
}

/**
 * Seek, but slowing inside `slowRadius` so the athlete settles on the spot instead of oscillating
 * around it. This is what a player receiving a pass or taking up a defensive position does; plain
 * `seek` would have them shuttle back and forth across the target forever.
 */
export function arrive(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  maxSpeed: number,
  slowRadius: number,
  out: Vec2,
  stopRadius = 0.05,
): Vec2 {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);

  if (distance <= stopRadius || distance === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }

  const speed =
    distance >= slowRadius || slowRadius <= 0 ? maxSpeed : maxSpeed * (distance / slowRadius);
  out.x = (dx / distance) * speed;
  out.y = (dy / distance) * speed;
  return out;
}

/**
 * Seeks where the target *will be*, not where it is. Prediction time scales with distance and
 * closing speed, and is capped — predicting three seconds ahead of a jinking winger produces a
 * defender running at empty grass.
 */
export function pursue(
  fromX: number,
  fromY: number,
  targetX: number,
  targetY: number,
  targetVx: number,
  targetVy: number,
  maxSpeed: number,
  out: Vec2,
  maxPrediction = 1.2,
): Vec2 {
  const dx = targetX - fromX;
  const dy = targetY - fromY;
  const distance = Math.hypot(dx, dy);

  // With no closing speed to divide by, prediction is meaningless — just go there.
  const prediction = maxSpeed <= 0 ? 0 : Math.min(distance / maxSpeed, maxPrediction);

  return seek(
    fromX,
    fromY,
    targetX + targetVx * prediction,
    targetY + targetVy * prediction,
    maxSpeed,
    out,
  );
}

/** Pursue's mirror: run to where the threat *won't* be. */
export function evade(
  fromX: number,
  fromY: number,
  threatX: number,
  threatY: number,
  threatVx: number,
  threatVy: number,
  maxSpeed: number,
  out: Vec2,
  maxPrediction = 1.2,
): Vec2 {
  pursue(fromX, fromY, threatX, threatY, threatVx, threatVy, maxSpeed, out, maxPrediction);
  out.x = -out.x;
  out.y = -out.y;
  return out;
}

/**
 * Steers away from nearby entities, weighted by how close they are — the thing that stops five
 * teammates converging into one pixel when they all want the same ball.
 *
 * Weighting by `1 - d/radius` rather than by `1/d` on purpose: an inverse-square repulsion makes
 * two athletes who touch fire apart at absurd speed, which reads as a bug even when the physics
 * is defensible. Contact forces are T-1.5's job; this is only spacing.
 */
export function separate(
  world: World,
  id: EntityId,
  radius: number,
  maxSpeed: number,
  scratch: Int32Array,
  out: Vec2,
): Vec2 {
  const found = world.queryNeighbours(id, radius, scratch);
  const x = world.x[id] as number;
  const y = world.y[id] as number;

  out.x = 0;
  out.y = 0;
  if (found === 0) return out;

  let contributions = 0;
  for (let i = 0; i < found; i++) {
    const other = scratch[i] as number;
    const dx = x - (world.x[other] as number);
    const dy = y - (world.y[other] as number);
    const distance = Math.hypot(dx, dy);

    if (distance === 0) continue; // exactly coincident: no direction to push in
    const weight = 1 - distance / radius;
    out.x += (dx / distance) * weight;
    out.y += (dy / distance) * weight;
    contributions++;
  }

  if (contributions === 0) return out;

  const length = Math.hypot(out.x, out.y);
  if (length === 0) return out;

  out.x = (out.x / length) * maxSpeed;
  out.y = (out.y / length) * maxSpeed;
  return out;
}

/**
 * Steers around a single circular obstacle, but only when the athlete is actually heading into it.
 * Sidestepping something you were never going to hit is the classic avoidance bug: everyone
 * shuffles sideways for no visible reason.
 *
 * Returns `false` and leaves `out` alone when no avoidance is needed, so callers can fall through
 * to their real intent rather than blending in a zero vector.
 */
export function avoid(
  fromX: number,
  fromY: number,
  vx: number,
  vy: number,
  obstacleX: number,
  obstacleY: number,
  obstacleRadius: number,
  maxSpeed: number,
  out: Vec2,
  lookahead = 1.0,
): boolean {
  const speed = Math.hypot(vx, vy);
  if (speed === 0) return false;

  const dirX = vx / speed;
  const dirY = vy / speed;

  const toObstacleX = obstacleX - fromX;
  const toObstacleY = obstacleY - fromY;

  // How far along our path the obstacle sits. Behind us, or beyond the lookahead, is not our
  // problem this step.
  const along = toObstacleX * dirX + toObstacleY * dirY;
  const range = speed * lookahead;
  if (along <= 0 || along > range) return false;

  // Perpendicular distance from our path to the obstacle centre.
  const acrossX = toObstacleX - dirX * along;
  const acrossY = toObstacleY - dirY * along;
  const across = Math.hypot(acrossX, acrossY);
  if (across > obstacleRadius) return false;

  // Push perpendicular to travel, on the side we are already drifting towards. Choosing the near
  // side keeps the dodge short; picking a side at random would break determinism (INV-2).
  const side = acrossX * -dirY + acrossY * dirX <= 0 ? 1 : -1;
  const urgency = 1 - across / obstacleRadius;

  out.x = dirX * maxSpeed + -dirY * side * maxSpeed * urgency;
  out.y = dirY * maxSpeed + dirX * side * maxSpeed * urgency;
  limit(out, maxSpeed);
  return true;
}

/**
 * Weighted sum of behaviours, clamped to `maxSpeed`. Priority-based arbitration (take the first
 * behaviour that fires) is the usual alternative and produces visibly twitchy movement as the
 * winner flips between steps; blending is smoother and one line simpler.
 */
export function blend(out: Vec2, maxSpeed: number, ...weighted: readonly [Vec2, number][]): Vec2 {
  out.x = 0;
  out.y = 0;

  for (const [vector, weight] of weighted) {
    out.x += vector.x * weight;
    out.y += vector.y * weight;
  }

  return limit(out, maxSpeed);
}
