# Phase 13 — Visual overhaul: sprites and pseudo-3D (bonus) — task notes

Long-form rationale per task. Headlines live in [`PROGRESS.md`](../PROGRESS.md); this file is read
only when touching this phase's code.

### T-13.1

**Sprites, not pseudo-3D — D-24 in [`07-decisions.md`](../07-decisions.md), design in
[`13-visual-overhaul.md`](../13-visual-overhaul.md).**

The deciding observations, in order of weight:

1. **Pseudo-3D re-opens Phase 12.** The entire camera/director/framing stack is built and tested
   on an orthographic `ViewTransform { x, y, scale }` — span arithmetic, `legibleSpan`, LOD,
   pointer hit tests, playbook diagrams, every visual snapshot. An isometric projection breaks all
   of it at once, in code that is `done` and shipped as v1.2.
2. **Pseudo-3D still needs the sprite art.** Projected athletes need directional frames either
   way, so it is the sprite bill *plus* projection churn — strictly additive cost.
3. **Budget is a non-issue for sprites.** Gate-12 recorded 544.5 KB precache of 6 MB and
   70.8 KB gzip initial JS of 200 KB. The sprite ceiling (D-24 arithmetic) is ~1.5 MB raw,
   code-split out of the initial chunk — under 28 % of headroom.
4. **The floor requirement (disc renderer stays selectable) favours the additive change.**
   Sprites are a second `SportRenderer` implementation behind an unchanged seam; pseudo-3D would
   mean two live projection stacks.

Scope beyond the bare decision: this task also produced `13-visual-overhaul.md` — settled
interfaces (atlas, tint, depth-sort, graphics tier), the art authoring format (text pixel grids
rasterised at load — no image files, so INV-4 holds by construction and the rasteriser is
node-testable), per-task file ownership, delegation assignments per CLAUDE.md §7, and a
four-session execution plan. That was deliberate: the phase was sized against a constrained
session budget, so T-13.1's deliverable is everything a cold Opus/Sonnet session needs to execute
T-13.2…T-13.12 without re-deriving context. No `src/` code was touched; the suite was not affected
(docs-only change; `pnpm progress:check` green).

Open risk carried into T-13.3: mirroring W/NW/SW from E/NE/SE flips cross-body kit asymmetry.
Accepted in D-24 — if it reads badly on a real device, author the three extra facings for the kit
layer only (~30 % more kit grids, still inside the ceiling).

### T-13.2

**The pipeline is `src/art/**` (text pixel grids) → `rasterise()` → `buildAtlas()` → `drawSprite()`,
and nothing else.** Built exactly as `13` §2.1 settled it; the notes below are the places where
implementing it forced a decision the design document had left open.

**Palette characters go up to 62, not 36.** `13` §2.1 wrote "'0'–'9' 'a'–'z' index the palette",
and §2.2 reserved `K`, `k` and `P` for the kit layer — which does not fit in a 36-slot space
without `k` colliding with index 20. So `paletteIndex` maps `0-9` → 0–9, `a-z` → 10–35 and
`A-Z` → 36–61. The reserved kit characters land in the upper range and every other index is free.
Art files author palettes as a character map (`paletteFrom({ '1': '#c98a5e', K: null })`) rather
than a sparse array with a hole at index 46, which is unreadable and easy to mis-index.

**Sheet keys are `pose/facing`, atlas keys are `pose/facing/frame`.** `SpriteSheet`'s declared type
is `Record<string, SpriteGrid[]>` and the atlas key in §2.1 is `${pose}/${facing}/${i}` — the
facing has to live somewhere, and putting it in the sheet key keeps the declared type unchanged.
`poseKey()` and `frameKey()` are the only places that string is built, so it can be changed in one
edit if a sport ever needs a third dimension.

**Compositing happens in the byte buffer, not on the canvas.** `putImageData` ignores
`globalAlpha` and every composite mode, so drawing the kit layer *over* the body layer with canvas
calls would need a second offscreen canvas per frame. Instead `rasterise` runs per layer and `over()`
does source-over in the `Uint8ClampedArray`, so one `createImageData` + `putImageData` pair lands
each finished frame. That is also why the `Canvas2D` slice needed those two members and not a
blend mode.

**Rasterise throws; drawSprite doesn't.** Every authoring mistake a grid can contain — wrong row
length, wrong row count, a character with no palette entry, a colour that isn't hex — throws at
build time with the row number in the message. A missing *atlas key* at draw time returns `false`
instead, because throwing inside a render loop turns a missing pose into a black screen. T-13.7's
property test over the full pose mapping is where a missing key is meant to fail.

**The walking skeleton is a real athlete, not a test pattern.** `src/art/athlete/idle.ts` is one
hand-authored 32×48 south-facing frame in two layers (body carries the outline around the whole
silhouette; kit carries jersey, sleeves, shorts and a `P` band pair), and `#/dev/ui` builds two
tinted atlases from it and draws them through the real `Renderer`. It is deliberately more work
than a coloured square: T-13.3's agents need a worked example at full size to author against, and
`src/art/README.md` §6 points at it.

**Feel note.** Rendered in Chromium at device-pixel-ratio 2 (`#/dev/ui`), two 48-px athletes in
team kits are the first thing in this project that has looked like a game rather than a simulation
of one — the silhouette reads as a person at Live zoom, and the kit colour lands where a kit goes.
The frame is stiff: one idle frame per pose is a mannequin, the arms are stubby, and the head is
large even for the readability the size demands. All three are T-13.3's to fix, and worth knowing
before 340 frames are authored against the proportions.

**Verified in a browser, not on a device.** The screenshot above is the check that the pipeline
works end to end — grids, palettes, compositing, packing, blit. The atlas is built once per kit at
load and every frame is one `drawImage`; whether that holds the `12` §6 budget on real hardware is
T-13.9's measurement, not a claim made here.

### T-13.6

**`submit(layer, command, sortKey?)`, sorted on the `entities` layer only.** `13` §2.3 named the
method `add`; the renderer's method has been `submit` since T-1.7, so the optional third argument
went there. Sorting is restricted to `entities` because a sport reordering the ball, the effects
or the HUD by y is not a feature — the layer stack already answers those, and `LAYERS` exists
precisely so "why is the ball behind the crowd" is not a bug worth having twice.

**`depthOrder` returns `null` when nothing is keyed.** That is every frame the disc renderer draws.
The alternative — always producing an identity permutation — allocates an array of 22 integers per
frame to express "change nothing". The `null` path costs one comparison per submitted command, and
the disc renderer's `FrameStats` come out byte-identical, which is asserted rather than assumed.

**Stability is written out, not inherited.** `Array.prototype.sort` has been stable since ES2019,
so the explicit index tie-break is redundant — deliberately. Equal-y athletes swapping between
frames is exactly the flicker this task exists to prevent, and a property test asserting a promise
the code makes itself is worth more than one asserting a promise the runtime makes.

**`NaN` is treated as keyless.** An entity whose position has gone bad draws at the back rather
than at an arbitrary point in the middle of the squad, which is both the safer failure and the
easier one to see.

**Feel note.** Four athletes submitted deliberately back-to-front on the gallery page draw in the
right order in Chromium, and the overlap is what sells the depth — a sprite that occludes the one
behind it reads as standing in front of them, with no projection change anywhere. It is a
sixty-line module doing the whole of what D-24 promised instead of an isometric camera.

**Still outstanding:** the sport-side call sites. `sprite-art.ts` does not exist until T-13.3, so
nothing in a match passes a `sortKey` yet — the gallery preview is the only caller, and the
pattern to copy.
