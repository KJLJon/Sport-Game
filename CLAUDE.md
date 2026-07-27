# CLAUDE.md — How to build this project

Operating instructions for any Claude session working on Sport-Game. Read this first, every session.

The specification is in [`specs/001-initial-dev/`](./specs/001-initial-dev/). It is the source of
truth for **what** to build. This file is the source of truth for **how** to build it.

---

## 1. Start-of-session checklist

Run this every time, including mid-phase resumes. It takes two minutes and prevents duplicated or
conflicting work.

1. `git fetch origin && git status` — confirm you are on the branch this session was assigned (each
   session gets its own `claude/…` feature branch) and up to date. Create it from the default branch
   if it doesn't exist.
2. Read [`specs/001-initial-dev/PROGRESS.md`](./specs/001-initial-dev/PROGRESS.md) — specifically the
   **In-flight** block at the top. If a task is `in_progress`, that is your work; resume from its
   checkpoint notes.
3. Read [`specs/001-initial-dev/README.md`](./specs/001-initial-dev/README.md) for orientation, then
   the specific spec sections your task references.
4. If a build exists: `pnpm install && pnpm test` — know whether you're starting from green.
5. Only then pick up work.

**Never start a new task while another is `in_progress`.** Finish it or explicitly park it with a
recorded reason.

---

## 2. The work loop

```
pick next task → mark in_progress → implement in checkpoints
   → (commit + push at every checkpoint)
   → verify → update PROGRESS.md → commit + push → mark done
```

**Picking the next task.** Take the lowest-numbered task in the current phase whose dependencies are
all `done`. Don't skip ahead into the next phase before the current gate passes. If several tasks are
ready and independent, consider delegating (§7).

**Checkpoints.** Break a task into 20–40 minute chunks. Commit at the end of each one, even if the
task isn't finished — `wip(T-x.y):` prefix. This is what makes interruption cheap.

**Never leave the working tree dirty at the end of a turn.** Commit and push, always.

---

## 3. PROGRESS.md — the resumable state

`PROGRESS.md` is the project's memory. It is updated **in the same commit as the work it describes**,
never in a separate bookkeeping commit.

### 3.1 The In-flight block

Kept at the top of the file. Exactly one task, or none.

```markdown
## In-flight

- **Task:** T-2.3 — Shooting
- **Status:** in_progress
- **Started:** 2026-07-28
- **Branch commit:** abc1234
- **Done so far:**
  - [x] Release-timing meter with rating-driven window
  - [x] Arc trajectory integrated with ball physics
  - [ ] Make-probability model (distance × pressure × release)
  - [ ] Unit tests for the probability curve
- **Next step:** implement `shotProbability()` in `src/sports/basketball/shooting.ts`,
  following `06` §3.1
- **Files touched:** src/sports/basketball/shooting.ts, src/sports/basketball/types.ts
- **Blockers:** none
- **Notes:** contest height needs defender arm-reach from heightCm; added a TODO in types.ts
```

Update it at every checkpoint. If you are interrupted, this block plus the pushed commits is a
complete handover — a fresh session should be able to continue with no other context.

### 3.2 The task table

One row per task, mirroring `03`. Statuses: `todo` · `in_progress` · `blocked` · `done` · `cut`.

| Column | Meaning |
|---|---|
| Task | `T-x.y` |
| Status | as above |
| Commits | short SHAs of the commits implementing it |
| Tests | the test files added or extended |
| Verified | `auto` · `auto+device` · a note on what was checked manually |
| Notes | anything a future session needs, including a feel note for gameplay tasks |

### 3.3 Gate records

When a phase gate is evaluated, append a record: date, result, the checks run, the device matrix
results, the tag deployed, and anything deferred with a reason.

---

## 4. Commits and pushes

**Commit often. Push every commit.** The user has explicitly asked for this so an interrupted session
loses nothing.

- Commit at every checkpoint (§2), at minimum every 30 minutes of work.
- Push immediately after each commit: `git push -u origin <this session's branch>`.
  On network failure retry up to 4 times with 2s/4s/8s/16s backoff.
- Always commit and push before ending a turn, before a phase gate, and before spawning subagents.
- Never push to any other branch.

### Commit message format

```
<type>(T-2.3): short imperative summary

Optional body explaining why, not what.

Phase: 2
Task: T-2.3
Story: US-3.2
Spec: 06-game-design.md §3.1

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types: `feat` · `fix` · `test` · `refactor` · `perf` · `docs` · `chore` · `wip`.

A `wip` commit is expected and fine mid-task. A task is not `done` until its final commit is a
non-`wip` type and the suite is green.

### Pull request

A draft PR for the branch is opened once and kept updated. Push to the branch updates it. Mark it
ready for review only when the user asks.

---

## 5. Phase gates

At the end of every phase, before starting the next:

1. Every task in the phase is `done` or explicitly `cut` with a recorded reason.
2. Full suite green: unit, determinism, property, integration, component, visual, E2E, a11y, perf.
3. Coverage thresholds from `12` §2 hold. They may not be lowered to pass.
4. No invariant from `12` §3 regressed.
5. Manual device matrix (`12` §7) run; results recorded.
6. The gate's own criteria in `03` demonstrably met.
7. Tag and deploy; verify install-from-scratch and offline on a real device.
8. Gate record appended to `PROGRESS.md`; commit; push.
9. Tell the user the gate passed and what's next. Gates are natural check-in points.

If a gate fails, fix it before proceeding. Don't carry a failing gate forward.

---

## 6. Code documentation — spec traceability

**Every module in `src/` opens with a spec header.** This is required by lint (INV-15) and is how the
user verifies why any piece of code exists.

```ts
/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.3 — Shooting
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @design  06-game-design.md §3.1 (shooting model), 05-data-model.md §3.1 (weights)
 * @invariant INV-2 (no Math.random), INV-8 (determinism)
 *
 * Purpose: converts a shot attempt into an outcome, from the shooter's derived
 * ratings, distance, defender pressure, movement state, and release timing.
 */
```

Rules:

- `@spec`, `@phase`, `@task`, `@story`, and `Purpose` are mandatory. `@design` and `@invariant` where
  they apply.
- Task and story IDs must resolve against `03` and `02`; CI fails if they don't.
- A module serving several tasks lists them all. A module that can't name a task shouldn't exist.
- Non-obvious blocks get inline `// @spec-ref 05-data-model.md §3.3` comments pointing at the rule
  they implement — especially tuning constants and rules logic.
- `tools/spec-trace.ts` generates `docs/traceability.md`: task → files and file → task, both ways.
  Regenerate it at every phase gate and commit it.

Beyond the header, comment density matches the surrounding code. Explain *why*, not *what*.

---

## 7. Using subagents

Delegation is allowed and encouraged where it genuinely parallelises. It is not a way to avoid
thinking about hard problems.

### 7.1 Delegate these

| Work | Model | Why |
|---|---|---|
| Independent arcade mini-games (T-4.5–4.9, T-6.15) | `sonnet` | Self-contained, one settled interface, no shared files |
| UI screens against a finished design system | `sonnet` | Mechanical once tokens and components exist |
| Achievement content (T-8.7), starter rosters, CPU team generation | `haiku` | Bulk content against a fixed schema |
| Test suites for a settled interface | `sonnet` | Well-specified, high volume |
| Art and audio passes | `sonnet` | Independent of gameplay logic |
| Mechanical refactors and renames | `haiku` | Deterministic, verifiable by the suite |
| Codebase search across many files | `Explore` | Fan-out reading |

### 7.2 Never delegate these

Engine core and determinism · rating derivation, familiarity, and economy math · netcode ·
the sport-module seam · migrations and storage · balance tuning · anything two agents would touch
simultaneously · anything where the spec is ambiguous and needs a judgement call.

### 7.3 Rules for delegating

1. **Settle the interface first.** Never delegate against a type or seam that isn't written yet.
2. **Give full coordinates.** The task ID, story ID, the exact spec sections, the file paths it owns,
   and the spec header it must write. A cold agent knows nothing.
3. **One agent per file.** Partition by file, never by "area". Overlapping writes lose work.
4. **Commit and push before spawning**, so the agent starts from a clean, pushed state.
5. **The main session owns the commit.** Review the diff, run the full suite, then commit. Never
   commit an agent's output unread.
6. **Verify against the spec, not the agent's summary.** Agents report success optimistically.
7. Record delegation in the task's `PROGRESS.md` notes: which agent, which model, what it produced.

---

## 8. Non-negotiable constraints

Enforced by lint rules and the invariant tests in `12` §3. If you find yourself wanting to violate
one, that's a spec change to raise with the user, not a workaround to write.

1. No hardcoded `/Sport-Game/` or any literal base path. Derive from `import.meta.env.BASE_URL`.
2. No runtime network requests except optional STUN in P2P. No CDNs, no external fonts, no analytics.
3. No `Math.random()` in `engine/`, `sports/`, or Playbook resolution. Seeded PRNG only.
4. No sport-specific branching in engine core. Sports extend through the module seam.
5. No mode-specific branching in progression, economy, achievements, or stats. All modes emit the
   same `SportEvent` stream.
6. Difficulty never modifies athlete attributes or derived ratings.
7. Arcade window size is a pure function of athlete and difficulty, never of player history.
8. Nothing that reports the running version is served cache-first.
9. All storage keys, database names, and cache names go through `src/storage/scope.ts`.
10. Every persisted schema change ships with its migration in the same commit.
11. Touch targets ≥44 px; no critical information conveyed by colour alone.
12. Every `src/` module carries a resolving spec header.

---

## 9. Testing

Full strategy in `12`. The minimum bar for any task:

- Pure logic gets unit tests. Rules, ratings, economy, and migrations get thorough ones.
- Anything in the sim keeps the golden-seed determinism tests green.
- Anything touching UI gets component-state coverage and a visual regression snapshot.
- Anything touching the PWA lifecycle keeps all sixteen `11` §9 scenarios green.
- Run the full suite before marking a task `done`, not just the tests you wrote.
- For anything touching input, layout, animation, or performance: **check it on a real phone** and
  record the observation in `PROGRESS.md`.

Gameplay tasks also record a **feel note** — one honest sentence about whether it's actually fun.
It's not testable and it's still the most important signal in the project.

---

## 10. When to ask the user

Ask when:

- A spec decision turns out to be wrong or unbuildable as written.
- Two spec sections conflict and the resolution changes the product.
- A phase gate fails in a way that implies cutting scope.
- An open question from `08` becomes blocking.
- Something in the build would surprise them — a dependency, a permission, an external service.

Don't ask about: routine implementation choices, naming, file layout, test structure, or anything the
spec already answers. Make the call, note it, move on.

Report honestly. If a gate half-passed, say which half. If something is slow or not fun yet, say so —
that's more useful than a green checkmark.

---

## 11. Token discipline

A session's budget is spent on thinking about the game, not on watching tool output scroll past.
These are enforced by tooling, not willpower.

### 11.1 Never format or fix lint by hand

Two hooks make formatting invisible:

- **`.claude/settings.json`** — a `PostToolUse` hook on `Write|Edit` runs `tools/format-file.sh`
  (Prettier, then `eslint --fix`) on the file just written. Nothing unformatted ever reaches a
  review round. If it appears not to fire, the settings watcher didn't pick the file up at session
  start — open `/hooks` once, or rely on the git hook below.
- **`.githooks/pre-commit`** — enabled by `pnpm install` (the `prepare` script sets
  `core.hooksPath`). Formats and auto-fixes staged files, re-stages them, and fails the commit on
  any ESLint error it could not fix. Escape hatch: `SKIP_HOOKS=1 git commit …`.

So: never run Prettier manually, never hand-fix a formatting diff, and never spend a turn on
`import type` ordering. If a commit is rejected, the remaining errors are real ones worth reading.

### 11.2 Prefer the quiet command

| Instead of | Run | Why |
|---|---|---|
| `pnpm test` (per-file listing) | `pnpm -s test` | Dot reporter; failures still print in full |
| three separate checks | `pnpm -s verify` | One call: typecheck → lint → test |
| `cat`-ing a whole spec file | `grep -n` for the section, then read the range | Spec files run to hundreds of lines |
| re-reading all of `PROGRESS.md` | read the **In-flight** block plus your task's row | The rest is history |

`pnpm test:verbose` still exists for when the per-file breakdown is what you actually need.

### 11.3 Read narrowly, write once

- Read the spec sections a task cites, not the whole document. `03` names them per task.
- One `Read` with an `offset`/`limit` beats three full-file reads.
- Batch independent tool calls into a single message — parallel calls cost one round trip.
- Delegate fan-out reading to `Explore` (§7); it returns conclusions rather than file dumps.
- Write the file right the first time: check the spec header format in a neighbouring module
  before writing a new one, not after lint rejects it.

---

## 12. Quick reference

| Thing | Where |
|---|---|
| What to build | `specs/001-initial-dev/` |
| Current state, resume point | `specs/001-initial-dev/PROGRESS.md` |
| Task list and phases | `specs/001-initial-dev/03-phases-and-tasks.md` |
| Why a decision was made | `specs/001-initial-dev/07-decisions.md` |
| Open questions | `specs/001-initial-dev/08-open-questions.md` |
| Branch | The branch named in this session's instructions — one feature branch per session |
| Deploy | Tagged releases only, via GitHub Actions to Pages |
