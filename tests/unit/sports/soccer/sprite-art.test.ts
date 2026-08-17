/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
 * @task    T-13.6 — Depth sorting and occlusion
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §2.4, §2.3
 *
 * Purpose: soccer's sprite renderer keeps the promises basketball's does, plus the one that is its
 * own — the keeper is drawn from the keeper's atlas, which is the reason this seam takes the
 * sport's state at all.
 */
import { describe, expect, it } from 'vitest';
import { Detail, type EntityLod } from '@/engine/render/renderer.ts';
import { World, type EntityId } from '@/engine/world.ts';
import { buildSoccerAtlases, kitsFor, spriteRenderer } from '@/sports/soccer/sprite-art.ts';
import { pitchKey } from '@/sports/soccer/pitch-render.ts';
import { PITCH } from '@/sports/soccer/pitch.ts';
import { recordingCanvas, recordingOffscreen } from '../../../helpers/canvas.ts';

const VIEW = { x: 0, y: 0, scale: 12, width: 360, height: 640 };

function pitch(): World {
  return new World({ width: PITCH.length, height: PITCH.width, cellSize: 6, capacity: 32 });
}

function squad(world: World, count = 8): EntityId[] {
  return Array.from({ length: count }, (_, i) =>
    world.spawn({
      x: 10 + i * 4,
      y: PITCH.width - 4 - i * 2,
      radius: 0.45,
      team: i % 2,
      kind: 0,
      vx: 4,
      vy: 0,
    }),
  );
}

function state(keepers: [EntityId, EntityId]) {
  return { keepers } as never;
}

function renderer() {
  const { factory } = recordingOffscreen();
  const atlases = buildSoccerAtlases(factory);
  return { render: spriteRenderer(atlases), atlases };
}

function fixedLod(detail: ReturnType<EntityLod['detail']>): EntityLod {
  return { detail: () => detail };
}

describe('the soccer sprite renderer', () => {
  it('costs exactly one drawImage per athlete at full detail', () => {
    const world = pitch();
    const ids = squad(world);
    const ctx = recordingCanvas();

    renderer().render.drawAthletes(
      ctx,
      state([ids[0] as EntityId, ids[1] as EntityId]),
      world,
      -1 as EntityId,
      fixedLod(Detail.FULL),
    );

    expect(ctx.ofKind('drawImage')).toHaveLength(8);
  });

  it('draws the keeper out of the keeper atlas, not their team’s', () => {
    const world = pitch();
    const ids = squad(world);
    const keeper = ids[3] as EntityId;
    const ctx = recordingCanvas();
    const { render, atlases } = renderer();

    render.drawAthletes(ctx, state([keeper, -1 as EntityId]), world, -1 as EntityId);

    const images = ctx.ofKind('drawImage').map((call) => call.args[0]);
    expect(images.filter((image) => image === atlases.keeper.image)).toHaveLength(1);
    expect(images.filter((image) => image === atlases.teams[0].image).length).toBeGreaterThan(0);
  });

  it('draws them in depth order — larger y last', () => {
    const world = pitch();
    const ids = squad(world);
    const ctx = recordingCanvas();

    renderer().render.drawAthletes(
      ctx,
      state([ids[0] as EntityId, ids[1] as EntityId]),
      world,
      -1 as EntityId,
      fixedLod(Detail.REDUCED),
    );

    const ys = ctx.ofKind('translate').map((call) => call.args[1] as number);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys.length).toBeGreaterThan(1);
  });

  it('keeps the disc dot at the far tier and draws nothing for a culled athlete', () => {
    const world = pitch();
    const ids = squad(world);
    const keepers = state([ids[0] as EntityId, ids[1] as EntityId]);

    const minimal = recordingCanvas();
    renderer().render.drawAthletes(
      minimal,
      keepers,
      world,
      -1 as EntityId,
      fixedLod(Detail.MINIMAL),
    );
    expect(minimal.ofKind('drawImage')).toHaveLength(0);

    const culled = recordingCanvas();
    renderer().render.drawAthletes(culled, keepers, world, -1 as EntityId, fixedLod(null));
    expect(culled.recorded).toHaveLength(0);
  });

  it('keys the static field layer apart from the disc renderer’s', () => {
    const field = { width: PITCH.length, height: PITCH.width, goals: [] };
    expect(renderer().render.fieldKey(field, VIEW)).not.toBe(pitchKey(field, VIEW));
  });

  it('gives all three kits a pattern of their own', () => {
    const kits = kitsFor();
    expect(new Set([kits.teams[0].pattern, kits.teams[1].pattern, kits.keeper.pattern]).size).toBe(
      3,
    );
  });
});
