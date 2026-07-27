# 001 — Initial Development Spec

Specification set for **Sport-Game**: an installable, offline-capable multi-sport PWA hosted on
GitHub Pages, with user-created cross-sport athlete profiles, three ways to play, CPU opponents,
achievements, an in-game economy, hot-seat local multiplayer, and optional serverless P2P.

> **Status:** Draft for review. No implementation code exists yet.
> Nothing here is built until the phases in `03-phases-and-tasks.md` are worked, tracked in
> [`PROGRESS.md`](./PROGRESS.md).

## How to read this

Read `01` → `02` → `03` for the plan, the requirements, and the work. The rest is reference you can
dip into. Each document assumes the ones above it.

| # | Document | What it answers |
|---|---|---|
| 1 | [`01-plan.md`](./01-plan.md) | What we're building, scope, non-goals, release strategy, risks |
| 2 | [`02-user-stories.md`](./02-user-stories.md) | Every capability as a user story with acceptance criteria |
| 3 | [`03-phases-and-tasks.md`](./03-phases-and-tasks.md) | Phases, ordered tasks, dependencies, gates, cut order |
| 4 | [`04-architecture.md`](./04-architecture.md) | PWA scoping, engine, storage, sport-module seam, CI/CD |
| 5 | [`05-data-model.md`](./05-data-model.md) | Schemas, rating math, economy formulas, migrations |
| 6 | [`06-game-design.md`](./06-game-design.md) | Controls, per-sport rules, CPU behaviour, difficulty |
| 7 | [`07-decisions.md`](./07-decisions.md) | Decision log — what was chosen, what was rejected, why |
| 8 | [`08-open-questions.md`](./08-open-questions.md) | Questions still needing your answer |
| 9 | [`09-modes-and-arcade.md`](./09-modes-and-arcade.md) | The three play modes: Live, Playbook, Arcade, and hot-seat |
| 10 | [`10-ui-ux.md`](./10-ui-ux.md) | Design system, screens, flows, feel, accessibility, design QA gate |
| 11 | [`11-pwa-lifecycle.md`](./11-pwa-lifecycle.md) | Reliable updates *and* durable offline — the two together |
| 12 | [`12-quality-and-testing.md`](./12-quality-and-testing.md) | Test strategy, coverage, invariants, budgets, definition of done |
| — | [`PROGRESS.md`](./PROGRESS.md) | Live task tracker and resume point |
| — | [`/CLAUDE.md`](../../CLAUDE.md) | How to execute the phases: work loop, commits, agents, traceability |

## The requirements, and where each is satisfied

| Requirement | Where |
|---|---|
| MUST: multiple sports (basketball, soccer, football, hockey…) | `02` E3/E4/E14 · `03` Phases 2, 6, 11 · `06` §3 |
| MUST: profiles for real players, playable across sports | `02` E5 · `05` §2–3 · `06` §6 |
| MUST: multiple difficulty levels | `02` E7 · `06` §7 · `09` §7 |
| MUST: play against computer | `02` E7 · `06` §5 · `09` §2 |
| MUST: achievements | `02` E8 · `05` §6 |
| MUST: earn players, trade for in-game currency | `02` E9 · `05` §5 |
| BONUS: serverless P2P | `02` E11 · `04` §8 · `09` §6 |
| Turn-based mode with arcade key moments | `02` E15 · `09` §2 |
| Standalone arcade games, unlocked as practice | `02` E16 · `09` §3 |
| Installable from a GitHub Pages URL | `02` E1 · `04` §2 |
| Storage + PWA scoped to the repository directory | `02` E1 · `04` §2–3 · `07` D-09 |
| Reliable updates *and* durable offline | `02` US-1.6–1.9 · `11` |
| Works on mobile, plays well with family | `02` E13, E17 · `10` · `09` §4 |
| Trackable, resumable tasks | `PROGRESS.md` · `CLAUDE.md` §3 |
| Rich test suite and verification | `12` · `CLAUDE.md` §9 |
| Code documented by spec / phase / task / story | `CLAUDE.md` §6 · `07` D-22 |

## Key decisions at a glance

| Area | Decision |
|---|---|
| Play modes | **Live** (real-time top-down), **Playbook** (turn-based tactics with arcade key moments), **Arcade** (standalone mini-games). One roster, one progression, one economy across all three |
| Sports at v1.0 | Basketball and Soccer, built deep across all three modes. Hockey and Football in v1.1 (Phase 11, in scope of this spec) |
| Squads | Authentic sizes — 5v5 basketball, 11v11 soccer — with short, clock-compressed matches |
| Athletes | Ship with zero real-athlete data. You create profiles; optional roster-file import for power users |
| Cross-sport | Sport-neutral attributes → per-sport derived ratings, gated by familiarity, improved by per-sport skill XP |
| Arcade fairness | The athlete's ratings set the timing window; your input picks where in the band you land |
| Family play | Hot-seat 2–4 players in Playbook and Arcade; UI/UX has its own phase and a hard gate |
| Stack | TypeScript + Vite + Canvas 2D, no UI framework |
| Economy | Packs + sell-back + offline rotating market + P2P player trading |
| P2P | No servers of ours. Async challenge codes → Playbook P2P → Live lockstep, in that confidence order |
| Updates & offline | Split cache strategy, five update triggers, atomic precache, self-healing integrity check, Repair button that never touches your roster |
| Hosting | GitHub Pages, base path derived from the repo name at build time |

## Scale

170 tasks across twelve phases, twelve milestone releases from v0.1 to v1.1. See `08` Q-16 for an
honest note on that, and `03` for the cut order decided in advance.
