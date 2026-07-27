# PROGRESS — Sport-Game · spec 001-initial-dev

**This file is the project's memory.** It records what is done, what is in flight, and exactly where
to resume. It is updated *in the same commit as the work it describes* — never as separate
bookkeeping.

Protocol: [`/CLAUDE.md`](../../CLAUDE.md) §3. Task definitions: [`03-phases-and-tasks.md`](./03-phases-and-tasks.md).

Statuses: `todo` · `in_progress` · `blocked` · `done` · `cut`

---

## In-flight

- **Task:** T-0.15 — GitHub Actions CI + tagged Pages deploy, then T-0.16 — the sixteen PWA E2Es
- **Status:** todo (next up)
- **Started:** —
- **Branch commit:** —
- **Done so far:** —
- **Next step:** CI workflow running typecheck, lint, unit, coverage, budgets, and Playwright,
  plus a tag-triggered Pages deploy using the `GITHUB_REPOSITORY`-derived base path. Then the
  sixteen `11` §9 scenarios as Playwright E2Es — the last task before Gate 0.
- **Files touched:** —
- **Blockers:** Awaiting the user's answers to [`08-open-questions.md`](./08-open-questions.md);
  working assumptions are recorded there, so none of them block Phase 0.
- **Notes:** **Branch.** This work is being pushed to `claude/build-project-azivs9`, not the
  `claude/multi-sport-pwa-game-50k7u7` named in `CLAUDE.md` §11 — the session was assigned the
  former and may not push elsewhere. `CLAUDE.md` should be reconciled once the user confirms which
  branch is canonical.

> **Resuming after an interruption:** read this block, `git log --oneline -20`, then continue from
> **Next step**. Everything needed should be here — if it isn't, the previous session didn't follow
> `CLAUDE.md` §3.1, and the fix is to reconstruct this block before writing any code.

---

## Summary

| Phase | Name | Tasks | Done | Status | Milestone |
|---|---|---|---|---|---|
| 0 | Foundation, PWA shell, update & offline lifecycle | 18 | 16 | `in_progress` | — |
| 1 | Engine core | 13 | 0 | `todo` | — |
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
| | **Total** | **170** | **0** | | |

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
| T-0.15 | GitHub Actions: CI (typecheck, lint, unit, e2e, a11y, coverage, budgets) + tagged Pages deploy | M | `todo` | | | | |
| T-0.16 | PWA lifecycle E2E suite: all sixteen scenarios in `11` §9 | L | `todo` | | | | |
| T-0.17 | Spec-header lint rule + traceability report generator (INV-15) | M | `done` | | `tests/invariants/inv-15-spec-headers.test.ts`, `tests/unit/tools/spec-tooling.test.ts` | `auto` | Deliberately two checks: a plain-JS ESLint rule doing a presence check on the five mandatory fields with no filesystem access, so it runs on every keystroke; and the invariant test resolving every task and story ID against `03` and `02`, which is authoritative and runs in CI. `pnpm trace` writes `docs/traceability.md` both ways — currently 39 modules across 12 tasks. |
| T-0.18 | `PROGRESS.md` validation script: task IDs resolve, statuses valid, no orphans | S | `done` | | `tests/unit/tools/spec-tooling.test.ts` | `auto` — `pnpm progress:check` reports 156 todo / 14 done, no problems | Catches unresolvable IDs, invalid statuses, duplicated rows, orphaned tasks defined in `03` with no row, an In-flight task with no row, and more than one `in_progress` at a time (`CLAUDE.md` §2). |

### Phase 1 — Engine core

| Task | Description | Size | Status | Commits | Tests | Verified | Notes |
|---|---|---|---|---|---|---|---|
| T-1.1 | Seeded PRNG + lint rule banning `Math.random` in `engine/`, `sports/` (INV-2) | S | `todo` | | | | |
| T-1.2 | Fixed-timestep loop (60 Hz) with accumulator, render interpolation, pause/step/time-scale | M | `todo` | | | | |
| T-1.3 | Entity model: struct-of-arrays state, spatial hash for neighbour queries | L | `todo` | | | | |
| T-1.4 | Movement & steering from attributes: accel, max speed, turn rate, seek/arrive/pursue/avoid | L | `todo` | | | | |
| T-1.5 | Collision & contact contests weighted by strength/agility | L | `todo` | | | | |
| T-1.6 | Ball physics: position + height, gravity, bounce, spin/curve, possession attach/detach | L | `todo` | | | | |
| T-1.7 | Canvas 2D renderer: layers, batching, LOD, off-screen static layers, debug overlay | L | `todo` | | | | |
| T-1.8 | Camera: ball follow, smoothing, dynamic zoom, bounds clamp, shake (reduced-motion aware) | M | `todo` | | | | |
| T-1.9 | Input layer: floating joystick, context buttons, handedness mirror, keyboard, gamepad | L | `todo` | | | | |
| T-1.10 | Match state machine + `SportEvent` bus (the contract all three modes emit) | M | `todo` | | | | |
| T-1.11 | `SportModule` interface (`04` §5, `09` §5) + a trivial test sport proving the seam | M | `todo` | | | | |
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
