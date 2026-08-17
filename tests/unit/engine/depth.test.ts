/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.6 — Depth sorting and occlusion
 * @story   US-2.5 — Run at a steady frame rate
 * @design  13-visual-overhaul.md §2.3
 *
 * Purpose: the two things depth sorting has to be — correct (ascending world y, so the nearer
 * athlete overlaps the further one) and *stable* (equal keys never swap between frames, or a
 * defender flickers in front of an attacker). Plus the one thing it must not be: visible to the
 * disc renderer, which passes no keys and must come out of `render` exactly as it did before.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { depthOrder, depthSorted } from '@/engine/render/depth.ts';
import { Renderer, type Canvas2D, type ViewTransform } from '@/engine/render/renderer.ts';
import { recordingCanvas } from '../../helpers/canvas.ts';

const VIEW: ViewTransform = { x: 0, y: 0, scale: 20, width: 800, height: 400 };

/** What each command drew, in the order the context saw it. */
function drawn(ctx: { calls: string[] }): string[] {
  return ctx.calls
    .filter((call) => call.startsWith('fillText'))
    .map((call) => call.slice('fillText('.length, call.indexOf(',')));
}

describe('depthOrder', () => {
  it('returns null when nothing carries a key — the disc renderer allocates nothing', () => {
    expect(depthOrder([undefined, undefined, undefined])).toBeNull();
    expect(depthOrder([])).toBeNull();
  });

  it('orders keyed commands by ascending key', () => {
    expect(depthOrder([3, 1, 2])).toEqual([1, 2, 0]);
  });

  it('keeps equal keys in submission order', () => {
    expect(depthOrder([5, 5, 5, 4])).toEqual([3, 0, 1, 2]);
  });

  it('draws keyless commands first, in submission order', () => {
    expect(depthOrder([2, undefined, 1, undefined])).toEqual([1, 3, 2, 0]);
  });

  it('treats a NaN key as no key rather than an arbitrary position', () => {
    expect(depthOrder([1, Number.NaN, 0])).toEqual([1, 2, 0]);
  });

  it('handles negative and fractional keys, which world y freely is', () => {
    expect(depthOrder([0.5, -2, -0.5])).toEqual([1, 2, 0]);
  });

  it('is a permutation of the input, always', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.double({ min: -1e3, max: 1e3, noNaN: true }), { nil: undefined })),
        (keys) => {
          const order = depthOrder(keys) ?? keys.map((_, i) => i);
          expect([...order].sort((a, b) => a - b)).toEqual(keys.map((_, i) => i));
        },
      ),
    );
  });

  it('is stable and ascending, for any keys at all', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.integer({ min: -20, max: 20 }), { nil: undefined }), {
          minLength: 1,
        }),
        (keys) => {
          const order = depthOrder(keys) ?? keys.map((_, i) => i);

          for (let i = 1; i < order.length; i++) {
            const before = order[i - 1] as number;
            const after = order[i] as number;
            const previous = keys[before];
            const current = keys[after];

            // A keyless command never follows a keyed one.
            if (previous !== undefined) expect(current).not.toBeUndefined();
            // Equal keys — and two keyless commands — stay in submission order.
            if (previous === current) expect(before).toBeLessThan(after);
            if (previous !== undefined && current !== undefined) {
              expect(previous).toBeLessThanOrEqual(current);
            }
          }
        },
      ),
    );
  });

  it('gives the same answer every time — a frame does not reshuffle itself (INV-8)', () => {
    const keys = [4, 1, 4, undefined, 0];
    expect(depthOrder(keys)).toEqual(depthOrder(keys));
  });
});

describe('depthSorted', () => {
  it('applies the order to a list', () => {
    expect(depthSorted(['a', 'b', 'c'], [2, 0, 1])).toEqual(['b', 'c', 'a']);
  });

  it('copies rather than aliases when there is nothing to sort', () => {
    const items = ['a', 'b'];
    const out = depthSorted(items, [undefined, undefined]);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });
});

describe('the entities layer', () => {
  it('draws two overlapping athletes in y order regardless of the order they were submitted', () => {
    const renderer = new Renderer();
    const ctx = recordingCanvas();

    // Submitted with the nearer athlete first, as an entity list ordered by id would give them.
    renderer.submit('entities', (c) => c.fillText('near', 0, 0), 9.4);
    renderer.submit('entities', (c) => c.fillText('far', 0, 0), 9.2);
    renderer.render(ctx as unknown as Canvas2D, VIEW);

    expect(drawn(ctx)).toEqual(['far', 'near']);
  });

  it('leaves every other layer in submission order, key or no key', () => {
    const renderer = new Renderer();
    const ctx = recordingCanvas();

    renderer.submit('effects', (c) => c.fillText('first', 0, 0), 99);
    renderer.submit('effects', (c) => c.fillText('second', 0, 0), 1);
    renderer.render(ctx as unknown as Canvas2D, VIEW);

    expect(drawn(ctx)).toEqual(['first', 'second']);
  });

  it('mixes keyed and keyless commands with the keyless underneath', () => {
    const renderer = new Renderer();
    const ctx = recordingCanvas();

    renderer.submit('entities', (c) => c.fillText('sprite', 0, 0), 3);
    renderer.submit('entities', (c) => c.fillText('marker', 0, 0));
    renderer.render(ctx as unknown as Canvas2D, VIEW);

    expect(drawn(ctx)).toEqual(['marker', 'sprite']);
  });

  it('leaves the disc path exactly as it was: insertion order and identical stats', () => {
    const renderer = new Renderer();
    const ctx = recordingCanvas();

    renderer.submit('entities', (c) => c.fillText('one', 0, 0));
    renderer.submitBatch('entities', { fill: '#fff' }, [
      (c) => c.fillText('two', 0, 0),
      (c) => c.fillText('three', 0, 0),
    ]);
    const stats = renderer.render(ctx as unknown as Canvas2D, VIEW);

    expect(drawn(ctx)).toEqual(['one', 'two', 'three']);
    expect(stats).toEqual({
      commands: 3,
      styleChanges: 1,
      full: 0,
      reduced: 0,
      minimal: 0,
      staticRedrawn: false,
    });
  });

  it('forgets the previous frame’s keys, so a frame that passes none is unsorted again', () => {
    const renderer = new Renderer();

    renderer.submit('entities', (c) => c.fillText('a', 0, 0), 5);
    renderer.submit('entities', (c) => c.fillText('b', 0, 0), 1);
    renderer.render(recordingCanvas() as unknown as Canvas2D, VIEW);

    const ctx = recordingCanvas();
    renderer.submit('entities', (c) => c.fillText('c', 0, 0));
    renderer.submit('entities', (c) => c.fillText('d', 0, 0));
    renderer.render(ctx as unknown as Canvas2D, VIEW);

    expect(drawn(ctx)).toEqual(['c', 'd']);
  });

  it('sorts a full squad the same way every frame', () => {
    const keys = [12.5, 3.2, 12.5, -4, 0, 8.1, 8.1, 8.1];
    const order = () => {
      const renderer = new Renderer();
      const ctx = recordingCanvas();
      keys.forEach((key, index) => {
        renderer.submit('entities', (c) => c.fillText(`e${index}`, 0, 0), key);
      });
      renderer.render(ctx as unknown as Canvas2D, VIEW);
      return drawn(ctx);
    };

    expect(order()).toEqual(['e3', 'e4', 'e1', 'e5', 'e6', 'e7', 'e0', 'e2']);
    expect(order()).toEqual(order());
  });
});
