# 13 — Visual Overhaul: Sprites (implementation design)

The execution design for Phase 13 (`03` "Phase 13", decision **D-24** in `07-decisions.md`). This
document is written so a fresh session — Opus or Sonnet — can take any task in the phase cold: every
interface is settled here, every task names the files it owns, and the delegation rules from
`CLAUDE.md` §7 are applied per task. Read D-24 first; this document assumes its conclusion
(top-down sprites, y-sorted, runtime kit tinting, art as in-repo data).

**Read this document's section for your task, plus D-24, plus the files the task names. Nothing
else in this document is required for any single task.**

---

## 1. The shape of the whole

Nothing in the sim changes. Nothing in the camera changes. The phase happens entirely behind the
`SportRenderer` seam (`src/sports/types.ts`) and inside the engine's render layer:

```
src/art/                     ← authored pixel-grid data (new, T-13.2/3/4/5)
src/engine/render/atlas.ts   ← grid → rasterised atlas, frame accessors (new, T-13.2)
src/engine/render/tint.ts    ← kit tinting compositor (new, T-13.3)
src/engine/render/depth.ts   ← y-sort within the entities layer (new, T-13.6)
src/sports/*/sprite-art.ts   ← per-sport sprite renderer, sibling of art.ts (new, T-13.3–13.5, 13.7)
src/app/graphics.ts          ← quality setting + device probe (new, T-13.11)
```

Principles, all inherited and none negotiable:

1. **Art is data in the repo.** Frames are authored as text pixel grids inside TypeScript modules
   and rasterised to off-screen canvases once at load. No image files, no fetch, no decode path,
   no new build tooling — INV-4 (no runtime network) holds by construction, the service worker
   precaches art as ordinary code-split JS chunks, and the rasteriser is a pure function testable
   in node without a canvas.
2. **The disc renderer is the floor.** `art.ts` per sport is untouched. `sprite-art.ts` is a
   sibling implementation selected at run time (T-13.11). Every task leaves the disc path green.
3. **Pattern is geometry.** Team kit patterns are authored mask layers, tinted at load; colour is
   never the only signal (`10` §11).
4. **Determinism discipline extends to rendering.** No `Math.random()`, no `Date.now()` in any
   render module (INV-2 lint covers `engine/` and `sports/`). Run cycles derive from distance
   travelled; ambient effects from labelled `fork()` seeds.
5. **Renderer state is render-side.** Animation accumulators (run distance, action pose timers)
   live in the sprite renderer, never in `SportState` or `World`. The sim must not know sprites
   exist.

### Layer usage (existing `LAYERS` in `renderer.ts`, unchanged)

| Layer | Sprites use it for |
|---|---|
| `field` | Restyled static field (T-13.5), crowd/stadium dressing baked in (T-13.8) |
| `shadows` | Feet shadows, ball shadow (altitude cue) |
| `entities` | Athlete sprites, **y-sorted** (T-13.6) |
| `ball` | Ball sprite (draws over bodies, as today) |
| `effects` | Net ripple, celebration particles, weather (T-13.8) |
| `hud` | Untouched |

---

## 2. Settled interfaces

These are fixed **before** any delegation (`CLAUDE.md` §7.3.1). A delegated task builds against
them; if one turns out wrong, the main session amends it here first, then re-delegates.

### 2.1 Pixel grids and atlases — `src/engine/render/atlas.ts` (T-13.2)

```ts
/** One authored frame: rows of palette indices. '.' = transparent, '0'–'9a'–'z' index the palette. */
export interface SpriteGrid {
  readonly w: number;            // frame width in px (32 for athletes)
  readonly h: number;            // frame height in px (48 for athletes)
  readonly ax: number;           // anchor x, px — where the feet touch the ground
  readonly ay: number;           // anchor y, px
  readonly rows: readonly string[]; // h strings of length w
}

/** A named animation: pose id → ordered frames. */
export type SpriteSheet = Readonly<Record<string, readonly SpriteGrid[]>>;

/** Facings: 8 compass directions. 0 = +x (east), counter-clockwise: 1=NE, 2=N … 7=SE. */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Facing from a velocity, with hysteresis so a jitters at a boundary doesn't flicker. */
export function facingOf(vx: number, vy: number, previous: Facing): Facing;

/** Only facings 0,1,2,6,7 (E, NE, N, SE, S… see §3.1) are authored; 3,4,5 mirror 1,0,7. */
export function authoredFacing(f: Facing): { facing: Facing; mirrored: boolean };

/** Pure rasteriser: grid + palette (index → #rrggbb or null) → RGBA bytes, row-major. Node-testable. */
export function rasterise(grid: SpriteGrid, palette: readonly (string | null)[]): Uint8ClampedArray;

/** A packed, GPU-friendly atlas: one off-screen canvas, frame lookup by key. */
export interface AtlasFrame { readonly x: number; readonly y: number; readonly w: number;
  readonly h: number; readonly ax: number; readonly ay: number; }
export interface SpriteAtlas {
  readonly image: CanvasImageSource;
  readonly frames: ReadonlyMap<string, AtlasFrame>;   // key: `${pose}/${authoredFacing}/${i}`
}

/** Rasterises every frame of every layer into one atlas. Called once per (sheet × palette). */
export function buildAtlas(
  sheets: Readonly<Record<string, SpriteSheet>>,      // layer name → sheet, e.g. { body, kit }
  palettes: Readonly<Record<string, readonly (string | null)[]>>,
  createOffscreen: OffscreenFactory,
): SpriteAtlas;
```

`OffscreenFactory` already exists in `renderer.ts`. Its `OffscreenLayer` gains
`putImageData`-capability: extend the `Canvas2D` slice with
`putImageData(data: ImageData, dx: number, dy: number): void`,
`createImageData(w: number, h: number): ImageData`, and the 9-argument
`drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)` overload. The recording double in
`tests/helpers/canvas.ts` grows the same members. **This slice change is main-session work inside
T-13.2** — it touches the seam every sport draws through.

### 2.2 Kit tinting — `src/engine/render/tint.ts` (T-13.3)

```ts
export type KitPattern = 'solid' | 'stripes' | 'hoops' | 'halves';   // 10 §3.1
export interface KitSpec {
  readonly fill: string;      // team colour
  readonly onFill: string;    // marking ink (existing TeamPalette vocabulary in art.ts)
  readonly pattern: KitPattern;
}
```

Tinting is palette substitution at rasterise time, not per-pixel work at draw time: the athlete
sheet's `kit` layer uses reserved palette indices (`K` = kit fill, `k` = kit ink, `P` = pattern
region), and `buildAtlas` is called once per (team kit × theme) with those indices bound to the
kit's colours — pattern regions get `onFill` under the pattern's geometry mask. The result is a
small set of fully-baked atlases per match (2 teams × 1 theme, rebuilt on theme change), and the
per-frame cost is a single `drawImage` per athlete.

### 2.3 Depth sort — `src/engine/render/depth.ts` + `Renderer` (T-13.6)

The `Renderer`'s `add(layer, command)` gains an optional `sortKey?: number`. At flush, commands in
the `entities` layer with a sort key are drawn in ascending key order (stable; keyless commands
keep insertion order, drawn first). Sprites pass `sortKey = worldY` of the feet anchor. That is
the whole of occlusion in a top-down world: nearer (larger y) draws later. **Engine change —
main-session only.**

### 2.4 The sprite renderer per sport — `src/sports/<sport>/sprite-art.ts` (T-13.3–13.5, 13.7)

Each sport ships a second `SportRenderer` implementation, exported as
`spriteRenderer(atlases: SportAtlases): SportRenderer`, chosen by the Live/Arcade screens according
to the graphics setting (T-13.11). Signatures on `SportRenderer` (`src/sports/types.ts`) do
**not** change — that is what keeps the disc floor selectable.

Render-side animation state lives in a closure per renderer instance:

```ts
interface AthleteAnim {
  facing: Facing;
  runDistance: number;          // accumulated world units — run cycle phase = distance / stride
  pose: string;                 // 'idle' | 'run' | action pose id
  poseT: number;                // 0–1 through the action pose, advanced by render dt
}
```

Pose selection (`poseFor`) reads the sport's own `SportState` — the same reason `drawAthletes`
takes it (see the T-6.16 note on the seam). Action poses are looked up from the sport's event/state
fields listed per sport in §5 below.

### 2.5 Graphics quality — `src/app/graphics.ts` (T-13.11)

```ts
export const GRAPHICS_MODES = ['auto', 'sprites', 'discs'] as const;
export type GraphicsMode = (typeof GRAPHICS_MODES)[number];
export const GRAPHICS_KEY = 'display.graphics';            // via prefs, like REDUCED_MOTION_KEY

/** The resolved answer: what should actually draw this session. */
export function graphicsTier(view: Window | null | undefined): 'sprites' | 'discs';
```

`auto` (the default) resolves via a device probe: `navigator.deviceMemory <= 2` or
`hardwareConcurrency <= 2` → discs, else sprites. Additionally the Live screen demotes to discs
**mid-match** if `PerfMonitor` reports p95 frame time over `FRAME_BUDGET_MS` for 3 consecutive
snapshots — the demotion sticks for the session, is announced via the existing toast mechanism,
and never persists over an explicit `sprites` choice. Probe pattern follows `app/motion.ts`
(graceful when APIs are missing — jsdom, older WebKit).

---

## 3. The art itself

### 3.1 Athlete sheet

- Frame size **32 × 48 px**, feet anchor at (16, 46). At the camera's `minAthletePixels` floor the
  sprite stays legible; at typical Live zoom athletes render 24–48 px tall.
- **5 authored facings** — E (0), NE (1), N (2), S (6), SE (7); W/NW/SW mirror E/NE/SE via
  `scale(-1, 1)` at draw time. Mirroring flips cross-body kit asymmetry; accepted (D-24).
- **Poses** (shared humanoid, all sports): `idle` (2 frames), `run` (6), `plant` (1),
  `reach-high` (2), `reach-low` (2), `kick` (3), `throw` (3), `tackle` (3), `fall` (2),
  `celebrate` (4), `dejected` (1). Sport pose mapping in §5.
- **Layers per frame:** `body` (skin/hair/shoe palette, shared), `kit` (reserved indices per
  §2.2). A sport may add a `prop` layer sheet (ball-in-hands, gloves, stick) with the same keys.
- Authored in `src/art/athlete/<pose>.ts` as `SpriteGrid[]` per facing. Grids are plain strings —
  reviewable in a diff, diffable frame by frame, and compress extremely well (D-24 arithmetic).

### 3.2 Ball, fields, dressing

- Ball: **8 × 8 px**, 4 spin frames per sport skin (`src/art/ball/<sport>.ts`). Height stays a
  *drawn* cue: scale the sprite up to 1.4× with altitude and separate the shadow (T-13.4), exactly
  as the disc ball does today — the physics already supplies height.
- Fields stay procedural vectors (they already draw into the cached static layer) but restyled:
  texture bands, mow stripes / parquet, and the crowd ring (T-13.5, T-13.8) drawn with the
  existing `Canvas2D` calls. No field bitmaps — the vector field costs nothing and scales to any
  zoom.

---

## 4. Tasks in detail

Sizes and dependencies from `03`. "Delegate" applies `CLAUDE.md` §7: the main session settles
seams, reviews every diff, runs the suite, owns the commit.

### T-13.2 — Asset pipeline (L) — **main session** (it is the seam everything builds on)

Owns: `src/engine/render/atlas.ts`, the `Canvas2D`/`OffscreenLayer` slice extension in
`renderer.ts`, `tests/helpers/canvas.ts` growth, `src/art/README.md` (authoring format, one
worked example grid).
Deliverables: everything in §2.1, plus a walking-skeleton: one hand-authored `idle` frame,
rasterised and drawn on the dev gallery (`#/dev/ui`) so every later task has a visible harness.
Tests: `rasterise` pixel-exact against tiny grids (pure node); `buildAtlas` packing and key lookup
against the recording double; property test — every grid row length equals `w`, every palette
index resolves.
Spec header: `@task T-13.2 @story US-1.3 @design 13-visual-overhaul.md §2.1, §3`.

### T-13.3 — Athlete rendering (XL) — **delegate art to sonnet, seam work main session**

Split: (a) main session writes `tint.ts` (§2.2) and the `sprite-art.ts` skeleton for basketball +
soccer (facing/anim state, LOD handling — `Detail.Minimal` keeps the disc dot); (b) **one sonnet
agent per art file** authors `src/art/athlete/*.ts` pose grids against `src/art/README.md`
(§7.3.3 — partition by file). Kit patterns authored as mask geometry: stripes/hoops/halves must
survive the three colour-vision simulations in the gallery preview (`10` §11).
Tests: tint substitution (kit indices → spec colours, pattern regions distinct from fill in
*luminance*, not only hue — assert contrast ratio ≥ 1.5:1); facing hysteresis; run-cycle phase from
distance (same input → same frame, INV-8); component test drawing 10 athletes through the
recording double asserting one `drawImage` per athlete at `Detail.Full`.
Spec header: `@task T-13.3 @story US-2.3, US-13.4 @design 13-visual-overhaul.md §2.2, §3.1`.

### T-13.4 — Ball rendering (M) — **sonnet**, after T-13.2
Owns: `src/art/ball/*.ts`, ball paths in both `sprite-art.ts` files.
Spin frame from ball velocity magnitude accumulated render-side (deterministic); shadow stays on
the `shadows` layer at ground position, sprite lifts and scales with height — the pair is the
altitude read. Tests mirror the disc ball's existing ones plus frame-selection determinism.
Spec header: `@task T-13.4 @story US-2.3 @design 13-visual-overhaul.md §3.2`.

### T-13.5 — Field restyle (L) — **sonnet**, after T-13.2
Owns: `court-render.ts` / `pitch-render.ts` sprite-mode variants (new functions in the same files,
selected by the sprite renderer's `drawField`; the disc `drawCourt`/`drawPitch` are untouched).
Mow stripes / parquet bands, richer line work, boundary apron. Must keep `fieldKey` honest —
style variant joins the cache key. Rink and gridiron land with Phase 11, but the style vocabulary
(band spacing, apron palette slots) is set here and recorded in this doc when done.
Tests: static-layer cache still hits (FrameStats.staticRedrawn stays 0 across unchanged frames);
snapshot via T-13.12.
Spec header: `@task T-13.5 @story US-2.3 @design 13-visual-overhaul.md §3.2`.

### T-13.6 — Depth sort (L) — **main session** (engine core)
§2.3. Owns `depth.ts` + the `Renderer.add` change + `sprite-art.ts` call sites passing `sortKey`.
Tests: stable-sort property test; overlap component test (two athletes at close y draw in y order
regardless of entity id order); disc path unaffected (no sortKey → insertion order, byte-identical
FrameStats).
Spec header: `@task T-13.6 @story US-2.5 @design 13-visual-overhaul.md §2.3`.

### T-13.7 — Action animation (XL) — **split like T-13.3**, after T-13.3
Main session: `poseFor` per sport — the mapping from `SportState` (charging meter, stoppage,
possession, last event) to pose ids, because reading sport state correctly is judgement work.
Sonnet: the action pose grids (kick/throw/tackle/fall/celebrate frames) — one agent per pose file.
Celebrations trigger from score events on the existing `EventBus` stream, render-side subscriber
only. `reducedMotion` collapses celebrate/dejected to a single frame.
Tests: pose mapping table-driven per sport (state fixture → pose id); pose timers advance by dt
and clamp; no pose ever selects a missing atlas key (property test over the full mapping range).
Spec header: `@task T-13.7 @story US-2.4 @design 13-visual-overhaul.md §2.4, §3.1`.

### T-13.8 — Atmosphere (L) — **sonnet**, after T-13.5
Crowd ring baked into the static field layer (zero per-frame cost) with labelled-fork seeded
variation; net ripple / rim shake on score events (effects layer, ≤300 ms, honours
`reducedMotion`); optional weather (rain streaks) behind a `graphicsTier() === 'sprites'` guard.
Zero sim cost means: no entity, no world write, no event emitted — render-side only.
Tests: crowd determinism (same seed → same pixels via rasterise), ripple lifecycle, reduced-motion
suppression.
Spec header: `@task T-13.8 @design 13-visual-overhaul.md §4 (T-13.8)`.

### T-13.9 — Performance (L) — **main session**, after T-13.6
Hold `12` §6 at 22 entities with sprites: extend the headless benchmark to run the sprite
renderer against the recording double (command counts, style-change counts), and the instrumented
Playwright run to compare disc vs sprite p95. Budget: sprite frame ≤ disc frame + 2 ms at p95 on
the CI runner; if it misses, the LOD tiers shed (Minimal = disc dot, already required by T-13.3).
Record numbers in `notes/phase-13.md`.
Spec header: `@task T-13.9 @story US-2.5 @design 12-quality-and-testing.md §6`.

### T-13.10 — Bundle budget (M) — **main session**, after T-13.2 (re-run at gate)
`pnpm budget` gains an art line: total size of `src/art/**` chunks, asserted ≤ 1.5 MB raw
(D-24's ceiling), and the existing 200 KB initial-JS assertion must show art chunks are **not** in
the initial graph (import them only behind the route-level dynamic imports). If grids blow the
ceiling, RLE-encode rows (`'a12.4a3'`) — the rasteriser is the only consumer; do not lower the
ceiling.
Spec header: `@task T-13.10 @story US-1.3 @design 13-visual-overhaul.md, D-24`.

### T-13.11 — Quality setting (M) — **main session**, after T-13.9
§2.5. Owns `src/app/graphics.ts`, a Settings row (pattern: the reduced-motion row in
`ui/screens/settings.ts`), renderer selection in the Live/Arcade screens, mid-match demotion.
Tests: probe matrix (memory/cores → tier), demotion trigger from three bad snapshots, explicit
choice never demoted, prefs round-trip through the `scope.ts` mechanism (INV-3).
Spec header: `@task T-13.11 @story US-2.5, US-13.4 @design 13-visual-overhaul.md §2.5`.

### T-13.12 — Visual regression (M) — **sonnet**, after T-13.7
One gallery page per renderer path (athlete poses × facings × both kits, ball spin, each field,
each effect frozen mid-animation) under `#/dev/ui`, then Playwright snapshots in `tests/visual/`
following the existing suite's conventions, both themes, plus the three colour-vision simulations
of the kit page (the Gate-13 identity check, `10` §11).
Spec header: `@task T-13.12 @design 13-visual-overhaul.md §4 (T-13.12)`.

---

## 5. Sport pose mappings (filled by T-13.7; the vocabulary is fixed now)

| Shared pose | Basketball | Soccer |
|---|---|---|
| `reach-high` | shot release, rebound, block | keeper high save, header |
| `reach-low` | steal reach | keeper low save, slide-block |
| `kick` | — | shot, pass, clearance |
| `throw` | pass, shot windup | throw-in, keeper distribution |
| `tackle` | charge/screen contact | slide tackle |
| `fall` | charge taken | fouled, keeper landing |
| `plant` | pivot, post-up | shielding |

Hockey and American football (Phase 11) extend this table when their sprite work lands; the shared
humanoid + `prop` layer design (§3.1) is what makes that an art task, not an engine task.

---

## 6. Suggested order and session sizing

Dependencies allow: 13.2 → {13.3, 13.4, 13.5, 13.10} → 13.6 → 13.7 → {13.8, 13.9} → 13.11 → 13.12
→ gate. A realistic split into sessions, each ending green and pushed:

1. **Session A (Opus):** T-13.2 whole, T-13.6 (both engine-seam tasks; ~same files).
2. **Session B (Opus orchestrating Sonnet art agents):** T-13.3, then T-13.4 + T-13.5 in parallel
   (disjoint files), T-13.10 assertions.
3. **Session C (Opus orchestrating):** T-13.7, T-13.8.
4. **Session D (Opus):** T-13.9, T-13.11, T-13.12, gate 13, tag v1.3.

Each session starts with `CLAUDE.md` §1 and this document's §for-its-tasks only.

---

## 7. Gate 13 checklist (from `03`, made concrete)

- [ ] Sprite renderer default on a mid-range phone at ≥55 fps, 22 entities (T-13.9 instrumented
      run + manual device matrix `12` §7).
- [ ] Disc renderer selectable in Settings and auto-selected by the probe floor (T-13.11).
- [ ] `pnpm budget` green including the new art line; no art in the initial chunk (T-13.10).
- [ ] Zero runtime network requests — audit the network panel over a full match (INV-4).
- [ ] Team identity survives protanopia / deuteranopia / tritanopia simulation of the kit gallery
      page (T-13.12 snapshots reviewed by a human).
- [ ] Full suite green, coverage floors hold, `docs/traceability.md` + `docs/api-index.md`
      regenerated, gate record appended to `PROGRESS.md`.
