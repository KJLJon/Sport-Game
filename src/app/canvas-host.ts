/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.3 — App shell: canvas host, hash router, safe-area layout, orientation handling
 * @story   US-2.3 — See what's happening in a match
 * @design  04-architecture.md §6 (rendering), §9 (mobile and performance)
 *
 * Purpose: owns the match canvas and keeps its backing store in step with CSS size and device
 * pixel ratio. Sizing lives here rather than in the renderer so the renderer only ever deals in
 * logical pixels.
 */

export interface CanvasSize {
  /** CSS pixels — what layout and input work in. */
  readonly width: number;
  readonly height: number;
  /** Backing-store pixels — what the renderer draws into. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly dpr: number;
}

export type CanvasResizeListener = (size: CanvasSize) => void;

export interface CanvasHostOptions {
  /**
   * Backing store is capped so a 3× phone doesn't ask the GPU for nine times the fill rate.
   * `04` §9 gives us a frame-time budget; this is the cheapest lever on it.
   */
  readonly maxDpr?: number;
  readonly className?: string;
}

const DEFAULT_MAX_DPR = 2;

/** Computes the backing-store size for a CSS box, clamped and integral. */
export function computeCanvasSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  maxDpr: number = DEFAULT_MAX_DPR,
): CanvasSize {
  const width = Math.max(1, Math.floor(cssWidth));
  const height = Math.max(1, Math.floor(cssHeight));
  const ratio = Math.min(Math.max(devicePixelRatio, 1), maxDpr);

  return {
    width,
    height,
    pixelWidth: Math.max(1, Math.round(width * ratio)),
    pixelHeight: Math.max(1, Math.round(height * ratio)),
    dpr: ratio,
  };
}

/**
 * A canvas that resizes itself. Listeners fire only when the backing-store size actually changes,
 * so a resize that rounds to the same pixels costs nothing.
 */
export class CanvasHost {
  readonly canvas: HTMLCanvasElement;
  readonly #maxDpr: number;
  readonly #listeners = new Set<CanvasResizeListener>();
  #observer: ResizeObserver | null = null;
  #size: CanvasSize;

  constructor(document: Document, options: CanvasHostOptions = {}) {
    this.#maxDpr = options.maxDpr ?? DEFAULT_MAX_DPR;
    this.canvas = document.createElement('canvas');
    this.canvas.className = options.className ?? 'canvas-host';
    // The match view suppresses browser gestures itself (`04` §9); this is the declarative half.
    this.canvas.style.touchAction = 'none';
    this.#size = computeCanvasSize(1, 1, 1, this.#maxDpr);
  }

  get size(): CanvasSize {
    return this.#size;
  }

  /** Attaches to a parent and starts observing. Safe to call once. */
  attach(parent: HTMLElement, window: Window): void {
    parent.appendChild(this.canvas);

    // `ResizeObserver` is not declared on lib.dom's `Window`, and jsdom omits it entirely.
    const observerCtor = (window as Window & { ResizeObserver?: typeof ResizeObserver })
      .ResizeObserver;
    if (typeof observerCtor === 'function') {
      const observer = new observerCtor(() => this.measure(window));
      observer.observe(parent);
      this.#observer = observer;
    }
    this.measure(window);
  }

  detach(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    this.canvas.remove();
  }

  /** Re-reads the CSS box and applies the backing-store size if it changed. */
  measure(window: Window): CanvasSize {
    const rect = this.canvas.getBoundingClientRect();
    const next = computeCanvasSize(
      rect.width,
      rect.height,
      window.devicePixelRatio ?? 1,
      this.#maxDpr,
    );

    if (
      next.pixelWidth === this.#size.pixelWidth &&
      next.pixelHeight === this.#size.pixelHeight &&
      next.width === this.#size.width &&
      next.height === this.#size.height
    ) {
      return this.#size;
    }

    this.#size = next;
    this.canvas.width = next.pixelWidth;
    this.canvas.height = next.pixelHeight;

    for (const listener of this.#listeners) listener(next);
    return next;
  }

  onResize(listener: CanvasResizeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
