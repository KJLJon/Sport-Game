/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
 * @story   US-2.3 — See the whole field on a small screen
 * @story   US-13.4 — Tell the two teams apart without relying on colour
 * @design  13-visual-overhaul.md §2.4 (the sprite renderer per sport), §2.2 (kit tinting),
 *          §3.1 (athlete sheet), 10-ui-ux.md §11 (colour is never the only signal)
 * @invariant INV-8 (rendering never feeds back into the simulation), INV-2 (no unseeded randomness)
 *
 * Purpose: soccer's sprite `SportRenderer`, the sibling of `art.ts` — three kits rather than two,
 * because the keeper's is a rule of the game and not a decoration (the same argument `art.ts`
 * makes at length for why this seam takes the sport's own state).
 *
 * Everything generic — the blit, the facing, the run cycle, the shadow — is engine-side
 * (`engine/render/sprite-athlete.ts`, `sprite-anim.ts`). What lives here is soccer's: which kit,
 * which pose, and the offside line, which is information rather than atmosphere and so is drawn in
 * both renderers identically.
 */
import { depthSorted } from '../../engine/render/depth.ts';
import {
  Detail,
  type Canvas2D,
  type DetailLevel,
  type OffscreenFactory,
} from '../../engine/render/renderer.ts';
import type { SpriteAtlas } from '../../engine/render/atlas.ts';
import { AnimStore, POSE } from '../../engine/render/sprite-anim.ts';
import { drawAthleteSprite, drawFeetShadow } from '../../engine/render/sprite-athlete.ts';
import type { KitSpec } from '../../engine/render/tint.ts';
import { NO_ENTITY, type EntityId } from '../../engine/world.ts';
import { buildAthleteAtlas } from '../../art/athlete/index.ts';
import type { SportRenderer, SportState } from '../types.ts';
import {
  drawAthlete as drawDiscAthlete,
  drawBall as drawDiscBall,
  paletteFor,
  type Theme,
} from './art.ts';
import { drawPitchSprite, pitchKey } from './pitch-render.ts';
import { PITCH } from './pitch.ts';
import { lastDefenderX, type SoccerState } from './index.ts';

const SHADOW = 'rgba(8, 12, 16, 0.32)';
/** Matches the disc renderer's line exactly: a hint you can find, never a thing you read first. */
const OFFSIDE_LINE = 'rgba(244, 241, 234, 0.28)';

/**
 * The three kits. Side 0 solid, side 1 hooped — soccer's own entry in `10` §3.1's list, and the
 * sprite-scale version of the hoops the disc renderer draws — and the keeper in halves, so the one
 * player who may use their hands is told apart by geometry as well as by hue (`10` §11).
 */
export function kitsFor(theme: Theme = 'dark'): {
  readonly teams: readonly [KitSpec, KitSpec];
  readonly keeper: KitSpec;
} {
  const palette = paletteFor(theme);
  return {
    teams: [
      { fill: palette.teams[0].fill, onFill: palette.teams[0].onFill, pattern: 'solid' },
      { fill: palette.teams[1].fill, onFill: palette.teams[1].onFill, pattern: 'hoops' },
    ],
    keeper: { fill: palette.keeper.fill, onFill: palette.keeper.onFill, pattern: 'halves' },
  };
}

export interface SoccerAtlases {
  readonly teams: readonly [SpriteAtlas, SpriteAtlas];
  readonly keeper: SpriteAtlas;
  /** The ball's own sheet. T-13.4 fills it in; until then the disc ball draws. */
  readonly ball?: SpriteAtlas;
}

export function buildSoccerAtlases(
  createOffscreen: OffscreenFactory,
  theme: Theme = 'dark',
): SoccerAtlases {
  const kits = kitsFor(theme);
  return {
    teams: [
      buildAthleteAtlas(kits.teams[0], createOffscreen),
      buildAthleteAtlas(kits.teams[1], createOffscreen),
    ],
    keeper: buildAthleteAtlas(kits.keeper, createOffscreen),
  };
}

/** A sprite renderer, plus the render clock its idle and action cycles run on. */
export interface SpriteSportRenderer extends SportRenderer {
  advance(dt: number): void;
}

export function spriteRenderer(atlases: SoccerAtlases): SpriteSportRenderer {
  const anims = new AnimStore();
  const palette = paletteFor('dark');

  return {
    advance(dt) {
      anims.advance(dt);
    },

    fieldKey: (field, view) => `${pitchKey(field, view)}:sprite`,

    drawField(ctx, field) {
      drawPitchSprite(ctx, field);
    },

    drawAthletes(ctx, state, world, controlled, lod) {
      ctx.imageSmoothingEnabled = false;
      const soccerState = state as SoccerState;

      const drawn: { id: EntityId; detail: DetailLevel }[] = [];
      const keys: number[] = [];

      world.forEach((id) => {
        if (world.kind[id] === 1) return;
        const x = world.x[id] as number;
        const y = world.y[id] as number;
        // `lod?.detail() ?? FULL` would swallow the `null` that *means* culled, so the two absences
        // are kept apart. The athlete you are steering is always drawn in full: losing detail on
        // your own body is losing the thing the frame is about.
        const level =
          lod === undefined ? Detail.FULL : lod.detail(x, y, world.radius[id] as number);
        if (level === null) return;
        drawn.push({ id, detail: id === controlled ? Detail.FULL : level });
        keys.push(y);
      });

      // Nearer the bottom of the screen is nearer the viewer, so it draws last (`13` §2.3).
      for (const { id, detail } of depthSorted(drawn, keys)) {
        const x = world.x[id] as number;
        const y = world.y[id] as number;
        const radius = world.radius[id] as number;
        const team: 0 | 1 = world.team[id] === 1 ? 1 : 0;
        const keeper = id === soccerState.keepers[0] || id === soccerState.keepers[1];

        const anim = anims.update(id, x, y, world.vx[id] as number, world.vy[id] as number);
        anim.pose = poseFor(anims.running(anim));

        const kit = keeper ? palette.keeper : palette.teams[team];
        const discOptions = { team, controlled: id === controlled, radius, keeper };

        if (detail === Detail.MINIMAL) {
          drawDiscAthlete(ctx, x, y, world.facing[id] as number, kit, Detail.MINIMAL, discOptions);
          continue;
        }

        if (detail === Detail.FULL) drawFeetShadow(ctx, x, y, radius * 0.9, SHADOW);

        const atlas = keeper ? atlases.keeper : (atlases.teams[team] as SpriteAtlas);
        const drewSprite = drawAthleteSprite(ctx, atlas, {
          x,
          y,
          radius,
          facing: anim.facing,
          pose: anim.pose,
          frame: anims.frame(id, anim),
        });

        if (!drewSprite) {
          drawDiscAthlete(ctx, x, y, world.facing[id] as number, kit, detail, discOptions);
          continue;
        }

        if (id === controlled) drawControlledRing(ctx, x, y, radius);
      }
    },

    drawBall(ctx, _state, world, ball) {
      if (ball === NO_ENTITY) return;
      // T-13.4 owns the sprite ball and its altitude pair; the disc ball already carries height in
      // its shadow, so this is a working floor rather than a placeholder.
      drawDiscBall(
        ctx,
        world.x[ball] as number,
        world.y[ball] as number,
        world.z[ball] as number,
        palette,
        Detail.FULL,
        { radius: world.radius[ball] as number },
      );
    },

    /** The offside line, drawn exactly as the disc renderer draws it — see `index.ts`'s note. */
    drawOverlay(ctx: Canvas2D, state: SportState, world) {
      const soccerState = state as SoccerState;
      const carrier = soccerState.ballState.carrier;
      if (carrier === NO_ENTITY) return;
      const attacking = soccerState.sides.get(carrier);
      if (attacking !== 0 && attacking !== 1) return;

      const defending = attacking === 1 ? 0 : 1;
      const line = lastDefenderX(world, soccerState.squads[defending], defending);
      if (line === null) return;

      ctx.strokeStyle = OFFSIDE_LINE;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.moveTo(line, 0);
      ctx.lineTo(line, PITCH.width);
      ctx.stroke();
    },
  };
}

/** Pose from motion. T-13.7 maps `SoccerState` onto the kick, save and tackle poses. */
export function poseFor(running: boolean): string {
  return running ? POSE.run : POSE.idle;
}

/**
 * The controlled-athlete marker: a ring on the ground at the feet rather than around the body. A
 * sprite's body is two metres of screen above its ground position, so a ring around it would sit
 * over whoever is standing behind — and on the floor it stays a shape rather than a tint, which is
 * the INV-11 argument `art.ts` makes for the disc marker.
 */
function drawControlledRing(ctx: Canvas2D, x: number, y: number, radius: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.45);

  ctx.strokeStyle = 'rgba(10, 14, 18, 0.55)';
  ctx.lineWidth = radius * 0.32;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.25, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(244, 241, 234, 0.95)';
  ctx.lineWidth = radius * 0.15;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.25, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
