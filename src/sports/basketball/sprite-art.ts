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
 * Purpose: basketball's second `SportRenderer` — the same match, drawn with sprites instead of
 * discs. A sibling of `art.ts`, never a replacement: T-13.11 chooses between them at run time and
 * the disc path stays the performance floor (`13` §1 principle 2).
 *
 * **What is sport-specific here and what is not.** The blit, the facing, the run cycle and the
 * shadow are engine-side (`engine/render/sprite-athlete.ts`, `sprite-anim.ts`) because none of them
 * knows a sport. This file owns the two kits, the pose choice, and the LOD policy — the things that
 * are basketball's answer rather than a general one.
 *
 * **Why the athletes are sorted here rather than by the renderer.** `SportRenderer.drawAthletes`
 * is called inside *one* submitted command (`modes/live/screen.ts`), so the engine's per-command
 * `sortKey` (T-13.6) has nothing to attach to at this seam — a sport that batches its own draws
 * sorts them itself, which is exactly what `depthSorted` exists for. The key is the same one the
 * gallery uses: the athlete's world y at the feet.
 *
 * **Minimal detail stays a disc.** At the far LOD tier a 32×48 sprite is a smudge, and `art.ts`
 * already draws a dot whose *shape* carries the team (INV-11). Falling back to it is both faster
 * and more legible, and it is what T-13.9's budget leans on if sprites ever cost too much.
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
import type { SportRenderer } from '../types.ts';
import {
  drawBall as drawDiscBall,
  drawAthlete as drawDiscAthlete,
  paletteFor,
  type Theme,
} from './art.ts';
import { courtKey, drawCourtSprite } from './court-render.ts';

/** The feet shadow. Theme-agnostic for the reason `art.ts` gives: a shadow is darker than anything. */
const SHADOW = 'rgba(6, 10, 14, 0.38)';

/**
 * The two kits, as patterns rather than as two hues (`10` §11). Side 0 is solid — a home kit needs
 * no marking of its own — and side 1 is striped, which is the sprite-scale version of the stripe
 * `art.ts` draws across the disc, so a player switching renderers sees the same two teams.
 */
export function kitsFor(theme: Theme = 'dark'): readonly [KitSpec, KitSpec] {
  const teams = paletteFor(theme).teams;
  return [
    { fill: teams[0].fill, onFill: teams[0].onFill, pattern: 'solid' },
    { fill: teams[1].fill, onFill: teams[1].onFill, pattern: 'stripes' },
  ];
}

/** Every atlas a basketball match draws from. Built once at match load, never per frame (§2.2). */
export interface BasketballAtlases {
  readonly teams: readonly [SpriteAtlas, SpriteAtlas];
  /** The ball's own sheet. T-13.4 fills it in; until then the disc ball draws. */
  readonly ball?: SpriteAtlas;
}

export function buildBasketballAtlases(
  createOffscreen: OffscreenFactory,
  theme: Theme = 'dark',
): BasketballAtlases {
  const [home, away] = kitsFor(theme);
  return {
    teams: [buildAthleteAtlas(home, createOffscreen), buildAthleteAtlas(away, createOffscreen)],
  };
}

/**
 * A sprite renderer, plus the render clock the idle and action cycles run on. `advance` is called
 * by whoever owns the frame's dt; a renderer that is never advanced draws frame 0 of every pose,
 * which is what a snapshot test wants and what a paused match should look like.
 */
export interface SpriteSportRenderer extends SportRenderer {
  advance(dt: number): void;
}

export function spriteRenderer(atlases: BasketballAtlases): SpriteSportRenderer {
  const anims = new AnimStore();
  const palette = paletteFor('dark');

  return {
    advance(dt) {
      anims.advance(dt);
    },

    // The style variant joins the static layer's cache key, or a renderer switch mid-session would
    // keep blitting the other renderer's field (T-13.5).
    fieldKey: (field, view) => `${courtKey(field, view)}:sprite`,

    drawField(ctx, field) {
      drawCourtSprite(ctx, field);
    },

    drawAthletes(ctx, _state, world, controlled, lod) {
      ctx.imageSmoothingEnabled = false;

      const drawn: { id: EntityId; detail: DetailLevel }[] = [];
      const keys: number[] = [];

      world.forEach((id) => {
        if (world.kind[id] === 1) return;
        const x = world.x[id] as number;
        const y = world.y[id] as number;
        // `lod?.detail() ?? FULL` would swallow the `null` that *means* culled, so the two absences
        // are kept apart: no LOD at all is full detail, an LOD answering null is off-screen. The
        // athlete you are steering is always drawn in full — losing detail on your own body is
        // losing the thing the frame is about.
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

        const anim = anims.update(id, x, y, world.vx[id] as number, world.vy[id] as number);
        anim.pose = poseFor(anims.running(anim));

        if (detail === Detail.MINIMAL) {
          drawDiscAthlete(
            ctx,
            x,
            y,
            world.facing[id] as number,
            palette.teams[team],
            Detail.MINIMAL,
            {
              team,
              controlled: id === controlled,
              radius,
            },
          );
          continue;
        }

        if (detail === Detail.FULL) drawFeetShadow(ctx, x, y, radius * 0.9, SHADOW);

        const drewSprite = drawAthleteSprite(ctx, atlases.teams[team] as SpriteAtlas, {
          x,
          y,
          radius,
          facing: anim.facing,
          pose: anim.pose,
          frame: anims.frame(id, anim),
        });

        // A pose the sheet does not hold yet is drawn as the disc it replaces, so a half-authored
        // atlas is a mixed-looking match rather than an invisible team.
        if (!drewSprite) {
          drawDiscAthlete(ctx, x, y, world.facing[id] as number, palette.teams[team], detail, {
            team,
            controlled: id === controlled,
            radius,
          });
          continue;
        }

        if (id === controlled) drawControlledRing(ctx, x, y, radius);
      }
    },

    drawBall(ctx, _state, world, ball) {
      if (ball === NO_ENTITY) return;
      // T-13.4 owns the sprite ball and the altitude pair it draws with. Until it lands, the disc
      // ball is drawn, which already carries height in its shadow.
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

    drawOverlay() {
      // Basketball's disc renderer draws no overlay either; T-13.8's atmosphere is the effects layer.
    },
  };
}

/**
 * Pose from motion. Everything beyond "standing or running" — the shot release, the charge taken,
 * the celebration — is T-13.7's mapping from `BasketballState`, which is judgement work about the
 * sport rather than about the renderer.
 */
export function poseFor(running: boolean): string {
  return running ? POSE.run : POSE.idle;
}

/**
 * The controlled-athlete marker, drawn at the *feet* rather than around the body: with a sprite the
 * body is 2 m of screen above the ground position, and a ring around it would sit over the head of
 * whoever is standing behind. A ring on the floor reads as "this one", stays clear of the sprite,
 * and is a shape rather than a tint, which is the same INV-11 argument `art.ts` makes.
 */
function drawControlledRing(ctx: Canvas2D, x: number, y: number, radius: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.45);

  ctx.strokeStyle = 'rgba(6, 10, 14, 0.55)';
  ctx.lineWidth = radius * 0.34;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.25, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = '#F5F7FA';
  ctx.lineWidth = radius * 0.16;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.25, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
