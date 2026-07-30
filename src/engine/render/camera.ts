/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-6.12 — Camera and minimap tuning for the larger pitch
 * @task    T-1.8 — Camera: ball follow, smoothing, dynamic zoom, bounds clamp, shake
 * @story   US-2.3 — See the whole field on a small screen
 * @design  04-architecture.md §6 (rendering), 10-ui-ux.md §6 (reduced motion), 01-plan.md R2
 * @invariant INV-2 (shake draws from the seeded PRNG), INV-8 (the camera never feeds the sim)
 *
 * Purpose: decides what the player can see, which on a phone is the single biggest readability
 * lever there is (`01` R2). It follows the ball, leads it slightly so the player sees where play
 * is going rather than where it has been, zooms out when the action spreads, and refuses to show
 * anything outside the field.
 *
 * The camera is a *render*-side object: it advances on frame time, not sim time, and nothing in
 * `engine/physics` or a sport module may read it. A camera that influenced the simulation would
 * make what you see change what happens — and would break determinism the moment two devices
 * rendered at different rates.
 */
import { clamp } from '../physics/movement.ts';
import type { Rng } from '../rng.ts';
import type { ViewTransform } from './renderer.ts';

export interface CameraOptions {
  /** Viewport size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Field size in world units — the camera never shows beyond it. */
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** Closest zoom, in screen pixels per world unit. */
  readonly maxScale?: number;
  /**
   * Furthest zoom — the floor the camera never zooms out past. Defaults to whatever fits the whole
   * field.
   *
   * Setting it **above** the fit-the-field scale is the supported way to say "do not show the whole
   * field": a 105 × 68 pitch fitted to a phone puts an athlete at about three pixels, which is
   * legible only in the sense that it is on screen. The camera then follows and clamps to the field
   * edges instead, and `clampCentre` already handles a viewport smaller than the world.
   */
  readonly minScale?: number;
  /** Fraction of the gap closed per second when following. Higher is snappier. */
  readonly followRate?: number;
  /** Fraction of the zoom gap closed per second. Slower than following, deliberately. */
  readonly zoomRate?: number;
  /** How far ahead of the target's velocity the camera looks, in seconds. */
  readonly lookahead?: number;
  /** No shake, no lead — `prefers-reduced-motion` (`10` §6). */
  readonly reducedMotion?: boolean;
}

export interface FollowTarget {
  readonly x: number;
  readonly y: number;
  readonly vx?: number;
  readonly vy?: number;
}

export class Camera {
  private viewWidth: number;
  private viewHeight: number;
  private readonly worldWidth: number;
  private readonly worldHeight: number;

  private readonly maxScale: number;
  /** What the caller asked for, or `undefined` for "fit the field". Survives a resize. */
  private readonly requestedMinScale: number | undefined;
  private minScale: number;
  private readonly followRate: number;
  private readonly zoomRate: number;
  private readonly lookahead: number;
  private reduced: boolean;

  private centreX: number;
  private centreY: number;
  private currentScale: number;
  private targetScale: number;

  private shakeMagnitude = 0;
  private shakeDecay = 0;
  private shakeX = 0;
  private shakeY = 0;

  constructor(options: CameraOptions) {
    this.viewWidth = options.width;
    this.viewHeight = options.height;
    this.worldWidth = options.worldWidth;
    this.worldHeight = options.worldHeight;

    this.maxScale = options.maxScale ?? 60;
    this.requestedMinScale = options.minScale;
    this.minScale = options.minScale ?? this.fitScale();
    this.followRate = options.followRate ?? 6;
    this.zoomRate = options.zoomRate ?? 2.5;
    this.lookahead = options.lookahead ?? 0.35;
    this.reduced = options.reducedMotion ?? false;

    this.centreX = this.worldWidth / 2;
    this.centreY = this.worldHeight / 2;
    this.currentScale = this.minScale;
    this.targetScale = this.minScale;
    this.clampCentre();
  }

  /** The zoom at which the whole field is visible. The camera never goes below it. */
  private fitScale(): number {
    return Math.min(this.viewWidth / this.worldWidth, this.viewHeight / this.worldHeight);
  }

  /** Called when the viewport resizes — a rotation, a browser chrome change. */
  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;

    // A caller's explicit floor survives a resize. It used to be clamped down to `fitScale()` here,
    // which quietly undid any request to stay zoomed in the first time the viewport changed — and a
    // rotation or a browser-chrome change counts, so on a phone it undid it almost immediately.
    // Only a camera that asked for the default gets its floor recomputed from the new viewport.
    this.minScale = this.requestedMinScale ?? this.fitScale();
    this.currentScale = clamp(this.currentScale, this.minScale, this.maxScale);
    this.targetScale = clamp(this.targetScale, this.minScale, this.maxScale);
    this.clampCentre();
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced) {
      this.shakeMagnitude = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  /** Jumps straight to a position — a period start, a replay seek. No smoothing. */
  snapTo(x: number, y: number, scale?: number): void {
    this.centreX = x;
    this.centreY = y;
    if (scale !== undefined) {
      this.targetScale = clamp(scale, this.minScale, this.maxScale);
      this.currentScale = this.targetScale;
    }
    this.clampCentre();
  }

  /**
   * Asks for a zoom level. Applied over time rather than immediately, because a camera that
   * snaps its zoom every time the play spreads is unwatchable.
   */
  requestScale(scale: number): void {
    this.targetScale = clamp(scale, this.minScale, this.maxScale);
  }

  /**
   * Chooses a zoom that keeps a spread of interesting points in frame — the ball and the players
   * near it, typically. `padding` is the world-unit margin left around them.
   */
  frameToFit(points: readonly FollowTarget[], padding = 4): void {
    if (points.length === 0) return;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }

    const spanX = Math.max(maxX - minX + padding * 2, 1);
    const spanY = Math.max(maxY - minY + padding * 2, 1);
    this.requestScale(Math.min(this.viewWidth / spanX, this.viewHeight / spanY));
  }

  /**
   * Starts a shake. Ignored entirely under reduced motion — not merely scaled down, because a
   * small shake is still motion, and the setting exists for people it makes ill (`10` §6).
   */
  shake(magnitude: number, decayPerSecond = 4): void {
    if (this.reduced) return;
    this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude);
    this.shakeDecay = decayPerSecond;
  }

  get scale(): number {
    return this.currentScale;
  }

  get x(): number {
    return this.centreX;
  }

  get y(): number {
    return this.centreY;
  }

  /**
   * Advances the camera by one *frame*, not one sim step.
   *
   * Smoothing is frame-rate independent: the fraction of the remaining gap closed per second is
   * converted with `1 - e^(-rate·dt)`, so a 30 fps device and a 120 fps device see the same
   * motion. A naive `gap × rate × dt` would make the camera lag more on a slower device — which
   * is exactly the device that can least afford to look worse.
   */
  update(dt: number, target: FollowTarget | null, rng?: Rng): void {
    if (target !== null) {
      const lead = this.reduced ? 0 : this.lookahead;
      const aimX = target.x + (target.vx ?? 0) * lead;
      const aimY = target.y + (target.vy ?? 0) * lead;

      const follow = 1 - Math.exp(-this.followRate * dt);
      this.centreX += (aimX - this.centreX) * follow;
      this.centreY += (aimY - this.centreY) * follow;
    }

    const zoom = 1 - Math.exp(-this.zoomRate * dt);
    this.currentScale += (this.targetScale - this.currentScale) * zoom;

    this.clampCentre();
    this.updateShake(dt, rng);
  }

  private updateShake(dt: number, rng?: Rng): void {
    if (this.shakeMagnitude <= 0.001 || this.reduced) {
      this.shakeMagnitude = 0;
      this.shakeX = 0;
      this.shakeY = 0;
      return;
    }

    // Seeded, like everything else that looks random. An unseeded source here would make two
    // replays of the same match visibly different, which undermines trusting a replay at all.
    const angle = (rng?.next() ?? 0) * Math.PI * 2;
    this.shakeX = Math.cos(angle) * this.shakeMagnitude;
    this.shakeY = Math.sin(angle) * this.shakeMagnitude;
    this.shakeMagnitude = Math.max(
      0,
      this.shakeMagnitude - this.shakeDecay * this.shakeMagnitude * dt,
    );
  }

  /**
   * Keeps the visible rectangle inside the field. When the field is narrower than the viewport at
   * this zoom, the axis is centred instead — otherwise the clamp would jam the field against one
   * edge and leave dead space on the other.
   */
  private clampCentre(): void {
    const halfWorldWidth = this.viewWidth / this.currentScale / 2;
    const halfWorldHeight = this.viewHeight / this.currentScale / 2;

    this.centreX =
      halfWorldWidth * 2 >= this.worldWidth
        ? this.worldWidth / 2
        : clamp(this.centreX, halfWorldWidth, this.worldWidth - halfWorldWidth);

    this.centreY =
      halfWorldHeight * 2 >= this.worldHeight
        ? this.worldHeight / 2
        : clamp(this.centreY, halfWorldHeight, this.worldHeight - halfWorldHeight);
  }

  /** The transform the renderer draws with, shake included. */
  view(): ViewTransform {
    return {
      x: this.centreX + this.shakeX,
      y: this.centreY + this.shakeY,
      scale: this.currentScale,
      width: this.viewWidth,
      height: this.viewHeight,
    };
  }

  /** World → screen, for HUD markers pinned to entities. */
  worldToScreen(
    worldX: number,
    worldY: number,
    out: { x: number; y: number },
  ): { x: number; y: number } {
    const view = this.view();
    out.x = (worldX - view.x) * view.scale + view.width / 2;
    out.y = (worldY - view.y) * view.scale + view.height / 2;
    return out;
  }

  /** Screen → world, for taps that select a position or an athlete. */
  screenToWorld(
    screenX: number,
    screenY: number,
    out: { x: number; y: number },
  ): { x: number; y: number } {
    const view = this.view();
    out.x = (screenX - view.width / 2) / view.scale + view.x;
    out.y = (screenY - view.height / 2) / view.scale + view.y;
    return out;
  }
}
