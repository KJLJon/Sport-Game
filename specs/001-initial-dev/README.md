# 001 — Initial Development Spec

Specification set for **Sport-Game**: an installable, offline-capable multi-sport PWA hosted on
GitHub Pages, with user-created cross-sport athlete profiles, CPU opponents, achievements, an
in-game economy, and optional serverless P2P play.

> **Status:** Draft for review. No code has been written yet.
> Nothing in this folder is implemented until the phases in `03-phases-and-tasks.md` are worked.

## How to read this

Read in order. Each document assumes the ones above it.

| # | Document | What it answers |
|---|---|---|
| 1 | [`01-plan.md`](./01-plan.md) | What we're building, scope, non-goals, release strategy, risks |
| 2 | [`02-user-stories.md`](./02-user-stories.md) | Every capability as a user story with acceptance criteria |
| 3 | [`03-phases-and-tasks.md`](./03-phases-and-tasks.md) | Phases, ordered tasks, dependencies, definition of done |
| 4 | [`04-architecture.md`](./04-architecture.md) | Technical architecture: PWA scoping, engine, storage, CI/CD |
| 5 | [`05-data-model.md`](./05-data-model.md) | Schemas, rating math, economy formulas, migrations |
| 6 | [`06-game-design.md`](./06-game-design.md) | Controls, per-sport rules, AI behaviour, difficulty tuning |
| 7 | [`07-decisions.md`](./07-decisions.md) | Decision log — what was chosen, what was rejected, and why |
| 8 | [`08-open-questions.md`](./08-open-questions.md) | Questions still needing your answer before/during build |

## The requirements, and where each is satisfied

| Requirement | Where |
|---|---|
| MUST: multiple sports (basketball, soccer, football, hockey…) | `02` E3/E4/E14 · `03` Phases 2, 4, 8 · `06` §3 |
| MUST: profiles for real players, playable across sports | `02` E5 · `05` §2–3 · `06` §6 |
| MUST: multiple difficulty levels | `02` E7 · `06` §7 |
| MUST: play against computer | `02` E7 · `04` §6 · `06` §5 |
| MUST: achievements | `02` E8 · `05` §6 |
| MUST: earn players, trade for in-game currency | `02` E9 · `05` §5 |
| BONUS: serverless P2P | `02` E11 · `04` §8 |
| Installable from a GitHub Pages URL | `02` E1 · `04` §2 |
| Storage + PWA scoped to the repository directory | `02` E1 · `04` §2–3 |
| Works on mobile | `02` E13 · `06` §2 · `04` §9 |

## Key decisions at a glance

| Area | Decision |
|---|---|
| Game feel | Top-down real-time action, virtual joystick, one shared engine + per-sport rule modules |
| Sports at v1.0 | Basketball and Soccer, built deep. Hockey and Football land in v1.1 (Phase 8, in scope of this spec) |
| Squads | Authentic sizes — 5v5 basketball, 11v11 soccer — with short, clock-compressed matches |
| Athletes | Ship with zero real-athlete data. You create profiles; optional roster-file import for power users |
| Cross-sport | Sport-neutral attributes → per-sport derived ratings, gated by familiarity, improved by per-sport skill XP |
| Stack | TypeScript + Vite + Canvas 2D, no UI framework |
| Economy | Packs + sell-back + offline rotating market + P2P player trading |
| P2P | WebRTC data channel, manual QR/link signaling, deterministic lockstep. No servers of ours |
| Hosting | GitHub Pages, base path derived from the repo name at build time |
