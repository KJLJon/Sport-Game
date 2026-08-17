/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §2.4 (render-side animation state), §3.1
 *
 * Purpose: the render-side animation state — that facing holds through a jitter rather than
 * strobing, that the run cycle is a function of the distance actually travelled (so the same path
 * draws the same frames, INV-8), and that the blit falls back rather than throwing when a pose has
 * not been authored yet.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AnimStore, POSE } from '@/engine/render/sprite-anim.ts';
import {
  drawAthleteSprite,
  drawFeetShadow,
  resolveFrame,
  spriteScale,
  SHOULDER_PX,
} from '@/engine/render/sprite-athlete.ts';
import { buildAtlas, paletteFrom, poseKey, type SpriteSheet } from '@/engine/render/atlas.ts';
import { recordingCanvas, recordingOffscreen } from '../../helpers/canvas.ts';

/** A 2×2 white block per authored pose, which is all the blit needs to have something to look up. */
function sheetOf(poses: Readonly<Record<string, number>>): SpriteSheet {
  const grid = { w: 2, h: 2, ax: 1, ay: 1, rows: ['11', '11'] };
  const sheet: Record<string, (typeof grid)[]> = {};
  for (const [pose, frames] of Object.entries(poses)) {
    for (const facing of [0, 1, 2, 6, 7] as const) {
      sheet[poseKey(pose, facing)] = Array.from({ length: frames }, () => grid);
    }
  }
  return sheet;
}

function atlasOf(poses: Readonly<Record<string, number>>) {
  return buildAtlas(
    { body: sheetOf(poses) },
    { body: paletteFrom({ '1': '#ffffff' }) },
    recordingOffscreen().factory,
  );
}

describe('AnimStore — facing', () => {
  it('starts facing south, which is the facing every sheet authors first', () => {
    expect(new AnimStore().get(3).facing).toBe(6);
  });

  it('turns with the velocity', () => {
    const anims = new AnimStore();
    expect(anims.update(1, 0, 0, 1, 0).facing).toBe(0);
    expect(anims.update(1, 0, 0, 0, -1).facing).toBe(2);
  });

  it('holds a facing through a jitter at the boundary rather than strobing', () => {
    const anims = new AnimStore();
    anims.update(1, 0, 0, 1, 0);
    // A hair north of due east: inside the hysteresis band, so the sprite must not flip.
    expect(anims.update(1, 0, 0, 1, -0.4).facing).toBe(0);
    expect(anims.update(1, 0, 0, 1, -1).facing).toBe(1);
  });

  it('keeps one athlete’s state separate from another’s', () => {
    const anims = new AnimStore();
    anims.update(1, 0, 0, 1, 0);
    anims.update(2, 0, 0, -1, 0);
    expect([anims.get(1).facing, anims.get(2).facing]).toEqual([0, 4]);
  });
});

describe('AnimStore — the run cycle', () => {
  it('advances with distance travelled, not with time', () => {
    const anims = new AnimStore({ stride: 6, runFrames: 6 });
    const anim = anims.update(1, 0, 0, 1, 0);
    anim.pose = POSE.run;

    expect(anims.frame(1, anims.update(1, 0.5, 0, 1, 0))).toBe(0);
    expect(anims.frame(1, anims.update(1, 2.5, 0, 1, 0))).toBe(2);
    expect(anims.frame(1, anims.update(1, 6.5, 0, 1, 0))).toBe(0); // wrapped
  });

  it('does not advance for an athlete pinned in place', () => {
    const anims = new AnimStore({ stride: 1, runFrames: 6 });
    const anim = anims.update(1, 4, 4, 5, 0);
    anim.pose = POSE.run;
    for (let i = 0; i < 10; i++) anims.update(1, 4, 4, 5, 0);
    expect(anims.frame(1, anim)).toBe(0);
  });

  it('draws the same frames for the same path, every time (INV-8)', () => {
    const path = fc.array(
      fc.tuple(
        fc.double({ min: -30, max: 30, noNaN: true }),
        fc.double({ min: -15, max: 15, noNaN: true }),
      ),
      {
        minLength: 1,
        maxLength: 40,
      },
    );

    fc.assert(
      fc.property(path, (points) => {
        const frames = (): number[] => {
          const anims = new AnimStore();
          const out: number[] = [];
          for (const [x, y] of points) {
            const anim = anims.update(7, x, y, 1, 0);
            anim.pose = POSE.run;
            out.push(anims.frame(7, anim));
          }
          return out;
        };
        expect(frames()).toEqual(frames());
      }),
      { numRuns: 50 },
    );
  });

  it('is running only above the walk threshold', () => {
    const anims = new AnimStore({ runSpeed: 2 });
    expect(anims.running(anims.update(1, 0, 0, 0.5, 0))).toBe(false);
    expect(anims.running(anims.update(2, 0, 0, 4, 0))).toBe(true);
  });

  it('measures speed from the ground when a dt is supplied', () => {
    const anims = new AnimStore({ runSpeed: 2 });
    anims.update(1, 0, 0, 9, 0, 0.1);
    // Velocity says nine, the ground says one: an athlete against a wall is not running.
    expect(anims.running(anims.update(1, 0.1, 0, 9, 0, 0.1))).toBe(false);
  });
});

describe('AnimStore — the render clock', () => {
  it('cycles the idle pose on the clock and nothing else', () => {
    const anims = new AnimStore({ idleFrames: 2, idleFrameSeconds: 0.5 });
    const anim = anims.update(2, 0, 0, 0, 0);
    expect(anims.frame(2, anim)).toBe(0);
    anims.advance(0.6);
    expect(anims.frame(2, anim)).toBe(1);
    anims.advance(0.6);
    expect(anims.frame(2, anim)).toBe(0);
  });

  it('offsets the cycle by entity id, so a squad does not breathe in lockstep', () => {
    const anims = new AnimStore({ idleFrames: 2, idleFrameSeconds: 0.5 });
    expect(anims.frame(1, anims.update(1, 0, 0, 0, 0))).not.toBe(
      anims.frame(2, anims.update(2, 0, 0, 0, 0)),
    );
  });

  it('ignores a nonsense dt rather than corrupting the clock', () => {
    const anims = new AnimStore();
    anims.advance(Number.NaN);
    anims.advance(-1);
    expect(anims.time).toBe(0);
  });

  it('advances an action pose timer to one and clamps it there', () => {
    const anims = new AnimStore();
    const anim = anims.get(1);
    anim.poseT = 0;
    anims.advance(0.4);
    expect(anim.poseT).toBeCloseTo(0.4, 6);
    anims.advance(5);
    expect(anim.poseT).toBe(1);
  });
});

describe('the athlete blit', () => {
  it('scales a sprite to the shoulders of the entity it replaces', () => {
    expect(spriteScale(0.42)).toBeCloseTo(0.84 / SHOULDER_PX, 9);
  });

  it('mirrors exactly the three unauthored facings', () => {
    const atlas = atlasOf({ idle: 1 });
    expect(resolveFrame(atlas, 'idle', 4, 0)?.mirrored).toBe(true);
    expect(resolveFrame(atlas, 'idle', 0, 0)?.mirrored).toBe(false);
  });

  it('falls back to the first frame of the pose, then to idle', () => {
    const atlas = atlasOf({ idle: 1, run: 2 });
    expect(resolveFrame(atlas, 'run', 6, 5)?.key).toBe('run/6/0');
    expect(resolveFrame(atlas, 'kick', 6, 0)?.key).toBe('idle/6/0');
  });

  it('reports failure rather than throwing when the atlas holds nothing usable', () => {
    const empty = buildAtlas({}, {}, recordingOffscreen().factory);
    const ctx = recordingCanvas();
    expect(
      drawAthleteSprite(ctx, empty, { x: 0, y: 0, radius: 0.4, facing: 6, pose: 'run', frame: 0 }),
    ).toBe(false);
    expect(ctx.ofKind('drawImage')).toHaveLength(0);
  });

  it('costs exactly one drawImage', () => {
    const atlas = atlasOf({ idle: 1 });
    const ctx = recordingCanvas();
    drawAthleteSprite(ctx, atlas, { x: 3, y: 4, radius: 0.4, facing: 6, pose: 'idle', frame: 0 });
    expect(ctx.ofKind('drawImage')).toHaveLength(1);
    expect(ctx.ofKind('translate')[0]?.args).toEqual([3, 4]);
  });

  it('flattens the feet shadow onto the ground and leaves the transform as it found it', () => {
    const ctx = recordingCanvas();
    drawFeetShadow(ctx, 2, 5, 0.4, 'rgba(0,0,0,0.4)');
    expect(ctx.ofKind('scale')[0]?.args?.[1]).toBeLessThan(1);
    expect(ctx.calls[0]).toBe('save()');
    expect(ctx.calls.at(-1)).toBe('restore()');
  });
});
