/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §2.4 (the sprite renderer per sport), §3.1 (athlete sheet)
 * @invariant INV-4 (no sport-specific branching in engine core), INV-8 (determinism)
 *
 * Purpose: the blit itself — one athlete's sprite at a world position, at the size their entity
 * radius implies, with the feet shadow that tells you where on the ground they are standing.
 *
 * **Why this is engine-side and not per sport.** There is nothing about a sport in placing a
 * humanoid sprite: the shared 32×48 sheet, the anchor at the feet, and the fall back to a lower
 * frame when a pose has not been authored yet are the same for basketball, soccer and everything
 * Phase 11 adds. What *is* per sport — which kit, which pose, who the keeper is — stays in the
 * sport's own `sprite-art.ts`, so this file never learns a sport's name (INV-4).
 *
 * **Why the fallback chain exists.** Art lands pose by pose across three sessions of Phase 13. A
 * renderer that threw on a missing key would make every intermediate state unrunnable; one that
 * silently drew nothing would make it invisible. Falling back to the pose's first frame and then to
 * `idle` keeps the game playable while the sheet fills in, and the property test in T-13.7 is where
 * a missing key is supposed to be a failure.
 */
import { authoredFacing, drawSprite, frameKey, type Facing, type SpriteAtlas } from './atlas.ts';
import type { Canvas2D } from './renderer.ts';

/**
 * Shoulder width in sprite px. The scale that maps a sprite to the world comes from this and the
 * entity's own radius, so an athlete's sprite is exactly as wide as the disc it replaces and the
 * two renderers never disagree about who is standing where.
 */
export const SHOULDER_PX = 20;

/** World units per sprite pixel for an entity of this radius. */
export function spriteScale(radius: number): number {
  return (radius * 2) / SHOULDER_PX;
}

export interface AthleteSpriteDraw {
  /** The athlete's ground position — where the feet anchor lands. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly facing: Facing;
  readonly pose: string;
  readonly frame: number;
  readonly alpha?: number;
}

/**
 * Blits one athlete. Returns `false` when the atlas holds nothing that could stand in for the
 * requested pose, which is the caller's cue to draw its disc instead.
 */
export function drawAthleteSprite(
  ctx: Canvas2D,
  atlas: SpriteAtlas,
  at: AthleteSpriteDraw,
): boolean {
  const resolved = resolveFrame(atlas, at.pose, at.facing, at.frame);
  if (resolved === null) return false;

  return drawSprite(ctx, atlas, resolved.key, {
    x: at.x,
    y: at.y,
    scale: spriteScale(at.radius),
    mirrored: resolved.mirrored,
    ...(at.alpha === undefined ? {} : { alpha: at.alpha }),
  });
}

/** The authored key this (pose, facing, frame) actually resolves to, or `null` if none does. */
export function resolveFrame(
  atlas: SpriteAtlas,
  pose: string,
  facing: Facing,
  frame: number,
): { key: string; facing: Facing; mirrored: boolean } | null {
  const { facing: authored, mirrored } = authoredFacing(facing);

  const candidates = [
    { key: frameKey(pose, authored, frame), facing: authored, mirrored },
    { key: frameKey(pose, authored, 0), facing: authored, mirrored },
    { key: frameKey('idle', authored, 0), facing: authored, mirrored },
    // Last resort: the south-facing idle, which is the first frame every sheet authors. A sheet
    // part-way through Phase 13 has poses for some facings and not others, and an athlete facing
    // the wrong way is a better failure than an athlete who is not drawn at all.
    { key: frameKey('idle', 6, 0), facing: 6 as Facing, mirrored: false },
  ];
  for (const candidate of candidates) {
    if (atlas.frames.has(candidate.key)) return candidate;
  }
  return null;
}

/**
 * The feet shadow: a flattened ellipse on the ground, drawn on the `shadows` layer under
 * everything. It is what stops a sprite whose body rises 2 m up the screen from looking like it is
 * floating — the shadow is the only thing in the frame that says which pixel is the ground.
 */
export function drawFeetShadow(
  ctx: Canvas2D,
  x: number,
  y: number,
  radius: number,
  colour: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.45);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
