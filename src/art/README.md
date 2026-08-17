# `src/art` — how sprite frames are authored

Spec: [`13-visual-overhaul.md`](../../specs/001-initial-dev/13-visual-overhaul.md) §2.1 and §3,
decision
[D-24](../../specs/001-initial-dev/07-decisions.md#d-24--the-visual-overhaul-is-sprites-not-pseudo-3d).
Pipeline: [`src/engine/render/atlas.ts`](../engine/render/atlas.ts) (T-13.2).

**Art here is data, not assets.** Every frame is a block of text inside a TypeScript module. There
are no image files, no fetch, and no build step: a pose file is ordinary code-split JS, the service
worker precaches it like any other chunk, and INV-4 (no runtime network) holds by construction. It
also means a frame's diff in review _is_ the picture.

---

## 1. The format

One frame is a `SpriteGrid`:

```ts
{
  w: 32,          // width in px
  h: 48,          // height in px
  ax: 16,         // anchor x — where the feet meet the ground
  ay: 46,         // anchor y
  rows: [ /* exactly h strings of exactly w characters */ ],
}
```

Each character is a palette index:

| Character | Meaning       |
| --------- | ------------- |
| `.`       | transparent   |
| `0`–`9`   | palette 0–9   |
| `a`–`z`   | palette 10–35 |
| `A`–`Z`   | palette 36–61 |

A character with no palette entry is an error, not a hole — `rasterise` throws, and the property
test in `tests/unit/engine/atlas.test.ts` runs it over every authored grid in the repo.

## 2. Layers

A frame is authored once per **layer**, and the layers composite in order:

| Layer  | Holds                                                                      | Palette                         |
| ------ | -------------------------------------------------------------------------- | ------------------------------- |
| `body` | skin, hair, socks, shoes, and the dark outline around the whole silhouette | shared (`ATHLETE_BODY_PALETTE`) |
| `kit`  | jersey, sleeves, shorts                                                    | per team — see below            |
| `prop` | anything a sport adds: gloves, a stick, a ball in the hands                | per sport                       |

The outline lives on `body` and is drawn **outside** the union silhouette, so the `kit` layer
composited on top of it never eats it.

Every layer of one frame must agree on `w`, `h`, `ax`, `ay`. `buildAtlas` throws if they don't.

## 3. Kit colours are palette indices, not pixels

The `kit` layer uses three reserved characters (`KIT` in `atlas.ts`):

| Char | Bound to                              |
| ---- | ------------------------------------- |
| `K`  | the team's fill colour                |
| `k`  | the kit's ink — numbers, collar, trim |
| `P`  | the pattern region                    |

`buildAtlas` is called once per team kit, with those three bound to that team's colours, so a match
holds two fully baked atlases and an athlete costs exactly one `drawImage` per frame.

**Pattern is geometry.** Stripes, hoops and halves are authored as `P` regions — shapes — never as a
second hue over the same shape. That is what makes team identity survive the three colour-vision
simulations in `10` §11, which Gate 13 checks.

## 4. Facings

Eight facings exist, five are authored (`13` §3.1):

```
     2 (N)
  3      1
4 (W)      0 (E)
  5      7
     6 (S)
```

Author `0` (E), `1` (NE), `2` (N), `6` (S), `7` (SE). West, north-west and south-west are these
mirrored about the anchor at draw time — `authoredFacing()` says which, `drawSprite()` does it.
Mirroring flips any cross-body asymmetry in a kit; that was accepted in D-24, so keep asymmetric
markings off the sprite and on the `P` regions, which are symmetric by design.

## 5. Sheet keys

A `SpriteSheet` maps `pose/facing` → frames in order:

```ts
{ 'idle/6': [frame0, frame1], 'run/6': [f0, f1, f2, f3, f4, f5] }
```

Use `poseKey(pose, facing)` to build the key and `frameKey(pose, facing, i)` to look one up in the
built atlas. Pose names and frame counts are fixed in `13` §3.1; the per-sport mapping from game
state to pose is `13` §5 (T-13.7).

## 6. A worked example

The smallest useful frame — a 4×4 stub with a transparent border, one body pixel and one kit pixel:

```ts
import type { SpriteGrid, SpriteSheet } from '../../engine/render/atlas.ts';

const body: SpriteGrid = {
  w: 4,
  h: 4,
  ax: 2,
  ay: 3,
  rows: [
    '.55.', //
    '5115',
    '5115',
    '.55.',
  ],
};

const kit: SpriteGrid = {
  w: 4,
  h: 4,
  ax: 2,
  ay: 3,
  rows: [
    '....', //
    '.KK.',
    '.PP.',
    '....',
  ],
};

export const STUB_BODY: SpriteSheet = { 'idle/6': [body] };
export const STUB_KIT: SpriteSheet = { 'idle/6': [kit] };
```

Built with `buildAtlas({ body: STUB_BODY, kit: STUB_KIT }, { body: …, kit: … }, createOffscreen)`,
that yields one frame under the key `idle/6/0`.

The real thing, at full size, is [`athlete/idle.ts`](./athlete/idle.ts) — the walking skeleton
T-13.2 leaves behind, visible on `#/dev/ui`.

## 7. Rules

1. **Nothing here imports from the sim.** Art modules import types from `atlas.ts` and nothing else.
2. **One file per pose.** `athlete/<pose>.ts` exports `<POSE>_BODY` and `<POSE>_KIT` sheets;
   `athlete/index.ts` merges them. Delegated art work is partitioned by file, never by area
   (`CLAUDE.md` §7.3.3).
3. **No clocks, no randomness.** Same grids and palette in, same bytes out — INV-2 and INV-8 reach
   into the render path too.
4. **Keep it inside the budget.** `src/art/**` has a 1.5 MB raw ceiling (D-24), asserted by
   `pnpm budget` (T-13.10). If frames ever approach it, run-length-encode the rows — the rasteriser
   is their only consumer — rather than lowering the ceiling.
5. **Art is imported lazily.** Only route-level dynamic imports may reach `src/art/**`, so none of
   it lands in the initial JS chunk.
