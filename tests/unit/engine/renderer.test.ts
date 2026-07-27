/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.7 — Canvas 2D renderer
 * @story   US-2.3, US-2.5
 * @design  04-architecture.md §6 (rendering)
 *
 * Purpose: layer order, the camera transform, batching, LOD tiers, and the static layer's
 * redraw policy — checked against a recording context, because what matters is which calls are
 * made in which order, not what they look like.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  Detail,
  LAYERS,
  Renderer,
  drawDebugOverlay,
  type Canvas2D,
  type OffscreenLayer,
  type ViewTransform,
} from '@/engine/render/renderer.ts';

interface Recorder extends Canvas2D {
  readonly calls: string[];
}

/** Records every call as a string, which makes ordering assertions readable. */
function recorder(): Recorder {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(
        `${name}(${args.map((a) => (typeof a === 'object' ? 'obj' : String(a))).join(',')})`,
      );
    };

  const ctx: Record<string, unknown> = {
    calls,
    save: record('save'),
    restore: record('restore'),
    scale: record('scale'),
    translate: record('translate'),
    rotate: record('rotate'),
    clearRect: record('clearRect'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    drawImage: record('drawImage'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left' as CanvasTextAlign,
  };

  return ctx as unknown as Recorder;
}

const VIEW: ViewTransform = { x: 14, y: 7.5, scale: 20, width: 800, height: 400 };

function fakeOffscreen(): { factory: () => OffscreenLayer; created: number } {
  let created = 0;
  const factory = () => {
    created++;
    const ctx = recorder();
    return { canvas: {} as CanvasImageSource, ctx, width: 800, height: 400 };
  };
  return {
    factory: factory as unknown as () => OffscreenLayer,
    get created() {
      return created;
    },
  };
}

describe('layers', () => {
  it('draws layers in the declared order regardless of submission order', () => {
    const renderer = new Renderer();
    const ctx = recorder();

    renderer.submit('hud', (c) => c.fillText('hud', 0, 0));
    renderer.submit('field', (c) => c.fillText('field', 0, 0));
    renderer.submit('ball', (c) => c.fillText('ball', 0, 0));
    renderer.render(ctx, VIEW);

    const drawn = ctx.calls.filter((call) => call.startsWith('fillText'));
    expect(drawn).toEqual(['fillText(field,0,0)', 'fillText(ball,0,0)', 'fillText(hud,0,0)']);
  });

  it('runs commands within a layer in submission order', () => {
    const renderer = new Renderer();
    const ctx = recorder();

    renderer.submit('entities', (c) => c.fillText('first', 0, 0));
    renderer.submit('entities', (c) => c.fillText('second', 0, 0));
    renderer.render(ctx, VIEW);

    expect(ctx.calls.filter((c) => c.startsWith('fillText'))).toEqual([
      'fillText(first,0,0)',
      'fillText(second,0,0)',
    ]);
  });

  it('clears the frame before anything is drawn', () => {
    const renderer = new Renderer();
    const ctx = recorder();
    renderer.submit('field', (c) => c.fillRect(0, 0, 1, 1));
    renderer.render(ctx, VIEW);

    expect(ctx.calls[0]).toBe('clearRect(0,0,800,400)');
  });

  it('applies the camera transform to world layers', () => {
    const renderer = new Renderer();
    const ctx = recorder();
    renderer.submit('entities', () => {});
    renderer.render(ctx, VIEW);

    expect(ctx.calls).toContain('translate(400,200)');
    expect(ctx.calls).toContain('scale(20,20)');
    expect(ctx.calls).toContain('translate(-14,-7.5)');
  });

  it('leaves the HUD in screen space', () => {
    const renderer = new Renderer();
    const ctx = recorder();
    renderer.submit('hud', () => {});
    renderer.render(ctx, VIEW);

    expect(ctx.calls.some((call) => call.startsWith('scale'))).toBe(false);
  });

  it('balances save and restore for every layer', () => {
    const renderer = new Renderer();
    const ctx = recorder();
    for (const layer of LAYERS) renderer.submit(layer, () => {});
    renderer.render(ctx, VIEW);

    const saves = ctx.calls.filter((c) => c === 'save()').length;
    const restores = ctx.calls.filter((c) => c === 'restore()').length;
    expect(saves).toBe(LAYERS.length);
    expect(restores).toBe(saves);
  });

  it('empties its queues between frames', () => {
    const renderer = new Renderer();
    renderer.submit('entities', (c) => c.fillRect(0, 0, 1, 1));

    const first = recorder();
    renderer.render(first, VIEW);
    const second = recorder();
    renderer.render(second, VIEW);

    expect(first.calls.some((c) => c.startsWith('fillRect'))).toBe(true);
    expect(second.calls.some((c) => c.startsWith('fillRect'))).toBe(false);
  });
});

describe('batching', () => {
  it('sets a shared style once for the whole batch', () => {
    const renderer = new Renderer();
    const ctx = recorder();
    const items = Array.from({ length: 22 }, (_, i) => (c: Canvas2D) => c.fillRect(i, 0, 1, 1));

    renderer.submitBatch('entities', { fill: '#f00' }, items);
    const stats = renderer.render(ctx, VIEW);

    expect(stats.styleChanges).toBe(1);
    expect(ctx.calls.filter((c) => c.startsWith('fillRect'))).toHaveLength(22);
  });

  it('counts every item in the batch as a command', () => {
    const renderer = new Renderer();
    const items = Array.from({ length: 5 }, () => () => {});

    renderer.submitBatch('entities', { fill: '#0f0' }, items);
    expect(renderer.render(recorder(), VIEW).commands).toBe(5);
  });

  it('does nothing for an empty batch', () => {
    const renderer = new Renderer();
    renderer.submitBatch('entities', { fill: '#0f0' }, []);
    expect(renderer.render(recorder(), VIEW).commands).toBe(0);
  });

  it('does not re-set a style that is already current', () => {
    const renderer = new Renderer();
    renderer.submitBatch('entities', { fill: '#f00' }, [() => {}]);
    renderer.submitBatch('effects', { fill: '#f00' }, [() => {}]);

    expect(renderer.render(recorder(), VIEW).styleChanges).toBe(1);
  });

  it('counts a genuine style change', () => {
    const renderer = new Renderer();
    renderer.submitBatch('entities', { fill: '#f00' }, [() => {}]);
    renderer.submitBatch('effects', { fill: '#00f', stroke: '#fff' }, [() => {}]);

    expect(renderer.render(recorder(), VIEW).styleChanges).toBe(3);
  });

  it('restores alpha after a translucent batch', () => {
    const renderer = new Renderer();
    const ctx = recorder();
    renderer.submitBatch('shadows', { fill: '#000', alpha: 0.3 }, [() => {}]);
    renderer.render(ctx, VIEW);

    expect(ctx.globalAlpha).toBe(1);
  });

  it('starts each frame assuming nothing about the context state', () => {
    const renderer = new Renderer();
    renderer.submitBatch('entities', { fill: '#f00' }, [() => {}]);
    renderer.render(recorder(), VIEW);

    renderer.submitBatch('entities', { fill: '#f00' }, [() => {}]);
    expect(renderer.render(recorder(), VIEW).styleChanges).toBe(1);
  });
});

describe('level of detail', () => {
  const renderer = new Renderer();

  it('gives full detail at the camera centre', () => {
    expect(renderer.detailFor(VIEW, 14, 7.5)).toBe(Detail.FULL);
  });

  it('steps down with distance', () => {
    const near = renderer.detailFor(VIEW, 14 + 5, 7.5);
    const mid = renderer.detailFor(VIEW, 14 + 15, 7.5);
    const far = renderer.detailFor(VIEW, 14 + 40, 7.5);

    expect(near).toBe(Detail.FULL);
    expect(mid).toBe(Detail.REDUCED);
    expect(far).toBe(Detail.MINIMAL);
  });

  it('never increases with distance', () => {
    let previous: number = Detail.FULL;
    for (let d = 0; d < 60; d += 2) {
      const level = renderer.detailFor(VIEW, 14 + d, 7.5);
      expect(level).toBeLessThanOrEqual(previous);
      previous = level;
    }
  });

  it('is zoom-relative, so the same world point can change tier', () => {
    const zoomedOut: ViewTransform = { ...VIEW, scale: 5 };
    expect(renderer.detailFor(VIEW, 14 + 15, 7.5)).toBe(Detail.REDUCED);
    expect(renderer.detailFor(zoomedOut, 14 + 15, 7.5)).toBe(Detail.FULL);
  });

  it('reports the tier counts for the frame', () => {
    const r = new Renderer();
    r.countDetail(Detail.FULL);
    r.countDetail(Detail.FULL);
    r.countDetail(Detail.MINIMAL);

    const stats = r.render(recorder(), VIEW);
    expect([stats.full, stats.reduced, stats.minimal]).toEqual([2, 0, 1]);
  });

  it('culls what is off-screen, with a radius margin', () => {
    expect(renderer.isVisible(VIEW, 14, 7.5)).toBe(true);
    expect(renderer.isVisible(VIEW, 14 + 19, 7.5)).toBe(true);
    expect(renderer.isVisible(VIEW, 14 + 25, 7.5)).toBe(false);
    expect(renderer.isVisible(VIEW, 14 + 25, 7.5, 6)).toBe(true);
  });
});

describe('static layer', () => {
  it('draws once and blits thereafter', () => {
    const offscreen = fakeOffscreen();
    const renderer = new Renderer(offscreen.factory);
    const draw = vi.fn();

    for (let frame = 0; frame < 5; frame++) {
      renderer.setStatic('court:dark:800x400', 800, 400, draw);
      renderer.render(recorder(), VIEW);
    }

    expect(draw).toHaveBeenCalledTimes(1);
    expect(offscreen.created).toBe(1);
  });

  it('blits the static layer before any queued layer', () => {
    const offscreen = fakeOffscreen();
    const renderer = new Renderer(offscreen.factory);
    const ctx = recorder();

    renderer.setStatic('court', 800, 400, () => {});
    renderer.submit('field', (c) => c.fillRect(0, 0, 1, 1));
    renderer.render(ctx, VIEW);

    expect(ctx.calls.indexOf('drawImage(obj,0,0)')).toBeLessThan(
      ctx.calls.findIndex((c) => c.startsWith('fillRect')),
    );
  });

  it('redraws when the key changes — a theme switch, say', () => {
    const renderer = new Renderer(fakeOffscreen().factory);
    const draw = vi.fn();

    renderer.setStatic('court:dark', 800, 400, draw);
    renderer.setStatic('court:dark', 800, 400, draw);
    renderer.setStatic('court:light', 800, 400, draw);

    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('redraws when the viewport resizes', () => {
    const offscreen = fakeOffscreen();
    const renderer = new Renderer(offscreen.factory);
    const draw = vi.fn();

    renderer.setStatic('court', 800, 400, draw);
    renderer.setStatic('court', 400, 800, draw);

    expect(draw).toHaveBeenCalledTimes(2);
    expect(offscreen.created).toBe(2);
  });

  it('redraws on demand', () => {
    const renderer = new Renderer(fakeOffscreen().factory);
    const draw = vi.fn();

    renderer.setStatic('court', 800, 400, draw);
    renderer.invalidateStatic();
    renderer.setStatic('court', 800, 400, draw);

    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('reports whether the static layer cost anything this frame', () => {
    const renderer = new Renderer(fakeOffscreen().factory);
    renderer.setStatic('court', 800, 400, () => {});
    expect(renderer.render(recorder(), VIEW).staticRedrawn).toBe(true);

    renderer.setStatic('court', 800, 400, () => {});
    expect(renderer.render(recorder(), VIEW).staticRedrawn).toBe(false);
  });

  it('degrades to no static layer when off-screen canvases are unavailable', () => {
    const renderer = new Renderer(null);
    const draw = vi.fn();
    const ctx = recorder();

    renderer.setStatic('court', 800, 400, draw);
    renderer.render(ctx, VIEW);

    expect(draw).not.toHaveBeenCalled();
    expect(ctx.calls.some((c) => c.startsWith('drawImage'))).toBe(false);
  });
});

describe('reduced motion', () => {
  it('reports the preference for effects to honour', () => {
    expect(new Renderer(null, { reducedMotion: true }).reducedMotion).toBe(true);
    expect(new Renderer(null).reducedMotion).toBe(false);
  });
});

describe('drawDebugOverlay', () => {
  it('writes four lines of diagnostics and restores the context', () => {
    const ctx = recorder();
    drawDebugOverlay(ctx, {
      fps: 58.6,
      frameMs: 17.1,
      simMs: 2.35,
      entities: 22,
      stats: {
        commands: 40,
        styleChanges: 6,
        full: 8,
        reduced: 9,
        minimal: 5,
        staticRedrawn: false,
      },
    });

    const texts = ctx.calls.filter((c) => c.startsWith('fillText'));
    expect(texts).toHaveLength(4);
    expect(texts[0]).toContain('59 fps');
    expect(texts[3]).toContain('LOD 8/9/5');
    expect(ctx.calls[0]).toBe('save()');
    expect(ctx.calls.at(-1)).toBe('restore()');
  });
});
