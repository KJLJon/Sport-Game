/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.6 — Depth sorting and occlusion, the 2D equivalent for sprites
 * @story   US-2.5 — Run at a steady frame rate
 * @design  13-visual-overhaul.md §2.3 (depth sort), 07-decisions.md D-24
 * @invariant INV-8 (rendering never feeds back into the simulation)
 *
 * Purpose: draw order within one layer, from each command's world y. In a top-down world that is
 * the whole of occlusion — the athlete nearer the bottom of the screen is nearer the viewer, so
 * they are drawn last and overlap the one behind them.
 *
 * **Why it is a sort of keys and not a sort of entities.** The engine cannot know what a sport is
 * drawing (T-6.16), so it never sees athletes here — only the commands a sport queued and the key
 * it attached to each. That keeps depth a render-layer concern with no route back into the sim,
 * and lets the disc renderer, which passes no keys at all, come through completely untouched.
 *
 * **Stability is the requirement, not speed.** Two athletes at the same y must draw in the order
 * the sport submitted them, every frame, or a snapshot test flickers and a defender flips in front
 * of an attacker for one frame at a time. `Array.prototype.sort` has been stable since ES2019, but
 * the tie-break is written out explicitly rather than inherited from that promise, because
 * "stable" here is a property the tests assert, not an implementation detail.
 */

/**
 * Draw order for one layer's commands, as indices into it.
 *
 * Commands with no key keep their submission order and come **first** — they are the background of
 * their layer, and a sport that mixes keyed and keyless draws in one layer means the keyless ones
 * to sit underneath. `NaN` counts as no key: an entity whose position went bad should end up at
 * the back, not at an arbitrary point in the middle.
 *
 * Returns `null` when nothing carries a key, which is the disc renderer's every frame — the caller
 * then iterates its queue in place, allocating nothing.
 */
export function depthOrder(keys: readonly (number | undefined)[]): number[] | null {
  let keyed = 0;
  for (const key of keys) {
    if (key !== undefined && !Number.isNaN(key)) keyed++;
  }
  if (keyed === 0) return null;

  const order: number[] = [];
  for (let i = 0; i < keys.length; i++) order.push(i);

  order.sort((a, b) => {
    const ka = keys[a];
    const kb = keys[b];
    const hasA = ka !== undefined && !Number.isNaN(ka);
    const hasB = kb !== undefined && !Number.isNaN(kb);

    if (!hasA && !hasB) return a - b;
    if (!hasA) return -1;
    if (!hasB) return 1;
    if (ka === kb) return a - b;
    return (ka as number) - (kb as number);
  });

  return order;
}

/** `depthOrder` applied to a list — the shape tests and any sport batching its own draws want. */
export function depthSorted<T>(items: readonly T[], keys: readonly (number | undefined)[]): T[] {
  const order = depthOrder(keys);
  if (order === null) return [...items];
  return order.map((index) => items[index] as T);
}
