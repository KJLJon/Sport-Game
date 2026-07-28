# Phase 0 notes — Foundation, PWA shell, update & offline lifecycle

Long-form rationale for the Phase 0 task rows in [`../PROGRESS.md`](../PROGRESS.md). The one-sentence version lives there; this
is the part a future session needs only when it touches the code.

---

## Task notes

### T-0.1

*Scaffold Vite + TypeScript (strict), ESLint, Prettier, Vitest, Playwright, folder layout per `04` §4*

pnpm 11. TS strict incl. `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`. Vitest defaults to the `node` environment; DOM suites opt in per file.

### T-0.2

*Derive `base` from repo name at build; lint rule + test banning literal paths (INV-4)*

`tools/base-path.ts` resolves `BASE_PATH` → `GITHUB_REPOSITORY` → fallback. Lint bans the literal in `src/`; the invariant test re-checks as text so an inline disable can't hide it.

### T-0.3

*App shell: canvas host, hash router, safe-area layout, orientation handling*

Hash routing (`04` §2 — Pages has no rewrites). Literal route segments beat `:params`. `chrome: 'bare'` drops header and tabs for Live. Rotate prompt is the iOS fallback where `orientation.lock` is absent. Screens load lazily; a superseded slow load is dropped rather than mounted late.

### T-0.4

*Design tokens + primitive components + dev-only component gallery route*

Tokens from `10` §3.1–3.3, dark-first with a light theme and an OS-following default. UI scale is one `--ui-scale` multiplier on the whole type scale. Primitives: button (5 variants × 5 states), segmented, switch, rating/progress bars, familiarity ring, stars, coin pill, dialog, sheet, toast, banner, empty/error/skeleton. `#/dev/ui` is dev-only and code-split. No `innerHTML` anywhere — untrusted roster data can't inject markup (`04` §12).

### T-0.5

*Web app manifest generated with base-path `id`/`scope`/`start_url`, full icon set incl. maskable*

`id`/`scope`/`start_url` are all the base path, so the install is a distinct app from any sibling PWA on the account. Icons are rasterised at build by `tools/png.ts` — a ~90-line PNG encoder — rather than adding an image dependency or committing binaries; 12 sizes plus maskable 192/512, 34 kB total. A `404.html` copy of `index.html` answers deep links, since Pages has no rewrites. The dev server serves the same manifest and icons the build emits.

### T-0.6

*Service worker: per-class cache strategies (`11` §2), atomic precache install, versioned caches, activate cleanup*

The `11` §2 table lives in pure functions in `strategies.ts` so every row is asserted without a SW environment. `sw.js` is built by a second Vite pass with the precache manifest injected from the emitted asset list; emitted unhashed at the base root, since its directory is what scopes it. **Bug found in verification:** navigation preload *rejects* rather than resolving `undefined` when offline, which failed the whole navigation — the exact offline cold-start `11` exists to prevent. Now caught. Also dropped `frame-ancestors` from the CSP meta: it is header-only and browsers log an error.

### T-0.7

*`version.json` emission + all five update-detection triggers (`11` §3)*

`version.json` is emitted at build and served `no-store` in dev and in the build. All five triggers wired: launch, foreground (throttled to 60 s), 15-minute poll, explicit check, and the version poll. The fifth is the one that matters — a deployed build that differs while nothing is waiting is reported as `stuck`, which is what lets T-0.10 offer Repair instead of the app silently doing nothing. `back online` is wired as a free sixth chance.

### T-0.8

*Update application: waiting-worker banner, safe-point auto-update, single-reload guard, `minSupportedVersion` force*

The whole of `11` §4 is one pure `decide()` function, so the policy is testable without a worker. Safe points: quiet screen, no match, no unsaved editor, no ceremony, idle ≥5 s. The reload guard is persisted, so a worker that keeps re-waiting cannot loop the app across reloads. A forced update outranks the snooze *and* the mid-match rule — it is reserved for builds that cannot load saves safely, so waiting is the more dangerous option.

### T-0.9

*Offline integrity self-check and self-heal; offline-readiness UI; "download everything for offline"*

Only the worker holds the precache manifest, so the page asks for it over `postMessage`. Missing non-critical entries heal silently when online and produce an honest notice when offline; a missing shell or entry chunk escalates straight to Repair. Check runs in an idle callback so it never costs launch time.

### T-0.10

*Repair flow — caches and SW only, IndexedDB untouched (INV-13); "check for update now"; version display*

Settings → App & updates shows running version, build, build date, and last check, so "am I on the new one?" is always answerable. INV-13 is asserted three ways: behaviourally against real IndexedDB, structurally (the module imports no IndexedDB code at all), and textually against the copy the UI must show.

### T-0.11

*`ScopedStorage`: namespaced IndexedDB, localStorage, and Cache Storage behind one module (INV-3)*

**Taken out of numeric order** — T-0.5/T-0.6 need the cache-name helpers. `scope.ts` is the only place a storage name is built. Prefs degrade to an in-memory store rather than throwing in Safari private mode. Cache deletion always filters on the namespace, so a sibling PWA on the same origin survives Repair (PWA-15). The INV-3 test checks the source as text, so an inline lint disable can't hide a violation. Vitest now runs under `base: '/test-scope/'`, so anything hardcoding the real repo name fails in CI.

### T-0.12

*Storage persistence request, quota/usage display, denial warning + backup prompt*

Asked on first write rather than at launch — browsers grant it more readily once engagement exists (`11` §7), and the nudger re-asks once per milestone. Denial and unsupported are distinct states with distinct copy, both pointing at a backup. Quota pressure warns at 80%.

### T-0.13

*Schema versioning + migration runner with pre-migration snapshot and rollback*

Forward-only chain per `05` §9. The snapshot covers every store, singletons included, and a failure rolls back the *whole* chain, not just the failing step — a partially-migrated database is worse than an unmigrated one. Data from a newer build is rejected outright rather than partially applied. Chain is empty at v1; the first entry will be `to: 2`.

### T-0.14

*Install UX: `beforeinstallprompt` capture, custom button, iOS-only A2HS instructions*

The event fires once and only replays inside a user gesture, so it is captured and the mini-infobar suppressed. iOS Safari gets the manual A2HS steps — and Chrome-on-iOS deliberately does not, since it has no such menu item. Four distinct states, each with its own copy.

### T-0.15

*GitHub Actions: CI (typecheck, lint, unit, e2e, a11y, coverage, budgets) + tagged Pages deploy*

CI runs typecheck, lint, coverage, traceability, PROGRESS check, a committed-report diff, build, budgets, then E2E in a second job against a real static build under the deployed base path. Deploy is tag-triggered and re-runs the gate first. Budgets: initial JS 9.5 KB / 200 KB, install 92 KB / 6 MB.

### T-0.16

*PWA lifecycle E2E suite: all sixteen scenarios in `11` §9*

All sixteen `11` §9 scenarios, driven by `tools/e2e-server.ts`, which can deploy a second build, 404 an asset, and refuse connections on demand. The "v2" build is the same bundle with its build hash rewritten — that is what names every cache and what `version.json` reports, so it is the real byte-level change the browser detects. **Four real bugs found and fixed** — see the Gate 0 record. PWA-4/5 assert the safe-point policy rather than staging a match, which Phase 2 does not yet make possible; noted as a follow-up.

### T-0.17

*Spec-header lint rule + traceability report generator (INV-15)*

Deliberately two checks: a plain-JS ESLint rule doing a presence check on the five mandatory fields with no filesystem access, so it runs on every keystroke; and the invariant test resolving every task and story ID against `03` and `02`, which is authoritative and runs in CI. `pnpm trace` writes `docs/traceability.md` both ways — currently 39 modules across 12 tasks.

---

## Gate record

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
