/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.4 — Ball rendering with height, spin, and a shadow that reads as altitude
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §3.2 (ball, fields, dressing)
 *
 * Purpose: the sprite ball's promises, asserted through the recording double rather than pixels —
 * one `drawImage` and its shadow, the altitude pair (a bigger sprite and a smaller shadow at
 * height), deterministic spin frames from distance travelled, and the disc ball still drawing when
 * no ball atlas has been built.
 */
import { describe, expect, it } from 'vitest';
import { World, type EntityId } from '@/engine/world.ts';
import { buildBasketballAtlases, spriteRenderer } from '@/sports/basketball/sprite-art.ts';
import { COURT } from '@/sports/basketball/court.ts';
import { recordingCanvas, recordingOffscreen } from '../../../helpers/canvas.ts';

function arena(): World {
  return new World({ width: COURT.length, height: COURT.width, cellSize: 3, capacity: 8 });
}

function spawnBall(world: World, x: number, y: number, z = 0, radius = 0.12): EntityId {
  return world.spawn({ x, y, z, radius, kind: 1, team: -1 });
}

function renderer() {
  const { factory } = recordingOffscreen();
  return spriteRenderer(buildBasketballAtlases(factory));
}

/** A renderer built from an atlas with no `ball` field, the T-13.4 fallback path. */
function rendererWithoutBall() {
  const { factory } = recordingOffscreen();
  const { teams } = buildBasketballAtlases(factory);
  return spriteRenderer({ teams });
}

describe('the basketball sprite ball', () => {
  it('costs exactly one drawImage for the ball, plus its shadow', () => {
    const world = arena();
    const ball = spawnBall(world, 10, 7, 1);
    const ctx = recordingCanvas();

    renderer().drawBall(ctx, {} as never, world, ball);

    expect(ctx.ofKind('drawImage')).toHaveLength(1);
    expect(ctx.ofKind('arc')).toHaveLength(1); // the shadow; the sprite has no arc calls of its own
    expect(ctx.ofKind('fill').length).toBeGreaterThanOrEqual(1);
  });

  it('lifts and grows the sprite while shrinking the shadow as the ball climbs', () => {
    const groundWorld = arena();
    const groundBall = spawnBall(groundWorld, 10, 7, 0);
    const groundCtx = recordingCanvas();
    renderer().drawBall(groundCtx, {} as never, groundWorld, groundBall);

    const highWorld = arena();
    const highBall = spawnBall(highWorld, 10, 7, 3);
    const highCtx = recordingCanvas();
    renderer().drawBall(highCtx, {} as never, highWorld, highBall);

    const groundShadowRadius = groundCtx.ofKind('arc')[0]?.args[2] as number;
    const highShadowRadius = highCtx.ofKind('arc')[0]?.args[2] as number;
    expect(highShadowRadius).toBeLessThan(groundShadowRadius);

    const groundScale = groundCtx.ofKind('scale')[0]?.args[0] as number;
    const highScale = highCtx.ofKind('scale')[0]?.args[0] as number;
    expect(highScale).toBeGreaterThan(groundScale);

    // The shadow stays on the ground (unchanged y); the sprite itself is translated further up the
    // screen — the altitude pair `13` §3.2 asks for.
    const groundTranslateY = groundCtx.ofKind('translate')[0]?.args[1] as number;
    const highTranslateY = highCtx.ofKind('translate')[0]?.args[1] as number;
    expect(highTranslateY).toBeLessThan(groundTranslateY);
    expect(groundCtx.ofKind('arc')[0]?.args[1]).toBe(highCtx.ofKind('arc')[0]?.args[1]);
  });

  it('picks a spin frame from distance travelled, deterministically — the same flight twice over', () => {
    const path: readonly [number, number, number][] = [
      [10, 7, 0],
      [10.5, 7, 0.4],
      [11.2, 7.1, 0.9],
      [12, 7.2, 0.6],
      [12.9, 7.3, 0.1],
      [13.7, 7.4, 0],
    ];

    function fly(): number[] {
      const world = arena();
      const ball = spawnBall(world, path[0]?.[0] as number, path[0]?.[1] as number);
      const render = renderer();
      const frameXs: number[] = [];

      for (const [x, y, z] of path) {
        world.x[ball] = x;
        world.y[ball] = y;
        world.z[ball] = z;
        const ctx = recordingCanvas();
        render.drawBall(ctx, {} as never, world, ball);
        const call = ctx.ofKind('drawImage')[0];
        frameXs.push(call?.args[1] as number);
      }
      return frameXs;
    }

    const first = fly();
    const second = fly();
    expect(second).toEqual(first);
    // The path covers several ball circumferences, so it is not one frame the whole way.
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it('still draws the disc ball when no ball atlas is supplied', () => {
    const world = arena();
    const ball = spawnBall(world, 10, 7, 1);
    const ctx = recordingCanvas();

    rendererWithoutBall().drawBall(ctx, {} as never, world, ball);

    expect(ctx.ofKind('drawImage')).toHaveLength(0);
    expect(ctx.ofKind('arc').length).toBeGreaterThan(0);
  });
});
