# PROGRESS — Sport-Game · spec 001-initial-dev

**This file is the project's memory.** It records what is done, what is in flight, and exactly where
to resume. It is updated *in the same commit as the work it describes* — never as separate
bookkeeping.

Protocol: [`/CLAUDE.md`](../../CLAUDE.md) §3. Task definitions: [`03-phases-and-tasks.md`](./03-phases-and-tasks.md).

Statuses: `todo` · `in_progress` · `blocked` · `done` · `cut`

---

## In-flight

- **Task:** T-4.3 — Arcade hub
- **Status:** in_progress
- **Started:** 2026-07-28
- **Branch commit:** (see `git log`)
- **Done so far:**
  - [x] T-4.1 — the arcade seam (`ArcadeGameDef`, `ArcadeHost`, `ArcadeSession`), the run host, star
        ratings, the catalogue
  - [x] T-4.2 — calibration, the four difficulty levels as data, INV-10 asserted three ways
  - [x] T-4.4 — practice / scored / daily, the seeded daily challenge, challenge codes, and the
        `arcade` record store
  - [x] T-4.5–4.9 — the five basketball games, the shared release meter, and the score-profile
        measurement that tunes their star thresholds
  - [ ] T-4.3 — hub grid, locked tiles, personal bests, athlete picker
  - [ ] T-4.10 — arcade → progression at a reduced rate
  - [ ] T-4.11 — hot-seat party rounds
  - [ ] T-4.12 — accessibility pass
  - [ ] T-4.13 — reward caps and the anti-farm verification (INV-12)
- **Next step:** T-4.3's hub screen, then T-4.10 (progression), T-4.11 (hot-seat), T-4.12
  (accessibility), T-4.13 (reward caps). **Task order deviated from strict numeric order,
  deliberately:** T-4.3 depends only on T-4.1, but a hub grid written before the games exist is a hub
  written against imagined tiles.
- **Delegation:** none. `CLAUDE.md` §7.1 marks T-4.3 and T-4.5–4.9 as `sonnet` candidates; this
  session's own instructions say not to spawn subagents unless asked, so they were built here. The
  five games would have been a poor delegation anyway — the two design bugs in the T-4.5 note were
  only visible once all five could be measured against each other.
- **Files touched:** `src/modes/difficulty.ts`, `src/modes/arcade/{types,session,scoring,
  calibration,registry,modes,daily,records,meter}.ts`, `src/achievements/ids.ts`,
  `src/sports/types.ts` (the `arcade` member), `src/storage/idb.ts` (the `arcade` store).
- **Blockers:** the device matrix and the deploy decision, unchanged since Gate 2 and now two gates deep. Gate 2 remains unsigned — see its record; Phase 3 is proceeding on
  top of that debt, deliberately, and Gate 3 inherits it.
- **Notes:** CI runs on `main` and `workflow_dispatch` only (user request, 2026-07-27) — verify
  branches locally with `pnpm verify`, `pnpm bench`, and `pnpm e2e`. Formatting and auto-fixable
  lint are handled by hooks (`CLAUDE.md` §11); never spend a turn on them. In this sandbox the
  E2E suite needs `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`. `src/athletes/**` is held to 95%
  lines/functions/statements — write the tests with the code, not after.
  T-3.17 is what finally replaces `rollRatings()` and the local `AthleteRatings` type in
  `sports/basketball/index.ts` with real athletes; run `pnpm balance` after it and after T-3.6.


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
| 4 | Arcade framework + basketball arcade set | 13 | 8 | `in_progress` | v0.3 |
| 5 | Playbook (turn-based) + basketball Playbook | 11 | 0 | `todo` | v0.4 |
| 6 | Soccer · all three modes | 18 | 0 | `todo` | v0.5 |
| 7 | CPU AI depth & difficulty ladder | 11 | 0 | `todo` | — |
| 8 | Modes hub, progression, achievements, economy | 16 | 0 | `todo` | — |
| 9 | UI/UX, accessibility, performance, data safety | 15 | 0 | `todo` | **v1.0** |
| 10 | P2P (bonus) | 11 | 0 | `todo` | v1.0.x |
| 11 | Hockey & American Football | 14 | 0 | `todo` | v1.1 |
| | **Total** | **170** | **69** | | |

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
| T-1.12 | Input recording + golden-seed determinism tests in CI (INV-8) | M | `done` | | `tests/sim/determinism.test.ts` | `auto` — 18 tests, including a recorded match replayed into identical per-step hashes | A match is `(seed, setup, inputs)` and nothing else, which buys replays, resume-from-a-triple, headless balance batches, and the P2P desync check from one mechanism. Recording is run-length encoded because held input is the common case: two seconds of sprint is 120 identical frames, and 600 held steps compress to a single run under 100 bytes. Entities are recorded in ascending id order regardless of map order, so two runs of a match produce byte-identical recordings. State hashes are FNV-1a over values **quantised to a millimetre** — hashing raw floats would fail on differences no player could see and no bug caused, so quantising is what makes the hash a behavioural check rather than a floating-point one. |
| T-1.13 | Perf harness: fps/frame-time/entity overlay + CI budget check on a headless benchmark | M | `done` | | `tests/unit/engine/perf.test.ts` | `auto` — benchmark run: 23 entities, sim step p95 **0.025 ms** against a 4 ms budget | Percentiles, not averages: a match that averages 60 fps and stutters twice a second is a bad match, and a mean hides exactly that — so p95 is what `12` §6 budgets and p95 is what this reports, alongside a jank ratio. The monitor writes into pre-sized ring buffers and sorts into a reusable scratch array, because a performance monitor that allocates is measuring itself. The CI benchmark is deliberately headless and sim-only: render time depends on whatever GPU the runner has, and a budget that changes with the runner is a flaky test rather than a budget. A discarded warm-up pass keeps the first hundred steps (which measure the JIT) out of the number. |

### Phase 2 — Basketball · Live

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-2.1 | Court geometry, zones, arc, key, hoop, boundaries | M | `done` | | `tests/unit/sports/basketball/{court,court-render}.test.ts` | `auto` | FIBA dimensions in metres (28 × 15), origin at a corner, `goals[side]` is the basket that side *defends* — same convention as the seam. The three-point test is deliberately two rules, not one: beyond the arc **or** outside the straight corner lines, because a distance-only test scores the corner three as a two. World bounds equal court bounds, so an inbounder stands on the line rather than a metre behind it; nothing in the rules depends on that metre. `court-render.ts` draws the line art from the same constants, and its test asserts the arc's radius and sweep match the rules' — the one piece of art with a derived shape. |
| T-2.2 | Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts | L | `done` | | `tests/unit/sports/basketball/rules.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | Clock compression is 4× — a three-real-minute quarter showing 12:00 (`06` §3.1) — and it is *derived* from the two quarter figures rather than authored, so the pair can never disagree. Every duration is written in game seconds, the number on the HUD, and converted to steps in one place. The shot clock is therefore 24 on screen and six real seconds in the hand, which gives ~23 possessions a quarter. Two bugs found in the first headless run: the five-second inbound count was running while the inbounder was still sprinting the length of the court (it now starts when they *have* the ball, which is the real rule), and the setup counter was not reset on a new restart, so violations cascaded. Simplification: every restart gives a fresh 24, where the real rules sometimes keep the remaining clock. Fouls, free throws, and the bonus are T-2.7 — the state shape has room for them. |
| T-2.3 | Shooting: hold-release meter, arc trajectory, make probability from ratings × distance × pressure × release | L | `done` | | `tests/unit/sports/basketball/shooting.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | The outcome is decided at release and the trajectory is then aimed to match — dead at the rim for a make, deliberately off it for a miss. Letting collision decide would make the make rate a property of the physics tuning rather than of the athlete, which is the one thing `06` §3.1 rules out. The model is multiplicative, so a smothered elite shooter is still a bad shot; each of the seven terms `06` §3.1 names has a test that moves only that term. Difficulty enters through exactly one number — `timingAssist`, which scales the *player's* release window — and never appears in the probability model (INV-1). Player and CPU share the meter; the CPU's release is a seeded target hold. **Feel note:** untested by hand — the meter has no HUD until T-2.10, so the timing is currently a number rather than a feeling. Headless, a game runs 75–52 on ~135 shots at ~46%, which is the right shape and the wrong shot chart: nearly everything is at the rim because shot selection is still a placeholder (T-2.8). |
| T-2.4 | Passing: aimed, lead passes, interceptions, turnovers | M | `done` | | `tests/unit/sports/basketball/passing.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | Unlike a shot, a pass is *flown* rather than resolved at release: whether it arrives depends on where five defenders happen to be while it is in the air, so interceptions fall out of proximity — which is also what makes jumping a lane something a player can do rather than a die the sim rolls for them. The lead is solved in two iterations, because one uses the receiver's current position and is wrong exactly when the lead matters. Two bugs found headless: a defender draped over the passer was inside catching range the instant the ball left the hand (there is now a six-step delay — taking it out of someone's hands is a *steal*, T-2.7), and a pass spends ten-odd steps inside a defender's reach, so each defender now gets one read per pass rather than ten. Interceptions went from 37% of passes to ~5%. Difficulty's only lever is the pass-assist cone width (INV-1). |
| T-2.5 | Dribbling & driving: handling control, contact absorption, blow-by | L | `done` | | `tests/unit/sports/basketball/dribbling.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | All three costs are per-*step* draws, because a drive is two seconds of sustained pressure rather than an event — the model has to be able to say "he lost it halfway in". That makes the fumble chance a number that looks tiny and, times the three hundred steps of a possession, quietly decides how often anyone keeps the ball; the test asserts the compounded rate, not the per-step one. Bug found headless: contact was resolving on every step two bodies leaned on each other — 2 197 collisions a game — and now resolves on the step they meet, giving ~113. Contact reports a `severity` for T-2.7's foul model and decides no whistle itself. Blow-by is one attempt per defender per possession, so a drive is a move rather than a dice tower. |
| T-2.6 | Rebounding: height/vertical/strength/box-out/timing contest | M | `done` | | `tests/unit/sports/basketball/rebounding.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | A weighted draw, not a highest-score contest: taking the best score would mean the same five athletes rebound in the same order every time and a possession would be readable from the box score before the shot went up. Skill enters the draw squared — linear, an elite rebounder beats a guard only 60/40 with everything else equal, which does not read as elite. Better rebounders get a *narrower* timing spread rather than a bonus, which is the difference between good and lucky. **Known imbalance:** the offensive rebound share is around half, because nobody boxes out yet — the defence has no reason to put a body between shooter and rim until T-2.7, so the team driving the basket is simply nearer the ball. The contest is right; the positioning is T-2.7's and the balance is T-2.13's. Also fixed here: a restart reset the shot clock without saying so, which would have left the HUD showing the old count. |
| T-2.7 | Defence: marking, contest, steal, block, foul model, free throws | L | `done` | | `tests/unit/sports/basketball/defence.test.ts`, `tests/unit/sports/basketball/rules.test.ts` (fouls, free throws), `tests/integration/sports/basketball-match.test.ts` | `auto` | Every defensive action carries a foul risk, and that is the design: a steal that could only succeed or fail would be free to spam, one that can also concede two shots is a decision. Ball before whistle, always — a defender who gets it cleanly has not fouled, however fast they arrived. Three bugs and one model error found headless: **(1)** the first free throw of the first game was never taken, because `arrive` with a tight slowing radius cannot decelerate a sprinting athlete in time and they orbit the spot for ever; **(2)** a first guess of `baseFoul: 0.3` produced fifty fouls and ten disqualifications in one game — every athlete on the floor fouled out; **(3)** the CPU block rate gave thirteen blocks a game, two or three times a real one, because a shot hangs half a second and every step was another chance; and **(4)** contest was computed from the nearest opponent regardless of *direction*, so a defender standing behind the shooter contested as hard as one in the shot line, and tight man defence dropped the whole floor to 25% — it is now weighted by alignment with the basket. The release meter also came down from 30 steps to 22, because at half a second the defence closed between the decision to shoot and the shot. A game now runs 62–43 with 25 fouls, 8 blocks, 29/36 from the line, and 34% from the field. **Feel note:** still nothing played by hand — no HUD until T-2.10. 34% is low and the shot chart is still rim-heavy; both are shot selection, which is T-2.8's, and the numbers are T-2.13's. Zone defence is deferred to T-2.8 with scheme selection. |
| T-2.8 | Baseline CPU: role-based offence (spacing, cuts, screens), man defence, possession decisions | XL | `done` | | `tests/unit/sports/basketball/cpu.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | Decisions are **expected points**, not thresholds. "Shoot if open and close" has to be re-tuned for every change to the shooting model; "shoot if this is worth more than what the possession is otherwise worth" re-tunes itself — and it is the only formulation that takes the corner three, because a 36% three beats a 40% two and no distance-and-openness rule will ever say so. Four things found by running it: **(1)** with five athletes properly spaced somebody always looks marginally better, so at a low pass margin the offence ping-ponged — 1 264 passes and 167 turnovers in one game; the margin plus a settle delay on the receiver cut it to ~170. **(2)** The shot bar was first set at league-average efficiency (1.06), which means only above-average shots are ever taken — arithmetically impossible, and it produced 61 attempts instead of 160. It is now the *continuation* value (0.85): declining a shot costs clock and risks a turnover, so what is left is worth less than the possession was. **(3)** The CPU valued every shot as if set and then took it on the move, which filled the shot chart with mid-range pull-ups; it now values the movement state it is actually in. **(4)** A 2-3 zone with its top pair inside the arc lost 104–32 — it now sits outside the arc and closes out on the ball, which brought it to 49–83. A game runs ~132 points on 133 attempts at 37%, 76 rebounds split 25/51, 8 blocks, and a real shot chart (36 threes, 43 mid, 54 inside). **Feel note:** still unplayed by hand; no HUD until T-2.10. The remaining scheme gap — zone still loses to man by more than it should — is T-2.13's, along with the low team scores. |
| T-2.9 | Control switching: auto on turnover, manual cycle, controlled-athlete indicator | M | `done` | | `tests/unit/sports/basketball/control.test.ts`, `tests/integration/sports/basketball-match.test.ts` | `auto` | Hysteresis is the whole feature: without a margin, two athletes a hand's breadth apart trade control every few frames and the player's thumb is attached to nobody. Auto-switch is modelled as an *assist* (`06` §2 lists it beside aim and pass assist, tunable on its own), not as a difficulty setting — so with it off the player keeps whoever they picked and cycles by hand, and the only thing that overrides that is their athlete leaving the floor. The switch is published as a `SportEvent` rather than only written to state, because the HUD has to flash the indicator on it and neither it nor the audio layer can poll a field without guessing when it changed. **The indicator itself is deferred to T-2.10** — it is a HUD element and there is no HUD. |
| T-2.10 | Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators | M | `done` | | `tests/unit/modes/live/{box-score,hud}.test.ts`, `tests/integration/modes/live-match.test.ts`, `tests/e2e/live-match.spec.ts` | `auto` + a real browser (Playwright: the canvas paints, the frame changes between samples, the loop advances) | Built the Live mode host first, because there wasn't one — `03` never gave it a task, it is implied by this one. Two seam decisions came out of it. The sport now publishes a `SportStatus` ("action clock", not "shot clock"): a HUD reading `state.rules.shotClock` would carry basketball's field names into shared UI and break the no-sport-branching rule the moment a second sport arrived. And the sport's `score` event is a *request* while the match clock's is the record — emitting both counted every basket twice, and two sources of a scoreline is how a HUD and a summary end up disagreeing. Assists are inferred in the box score rather than emitted by the sport, so every sport with the concept gets it free. The HUD layout is a pure function of viewport and insets, which is the only way a notch is testable without a device. **Not delegated after all** — `03` marks it `sonnet`, but the host underneath it is the sport-module seam, which `CLAUDE.md` §7.2 says never to delegate, and the HUD is thin once the host exists. T-2.12 was delegated instead. |
| T-2.11 | Pause menu, quit, in-match settings, post-match summary with box score | M | `done` | | `tests/unit/modes/live/screen.test.ts`, `tests/e2e/live-match.spec.ts` | `auto` + a real browser (pause opens on Escape, resume closes it, quit leaves and stops the loop, and axe finds no WCAG A/AA violations on the paused screen) | Lives in the same file as the HUD wiring, because the pause menu, the summary, and the HUD are three views of one running match and what they share is its lifecycle — when to stop the loop, when to release held input. A lifecycle with three owners has none. The box score is a real `<table>` with `scope` on every header, so "shows the box score" and "a screen reader can read the box score" are the same claim. Backgrounding the tab pauses, and pausing releases held input — a joystick still held when the menu opens would keep steering an athlete nobody is watching. **In-match settings are deliberately two:** handedness and sound, both of which take effect the instant they are toggled. The assist strengths `06` §2 lists need the settings store and difficulty seam that arrive in Phase 7; a toggle that quietly does nothing is worse than no toggle. Bug found in testing: a checkbox nested inside its own label has ambiguous activation, so the settings use a `for`/`id` pair instead. |
| T-2.12 | Basketball art & audio pass | L | `done` | | `tests/unit/sports/basketball/{art,court-render}.test.ts`, `tests/unit/modes/live/audio.test.ts`, `tests/e2e/live-match.spec.ts` | `auto` + a real browser (the canvas paints and the frame changes between samples) | **Delegated to `sonnet`** — see the delegation log. Palette hex is mirrored from `10` §3.1's tokens with the token name commented beside each value, because a canvas paints pixels and cannot cascade a custom property; `art.test.ts` is the tripwire for the two drifting apart. Colour is never the only signal (`10` §11): the teams differ by kit stripe as well as hue, and at MINIMAL detail by *shape* — one circle, one diamond — so team identity survives the LOD that throws detail away. The controlled marker is a stroked ring at every tier, because "which one is mine" is not decoration. Audio is entirely synthesised — oscillators and gain envelopes, no files — which keeps it inside the no-network rule (INV-14) with no licensing story; the `AudioContext` is never constructed at import time, since browsers refuse one before a user gesture, so the screen builds it on the first tap. A `null` context and `muted` are both first-class no-ops rather than a volume of zero. The main session wired the art into the match screen (replacing duplicated inline drawing) and the audio to the event bus, the sound setting, and the pause state. **One agent judgement worth knowing:** there is no "shot missed" event, so the rim-miss cue triggers on `rebound`, which is only reachable from the missed-shot path; documented in `audio.ts` rather than papered over. |
| T-2.13 | Balance pass #1: shooting percentages and pace plausible over 500 headless games | M | `done` | | `tools/balance.ts` (`pnpm balance`), plus the retuned unit tests | `auto` — 500 matches, all 14 bands inside plausible basketball | A **tool, not a test**: five hundred matches is six minutes of CPU, and a suite that takes minutes is a suite people stop running. Bands, not exact numbers — pinning a number pins the seed, and the next upstream draw turns it red for nothing. The run found three real bugs and one mis-calibration. **(1)** `Rng.int` is half-open, so `int(0, 1)` is the constant zero — and it was used as a coin flip in three places, which gave the home side *every* opening tip and *every* zone in five hundred games. Now `bool()`. **(2)** Loose balls and contested passes went to the first eligible athlete in entity order, and entity order is team order: the home side won every simultaneous scramble. Now nearest. **(3)** Once man marking existed, every receiver had a defender beside them, so 19% of all passes were intercepted and half the rest deflected; a defender's reach and control are now much smaller than a receiver's. **(4)** The shooting constants were authored for "clean, set, perfect release" and never checked against what a *typical* shot looks like after the penalty stack — 30% from the field against a real game's 46%. Final: 75.5 points, 78.7 attempts, 44.5% eFG, 30.7% from three on a 52% three-rate, 45.6 rebounds, 21.8 turnovers, 11.8 fouls, home win rate 44.2%. **Two known residuals, both recorded rather than hidden:** the offensive-rebound share sits at 44%, at the top of its band, because box-out positioning is still weak; and the away side wins 55.8% (n=500, ≈2.6σ), a real but small structural edge I could not localise — T-7.10's win-rate verification is the right place to finish it. |

### Phase 3 — Athletes, cross-sport ratings, roster

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-3.1 | Athlete schema, IndexedDB store, indexes, repository | M | `done` | | `tests/unit/athletes/types.test.ts`, `tests/integration/storage/athletes.test.ts` | `auto` — repository exercised against real IndexedDB | Schema written against `05` §2 field for field; bounds live beside it, the creation *budget* does not (that is T-3.2's, in `tuning.ts`). **Bug found:** the `athletes` store's `byName` index from T-0.11 pointed at `name`, a property no athlete has, so it indexed nothing — the roster browser would have sorted on an empty index. Now `byDisplayName`. IndexedDB has no "alter index", so `openDatabase` now reconciles: creates what is missing, drops what is undeclared, rebuilds a changed key path. `DB_VERSION` 1 → 2; no entry in the *data* chain, since an index is derived and a backup carries none. Search normalises accents, so `ibrahimovic` finds `Ibrahimović`. |
| T-3.2 | Attribute system: the eleven attributes, budget rules, sandbox flag, random roll | M | `done` | | `tests/unit/athletes/attributes.test.ts`, `tests/unit/athletes/create.test.ts` | `auto` — roll checked as a property across all five rarities | `tuning.ts` holds every `05` number so a balance pass never touches logic. Sandbox is a *flag, not a refusal*: `judgeCreation` returns the reason and points at Settings, because `05` §2.1 is explicit that the make-Messi fantasy stays available. The roll draws each attribute around the band average and then settles to the exact total; the settle step picks its ±1 targets from the RNG rather than walking in order, because "first attribute with room" is a systematic bias toward `speed` — the same shape as an id-order tie-break. There is a test for it. `fitToBudget` scales only the headroom above the floor, so a shooter stays a shooter. `createAthlete` clamps rather than throws and omits absent optionals entirely (`exactOptionalPropertyTypes`, and an `undefined` value is a real IndexedDB key). |
| T-3.3 | Derivation engine: weight matrix, physical modifiers, unit-tested invariants | L | `done` | | `tests/unit/athletes/derivation.test.ts` | `auto` — hand-checked against `05` §3.1 plus properties over 500 random cases | No `if (sport === …)` anywhere: every sport-specific number arrives as a table from the sport module, so a new sport is a new table rather than an edit. The seam gained `physicalModifiers` and `positionWeights` (both optional). **Two judgement calls, both recorded in the decisions table below:** `05` §3.4 gives the position-fit *formula* but no position-weight table, so basketball's is new; and `05` §3.2 gives soccer's weights but no physical modifiers, so soccer's are read off §2.1's prose at half basketball's magnitude. **`src/sports/soccer/weights.ts` exists before Phase 6's soccer module, deliberately** — data only, no `SportModule`. T-3.9 has nothing to compare against otherwise, and a derivation engine tested against one table is one written for that table; soccer's twelve differently-shaped rows are what prove it generic. Properties asserted: monotonic in every weighted attribute, always integer 1–99, never above the athlete's own ceiling, projections through identical arithmetic. |
| T-3.4 | Familiarity model: per-sport familiarity, penalty curve, growth from minutes | L | `done` | | `tests/unit/athletes/familiarity.test.ts` | `auto` — `05` §3.3's stated pace asserted, not assumed | The penalty curve was already in `derivation.ts` (`familiarityMultiplier`); T-3.4 is the growth half. **`minutes` means *real* minutes, not game-clock minutes** — `05` §3.3's formula and its own claim of "~15 matches to competent, ~50 to the cap" only agree under that reading; read as game minutes the same formula gets there in three. `learningMinutes()` is the one place the two units meet, so the box score keeps showing game minutes. There is a test for both readings. Growth is pure and returns the change alongside the new record, so the post-match screen shows exactly what was stored. Bands are words, not colours (CLAUDE.md §8.11). |
| T-3.5 | Sport skill XP: levels, sub-skills, event-driven awards, diminishing returns | L | `done` | | `tests/unit/athletes/xp.test.ts`, `tests/unit/athletes/progression.test.ts` | `auto` | The sport owns the event→sub-skill table (`xpAwards` on the seam) — only basketball knows a shot from `cornerThree` is a three, and the athlete layer must never learn it. **Diminishing returns come from two places doing different jobs:** the level curve (`100 × level^1.6`, so level 19 costs ~100× level 1) and a within-session decay on repeated identical actions, so forty threes is not forty threes' worth. Without the second, farming one action would be the fastest route to a maxed sub-skill. Attempts pay less than makes but *not nothing* — an athlete paid only for makes learns fastest by never taking a hard shot. `xpFor(level)` read as the cost to leave a level, not a cumulative total (decision below). `minutesPlayed` is banked by familiarity **only**; `applySession` deliberately does not touch it, and `progression.ts` composes the two — a double-count there would surface fifty matches later. `progression.applyMatch` is the single door every mode uses; T-4.10's reduced arcade rate is a `rate` scalar, not a branch (INV: `05` §8.5). |
| T-3.6 | Behavioural coupling: familiarity → decision noise, control error, reaction penalty in-sim | M | `done` | | `tests/unit/athletes/coupling.test.ts`, `tests/integration/sports/basketball-coupling.test.ts` | `auto` + `pnpm balance` (500 games, 14 bands) | `05` §3.3's claim is behavioural, so it is tested behaviourally: four seeded matches with one side made novice and the other at home, **identical ratings on both**, asserting more turnovers, fewer completed passes, and fewer points. Four coupling points in the sim: decision noise on how a look is valued, degraded first touch on catches and intercepts, a slower per-step reaction on the pass decision, and a wider release-timing scatter. **The design constraint that shaped all of it: an at-home athlete must cost zero random draws.** Coupling fades to exactly nothing at 75 familiarity — below every athlete's own-sport 85 — so no call site draws for it, and the PRNG stream is byte-identical to before T-3.6 existed. There is a test asserting a coupled-at-100 match serialises identically to an uncoupled one; without that property every golden-seed determinism test would have broken for no behaviour change. This is **not** difficulty (CLAUDE.md §8.6): no attribute and no derived rating is touched. The map is empty until T-3.17 fills it. `pnpm balance` re-run after the change: all 14 bands pass, 75.5 points on 78.7 attempts at 36.5%, home win rate 44.2% — unchanged from T-2.13's run, which is the expected result and the point of the zero-draw property. |
| T-3.7 | Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale | L | `done` | | `tests/unit/ui/athlete-editor.test.ts`, `tests/unit/athletes/{portrait,presets}.test.ts` | `auto` — diff reviewed against the spec, not against the agent's summary | **Delegated to `sonnet`** (CLAUDE.md §7.1); the agent owned an explicit file list, was told not to commit, and this session reviewed and committed. What worked: settling every interface first and pushing it, so the agent called `budgetState`/`judgeCreation`/`createAthlete` rather than reinventing the budget. Over-budget is a *conversation, not a block* — `judgeCreation`'s reason plus a "turn on Sandbox mode and save" action, per `05` §2.1. Photos are downscaled to a 512 px edge locally and never uploaded; the blob is produced but not yet persisted (`TODO(T-3.16)` — no blob store exists yet). **Two review findings:** the agent's first draft duplicated `explain.ts`'s label humaniser with its own table (it was briefed before `explain.ts` existed) — now sourced from `attributeLabels()`; and it correctly reported that the only failing tests were *this session's* fault, a missing `Purpose:`/`@story` in `athlete-card.css`. Verified independently rather than taken on trust. |
| T-3.8 | Athlete card component: compact + full, sport switcher, familiarity ring, "why this rating" | L | `done` | | `tests/unit/ui/athlete-card.test.ts`, `tests/unit/ui/athlete-screen.test.ts`, `tests/unit/athletes/explain.test.ts` | `auto` — asserted on what the card *says*, not how it is laid out | The card computes no rating: it is handed derivation's output and the explanation beside it, so what a player reads and what the sim uses cannot drift. Sentences live in `athletes/explain.ts`, because a string built in a component is a string with no test — and under `10` §11 they are load-bearing, being the non-colour channel for every meter. The "why" is a `<details>`, so it is keyboard-operable and announced with no JavaScript of ours. `sports/catalogue.ts` separates **rateable** from **playable**: the sport switcher needs two rating tables, not two playable sports, and the card says which rather than implying soccer is a real matchup. **Two bugs found:** the familiarity ring computed its own rank in even fifths while `05` §3.3's bands are uneven, so the ring could read "Natural" beside text reading "Comfortable"; and several explanation strings said "1 points". Also added a router test — `/squad/athlete/new` and `/squad/athlete/:id` are both three segments, and if specificity ever stopped preferring the literal, creating an athlete would silently become "No such athlete". |
| T-3.9 | Cross-sport compare view with projections for unplayed sports | M | `done` | | `tests/unit/ui/athlete-compare.test.ts` | `auto` | Each row shows **two** numbers — what the athlete rates today and what they would rate once they knew the sport — because showing only one would either flatter every athlete or bury the feature. The projection is `derivation.ts`'s own arithmetic with familiarity pinned at the cap, not a separate estimate; a test asserts they agree, since a compare view disagreeing with the sim would be lying about a number the sim is about to use. Rows rank on **potential**, not on today's number: ranking on current sorts by which sport happens to have been played, which is a fact about the save file rather than about the athlete. Adds "about N matches to close it" from T-3.4's `matchesToReach`. |
| T-3.10 | Roster browser: search, sort, filter, bulk select | M | `done` | | `tests/unit/athletes/roster-query.test.ts`, `tests/unit/ui/roster.test.ts`, `tests/invariants/layering.test.ts` | `auto` — diff reviewed against the spec, not the agent's summary | **Delegated to `sonnet`.** Query logic is pure and DOM-free, so the edge cases are testable without a screen: sorting is **total** rather than relying on `Array.prototype.sort`'s stability (an engine detail, not a contract), rarity orders by `RARITIES`' declared sequence rather than alphabetically, an unrecognised filter value matches nothing rather than everything, and "sort by rating" falls back to each athlete's *own* primary sport rather than ranking everyone through one table. Bulk delete gets both things US-5.5 asks for and that are easy to skip: a confirming dialog and an undo, which is why `deleteMany` returns the records rather than a count. **Architectural fix found in review:** the agent reused `cardOverall` from the athlete *card* as instructed, which made `src/athletes/` depend on `src/ui/` — backwards. The arithmetic moved to `derivation.sportOverall()` and the card now imports it. Guarded by a new `tests/invariants/layering.test.ts`, because the failure is invisible until something headless (a balance run, a migration) drags a DOM module into a context with no DOM. |
| T-3.11 | Teams: create/edit, name, colours, generic crests | M | `done` | | `tests/integration/storage/teams.test.ts`, `tests/unit/ui/{crest,teams}.test.ts` | `auto` — diff reviewed against the spec, not the agent's summary | Data model built here first and pushed before delegating (CLAUDE.md §7.3 rule 1); screens delegated to `sonnet`. Two relational rules live in the repository rather than in callers: deleting a team deletes its squads in one transaction, and deleting an athlete strips them from every lineup — both are orphans that stay invisible until they are a bug report. Colour is never the only difference between two teams (`10` §11): a short name and one of eight crest *shapes* carry it too, and palettes ship named so the picker never asks anyone to pick "the green one". CPU teams (`editable: false`) are refused with an explanation rather than silently edited. **The agent hit the account's monthly spend limit mid-run**; it had already finished and self-verified, and this session re-ran `verify` and coverage independently rather than trusting the partial report. |
| T-3.12 | Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best | L | `done` | | `tests/unit/teams/lineup.test.ts`, `tests/unit/ui/lineup.test.ts` | `auto` | **Auto-fill is an assignment problem and the naive answer is biased.** Walking the slots in order and giving each its best remaining athlete makes the *first* position outrank every other — the same shape as tie-breaking in entity-id order. Pairings are ranked globally and taken best-first instead, with ties on athlete id; two tests assert the result is unchanged when the slot order and the candidate order are reversed. Greedy, not optimal, and deliberately: "your best player went to their best position" is what a player expects, and an optimal solver moving someone off their best spot to gain a point would read as a bug. **`03` says "drag-to-slot"; this is tap-to-place, and that is a considered deviation** — HTML5 drag does not work on touch without a polyfill and is unusable one-handed, invisible to a screen reader, and impossible by keyboard. Select-then-place works identically with a thumb, mouse, keyboard, and screen reader; every slot is a real `<button>`. Recorded in the decisions table. |
| T-3.13 | Stamina, injury, suspension, availability | M | `done` | | `tests/unit/athletes/condition.test.ts` | `auto` | US-6.3's "low stamina degrades performance visibly" is the phrase that shaped this: fatigue produces a multiplier the sim applies at the point of use, in the same shape as T-3.6's coupling, and — like that one — it is **exactly 1.0 above the threshold**, so a fresh athlete costs the sim nothing and the PRNG stream is untouched for anyone who is not actually tired. It degrades to a floor rather than to zero: a player who cannot substitute must still be able to finish the match. Neither attributes nor derived ratings are modified, so CLAUDE.md §8.6 holds and the card still shows who they are when rested. Injuries are deliberately **rare** and likelier when tired — which is what makes a substitution a decision — because an injury system that fires often turns a game about playing into a game about squad admin. `05` gives the `condition` fields but no rates, so every number is this task's, in `tuning.ts`. |
| T-3.14 | Starter roster: generated fictional athletes, enough for both sports | M | `done` | | `tests/unit/athletes/starter-roster.test.ts`, `tests/integration/storage/app-db.test.ts` | `auto` — name pools spot-checked by hand for real athletes | **Delegated to `haiku`** (bulk content against a fixed schema, CLAUDE.md §7.1). 38 athletes from a seeded roll: two basketball fives, two soccer elevens, and spares, with position-coherent bodies and no legendaries — a fresh install should not hand out a franchise athlete. Names combine 187 given names and 280 surnames of many origins; verified by hand that the pools are ordinary names rather than real athletes. **Seeding is an install step, not a side effect of opening the database** — folding it into `appDatabase()` handed 38 athletes to every test and every headless caller, and thirteen tests said so within a minute. It now runs from app bootstrap after first paint, guarded by a `meta` flag rather than by "is the roster empty", because a player who deleted everyone made a decision and handing them back 38 strangers would undo it. |
| T-3.15 | Roster import: file + URL, schema validation, per-record errors, merge/conflict, responsibility notice | L | `done` | | `tests/unit/athletes/roster-import.test.ts`, `tests/unit/ui/roster-import.test.ts` | `auto` — diff reviewed against `05` §8 | **Delegated to `sonnet`.** `05` §8 followed exactly: unknown fields dropped, out-of-range values clamped **with a per-record warning**, and a bad record never aborting the file — that last one is the whole point of the section and is tested explicitly. A `formatVersion` from the future is rejected outright rather than partially applied, the same principle as `05` §9 rule 4. Conflicts are flagged on duplicate `custodyId` *or* matching name + primary sport, and default to skip so nothing is silently overwritten. The URL fetch is the one permitted exception to CLAUDE.md §8.2's no-network rule — user-initiated, and commented with the citation. **Agent judgement call, accepted:** the wire schema names four sports where the catalogue rates two, so it validates against the documented four; a `hockey` file imports cleanly and simply is not playable yet, which is the same rateable/playable split `catalogue.ts` already draws. |
| T-3.16 | Roster and full-backup export/import with version checks and change preview | M | `done` | | `tests/integration/storage/backup.test.ts`, `tests/unit/ui/backup.test.ts` | `auto` | **The preview is the dry run of the restore, not a second implementation** — `restoreBackup` calls `previewBackup` and returns it, and a test asserts the two agree. A preview that said one thing while the restore did another would be the worst possible bug in a data-safety feature. A backup from a newer build is refused whole (`05` §9 rule 4) before a single record is written, and every parse failure is a *value* rather than an exception: this is the one screen where an unhandled throw leaves someone staring at a broken page holding the only copy of their data. Merge is the default because it is the recoverable mistake — a merge meant as a replace leaves extra athletes; a replace meant as a merge loses them. Reachable from Settings → Data & backup. |
| T-3.17 | Wire real athletes into basketball Live — lineups drive the sim | M | `done` | | `tests/integration/sports/basketball-rosters.test.ts` | `auto` + `pnpm balance` (500 games, 14 bands) | **Phase 2's biggest loose end, closed.** `rollRatings()` is no longer the main path: a match given a lineup reads real derived ratings, real movement from `courtSpeed`, real familiarity coupling, and real fatigue. The headline test is the one that matters — two squads with *identical attributes and bodies*, differing only in which sport they know, and the basketball side wins. A soccer squad that has learned basketball closes the gap. **The seeded fallback stays, deliberately**: a rosterless match is byte-identical to the pre-T-3.17 one, which is why the 500-game balance harness returns exactly the T-2.13 numbers and every golden-seed test is untouched. Real rosters are an input, not a prerequisite — a rules test should not have to build ten athletes to check the shot clock. `MatchSetup` gained `rosters?`, which closes a type-only import cycle with `athletes/types.ts`; both directions are erased at build, and the alternative was pretending a match is played by something other than athletes. Five of the fourteen numbers (`composure`, `agility`, `strength`, `vertical`, `discipline`) are attributes read as themselves and **not** gated by familiarity — a novice does not get weaker or shorter, they get worse at basketball. |

### Phase 4 — Arcade framework + basketball arcade set

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-4.1 | Arcade framework: `ArcadeGameDef`, host, session lifecycle, scoring, star ratings | L | `done` | | `tests/unit/modes/arcade/{session,scoring,registry}.test.ts` | `auto` | **The split that decides everything downstream: a game owns a *mechanic*, the framework owns the run.** Lives, clock, score, streaks, stars, and event collection live in `ArcadeRun` once, because five games owning them five times is five places for the rules of a scored run to drift — and `09` §3.3 describes one structure for every game. A game reports `host.attempt({made, points, quality, label, events})` and never reads the score, so it cannot invent its own scoring. `ArcadeRun` is headless: no canvas, no DOM, stepped by a caller-supplied `dt`, which is what lets T-4.11 run several in turn and T-4.13 drive hundreds with synthetic input. Events carry no mode field and are stamped by the framework, so an arcade `score` is indistinguishable from a Live one (INV-9). The seam gained `SportModule.arcade?`, optional for the same reason `playbook` will be. `src/achievements/ids.ts` declares the ten unlock ids from `09` §3.2 — the vocabulary Phase 8 will evaluate against; all ten are earned by playing. |
| T-4.2 | Calibration: ratings + familiarity → window sizes and speeds (INV-10) | M | `done` | | `tests/unit/modes/arcade/calibration.test.ts`, `tests/invariants/inv-10-arcade-calibration.test.ts` | `auto` | **INV-10 is a signature, not a convention.** `calibrate(athlete, difficulty)` has no parameter through which a personal best could arrive, and the invariant test asserts that three ways: behaviourally (identical inputs, identical window, forever), structurally (the module imports nothing matching `storage|bests|history|session`), and textually (no `calibrate()` anywhere in `src/` takes a third argument). Six interpolated pairs turn a rating into `09` §2.4's two poles — "wide, slow, forgiving" against "narrow, fast, drifting" — and a game may reshape them without changing their direction. **Difficulty enters exactly once, at the end, on the window and the reaction allowance only** (INV-1); the rating that goes in is the rating the athlete card shows, on every level. `src/modes/difficulty.ts` is new: `06` §7's table read straight across, with no field a rating could be multiplied by, so INV-1 holds by the shape of the record before a test looks at it. T-7.7 owns the full model and will extend it. The picker's hint names *both* halves — "Narrow window — new to this sport." — because narrow without the reason reads as a punishment rather than as the thing practice fixes. |
| T-4.3 | Arcade hub: grid, locked/unlocked states, personal bests, athlete picker with window hint | M | `todo` | | | | |
| T-4.4 | Practice / scored / daily modes; seeded daily challenge | M | `done` | | `tests/unit/modes/arcade/{modes,daily}.test.ts`, `tests/integration/storage/arcade-records.test.ts` | `auto` — codes round-tripped, day boundary asserted in UTC | **Modifiers are applied outside `calibrate()`, deliberately.** A modifier is a fact about today's scenario — the same for everyone — while a calibration is a fact about the athlete; folding them together would widen INV-10's signature to admit something that is not the athlete, and the next thing through that door is a personal best. So `startRun()` calibrates first and applies the day's twists on top, and it is the one door every arcade entry point uses. **The daily rolls its own athlete.** "Identical for everyone" and "played with your own squad" cannot both be true and US-16.4 picks the first, so the day's seed rolls a `rare` athlete in the game's own sport: everyone plays the same person, and the challenge measures the run rather than the collection. **The day boundary is UTC** — a local one means two players disagree about which challenge is today's, and a code shared across a timezone resolves to a different run at each end; the screen will say so rather than implying it follows your clock. Challenge codes are Crockford base32 (no `I`/`L`/`O`/`U`) with a two-character checksum, so a mistyped code fails immediately instead of starting the wrong run; the format is versioned (`SG1`) so T-10.1 can extend the payload without invalidating codes already in someone's messages. New `arcade` IndexedDB store, `DB_VERSION` 2 → 3 — a *new* store, so structural only and no entry in the data chain, same as T-3.1's index fix. Backups pick it up with no change, since `backup.ts` walks `STORES`. |
| T-4.5 | Free Throw — release timing under mounting pressure | M | `done` | | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts`, `tests/unit/modes/arcade/meter.test.ts`, `tests/sim/arcade-calibration.test.ts` | `auto` — score profiles measured across four athlete tiers with a human-like driver | **The pressure ramp speeds the meter and narrows nothing.** The band stays exactly as wide as the athlete earned, *in seconds*; the marker crossing it faster is what turns a comfortable window into a nervy one. Narrowing the band as you succeed would be difficulty reacting to your scores, which is the thing INV-10 forbids. **Two bugs the tests found, both real.** First, a lives-only game never ends for a player who simply does not shoot — hence the five-second shot clock, which is also the rulebook's own answer. Second, and much worse: a run bounded by *time* hands a novice more attempts, because a novice's meter is faster. Measured, an attribute-35 athlete outscored an attribute-92 one at Fast Break — the fairness rule running exactly backwards. Every game is now a fixed count of attempts, so the athlete's speed decides how hard each one is and never how many you get. |
| T-4.6 | Three-Point Contest — five racks, rhythm and timing, 60 s | M | `done` | | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts`, `tests/sim/arcade-calibration.test.ts` | `auto` — score profiles measured across four athlete tiers with a human-like driver | Rhythm is the second skill, and it keys on the *variance* between releases rather than on how short they are — so a steady slow tempo pays and mashing does not. The money ball is the last ball of each rack, worth two, and it is the only reason the rhythm bonus has a decision in it: taking the extra half-second breaks the tempo. The contest is the one game with no lives — twenty-five balls and a clock — because ending a sixty-second contest on a miss would make the clock meaningless. Its fixed ball count is also why it was the *only* game already immune to the attempts-inflation bug T-4.5's note describes. |
| T-4.7 | Buzzer Beater — contested shot, shrinking window | M | `done` | | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts`, `tests/sim/arcade-calibration.test.ts` | `auto` — score profiles measured across four athlete tiers with a human-like driver | The window shrinks **within** a possession and never between them: every possession opens at the full width the athlete earned and closes as the defender's hand rises. The pressure is therefore the clock inside the moment rather than the scoreboard outside it, which is what keeps it clear of INV-10. Points ramp steeply with lateness, so the whole game is one trade made fifteen times. Getting blocked (a release outside the band) costs a life; a contested shot that rimmed out does not — `09` §2.4 splits input from athlete, and lives measure the input. |
| T-4.8 | Fast Break — finish past a recovering defender | M | `done` | | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts`, `tests/sim/arcade-calibration.test.ts` | `auto` — score profiles measured across four athlete tiers with a human-like driver | The one game where the meter reads as a *place* rather than a moment: the marker is the athlete running at the rim, the band is where the layup is on, and the recovering defender shuts its late edge. Same arithmetic as the other three, different reading — and the reading is what makes `courtSpeed` matter, since a quicker athlete arrives with more of the window still open. A dunk needs a clean look *and* a clean release; an and-one needs the defender genuinely on you, which is the reason to hold. |
| T-4.9 | Pickpocket — reaction test, jump the lane without fouling | M | `done` | | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts`, `tests/sim/arcade-calibration.test.ts` | `auto` — score profiles measured across four athlete tiers with a human-like driver | The only game in the set that is not a release meter, and the one that forced an honest test harness. **A fixed quarter-second tell, identical for every athlete** — a great defender does not see the pass sooner, they have longer to act on it, which is `perimeterD` setting the lane's duration. Fouling is the only thing that costs a life; letting a pass through costs the possession and nothing else, because punishing patience would teach exactly the wrong instinct for the behaviour being practised. Most of the score is the *earliness* bonus rather than the base, since everyone who reacts at all gets the ball. |
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
| 2026-07-27 | T-2.12 | `general-purpose` / `sonnet` | `src/sports/basketball/art.ts`, `src/sports/basketball/court-render.ts`, `src/modes/live/audio.ts` and their tests — nothing else | **Good.** Stayed exactly in scope, wrote resolving spec headers, and its `@design` references all check out against the specs (`06` §9, `10` §11) — verified against the documents, not against its own summary (§7.3 rule 6). It also flagged a real ambiguity rather than guessing quietly (no "shot missed" event exists; it used `rebound` and documented why). The main session reviewed the diff, ran the suite and the browser E2E, and made the commit. |

---

## Decisions taken during implementation

Small calls that didn't warrant a spec change but that a future session should know about. Anything
that changes the product goes in [`07-decisions.md`](./07-decisions.md) instead.

| Date | Task | Decision | Rationale |
|---|---|---|---|
| 2026-07-27 | T-3.4 | `minutes` in `05` §3.3's growth formula is real minutes of play, not game-clock minutes | The formula and the paragraph under it disagree otherwise. A full basketball match is 48 game minutes but twelve real ones at `06` §3.1's 4× compression; a starter plays ~8 real minutes, which lands on §3.3's own "~15 matches to competent, ~50 to approach the cap" almost exactly. Read as game minutes it is three matches to competent. `minutesPlayed` still stores game minutes, because that is what a box score means; `learningMinutes()` converts. Raised at the Gate 3 review; the alternative is to read `minutes` as game minutes and drop the 0.9 coefficient to ~0.225, which produces an identical curve with one fewer unit in play. Both were explained to the user; **left as real minutes** unless they say otherwise. |
| 2026-07-28 | T-3.6 | Behavioural coupling fades to exactly zero at 75 familiarity, not at 100 | Two reasons, one design and one mechanical. Design: a competent-but-still-learning athlete should play *cleanly and a little worse*, not clumsily — looking lost is for the genuinely lost. Mechanical: every athlete's own sport starts at 85, so a fade-out below that means an at-home athlete is coupled by nothing, every call site can skip its random draw, and the PRNG stream stays byte-identical to the pre-T-3.6 one. Drawing-and-discarding instead would have broken every golden-seed determinism test for no behaviour change. |
| 2026-07-28 | T-3.8 | `src/sports/catalogue.ts` distinguishes *rateable* from *playable* sports | `10` §6's sport switcher and T-3.9's compare view both need at least two rating tables and neither needs two playable sports. Rather than fake a soccer `SportModule` or defer the card to Phase 6, the catalogue carries a `playable` flag and the card says "not playable yet — this is a projection" instead of implying a real matchup. Phase 6 flips one boolean. |
| 2026-07-28 | T-3.12 | The lineup editor is tap-to-place, not drag-to-place, despite `03` naming the task "drag-to-slot" | HTML5 drag-and-drop does not work on touch without a polyfill, and a drag is unusable one-handed, invisible to a screen reader, and impossible with a keyboard — all four of which this game's `10` §11 commitments require. Select-then-place works identically with a thumb, a mouse, a keyboard, and a screen reader, and every slot is a real `<button>` so focus and Enter come free. Pointer dragging can be layered on later as an accelerator over the same model. Raise it if the intent was specifically the drag gesture. |
| 2026-07-28 | T-3.17 | `MatchSetup.rosters` is optional, and a rosterless match keeps the seeded fallback forever | Real rosters are an input, not a prerequisite. The 500-game balance harness has no save file, the golden-seed determinism tests replay from `(seed, setup, inputs)` alone, and a rules test checking the shot clock should not have to build ten athletes first. The fallback draws from the same `rosterRng` in the same order, so a rosterless match is byte-identical to the pre-T-3.17 one — which is why the balance bands came back unchanged. |
| 2026-07-28 | T-3.17 | `sports/types.ts` and `athletes/types.ts` now import each other, type-only | `MatchSetup` needs `Athlete`; `athletes/types.ts` needs `SportId`. Both imports are `import type` and erased at build, so there is no runtime cycle. The alternatives were worse: a sport-specific setup extension read through a cast, or pretending at the seam that a match is played by something other than athletes. |
| 2026-07-28 | — | **Clock compression confirmed as designed — no change.** Real match time, compressed by ticking the clock faster | The user asked whether "whole-number game clocks" meant what the code already does; it does. A basketball quarter shows 12:00 and takes 3 real minutes, and soccer will show genuine 45-minute halves that tick fast. Nothing was changed. Worth recording because the question is a reasonable one to ask twice. |
| 2026-07-28 | — | **User confirmed:** `xpFor(level)` is the per-level cost (T-3.5), the lineup editor stays tap-to-place (T-3.12), and the two invented tables (basketball position weights, soccer physical modifiers) stand as written | Asked at the Gate 3 review; answered directly. These are settled, not open. On tap-to-place the user added that the game is **primarily mobile, sometimes desktop**, which is exactly the case tap serves and drag does not. |
| 2026-07-28 | — | **User decision: CI stays on `main` + `workflow_dispatch` only.** CI credits are limited | Accepted, with the cost named: this is why a `DB_VERSION` bump sat broken through five E2E specs for several tasks before the gate caught it. **Mitigation, now a standing rule: run `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm e2e` locally before every gate, and after any change to storage, the service worker, or the base path.** The unit suite cannot see those failures. |
| 2026-07-28 | T-3.5 | `xpFor(level) = 100 × level^1.6` is the cost to advance *from* that level, not a cumulative total | `05` §3.3 calls it a "level threshold" without saying which. As a per-level cost it gives a round 100-XP on-ramp and a ~102× span across the twenty levels — the shape "diminishing returns" describes. As a cumulative total the span is identical but level 1 → 2 is free, which makes the first level-up meaningless. Either reading is defensible; this one is the tunable-friendlier of the two. |
| 2026-07-28 | T-3.5 | Within a session, the n-th award of one action is worth `0.93^(n-1)` of the first, floored at 0.2 | `05` §3.3 asks for diminishing returns and the level curve alone does not deliver them *within* a match: without this, the fastest route to a maxed sub-skill is to stop playing the sport and farm one action, which is the shape `05` §5.5 forbids for coins. Tuned so a varied match out-earns a farmed one; both are asserted. |
| 2026-07-27 | T-3.1 | The `athletes` store's name index is `byDisplayName` on `displayName`, and `openDatabase` now reconciles indexes | T-0.11's `byName` pointed at `name`, which no athlete has, so it indexed nothing and would have failed silently in the roster browser. IndexedDB cannot alter an index, so the fix has to be a drop-and-recreate; making the upgrade path reconcile against the spec means the next such drift is corrected rather than merely detectable. `DB_VERSION` 1 → 2, no data-chain entry — an index is derived data. |
| 2026-07-27 | T-3.3 | Basketball's position-weight table (`05` §3.4) is new, not quoted | `05` §3.4 gives the fit *formula* and the 0.85 warning threshold but no `positionWeight` table for any sport. Written to `05`'s own standard — starting values for a balance pass — and shaped so the positions differ enough that the warning means something; a centre at point guard falls well under 0.85, and there is a test asserting it. |
| 2026-07-27 | T-3.3 | Soccer's physical modifiers are read off `05` §2.1's prose, at half basketball's magnitude | `05` §3.2 gives soccer's weights but no modifier table. §2.1 says height helps goalkeeping and hurts low-centre-of-gravity agility, which in soccer is heading and goalkeeping up, dribbling down. Halved because soccer's height spread is narrower and basketball's per-cm figure would swamp the weighted sum. Revisit when Phase 6 can actually play it. |
| 2026-07-27 | T-3.3 | `src/sports/soccer/weights.ts` ships in Phase 3, ahead of Phase 6's soccer module | Data only — no `SportModule`, nothing registered. Two reasons: T-3.9 projects ratings for unplayed sports and with only basketball in the build has nothing to project *to*, and a derivation engine tested against a single table is one written for that table. Soccer's twelve differently-shaped rows are the evidence it is generic. |
| 2026-07-27 | T-2.1 | FIBA court dimensions (28 × 15 m), not NBA | The world already works in metres; FIBA's numbers are metric by definition rather than by conversion, so no constant in the file is a rounded foot. |
| 2026-07-27 | T-2.1 | World bounds equal court bounds — an inbounder stands *on* the line, not behind it | Keeps `world.clampToBounds` the whole out-of-bounds containment story for athletes. Nothing in the rules depends on that metre, and an offset coordinate space would have to be undone everywhere. |
| 2026-07-27 | T-2.2 | Clock compression is 4× (3 real minutes shown as 12:00) and derived from the two quarter figures | `06` §3.1 fixes both ends; deriving the ratio means a future tuning change to either cannot leave them inconsistent. |
| 2026-07-27 | T-2.2 | Every restart gives a fresh 24, where the real rules sometimes retain the clock | The retention cases all depend on *why* the ball went out, which needs the foul model (T-2.7). Revisit at the balance pass (T-2.13) if possessions feel long. |
| 2026-07-27 | T-2.2 | No eight-second backcourt count | At 4× clock compression it gives a ball-handler two real seconds to cover fourteen real metres — not a rule, a guaranteed turnover. It cost one team 79 of them in the first headless game. `06` §3.1 asks for the *backcourt violation*, which is the over-and-back rule, and that is implemented. |
| 2026-07-27 | T-2.3 | A shot's outcome is drawn at release; the trajectory is then aimed to match it | The alternative — fly the ball and let collision decide — makes the make rate a property of the physics tuning rather than of the athlete's ratings, which `06` §3.1 explicitly rules out. The ball still travels a real arc and a miss still caroms off a real rim. |
| 2026-07-27 | T-2.3 | Placeholder shot selection got two small tweaks it did not strictly need | Without a pull-up behaviour for perimeter roles, every possession was a drive and the three-point half of the shooting model never ran in a real match. Both tweaks are T-2.8's to replace. |
| 2026-07-27 | T-2.4 | A pass is flown and resolved by proximity; a shot is resolved at release | They fail differently. A shot's outcome depends only on the shooter's circumstances at release, so drawing it there keeps the make rate a property of the athlete. A pass's outcome depends on where the defence is *during* the flight, which cannot be known at release without simulating it. |
| 2026-07-27 | T-2.6 | The rebound is a weighted draw rather than the highest score | The best score always winning makes the same five athletes rebound in the same order every game, and a possession's outcome readable before the shot goes up. The draw keeps the better rebounder winning most of them and leaves the guard who got position his share. |
| 2026-07-27 | T-2.7 | Zone defence deferred to T-2.8 | `06` §3.1 lists man and 2-3 zone as *schemes*. A scheme is a variation on marking, and marking is what T-2.7 builds; picking between schemes is a CPU decision and belongs with the rest of them. |
| 2026-07-27 | T-2.7 | Contest is weighted by direction, not just distance | A defender standing behind the shooter is not contesting the shot however close they are. Without it, tight man marking made every shot maximally contested from every angle and the whole floor shot 25%. |
| 2026-07-27 | T-2.8 | The CPU decides by expected points rather than by rules of thumb | A threshold table has to be re-tuned for every change to the shooting model and never takes the corner three. Expected points re-tunes itself and gets the three right by construction. |
| 2026-07-27 | T-2.8 | The shot bar is a possession's *continuation* value, not its total value | Set at league-average efficiency it means only above-average shots are ever taken, which cannot be true of an average. Declining a shot burns clock and risks a turnover, so what remains is worth less than the possession was. |
| 2026-07-27 | T-2.9 | Auto-switch is an assist, not a difficulty setting | `06` §2 lists it beside aim and pass assist, tunable independently. Modelling it as difficulty would make it a thing the player cannot choose separately, which is the opposite of what the spec asks for. |
| 2026-07-27 | T-2.9 | With auto-switch off, the player is *not* switched to the ball-carrier | Off means off. The alternative reading — always follow the ball — makes the setting do nothing on offence, which is most of the game. |
| 2026-07-27 | T-2.13 | `Rng.int(min, max)` is half-open, and reads as inclusive | `int(0, 1)` returning a constant zero is a trap that cost this phase three coin flips and a structural home advantage nobody would have found by reading the code. The engine is not mine to change mid-phase and other call sites may rely on the range; `bool()` is used for coin flips instead. Worth revisiting as an engine ergonomics fix. |
| 2026-07-27 | T-2.13 | Balance targets are bands, and `eFG%` carries the tight one | Raw field-goal percentage is not comparable across offences with different shot mixes — a team taking half its shots from three has a lower one by construction, and chasing the league-average number would mean tuning the CPU into taking *worse* shots. |
| 2026-07-27 | T-2.12 | **Raised, not fixed: the `@invariant` IDs in spec headers do not match `12` §3's table.** Headers across Phases 0–2 use `INV-5` for "no sport-specific branching in engine core" and `INV-11` for "no information by colour alone" — but in `12` §3, INV-5 is the pack-economy rule and INV-11 is cross-mode outcome parity. Those two meanings come from **CLAUDE.md §8's** numbered constraint list, which is a *different* numbering from the INV table. | The convention was set in Phase 1 (`src/sports/types.ts`, `testsport/index.ts`) and this session followed it, so 26 references across 13 files are consistent with each other and inconsistent with `12` §3. Every use carries its meaning in parentheses, so no reader is actually misled — which is why this is recorded rather than mass-edited mid-phase. It needs one decision (renumber the headers, or give CLAUDE.md §8's list its own prefix such as `C-4`/`C-11`) and one mechanical pass. Raised with the user at the Phase 2 gate. |
| 2026-07-27 | T-2.10 | Built the Live mode host, which `03` has no task for | The HUD needs something to be a HUD *of*. `03` implies the host in T-2.10/T-2.11 without naming it; rather than invent a task ID, it is recorded against both. |
| 2026-07-27 | T-2.10 | T-2.10 was not delegated despite `03` marking it `sonnet` | The host underneath it is the sport-module seam, which `CLAUDE.md` §7.2 says never to delegate — and once the host exists the HUD is thin. T-2.12 was delegated instead. |
| 2026-07-27 | T-2.11 | In-match settings are handedness and sound only | Everything else `06` §2 lists — aim assist, pass assist, auto-switch strength, timing forgiveness — needs the settings store and the difficulty seam from Phase 7. A toggle that quietly does nothing is worse than no toggle. |
| 2026-07-27 | T-2.6 | No delegation this session, despite the offer | The tasks marked `sonnet` in `03` are the HUD (T-2.10), the pause/summary screens (T-2.11), and the art pass (T-2.12). All three are out of order, and the art pass in particular has nothing to be viewed in until the HUD exists — reviewing a large diff for it would have cost more than the gameplay tasks it displaced. Worth revisiting once T-2.10 lands. |

---

## Gate records

### Gate 3 — Athletes, cross-sport ratings, roster (v0.2)

- **Date:** 2026-07-28
- **Result:** **NOT PASSED — every automatable check green, blocked on the same human verification
  as Gate 2, which is now two gates of debt rather than one.**

`03`'s criterion for this gate is a single end-to-end sentence: *create an athlete, play them in
basketball, watch familiarity move over several matches, export a backup, wipe data, reimport, land
exactly where you left off.* Every link in that chain exists and is covered by tests, and the chain
has never been walked by a person.

**What is evidenced:**

| Link | Evidence |
|---|---|
| Create an athlete | `tests/unit/ui/athlete-editor.test.ts` — the editor saves through `createAthlete` and the record lands in the repository |
| Play them in basketball | `tests/integration/sports/basketball-rosters.test.ts` — a lineup drives the sim; ratings, movement, coupling, and fatigue all read from the athlete |
| Watch familiarity move | `tests/unit/athletes/{familiarity,progression}.test.ts` — 20 simulated matches move a novice past 60 familiarity and raise the derived rating it gates |
| Export a backup | `tests/integration/storage/backup.test.ts` — every store, with its schema version |
| Wipe and reimport | same file — a full round trip through a wipe restores every store, and the preview is the restore's own dry run |

**Checks run:**

| § | Check | Result |
|---|---|---|
| 1 | Every task `done` or `cut` with a reason | ✅ 17 of 17 `done`, none cut |
| 2 | Full suite green | ✅ 1 682 tests across 93 files; 32 E2E specs in a real browser |
| 3 | Coverage thresholds (`12` §2) | ✅ 94.7% overall against ≥85%; `src/athletes/**` and `src/storage/**` hold their 95% floors |
| 4 | No invariant regressed | ✅ including a new one — `tests/invariants/layering.test.ts`, added after the domain layer was caught importing the UI layer |
| 6 | Gate criteria in `03` | ⚠️ machine half evidenced above; the "land exactly where you left off" *feeling* is unverified |
| 8 | Gate record appended, committed, pushed | ✅ this record |
| 5 | Manual device matrix (`12` §7) | ❌ no device available to this session |
| 7 | Tag and deploy | ❌ not done — outward-facing, and wants a decision rather than an assumption |

**Balance after T-3.17** (`pnpm balance`, 500 matches): all 14 bands pass, identical to T-2.13's
figures — 75.5 points on 78.7 attempts at 36.5%, home win rate 44.2%. That is the expected result
and the point of the design: a rosterless match is byte-identical to the pre-T-3.17 one, so wiring
real athletes in could not move the harness. **The corollary is worth stating plainly: the balance
suite does not yet cover matches played by real athletes.** Every band above describes seeded
stand-ins. Balancing real rosters is Phase 7's problem and it has not been started.

**Two regressions this gate caught, both mine, neither caught by the unit suite:**

- `DB_VERSION` 1 → 2 (T-3.1) broke five E2E specs, because a test helper opened IndexedDB at a
  hardcoded version 1 and threw `VersionError` against a database the app had already upgraded. CI
  does not run on branches, so nothing surfaced it until the gate. The helper now opens
  version-less.
- Seeding the starter roster inside `appDatabase()` (T-3.14) handed 38 athletes to every test and
  every headless caller. Thirteen tests said so within a minute. Opening the database is a read;
  filling it is an install step, and it now runs from bootstrap.

**Deferred, with reasons:** the device matrix and the deploy, unchanged from Gate 2 and now
compounding. Gate 2 was not signed off; Gate 3 is not either, and both are waiting on the same two
things.

**Correction, 2026-07-28.** An earlier version of this record said the device matrix did not need a
deploy, because `pnpm serve` can put the real build on a LAN. That is true only with a laptop
holding a checkout. The user works through the Claude Code mobile app, and these sessions run in a
disposable cloud container that no phone can reach — so for this project **the deploy is the only
route to a real device**, not one option among several. Written up in
[`docs/device-testing.md`](../../docs/device-testing.md), which now leads with it.

**Deploy, authorised by the user but NOT done — this session cannot do it.** Both routes are
refused by the credentials these sessions run with:

- `git push origin v0.2.0` → **HTTP 403**. The git proxy permits pushes to the session's own branch
  and nothing else; tags are not branch pushes.
- Dispatching `deploy.yml` through the GitHub API → **403 "Resource not accessible by
  integration"**. The app token has no `actions: write`.

So the deploy is a **user action**, and the steps are in
[`docs/device-testing.md`](../../docs/device-testing.md). `package.json` was bumped `0.0.0` →
`0.2.0` in preparation, because that version is what `version.json` reports and what Settings → App
& updates displays — publishing a v0.2 milestone that tells the player it is `0.0.0` would make the
update machinery lie about itself, which is the one thing `11` §3 exists to prevent.

**Also requires one thing only the repository owner can do:** Settings → Pages → Build and
deployment → Source: *GitHub Actions*. Without it the deploy job fails at its final step, whoever
starts it.

---

### Gate 2 — Basketball · Live (v0.1)

- **Date:** 2026-07-27
- **Result:** **NOT PASSED — automatable checks all green, blocked on human verification.**
  Seven of the nine `CLAUDE.md` §5 steps are satisfied. The two that are not need a phone and a
  person, and neither can honestly be signed off from here.

**What passed**

| § | Check | Result |
|---|---|---|
| 1 | Every task `done` or `cut` | ✅ 13/13 `done`, none cut |
| 2 | Full suite green | ✅ 1 069 unit/integration/invariant/determinism across 60 files; 32 E2E in headless Chromium, including 4 new match tests and the axe audit of the paused screen |
| 3 | Coverage thresholds (`12` §2) | ✅ 91.2% overall against ≥85%. **Two thresholds `12` §2 requires were not being enforced at all** — the overall floor and `src/sports/*/rules` ≥90% — and were added at this gate rather than noticed later. `rules.ts` is at 100%. |
| 4 | No `12` §3 invariant regressed | ✅ 22 invariant tests green |
| 6 | Gate criteria in `03` | ⚠️ partly — see below |
| — | Perf budget (`12` §6) | ✅ 0.074 ms mean sim step against a 4 ms budget, 23 entities |
| — | Size budget | ✅ 25.4 KB initial JS / 200 KB; 179 KB install / 6 MB |

**What did not**

| § | Check | Why not |
|---|---|---|
| 5 | Manual device matrix (`12` §7) | No device available to this session. Nothing in Phase 2 has been touched by a thumb: every "feel note" in the table above is honestly recorded as unknown, and the release-timing meter — the mechanic the whole shooting model hangs on — has never been *felt*. |
| 7 | Tag, deploy, verify install-from-scratch and offline on a real device | Not done, deliberately. Deploying is outward-facing and hard to reverse; it wants a decision rather than an assumption. The verification half needs the device from §5 anyway. |
| 6 | "…and it's fun enough to play twice" | A human judgement. The machine half of `03`'s gate criterion — *a full basketball game is playable end to end against the CPU, offline, from the installed app* — is evidenced: the E2E suite mounts a match in a real browser, watches the canvas change between frames, opens the pause menu, reads the box score as markup, and quits cleanly; the PWA lifecycle suite already covers offline and install-from-scratch for the shell. The other half is not something a test can claim. |

**The balance run, in full** (`pnpm balance`, 500 matches, 1 000 team-games):

| | Value | Band |
|---|---|---|
| Points per team | 75.5 | 55–125 |
| Field-goal attempts | 78.7 | 45–110 |
| Field-goal % | 36.5% | 33–55% |
| Effective FG% | 44.5% | 40–58% |
| Three-point % | 30.7% | 25–45% |
| Three-point share of attempts | 51.9% | 8–55% |
| Free-throw % | 68.7% | 55–85% |
| Rebounds per team | 45.6 | 20–60 |
| Offensive rebound share | 44.4% | 15–45% |
| Turnovers per team | 21.8 | 6–30 |
| Personal fouls per team | 11.8 | 4–30 |
| Steals per team | 9.5 | 2–18 |
| Blocks per team | 4.5 | 0.5–12 |
| Home win rate | 44.2% | 35–65% |
| Ties | 0.0% | 0–2% (overtime resolves them) |

**Deferred, with reasons**

- **The away side wins 55.8% over 500 matches** (≈2.6σ). Two structural causes were found and
  fixed at T-2.13 — an entity-order tie-break that was really a team-order tie-break, and
  `Rng.int(0, 1)` used as a coin flip when the range is half-open — but a small residual survives
  and I could not localise it. `T-7.10` verifies win-rate bands by design and is the right place to
  finish it.
- **Offensive rebounds are 44.4% of all rebounds**, at the very top of the band. Box-out
  positioning exists (`defence.boxOutSpot`) but is weak against an offence that crashes.
- **`src/modes/live/screen.ts` is at 37% line coverage.** Its mount-and-loop path is covered by the
  four browser E2E tests, which vitest cannot see. Not gamed with a shim; recorded as-is.
- **Spec-header `@invariant` IDs do not match `12` §3's table** — see the implementation-decisions
  table. Needs one decision from the user and one mechanical pass.

---

### Gate 1 — Engine core

- **Date:** 2026-07-27
- **Result:** **passed on everything measurable here; one criterion deferred to Phase 2** (below).
- **Branch:** `claude/phase-1-token-optimizations-g7sjm3`

**Checks run**

| Check | Result |
|---|---|
| Typecheck (`tsc -b`, strict) | clean |
| Lint (ESLint incl. INV-2/3/4/15 rules) + Prettier | clean |
| Unit / property / integration / invariant / sim suite | **777 passing, 40 files** |
| Coverage against `12` §2 thresholds | **passing** — overall 90.95% lines, 94.79% functions |
| E2E + a11y (Playwright, headless Chromium) | **28 passing**, incl. all sixteen `11` §9 scenarios |
| Bundle budget (`12` §6) | initial JS 9.5 KB / 200 KB · install 91.7 KB / 6 MB |
| Simulation budget (`12` §6) | **23 entities, sim step p95 0.029 ms / 4 ms budget** |
| Traceability + PROGRESS checks | clean |

**Gate 1 criteria (`03`)**

| Criterion | Result |
|---|---|
| The test sport runs 22 entities at 60 Hz sim | **met** — 23 entities (11 per side plus the ball) at a p95 sim step of 0.029 ms, which is ~1/570th of the 16.7 ms a 60 Hz frame allows |
| ≥55 fps render on target hardware | **deferred** — the renderer, camera, and perf monitor exist and are unit-tested, but nothing mounts them into a running match screen until Phase 2's Live host. There is no honest fps number to record yet, and a fabricated one would be worse than none |
| Two runs of the same seed and inputs produce byte-identical state hashes | **met** — `tests/sim/determinism.test.ts` asserts identical hashes step-for-step (not merely at the end) across several seeds, and a recorded match replayed through `InputPlayer` reproduces the live hash sequence exactly |

**Coverage debt paid down.** Gate 0 was recorded as passing, but `pnpm test:coverage` would have
failed it: `src/storage/**` functions sat at 90.54% (needs 95%) and `src/ui/**` lines at 59.97%
(needs 70%), because the four Phase-0 screens had no component-state tests and the storage failure
paths had none either. CI had never run on GitHub, so nothing caught it. `12` §2 forbids lowering a
threshold to make a build pass, so the gap was closed with real tests rather than a config edit:
`tests/unit/ui/screens.test.ts`, `tests/unit/ui/app-updates.test.ts`,
`tests/unit/storage/caches-build.test.ts`, and `tests/integration/storage/idb-queries.test.ts`.

**Bugs found by writing the tests, not by review**

1. **The ball never settled.** Treating "airborne" as `z > radius` alone gave every bounce one
   gravity-free step of rise, because the step after impact sees the ball exactly at ground height.
   The injected energy was enough for a permanent low limit cycle. Fixed to `z > radius || vz > 0`.
2. **`nextPeriod()` before kick-off silently started the match at period 2**, because `preMatch →
   live` is a legal transition — the one `start()` uses. Methods now guard themselves as well as
   the transition table does.
3. **Magnus force accelerated the ball**, because the second velocity component read the
   half-updated first one. A pass that speeds up in flight is the kind of bug that surfaces as "the
   ball feels wrong" rather than as a failure.

**Not run, and why**

- **Manual device matrix (`12` §7).** No physical device is available to this session. T-1.9's input
  layer in particular owes a real-phone pass: thumb feel and the <100 ms input-to-screen latency in
  US-2.1 are not things a unit test can answer. Recorded against T-1.9 rather than waved through.
- **Visual regression and Playwright component tests (`12` §1).** Not yet created — Phase 0 covered
  the primitives with unit tests instead. They become meaningful with Phase 2's match screen, and
  should be stood up there rather than backfilled against a UI that is about to change.
- **Tag and deploy (`CLAUDE.md` §5.7).** Deliberately not done from a feature branch: deploy is
  tag-triggered from `main`, and the branch is not merged. Should follow the merge.

**Feel note.** Not applicable to Phase 1 — nothing here is played directly. The nearest thing to a
feel signal is that the test sport's athletes visibly accelerate, lean into each other, and lose the
ball in a scramble, all from ratings rather than from special cases. That is the property Phase 2
needs, and it is there.


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
