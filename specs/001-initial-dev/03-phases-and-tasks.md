# 03 — Phases and Tasks

## Conventions

- Task IDs are `T-<phase>.<n>` and are stable once written. Stories are the `US-x.y` from `02`.
- Size is rough implementation effort: **S** (<½ day), **M** (~1 day), **L** (2–3 days), **XL** (4+ days).
- A phase ends at a **gate**. Gates are checkpoints against the success criteria in `01` §5. If a
  gate fails, the fix comes before the next phase — later phases get cut, earlier quality does not.
- Phases 0–7 produce v1.0. Phase 8 is the P2P bonus. Phase 9 is the v1.1 sports expansion.

## Phase map

| Phase | Name | Delivers | Milestone |
|---|---|---|---|
| 0 | Foundation & PWA shell | Installable, offline, path-scoped empty app deployed to Pages | — |
| 1 | Engine core | Deterministic fixed-timestep sim, renderer, input, camera | — |
| 2 | Basketball vertical slice | A real 5v5 game vs a baseline CPU | **v0.1** |
| 3 | Athletes, ratings, roster | The cross-sport system and squad management | **v0.2** |
| 4 | Soccer & sport-module proof | Second sport through the module interface | **v0.3** |
| 5 | CPU AI & difficulty ladder | Team AI worth playing against, four difficulties | — |
| 6 | Modes, achievements, economy | Tournament, ~60 achievements, coins/packs/market | — |
| 7 | Polish, a11y, perf, data safety | Ship quality | **v1.0** |
| 8 | P2P (bonus) | WebRTC lockstep matches, trading, async codes | **v1.0.x** |
| 9 | Hockey & American Football | The remaining named sports | **v1.1** |

---

## Phase 0 — Foundation & PWA shell

Goal: an empty but genuinely installable, offline, correctly-scoped app, deployed by CI. Nothing in
later phases starts until deployment and scoping are proven, because retrofitting base-path
correctness is miserable.

| ID | Task | Size | Deps | Stories |
|---|---|---|---|---|
| T-0.1 | Scaffold Vite + TypeScript (strict), ESLint, Prettier, Vitest; folder layout per `04` §4 | S | — | — |
| T-0.2 | Derive `base` from the repo name at build time; assert no hardcoded path exists (lint rule + test) | S | T-0.1 | US-1.3 |
| T-0.3 | App shell: canvas host, screen router, safe-area-aware layout, landscape handling | M | T-0.1 | US-1.1, US-13.1 |
| T-0.4 | Web app manifest with base-path `id`/`scope`/`start_url`, icon set incl. maskable, theme/splash | M | T-0.2 | US-1.1 |
| T-0.5 | Service worker: precache from build manifest, versioned cache names prefixed by base path, offline-first routing, old-cache cleanup | L | T-0.4 | US-1.2, US-1.3, US-1.4 |
| T-0.6 | Update flow: detect waiting worker, non-blocking banner, user-confirmed skip-waiting + reload, suppressed during a match | M | T-0.5 | US-1.4 |
| T-0.7 | Install UX: `beforeinstallprompt` capture and custom button; iOS-only Add-to-Home-Screen instructions | M | T-0.4 | US-1.1 |
| T-0.8 | `ScopedStorage`: namespaced IndexedDB + localStorage wrappers, all keys prefixed by base path | M | T-0.2 | US-1.3 |
| T-0.9 | Persistence: request `navigator.storage.persist()`, surface quota/usage, warn when denied | S | T-0.8 | US-1.5 |
| T-0.10 | Schema versioning + migration runner with pre-migration snapshot and rollback | M | T-0.8 | US-12.2 |
| T-0.11 | GitHub Actions: build, typecheck, lint, test on push; deploy to Pages on tag | M | T-0.1 | — |
| T-0.12 | Playwright smoke: install manifest validity, offline cold load, scope assertions | M | T-0.5, T-0.11 | US-1.1, US-1.2, US-1.3 |
| T-0.13 | Design tokens: colour, type scale, spacing, ≥44 px target rules, light/dark | S | T-0.3 | US-13.2 |

**Gate 0:** Deployed to Pages. Installs on Android and iOS. Cold-launches offline. Every cache and
storage key is namespaced. CI green.

---

## Phase 1 — Engine core

Goal: a sport-agnostic, deterministic engine. No basketball anywhere in this code.

| ID | Task | Size | Deps | Stories |
|---|---|---|---|---|
| T-1.1 | Seeded PRNG (xoshiro/PCG) + lint rule banning `Math.random` inside `engine/` and `sports/` | S | T-0.1 | US-2.5 |
| T-1.2 | Fixed-timestep loop (60 Hz sim) with accumulator, render interpolation, pause/step/time-scale | M | T-1.1 | US-2.5 |
| T-1.3 | Entity model: struct-of-arrays athlete/ball state, spatial hash for neighbour queries | L | T-1.2 | US-2.5 |
| T-1.4 | Movement & steering: accel/max-speed/turn-rate from attributes, seek/arrive/pursue/avoid | L | T-1.3 | US-2.1 |
| T-1.5 | Collision & contact resolution: circle bodies, body-on-body contests weighted by strength/agility | L | T-1.3 | US-3.2 |
| T-1.6 | Ball physics: 2D position + height, gravity, bounce, spin/curve, possession attach/detach | L | T-1.3 | US-3.2, US-4.2 |
| T-1.7 | Canvas 2D renderer: layered draw, sprite/shape batching, LOD for distant entities, debug overlay | L | T-1.2 | US-2.3, US-2.5 |
| T-1.8 | Camera: ball follow with smoothing, dynamic zoom, bounds clamping, shake (respects reduced motion) | M | T-1.7 | US-2.3 |
| T-1.9 | Input layer: floating virtual joystick, context action buttons, handedness mirror, keyboard + gamepad | L | T-1.2 | US-2.1, US-2.6 |
| T-1.10 | Match state machine: pre-match → live → stoppage → period-break → final, with an event bus | M | T-1.2 | US-2.4 |
| T-1.11 | `SportModule` interface (`04` §5) + a trivial test sport to prove the seam | M | T-1.10 | US-14.4 |
| T-1.12 | Input recording + golden-seed replay determinism test in CI | M | T-1.1, T-1.10 | US-2.7 |
| T-1.13 | Perf harness: fps/frame-time/entity-count overlay, CI budget check on a headless benchmark | M | T-1.7 | US-2.5 |

**Gate 1:** The test sport runs 22 entities at 60 Hz sim / ≥55 fps render on the target device. Two
runs of the same seed + inputs produce byte-identical state hashes.

---

## Phase 2 — Basketball vertical slice → **v0.1**

Goal: prove the engine by making one sport genuinely fun. Includes a baseline CPU (not the full
difficulty ladder — that's Phase 5).

| ID | Task | Size | Deps | Stories |
|---|---|---|---|---|
| T-2.1 | Court geometry, zones, three-point arc, key, hoop, boundaries | M | T-1.11 | US-3.1 |
| T-2.2 | Basketball rules module: quarters, game clock, shot clock, possession, out-of-bounds, restarts | L | T-2.1 | US-3.1, US-2.4 |
| T-2.3 | Shooting: hold-release timing meter, arc trajectory, make probability from ratings × distance × pressure × release quality | L | T-1.6, T-2.1 | US-3.2 |
| T-2.4 | Passing: aimed pass, lead passing, interception checks, turnovers | M | T-1.6 | US-3.2 |
| T-2.5 | Dribbling & driving: ball-handling control, contact absorption, blow-by | L | T-1.5 | US-3.2 |
| T-2.6 | Rebounding: contest resolution from height/vertical/strength/box-out/timing | M | T-1.5 | US-3.2 |
| T-2.7 | Defence: on-ball marking, contest, steal, block, foul model, free throws | L | T-2.2 | US-3.3 |
| T-2.8 | Baseline CPU: role-based offence (spacing, cut, screen), man defence, possession decisions | XL | T-2.7 | US-7.1 |
| T-2.9 | Player-control switching: auto-switch on turnover, manual cycle, controlled-athlete indicator | M | T-1.9 | US-2.2 |
| T-2.10 | Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators | M | T-1.7 | US-2.3, US-2.4 |
| T-2.11 | Pause menu, quit, settings-in-match, post-match summary with box score | M | T-2.10 | US-2.4 |
| T-2.12 | Basketball art & audio pass: athlete/court rendering, ball, nets, whistle, crowd, SFX | L | T-1.7 | — |
| T-2.13 | Balance pass #1: shot percentages and pace land in plausible ranges over 100 simulated games | M | T-2.8 | US-3.1 |

**Gate 2 (v0.1):** A full basketball game is playable end to end on a phone against the CPU, offline,
from the installed app, and it's fun enough to play twice.

---

## Phase 3 — Athletes, cross-sport ratings, roster → **v0.2**

| ID | Task | Size | Deps | Stories |
|---|---|---|---|---|
| T-3.1 | Athlete schema + IndexedDB store, indexes, CRUD repository | M | T-0.8 | US-5.1, US-5.5 |
| T-3.2 | Attribute system: the eleven attributes, budget rules, random roll generator | M | T-3.1 | US-5.1 |
| T-3.3 | Derivation engine: weight matrix per sport, height/weight inputs, unit-tested invariants | L | T-3.2 | US-5.2 |
| T-3.4 | Familiarity model: per-sport familiarity, penalty curve, growth from minutes played | L | T-3.3 | US-5.2, US-5.3 |
| T-3.5 | Sport skill XP: levels, sub-skills, event-driven XP awards, diminishing returns | L | T-3.4 | US-5.3 |
| T-3.6 | Behavioural effect of familiarity: decision noise, control error, reaction penalty in the sim | M | T-3.4, T-2.8 | US-5.2 |
| T-3.7 | Profile editor UI: fields, attribute sliders, photo capture/upload, downscale + local store | L | T-3.2 | US-5.1 |
| T-3.8 | Athlete card: derived ratings, familiarity badge, "why this rating" explainer, cross-sport compare | M | T-3.3 | US-5.4 |
| T-3.9 | Roster browser: search, sort, filter by sport/rarity/rating, bulk select | M | T-3.1 | US-5.5 |
| T-3.10 | Teams: create/edit, name, colours, generic crests | M | T-3.1 | US-6.1 |
| T-3.11 | Lineup editor: formation/court diagram, drag-to-slot, position-fit warnings, auto-fill best | L | T-3.10 | US-6.2 |
| T-3.12 | Stamina & availability: in-match drain, inter-match recovery, injury/suspension flags | M | T-3.5 | US-6.3 |
| T-3.13 | Starter athlete set: fictional filler, enough for both sports, generated not hand-written | M | T-3.2 | US-5.6 |
| T-3.14 | Roster import: file + URL, schema validation, per-record errors, merge/conflict prompt, responsibility notice | L | T-3.1 | US-5.7 |
| T-3.15 | Roster + full-backup export/import with schema version checks and change preview | M | T-0.10 | US-5.8, US-12.1 |
| T-3.16 | Wire real athletes into basketball: lineups drive the sim instead of placeholder stats | M | T-3.11, T-2.8 | US-5.2 |

**Gate 3 (v0.2):** Create an athlete, play them in basketball, watch familiarity move over several
matches, export a backup, wipe data, reimport, and be exactly where you left off.

---

## Phase 4 — Soccer & sport-module proof → **v0.3**

The real test: soccer should be additive, not invasive. Any engine-core change needed here is a
design bug to fix in the core, not to work around in the sport module.

| ID | Task | Size | Deps | Stories |
|---|---|---|---|---|
| T-4.1 | Pitch geometry, zones, goals, boundary lines | M | T-1.11 | US-4.1 |
| T-4.2 | Soccer rules module: halves, clock, stoppage time, restarts, throw-ins, corners, goal kicks | L | T-4.1 | US-4.1 |
| T-4.3 | Offside detection and enforcement | M | T-4.2 | US-4.1 |
| T-4.4 | Fouls, advantage, cards, free kicks, penalties | L | T-4.2 | US-4.1, US-4.3 |
| T-4.5 | Passing suite: short, through-ball, lofted, cross, with weight and error from ratings | L | T-1.6 | US-4.2 |
| T-4.6 | Shooting: power meter, placement, curve, deflections | M | T-1.6 | US-4.2 |
| T-4.7 | Dribbling & sprint: close control, stamina drain, shielding | M | T-1.5 | US-4.2 |
| T-4.8 | Defending: pressure, standing/slide tackle, foul risk model | M | T-4.4 | US-4.3 |
| T-4.9 | Goalkeeper AI: positioning, shot-stopping, claims, distribution; manual control on penalties | L | T-4.6 | US-4.3 |
| T-4.10 | Formations: 4-4-2 / 4-3-3 / 3-5-2 data-driven, with role positioning and shape shifting by phase | L | T-4.2 | US-4.1 |
| T-4.11 | 22-entity performance work: LOD, culling, spatial-hash tuning, allocation elimination | L | T-1.13 | US-2.5 |
| T-4.12 | Camera & minimap tuning for the larger pitch | M | T-1.8 | US-2.3 |
| T-4.13 | Soccer derivation weights, sub-skills, and familiarity tuning | M | T-3.3 | US-5.2 |
| T-4.14 | Soccer art & audio pass | L | T-2.12 | — |
| T-4.15 | Refactor: extract anything basketball-shaped that leaked into engine core | M | T-4.2 | US-14.4 |
| T-4.16 | Balance pass #2: goals per game, possession, shot conversion in plausible ranges over 100 sims | M | T-4.10 | US-4.1 |

**Gate 4 (v0.3):** Both sports playable, ≥55 fps at 11v11 on target hardware, and the diff for
Phase 4 touches `engine/` only for genuine core improvements.

---

## Phase 5 — CPU AI and difficulty ladder

| ID | Task | Size | Deps | Stories |
|---|---|---|---|---|
| T-5.1 | Utility-scoring decision framework shared across sports (options, scorers, weights) | L | T-2.8 | US-7.1 |
| T-5.2 | Role system: per-sport role tables driving off-ball movement and responsibilities | L | T-5.1 | US-7.1 |
| T-5.3 | Team-level coordination: formation shape, pressing triggers, help defence, transition | XL | T-5.2 | US-7.1 |
| T-5.4 | Basketball AI depth: pick-and-roll, cuts, zone vs man, shot selection by rating | L | T-5.3 | US-3.3 |
| T-5.5 | Soccer AI depth: build-up phases, pressing lines, offside trap, counter-attack | L | T-5.3 | US-4.3 |
| T-5.6 | Difficulty model: reaction latency, decision noise, error injection, aggression, assist strength — with a test asserting zero attribute modification | M | T-5.1 | US-7.2 |
| T-5.7 | Assist system: aim assist, pass assist, auto-switch, independently tunable + no-assist bonus | M | T-5.6 | US-7.3 |
| T-5.8 | CPU team generation: coherent opponent squads and identities scaled to difficulty | M | T-3.13 | US-7.1 |
| T-5.9 | AI regression harness: headless sim batches per difficulty, asserted win-rate bands | M | T-5.6 | US-7.2 |
| T-5.10 | Balance pass #3: tune the four levels against the target win-rate curve | L | T-5.9 | US-7.2 |

**Gate 5:** On Rookie a new player wins comfortably; on Legend an experienced player loses more than
they win. Automated batches confirm the win-rate bands, and no code path scales attributes by
difficulty.

---

## Phase 6 — Modes, achievements, economy

| ID | Task | Size | Deps | Stories |
|---|---|---|---|---|
| T-6.1 | Home screen + Quick Play (two taps to a match) | M | T-3.11 | US-10.1 |
| T-6.2 | Exhibition setup: sport, teams, difficulty, period length, rules toggles | M | T-6.1 | US-10.2 |
| T-6.3 | Tournament mode: 4/8/16 bracket, persistence, results, rewards | L | T-6.2 | US-7.4 |
| T-6.4 | Match checkpointing and resume-after-kill | M | T-1.10 | US-10.3 |
| T-6.5 | Stats store: match history, box scores, per-athlete career stats per sport | M | T-3.1 | US-10.4 |
| T-6.6 | Achievement engine: declarative definitions, event-stream evaluation, progress tracking, once-only grants | L | T-6.5 | US-8.1, US-8.3 |
| T-6.7 | Achievement content: ~60 definitions across all categories, incl. cross-sport and hidden | L | T-6.6 | US-8.1, US-8.4 |
| T-6.8 | Achievement UI: gallery, filters, progress bars, in-match toast, post-match summary | M | T-6.6 | US-8.2 |
| T-6.9 | Wallet & coin ledger: earning rules, difficulty scaling, first-win-of-day, itemised post-match payout | M | T-6.5 | US-9.1, US-9.5 |
| T-6.10 | Athlete generator: procedural fictional athletes with coherent attribute spreads by rarity and primary sport | L | T-3.2 | US-9.2 |
| T-6.11 | Packs: tiers, prices, published odds, pity timer, reveal animation with skip | L | T-6.10, T-6.9 | US-9.2 |
| T-6.12 | Sell-back: valuation formula, squad-lock guard, confirmation, anti-farm invariant test | M | T-6.9 | US-9.3 |
| T-6.13 | Transfer market: rotating listings, timed refresh with tamper-resistant clamping, paid refreshes, buy-offers, seeded price walk | XL | T-6.12 | US-9.4 |
| T-6.14 | Economy balance pass: pack EV vs sell value vs earn rate; no infinite-coin loop (proven by simulation) | M | T-6.13 | US-9.3 |

**Gate 6:** A new save can be played from zero coins to a meaningfully improved roster without any
loop that generates coins faster than it consumes them.

---

## Phase 7 — Polish, accessibility, performance, data safety → **v1.0**

| ID | Task | Size | Deps | Stories |
|---|---|---|---|---|
| T-7.1 | Per-sport interactive control tutorials, replayable, plus a pause-menu rules reference | L | T-4.2 | US-13.4 |
| T-7.2 | Settings screen: controls, handedness, assists, UI scale, palettes, motion, haptics, audio, data | M | T-5.7 | US-13.1–US-13.3 |
| T-7.3 | Accessibility pass: contrast audit, colourblind palettes, non-colour team differentiation, focus order, target sizes | L | T-7.2 | US-13.2 |
| T-7.4 | Mobile polish: orientation handling, safe areas, gesture suppression, haptics, wake lock during matches | M | T-7.2 | US-13.1 |
| T-7.5 | Audio system: music/SFX buses, volume, mute, interaction-gated start | M | T-2.12 | US-13.3 |
| T-7.6 | Performance hardening: bundle budget, code splitting per sport, asset compression, GC-pressure elimination | L | T-4.11 | US-2.5 |
| T-7.7 | Data safety finishing: erase-all with typed confirm, backup nudges after milestones, migration tests across versions | M | T-0.10 | US-12.1–US-12.3 |
| T-7.8 | Onboarding flow: first-launch tour, starter roster explanation, first-athlete prompt | M | T-3.13 | US-5.6 |
| T-7.9 | Error handling: global boundary, crash-safe state dump, non-technical recovery UI | M | — | US-12.2 |
| T-7.10 | Cross-device test matrix: Android Chrome, iOS Safari, desktop browsers; fix fallout | L | all | — |
| T-7.11 | Docs: README with install instructions, roster-file schema, controls, limitations, licence | M | — | US-5.7 |
| T-7.12 | v1.0 release: tag, Pages deploy, verify install-from-scratch on real devices | S | all | S1–S8 |

**Gate 7 (v1.0):** Every success criterion S1–S8 in `01` §5 passes on a real mid-range Android phone
and a real iPhone.

---

## Phase 8 — P2P (bonus) → **v1.0.x**

| ID | Task | Size | Deps | Stories |
|---|---|---|---|---|
| T-8.1 | Async challenge codes first: seed + rules + result encoding, share link, comparison screen | L | T-1.12 | US-11.4 |
| T-8.2 | WebRTC session layer: offer/answer creation, ICE gathering completion, data channel setup | L | — | US-11.1 |
| T-8.3 | Signal payload codec: SDP trimming, compression, base64url, size budget for QR | M | T-8.2 | US-11.1 |
| T-8.4 | On-device QR generation and camera-based scanning, with copy/paste fallback | L | T-8.3 | US-11.1 |
| T-8.5 | Connection UI: host/join flow, state reporting, plain-language failure guidance, STUN settings | M | T-8.4 | US-11.1 |
| T-8.6 | Lockstep netcode: input delay buffer, shared seed, tick synchronisation, stall handling | XL | T-8.2, T-1.12 | US-11.2 |
| T-8.7 | Desync detection: periodic state hashing, mismatch surfaced honestly, clean abandon | M | T-8.6 | US-11.2 |
| T-8.8 | Reconnect and graceful teardown with no data corruption | M | T-8.6 | US-11.2 |
| T-8.9 | Custody ledger: per-install keypair, signed transfer receipts, provenance chain, duplicate refusal | L | T-3.1 | US-11.3 |
| T-8.10 | Trade UI: proposal, card review, dual confirmation, atomic apply, traded-athlete flagging and honest trust notice | L | T-8.9 | US-11.3 |
| T-8.11 | Two-device test protocol: same-LAN, cross-network, STUN off, backgrounding, NAT-failure fallback | M | T-8.6 | US-11.1, US-11.2 |

**Gate 8:** Two phones on the same Wi-Fi complete a full match with no desync, and a trade moves an
athlete exactly once.

---

## Phase 9 — Hockey & American Football → **v1.1**

| ID | Task | Size | Deps | Stories |
|---|---|---|---|---|
| T-9.1 | Hockey: rink geometry, puck physics, skating movement model | L | T-1.11 | US-14.1 |
| T-9.2 | Hockey rules: periods, faceoffs, offside, icing, penalties and power plays | L | T-9.1 | US-14.1 |
| T-9.3 | Hockey actions: passing, one-timers, shooting, deflections, checking, goaltending | XL | T-9.2 | US-14.1 |
| T-9.4 | Football: field geometry, downs and distance, clock rules incl. two-minute | L | T-1.11 | US-14.2 |
| T-9.5 | Football play-call layer: offensive and defensive playbooks, pre-snap adjustments | XL | T-9.4 | US-14.2 |
| T-9.6 | Football actions: snap, QB throw with receiver targeting, running, blocking, tackling, kicking | XL | T-9.5 | US-14.2 |
| T-9.7 | Derivation weights, sub-skills, and familiarity tuning for both new sports | M | T-3.3 | US-14.3 |
| T-9.8 | Achievements and economy content extended to both sports | M | T-6.7 | US-14.3 |
| T-9.9 | Art & audio for both sports | XL | — | — |
| T-9.10 | Extensibility audit: confirm the additions required no engine-core, storage, or economy changes | S | T-9.6 | US-14.4 |

**Gate 9 (v1.1):** All four originally named sports playable, and T-9.10 confirms the module seam
held.

---

## Definition of done (every task)

1. TypeScript strict passes; ESLint clean, including the no-`Math.random`-in-sim and
   no-hardcoded-base-path rules.
2. Unit tests for pure logic (ratings, economy, rules resolution); deterministic replay tests still
   pass on the golden seeds.
3. Verified on a real mobile device, not only a desktop emulator, for anything touching input,
   layout, or performance.
4. Works offline where the feature is meant to.
5. Any new persisted data has a schema version and a migration.
6. No hardcoded base path, no new runtime network dependency, no new external asset host.
7. Committed to `claude/multi-sport-pwa-game-50k7u7` with a message referencing the task ID.

## Parallelisation notes

Where work can proceed simultaneously if more than one stream is available:

- Phase 3 (athletes/roster) is largely independent of Phase 2's late gameplay tasks and can start
  once T-2.2 lands.
- Art/audio tasks (T-2.12, T-4.14, T-9.9) are independent of their gameplay siblings.
- Phase 6's achievement content (T-6.7) can be authored during Phase 5.
- Phase 8's async challenge codes (T-8.1) do not depend on WebRTC and can ship before it.
