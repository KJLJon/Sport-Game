# 12 — Quality, Testing, and Verification

Every task carries verification steps. Nothing is marked done on the strength of "it looked right".

## 1. Test pyramid

| Layer | Tool | What it covers | Runs |
|---|---|---|---|
| **Unit** | Vitest | Pure logic: rating derivation, familiarity, XP, economy formulas, rules resolution, Playbook resolution math, arcade calibration, migrations, codecs | Every commit |
| **Determinism** | Vitest + golden seeds | Identical state hashes across runs and across builds | Every commit |
| **Property** | Vitest + fast-check | Invariants over generated inputs: ratings stay in range, no negative coins, no impossible scores, migrations idempotent | Every commit |
| **Integration** | Vitest + fake-indexeddb | Repositories, backup round-trip, migration chains, achievement evaluation over event streams | Every commit |
| **Simulation** | Headless batch runner | Balance: score distributions, win rates per difficulty, cross-mode parity, economy loop closure | Nightly + before each gate |
| **Component** | Playwright component tests | Every UI component's state matrix | Every commit |
| **Visual regression** | Playwright screenshots | Every screen, both themes, both orientations, 1.0× and 1.3× scale | Every commit |
| **E2E** | Playwright | User journeys, PWA lifecycle (`11` §9), offline, storage scoping | Every commit |
| **Accessibility** | axe-core via Playwright | Contrast, roles, labels, focus order on every screen | Every commit |
| **Performance** | Custom harness in CI | Frame time, sim step time, bundle size, memory growth | Every commit |
| **Manual device** | Checklists per phase | Touch feel, haptics, iOS behaviours, real framerate, P2P across two phones | Each phase gate |

## 2. Coverage requirements

| Area | Line coverage | Rationale |
|---|---|---|
| `src/athletes/`, `src/economy/`, `src/achievements/` | ≥95% | Pure math the whole game depends on; cheap to test |
| `src/sports/*/rules`, `src/sports/*/playbook` | ≥90% | Rules bugs are the most player-visible |
| `src/storage/` incl. migrations | ≥95% | Data loss is the worst outcome in the app |
| `src/engine/` | ≥80% | Some rendering is impractical to unit test |
| `src/ui/` | ≥70% + full component-state coverage | Visual regression carries the rest |
| `src/p2p/` | ≥85% | Hard to reproduce in the field |
| Overall | ≥85% | |

Coverage thresholds are enforced in CI and may not be lowered to make a build pass.

## 3. Invariant tests

These protect design decisions rather than code, and each one has a named test file. If one of these
fails, the design has drifted, not just the implementation.

| ID | Invariant | Source |
|---|---|---|
| INV-1 | Difficulty changes no athlete attribute or derived rating on either team | `07` D-10 |
| INV-2 | No `Math.random` is reachable from the simulation or Playbook resolution | `07` D-11 |
| INV-3 | Every storage key, database name, and cache name carries the base-path namespace | `07` D-09 |
| INV-4 | No literal repository path exists anywhere in `src/` | `07` D-12 |
| INV-5 | For every pack tier, expected sell value < price (no coin loop) | `05` §5.5 |
| INV-6 | For any athlete, sell price < market ask | `05` §5.5 |
| INV-7 | Achievement rewards are granted at most once, across any migration path | `05` §6 |
| INV-8 | The same seed and inputs produce identical state hashes | `07` D-11 |
| INV-9 | All three modes emit the same `SportEvent` shapes; no consumer branches on mode | `09` §5 |
| INV-10 | Arcade window size is a function of athlete ratings, not of the player's past scores | `09` §2.4 |
| INV-11 | Cross-mode outcome parity: the same rosters produce win rates within ±8% in Live and Playbook | `09` §7 |
| INV-12 | Reward rate per minute is within ±25% across modes | `09` §7 |
| INV-13 | Repair deletes only namespaced caches and never touches IndexedDB | `11` §6 |
| INV-14 | No runtime network request goes anywhere except configured STUN hosts | `04` §12 |
| INV-15 | Every module in `src/` carries a valid spec header resolving to a real task and story | `CLAUDE.md` §6 |

## 4. Per-task verification

Every task in `03` has verification steps recorded in `PROGRESS.md`. The minimum for any task:

1. **Automated** — the specific tests added or extended for this task, named in the progress entry.
2. **Suite** — the full test suite passes, coverage thresholds hold, no invariant regressed.
3. **Manual** — for anything touching input, layout, animation, or performance: run it on a real
   phone and record a one-line observation in the progress entry.
4. **Spec trace** — the code carries its spec header; the traceability report resolves it.

Tasks that add gameplay also record a **feel note**: one honest sentence about whether it's actually
fun. Not testable, still worth writing down, and the difference between a working game and a good
one.

## 5. Balance simulation harness

A headless runner (`tools/sim.ts`) plays matches without rendering, at hundreds per minute.

```
pnpm sim --sport basketball --mode live --difficulty all-star --games 500 --seed 42
```

Reports: score distribution, shooting percentages, pace, possessions, foul rate, win rate by
difficulty, stamina curves, and — across modes — outcome parity. Regression baselines are committed
as JSON, and a shift beyond tolerance fails CI, so a "harmless" tuning change can't silently break
balance elsewhere.

The same harness backs the economy check: simulate 200 matches of earning, buying, opening, and
selling, and assert the coin balance curve stays in the intended band with no unbounded growth.

## 6. Performance budgets (CI-enforced)

| Metric | Budget | Measured by |
|---|---|---|
| Initial JS, gzipped | ≤200 KB | Bundle analysis |
| Total precache size | ≤6 MB | Build manifest |
| Sim step, 22 entities | ≤4 ms | Headless benchmark |
| Frame time, Live 11v11 | ≤16 ms p95 | Instrumented run |
| Frame time, menus | ≤16 ms p95 | Instrumented run |
| Time to interactive, cold, mid-range | ≤2.5 s | Lighthouse CI |
| Allocation during a match | ~0 steady state | Heap sampling |
| Lighthouse PWA score | 100 | Lighthouse CI |

## 7. Manual device matrix

Run at every phase gate; results recorded in `PROGRESS.md` under the gate entry.

| Device class | Checks |
|---|---|
| Mid-range Android (Chrome) | Framerate, install, offline cold start, haptics, touch feel |
| iPhone (Safari) | Add-to-Home-Screen, standalone launch, storage persistence, no vibration, safe areas |
| Tablet | Layout at large sizes, hot-seat comfort |
| Desktop (Chrome/Firefox/Safari) | Keyboard, gamepad, window resize, left rail layout |
| Two phones | P2P over Wi-Fi and over mobile data (Phase 10) |

## 8. Definition of done (per task)

1. Implemented to the story's acceptance criteria.
2. Tests added at the appropriate layers; whole suite green; coverage thresholds held.
3. No invariant regressed.
4. Spec header present and resolving; traceability report clean.
5. Verified on a real device where relevant, with the observation recorded.
6. `PROGRESS.md` updated in the same commit.
7. Committed and pushed.

## 9. Definition of done (per phase gate)

1. Every task in the phase is done.
2. Full suite green, including nightly simulation baselines.
3. Manual device matrix run and recorded.
4. The gate's own criteria (from `03`) demonstrably met.
5. Performance budgets held.
6. Accessibility audit clean for anything new.
7. A tagged, deployed build that installs from the Pages URL and works offline.
8. Gate result written into `PROGRESS.md` with links to the commit and the deployed build.
