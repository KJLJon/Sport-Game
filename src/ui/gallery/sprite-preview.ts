/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.2 — Asset pipeline: authored source → packed atlas → typed accessors
 * @task    T-13.6 — Depth sorting and occlusion
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
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
import {
  authoredFacing,
  drawSprite,
  frameKey,
  type Facing,
  type SpriteAtlas,
} from '../../engine/render/atlas.ts';
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

/**
 * The gallery's sprite section: the walking skeleton T-13.2 left, plus what T-13.3 added — every
 * authored facing including the three drawn mirrored, the run cycle frame by frame, and all four
 * kit patterns side by side.
 *
 * **The pattern row is the one that matters.** `10` §11 and Gate 13 ask whether team identity
 * survives protanopia, deuteranopia and tritanopia. Four kits differing in *geometry* is the answer
 * this phase gives, and this is where a human — or T-13.12's colour-vision snapshots — checks it.
 */
export function spritePreviews(doc: Document): readonly [string, Node][] {
  const captions = [
    'sprite · idle, both kits',
    'sprite · depth sort (submitted back to front)',
    'sprite · eight facings (W, NW, SW are mirrored)',
    'sprite · run cycle, six frames',
    'sprite · kit patterns — solid, stripes, hoops, halves',
  ] as const;

  // jsdom has no 2D context, and building an atlas needs one. The captions stay either way, so
  // the gallery's inventory check sees the section whether or not anything could be drawn into it.
  if (doc.createElement('canvas').getContext('2d') === null) {
    return captions.map((caption) => [caption, canvasOf(doc, 240, 140)]);
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

  const facings = row(doc, 8, (ctx, i, x, y) => {
    const facing = i as Facing;
    const { facing: authored, mirrored } = authoredFacing(facing);
    drawSprite(ctx, home, frameKey('idle', authored, 0), { x, y, scale: SPRITE_SCALE, mirrored });
  });

  const runCycle = row(doc, RUN_FRAMES, (ctx, i, x, y) => {
    drawSprite(ctx, away, frameKey('run', 6, i), { x, y, scale: SPRITE_SCALE });
  });

  const patterns = row(doc, PATTERN_ATLASES.length, (ctx, i, x, y) => {
    const atlas = patternAtlases(create)[i] as SpriteAtlas;
    drawSprite(ctx, atlas, frameKey('idle', 6, 0), { x, y, scale: SPRITE_SCALE });
  });

  return [
    [captions[0], kits],
    [captions[1], depth],
    [captions[2], facings],
    [captions[3], runCycle],
    [captions[4], patterns],
  ];
}

/** Frames in the authored run cycle (`13` §3.1). Read off the sheet so a re-author cannot desync it. */
const RUN_FRAMES = 6;

/** The four patterns, drawn in one team's colour so only the geometry differs between them. */
const PATTERN_ATLASES = ['solid', 'stripes', 'hoops', 'halves'] as const;

let patternCache: SpriteAtlas[] | null = null;

function patternAtlases(create: ReturnType<typeof domOffscreenFactory>): readonly SpriteAtlas[] {
  patternCache ??= PATTERN_ATLASES.map((pattern) =>
    buildAthleteAtlas({ ...HOME, pattern }, create),
  );
  return patternCache;
}

/**
 * A strip of `count` sprites on one baseline, evenly spaced. Everything the extra sections draw is
 * a row, so the layout arithmetic lives here once rather than three times.
 */
function row(
  doc: Document,
  count: number,
  draw: (ctx: Canvas2D, index: number, x: number, y: number) => void,
): Node {
  const width = 30 * count + 24;
  const canvas = canvasOf(doc, width, 88);
  const raw = canvas.getContext('2d');
  if (raw === null) return canvas;

  const ctx = raw as unknown as Canvas2D;
  const dpr = canvas.width / width;
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;
  ctx.scale(VIEW_SCALE, VIEW_SCALE);

  const baseline = 76 / VIEW_SCALE;
  for (let i = 0; i < count; i++) draw(ctx, i, (24 + i * 30) / VIEW_SCALE, baseline);

  return canvas;
}
