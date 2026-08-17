/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
 * @task    T-13.6 — Depth sorting and occlusion
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §2.4, §2.3
 *
 * Purpose: the sprite renderer's promises, asserted through the recording double rather than by
 * looking at pixels — one `drawImage` per athlete at full detail, athletes drawn in depth order
 * whatever order the world hands them over in, and the disc renderer still doing the work at the
 * far LOD tier.
 */
import { describe, expect, it } from 'vitest';
import { Detail, type EntityLod } from '@/engine/render/renderer.ts';
import { World, type EntityId } from '@/engine/world.ts';
import { buildBasketballAtlases, kitsFor, spriteRenderer } from '@/sports/basketball/sprite-art.ts';
import { courtKey } from '@/sports/basketball/court-render.ts';
import { COURT } from '@/sports/basketball/court.ts';
import { recordingCanvas, recordingOffscreen } from '../../../helpers/canvas.ts';

const VIEW = { x: 0, y: 0, scale: 20, width: 360, height: 640 };

function arena(): World {
  return new World({ width: COURT.length, height: COURT.width, cellSize: 3, capacity: 32 });
}

function squad(world: World, count = 10): EntityId[] {
  return Array.from({ length: count }, (_, i) =>
    world.spawn({
      x: 2 + i * 2,
      // Descending y, so a renderer that ignored depth would draw them exactly backwards.
      y: COURT.width - 1 - i * 0.8,
      radius: 0.42,
      team: i % 2,
      kind: 0,
      vx: 3,
      vy: 0,
    }),
  );
}

function renderer() {
  const { factory, images } = recordingOffscreen();
  return { render: spriteRenderer(buildBasketballAtlases(factory)), images };
}

/** An LOD that answers with one fixed tier, which is how each tier gets tested in isolation. */
function fixedLod(detail: ReturnType<EntityLod['detail']>): EntityLod {
  return { detail: () => detail };
}

describe('the basketball sprite renderer', () => {
  it('costs exactly one drawImage per athlete at full detail', () => {
    const world = arena();
    squad(world);
    const ctx = recordingCanvas();

    renderer().render.drawAthletes(ctx, {} as never, world, -1 as EntityId, fixedLod(Detail.FULL));

    expect(ctx.ofKind('drawImage')).toHaveLength(10);
  });

  it('draws them in depth order — larger y last — however they were spawned', () => {
    const world = arena();
    squad(world);
    const ctx = recordingCanvas();

    renderer().render.drawAthletes(
      ctx,
      {} as never,
      world,
      -1 as EntityId,
      fixedLod(Detail.REDUCED),
    );

    const ys = ctx.ofKind('translate').map((call) => call.args[1] as number);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys.length).toBeGreaterThan(1);
  });

  it('turns pixel smoothing off, because a 32×48 sprite is meant to have edges', () => {
    const world = arena();
    squad(world, 1);
    const ctx = recordingCanvas();
    ctx.imageSmoothingEnabled = true;

    renderer().render.drawAthletes(ctx, {} as never, world, -1 as EntityId);

    expect(ctx.imageSmoothingEnabled).toBe(false);
  });

  it('keeps the disc dot at the far tier, where a sprite is a smudge', () => {
    const world = arena();
    squad(world);
    const ctx = recordingCanvas();

    renderer().render.drawAthletes(
      ctx,
      {} as never,
      world,
      -1 as EntityId,
      fixedLod(Detail.MINIMAL),
    );

    expect(ctx.ofKind('drawImage')).toHaveLength(0);
    expect(ctx.ofKind('arc').length).toBeGreaterThan(0);
  });

  it('draws nothing at all for an athlete the camera has culled', () => {
    const world = arena();
    squad(world);
    const ctx = recordingCanvas();

    renderer().render.drawAthletes(ctx, {} as never, world, -1 as EntityId, fixedLod(null));

    expect(ctx.recorded).toHaveLength(0);
  });

  it('draws the athlete you are steering in full, and rings them, whatever the LOD says', () => {
    const world = arena();
    const [first] = squad(world);
    const ctx = recordingCanvas();

    renderer().render.drawAthletes(
      ctx,
      {} as never,
      world,
      first as EntityId,
      fixedLod(Detail.MINIMAL),
    );

    // Everyone else is a dot; the controlled athlete is a sprite with a ring on the floor.
    expect(ctx.ofKind('drawImage')).toHaveLength(1);
    expect(ctx.ofKind('stroke').length).toBeGreaterThanOrEqual(2);
  });

  it('never draws the ball entity as an athlete', () => {
    const world = arena();
    squad(world, 2);
    world.spawn({ x: 5, y: 5, radius: 0.12, kind: 1, team: -1 });
    const ctx = recordingCanvas();

    renderer().render.drawAthletes(ctx, {} as never, world, -1 as EntityId);

    expect(ctx.ofKind('drawImage')).toHaveLength(2);
  });

  it('keys the static field layer apart from the disc renderer’s', () => {
    const field = { width: COURT.length, height: COURT.width, goals: [] };
    expect(renderer().render.fieldKey(field, VIEW)).not.toBe(courtKey(field, VIEW));
  });

  it('gives the two sides different kit patterns, not two hues of one', () => {
    const [home, away] = kitsFor();
    expect(home.pattern).toBe('solid');
    expect(away.pattern).toBe('stripes');
  });

  it('advances its own clock and nothing in the world (INV-8)', () => {
    const world = arena();
    squad(world, 1);
    const before = [...world.x];
    const { render } = renderer();
    render.advance(0.5);
    render.drawAthletes(recordingCanvas(), {} as never, world, -1 as EntityId);
    expect([...world.x]).toEqual(before);
  });
});
