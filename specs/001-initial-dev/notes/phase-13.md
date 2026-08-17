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
