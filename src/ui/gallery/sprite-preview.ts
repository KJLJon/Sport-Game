/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.2 — Asset pipeline: authored source → packed atlas → typed accessors
 * @task    T-13.6 — Depth sorting and occlusion
 * @story   US-1.3 — Keep everything inside the repository path
 * @design  13-visual-overhaul.md §2.1 (atlas), §2.3 (depth sort), §4 (T-13.2 walking skeleton)
 *
 * Purpose: the visible half of T-13.2 — the authored grids, rasterised into a real atlas and blitted
 * onto `#/dev/ui` in two team kits, and the same sprite submitted out of depth order to show the
 * `entities` layer sorting it back. Every task after this one has somewhere to look.
 *
 * It draws through the real `Renderer`, not a shortcut, so what the gallery shows is what a match
 * would show. In jsdom there is no 2D context; the canvas is then left blank rather than throwing,
 * which is what keeps the gallery's own determinism test able to mount the page.
 */
import { drawSprite, frameKey, type SpriteAtlas } from '../../engine/render/atlas.ts';
import {
  Renderer,
  domOffscreenFactory,
  type Canvas2D,
  type ViewTransform,
} from '../../engine/render/renderer.ts';
import { buildAthleteAtlas, type AthleteKit } from '../../art/athlete/index.ts';

/** `10` §3.1's `--info` / `--accent` pairs — the same two sides the disc renderer draws. */
const HOME: AthleteKit = { fill: '#4EA8FF', onFill: '#04121F' };
const AWAY: AthleteKit = { fill: '#3DDC91', onFill: '#06210F' };

const IDLE_SOUTH = frameKey('idle', 6, 0);

/** Screen px per world unit, and world units per sprite px: together, one sprite px per screen px. */
const VIEW_SCALE = 20;
const SPRITE_SCALE = 1 / VIEW_SCALE;

interface Placed {
  readonly atlas: SpriteAtlas;
  readonly x: number;
  readonly y: number;
}

function canvasOf(doc: Document, width: number, height: number): HTMLCanvasElement {
  const canvas = doc.createElement('canvas');
  const dpr = Math.min(2, doc.defaultView?.devicePixelRatio ?? 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  return canvas;
}

/**
 * Draws a fixed set of athletes into a fresh canvas. `submitOrder` is deliberately separate from
 * the placement: the depth demonstration submits back-to-front reversed and relies on the sort key
 * to undo it.
 */
function scene(doc: Document, width: number, height: number, placed: readonly Placed[]): Node {
  const canvas = canvasOf(doc, width, height);
  const raw = canvas.getContext('2d');
  if (raw === null) return canvas;

  const ctx = raw as unknown as Canvas2D;
  const dpr = canvas.width / width;
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  const view: ViewTransform = { x: 0, y: 0, scale: VIEW_SCALE, width, height };
  const renderer = new Renderer(domOffscreenFactory());

  for (const { atlas, x, y } of placed) {
    // No sort key on the shadow: shadows are a flat layer under everything, and passing one
    // outside `entities` does nothing by design (T-13.6).
    renderer.submit('shadows', (c) => {
      c.fillStyle = 'rgba(6, 10, 14, 0.35)';
      c.beginPath();
      c.arc(x, y, 0.34, 0, Math.PI * 2);
      c.fill();
    });
    renderer.submit(
      'entities',
      (c) => {
        drawSprite(c, atlas, IDLE_SOUTH, { x, y, scale: SPRITE_SCALE });
      },
      y,
    );
  }

  renderer.render(ctx, view);
  return canvas;
}

/** The two figures the gallery shows. Built once per mount; atlases are shared between them. */
export function spritePreviews(doc: Document): readonly [string, Node][] {
  // jsdom has no 2D context, and building an atlas needs one. The captions stay either way, so
  // the gallery's inventory check sees the section whether or not anything could be drawn into it.
  if (doc.createElement('canvas').getContext('2d') === null) {
    return [
      ['sprite · idle, both kits', canvasOf(doc, 240, 140)],
      ['sprite · depth sort (submitted back to front)', canvasOf(doc, 240, 140)],
    ];
  }

  const create = domOffscreenFactory();
  const home = buildAthleteAtlas(HOME, create);
  const away = buildAthleteAtlas(AWAY, create);

  const kits = scene(doc, 240, 140, [
    { atlas: home, x: -1.6, y: 1.4 },
    { atlas: away, x: 1.6, y: 1.4 },
  ]);

  // Submitted front-to-back — the reverse of the order they must draw in. If the sort key were
  // ignored, the athlete at the top of the canvas would overlap the one below them, which is the
  // one thing a top-down world must never look like.
  const depth = scene(doc, 240, 140, [
    { atlas: home, x: 0.9, y: 1.9 },
    { atlas: away, x: 0.3, y: 1.5 },
    { atlas: home, x: -0.3, y: 1.1 },
    { atlas: away, x: -0.9, y: 0.7 },
  ]);

  return [
    ['sprite · idle, both kits', kits],
    ['sprite · depth sort (submitted back to front)', depth],
  ];
}
