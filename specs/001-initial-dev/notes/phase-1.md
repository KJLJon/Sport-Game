# Phase 1 notes — Engine core

Long-form rationale for the Phase 1 task rows in [`../PROGRESS.md`](../PROGRESS.md). The one-sentence version lives there; this
is the part a future session needs only when it touches the code.

---

## Task notes

### T-1.1

*Seeded PRNG + lint rule banning `Math.random` in `engine/`, `sports/` (INV-2)*

sfc32 seeded through splitmix32, all int32 ops so two engines produce byte-identical streams; a float generator could not promise that. `fork(label)` derives from seed + label, **not** from the parent's position, so adding a draw in one subsystem cannot shift another's results — that is what makes determinism survive refactors. `snapshot()`/`restore()` carry the pending Box–Muller spare, so a replay checkpoint resumes mid-pair. A golden-seed test pins the first eight values: changing the algorithm invalidates every recorded replay, so it should be a deliberate decision. `randomSeed()` is the one non-deterministic call, and it uses `crypto.getRandomValues`. The lint rule was already in place from T-0.1; INV-2's test scans `engine/`, `sports/`, `modes/` as text (an inline disable cannot hide a substring) and also asserts the lint rule still covers all three directories.

### T-1.2

*Fixed-timestep loop (60 Hz) with accumulator, render interpolation, pause/step/time-scale*

Split in two: `Clock` holds the accumulator and *only* the timing policy, `createLoop` converts frame timestamps into deltas. Everything worth testing is therefore testable with no browser, no timers, and no waiting — the frame source is injected. Two clamps, not one: `maxFrameMs` (250) throws away a backgrounded tab's minutes before they reach the accumulator, and `maxStepsPerFrame` (5) is the spiral-of-death guard, which discards the backlog rather than banking it. `alpha` holds still while paused so a paused frame renders identically instead of shimmering. Resume does not clear the accumulator — the driver drops the paused wall time instead, so resuming never bursts. Step size is fixed at every time scale: slow motion changes how much time accumulates, never what the sim sees. Verified at 30/60/120 fps that simulated time matches to within one step.

### T-1.3

*Entity model: struct-of-arrays state, spatial hash for neighbour queries*

SoA typed arrays: the hot loops touch one field across all entities, and typed arrays give the GC nothing to collect mid-match (`01` R2). Uniform grid rebuilt per step by counting sort — O(n + cells), allocation-free, and simpler than incremental updates at 22 entities. Two determinism decisions: `spawn` claims the *lowest* free slot, not the most recently freed, so a replay assigns the same ids; and the grid is filled in ascending id order, so query results come out id-ordered without a sort (INV-8). Queries write into a caller-owned `Int32Array` and stop at its length, so the hot path allocates nothing. Distances are 2D on purpose — a ball 3 m up is still near the athlete catching it. Correctness is checked against brute force over 40 random 22-entity layouts, plus cell-boundary and out-of-field cases.

### T-1.4

*Movement & steering from attributes: accel, max speed, turn rate, seek/arrive/pursue/avoid*

The engine never sees attributes: `movementProfile()` takes *derived ratings* (1–99, the output of `05` §3) and returns metres and seconds, so the sport seam stays honest. Three limits do all the work — top speed 4.0–8.5 m/s, acceleration 3–9 m/s², turn rate 4–12 rad/s — and `MOVEMENT_TUNING` is the single feel-tuning surface. Integration order is rotate → change speed → move: rotating the current velocity rather than snapping to the desired one is what makes a joystick flick read as a body turning. A near-stationary athlete may pivot freely, otherwise starting off feels sticky. Steering behaviours are pure functions writing into caller-owned vectors (zero allocation). Two deliberate choices: separation weights by `1 − d/r` rather than `1/d²`, because inverse-square makes touching athletes fire apart like a bug; and `avoid()` returns `false` when no dodge is needed, so callers fall through to real intent instead of blending a zero vector.

### T-1.5

*Collision & contact contests weighted by strength/agility*

Two separate problems, kept separate: `resolveCollisions()` is deterministic geometry with no randomness at all, `contest()` is the seeded ratings decision sports build rebounds and tackles on. Contact is soft on purpose — positional correction at 40% of the overlap per step, mass-weighted — because impulse separation at 60 Hz jitters between two athletes who both want the same spot, which is most of a possession. Pairs are taken once with `a < b`, so the result never depends on visit order. Coincident athletes get a contact normal derived from their ids: INV-2 forbids a random one, and a random one would diverge a replay the moment two players stack. The contest curve is logistic over a rating difference with divisor 25 — a 20-point edge is ~65–70%, and even 99-vs-1 leaves the underdog a few percent, which is what keeps a low-rated squad playable. Separation settles to within `OVERLAP_EPSILON` (1 mm) rather than exactly zero, deliberately.

### T-1.6

*Ball physics: position + height, gravity, bounce, spin/curve, possession attach/detach*

The ball lives in the same `World` as the athletes (using `z`/`vz`), so neighbour queries find it for free, and it is flagged `INTANGIBLE` so contact resolution never shoves an athlete off their line as it rolls past. Possession is a state the *ball* holds, not a flag on an athlete: exactly one carrier can exist, so "who has it" is unambiguous and losing it is one assignment. A carried ball does not integrate — it is placed ahead of its carrier, which feels better than simulating a constrained dribble. **Bug found and fixed in test:** treating "airborne" as `z > radius` alone gave every bounce one gravity-free step of rise, injecting enough energy for a permanent low limit cycle — the ball never settled. Airborne is now `z > radius

### T-1.7

*Canvas 2D renderer: layers, batching, LOD, off-screen static layers, debug overlay*

Everything works against `Canvas2D`, the subset of the real context actually used, so layer and LOD policy is unit-tested against a recording double instead of a real canvas — 29 tests, no jsdom. Layer order is fixed and named, not caller-controlled: "why is the ball behind the crowd" is not a bug worth having twice. The HUD layer alone draws in screen space. Three fill-rate levers in payoff order: blit a static field drawn once into an off-screen canvas (keyed on court + theme + size, so a theme switch redraws and nothing else does); batch draws sharing a style so the context changes state once per batch rather than per entity; and drop detail by distance. LOD is *ratio*-based against the viewport half-diagonal, so it behaves the same on a phone and a tablet and at every zoom. `FrameStats` reports commands, style changes, and the LOD split — the numbers T-1.13's budget check needs.

### T-1.8

*Camera: ball follow, smoothing, dynamic zoom, bounds clamp, shake (reduced-motion aware)*

Render-side only: it advances on frame time and nothing in `physics/` or a sport may read it — a camera that influenced the sim would make what you see change what happens. Smoothing uses `1 − e^(−rate·dt)` rather than `gap × rate × dt`, so a 30 fps device and a 120 fps device see identical motion; the naive form lags more on the slower device, which is the one that can least afford to look worse. Lookahead leads the ball so the player sees where play is going. The bounds clamp centres an axis the viewport is wider than, rather than jamming the field against one edge. Shake is seeded (INV-2 — an unseeded shake makes two replays of one match visibly different) and under reduced motion is skipped entirely rather than scaled down, along with the lookahead lead: `10` §6 exists for people motion makes ill, and a small shake is still motion.

### T-1.9

*Input layer: floating joystick, context buttons, handedness mirror, keyboard, gamepad*

Three devices reduce to one `InputFrame`, so nothing downstream can tell which produced it — that is what makes US-2.6 free rather than a second control path, and what makes T-1.12's recording a recording of the game rather than of a thumb. Sources are fed plain data (key codes, pointer coordinates, a gamepad snapshot), never DOM events, so every mapping rule is tested with no browser. Stick feel: floating origin, deadzone *rescaled* rather than stepped (otherwise the first responsive pixel jumps to 18% speed), and the origin drags along past full deflection so a thumb that wanders mid-sprint keeps control — the single most-noticed difference between a virtual stick that feels good and one that does not. Handedness mirrors zones and button positions from one code path, not two layouts. Device precedence is last-used-wins: a player with a pad plugged in who reaches for the screen gets the screen, with no setting to find. Keyboard diagonals are normalised.

### T-1.10

*Match state machine + `SportEvent` bus (the contract all three modes emit)*

INV-9 is enforced by *omission*: `SportEvent` has no `mode` field, so a consumer physically cannot branch on which mode produced an event — a shape decision rather than a code-review rule. Time is counted in simulation steps, never wall-clock, so a replay and a live match produce identical clocks (INV-8). One machine serves all three modes: Playbook advances it a turn at a time, an arcade session drives a single-period instance. A stoppage still consumes total time (replays line up) but only advances the period clock when the sport says so — basketball stops, soccer does not. Bus listeners are synchronous and in subscription order (an achievement that fires "later" cannot be part of a deterministic replay), and one listener throwing is contained rather than taking the match down. Methods guard themselves as well as the transition table: `preMatch → live` is a legal edge, so `nextPeriod()` before kick-off would otherwise silently start the match at period 2.

### T-1.11

*`SportModule` interface (`04` §5, `09` §5) + a trivial test sport proving the seam*

The seam is entirely *pull*-shaped: the engine calls the sport, never the reverse. A sport that could reach into the loop, renderer, or bus would slowly acquire engine responsibilities and the seam would rot into a suggestion. `SportRegistry` is a map, not a switch — the mechanical form INV-5 takes is that there is nowhere in the engine to write `if (sport === 'basketball')`. `step()` *returns* events rather than emitting them, so the caller orders them against the clock and a headless balance run needs no bus at all. Playbook/Arcade adapters (`09` §5) are deferred to Phases 4–5 rather than stubbed. The test sport (`src/sports/testsport/`) is deliberately trivial — chase a ball, carry it into a goal — because a bug in a simple sport is an engine bug, whereas a bug in basketball might be basketball's. It is T-1.12's determinism fixture and Gate 1's subject.

### T-1.12

*Input recording + golden-seed determinism tests in CI (INV-8)*

A match is `(seed, setup, inputs)` and nothing else, which buys replays, resume-from-a-triple, headless balance batches, and the P2P desync check from one mechanism. Recording is run-length encoded because held input is the common case: two seconds of sprint is 120 identical frames, and 600 held steps compress to a single run under 100 bytes. Entities are recorded in ascending id order regardless of map order, so two runs of a match produce byte-identical recordings. State hashes are FNV-1a over values **quantised to a millimetre** — hashing raw floats would fail on differences no player could see and no bug caused, so quantising is what makes the hash a behavioural check rather than a floating-point one.

### T-1.13

*Perf harness: fps/frame-time/entity overlay + CI budget check on a headless benchmark*

Percentiles, not averages: a match that averages 60 fps and stutters twice a second is a bad match, and a mean hides exactly that — so p95 is what `12` §6 budgets and p95 is what this reports, alongside a jank ratio. The monitor writes into pre-sized ring buffers and sorts into a reusable scratch array, because a performance monitor that allocates is measuring itself. The CI benchmark is deliberately headless and sim-only: render time depends on whatever GPU the runner has, and a budget that changes with the runner is a flaky test rather than a budget. A discarded warm-up pass keeps the first hundred steps (which measure the JIT) out of the number.

---

## Gate record

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
