# PROGRESS — Sport-Game · spec 001-initial-dev

**This file is the project's memory.** It records what is done, what is in flight, and exactly where
to resume. It is updated *in the same commit as the work it describes* — never as separate
bookkeeping.

Protocol: [`/CLAUDE.md`](../../CLAUDE.md) §3. Task definitions: [`03-phases-and-tasks.md`](./03-phases-and-tasks.md).

Statuses: `todo` · `in_progress` · `blocked` · `done` · `cut`

---

## In-flight

- **Task:** T-5.1 — `PlaybookAdapter` interface + turn engine
- **Status:** in_progress
- **Started:** 2026-07-28
- **Branch:** `claude/phase-5-playbook-tooling-sac3hy`
- **Done so far:**
  - [x] Phase-5 session tooling: `pnpm api`, `pnpm spec`, the `PROGRESS.md` notes split
  - [ ] T-5.1 — `PlaybookAdapter`, turn state, the seeded turn loop
  - [ ] T-5.2 … T-5.11
- **Next step:** T-5.1 — add `playbook?: PlaybookAdapter` to `SportModule` the same way `arcade?`
  was added, then the turn engine in `src/modes/playbook/`. Design is `09` §2 and §5
  (`pnpm spec 09 2`).
- **Blockers:** the device matrix and the deploy, unchanged since Gate 2 and now **three** gates
  deep. Nothing in Phase 4 changes the analysis in the Gate 3 record — the deploy is a user action
  and is the only route to a real device for this project.
- **Notes:** CI runs on `main` and `workflow_dispatch` only (user request, 2026-07-27) — verify
  branches locally with `pnpm verify`, `pnpm bench`, `pnpm e2e`, `pnpm balance`, and
  `pnpm build && pnpm budget`. Formatting and auto-fixable lint are handled by hooks
  (`CLAUDE.md` §11); never spend a turn on them. In this sandbox the E2E suite needs
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`. `src/athletes/**`, `src/storage/**`,
  `src/economy/**`, and `src/achievements/**` are held to 95% lines/functions/statements — write the
  tests with the code, not after.
  **Two Phase-4 debts a later phase must clear.** `src/modes/arcade/unlocks.ts` carries
  `ACHIEVEMENTS_LANDED = false`, which opens every arcade game until T-8.6 writes real unlocks —
  US-16.2 is built and tested but not yet *true* in the running app. And
  `applyMotionPreference` is called from the arcade run screen because nothing else sets
  `data-motion`; T-9.x should move it to bootstrap.
  **Phase-4 delegation: none.** `CLAUDE.md` §7.1 marks T-4.3 and T-4.5–4.9 as `sonnet` candidates,
  but this session's own instructions say not to spawn subagents unless asked. The five games would
  have delegated badly regardless: the attempts-inflation bug was only visible once all five could
  be measured against each other.
  **New in Phase 5:** `pnpm api` writes `docs/api-index.md` (every export, its signature, its
  summary) — grep that before opening a source file. `pnpm spec 09 5` prints one spec section.
  Task rows now carry a one-sentence note and a link into `notes/phase-N.md`; write the reasoning
  there, not here.


> **Resuming after an interruption:** read this block, `git log --oneline -20`, then continue from
> **Next step**. Everything needed should be here — if it isn't, the previous session didn't follow
> `CLAUDE.md` §3.1, and the fix is to reconstruct this block before writing any code.

---

## Summary

| Phase | Name | Tasks | Done | Status | Milestone |
|---|---|---|---|---|---|
| 0 | Foundation, PWA shell, update & offline lifecycle | 18 | 18 | `done` | — |
| 1 | Engine core | 13 | 13 | `done` | — |
| 2 | Basketball · Live | 13 | 13 | `in_progress` | v0.1 |
| 3 | Athletes, cross-sport ratings, roster | 17 | 17 | `done` | v0.2 |
| 4 | Arcade framework + basketball arcade set | 13 | 13 | `done` | v0.3 |
| 5 | Playbook (turn-based) + basketball Playbook | 11 | 0 | `todo` | v0.4 |
| 6 | Soccer · all three modes | 18 | 0 | `todo` | v0.5 |
| 7 | CPU AI depth & difficulty ladder | 11 | 0 | `todo` | — |
| 8 | Modes hub, progression, achievements, economy | 16 | 0 | `todo` | — |
| 9 | UI/UX, accessibility, performance, data safety | 15 | 0 | `todo` | **v1.0** |
| 10 | P2P (bonus) | 11 | 0 | `todo` | v1.0.x |
| 11 | Hockey & American Football | 14 | 0 | `todo` | v1.1 |
| | **Total** | **170** | **74** | | |

---

## Tasks

**Notes are one sentence.** The long-form rationale for a task — the decisions taken, the bugs
verification found, the things a future session would otherwise rediscover — lives in
[`notes/phase-N.md`](./notes/), linked from the row. Write the headline here and the reasoning
there; this file is read at every session start and the notes file only when you touch the code.

### Phase 0 — Foundation, PWA shell, update & offline lifecycle

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-0.1 | Scaffold Vite + TypeScript (strict), ESLint, Prettier, Vitest, Playwright, folder layout per `04` §4 | S | `done` |  | — | `auto` (build + lint + suite green) | pnpm 11. TS strict incl. `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`. [notes](./notes/phase-0.md#t-01) |
| T-0.2 | Derive `base` from repo name at build; lint rule + test banning literal paths (INV-4) | S | `done` |  | `tests/unit/tools/base-path.test.ts`, `tests/invariants/inv-04-no-literal-base-path.test.ts` | `auto` | `tools/base-path.ts` resolves `BASE_PATH` → `GITHUB_REPOSITORY` → fallback. [notes](./notes/phase-0.md#t-02) |
| T-0.3 | App shell: canvas host, hash router, safe-area layout, orientation handling | M | `done` |  | `tests/unit/app/{router,shell,orientation,canvas-host}.test.ts` | `auto` | Hash routing (`04` §2 — Pages has no rewrites). [notes](./notes/phase-0.md#t-03) |
| T-0.4 | Design tokens + primitive components + dev-only component gallery route | M | `done` |  | `tests/unit/ui/components.test.ts` | `auto` | Tokens from `10` §3.1–3.3, dark-first with a light theme and an OS-following default. [notes](./notes/phase-0.md#t-04) |
| T-0.5 | Web app manifest generated with base-path `id`/`scope`/`start_url`, full icon set incl. maskable | M | `done` |  | `tests/unit/tools/manifest.test.ts` | `auto` + icons eyeballed at 192 px, both variants | `id`/`scope`/`start_url` are all the base path, so the install is a distinct app from any sibling PWA on the account. [notes](./notes/phase-0.md#t-05) |
| T-0.6 | Service worker: per-class cache strategies (`11` §2), atomic precache install, versioned caches, activate cleanup | L | `done` |  | `tests/unit/pwa/strategies.test.ts`, `tests/unit/tools/precache.test.ts` | `auto` + headless Chromium: registers, precaches 20 entries, cold-loads a deep hash route with the server refusing connections | The `11` §2 table lives in pure functions in `strategies.ts` so every row is asserted without a SW environment. [notes](./notes/phase-0.md#t-06) |
| T-0.7 | `version.json` emission + all five update-detection triggers (`11` §3) | M | `done` |  | `tests/unit/pwa/{version,update-detector}.test.ts` | `auto` — each of the five triggers asserted separately | `version.json` is emitted at build and served `no-store` in dev and in the build. [notes](./notes/phase-0.md#t-07) |
| T-0.8 | Update application: waiting-worker banner, safe-point auto-update, single-reload guard, `minSupportedVersion` force | L | `done` |  | `tests/unit/pwa/update-application.test.ts` | `auto` | The whole of `11` §4 is one pure `decide()` function, so the policy is testable without a worker. [notes](./notes/phase-0.md#t-08) |
| T-0.9 | Offline integrity self-check and self-heal; offline-readiness UI; "download everything for offline" | L | `done` |  | `tests/unit/pwa/update-application.test.ts` (integrity block) | `auto` | Only the worker holds the precache manifest, so the page asks for it over `postMessage`. [notes](./notes/phase-0.md#t-09) |
| T-0.10 | Repair flow — caches and SW only, IndexedDB untouched (INV-13); "check for update now"; version display | M | `done` |  | `tests/invariants/inv-13-repair-preserves-data.test.ts` | `auto` | Settings → App & updates shows running version, build, build date, and last check, so "am I on the new one?" is always answerable. [notes](./notes/phase-0.md#t-010) |
| T-0.11 | `ScopedStorage`: namespaced IndexedDB, localStorage, and Cache Storage behind one module (INV-3) | M | `done` |  | `tests/unit/storage/{scope,prefs,caches}.test.ts`, `tests/integration/storage/idb.test.ts`, `tests/invariants/inv-03-namespaced-storage.test.ts` | `auto` | **Taken out of numeric order** — T-0.5/T-0.6 need the cache-name helpers. [notes](./notes/phase-0.md#t-011) |
| T-0.12 | Storage persistence request, quota/usage display, denial warning + backup prompt | S | `done` |  | `tests/unit/storage/persistence.test.ts` | `auto` | Asked on first write rather than at launch — browsers grant it more readily once engagement exists (`11` §7), and the nudger re-asks once per milestone. [notes](./notes/phase-0.md#t-012) |
| T-0.13 | Schema versioning + migration runner with pre-migration snapshot and rollback | M | `done` |  | `tests/integration/storage/migrations.test.ts` | `auto` — against real IndexedDB via fake-indexeddb | Forward-only chain per `05` §9. The snapshot covers every store, singletons included, and a failure rolls back the *whole* chain, not just the failing step — a partially-migrated database is worse than an unmigrated one. [notes](./notes/phase-0.md#t-013) |
| T-0.14 | Install UX: `beforeinstallprompt` capture, custom button, iOS-only A2HS instructions | M | `done` |  | `tests/unit/pwa/install.test.ts` | `auto` | The event fires once and only replays inside a user gesture, so it is captured and the mini-infobar suppressed. iOS Safari gets the manual A2HS steps — and Chrome-on-iOS deliberately does not, since it has no such menu item. [notes](./notes/phase-0.md#t-014) |
| T-0.15 | GitHub Actions: CI (typecheck, lint, unit, e2e, a11y, coverage, budgets) + tagged Pages deploy | M | `done` |  | `tools/budget.ts` (checked by `pnpm budget`) | `auto` — workflows not yet exercised on GitHub; first push to the branch will run CI | CI runs typecheck, lint, coverage, traceability, PROGRESS check, a committed-report diff, build, budgets, then E2E in a second job against a real static build under the deployed base path. [notes](./notes/phase-0.md#t-015) |
| T-0.16 | PWA lifecycle E2E suite: all sixteen scenarios in `11` §9 | L | `done` |  | `tests/e2e/{pwa-lifecycle,pwa-update-flow,a11y-and-smoke}.spec.ts` | `auto` — 28 E2E green in headless Chromium | All sixteen `11` §9 scenarios, driven by `tools/e2e-server.ts`, which can deploy a second build, 404 an asset, and refuse connections on demand. [notes](./notes/phase-0.md#t-016) |
| T-0.17 | Spec-header lint rule + traceability report generator (INV-15) | M | `done` |  | `tests/invariants/inv-15-spec-headers.test.ts`, `tests/unit/tools/spec-tooling.test.ts` | `auto` | Deliberately two checks: a plain-JS ESLint rule doing a presence check on the five mandatory fields with no filesystem access, so it runs on every keystroke; and the invariant test resolving every task and story ID against `03` and `02`, which is authoritative and runs in CI. [notes](./notes/phase-0.md#t-017) |
| T-0.18 | `PROGRESS.md` validation script: task IDs resolve, statuses valid, no orphans | S | `done` | | `tests/unit/tools/spec-tooling.test.ts` | `auto` — `pnpm progress:check` reports 156 todo / 14 done, no problems | Catches unresolvable IDs, invalid statuses, duplicated rows, orphaned tasks defined in `03` with no row, an In-flight task with no row, and more than one `in_progress` at a time (`CLAUDE.md` §2). |

### Phase 1 — Engine core

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-1.1 | Seeded PRNG + lint rule banning `Math.random` in `engine/`, `sports/` (INV-2) | S | `done` |  | `tests/unit/engine/rng.test.ts`, `tests/invariants/inv-02-no-math-random.test.ts` | `auto` | sfc32 seeded through splitmix32, all int32 ops so two engines produce byte-identical streams; a float generator could not promise that. [notes](./notes/phase-1.md#t-11) |
| T-1.2 | Fixed-timestep loop (60 Hz) with accumulator, render interpolation, pause/step/time-scale | M | `done` |  | `tests/unit/engine/loop.test.ts` | `auto` | Split in two: `Clock` holds the accumulator and *only* the timing policy, `createLoop` converts frame timestamps into deltas. [notes](./notes/phase-1.md#t-12) |
| T-1.3 | Entity model: struct-of-arrays state, spatial hash for neighbour queries | L | `done` |  | `tests/unit/engine/world.test.ts` | `auto` | SoA typed arrays: the hot loops touch one field across all entities, and typed arrays give the GC nothing to collect mid-match (`01` R2). [notes](./notes/phase-1.md#t-13) |
| T-1.4 | Movement & steering from attributes: accel, max speed, turn rate, seek/arrive/pursue/avoid | L | `done` |  | `tests/unit/engine/{movement,steering}.test.ts` | `auto` | The engine never sees attributes: `movementProfile()` takes *derived ratings* (1–99, the output of `05` §3) and returns metres and seconds, so the sport seam stays honest. [notes](./notes/phase-1.md#t-14) |
| T-1.5 | Collision & contact contests weighted by strength/agility | L | `done` |  | `tests/unit/engine/collision.test.ts` | `auto` | Two separate problems, kept separate: `resolveCollisions()` is deterministic geometry with no randomness at all, `contest()` is the seeded ratings decision sports build rebounds and tackles on. [notes](./notes/phase-1.md#t-15) |
| T-1.6 | Ball physics: position + height, gravity, bounce, spin/curve, possession attach/detach | L | `done` |  | `tests/unit/engine/ball.test.ts` | `auto` | The ball lives in the same `World` as the athletes (using `z`/`vz`), so neighbour queries find it for free, and it is flagged `INTANGIBLE` so contact resolution never shoves an athlete off their line as it rolls past. [notes](./notes/phase-1.md#t-16) |  | vz > 0`. Spin is yaw-only (one axis covers curving passes, crosses, and hooks); Magnus reads pre-update velocity so a pass cannot accelerate in flight. `launchVelocity()` solves the vertical component exactly rather than iterating, so the same pass request always produces the same pass. |
| T-1.7 | Canvas 2D renderer: layers, batching, LOD, off-screen static layers, debug overlay | L | `done` |  | `tests/unit/engine/renderer.test.ts` | `auto` | Everything works against `Canvas2D`, the subset of the real context actually used, so layer and LOD policy is unit-tested against a recording double instead of a real canvas — 29 tests, no jsdom. [notes](./notes/phase-1.md#t-17) |
| T-1.8 | Camera: ball follow, smoothing, dynamic zoom, bounds clamp, shake (reduced-motion aware) | M | `done` |  | `tests/unit/engine/camera.test.ts` | `auto` | Render-side only: it advances on frame time and nothing in `physics/` or a sport may read it — a camera that influenced the sim would make what you see change what happens. [notes](./notes/phase-1.md#t-18) |
| T-1.9 | Input layer: floating joystick, context buttons, handedness mirror, keyboard, gamepad | L | `done` |  | `tests/unit/engine/input.test.ts` | `auto` — 42 tests; **still needs a real phone** for thumb feel and the <100 ms US-2.1 latency check | Three devices reduce to one `InputFrame`, so nothing downstream can tell which produced it — that is what makes US-2.6 free rather than a second control path, and what makes T-1.12's recording a recording of the game rather than of a thumb. [notes](./notes/phase-1.md#t-19) |
| T-1.10 | Match state machine + `SportEvent` bus (the contract all three modes emit) | M | `done` |  | `tests/unit/engine/match.test.ts` | `auto` | INV-9 is enforced by *omission*: `SportEvent` has no `mode` field, so a consumer physically cannot branch on which mode produced an event — a shape decision rather than a code-review rule. [notes](./notes/phase-1.md#t-110) |
| T-1.11 | `SportModule` interface (`04` §5, `09` §5) + a trivial test sport proving the seam | M | `done` |  | `tests/unit/sports/seam.test.ts` | `auto` — 18 tests including a full two-half match played through the state machine | The seam is entirely *pull*-shaped: the engine calls the sport, never the reverse. [notes](./notes/phase-1.md#t-111) |
| T-1.12 | Input recording + golden-seed determinism tests in CI (INV-8) | M | `done` |  | `tests/sim/determinism.test.ts` | `auto` — 18 tests, including a recorded match replayed into identical per-step hashes | A match is `(seed, setup, inputs)` and nothing else, which buys replays, resume-from-a-triple, headless balance batches, and the P2P desync check from one mechanism. [notes](./notes/phase-1.md#t-112) |
| T-1.13 | Perf harness: fps/frame-time/entity overlay + CI budget check on a headless benchmark | M | `done` |  | `tests/unit/engine/perf.test.ts` | `auto` — benchmark run: 23 entities, sim step p95 **0.025 ms** against a 4 ms budget | Percentiles, not averages: a match that averages 60 fps and stutters twice a second is a bad match, and a mean hides exactly that — so p95 is what `12` §6 budgets and p95 is what this reports, alongside a jank ratio. [notes](./notes/phase-1.md#t-113) |

### Phase 2 — Basketball · Live

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-2.1 | Court geometry, zones, arc, key, hoop, boundaries | M | `done` |  | `tests/unit/sports/basketball/{court,court-render}.test.ts` | `auto` | FIBA dimensions in metres (28 × 15), origin at a corner, `goals[side]` is the basket that side *defends* — same convention as the seam. [notes](./notes/phase-2.md#t-21) |
| T-2.2 | Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts | L | `done` |  | `tests/unit/sports/basketball/rules.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | Clock compression is 4× — a three-real-minute quarter showing 12:00 (`06` §3.1) — and it is *derived* from the two quarter figures rather than authored, so the pair can never disagree. [notes](./notes/phase-2.md#t-22) |
| T-2.3 | Shooting: hold-release meter, arc trajectory, make probability from ratings × distance × pressure × release | L | `done` |  | `tests/unit/sports/basketball/shooting.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | The outcome is decided at release and the trajectory is then aimed to match — dead at the rim for a make, deliberately off it for a miss. [notes](./notes/phase-2.md#t-23) |
| T-2.4 | Passing: aimed, lead passes, interceptions, turnovers | M | `done` |  | `tests/unit/sports/basketball/passing.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | Unlike a shot, a pass is *flown* rather than resolved at release: whether it arrives depends on where five defenders happen to be while it is in the air, so interceptions fall out of proximity — which is also what makes jumping a lane something a player can do rather than a die the sim rolls for them. [notes](./notes/phase-2.md#t-24) |
| T-2.5 | Dribbling & driving: handling control, contact absorption, blow-by | L | `done` |  | `tests/unit/sports/basketball/dribbling.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | All three costs are per-*step* draws, because a drive is two seconds of sustained pressure rather than an event — the model has to be able to say "he lost it halfway in". [notes](./notes/phase-2.md#t-25) |
| T-2.6 | Rebounding: height/vertical/strength/box-out/timing contest | M | `done` |  | `tests/unit/sports/basketball/rebounding.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | A weighted draw, not a highest-score contest: taking the best score would mean the same five athletes rebound in the same order every time and a possession would be readable from the box score before the shot went up. [notes](./notes/phase-2.md#t-26) |
| T-2.7 | Defence: marking, contest, steal, block, foul model, free throws | L | `done` |  | `tests/unit/sports/basketball/defence.test.ts`, `tests/unit/sports/basketball/rules.test.ts` (fouls, free throws), `tests/integration/sports/basketball-match.test.ts` | `auto` | Every defensive action carries a foul risk, and that is the design: a steal that could only succeed or fail would be free to spam, one that can also concede two shots is a decision. [notes](./notes/phase-2.md#t-27) |
| T-2.8 | Baseline CPU: role-based offence (spacing, cuts, screens), man defence, possession decisions | XL | `done` |  | `tests/unit/sports/basketball/cpu.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | Decisions are **expected points**, not thresholds. [notes](./notes/phase-2.md#t-28) |
| T-2.9 | Control switching: auto on turnover, manual cycle, controlled-athlete indicator | M | `done` |  | `tests/unit/sports/basketball/control.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | Hysteresis is the whole feature: without a margin, two athletes a hand's breadth apart trade control every few frames and the player's thumb is attached to nobody. [notes](./notes/phase-2.md#t-29) |
| T-2.10 | Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators | M | `done` |  | `tests/unit/modes/live/{box-score,hud}.test.ts`, `tests/integration/modes/live-match.test.ts`, `tests/e2e/live-match.spec.ts` | `auto` + a real browser (Playwright: the canvas paints, the frame changes between samples, the loop advances) | Built the Live mode host first, because there wasn't one — `03` never gave it a task, it is implied by this one. [notes](./notes/phase-2.md#t-210) |
| T-2.11 | Pause menu, quit, in-match settings, post-match summary with box score | M | `done` |  | `tests/unit/modes/live/screen.test.ts`, `tests/e2e/live-match.spec.ts` | `auto` + a real browser (pause opens on Escape, resume closes it, quit leaves and stops the loop, and axe finds no WCAG A/AA violations on the paused screen) | Lives in the same file as the HUD wiring, because the pause menu, the summary, and the HUD are three views of one running match and what they share is its lifecycle — when to stop the loop, when to release held input. [notes](./notes/phase-2.md#t-211) |
| T-2.12 | Basketball art & audio pass | L | `done` |  | `tests/unit/sports/basketball/{art,court-render}.test.ts`, `tests/unit/modes/live/audio.test.ts`, `tests/e2e/live-match.spec.ts` | `auto` + a real browser (the canvas paints and the frame changes between samples) | **Delegated to `sonnet`** — see the delegation log. [notes](./notes/phase-2.md#t-212) |
| T-2.13 | Balance pass #1: shooting percentages and pace plausible over 500 headless games | M | `done` |  | `tools/balance.ts` (`pnpm balance`), plus the retuned unit tests | `auto` — 500 matches, all 14 bands inside plausible basketball | A **tool, not a test**: five hundred matches is six minutes of CPU, and a suite that takes minutes is a suite people stop running. [notes](./notes/phase-2.md#t-213) |

### Phase 3 — Athletes, cross-sport ratings, roster

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-3.1 | Athlete schema, IndexedDB store, indexes, repository | M | `done` |  | `tests/unit/athletes/types.test.ts`, `tests/integration/storage/athletes.test.ts` | `auto` — repository exercised against real IndexedDB | Schema written against `05` §2 field for field; bounds live beside it, the creation *budget* does not (that is T-3.2's, in `tuning.ts`). [notes](./notes/phase-3.md#t-31) |
| T-3.2 | Attribute system: the eleven attributes, budget rules, sandbox flag, random roll | M | `done` |  | `tests/unit/athletes/attributes.test.ts`, `tests/unit/athletes/create.test.ts` | `auto` — roll checked as a property across all five rarities | `tuning.ts` holds every `05` number so a balance pass never touches logic. [notes](./notes/phase-3.md#t-32) |
| T-3.3 | Derivation engine: weight matrix, physical modifiers, unit-tested invariants | L | `done` |  | `tests/unit/athletes/derivation.test.ts` | `auto` — hand-checked against `05` §3.1 plus properties over 500 random cases | No `if (sport === …)` anywhere: every sport-specific number arrives as a table from the sport module, so a new sport is a new table rather than an edit. [notes](./notes/phase-3.md#t-33) |
| T-3.4 | Familiarity model: per-sport familiarity, penalty curve, growth from minutes | L | `done` |  | `tests/unit/athletes/familiarity.test.ts` | `auto` — `05` §3.3's stated pace asserted, not assumed | The penalty curve was already in `derivation.ts` (`familiarityMultiplier`); T-3.4 is the growth half. [notes](./notes/phase-3.md#t-34) |
| T-3.5 | Sport skill XP: levels, sub-skills, event-driven awards, diminishing returns | L | `done` |  | `tests/unit/athletes/xp.test.ts`, `tests/unit/athletes/progression.test.ts` | `auto` | The sport owns the event→sub-skill table (`xpAwards` on the seam) — only basketball knows a shot from `cornerThree` is a three, and the athlete layer must never learn it. [notes](./notes/phase-3.md#t-35) |
| T-3.6 | Behavioural coupling: familiarity → decision noise, control error, reaction penalty in-sim | M | `done` |  | `tests/unit/athletes/coupling.test.ts`, `tests/integration/sports/basketball-coupling.test.ts` | `auto` + `pnpm balance` (500 games, 14 bands) | `05` §3.3's claim is behavioural, so it is tested behaviourally: four seeded matches with one side made novice and the other at home, **identical ratings on both**, asserting more turnovers, fewer completed passes, and fewer points. [notes](./notes/phase-3.md#t-36) |
| T-3.7 | Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale | L | `done` |  | `tests/unit/ui/athlete-editor.test.ts`, `tests/unit/athletes/{portrait,presets}.test.ts` | `auto` — diff reviewed against the spec, not against the agent's summary | **Delegated to `sonnet`** (CLAUDE.md §7.1); the agent owned an explicit file list, was told not to commit, and this session reviewed and committed. [notes](./notes/phase-3.md#t-37) |
| T-3.8 | Athlete card component: compact + full, sport switcher, familiarity ring, "why this rating" | L | `done` |  | `tests/unit/ui/athlete-card.test.ts`, `tests/unit/ui/athlete-screen.test.ts`, `tests/unit/athletes/explain.test.ts` | `auto` — asserted on what the card *says*, not how it is laid out | The card computes no rating: it is handed derivation's output and the explanation beside it, so what a player reads and what the sim uses cannot drift. [notes](./notes/phase-3.md#t-38) |
| T-3.9 | Cross-sport compare view with projections for unplayed sports | M | `done` |  | `tests/unit/ui/athlete-compare.test.ts` | `auto` | Each row shows **two** numbers — what the athlete rates today and what they would rate once they knew the sport — because showing only one would either flatter every athlete or bury the feature. [notes](./notes/phase-3.md#t-39) |
| T-3.10 | Roster browser: search, sort, filter, bulk select | M | `done` |  | `tests/unit/athletes/roster-query.test.ts`, `tests/unit/ui/roster.test.ts`, `tests/invariants/layering.test.ts` | `auto` — diff reviewed against the spec, not the agent's summary | **Delegated to `sonnet`.** Query logic is pure and DOM-free, so every sort, filter, and fallback edge case is testable without a screen. [notes](./notes/phase-3.md#t-310) |
| T-3.11 | Teams: create/edit, name, colours, generic crests | M | `done` |  | `tests/integration/storage/teams.test.ts`, `tests/unit/ui/{crest,teams}.test.ts` | `auto` — diff reviewed against the spec, not the agent's summary | Data model built here first and pushed before delegating (CLAUDE.md §7.3 rule 1); screens delegated to `sonnet`. [notes](./notes/phase-3.md#t-311) |
| T-3.12 | Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best | L | `done` |  | `tests/unit/teams/lineup.test.ts`, `tests/unit/ui/lineup.test.ts` | `auto` | **Auto-fill is an assignment problem and the naive answer is biased.** Walking the slots in order and giving each its best remaining athlete makes the *first* position outrank every other — the same shape as tie-breaking in entity-id order. [notes](./notes/phase-3.md#t-312) |
| T-3.13 | Stamina, injury, suspension, availability | M | `done` |  | `tests/unit/athletes/condition.test.ts` | `auto` | US-6.3's "low stamina degrades performance visibly" is the phrase that shaped this: fatigue produces a multiplier the sim applies at the point of use, in the same shape as T-3.6's coupling, and — like that one — it is **exactly 1.0 above the threshold**, so a fresh athlete costs the sim nothing and the PRNG stream is untouched for anyone who is not actually tired. [notes](./notes/phase-3.md#t-313) |
| T-3.14 | Starter roster: generated fictional athletes, enough for both sports | M | `done` |  | `tests/unit/athletes/starter-roster.test.ts`, `tests/integration/storage/app-db.test.ts` | `auto` — name pools spot-checked by hand for real athletes | **Delegated to `haiku`** (bulk content against a fixed schema, CLAUDE.md §7.1). [notes](./notes/phase-3.md#t-314) |
| T-3.15 | Roster import: file + URL, schema validation, per-record errors, merge/conflict, responsibility notice | L | `done` |  | `tests/unit/athletes/roster-import.test.ts`, `tests/unit/ui/roster-import.test.ts` | `auto` — diff reviewed against `05` §8 | **Delegated to `sonnet`.** `05` §8 followed exactly: unknown fields dropped, out-of-range values clamped **with a per-record warning**, and a bad record never aborting the file — that last one is the whole point of the section and is tested explicitly. [notes](./notes/phase-3.md#t-315) |
| T-3.16 | Roster and full-backup export/import with version checks and change preview | M | `done` |  | `tests/integration/storage/backup.test.ts`, `tests/unit/ui/backup.test.ts` | `auto` | **The preview is the dry run of the restore, not a second implementation** — `restoreBackup` calls `previewBackup` and returns it, and a test asserts the two agree. [notes](./notes/phase-3.md#t-316) |
| T-3.17 | Wire real athletes into basketball Live — lineups drive the sim | M | `done` |  | `tests/integration/sports/basketball-rosters.test.ts` | `auto` + `pnpm balance` (500 games, 14 bands) | **Phase 2's biggest loose end, closed.** `rollRatings()` is no longer the main path: a match given a lineup reads real derived ratings, real movement from `courtSpeed`, real familiarity coupling, and real fatigue. [notes](./notes/phase-3.md#t-317) |

### Phase 4 — Arcade framework + basketball arcade set

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-4.1 | Arcade framework: `ArcadeGameDef`, host, session lifecycle, scoring, star ratings | L | `done` |  | `tests/unit/modes/arcade/{session,scoring,registry}.test.ts` | `auto` | **The split that decides everything downstream: a game owns a *mechanic*, the framework owns the run.** Lives, clock, score, streaks, stars, and event collection live in `ArcadeRun` once, because five games owning them five times is five places for the rules of a scored run to drift — and `09` §3.3 describes one structure for every game. [notes](./notes/phase-4.md#t-41) |
| T-4.2 | Calibration: ratings + familiarity → window sizes and speeds (INV-10) | M | `done` | | `tests/unit/modes/arcade/calibration.test.ts`, `tests/invariants/inv-10-arcade-calibration.test.ts` | `auto` | **INV-10 is a signature, not a convention.** `calibrate(athlete, difficulty)` has no parameter through which a personal best could arrive, and the invariant test asserts that three ways: behaviourally (identical inputs, identical window, forever), structurally (the module imports nothing matching `storage|bests|history|session`), and textually (no `calibrate()` anywhere in `src/` takes a third argument). Six interpolated pairs turn a rating into `09` §2.4's two poles — "wide, slow, forgiving" against "narrow, fast, drifting" — and a game may reshape them without changing their direction. **Difficulty enters exactly once, at the end, on the window and the reaction allowance only** (INV-1); the rating that goes in is the rating the athlete card shows, on every level. `src/modes/difficulty.ts` is new: `06` §7's table read straight across, with no field a rating could be multiplied by, so INV-1 holds by the shape of the record before a test looks at it. T-7.7 owns the full model and will extend it. The picker's hint names *both* halves — "Narrow window — new to this sport." — because narrow without the reason reads as a punishment rather than as the thing practice fixes. |
| T-4.3 | Arcade hub: grid, locked/unlocked states, personal bests, athlete picker with window hint | M | `done` |  | `tests/unit/ui/{arcade,arcade-game}.test.ts`, `tests/unit/modes/arcade/unlocks.test.ts` | `auto` — asserted on what the hub *says*, not how it is laid out | **The window hint is the feature, not decoration.** US-16.3 asks the picker to state plainly whether this athlete's window is wide or narrow, and this is the only place the fairness rule is visible *before* you play — so it is on every tile, in words, recomputed when the athlete changes. [notes](./notes/phase-4.md#t-43) |
| T-4.4 | Practice / scored / daily modes; seeded daily challenge | M | `done` |  | `tests/unit/modes/arcade/{modes,daily}.test.ts`, `tests/integration/storage/arcade-records.test.ts` | `auto` — codes round-tripped, day boundary asserted in UTC | **Modifiers are applied outside `calibrate()`, deliberately.** A modifier is a fact about today's scenario — the same for everyone — while a calibration is a fact about the athlete; folding them together would widen INV-10's signature to admit something that is not the athlete, and the next thing through that door is a personal best. [notes](./notes/phase-4.md#t-44) |
| T-4.5 | Free Throw — release timing under mounting pressure | M | `done` |  | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts`, `tests/unit/modes/arcade/meter.test.ts`, `tests/sim/arcade-calibration.test.ts` | `auto` — score profiles measured across four athlete tiers with a human-like driver | **The pressure ramp speeds the meter and narrows nothing.** The band stays exactly as wide as the athlete earned, *in seconds*; the marker crossing it faster is what turns a comfortable window into a nervy one. [notes](./notes/phase-4.md#t-45) |
| T-4.6 | Three-Point Contest — five racks, rhythm and timing, 60 s | M | `done` |  | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts`, `tests/sim/arcade-calibration.test.ts` | `auto` — score profiles measured across four athlete tiers with a human-like driver | Rhythm is the second skill, and it keys on the *variance* between releases rather than on how short they are — so a steady slow tempo pays and mashing does not. [notes](./notes/phase-4.md#t-46) |
| T-4.7 | Buzzer Beater — contested shot, shrinking window | M | `done` |  | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts`, `tests/sim/arcade-calibration.test.ts` | `auto` — score profiles measured across four athlete tiers with a human-like driver | The window shrinks **within** a possession and never between them: every possession opens at the full width the athlete earned and closes as the defender's hand rises. [notes](./notes/phase-4.md#t-47) |
| T-4.8 | Fast Break — finish past a recovering defender | M | `done` |  | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts`, `tests/sim/arcade-calibration.test.ts` | `auto` — score profiles measured across four athlete tiers with a human-like driver | The one game where the meter reads as a *place* rather than a moment: the marker is the athlete running at the rim, the band is where the layup is on, and the recovering defender shuts its late edge. [notes](./notes/phase-4.md#t-48) |
| T-4.9 | Pickpocket — reaction test, jump the lane without fouling | M | `done` |  | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts`, `tests/sim/arcade-calibration.test.ts` | `auto` — score profiles measured across four athlete tiers with a human-like driver | The only game in the set that is not a release meter, and the one that forced an honest test harness. [notes](./notes/phase-4.md#t-49) |
| T-4.10 | Arcade → progression: XP, familiarity, `SportEvent` emission at reduced rate | M | `done` |  | `tests/unit/modes/arcade/progression.test.ts` | `auto` | **The reduced rate is a number, not a branch.** `applyMatch` already took a `rate` scalar for exactly this (T-3.5's note), so arcade pays less without progression ever learning arcade exists (INV-6); there is a test asserting no `if` in `progression.ts` mentions it. [notes](./notes/phase-4.md#t-410) |
| T-4.11 | Arcade hot-seat: party rounds, seeded fairness, ranking, elimination formats | M | `done` |  | `tests/unit/modes/arcade/party.test.ts`, `tests/unit/modes/local-players.test.ts`, `tests/unit/ui/{arcade,arcade-game}.test.ts` | `auto` | **Seeded fairness has two halves and the second is the one that is easy to miss.** Everyone in a round plays the same seed — that is `09` §4 read literally — *and* everyone plays the same athlete. [notes](./notes/phase-4.md#t-411) |
| T-4.12 | Arcade accessibility: left-hand mirroring, colour-independent meters, reduced motion | M | `done` |  | `tests/unit/modes/arcade/accessibility.test.ts`, `tests/unit/ui/arcade-game.test.ts` | `auto` — asserted on what is drawn, not on the intention | **A test asked what mirroring actually changed and the answer was nothing.** The release meter was drawn centred, so `mirrorX` was a no-op for four of the five games and a left-handed player got an identical layout. [notes](./notes/phase-4.md#t-412) |
| T-4.13 | Arcade balance: daily reward caps, anti-farm verification (INV-12) | M | `done` |  | `tests/unit/modes/arcade/rewards.test.ts`, `tests/invariants/inv-12-reward-parity.test.ts` | `auto` | **Two rules, because either alone fails.** A decay alone still pays forever if you rotate between five games; a cap alone makes the first twenty runs of one game identically worth playing, which is the grind `09` §3.3 rules out. [notes](./notes/phase-4.md#t-413) |

### Phase 5 — Playbook (turn-based) + basketball Playbook

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-5.1 | `PlaybookAdapter` interface + turn engine: turn loop, state, seeded resolution | L | `todo` | | | | |
| T-5.2 | Resolution model: ratings → matchup → outcome distribution → sampled `SportEvent` stream | XL | `todo` | | | | |
| T-5.3 | Narration + animated court-diagram renderer for turn outcomes | L | `todo` | | | | |
| T-5.4 | Basketball play catalogue (offence + defence calls) and call-selection UI | L | `todo` | | | | |
| T-5.5 | Key-moment detection → arcade invocation → result fed back into resolution | L | `todo` | | | | |
| T-5.6 | Expectation comparison ("the sim would have made it") + post-match reporting | M | `todo` | | | | |
| T-5.7 | Auto-call assistant coach, fast-forward, turn-speed control | M | `todo` | | | | |
| T-5.8 | Playbook CPU: call selection, weakness exploitation, per-difficulty competence | L | `todo` | | | | |
| T-5.9 | Playbook hot-seat: pass-the-device screens, hidden calls, local player names | M | `todo` | | | | |
| T-5.10 | Playbook flow UI: setup, turn screen, key-moment transition, results | L | `todo` | | | | |
| T-5.11 | Cross-mode parity tests (INV-11) and reward parity (INV-12) | M | `todo` | | | | |

### Phase 6 — Soccer · all three modes

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-6.1 | Pitch geometry, zones, goals, boundary lines | M | `todo` | | | | |
| T-6.2 | Soccer Live rules: halves, clock, stoppage, throw-ins, corners, goal kicks | L | `todo` | | | | |
| T-6.3 | Offside detection and enforcement | M | `todo` | | | | |
| T-6.4 | Fouls, advantage, cards, free kicks, penalties | L | `todo` | | | | |
| T-6.5 | Passing suite: short, through-ball, lofted, cross, with weight and rating-driven error | L | `todo` | | | | |
| T-6.6 | Shooting: power meter, placement, curve, deflections | M | `todo` | | | | |
| T-6.7 | Dribbling, sprint, shielding, stamina drain | M | `todo` | | | | |
| T-6.8 | Defending: pressure, standing and slide tackles, foul/card risk | M | `todo` | | | | |
| T-6.9 | Goalkeeper AI: positioning, shot-stopping, claims, distribution; manual on penalties | L | `todo` | | | | |
| T-6.10 | Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase | L | `todo` | | | | |
| T-6.11 | 22-entity performance work: LOD, culling, spatial-hash tuning, zero-allocation hot path | L | `todo` | | | | |
| T-6.12 | Camera and minimap tuning for the larger pitch | M | `todo` | | | | |
| T-6.13 | Soccer derivation weights, sub-skills, familiarity tuning | M | `todo` | | | | |
| T-6.14 | Soccer Playbook: phase turns, intent controls (tempo/width/risk/press/focus), resolution | XL | `todo` | | | | |
| T-6.15 | Soccer arcade set: Penalty Shootout, Free Kick, One-on-One, Header, Last Line | XL | `todo` | | | | |
| T-6.16 | Soccer art & audio pass | L | `todo` | | | | |
| T-6.17 | Engine-core refactor: extract anything basketball-shaped that leaked into core | M | `todo` | | | | |
| T-6.18 | Balance pass #2: goals, possession, conversion across Live and Playbook | M | `todo` | | | | |

### Phase 7 — CPU AI depth & difficulty ladder

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-7.1 | Utility-scoring decision framework shared across sports and modes | L | `todo` | | | | |
| T-7.2 | Role system: per-sport role tables driving off-ball movement and responsibility | L | `todo` | | | | |
| T-7.3 | Team coordination: formation shape, phase of play, pressing triggers, help defence, transition | XL | `todo` | | | | |
| T-7.4 | Basketball Live AI depth: pick-and-roll, cuts, zone vs man, rating-driven shot selection | L | `todo` | | | | |
| T-7.5 | Soccer Live AI depth: build-up phases, press lines, offside trap, counter-attacks | L | `todo` | | | | |
| T-7.6 | Playbook AI depth for both sports: tendency modelling, counter-calling | L | `todo` | | | | |
| T-7.7 | Difficulty model across all three modes — latency, noise, error, aggression, assists, arcade windows (INV-1) | M | `todo` | | | | |
| T-7.8 | Assist system: aim, pass, auto-switch, timing forgiveness; independent of difficulty; no-assist bonus | M | `todo` | | | | |
| T-7.9 | CPU team generation: coherent opponents and identities scaled to difficulty | M | `todo` | | | | |
| T-7.10 | AI regression harness: headless batches per difficulty per mode, asserted win-rate bands | M | `todo` | | | | |
| T-7.11 | Balance pass #3: tune all four levels against the target win-rate curve | L | `todo` | | | | |

### Phase 8 — Modes hub, progression, achievements, economy

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-8.1 | Home screen, mode selector, Quick Play (two taps from cold launch) | M | `todo` | | | | |
| T-8.2 | Match setup screens for Live and Playbook: sport, teams, difficulty, length, rules toggles | M | `todo` | | | | |
| T-8.3 | Tournament mode: 4/8/16 bracket, persistence, results, rewards; playable in Live or Playbook | L | `todo` | | | | |
| T-8.4 | Match checkpointing and resume-after-kill, all three modes | M | `todo` | | | | |
| T-8.5 | Stats store: match history, box scores, career stats per sport per mode | M | `todo` | | | | |
| T-8.6 | Achievement engine: declarative defs, event-stream evaluation, progress, once-only grants (INV-7) | L | `todo` | | | | |
| T-8.7 | Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode, hidden | L | `todo` | | | | |
| T-8.8 | Arcade unlock wiring: achievements gate arcade games, with a clear unlock moment | M | `todo` | | | | |
| T-8.9 | Achievement UI: gallery, filters, progress bars, in-match toast, post-match summary | M | `todo` | | | | |
| T-8.10 | Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match payout | M | `todo` | | | | |
| T-8.11 | Procedural athlete generator: rarity-coherent attribute spreads, fictional names | L | `todo` | | | | |
| T-8.12 | Packs: tiers, prices, published odds, pity timers, reveal animation with skip | L | `todo` | | | | |
| T-8.13 | Sell-back: valuation, squad-lock guard, confirmation, anti-farm invariants (INV-5, INV-6) | M | `todo` | | | | |
| T-8.14 | Transfer market: rotating listings, tamper-resistant refresh, paid refreshes, buy-offers, seeded price walk | XL | `todo` | | | | |
| T-8.15 | Local player names and party flows for hot-seat across Playbook and Arcade | M | `todo` | | | | |
| T-8.16 | Economy balance pass: pack EV vs sell value vs earn rate, simulated over 200 matches | M | `todo` | | | | |

### Phase 9 — UI/UX, accessibility, performance, data safety

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-9.1 | Design system completion: tokens, all components, full state matrices, dev gallery | L | `todo` | | | | |
| T-9.2 | Screen-by-screen UX pass against the `10` §12 checklist | XL | `todo` | | | | |
| T-9.3 | Onboarding: first launch → sport → mode → played match in under 60 seconds | L | `todo` | | | | |
| T-9.4 | Interactive tutorials per sport per mode, replayable from Settings | L | `todo` | | | | |
| T-9.5 | Settings: controls & assists, display & accessibility, audio & haptics, data & backup, app & updates, about | M | `todo` | | | | |
| T-9.6 | Accessibility pass: contrast, colourblind previews and non-colour differentiation, focus order, screen-reader labels, axe automation | L | `todo` | | | | |
| T-9.7 | The forgotten states (`10` §10): each designed, built, and tested | L | `todo` | | | | |
| T-9.8 | Motion, haptics, audio, and juice pass with full reduced-motion paths | L | `todo` | | | | |
| T-9.9 | Visual regression suite: every screen, both themes, both orientations, 1.0× and 1.3× | M | `todo` | | | | |
| T-9.10 | Performance hardening: per-sport and per-mode code splitting, asset compression, GC elimination | L | `todo` | | | | |
| T-9.11 | Data safety finishing: erase-all with typed confirm, backup nudges, cross-version migration tests | M | `todo` | | | | |
| T-9.12 | Error handling: global boundary, crash-safe state dump, non-technical recovery UI | M | `todo` | | | | |
| T-9.13 | Cross-device test matrix (`12` §7) run in full; fix fallout | L | `todo` | | | | |
| T-9.14 | Docs: README, roster-file schema, controls, known limitations, licence | M | `todo` | | | | |
| T-9.15 | v1.0 release: tag, deploy, verify install-from-scratch on real devices | S | `todo` | | | | |

### Phase 10 — P2P (bonus)

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-10.1 | Async challenge codes: seed + scenario + result encoding, share link, comparison screen | L | `todo` | | | | |
| T-10.2 | WebRTC session layer: offer/answer, ICE gathering completion, data channel | L | `todo` | | | | |
| T-10.3 | Signal payload codec: SDP trimming, compression, base64url, QR size budget | M | `todo` | | | | |
| T-10.4 | On-device QR generation and camera scanning, with copy/paste fallback | L | `todo` | | | | |
| T-10.5 | Connection UI: host/join, state reporting, plain-language failure guidance, STUN settings | M | `todo` | | | | |
| T-10.6 | Playbook P2P: turn-exchange protocol, reconnection, clean abandon | L | `todo` | | | | |
| T-10.7 | Live lockstep: input delay buffer, shared seed, tick sync, stall handling | XL | `todo` | | | | |
| T-10.8 | Desync detection via periodic state hashing; honest failure; clean teardown | M | `todo` | | | | |
| T-10.9 | Custody ledger: per-install keypair, signed receipts, provenance chain, duplicate refusal | L | `todo` | | | | |
| T-10.10 | Trade UI: proposal, card review, dual confirmation, atomic apply, honest trust notice | L | `todo` | | | | |
| T-10.11 | Two-device test protocol: same LAN, cross-network, STUN off, backgrounding, NAT-failure fallback | M | `todo` | | | | |

### Phase 11 — Hockey & American Football

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-11.1 | Hockey: rink geometry, puck physics, skating movement model | L | `todo` | | | | |
| T-11.2 | Hockey Live rules: periods, faceoffs, offside, icing, penalties, power plays | L | `todo` | | | | |
| T-11.3 | Hockey actions: passing, one-timers, shooting, deflections, checking, goaltending | XL | `todo` | | | | |
| T-11.4 | Hockey Playbook adapter: shift and zone turns | L | `todo` | | | | |
| T-11.5 | Hockey arcade set: Shootout, Slapshot Accuracy, Faceoff | L | `todo` | | | | |
| T-11.6 | Football: field geometry, downs and distance, clock rules incl. two-minute | L | `todo` | | | | |
| T-11.7 | Football play-call layer: offensive and defensive playbooks, pre-snap adjustments | XL | `todo` | | | | |
| T-11.8 | Football actions: snap, QB throw with targeting, running, blocking, tackling, kicking | XL | `todo` | | | | |
| T-11.9 | Football Playbook adapter — the sport's natural turn structure | M | `todo` | | | | |
| T-11.10 | Football arcade set: Field Goal, Throw Window, Two-Minute Drill | L | `todo` | | | | |
| T-11.11 | Derivation weights, sub-skills, familiarity tuning for both sports | M | `todo` | | | | |
| T-11.12 | Achievements and economy content for both sports | M | `todo` | | | | |
| T-11.13 | Art and audio for both sports | XL | `todo` | | | | |
| T-11.14 | Extensibility audit: confirm no engine-core, storage, or economy change was required (INV-9) | S | `todo` | | | | |

---

## Gate records

One row per gate: the result and what it turned on. The full evaluation — every check from
`CLAUDE.md` §5, the evidence tables, the device matrix, and the per-task feel notes — goes under
`## Gate record` in that phase's notes file. A new gate adds a row here and that section there.

| Gate | Date | Result | Turned on | Full record |
|---|---|---|---|---|
| 0 — Foundation & PWA lifecycle | 2026-07-27 | **PASS**, two items deferred | All sixteen `11` §9 scenarios green in a real browser; four real bugs found and fixed in verification. Device matrix and Pages deploy deferred — no phone, no publish rights. | [phase 0 notes](./notes/phase-0.md#gate-record) |
| 1 — Engine core | 2026-07-27 | **PASS**, one criterion deferred | Determinism asserted step-for-step, not just at the end. "≥55 fps in a running match" deferred to Phase 2, which is the first thing that mounts a match. Gate 0's coverage debt paid down here. | [phase 1 notes](./notes/phase-1.md#gate-record) |
| 2 — Basketball · Live (v0.1) | 2026-07-27 | **NOT PASSED** | Every automatable check green. Blocked on the device matrix (`12` §7) and a tagged Pages deploy — both user actions. | [phase 2 notes](./notes/phase-2.md#gate-record) |
| 3 — Athletes & roster (v0.2) | 2026-07-28 | **NOT PASSED** | Same two blockers, unchanged. Nothing in Phase 3 alters the analysis. | [phase 3 notes](./notes/phase-3.md#gate-record) |
| 4 — Arcade (v0.3) | 2026-07-28 | **NOT PASSED** | Same two blockers, now three gates deep. Two of `03`'s four criteria ("fun standalone", "a child can start one unaided") are claims about a person, not a program, and no test will close them. 1 941 tests, coverage 94.9%. | [phase 4 notes](./notes/phase-4.md#gate-record) |

---

## Delegation log

Records subagent use, per `CLAUDE.md` §7.3.
| Date | Task | Agent / model | Scope (files owned) | Outcome |
|---|---|---|---|---|
| 2026-07-27 | T-2.12 | `general-purpose` / `sonnet` | `src/sports/basketball/art.ts`, `src/sports/basketball/court-render.ts`, `src/modes/live/audio.ts` and their tests — nothing else | **Good.** Stayed exactly in scope, wrote resolving spec headers, and its `@design` references all check out against the specs (`06` §9, `10` §11) — verified against the documents, not against its own summary (§7.3 rule 6). It also flagged a real ambiguity rather than guessing quietly (no "shot missed" event exists; it used `rebound` and documented why). The main session reviewed the diff, ran the suite and the browser E2E, and made the commit. |
---

---

## Decisions taken during implementation

Small calls that did not warrant a spec change. The rationale is in the phase notes; anything
that changes the product goes in [`07-decisions.md`](./07-decisions.md) instead.

| Date | Task | Decision | Rationale |
|---|---|---|---|
| 2026-07-27 | T-3.4 | `minutes` in `05` §3.3's growth formula is real minutes of play, not game-clock minutes | [phase 3 notes](./notes/phase-3.md#2026-07-27--t-34--minutes-in-05-33s-growth-formula-is-real-minutes-of-play-not-game-clock-minutes) |
| 2026-07-28 | T-3.6 | Behavioural coupling fades to exactly zero at 75 familiarity, not at 100 | [phase 3 notes](./notes/phase-3.md#2026-07-28--t-36--behavioural-coupling-fades-to-exactly-zero-at-75-familiarity-not-at-100) |
| 2026-07-28 | T-3.8 | `src/sports/catalogue.ts` distinguishes *rateable* from *playable* sports | [phase 3 notes](./notes/phase-3.md#2026-07-28--t-38--srcsportscataloguets-distinguishes-rateable-from-playable-sports) |
| 2026-07-28 | T-3.12 | The lineup editor is tap-to-place, not drag-to-place, despite `03` naming the task "drag-to-slot" | [phase 3 notes](./notes/phase-3.md#2026-07-28--t-312--the-lineup-editor-is-tap-to-place-not-drag-to-place-despite-03-naming-the-task-drag-to-slot) |
| 2026-07-28 | T-3.17 | `MatchSetup.rosters` is optional, and a rosterless match keeps the seeded fallback forever | [phase 3 notes](./notes/phase-3.md#2026-07-28--t-317--matchsetuprosters-is-optional-and-a-rosterless-match-keeps-the-seeded-fallback-forever) |
| 2026-07-28 | T-3.17 | `sports/types.ts` and `athletes/types.ts` now import each other, type-only | [phase 3 notes](./notes/phase-3.md#2026-07-28--t-317--sportstypests-and-athletestypests-now-import-each-other-type-only) |
| 2026-07-28 | T-3.5 | `xpFor(level) = 100 × level^1.6` is the cost to advance *from* that level, not a cumulative total | [phase 3 notes](./notes/phase-3.md#2026-07-28--t-35--xpforlevel--100--level16-is-the-cost-to-advance-from-that-level-not-a-cumulative-total) |
| 2026-07-28 | T-3.5 | Within a session, the n-th award of one action is worth `0.93^(n-1)` of the first, floored at 0.2 | [phase 3 notes](./notes/phase-3.md#2026-07-28--t-35--within-a-session-the-n-th-award-of-one-action-is-worth-093n-1-of-the-first-floored-at-02) |
| 2026-07-27 | T-3.1 | The `athletes` store's name index is `byDisplayName` on `displayName`, and `openDatabase` now reconciles indexes | [phase 3 notes](./notes/phase-3.md#2026-07-27--t-31--the-athletes-stores-name-index-is-bydisplayname-on-displayname-and-opendatabase-now-reconciles-indexes) |
| 2026-07-27 | T-3.3 | Basketball's position-weight table (`05` §3.4) is new, not quoted | [phase 3 notes](./notes/phase-3.md#2026-07-27--t-33--basketballs-position-weight-table-05-34-is-new-not-quoted) |
| 2026-07-27 | T-3.3 | Soccer's physical modifiers are read off `05` §2.1's prose, at half basketball's magnitude | [phase 3 notes](./notes/phase-3.md#2026-07-27--t-33--soccers-physical-modifiers-are-read-off-05-21s-prose-at-half-basketballs-magnitude) |
| 2026-07-27 | T-3.3 | `src/sports/soccer/weights.ts` ships in Phase 3, ahead of Phase 6's soccer module | [phase 3 notes](./notes/phase-3.md#2026-07-27--t-33--srcsportssoccerweightsts-ships-in-phase-3-ahead-of-phase-6s-soccer-module) |
| 2026-07-27 | T-2.1 | FIBA court dimensions (28 × 15 m), not NBA | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-21--fiba-court-dimensions-28--15-m-not-nba) |
| 2026-07-27 | T-2.1 | World bounds equal court bounds — an inbounder stands *on* the line, not behind it | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-21--world-bounds-equal-court-bounds--an-inbounder-stands-on-the-line-not-behind-it) |
| 2026-07-27 | T-2.2 | Clock compression is 4× (3 real minutes shown as 12:00) and derived from the two quarter figures | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-22--clock-compression-is-4-3-real-minutes-shown-as-1200-and-derived-from-the-two-quarter-figures) |
| 2026-07-27 | T-2.2 | Every restart gives a fresh 24, where the real rules sometimes retain the clock | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-22--every-restart-gives-a-fresh-24-where-the-real-rules-sometimes-retain-the-clock) |
| 2026-07-27 | T-2.2 | No eight-second backcourt count | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-22--no-eight-second-backcourt-count) |
| 2026-07-27 | T-2.3 | A shot's outcome is drawn at release; the trajectory is then aimed to match it | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-23--a-shots-outcome-is-drawn-at-release-the-trajectory-is-then-aimed-to-match-it) |
| 2026-07-27 | T-2.3 | Placeholder shot selection got two small tweaks it did not strictly need | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-23--placeholder-shot-selection-got-two-small-tweaks-it-did-not-strictly-need) |
| 2026-07-27 | T-2.4 | A pass is flown and resolved by proximity; a shot is resolved at release | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-24--a-pass-is-flown-and-resolved-by-proximity-a-shot-is-resolved-at-release) |
| 2026-07-27 | T-2.6 | The rebound is a weighted draw rather than the highest score | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-26--the-rebound-is-a-weighted-draw-rather-than-the-highest-score) |
| 2026-07-27 | T-2.7 | Zone defence deferred to T-2.8 | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-27--zone-defence-deferred-to-t-28) |
| 2026-07-27 | T-2.7 | Contest is weighted by direction, not just distance | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-27--contest-is-weighted-by-direction-not-just-distance) |
| 2026-07-27 | T-2.8 | The CPU decides by expected points rather than by rules of thumb | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-28--the-cpu-decides-by-expected-points-rather-than-by-rules-of-thumb) |
| 2026-07-27 | T-2.8 | The shot bar is a possession's *continuation* value, not its total value | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-28--the-shot-bar-is-a-possessions-continuation-value-not-its-total-value) |
| 2026-07-27 | T-2.9 | Auto-switch is an assist, not a difficulty setting | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-29--auto-switch-is-an-assist-not-a-difficulty-setting) |
| 2026-07-27 | T-2.9 | With auto-switch off, the player is *not* switched to the ball-carrier | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-29--with-auto-switch-off-the-player-is-not-switched-to-the-ball-carrier) |
| 2026-07-27 | T-2.13 | `Rng.int(min, max)` is half-open, and reads as inclusive | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-213--rngintmin-max-is-half-open-and-reads-as-inclusive) |
| 2026-07-27 | T-2.13 | Balance targets are bands, and `eFG%` carries the tight one | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-213--balance-targets-are-bands-and-efg-carries-the-tight-one) |
| 2026-07-27 | T-2.12 | **Raised, not fixed: the `@invariant` IDs in spec headers do not match `12` §3's table.** Headers across Phases 0–2 use `INV-5` for "no sport-specific branching in engine core" and `INV-11` for "no information by colour alone" — but in `12` §3, INV-5 is the pack-economy rule and INV-11 is cross-mode outcome parity. Those two meanings come from **CLAUDE.md §8's** numbered constraint list, which is a *different* numbering from the INV table. | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-212--raised-not-fixed-the-invariant-ids-in-spec-headers-do-not-match-12-3s-table-headers-across-phases-02-use-inv-5-for-no-sport-specific-branching-in-engine-core-and-inv-11-for-no-information-by-colour-alone--but-in-12-3-inv-5-is-the-pack-economy-rule-and-inv-11-is-cross-mode-outcome-parity-those-two-meanings-come-from-claudemd-8s-numbered-constraint-list-which-is-a-different-numbering-from-the-inv-table) |
| 2026-07-27 | T-2.10 | Built the Live mode host, which `03` has no task for | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-210--built-the-live-mode-host-which-03-has-no-task-for) |
| 2026-07-27 | T-2.10 | T-2.10 was not delegated despite `03` marking it `sonnet` | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-210--t-210-was-not-delegated-despite-03-marking-it-sonnet) |
| 2026-07-27 | T-2.11 | In-match settings are handedness and sound only | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-211--in-match-settings-are-handedness-and-sound-only) |
| 2026-07-27 | T-2.6 | No delegation this session, despite the offer | [phase 2 notes](./notes/phase-2.md#2026-07-27--t-26--no-delegation-this-session-despite-the-offer) |
