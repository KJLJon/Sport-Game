# 03 — Phases and Tasks

## Conventions

- Task IDs are `T-<phase>.<n>` and are **stable once written**. Stories are `US-x.y` from `02`.
- Size: **S** (<½ day), **M** (~1 day), **L** (2–3 days), **XL** (4+ days).
- Every task is tracked in [`PROGRESS.md`](./PROGRESS.md) with a status, verification record, and
  commit link, so work can be interrupted and resumed. The execution protocol lives in
  [`/CLAUDE.md`](../../CLAUDE.md).
- A phase ends at a **gate** — a hard checkpoint against `01` §5 and `12` §9. A failing gate is fixed
  before the next phase starts.
- **Agent** column marks tasks that suit delegation to a subagent, with a suggested model
  (see `CLAUDE.md` §7). Blank means do it in the main session.

## Phase map

| Phase | Name | Delivers | Milestone |
|---|---|---|---|
| 0 | Foundation, PWA shell, update & offline lifecycle | Installable, offline, self-healing, path-scoped app on Pages | — |
| 1 | Engine core | Deterministic fixed-timestep sim, renderer, input, camera | — |
| 2 | Basketball · Live | A real 5v5 real-time game vs a baseline CPU | **v0.1** |
| 3 | Athletes, ratings, roster | The cross-sport system and squad management | **v0.2** |
| 4 | Arcade framework + basketball arcade set | Five standalone mini-games, hub, hot-seat | **v0.3** |
| 5 | Playbook (turn-based) + basketball Playbook | Turn-based tactical mode with arcade key moments | **v0.4** |
| 6 | Soccer · all three modes | Second sport across Live, Playbook, and Arcade | **v0.5** |
| 7 | CPU AI depth & difficulty ladder | Opponents worth playing, four difficulties, all modes | — |
| 8 | Modes hub, progression, achievements, economy | Tournaments, ~75 achievements, coins/packs/market | — |
| 9 | UI/UX, accessibility, performance, data safety | Ship quality — the family-friendly gate | **v1.0** |
| 10 | P2P (bonus) | Async codes → Playbook P2P → Live lockstep, trading | **v1.0.x** |
| 11 | Hockey & American Football | The remaining named sports, all three modes | **v1.1** |

**Why this order.** Arcade (Phase 4) comes before the second sport because it's cheap, it's the
family on-ramp, and Playbook depends on it. Playbook (Phase 5) comes before soccer so that soccer is
built once against a settled three-mode contract instead of being retrofitted twice.

---

## Phase 0 — Foundation, PWA shell, update & offline lifecycle

Goal: an empty but genuinely installable, offline-durable, self-repairing, correctly-scoped app,
deployed by CI, with the traceability and progress tooling already running. Nothing later starts
until this is proven — retrofitting base-path correctness or update strategy is miserable, and
`11` exists because getting this wrong is a bug you've already lived through.

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-0.1 | Scaffold Vite + TypeScript (strict), ESLint, Prettier, Vitest, Playwright, folder layout per `04` §4 | S | — | — | |
| T-0.2 | Derive `base` from repo name at build; lint rule + test banning literal paths (INV-4) | S | T-0.1 | US-1.3 | |
| T-0.3 | App shell: canvas host, hash router, safe-area layout, orientation handling | M | T-0.1 | US-1.1, US-13.1 | |
| T-0.4 | Design tokens + primitive components + dev-only component gallery route | M | T-0.3 | US-13.2 | sonnet |
| T-0.5 | Web app manifest generated with base-path `id`/`scope`/`start_url`, full icon set incl. maskable | M | T-0.2 | US-1.1 | |
| T-0.6 | Service worker: per-class cache strategies (`11` §2), atomic precache install, versioned caches, activate cleanup | L | T-0.5 | US-1.2, US-1.3, US-1.6 | |
| T-0.7 | `version.json` emission + all five update-detection triggers (`11` §3) | M | T-0.6 | US-1.4 | |
| T-0.8 | Update application: waiting-worker banner, safe-point auto-update, single-reload guard, `minSupportedVersion` force | L | T-0.7 | US-1.4, US-1.7 | |
| T-0.9 | Offline integrity self-check and self-heal; offline-readiness UI; "download everything for offline" | L | T-0.6 | US-1.8 | |
| T-0.10 | Repair flow — caches and SW only, IndexedDB untouched (INV-13); "check for update now"; version display | M | T-0.8 | US-1.9 | |
| T-0.11 | `ScopedStorage`: namespaced IndexedDB, localStorage, and Cache Storage behind one module (INV-3) | M | T-0.2 | US-1.3 | |
| T-0.12 | Storage persistence request, quota/usage display, denial warning + backup prompt | S | T-0.11 | US-1.5 | |
| T-0.13 | Schema versioning + migration runner with pre-migration snapshot and rollback | M | T-0.11 | US-12.2 | |
| T-0.14 | Install UX: `beforeinstallprompt` capture, custom button, iOS-only A2HS instructions | M | T-0.5 | US-1.1 | sonnet |
| T-0.15 | GitHub Actions: CI (typecheck, lint, unit, e2e, a11y, coverage, budgets) + tagged Pages deploy | M | T-0.1 | — | |
| T-0.16 | PWA lifecycle E2E suite: all sixteen scenarios in `11` §9 | L | T-0.10, T-0.15 | US-1.2, US-1.4, US-1.8, US-1.9 | sonnet |
| T-0.17 | Spec-header lint rule + traceability report generator (INV-15) | M | T-0.1 | — | sonnet |
| T-0.18 | `PROGRESS.md` validation script: task IDs resolve, statuses valid, no orphans | S | T-0.17 | — | haiku |

**Gate 0:** Deployed to Pages. Installs on Android and iOS. Cold-launches offline. Update banner
appears for a new deploy and applies cleanly. Deleting cache entries self-heals. Repair leaves
IndexedDB intact. Every cache and storage key namespaced. All sixteen PWA tests green.

---

## Phase 1 — Engine core

Goal: a sport-agnostic, deterministic engine. No basketball anywhere in this code.

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-1.1 | Seeded PRNG + lint rule banning `Math.random` in `engine/`, `sports/` (INV-2) | S | T-0.1 | US-2.5 | |
| T-1.2 | Fixed-timestep loop (60 Hz) with accumulator, render interpolation, pause/step/time-scale | M | T-1.1 | US-2.5 | |
| T-1.3 | Entity model: struct-of-arrays state, spatial hash for neighbour queries | L | T-1.2 | US-2.5 | |
| T-1.4 | Movement & steering from attributes: accel, max speed, turn rate, seek/arrive/pursue/avoid | L | T-1.3 | US-2.1 | |
| T-1.5 | Collision & contact contests weighted by strength/agility | L | T-1.3 | US-3.2 | |
| T-1.6 | Ball physics: position + height, gravity, bounce, spin/curve, possession attach/detach | L | T-1.3 | US-3.2, US-4.2 | |
| T-1.7 | Canvas 2D renderer: layers, batching, LOD, off-screen static layers, debug overlay | L | T-1.2 | US-2.3, US-2.5 | |
| T-1.8 | Camera: ball follow, smoothing, dynamic zoom, bounds clamp, shake (reduced-motion aware) | M | T-1.7 | US-2.3 | |
| T-1.9 | Input layer: floating joystick, context buttons, handedness mirror, keyboard, gamepad | L | T-1.2 | US-2.1, US-2.6 | |
| T-1.10 | Match state machine + `SportEvent` bus (the contract all three modes emit) | M | T-1.2 | US-2.4 | |
| T-1.11 | `SportModule` interface (`04` §5, `09` §5) + a trivial test sport proving the seam | M | T-1.10 | US-14.4 | |
| T-1.12 | Input recording + golden-seed determinism tests in CI (INV-8) | M | T-1.1, T-1.10 | US-2.7 | |
| T-1.13 | Perf harness: fps/frame-time/entity overlay + CI budget check on a headless benchmark | M | T-1.7 | US-2.5 | sonnet |

**Gate 1:** The test sport runs 22 entities at 60 Hz sim / ≥55 fps render on target hardware. Two
runs of the same seed and inputs produce byte-identical state hashes.

---

## Phase 2 — Basketball · Live → **v0.1**

Prove the engine by making one sport genuinely fun. Baseline CPU only; the difficulty ladder is
Phase 7.

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-2.1 | Court geometry, zones, arc, key, hoop, boundaries | M | T-1.11 | US-3.1 | |
| T-2.2 | Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts | L | T-2.1 | US-3.1, US-2.4 | |
| T-2.3 | Shooting: hold-release meter, arc trajectory, make probability from ratings × distance × pressure × release | L | T-1.6, T-2.1 | US-3.2 | |
| T-2.4 | Passing: aimed, lead passes, interceptions, turnovers | M | T-1.6 | US-3.2 | |
| T-2.5 | Dribbling & driving: handling control, contact absorption, blow-by | L | T-1.5 | US-3.2 | |
| T-2.6 | Rebounding: height/vertical/strength/box-out/timing contest | M | T-1.5 | US-3.2 | |
| T-2.7 | Defence: marking, contest, steal, block, foul model, free throws | L | T-2.2 | US-3.3 | |
| T-2.8 | Baseline CPU: role-based offence (spacing, cuts, screens), man defence, possession decisions | XL | T-2.7 | US-7.1 | |
| T-2.9 | Control switching: auto on turnover, manual cycle, controlled-athlete indicator | M | T-1.9 | US-2.2 | |
| T-2.10 | Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators | M | T-1.7 | US-2.3, US-2.4 | sonnet |
| T-2.11 | Pause menu, quit, in-match settings, post-match summary with box score | M | T-2.10 | US-2.4 | sonnet |
| T-2.12 | Basketball art & audio pass | L | T-1.7 | — | sonnet |
| T-2.13 | Balance pass #1: shooting percentages and pace plausible over 500 headless games | M | T-2.8 | US-3.1 | |

**Gate 2 (v0.1):** A full basketball game is playable end to end on a phone against the CPU, offline,
from the installed app — and it's fun enough to play twice.

---

## Phase 3 — Athletes, cross-sport ratings, roster → **v0.2**

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-3.1 | Athlete schema, IndexedDB store, indexes, repository | M | T-0.11 | US-5.1, US-5.5 | |
| T-3.2 | Attribute system: the eleven attributes, budget rules, sandbox flag, random roll | M | T-3.1 | US-5.1 | |
| T-3.3 | Derivation engine: weight matrix, physical modifiers, unit-tested invariants | L | T-3.2 | US-5.2 | |
| T-3.4 | Familiarity model: per-sport familiarity, penalty curve, growth from minutes | L | T-3.3 | US-5.2, US-5.3 | |
| T-3.5 | Sport skill XP: levels, sub-skills, event-driven awards, diminishing returns | L | T-3.4 | US-5.3 | |
| T-3.6 | Behavioural coupling: familiarity → decision noise, control error, reaction penalty in-sim | M | T-3.4, T-2.8 | US-5.2 | |
| T-3.7 | Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale | L | T-3.2 | US-5.1 | sonnet |
| T-3.8 | **Athlete card** component: compact + full, sport switcher, familiarity ring, "why this rating" | L | T-3.3 | US-5.4 | |
| T-3.9 | Cross-sport compare view with projections for unplayed sports | M | T-3.8 | US-5.4 | sonnet |
| T-3.10 | Roster browser: search, sort, filter, bulk select | M | T-3.1 | US-5.5 | sonnet |
| T-3.11 | Teams: create/edit, name, colours, generic crests | M | T-3.1 | US-6.1 | sonnet |
| T-3.12 | Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best | L | T-3.11 | US-6.2 | |
| T-3.13 | Stamina, injury, suspension, availability | M | T-3.5 | US-6.3 | |
| T-3.14 | Starter roster: generated fictional athletes, enough for both sports | M | T-3.2 | US-5.6 | haiku |
| T-3.15 | Roster import: file + URL, schema validation, per-record errors, merge/conflict, responsibility notice | L | T-3.1 | US-5.7 | sonnet |
| T-3.16 | Roster and full-backup export/import with version checks and change preview | M | T-0.13 | US-5.8, US-12.1 | |
| T-3.17 | Wire real athletes into basketball Live — lineups drive the sim | M | T-3.12, T-2.8 | US-5.2 | |

**Gate 3 (v0.2):** Create an athlete, play them in basketball, watch familiarity move over several
matches, export a backup, wipe data, reimport, land exactly where you left off.

---

## Phase 4 — Arcade framework + basketball arcade set → **v0.3**

The family on-ramp, and the component Playbook's key moments are built from.

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-4.1 | Arcade framework: `ArcadeGameDef`, host, session lifecycle, scoring, star ratings | L | T-1.11 | US-16.1 | |
| T-4.2 | Calibration: ratings + familiarity → window sizes and speeds (INV-10) | M | T-3.4, T-4.1 | US-16.3 | |
| T-4.3 | Arcade hub: grid, locked/unlocked states, personal bests, athlete picker with window hint | M | T-4.1 | US-16.1, US-16.2 | sonnet |
| T-4.4 | Practice / scored / daily modes; seeded daily challenge | M | T-4.1 | US-16.4 | |
| T-4.5 | **Free Throw** — release timing under mounting pressure | M | T-4.2 | US-16.1 | sonnet |
| T-4.6 | **Three-Point Contest** — five racks, rhythm and timing, 60 s | M | T-4.2 | US-16.1 | sonnet |
| T-4.7 | **Buzzer Beater** — contested shot, shrinking window | M | T-4.2 | US-16.1 | sonnet |
| T-4.8 | **Fast Break** — finish past a recovering defender | M | T-4.2 | US-16.1 | sonnet |
| T-4.9 | **Pickpocket** — reaction test, jump the lane without fouling | M | T-4.2 | US-16.1 | sonnet |
| T-4.10 | Arcade → progression: XP, familiarity, `SportEvent` emission at reduced rate | M | T-3.5, T-4.1 | US-16.5 | |
| T-4.11 | Arcade hot-seat: party rounds, seeded fairness, ranking, elimination formats | M | T-4.4 | US-17.2 | sonnet |
| T-4.12 | Arcade accessibility: left-hand mirroring, colour-independent meters, reduced motion | M | T-4.9 | US-13.2 | sonnet |
| T-4.13 | Arcade balance: daily reward caps, anti-farm verification (INV-12) | M | T-4.10 | US-16.6 | |

**Gate 4 (v0.3):** Five arcade games playable and fun standalone; a child can start one unaided;
rewards can't be farmed; calibration demonstrably reflects the chosen athlete.

---

## Phase 5 — Playbook (turn-based) + basketball Playbook → **v0.4**

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-5.1 | `PlaybookAdapter` interface + turn engine: turn loop, state, seeded resolution | L | T-1.10, T-1.11 | US-15.1 | |
| T-5.2 | Resolution model: ratings → matchup → outcome distribution → sampled `SportEvent` stream | XL | T-3.3, T-5.1 | US-15.2 | |
| T-5.3 | Narration + animated court-diagram renderer for turn outcomes | L | T-5.2 | US-15.3 | sonnet |
| T-5.4 | Basketball play catalogue (offence + defence calls) and call-selection UI | L | T-5.2 | US-15.2 | |
| T-5.5 | Key-moment detection → arcade invocation → result fed back into resolution | L | T-4.1, T-5.2 | US-15.4 | |
| T-5.6 | Expectation comparison ("the sim would have made it") + post-match reporting | M | T-5.5 | US-15.5 | sonnet |
| T-5.7 | Auto-call assistant coach, fast-forward, turn-speed control | M | T-5.4 | US-15.6 | sonnet |
| T-5.8 | Playbook CPU: call selection, weakness exploitation, per-difficulty competence | L | T-5.4 | US-15.7 | |
| T-5.9 | Playbook hot-seat: pass-the-device screens, hidden calls, local player names | M | T-5.4 | US-17.1 | sonnet |
| T-5.10 | Playbook flow UI: setup, turn screen, key-moment transition, results | L | T-5.4 | US-15.1 | sonnet |
| T-5.11 | Cross-mode parity tests (INV-11) and reward parity (INV-12) | M | T-5.8 | US-15.8 | |

**Gate 5 (v0.4):** A full basketball Playbook match, start to finish, with arcade key moments,
hot-seat, and outcomes that agree with Live within tolerance for the same rosters.

---

## Phase 6 — Soccer · all three modes → **v0.5**

The real test of the seam. Any engine-core change needed here is a design bug in the core, not
something to work around in the sport module.

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-6.1 | Pitch geometry, zones, goals, boundary lines | M | T-1.11 | US-4.1 | |
| T-6.2 | Soccer Live rules: halves, clock, stoppage, throw-ins, corners, goal kicks | L | T-6.1 | US-4.1 | |
| T-6.3 | Offside detection and enforcement | M | T-6.2 | US-4.1 | |
| T-6.4 | Fouls, advantage, cards, free kicks, penalties | L | T-6.2 | US-4.1, US-4.3 | |
| T-6.5 | Passing suite: short, through-ball, lofted, cross, with weight and rating-driven error | L | T-1.6 | US-4.2 | |
| T-6.6 | Shooting: power meter, placement, curve, deflections | M | T-1.6 | US-4.2 | |
| T-6.7 | Dribbling, sprint, shielding, stamina drain | M | T-1.5 | US-4.2 | |
| T-6.8 | Defending: pressure, standing and slide tackles, foul/card risk | M | T-6.4 | US-4.3 | |
| T-6.9 | Goalkeeper AI: positioning, shot-stopping, claims, distribution; manual on penalties | L | T-6.6 | US-4.3 | |
| T-6.10 | Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase | L | T-6.2 | US-4.1 | |
| T-6.11 | 22-entity performance work: LOD, culling, spatial-hash tuning, zero-allocation hot path | L | T-1.13 | US-2.5 | |
| T-6.12 | Camera and minimap tuning for the larger pitch | M | T-1.8 | US-2.3 | sonnet |
| T-6.13 | Soccer derivation weights, sub-skills, familiarity tuning | M | T-3.3 | US-5.2 | |
| T-6.14 | Soccer Playbook: phase turns, intent controls (tempo/width/risk/press/focus), resolution | XL | T-5.2 | US-15.2 | |
| T-6.15 | Soccer arcade set: Penalty Shootout, Free Kick, One-on-One, Header, Last Line | XL | T-4.2 | US-16.1 | sonnet |
| T-6.16 | Soccer art & audio pass | L | T-2.12 | — | sonnet |
| T-6.17 | Engine-core refactor: extract anything basketball-shaped that leaked into core | M | T-6.2 | US-14.4 | |
| T-6.18 | Balance pass #2: goals, possession, conversion across Live and Playbook | M | T-6.14 | US-4.1 | |

**Gate 6 (v0.5):** Both sports playable in all three modes, ≥55 fps at 11v11 on target hardware, and
the Phase 6 diff touches `engine/` only for genuine core improvements.

---

## Phase 7 — CPU AI depth & difficulty ladder

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-7.1 | Utility-scoring decision framework shared across sports and modes | L | T-2.8 | US-7.1 | |
| T-7.2 | Role system: per-sport role tables driving off-ball movement and responsibility | L | T-7.1 | US-7.1 | |
| T-7.3 | Team coordination: formation shape, phase of play, pressing triggers, help defence, transition | XL | T-7.2 | US-7.1 | |
| T-7.4 | Basketball Live AI depth: pick-and-roll, cuts, zone vs man, rating-driven shot selection | L | T-7.3 | US-3.3 | |
| T-7.5 | Soccer Live AI depth: build-up phases, press lines, offside trap, counter-attacks | L | T-7.3 | US-4.3 | |
| T-7.6 | Playbook AI depth for both sports: tendency modelling, counter-calling | L | T-5.8 | US-15.7 | |
| T-7.7 | Difficulty model across all three modes — latency, noise, error, aggression, assists, arcade windows (INV-1) | M | T-7.1 | US-7.2 | |
| T-7.8 | Assist system: aim, pass, auto-switch, timing forgiveness; independent of difficulty; no-assist bonus | M | T-7.7 | US-7.3 | |
| T-7.9 | CPU team generation: coherent opponents and identities scaled to difficulty | M | T-3.14 | US-7.1 | haiku |
| T-7.10 | AI regression harness: headless batches per difficulty per mode, asserted win-rate bands | M | T-7.7 | US-7.2 | sonnet |
| T-7.11 | Balance pass #3: tune all four levels against the target win-rate curve | L | T-7.10 | US-7.2 | |

**Gate 7:** Rookie is comfortably winnable by a newcomer; Legend beats an experienced player more
often than not; batches confirm the bands; no code path scales attributes by difficulty.

---

## Phase 8 — Modes hub, progression, achievements, economy

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-8.1 | Home screen, mode selector, Quick Play (two taps from cold launch) | M | T-3.12 | US-10.1 | sonnet |
| T-8.2 | Match setup screens for Live and Playbook: sport, teams, difficulty, length, rules toggles | M | T-8.1 | US-10.2 | sonnet |
| T-8.3 | Tournament mode: 4/8/16 bracket, persistence, results, rewards; playable in Live or Playbook | L | T-8.2 | US-7.4 | |
| T-8.4 | Match checkpointing and resume-after-kill, all three modes | M | T-1.10 | US-10.3 | |
| T-8.5 | Stats store: match history, box scores, career stats per sport per mode | M | T-3.1 | US-10.4 | sonnet |
| T-8.6 | Achievement engine: declarative defs, event-stream evaluation, progress, once-only grants (INV-7) | L | T-8.5 | US-8.1, US-8.3 | |
| T-8.7 | Achievement content: ~75 defs incl. arcade unlocks, cross-sport, cross-mode, hidden | L | T-8.6 | US-8.1, US-8.4 | sonnet |
| T-8.8 | Arcade unlock wiring: achievements gate arcade games, with a clear unlock moment | M | T-8.7, T-4.3 | US-16.2 | |
| T-8.9 | Achievement UI: gallery, filters, progress bars, in-match toast, post-match summary | M | T-8.6 | US-8.2 | sonnet |
| T-8.10 | Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match payout | M | T-8.5 | US-9.1, US-9.5 | |
| T-8.11 | Procedural athlete generator: rarity-coherent attribute spreads, fictional names | L | T-3.2 | US-9.2 | sonnet |
| T-8.12 | Packs: tiers, prices, published odds, pity timers, reveal animation with skip | L | T-8.11, T-8.10 | US-9.2 | |
| T-8.13 | Sell-back: valuation, squad-lock guard, confirmation, anti-farm invariants (INV-5, INV-6) | M | T-8.10 | US-9.3 | |
| T-8.14 | Transfer market: rotating listings, tamper-resistant refresh, paid refreshes, buy-offers, seeded price walk | XL | T-8.13 | US-9.4 | |
| T-8.15 | Local player names and party flows for hot-seat across Playbook and Arcade | M | T-5.9, T-4.11 | US-17.3 | sonnet |
| T-8.16 | Economy balance pass: pack EV vs sell value vs earn rate, simulated over 200 matches | M | T-8.14 | US-9.3 | |

**Gate 8:** A new save can be played from zero coins to a meaningfully improved roster with no loop
that generates coins faster than it consumes them, and every arcade game is unlockable through play.

---

## Phase 9 — UI/UX, accessibility, performance, data safety → **v1.0**

This is the phase that decides whether your family actually enjoys it. It is not a polish pass to be
compressed if time runs short — see the cut order below.

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-9.1 | Design system completion: tokens, all components, full state matrices, dev gallery | L | T-0.4 | US-13.5 | sonnet |
| T-9.2 | Screen-by-screen UX pass against the `10` §12 checklist | XL | T-9.1 | US-13.5 | |
| T-9.3 | Onboarding: first launch → sport → mode → played match in under 60 seconds | L | T-8.1 | US-5.6, US-13.4 | sonnet |
| T-9.4 | Interactive tutorials per sport per mode, replayable from Settings | L | T-9.3 | US-13.4 | sonnet |
| T-9.5 | Settings: controls & assists, display & accessibility, audio & haptics, data & backup, app & updates, about | M | T-7.8 | US-13.1–US-13.3 | sonnet |
| T-9.6 | Accessibility pass: contrast, colourblind previews and non-colour differentiation, focus order, screen-reader labels, axe automation | L | T-9.5 | US-13.2 | |
| T-9.7 | The forgotten states (`10` §10): each designed, built, and tested | L | T-9.2 | US-13.6 | sonnet |
| T-9.8 | Motion, haptics, audio, and juice pass with full reduced-motion paths | L | T-9.2 | US-13.1, US-13.3 | sonnet |
| T-9.9 | Visual regression suite: every screen, both themes, both orientations, 1.0× and 1.3× | M | T-9.2 | — | sonnet |
| T-9.10 | Performance hardening: per-sport and per-mode code splitting, asset compression, GC elimination | L | T-6.11 | US-2.5 | |
| T-9.11 | Data safety finishing: erase-all with typed confirm, backup nudges, cross-version migration tests | M | T-0.13 | US-12.1–US-12.3 | |
| T-9.12 | Error handling: global boundary, crash-safe state dump, non-technical recovery UI | M | — | US-12.2 | |
| T-9.13 | Cross-device test matrix (`12` §7) run in full; fix fallout | L | all | — | |
| T-9.14 | Docs: README, roster-file schema, controls, known limitations, licence | M | — | US-5.7 | sonnet |
| T-9.15 | v1.0 release: tag, deploy, verify install-from-scratch on real devices | S | all | S1–S10 | |

**Gate 9 (v1.0):** Every success criterion in `01` §5 passes on a real mid-range Android phone and a
real iPhone, and the `10` §12 design QA checklist is fully ticked — including a person who has never
seen the game reaching a played match in under 60 seconds unaided.

---

## Phase 10 — P2P (bonus) → **v1.0.x**

Ordered by confidence: the thing that always works first, the hard thing last.

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-10.1 | Async challenge codes: seed + scenario + result encoding, share link, comparison screen | L | T-1.12, T-4.4 | US-11.4 | sonnet |
| T-10.2 | WebRTC session layer: offer/answer, ICE gathering completion, data channel | L | — | US-11.1 | |
| T-10.3 | Signal payload codec: SDP trimming, compression, base64url, QR size budget | M | T-10.2 | US-11.1 | |
| T-10.4 | On-device QR generation and camera scanning, with copy/paste fallback | L | T-10.3 | US-11.1 | sonnet |
| T-10.5 | Connection UI: host/join, state reporting, plain-language failure guidance, STUN settings | M | T-10.4 | US-11.1 | sonnet |
| T-10.6 | **Playbook P2P**: turn-exchange protocol, reconnection, clean abandon | L | T-10.2, T-5.1 | US-11.5 | |
| T-10.7 | **Live lockstep**: input delay buffer, shared seed, tick sync, stall handling | XL | T-10.2, T-1.12 | US-11.2 | |
| T-10.8 | Desync detection via periodic state hashing; honest failure; clean teardown | M | T-10.7 | US-11.2 | |
| T-10.9 | Custody ledger: per-install keypair, signed receipts, provenance chain, duplicate refusal | L | T-3.1 | US-11.3 | |
| T-10.10 | Trade UI: proposal, card review, dual confirmation, atomic apply, honest trust notice | L | T-10.9 | US-11.3 | sonnet |
| T-10.11 | Two-device test protocol: same LAN, cross-network, STUN off, backgrounding, NAT-failure fallback | M | T-10.7 | US-11.1, US-11.2 | |

**Gate 10:** Two phones complete a Playbook match over the internet and a Live match on the same
Wi-Fi with no desync, and a trade moves an athlete exactly once.

---

## Phase 11 — Hockey & American Football → **v1.1**

| ID | Task | Size | Deps | Stories | Agent |
|---|---|---|---|---|---|
| T-11.1 | Hockey: rink geometry, puck physics, skating movement model | L | T-1.11 | US-14.1 | |
| T-11.2 | Hockey Live rules: periods, faceoffs, offside, icing, penalties, power plays | L | T-11.1 | US-14.1 | |
| T-11.3 | Hockey actions: passing, one-timers, shooting, deflections, checking, goaltending | XL | T-11.2 | US-14.1 | |
| T-11.4 | Hockey Playbook adapter: shift and zone turns | L | T-5.1 | US-14.3 | |
| T-11.5 | Hockey arcade set: Shootout, Slapshot Accuracy, Faceoff | L | T-4.2 | US-14.3 | sonnet |
| T-11.6 | Football: field geometry, downs and distance, clock rules incl. two-minute | L | T-1.11 | US-14.2 | |
| T-11.7 | Football play-call layer: offensive and defensive playbooks, pre-snap adjustments | XL | T-11.6 | US-14.2 | |
| T-11.8 | Football actions: snap, QB throw with targeting, running, blocking, tackling, kicking | XL | T-11.7 | US-14.2 | |
| T-11.9 | Football Playbook adapter — the sport's natural turn structure | M | T-11.7 | US-14.3 | |
| T-11.10 | Football arcade set: Field Goal, Throw Window, Two-Minute Drill | L | T-4.2 | US-14.3 | sonnet |
| T-11.11 | Derivation weights, sub-skills, familiarity tuning for both sports | M | T-3.3 | US-14.3 | |
| T-11.12 | Achievements and economy content for both sports | M | T-8.7 | US-14.3 | sonnet |
| T-11.13 | Art and audio for both sports | XL | — | — | sonnet |
| T-11.14 | Extensibility audit: confirm no engine-core, storage, or economy change was required (INV-9) | S | T-11.8 | US-14.4 | |

**Gate 11 (v1.1):** All four named sports playable in all three modes, and T-11.14 confirms the
module seam held.

---

## Cut order if effort runs short

Decided in advance so the decision isn't made under pressure. Cut from the top:

1. **Phase 11** — hockey and football (v1.1 was always a later release)
2. **T-10.7 / T-10.8** — Live lockstep P2P (Playbook P2P and async codes already deliver the bonus)
3. **T-8.14** — the transfer market (packs + sell-back are a complete economy without it)
4. **T-8.3** — tournament mode
5. **Phase 6 Playbook/arcade depth** — soccer ships Live-only, its Playbook and arcade sets follow

Never cut: engine quality, the cross-sport athlete system, Phase 9 UI/UX, the PWA lifecycle work, or
the test suite. Those are what make this the game you described rather than a tech demo.

## Parallelisation and delegation

- Phase 3 (athletes/roster) can start once T-2.2 lands, in parallel with Phase 2's later tasks.
- Art and audio tasks are independent of their gameplay siblings throughout.
- Arcade games T-4.5–T-4.9 and T-6.15 are independent of each other — ideal parallel subagent work.
- Achievement content (T-8.7) can be authored during Phase 7.
- The async challenge codes (T-10.1) depend on nothing in WebRTC and can ship any time after Phase 4.
- Test-suite tasks generally parallelise with the feature they cover, provided the interface is
  settled first.

See `CLAUDE.md` §7 for how to delegate these safely.
