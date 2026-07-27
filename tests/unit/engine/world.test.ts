/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.3 — Entity model: struct-of-arrays state, spatial hash
 * @story   US-2.5 — Run at a steady frame rate
 * @design  04-architecture.md §6 (entities)
 * @invariant INV-8
 *
 * Purpose: the entity lifecycle, and the spatial hash's answers checked against brute force —
 * a grid that is fast and subtly wrong is worse than no grid at all.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Flags, NO_ENTITY, World, type EntityId } from '@/engine/world.ts';
import { createRng } from '@/engine/rng.ts';

function court(): World {
  return new World({ width: 28, height: 15, cellSize: 4, capacity: 32 });
}

/** The answer the grid has to agree with, computed the slow, obviously-correct way. */
function bruteForce(world: World, x: number, y: number, radius: number, exclude = NO_ENTITY) {
  const ids: EntityId[] = [];
  world.forEach((id) => {
    if (id === exclude) return;
    const dx = (world.x[id] as number) - x;
    const dy = (world.y[id] as number) - y;
    if (dx * dx + dy * dy <= radius * radius) ids.push(id);
  });
  return ids;
}

function collect(count: number, out: Int32Array): EntityId[] {
  return Array.from(out.subarray(0, count));
}

describe('World — lifecycle', () => {
  it('spawns with defaults and reports its fields', () => {
    const world = court();
    const id = world.spawn({ x: 3, y: 4 });

    expect(id).toBe(0);
    expect(world.count).toBe(1);
    expect(world.isAlive(id)).toBe(true);
    expect(world.x[id]).toBe(3);
    expect(world.y[id]).toBe(4);
    expect(world.z[id]).toBe(0);
    expect(world.team[id]).toBe(-1);
    expect(world.radius[id]).toBeCloseTo(0.4, 6);
  });

  it('keeps every field it is given', () => {
    const world = court();
    const id = world.spawn({
      x: 1,
      y: 2,
      z: 3,
      vx: 4,
      vy: 5,
      vz: 6,
      facing: 1.5,
      radius: 0.5,
      mass: 95,
      team: 1,
      kind: 2,
      tag: 7,
    });

    expect([world.z[id], world.vx[id], world.vy[id], world.vz[id]]).toEqual([3, 4, 5, 6]);
    expect(world.facing[id]).toBeCloseTo(1.5, 5);
    expect([world.mass[id], world.team[id], world.kind[id], world.tag[id]]).toEqual([95, 1, 2, 7]);
  });

  it('reuses the lowest free slot, so ids are reproducible across a replay', () => {
    const world = court();
    const a = world.spawn({ x: 0, y: 0 });
    const b = world.spawn({ x: 1, y: 0 });
    const c = world.spawn({ x: 2, y: 0 });

    world.despawn(b);
    expect(world.count).toBe(2);
    expect(world.spawn({ x: 3, y: 0 })).toBe(b);

    world.despawn(a);
    world.despawn(c);
    expect(world.spawn({ x: 4, y: 0 })).toBe(a);
    expect(world.spawn({ x: 5, y: 0 })).toBe(c);
  });

  it('ignores a despawn of something already dead', () => {
    const world = court();
    const id = world.spawn({ x: 0, y: 0 });
    world.despawn(id);
    world.despawn(id);
    world.despawn(999);
    expect(world.count).toBe(0);
    expect(world.isAlive(id)).toBe(false);
  });

  it('throws when full rather than silently dropping an athlete', () => {
    const world = new World({ width: 10, height: 10, capacity: 2 });
    world.spawn({ x: 0, y: 0 });
    world.spawn({ x: 1, y: 1 });
    expect(() => world.spawn({ x: 2, y: 2 })).toThrow(/full/i);
  });

  it('clears every slot but keeps its arrays', () => {
    const world = court();
    for (let i = 0; i < 10; i++) world.spawn({ x: i, y: 0 });
    world.clear();

    expect(world.count).toBe(0);
    expect(world.spawn({ x: 0, y: 0 })).toBe(0);
  });

  it('visits live entities in ascending id order', () => {
    const world = court();
    const ids = [0, 1, 2, 3].map((i) => world.spawn({ x: i, y: 0 }));
    world.despawn(ids[1] as EntityId);

    const visited: EntityId[] = [];
    world.forEach((id) => visited.push(id));
    expect(visited).toEqual([0, 2, 3]);
  });

  it('sets and clears flags independently', () => {
    const world = court();
    const id = world.spawn({ x: 0, y: 0 });

    expect(world.hasFlag(id, Flags.FROZEN)).toBe(false);
    world.setFlag(id, Flags.FROZEN);
    world.setFlag(id, Flags.PLAYER_CONTROLLED);
    expect(world.hasFlag(id, Flags.FROZEN)).toBe(true);
    expect(world.hasFlag(id, Flags.PLAYER_CONTROLLED)).toBe(true);

    world.setFlag(id, Flags.FROZEN, false);
    expect(world.hasFlag(id, Flags.FROZEN)).toBe(false);
    expect(world.hasFlag(id, Flags.PLAYER_CONTROLLED)).toBe(true);
  });
});

describe('World — spatial hash', () => {
  it('finds neighbours within the radius and nothing outside it', () => {
    const world = court();
    const centre = world.spawn({ x: 14, y: 7.5 });
    const near = world.spawn({ x: 15, y: 7.5 });
    const edge = world.spawn({ x: 16, y: 7.5 });
    world.spawn({ x: 25, y: 14 });

    const out = new Int32Array(32);
    world.reindex();

    expect(collect(world.queryNeighbours(centre, 2.5, out), out).sort()).toEqual(
      [near, edge].sort(),
    );
    expect(collect(world.queryNeighbours(centre, 1.5, out), out)).toEqual([near]);
  });

  it('includes an entity exactly on the radius', () => {
    const world = court();
    const centre = world.spawn({ x: 10, y: 10 });
    const exact = world.spawn({ x: 13, y: 10 });

    const out = new Int32Array(8);
    expect(collect(world.queryNeighbours(centre, 3, out), out)).toEqual([exact]);
  });

  it('spans cell boundaries, both directions', () => {
    // cellSize is 4, so these sit either side of the boundary at x = 12.
    const world = court();
    const left = world.spawn({ x: 11.9, y: 7 });
    const right = world.spawn({ x: 12.1, y: 7 });

    const out = new Int32Array(8);
    expect(collect(world.queryNeighbours(left, 1, out), out)).toEqual([right]);
    expect(collect(world.queryNeighbours(right, 1, out), out)).toEqual([left]);
  });

  it('agrees with brute force over random layouts', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (seed) => {
        const world = court();
        const rng = createRng(`layout-${seed}`);
        for (let i = 0; i < 22; i++) {
          world.spawn({ x: rng.float(0, 28), y: rng.float(0, 15) });
        }
        world.reindex();

        const out = new Int32Array(32);
        for (let probe = 0; probe < 8; probe++) {
          const x = rng.float(0, 28);
          const y = rng.float(0, 15);
          const radius = rng.float(0.5, 6);
          expect(collect(world.queryRadius(x, y, radius, out), out).sort((a, b) => a - b)).toEqual(
            bruteForce(world, x, y, radius).sort((a, b) => a - b),
          );
        }
      }),
      { numRuns: 40 },
    );
  });

  it('returns the same order every time, for the same positions', () => {
    const world = court();
    const rng = createRng('order');
    for (let i = 0; i < 20; i++) world.spawn({ x: rng.float(0, 28), y: rng.float(0, 15) });

    const first = new Int32Array(32);
    const second = new Int32Array(32);
    world.reindex();
    const count = world.queryRadius(14, 7.5, 10, first);
    world.reindex();

    expect(world.queryRadius(14, 7.5, 10, second)).toBe(count);
    expect(collect(count, first)).toEqual(collect(count, second));
  });

  it('excludes the querying entity but not its twin at the same point', () => {
    const world = court();
    const a = world.spawn({ x: 5, y: 5 });
    const b = world.spawn({ x: 5, y: 5 });

    const out = new Int32Array(8);
    expect(collect(world.queryNeighbours(a, 1, out), out)).toEqual([b]);
    expect(collect(world.queryNeighbours(b, 1, out), out)).toEqual([a]);
  });

  it('stops at the caller-supplied buffer size instead of growing it', () => {
    const world = court();
    for (let i = 0; i < 20; i++) world.spawn({ x: 14, y: 7.5 });

    const small = new Int32Array(4);
    expect(world.queryRadius(14, 7.5, 5, small)).toBe(4);
  });

  it('handles a query wholly outside the field', () => {
    const world = court();
    world.spawn({ x: 14, y: 7.5 });

    const out = new Int32Array(8);
    expect(world.queryRadius(-50, -50, 1, out)).toBe(0);
  });

  it('indexes entities outside the field into the edge cells rather than losing them', () => {
    const world = court();
    const stray = world.spawn({ x: -3, y: 20 });

    const out = new Int32Array(8);
    expect(collect(world.queryRadius(-3, 20, 1, out), out)).toEqual([stray]);
  });

  it('reindexes lazily when a query follows a spawn', () => {
    const world = court();
    world.reindex();
    expect(world.isIndexed).toBe(true);

    world.spawn({ x: 1, y: 1 });
    expect(world.isIndexed).toBe(false);

    const out = new Int32Array(8);
    expect(world.queryRadius(1, 1, 1, out)).toBe(1);
    expect(world.isIndexed).toBe(true);
  });

  it('uses the stale grid until told positions moved — which is why invalidateIndex exists', () => {
    const world = court();
    const id = world.spawn({ x: 1, y: 1 });
    world.reindex();

    world.x[id] = 26;
    const out = new Int32Array(8);
    expect(world.queryRadius(26, 1, 0.5, out)).toBe(0);

    world.invalidateIndex();
    expect(collect(world.queryRadius(26, 1, 0.5, out), out)).toEqual([id]);
  });

  it('drops despawned entities from the next index', () => {
    const world = court();
    const a = world.spawn({ x: 5, y: 5 });
    const b = world.spawn({ x: 5.5, y: 5 });
    world.reindex();

    world.despawn(b);
    const out = new Int32Array(8);
    expect(collect(world.queryRadius(5, 5, 2, out), out)).toEqual([a]);
  });

  it('survives a world one cell wide', () => {
    const world = new World({ width: 3, height: 3, cellSize: 10, capacity: 8 });
    const a = world.spawn({ x: 1, y: 1 });
    const b = world.spawn({ x: 2, y: 2 });

    expect(world.cols).toBe(1);
    expect(world.rows).toBe(1);

    const out = new Int32Array(8);
    expect(collect(world.queryNeighbours(a, 5, out), out)).toEqual([b]);
  });
});

describe('World — distance and nearest', () => {
  it('measures distance on the ground plane', () => {
    const world = court();
    const a = world.spawn({ x: 0, y: 0, z: 5 });
    const b = world.spawn({ x: 3, y: 4, z: 0 });

    expect(world.distanceSquared(a, b)).toBeCloseTo(25, 6);
    expect(world.distance(a, b)).toBeCloseTo(5, 6);
  });

  it('finds the nearest entity, ties going to the lower id', () => {
    const world = court();
    const near = world.spawn({ x: 6, y: 5 });
    world.spawn({ x: 9, y: 5 });
    const scratch = new Int32Array(16);

    expect(world.nearest(5, 5, 10, scratch)).toBe(near);

    const tieA = world.spawn({ x: 20, y: 5 });
    const tieB = world.spawn({ x: 20, y: 5 });
    expect(world.nearest(20, 5, 1, scratch)).toBe(tieA);
    expect(world.nearest(20, 5, 1, scratch, tieA)).toBe(tieB);
  });

  it('returns NO_ENTITY when nothing is in range', () => {
    const world = court();
    world.spawn({ x: 27, y: 14 });
    expect(world.nearest(1, 1, 2, new Int32Array(8))).toBe(NO_ENTITY);
  });
});

describe('World — bounds', () => {
  it('clamps a position back inside, honouring the margin', () => {
    const world = court();
    const id = world.spawn({ x: -5, y: 40 });
    world.clampToBounds(id, 0.5);

    expect(world.x[id]).toBeCloseTo(0.5, 6);
    expect(world.y[id]).toBeCloseTo(14.5, 6);
  });

  it('reports whether a point is inside', () => {
    const world = court();
    expect(world.inBounds(0, 0)).toBe(true);
    expect(world.inBounds(28, 15)).toBe(true);
    expect(world.inBounds(28.1, 7)).toBe(false);
    expect(world.inBounds(14, -0.1)).toBe(false);
  });
});
