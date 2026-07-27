# PROGRESS — Sport-Game · spec 001-initial-dev

**This file is the project's memory.** It records what is done, what is in flight, and exactly where
to resume. It is updated *in the same commit as the work it describes* — never as separate
bookkeeping.

Protocol: [`/CLAUDE.md`](../../CLAUDE.md) §3. Task definitions: [`03-phases-and-tasks.md`](./03-phases-and-tasks.md).

Statuses: `todo` · `in_progress` · `blocked` · `done` · `cut`

---

## In-flight

- **Task:** T-1.12 — Input recording + golden-seed determinism tests in CI (INV-8)
- **Status:** in_progress
- **Started:** 2026-07-27
- **Branch commit:** (see `git log` on `claude/phase-1-token-optimizations-g7sjm3`)
- **Done so far:** T-1.1 … T-1.11 `done` — the engine plus the seam and a playable test sport
- **Next step:** `src/engine/match/recorder.ts` and `tests/sim/` — record `(seed, setup, inputs)`,
  replay it, and hash quantised state so two runs are compared byte-for-byte rather than by eye.
- **Files touched:** src/engine/**/*.ts, src/sports/{types.ts,testsport/index.ts} and their tests
- **Blockers:** none. **Pre-existing, unrelated:** `pnpm test:coverage` fails two `12` §2
  thresholds (`src/storage/**` functions, `src/ui/**` lines), identically at Gate 0's merge commit.
- **Notes:** CI runs on `main` and `workflow_dispatch` only (user request, 2026-07-27). Formatting
  is hook-handled (`CLAUDE.md` §11).


> **Resuming after an interruption:** read this block, `git log --oneline -20`, then continue from
> **Next step**. Everything needed should be here — if it isn't, the previous session didn't follow
> `CLAUDE.md` §3.1, and the fix is to reconstruct this block before writing any code.

---

## Summary

| Phase | Name | Tasks | Done | Status | Milestone |
|---|---|---|---|---|---|
| 0 | Foundation, PWA shell, update & offline lifecycle | 18 | 18 | `done` | — |
| 1 | Engine core | 13 | 11 | `in_progress` | — |
| 2 | Basketball · Live | 13 | 0 | `todo` | v0.1 |
| 3 | Athletes, cross-sport ratings, roster | 17 | 0 | `todo` | v0.2 |
| 4 | Arcade framework + basketball arcade set | 13 | 0 | `todo` | v0.3 |
| 5 | Playbook (turn-based) + basketball Playbook | 11 | 0 | `todo` | v0.4 |
| 6 | Soccer · all three modes | 18 | 0 | `todo` | v0.5 |
| 7 | CPU AI depth & difficulty ladder | 11 | 0 | `todo` | — |
| 8 | Modes hub, progression, achievements, economy | 16 | 0 | `todo` | — |
| 9 | UI/UX, accessibility, performance, data safety | 15 | 0 | `todo` | **v1.0** |
| 10 | P2P (bonus) | 11 | 0 | `todo` | v1.0.x |
| 11 | Hockey & American Football | 14 | 0 | `todo` | v1.1 |
| | **Total** | **170** | **29** | | |

---

## Tasks

### Phase 0 — Foundation, PWA shell, update & offline lifecycle

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-0.1 | Scaffold Vite + TypeScript (strict), ESLint, Prettier, Vitest, Playwright, folder layout per `04` §4 | S | `done` | | — | `auto` (build + lint + suite green) | pnpm 11. TS strict incl. `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`. Vitest defaults to the `node` environment; DOM suites opt in per file. |
| T-0.2 | Derive `base` from repo name at build; lint rule + test banning literal paths (INV-4) | S | `done` | | `tests/unit/tools/base-path.test.ts`, `tests/invariants/inv-04-no-literal-base-path.test.ts` | `auto` | `tools/base-path.ts` resolves `BASE_PATH` → `GITHUB_REPOSITORY` → fallback. Lint bans the literal in `src/`; the invariant test re-checks as text so an inline disable can't hide it. |
| T-0.3 | App shell: canvas host, hash router, safe-area layout, orientation handling | M | `done` | | `tests/unit/app/{router,shell,orientation,canvas-host}.test.ts` | `auto` | Hash routing (`04` §2 — Pages has no rewrites). Literal route segments beat `:params`. `chrome: 'bare'` drops header and tabs for Live. Rotate prompt is the iOS fallback where `orientation.lock` is absent. Screens load lazily; a superseded slow load is dropped rather than mounted late. |
| T-0.4 | Design tokens + primitive components + dev-only component gallery route | M | `done` | | `tests/unit/ui/components.test.ts` | `auto` | Tokens from `10` §3.1–3.3, dark-first with a light theme and an OS-following default. UI scale is one `--ui-scale` multiplier on the whole type scale. Primitives: button (5 variants × 5 states), segmented, switch, rating/progress bars, familiarity ring, stars, coin pill, dialog, sheet, toast, banner, empty/error/skeleton. `#/dev/ui` is dev-only and code-split. No `innerHTML` anywhere — untrusted roster data can't inject markup (`04` §12). |
| T-0.5 | Web app manifest generated with base-path `id`/`scope`/`start_url`, full icon set incl. maskable | M | `done` | | `tests/unit/tools/manifest.test.ts` | `auto` + icons eyeballed at 192 px, both variants | `id`/`scope`/`start_url` are all the base path, so the install is a distinct app from any sibling PWA on the account. Icons are rasterised at build by `tools/png.ts` — a ~90-line PNG encoder — rather than adding an image dependency or committing binaries; 12 sizes plus maskable 192/512, 34 kB total. A `404.html` copy of `index.html` answers deep links, since Pages has no rewrites. The dev server serves the same manifest and icons the build emits. |
| T-0.6 | Service worker: per-class cache strategies (`11` §2), atomic precache install, versioned caches, activate cleanup | L | `done` | | `tests/unit/pwa/strategies.test.ts`, `tests/unit/tools/precache.test.ts` | `auto` + headless Chromium: registers, precaches 20 entries, cold-loads a deep hash route with the server refusing connections | The `11` §2 table lives in pure functions in `strategies.ts` so every row is asserted without a SW environment. `sw.js` is built by a second Vite pass with the precache manifest injected from the emitted asset list; emitted unhashed at the base root, since its directory is what scopes it. **Bug found in verification:** navigation preload *rejects* rather than resolving `undefined` when offline, which failed the whole navigation — the exact offline cold-start `11` exists to prevent. Now caught. Also dropped `frame-ancestors` from the CSP meta: it is header-only and browsers log an error. |
| T-0.7 | `version.json` emission + all five update-detection triggers (`11` §3) | M | `done` | | `tests/unit/pwa/{version,update-detector}.test.ts` | `auto` — each of the five triggers asserted separately | `version.json` is emitted at build and served `no-store` in dev and in the build. All five triggers wired: launch, foreground (throttled to 60 s), 15-minute poll, explicit check, and the version poll. The fifth is the one that matters — a deployed build that differs while nothing is waiting is reported as `stuck`, which is what lets T-0.10 offer Repair instead of the app silently doing nothing. `back online` is wired as a free sixth chance. |
| T-0.8 | Update application: waiting-worker banner, safe-point auto-update, single-reload guard, `minSupportedVersion` force | L | `done` | | `tests/unit/pwa/update-application.test.ts` | `auto` | The whole of `11` §4 is one pure `decide()` function, so the policy is testable without a worker. Safe points: quiet screen, no match, no unsaved editor, no ceremony, idle ≥5 s. The reload guard is persisted, so a worker that keeps re-waiting cannot loop the app across reloads. A forced update outranks the snooze *and* the mid-match rule — it is reserved for builds that cannot load saves safely, so waiting is the more dangerous option. |
| T-0.9 | Offline integrity self-check and self-heal; offline-readiness UI; "download everything for offline" | L | `done` | | `tests/unit/pwa/update-application.test.ts` (integrity block) | `auto` | Only the worker holds the precache manifest, so the page asks for it over `postMessage`. Missing non-critical entries heal silently when online and produce an honest notice when offline; a missing shell or entry chunk escalates straight to Repair. Check runs in an idle callback so it never costs launch time. |
| T-0.10 | Repair flow — caches and SW only, IndexedDB untouched (INV-13); "check for update now"; version display | M | `done` | | `tests/invariants/inv-13-repair-preserves-data.test.ts` | `auto` | Settings → App & updates shows running version, build, build date, and last check, so "am I on the new one?" is always answerable. INV-13 is asserted three ways: behaviourally against real IndexedDB, structurally (the module imports no IndexedDB code at all), and textually against the copy the UI must show. |
| T-0.11 | `ScopedStorage`: namespaced IndexedDB, localStorage, and Cache Storage behind one module (INV-3) | M | `done` | | `tests/unit/storage/{scope,prefs,caches}.test.ts`, `tests/integration/storage/idb.test.ts`, `tests/invariants/inv-03-namespaced-storage.test.ts` | `auto` | **Taken out of numeric order** — T-0.5/T-0.6 need the cache-name helpers. `scope.ts` is the only place a storage name is built. Prefs degrade to an in-memory store rather than throwing in Safari private mode. Cache deletion always filters on the namespace, so a sibling PWA on the same origin survives Repair (PWA-15). The INV-3 test checks the source as text, so an inline lint disable can't hide a violation. Vitest now runs under `base: '/test-scope/'`, so anything hardcoding the real repo name fails in CI. |
| T-0.12 | Storage persistence request, quota/usage display, denial warning + backup prompt | S | `done` | | `tests/unit/storage/persistence.test.ts` | `auto` | Asked on first write rather than at launch — browsers grant it more readily once engagement exists (`11` §7), and the nudger re-asks once per milestone. Denial and unsupported are distinct states with distinct copy, both pointing at a backup. Quota pressure warns at 80%. |
| T-0.13 | Schema versioning + migration runner with pre-migration snapshot and rollback | M | `done` | | `tests/integration/storage/migrations.test.ts` | `auto` — against real IndexedDB via fake-indexeddb | Forward-only chain per `05` §9. The snapshot covers every store, singletons included, and a failure rolls back the *whole* chain, not just the failing step — a partially-migrated database is worse than an unmigrated one. Data from a newer build is rejected outright rather than partially applied. Chain is empty at v1; the first entry will be `to: 2`. |
| T-0.14 | Install UX: `beforeinstallprompt` capture, custom button, iOS-only A2HS instructions | M | `done` | | `tests/unit/pwa/install.test.ts` | `auto` | The event fires once and only replays inside a user gesture, so it is captured and the mini-infobar suppressed. iOS Safari gets the manual A2HS steps — and Chrome-on-iOS deliberately does not, since it has no such menu item. Four distinct states, each with its own copy. |
| T-0.15 | GitHub Actions: CI (typecheck, lint, unit, e2e, a11y, coverage, budgets) + tagged Pages deploy | M | `done` | | `tools/budget.ts` (checked by `pnpm budget`) | `auto` — workflows not yet exercised on GitHub; first push to the branch will run CI | CI runs typecheck, lint, coverage, traceability, PROGRESS check, a committed-report diff, build, budgets, then E2E in a second job against a real static build under the deployed base path. Deploy is tag-triggered and re-runs the gate first. Budgets: initial JS 9.5 KB / 200 KB, install 92 KB / 6 MB. |
| T-0.16 | PWA lifecycle E2E suite: all sixteen scenarios in `11` §9 | L | `done` | | `tests/e2e/{pwa-lifecycle,pwa-update-flow,a11y-and-smoke}.spec.ts` | `auto` — 28 E2E green in headless Chromium | All sixteen `11` §9 scenarios, driven by `tools/e2e-server.ts`, which can deploy a second build, 404 an asset, and refuse connections on demand. The "v2" build is the same bundle with its build hash rewritten — that is what names every cache and what `version.json` reports, so it is the real byte-level change the browser detects. **Four real bugs found and fixed** — see the Gate 0 record. PWA-4/5 assert the safe-point policy rather than staging a match, which Phase 2 does not yet make possible; noted as a follow-up. |
| T-0.17 | Spec-header lint rule + traceability report generator (INV-15) | M | `done` | | `tests/invariants/inv-15-spec-headers.test.ts`, `tests/unit/tools/spec-tooling.test.ts` | `auto` | Deliberately two checks: a plain-JS ESLint rule doing a presence check on the five mandatory fields with no filesystem access, so it runs on every keystroke; and the invariant test resolving every task and story ID against `03` and `02`, which is authoritative and runs in CI. `pnpm trace` writes `docs/traceability.md` both ways — currently 39 modules across 12 tasks. |
| T-0.18 | `PROGRESS.md` validation script: task IDs resolve, statuses valid, no orphans | S | `done` | | `tests/unit/tools/spec-tooling.test.ts` | `auto` — `pnpm progress:check` reports 156 todo / 14 done, no problems | Catches unresolvable IDs, invalid statuses, duplicated rows, orphaned tasks defined in `03` with no row, an In-flight task with no row, and more than one `in_progress` at a time (`CLAUDE.md` §2). |

### Phase 1 — Engine core

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-1.1 | Seeded PRNG + lint rule banning `Math.random` in `engine/`, `sports/` (INV-2) | S | `done` | | `tests/unit/engine/rng.test.ts`, `tests/invariants/inv-02-no-math-random.test.ts` | `auto` | sfc32 seeded through splitmix32, all int32 ops so two engines produce byte-identical streams; a float generator could not promise that. `fork(label)` derives from seed + label, **not** from the parent's position, so adding a draw in one subsystem cannot shift another's results — that is what makes determinism survive refactors. `snapshot()`/`restore()` carry the pending Box–Muller spare, so a replay checkpoint resumes mid-pair. A golden-seed test pins the first eight values: changing the algorithm invalidates every recorded replay, so it should be a deliberate decision. `randomSeed()` is the one non-deterministic call, and it uses `crypto.getRandomValues`. The lint rule was already in place from T-0.1; INV-2's test scans `engine/`, `sports/`, `modes/` as text (an inline disable cannot hide a substring) and also asserts the lint rule still covers all three directories. |
| T-1.2 | Fixed-timestep loop (60 Hz) with accumulator, render interpolation, pause/step/time-scale | M | `done` | | `tests/unit/engine/loop.test.ts` | `auto` | Split in two: `Clock` holds the accumulator and *only* the timing policy, `createLoop` converts frame timestamps into deltas. Everything worth testing is therefore testable with no browser, no timers, and no waiting — the frame source is injected. Two clamps, not one: `maxFrameMs` (250) throws away a backgrounded tab's minutes before they reach the accumulator, and `maxStepsPerFrame` (5) is the spiral-of-death guard, which discards the backlog rather than banking it. `alpha` holds still while paused so a paused frame renders identically instead of shimmering. Resume does not clear the accumulator — the driver drops the paused wall time instead, so resuming never bursts. Step size is fixed at every time scale: slow motion changes how much time accumulates, never what the sim sees. Verified at 30/60/120 fps that simulated time matches to within one step. |
| T-1.3 | Entity model: struct-of-arrays state, spatial hash for neighbour queries | L | `done` | | `tests/unit/engine/world.test.ts` | `auto` | SoA typed arrays: the hot loops touch one field across all entities, and typed arrays give the GC nothing to collect mid-match (`01` R2). Uniform grid rebuilt per step by counting sort — O(n + cells), allocation-free, and simpler than incremental updates at 22 entities. Two determinism decisions: `spawn` claims the *lowest* free slot, not the most recently freed, so a replay assigns the same ids; and the grid is filled in ascending id order, so query results come out id-ordered without a sort (INV-8). Queries write into a caller-owned `Int32Array` and stop at its length, so the hot path allocates nothing. Distances are 2D on purpose — a ball 3 m up is still near the athlete catching it. Correctness is checked against brute force over 40 random 22-entity layouts, plus cell-boundary and out-of-field cases. |
| T-1.4 | Movement & steering from attributes: accel, max speed, turn rate, seek/arrive/pursue/avoid | L | `done` | | `tests/unit/engine/{movement,steering}.test.ts` | `auto` | The engine never sees attributes: `movementProfile()` takes *derived ratings* (1–99, the output of `05` §3) and returns metres and seconds, so the sport seam stays honest. Three limits do all the work — top speed 4.0–8.5 m/s, acceleration 3–9 m/s², turn rate 4–12 rad/s — and `MOVEMENT_TUNING` is the single feel-tuning surface. Integration order is rotate → change speed → move: rotating the current velocity rather than snapping to the desired one is what makes a joystick flick read as a body turning. A near-stationary athlete may pivot freely, otherwise starting off feels sticky. Steering behaviours are pure functions writing into caller-owned vectors (zero allocation). Two deliberate choices: separation weights by `1 − d/r` rather than `1/d²`, because inverse-square makes touching athletes fire apart like a bug; and `avoid()` returns `false` when no dodge is needed, so callers fall through to real intent instead of blending a zero vector. |
| T-1.5 | Collision & contact contests weighted by strength/agility | L | `done` | | `tests/unit/engine/collision.test.ts` | `auto` | Two separate problems, kept separate: `resolveCollisions()` is deterministic geometry with no randomness at all, `contest()` is the seeded ratings decision sports build rebounds and tackles on. Contact is soft on purpose — positional correction at 40% of the overlap per step, mass-weighted — because impulse separation at 60 Hz jitters between two athletes who both want the same spot, which is most of a possession. Pairs are taken once with `a < b`, so the result never depends on visit order. Coincident athletes get a contact normal derived from their ids: INV-2 forbids a random one, and a random one would diverge a replay the moment two players stack. The contest curve is logistic over a rating difference with divisor 25 — a 20-point edge is ~65–70%, and even 99-vs-1 leaves the underdog a few percent, which is what keeps a low-rated squad playable. Separation settles to within `OVERLAP_EPSILON` (1 mm) rather than exactly zero, deliberately. |
| T-1.6 | Ball physics: position + height, gravity, bounce, spin/curve, possession attach/detach | L | `done` | | `tests/unit/engine/ball.test.ts` | `auto` | The ball lives in the same `World` as the athletes (using `z`/`vz`), so neighbour queries find it for free, and it is flagged `INTANGIBLE` so contact resolution never shoves an athlete off their line as it rolls past. Possession is a state the *ball* holds, not a flag on an athlete: exactly one carrier can exist, so "who has it" is unambiguous and losing it is one assignment. A carried ball does not integrate — it is placed ahead of its carrier, which feels better than simulating a constrained dribble. **Bug found and fixed in test:** treating "airborne" as `z > radius` alone gave every bounce one gravity-free step of rise, injecting enough energy for a permanent low limit cycle — the ball never settled. Airborne is now `z > radius || vz > 0`. Spin is yaw-only (one axis covers curving passes, crosses, and hooks); Magnus reads pre-update velocity so a pass cannot accelerate in flight. `launchVelocity()` solves the vertical component exactly rather than iterating, so the same pass request always produces the same pass. |
| T-1.7 | Canvas 2D renderer: layers, batching, LOD, off-screen static layers, debug overlay | L | `done` | | `tests/unit/engine/renderer.test.ts` | `auto` | Everything works against `Canvas2D`, the subset of the real context actually used, so layer and LOD policy is unit-tested against a recording double instead of a real canvas — 29 tests, no jsdom. Layer order is fixed and named, not caller-controlled: "why is the ball behind the crowd" is not a bug worth having twice. The HUD layer alone draws in screen space. Three fill-rate levers in payoff order: blit a static field drawn once into an off-screen canvas (keyed on court + theme + size, so a theme switch redraws and nothing else does); batch draws sharing a style so the context changes state once per batch rather than per entity; and drop detail by distance. LOD is *ratio*-based against the viewport half-diagonal, so it behaves the same on a phone and a tablet and at every zoom. `FrameStats` reports commands, style changes, and the LOD split — the numbers T-1.13's budget check needs. |
| T-1.8 | Camera: ball follow, smoothing, dynamic zoom, bounds clamp, shake (reduced-motion aware) | M | `done` | | `tests/unit/engine/camera.test.ts` | `auto` | Render-side only: it advances on frame time and nothing in `physics/` or a sport may read it — a camera that influenced the sim would make what you see change what happens. Smoothing uses `1 − e^(−rate·dt)` rather than `gap × rate × dt`, so a 30 fps device and a 120 fps device see identical motion; the naive form lags more on the slower device, which is the one that can least afford to look worse. Lookahead leads the ball so the player sees where play is going. The bounds clamp centres an axis the viewport is wider than, rather than jamming the field against one edge. Shake is seeded (INV-2 — an unseeded shake makes two replays of one match visibly different) and under reduced motion is skipped entirely rather than scaled down, along with the lookahead lead: `10` §6 exists for people motion makes ill, and a small shake is still motion. |
| T-1.9 | Input layer: floating joystick, context buttons, handedness mirror, keyboard, gamepad | L | `done` | | `tests/unit/engine/input.test.ts` | `auto` — 42 tests; **still needs a real phone** for thumb feel and the <100 ms US-2.1 latency check | Three devices reduce to one `InputFrame`, so nothing downstream can tell which produced it — that is what makes US-2.6 free rather than a second control path, and what makes T-1.12's recording a recording of the game rather than of a thumb. Sources are fed plain data (key codes, pointer coordinates, a gamepad snapshot), never DOM events, so every mapping rule is tested with no browser. Stick feel: floating origin, deadzone *rescaled* rather than stepped (otherwise the first responsive pixel jumps to 18% speed), and the origin drags along past full deflection so a thumb that wanders mid-sprint keeps control — the single most-noticed difference between a virtual stick that feels good and one that does not. Handedness mirrors zones and button positions from one code path, not two layouts. Device precedence is last-used-wins: a player with a pad plugged in who reaches for the screen gets the screen, with no setting to find. Keyboard diagonals are normalised. |
| T-1.10 | Match state machine + `SportEvent` bus (the contract all three modes emit) | M | `done` | | `tests/unit/engine/match.test.ts` | `auto` | INV-9 is enforced by *omission*: `SportEvent` has no `mode` field, so a consumer physically cannot branch on which mode produced an event — a shape decision rather than a code-review rule. Time is counted in simulation steps, never wall-clock, so a replay and a live match produce identical clocks (INV-8). One machine serves all three modes: Playbook advances it a turn at a time, an arcade session drives a single-period instance. A stoppage still consumes total time (replays line up) but only advances the period clock when the sport says so — basketball stops, soccer does not. Bus listeners are synchronous and in subscription order (an achievement that fires "later" cannot be part of a deterministic replay), and one listener throwing is contained rather than taking the match down. Methods guard themselves as well as the transition table: `preMatch → live` is a legal edge, so `nextPeriod()` before kick-off would otherwise silently start the match at period 2. |
| T-1.11 | `SportModule` interface (`04` §5, `09` §5) + a trivial test sport proving the seam | M | `done` | | `tests/unit/sports/seam.test.ts` | `auto` — 18 tests including a full two-half match played through the state machine | The seam is entirely *pull*-shaped: the engine calls the sport, never the reverse. A sport that could reach into the loop, renderer, or bus would slowly acquire engine responsibilities and the seam would rot into a suggestion. `SportRegistry` is a map, not a switch — the mechanical form INV-5 takes is that there is nowhere in the engine to write `if (sport === 'basketball')`. `step()` *returns* events rather than emitting them, so the caller orders them against the clock and a headless balance run needs no bus at all. Playbook/Arcade adapters (`09` §5) are deferred to Phases 4–5 rather than stubbed. The test sport (`src/sports/testsport/`) is deliberately trivial — chase a ball, carry it into a goal — because a bug in a simple sport is an engine bug, whereas a bug in basketball might be basketball's. It is T-1.12's determinism fixture and Gate 1's subject. |
| T-1.12 | Input recording + golden-seed determinism tests in CI (INV-8) | M | `todo` | | | | |
| T-1.13 | Perf harness: fps/frame-time/entity overlay + CI budget check on a headless benchmark | M | `todo` | | | | |

### Phase 2 — Basketball · Live

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-2.1 | Court geometry, zones, arc, key, hoop, boundaries | M | `todo` | | | | |
| T-2.2 | Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts | L | `todo` | | | | |
| T-2.3 | Shooting: hold-release meter, arc trajectory, make probability from ratings × distance × pressure × release | L | `todo` | | | | |
| T-2.4 | Passing: aimed, lead passes, interceptions, turnovers | M | `todo` | | | | |
| T-2.5 | Dribbling & driving: handling control, contact absorption, blow-by | L | `todo` | | | | |
| T-2.6 | Rebounding: height/vertical/strength/box-out/timing contest | M | `todo` | | | | |
| T-2.7 | Defence: marking, contest, steal, block, foul model, free throws | L | `todo` | | | | |
| T-2.8 | Baseline CPU: role-based offence (spacing, cuts, screens), man defence, possession decisions | XL | `todo` | | | | |
| T-2.9 | Control switching: auto on turnover, manual cycle, controlled-athlete indicator | M | `todo` | | | | |
| T-2.10 | Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators | M | `todo` | | | | |
| T-2.11 | Pause menu, quit, in-match settings, post-match summary with box score | M | `todo` | | | | |
| T-2.12 | Basketball art & audio pass | L | `todo` | | | | |
| T-2.13 | Balance pass #1: shooting percentages and pace plausible over 500 headless games | M | `todo` | | | | |

### Phase 3 — Athletes, cross-sport ratings, roster

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-3.1 | Athlete schema, IndexedDB store, indexes, repository | M | `todo` | | | | |
| T-3.2 | Attribute system: the eleven attributes, budget rules, sandbox flag, random roll | M | `todo` | | | | |
| T-3.3 | Derivation engine: weight matrix, physical modifiers, unit-tested invariants | L | `todo` | | | | |
| T-3.4 | Familiarity model: per-sport familiarity, penalty curve, growth from minutes | L | `todo` | | | | |
| T-3.5 | Sport skill XP: levels, sub-skills, event-driven awards, diminishing returns | L | `todo` | | | | |
| T-3.6 | Behavioural coupling: familiarity → decision noise, control error, reaction penalty in-sim | M | `todo` | | | | |
| T-3.7 | Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale | L | `todo` | | | | |
| T-3.8 | Athlete card component: compact + full, sport switcher, familiarity ring, "why this rating" | L | `todo` | | | | |
| T-3.9 | Cross-sport compare view with projections for unplayed sports | M | `todo` | | | | |
| T-3.10 | Roster browser: search, sort, filter, bulk select | M | `todo` | | | | |
| T-3.11 | Teams: create/edit, name, colours, generic crests | M | `todo` | | | | |
| T-3.12 | Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best | L | `todo` | | | | |
| T-3.13 | Stamina, injury, suspension, availability | M | `todo` | | | | |
| T-3.14 | Starter roster: generated fictional athletes, enough for both sports | M | `todo` | | | | |
| T-3.15 | Roster import: file + URL, schema validation, per-record errors, merge/conflict, responsibility notice | L | `todo` | | | | |
| T-3.16 | Roster and full-backup export/import with version checks and change preview | M | `todo` | | | | |
| T-3.17 | Wire real athletes into basketball Live — lineups drive the sim | M | `todo` | | | | |

### Phase 4 — Arcade framework + basketball arcade set

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-4.1 | Arcade framework: `ArcadeGameDef`, host, session lifecycle, scoring, star ratings | L | `todo` | | | | |
| T-4.2 | Calibration: ratings + familiarity → window sizes and speeds (INV-10) | M | `todo` | | | | |
| T-4.3 | Arcade hub: grid, locked/unlocked states, personal bests, athlete picker with window hint | M | `todo` | | | | |
| T-4.4 | Practice / scored / daily modes; seeded daily challenge | M | `todo` | | | | |
| T-4.5 | Free Throw — release timing under mounting pressure | M | `todo` | | | | |
| T-4.6 | Three-Point Contest — five racks, rhythm and timing, 60 s | M | `todo` | | | | |
| T-4.7 | Buzzer Beater — contested shot, shrinking window | M | `todo` | | | | |
| T-4.8 | Fast Break — finish past a recovering defender | M | `todo` | | | | |
| T-4.9 | Pickpocket — reaction test, jump the lane without fouling | M | `todo` | | | | |
| T-4.10 | Arcade → progression: XP, familiarity, `SportEvent` emission at reduced rate | M | `todo` | | | | |
| T-4.11 | Arcade hot-seat: party rounds, seeded fairness, ranking, elimination formats | M | `todo` | | | | |
| T-4.12 | Arcade accessibility: left-hand mirroring, colour-independent meters, reduced motion | M | `todo` | | | | |
| T-4.13 | Arcade balance: daily reward caps, anti-farm verification (INV-12) | M | `todo` | | | | |

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

Appended when a phase gate is evaluated. Format:

```markdown
### Gate N — <phase name> · <date> · PASS | FAIL

- **Criteria:** <the gate's criteria from 03, each with a result>
- **Suite:** unit / determinism / property / integration / component / visual / e2e / a11y / perf — all green
- **Coverage:** <per-area figures against the 12 §2 thresholds>
- **Invariants:** none regressed | <list>
- **Device matrix:** <results per device class from 12 §7>
- **Performance:** <figures against the 12 §6 budgets>
- **Tag / deploy:** <tag> → <Pages URL verified installing and running offline>
- **Deferred:** <anything carried forward, with the reason>
- **Feel:** <honest one-liner on whether it is actually fun yet>
```

*(No gates evaluated yet.)*

---

## Delegation log

Records subagent use, per `CLAUDE.md` §7.3.

| Date | Task | Agent / model | Scope (files owned) | Outcome |
|---|---|---|---|---|

*(No delegation yet.)*

---

## Decisions taken during implementation

Small calls that didn't warrant a spec change but that a future session should know about. Anything
that changes the product goes in [`07-decisions.md`](./07-decisions.md) instead.

| Date | Task | Decision | Rationale |
|---|---|---|---|

*(None yet.)*

---

## Gate records

### Gate 0 — Foundation, PWA shell, update & offline lifecycle

- **Date:** 2026-07-27
- **Result:** **passed, with two items explicitly deferred** (below).
- **Branch:** `claude/build-project-azivs9`

**Checks run**

| Check | Result |
|---|---|
| Typecheck (`tsc -b`, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) | clean |
| Lint (ESLint incl. INV-2/3/4/15 rules) + Prettier | clean |
| Unit / property / integration / invariant suite | 351 passing, 24 files |
| E2E (Playwright, headless Chromium) | 28 passing |
| `11` §9 lifecycle scenarios | all sixteen covered |
| Invariant tests | INV-3, INV-4, INV-13, INV-15 green |
| Traceability (`pnpm trace`) | 39 modules, 12 tasks, no header problems |
| `PROGRESS.md` (`pnpm progress:check`) | 154 todo / 18 done, no problems |
| Bundle budgets (`12` §6) | initial JS 9.5 KB / 200 KB · install 92 KB / 6 MB |

**Gate 0 criteria (`03`)**

| Criterion | Status |
|---|---|
| Cold-launches offline | ✅ PWA-7 |
| Update banner appears for a new deploy and applies cleanly | ✅ PWA-1, PWA-2, PWA-12 |
| Deleting cache entries self-heals | ✅ PWA-8, PWA-10, PWA-16 |
| Repair leaves IndexedDB intact | ✅ PWA-11 + INV-13 |
| Every cache and storage key namespaced | ✅ INV-3 + base-path E2E |
| All sixteen PWA tests green | ✅ |
| Deployed to Pages; installs on Android and iOS | ⏳ deferred — see below |

**Bugs the verification found.** All four would have shipped invisibly:

1. **Navigation preload rejects rather than resolving `undefined` when offline** (T-0.6). The
   uncaught rejection failed the whole navigation — precisely the offline cold-start `11` exists
   to prevent.
2. **`user-scalable=no` in the viewport meta** — a WCAG 1.4.4 failure. Removed; the match view
   suppresses gestures with `touch-action` instead.
3. **Light-theme accent and info failed AA contrast** (3.5:1 against 4.5:1 required), both as text
   on `surface-0` and as a fill behind white. `10` §3.1's values are described as starting values;
   darkened to `#0B7A43` and `#0F5AAB`, which clear the line.
4. **A failed precache install left an empty cache behind**, and **an evicted code-split chunk gave
   a blank screen offline**. Both fixed: install cleans up after itself, and the shell now shows
   an explicit "this part isn't downloaded yet" state.

**Deferred, with reasons**

- **Device matrix (`12` §7) and a live Pages deploy.** This session has no phone and cannot
  publish to Pages. The workflows are written and the build is verified end to end in headless
  Chromium; a real Android and iOS install, plus the first tag deploy, remain to be run by the
  user. This is the one Gate 0 criterion not demonstrably met here, and it should be closed before
  Phase 2 ships v0.1.
- **Visual regression snapshots.** `#/dev/ui` exists as the target and the a11y audit covers every
  screen, but screenshot baselines are not committed — they would be captured on the wrong
  platform here and would churn on the first CI run. Best captured in CI on the first green run.

**Follow-ups noted for later phases**

- PWA-4/PWA-5 assert the safe-point *policy* rather than staging a real match. Revisit in Phase 2,
  when a match exists to interrupt.
- `CLAUDE.md` §11 names `claude/multi-sport-pwa-game-50k7u7` as the branch; this work is on
  `claude/build-project-azivs9`. Reconcile once the user confirms which is canonical.
