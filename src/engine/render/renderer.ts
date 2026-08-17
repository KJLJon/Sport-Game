/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.7 — Canvas 2D renderer: layers, batching, LOD, off-screen static layers, debug overlay
 * @task    T-13.2 — Asset pipeline (the `Canvas2D` slice sprites rasterise and blit through)
 * @task    T-13.6 — Depth sorting and occlusion (the `entities` layer's sort key)
 * @story   US-2.3 — See the whole field on a small screen; US-2.5 — Run at a steady frame rate
 * @design  04-architecture.md §6 (rendering), §9 (mobile and performance),
 *          13-visual-overhaul.md §2.1, §2.3
 * @invariant INV-8 (rendering never feeds back into the simulation)
 *
 * Purpose: draws a frame. Nothing here may touch simulation state — the renderer receives an
 * interpolation factor and reads the world, and writes nothing back, which is what lets the sim
 * run at a fixed 60 Hz while the display runs at whatever the device manages.
 *
 * The design goal is fill rate on a mid-range phone (`01` R2). Three levers, in the order they
 * pay off: draw the static field once into an off-screen canvas and blit it; batch draws that
 * share a style so the context's state changes once instead of per entity; and drop detail on
 * things that are far from the camera, which on a zoomed-out 11v11 view is most of them.
 *
 * Everything works against `Canvas2D` — the subset of `CanvasRenderingContext2D` actually used —
 * so the layer and LOD policy is unit-tested against a recording double rather than a real canvas.
 *
 * T-13.6 adds one thing to that picture: an optional depth key on `submit`, applied to the
 * `entities` layer only (see `depth.ts`). It is what lets sprites overlap correctly, and it costs
 * the disc renderer — which never passes one — a single integer comparison per frame.
 */

import { depthOrder } from './depth.ts';

/** The slice of the 2D context this engine uses. Anything outside it is not available to sports. */
export interface Canvas2D {
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number): void;
  /** The sub-rectangle blit sprites draw through (T-13.2): source rect → destination rect. */
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
  /** Sprite rasterisation writes pixels directly; both are off-screen-only (T-13.2, `13` §2.1). */
  createImageData(width: number, height: number): ImageData;
  putImageData(data: ImageData, dx: number, dy: number): void;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  /**
   * Off for pixel art — a 32×48 sprite blown up to 40 world px is meant to have edges (T-13.2).
   * The sprite renderer sets it once per frame rather than per sprite.
   */
  imageSmoothingEnabled: boolean;
}

/**
 * Draw order. Explicit and fixed: a sport asks for a layer by name and cannot reorder the stack,
 * because "why is the ball behind the crowd" is not a bug worth having twice.
 */
export const LAYERS = ['field', 'shadows', 'entities', 'ball', 'effects', 'hud'] as const;
export type LayerName = (typeof LAYERS)[number];

/** Draw commands are functions, so a sport can draw anything without extending an enum. */
export type DrawCommand = (ctx: Canvas2D, view: ViewTransform) => void;

/** World → screen. Owned by the camera (T-1.8); the renderer only applies it. */
export interface ViewTransform {
  /** Camera centre in world units. */
  readonly x: number;
  readonly y: number;
  /** Screen pixels per world unit. */
  readonly scale: number;
  /** Viewport size in CSS pixels. */
  readonly width: number;
  readonly height: number;
}

/** Detail tier for one entity this frame. Sports decide what each tier draws. */
export const Detail = {
  /** Close to the camera: everything. */
  FULL: 2,
  /** Mid-distance: silhouette and team colour, no fine detail. */
  REDUCED: 1,
  /** Far or off-screen edge: a dot, or nothing at all. */
  MINIMAL: 0,
} as const;
export type DetailLevel = (typeof Detail)[keyof typeof Detail];

/**
 * The engine's answer, per entity, to "draw this, and how much of it" (T-12.8).
 *
 * `null` means the entity is outside the viewport and must not be drawn at all. Deferred here from
 * T-6.11, which found the sim was never the bottleneck and left culling to the phase where the
 * viewport would actually start excluding things — with a fit-the-field camera it never did.
 */
export interface EntityLod {
  detail(worldX: number, worldY: number, radius?: number): DetailLevel | null;
}

export interface RendererOptions {
  /** Fraction of the viewport half-diagonal within which entities draw at full detail. */
  readonly fullDetailRatio?: number;
  /** …and within which they draw at reduced detail. Beyond it, minimal. */
  readonly reducedDetailRatio?: number;
  /** Disables shake and heavy effects. Mirrors `prefers-reduced-motion` (`10` §6). */
  readonly reducedMotion?: boolean;
}

export interface FrameStats {
  /** Draw commands submitted this frame. */
  readonly commands: number;
  /** Times the context's fill or stroke style actually changed. Batching's scoreboard. */
  readonly styleChanges: number;
  /** Entities at each detail level. */
  readonly full: number;
  readonly reduced: number;
  readonly minimal: number;
  /** Whether the static layer was redrawn rather than blitted. */
  readonly staticRedrawn: boolean;
}

/** A canvas the renderer can draw the static field into once and blit thereafter. */
export interface OffscreenLayer {
  readonly canvas: CanvasImageSource;
  readonly ctx: Canvas2D;
  width: number;
  height: number;
}

export type OffscreenFactory = (width: number, height: number) => OffscreenLayer;

/**
 * The one layer whose draw order is a question rather than a given (T-13.6). Sprites overlap, so
 * within `entities` the athlete with the larger world y is nearer the viewer and draws last; every
 * other layer is a flat stack where submission order is the answer.
 */
const SORTED_LAYER: LayerName = 'entities';

export class Renderer {
  private readonly queues = new Map<LayerName, DrawCommand[]>();
  /** Parallel to the `entities` queue. Kept as a plain array so an unkeyed frame costs nothing. */
  private readonly entitySortKeys: (number | undefined)[] = [];
  private readonly options: Required<Omit<RendererOptions, 'reducedMotion'>> & {
    reducedMotion: boolean;
  };

  private staticLayer: OffscreenLayer | null = null;
  private staticKey = '';
  private staticDirty = true;

  private commands = 0;
  private styleChanges = 0;
  private detailCounts: [number, number, number] = [0, 0, 0];
  private staticRedrawn = false;

  private lastFill = '';
  private lastStroke = '';

  constructor(
    private readonly createOffscreen: OffscreenFactory | null = null,
    options: RendererOptions = {},
  ) {
    this.options = {
      fullDetailRatio: options.fullDetailRatio ?? 0.55,
      reducedDetailRatio: options.reducedDetailRatio ?? 1.0,
      reducedMotion: options.reducedMotion ?? false,
    };

    for (const layer of LAYERS) this.queues.set(layer, []);
  }

  get reducedMotion(): boolean {
    return this.options.reducedMotion;
  }

  /**
   * Queues a draw. Commands run in submission order within a layer, and layers run in `LAYERS`
   * order.
   *
   * `sortKey` is the depth key for the `entities` layer (T-13.6): the world y of whatever is being
   * drawn — the feet, for a sprite. Keyed commands are drawn after keyless ones, in ascending key
   * order, ties in submission order. On any other layer it is ignored, because a sport reordering
   * the ball or the HUD by y is not a feature anyone asked for.
   */
  submit(layer: LayerName, command: DrawCommand, sortKey?: number): void {
    this.queues.get(layer)?.push(command);
    if (layer === SORTED_LAYER) this.entitySortKeys.push(sortKey);
    this.commands++;
  }

  /**
   * Queues a batch that shares one style. The style is set once for the whole batch rather than
   * per item, which is the difference between 22 context state changes a frame and one.
   */
  submitBatch(
    layer: LayerName,
    style: { fill?: string; stroke?: string; lineWidth?: number; alpha?: number },
    items: readonly DrawCommand[],
  ): void {
    if (items.length === 0) return;

    this.submit(layer, (ctx, view) => {
      if (style.fill !== undefined) this.setFill(ctx, style.fill);
      if (style.stroke !== undefined) this.setStroke(ctx, style.stroke);
      if (style.lineWidth !== undefined) ctx.lineWidth = style.lineWidth;
      if (style.alpha !== undefined) ctx.globalAlpha = style.alpha;

      for (const item of items) item(ctx, view);

      if (style.alpha !== undefined) ctx.globalAlpha = 1;
    });
    // The batch itself counted as one command above; the items are not separate submissions.
    this.commands += items.length - 1;
  }

  /**
   * Registers the static field content. `key` identifies what would be drawn — court dimensions,
   * theme, viewport size — so the layer is redrawn only when that changes, not every frame.
   */
  setStatic(key: string, width: number, height: number, draw: (ctx: Canvas2D) => void): void {
    if (this.createOffscreen === null) return;

    if (
      this.staticLayer === null ||
      this.staticLayer.width !== width ||
      this.staticLayer.height !== height
    ) {
      this.staticLayer = this.createOffscreen(width, height);
      this.staticDirty = true;
    }
    if (key !== this.staticKey) this.staticDirty = true;
    this.staticKey = key;

    if (this.staticDirty) {
      this.staticLayer.ctx.clearRect(0, 0, width, height);
      draw(this.staticLayer.ctx);
      this.staticDirty = false;
      this.staticRedrawn = true;
    }
  }

  /** Forces the static layer to be redrawn next frame — on a theme change, say. */
  invalidateStatic(): void {
    this.staticDirty = true;
  }

  /**
   * Detail tier for a world point, from its distance to the camera centre relative to the
   * viewport. Ratio-based rather than absolute so it behaves the same on a phone and a tablet,
   * and at every zoom level the camera picks.
   */
  detailFor(view: ViewTransform, worldX: number, worldY: number): DetailLevel {
    const dx = (worldX - view.x) * view.scale;
    const dy = (worldY - view.y) * view.scale;
    const distance = Math.hypot(dx, dy);
    const halfDiagonal = Math.hypot(view.width, view.height) / 2;

    if (distance <= halfDiagonal * this.options.fullDetailRatio) return Detail.FULL;
    if (distance <= halfDiagonal * this.options.reducedDetailRatio) return Detail.REDUCED;
    return Detail.MINIMAL;
  }

  /** Records a detail decision for this frame's stats. */
  countDetail(level: DetailLevel): void {
    this.detailCounts[level]++;
  }

  /**
   * This frame's culling and detail policy, as one object a sport can ask about each entity
   * (T-12.8).
   *
   * **Why the sport asks rather than the engine deciding.** The engine cannot draw the athletes —
   * only the sport knows which of them is a goalkeeper and what a goalkeeper looks like (T-6.16).
   * But the *policy* is not the sport's: what is on screen and how much detail it deserves is a
   * question about the camera, and two sports answering it separately is two sports answering it
   * differently. So the sport keeps the drawing and the engine keeps the judgement.
   *
   * Calling `detail` also records the decision for `FrameStats`, which is what makes the debug
   * overlay's LOD line a measurement rather than a guess.
   */
  lodFor(view: ViewTransform, margin = 2): EntityLod {
    return {
      detail: (worldX, worldY, radius = 0) => {
        if (!this.isVisible(view, worldX, worldY, radius + margin)) return null;
        const level = this.detailFor(view, worldX, worldY);
        this.countDetail(level);
        return level;
      },
    };
  }

  /** Whether a circle of `radius` world units at `(x, y)` intersects the viewport at all. */
  isVisible(view: ViewTransform, worldX: number, worldY: number, radius = 0): boolean {
    const dx = Math.abs(worldX - view.x) * view.scale;
    const dy = Math.abs(worldY - view.y) * view.scale;
    const margin = radius * view.scale;
    return dx <= view.width / 2 + margin && dy <= view.height / 2 + margin;
  }

  /**
   * Draws the frame: clear, blit the static layer, then every queue in order under the camera
   * transform. The HUD layer is drawn in screen space — it should not move with the camera.
   */
  render(ctx: Canvas2D, view: ViewTransform): FrameStats {
    this.lastFill = '';
    this.lastStroke = '';

    ctx.clearRect(0, 0, view.width, view.height);

    if (this.staticLayer !== null) {
      ctx.drawImage(this.staticLayer.canvas, 0, 0);
    }

    for (const layer of LAYERS) {
      const queue = this.queues.get(layer);
      if (queue === undefined || queue.length === 0) continue;

      ctx.save();
      if (layer !== 'hud') {
        ctx.translate(view.width / 2, view.height / 2);
        ctx.scale(view.scale, view.scale);
        ctx.translate(-view.x, -view.y);
      }
      const order = layer === SORTED_LAYER ? depthOrder(this.entitySortKeys) : null;
      if (order === null) {
        for (const command of queue) command(ctx, view);
      } else {
        for (const index of order) queue[index]?.(ctx, view);
      }
      ctx.restore();
    }

    const stats: FrameStats = {
      commands: this.commands,
      styleChanges: this.styleChanges,
      full: this.detailCounts[Detail.FULL],
      reduced: this.detailCounts[Detail.REDUCED],
      minimal: this.detailCounts[Detail.MINIMAL],
      staticRedrawn: this.staticRedrawn,
    };

    this.reset();
    return stats;
  }

  /** Clears the queues and per-frame counters. Called at the end of `render`. */
  private reset(): void {
    for (const queue of this.queues.values()) queue.length = 0;
    this.entitySortKeys.length = 0;
    this.commands = 0;
    this.styleChanges = 0;
    this.detailCounts = [0, 0, 0];
    this.staticRedrawn = false;
  }

  private setFill(ctx: Canvas2D, style: string): void {
    if (this.lastFill === style) return;
    ctx.fillStyle = style;
    this.lastFill = style;
    this.styleChanges++;
  }

  private setStroke(ctx: Canvas2D, style: string): void {
    if (this.lastStroke === style) return;
    ctx.strokeStyle = style;
    this.lastStroke = style;
    this.styleChanges++;
  }
}

/** A DOM-backed off-screen layer. Kept out of `Renderer` so the class stays testable in node. */
export function domOffscreenFactory(): OffscreenFactory {
  return (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2D context unavailable for the static layer');
    return { canvas, ctx: ctx as unknown as Canvas2D, width, height };
  };
}

export interface DebugInfo {
  readonly fps: number;
  readonly frameMs: number;
  readonly simMs: number;
  readonly entities: number;
  readonly stats: FrameStats;
}

/**
 * The developer overlay from `04` §6 — frame time, sim time, entity count, and what the batching
 * and LOD passes actually achieved. Drawn in screen space, never in world space.
 */
export function drawDebugOverlay(ctx: Canvas2D, info: DebugInfo, x = 8, y = 8): void {
  const lines = [
    `${info.fps.toFixed(0)} fps · ${info.frameMs.toFixed(1)} ms`,
    `sim ${info.simMs.toFixed(2)} ms · ${info.entities} entities`,
    `${info.stats.commands} cmds · ${info.stats.styleChanges} style changes`,
    `LOD ${info.stats.full}/${info.stats.reduced}/${info.stats.minimal}`,
  ];

  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, 220, lines.length * 14 + 8);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0f0';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';

  for (const [index, line] of lines.entries()) {
    ctx.fillText(line, x + 6, y + 16 + index * 14);
  }

  ctx.restore();
}
