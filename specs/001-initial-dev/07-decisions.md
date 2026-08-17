# 07 — Decision Log

Each entry records what was decided, what was rejected, and why. Anything here can be revisited — but
revisiting means updating this file, because later documents lean on these.

---

## D-01 — Gameplay is top-down real-time action

**Decided by the user.**

Rejected: arcade mini-games per sport, turn-based/sim resolution, hybrid arcade-plus-season.

Real-time top-down team play is the most expensive of the four options: it needs movement, collision,
ball physics, team AI, formations, and per-sport rules rather than a timing meter. The consequence,
accepted deliberately, is fewer sports at v1.0 in exchange for sports that are genuinely played.

**Consequences:** one shared engine with sports as rule modules (D-05); basketball is built first as a
vertical slice to prove the engine before soccer starts; team AI gets its own phase rather than being
absorbed into sport work; a hard performance budget applies from Phase 1.

---

## D-02 — Two sports deep at v1.0, four by v1.1

**Decided by the user.**

Rejected: four sports at v1.0, six sports at v1.0, four plus two lightweight 1v1 sports.

Basketball and soccer at v1.0; hockey and American football in Phase 11 (v1.1), specified here.
They differ enough — hand vs foot, court vs pitch, 5v5 vs 11v11, possession-dense vs possession-sparse
— that building both genuinely proves the module seam.

**Note on the MUST:** the requirement for multiple sports is met at v1.0 with two, and fully met
against the named list at v1.1. Phase 11 is in scope of this spec, not deferred out of it.

---

## D-03 — Authentic squad sizes, short matches

**Decided by the user.**

Rejected: reduced squads (3v3 / 5v5 futsal), configurable-length matches.

5v5 basketball and 11v11 soccer, with clock compression to keep matches at three to five real
minutes. This is the single biggest technical risk in the spec (R2, R3 in `01` §7): 22 entities on a
phone screen strains both readability and framerate.

**Consequences:** dynamic-zoom ball-following camera, minimap, and off-screen indicators are
requirements rather than polish; the spatial hash, LOD, and zero-allocation hot path are load-bearing;
formation and role AI must be data-driven because hand-authoring 22 behaviours is not viable.

---

## D-04 — No real-athlete data ships; user-created profiles plus optional import

**Decided by the user.**

Rejected: a bundled roster of real athletes, fictional built-in legends only.

The repository publishes no real names, likenesses, ratings, team names, league names, or logos.
Users create profiles locally — typing "Messi" into your own device is your data. Power users may
import a roster file or URL they supply; the app hosts none, links to none, and displays a
responsibility notice on import.

**Consequences:** a fresh install needs generated fictional starter athletes so it isn't empty; the
roster import schema is a documented public contract; the procedural athlete generator is needed
anyway for packs, so it does double duty.

---

## D-05 — TypeScript + Vite + Canvas 2D, no UI framework

**Decided by the user.**

Rejected: React, a zero-build plain-JS setup, Phaser.

Keeps the bundle small enough for the ≤200 KB budget on a mid-range phone, gives full control of the
game loop and rendering, and lets Vite handle base-path rewriting and the PWA build. The cost is
hand-rolling the router and UI widget layer, which is real but bounded — the app is mostly canvas and
lists.

**Consequences:** a small internal UI layer (`src/ui/`) with design tokens; hash-based routing because
GitHub Pages has no rewrites; per-sport code splitting to keep the initial payload small.

---

## D-06 — Universal attributes plus learnable per-sport skills

**Decided by the user.**

Rejected: manually-set per-sport ratings, universal attributes with a static familiarity penalty only.

Eleven sport-neutral attributes derive per-sport ratings through a weight matrix; a familiarity
multiplier gates them; per-sport skill XP and sub-skills grow with play. This is the most systems work
of the three options and also the only one where "Messi learns basketball" is an actual arc rather
than a fixed penalty.

**Consequences:** new sports need only a weight table, not data entry per athlete; imported rosters
supply attributes once and work in every sport including ones added later; familiarity must be felt
in behaviour (control error, decision noise, timing windows) and not only in numbers, or the system
reads as an arbitrary tax.

---

## D-07 — Economy: packs, sell-back, offline market, and P2P trading

**Decided by the user.**

Rejected: packs plus sell-back only; packs, sell-back and market without trading; trading only.

All four mechanisms. The market and P2P trading are the two that add real work — the market needs
tamper-resistant timing and a price model, trading needs the custody ledger and makes part of the
economy depend on the bonus phase.

**Consequences:** the anti-farm invariant (`05` §5.5) is enforced by test, since four interacting
mechanisms make an accidental coin loop much more likely; trading ships in Phase 10 with the rest of
P2P, and the economy is complete and coherent without it.

---

## D-08 — P2P via WebRTC with manual QR/link signaling

**Decided by the user.**

Rejected: async challenge codes only, both, skipping P2P.

A direct data channel with signaling done by hand — the host's offer becomes a QR code and a link, the
guest returns an answer the same way. No server of ours is involved at any point.

**Amendment made during specification:** asynchronous challenge codes are included anyway, as
`T-10.1`, ahead of the WebRTC work. Not as a substitute — as the fallback for the case WebRTC cannot
solve without a TURN server (symmetric NAT / carrier-grade NAT). Shipping it first also means the
bonus phase delivers something usable even if NAT traversal proves painful. Flagged for your
agreement in `08` Q-1.

**Consequences:** the simulation must be deterministic from Phase 1, since lockstep depends on it;
QR encode/decode is vendored in-repo; STUN is the one permitted external network dependency and is
user-configurable.

---

## D-09 — Storage isolation is namespacing, not a browser guarantee

**Decided during specification.**

The request was for storage scoped to the repository directory. Service worker scope and the manifest
`scope`/`id` genuinely are path-scoped, so those are satisfied literally. Browser **storage** is not:
IndexedDB, localStorage, and Cache Storage are origin-scoped, and no API confines them to a
sub-directory. There is no way to change this from application code.

So isolation is implemented as strict namespacing of every database name, storage key, and cache name
with the base path, funnelled through a single module, enforced by lint and test. The practical result
is the same — no collision with anything else on the account, and erase-all-data touches only our
keys — but the mechanism is different from what "scoped" might imply, and the difference matters if
another app on the same origin ever misbehaves.

---

## D-10 — Difficulty never modifies attributes

**Decided during specification.**

Harder difficulties raise CPU competence (reaction time, decision quality, execution error, tactical
sophistication) and lower player assistance. They never inflate CPU athlete ratings or deflate yours.

The alternative — scaling stats with difficulty — is cheaper to build and makes wins feel fake, which
undercuts the entire athlete-progression system: if the CPU's numbers move arbitrarily, yours mean
nothing. Backed by a test (`04` §11).

---

## D-11 — Deterministic simulation from day one

**Decided during specification.**

Fixed timestep, seeded PRNG, no `Math.random` in the sim, state hashing. Costs discipline in Phase 1;
buys replays (US-2.7), headless balance testing (T-2.13, T-7.10, T-8.16), match resume from an input
triple rather than a state dump (T-8.4), and lockstep P2P (T-10.7). Retrofitting determinism after the
fact is close to a rewrite, which is why it is a Phase 1 constraint rather than a Phase 10 one.

---

## D-12 — Base path derived at build time, never hardcoded

**Decided during specification.**

`vite.config.ts` derives `base` from `GITHUB_REPOSITORY`; everything else reads
`import.meta.env.BASE_URL`. Renaming the repository, or serving from a different sub-path, requires no
code change. Enforced by a lint rule against literal `/Sport-Game/` and by an E2E assertion.

---

## D-13 — Sandbox mode for over-budget athletes

**Decided during specification.**

User-created athletes are capped at a 580-point attribute total so profiles stay comparable and
progression means something. But the headline fantasy is "make Messi", and a real superstar does not
fit in an average budget.

Resolution: Sandbox mode in Settings lifts the cap and flags the athlete `sandbox: true`. Sandbox
athletes play fine in exhibitions and are excluded from tournaments, fairness-sensitive achievements,
and P2P unless the peer opts in. Nobody is told they can't build the athlete they want; the
progression economy just doesn't have to pretend a 99-everything athlete is normal.

---

## D-14 — Only tagged releases deploy to Pages

**Decided during specification.**

Every push builds and tests; only tags publish. The live site is therefore always a deliberate
release, and a half-finished phase on the feature branch never becomes the installed app that
existing users auto-update into.

---

## D-15 — Three play modes, not one

**Decided by the user**, amending D-01.

Live (real-time) stays. Added: **Playbook**, a turn-based tactical mode where the simulation resolves
possessions and phases from ratings, and **Arcade**, standalone skill mini-games. Playbook's key
moments hand off to Arcade games. Full design in `09`.

Rejected: keeping Live as the only mode; making turn-based a difficulty option rather than a mode.

Three modes roughly double the gameplay surface. What keeps that affordable is that all three read
the same derived ratings and emit the same `SportEvent` stream, so progression, economy,
achievements, stats, and XP are written once and work everywhere (INV-9). Playbook and Arcade are
each far cheaper than Live, and Arcade is not separate content — it *is* Playbook's key-moment
component, built once and used four ways.

**Consequences:** Phases 4 and 5 are new; soccer moves to Phase 6 so it is built once against a
settled three-mode contract; cross-mode balance parity becomes an enforced invariant (INV-11/12);
sport modules grow two adapters but still plug into one seam.

---

## D-16 — Arcade games are earned through play, and calibrated by the athlete

**Decided during specification**, from the user's "maybe you can win a way to play the arcade style
games independently so you can practice (as an achievement for each one)".

Each mini-game unlocks via an achievement earned by doing the thing in a real match — make a free
throw to unlock Free Throw, score a penalty to unlock Penalty Shootout. Never purchasable.

The harder call is calibration. An arcade game could be a pure reflex test, which is simpler to build
and would quietly make the entire roster system irrelevant in the mode new players see first.
Instead: **the athlete's ratings and familiarity set the size and speed of the window; your input
decides where inside the resulting band you land.** A great shooter is forgiving; a soccer player
shooting free throws is not. This is INV-10, tested by asserting window size is a pure function of
the athlete and difficulty — never of the player's past scores.

---

## D-17 — Hot-seat local multiplayer for Playbook and Arcade

**Decided during specification**, from "I want to play this with my family".

Turn-based and single-mechanic games pass around a phone naturally; real-time doesn't. So Playbook
and Arcade get 2–4 player hot-seat with pass-the-device screens and party formats, and Live gets
honest labelling that local two-player needs two gamepads on a desktop.

Local player names are stored per device so party screens use real names. Deliberately *not* full
per-person save slots — that would multiply every store, migration, and backup path. Flagged as Q-13
if you want it.

---

## D-18 — Update reliability and offline durability are designed as opposites that must both hold

**Decided during specification**, from the user's reported history of cache-locked updates and
offline apps that decayed.

The root cause of both symptoms is a service worker with one uniform caching strategy. The design
(`11`) splits by resource class: everything that tells you what version you're on — `index.html`,
`sw.js`, `version.json` — is network-first or network-only, while content-hashed assets are
cache-first and immutable, where staleness is impossible by construction.

Layered on top: five independent update-detection triggers, a version poll that can spot a stuck
service worker the SW machinery itself missed, atomic precache installs so a bad deploy can't leave a
half-cached app, a launch-time integrity check that silently re-fetches evicted files, and a
**Repair** button that clears caches and service workers while leaving IndexedDB — your roster —
untouched.

Rejected: relying on `skipWaiting` alone (updates without consent, breaks mid-match); cache-busting
query strings (doesn't fix a stuck SW); asking the user to clear site data (loses the save).

**Consequences:** this is Phase 0 work, not later, because retrofitting it is how these bugs ship.
Sixteen automated lifecycle scenarios (`11` §9) run on every commit.

---

## D-19 — UI/UX is a phase with a gate, not a polish pass

**Decided during specification**, from "I want to play this with my family".

`10` specifies the design system, screen map, flows, feel, and a design QA checklist that blocks
v1.0 — including an unaided newcomer reaching a played match in under 60 seconds. Design tokens and
the component gallery start in Phase 0 so quality accrues instead of being retrofitted, and the cut
order in `03` explicitly forbids cutting Phase 9.

The alternative — treating UX as whatever's left at the end — is how a technically impressive game
ends up unplayed by the people it was built for.

---

## D-20 — Every task is independently trackable and resumable

**Decided by the user.**

`PROGRESS.md` holds one row per task with status, verification record, and commit link, plus an
in-flight block carrying the current task's checkpoint notes, files touched, and next step. It is
updated in the same commit as the work, so the repository itself is the state — an interrupted
session resumes by reading it, with no memory required. `CLAUDE.md` §3–§5 defines the protocol.

---

## D-21 — Commit and push continuously

**Decided by the user.**

Commit at every checkpoint within a task, not only at task boundaries, and push after every commit.
Work in progress on a feature branch behind a draft PR costs nothing, and an interrupted session then
loses minutes rather than hours. Only tagged releases deploy (D-14), so frequent pushes never reach
players.

---

## D-22 — Code carries its spec coordinates

**Decided by the user.**

Every module in `src/` opens with a header naming its spec, phase, task, story, and design section,
plus a one-line purpose. A lint rule requires it, a generator produces a traceability report both
ways (task → files, file → task), and CI fails on a header that doesn't resolve (INV-15). Format in
`CLAUDE.md` §6.

This is what makes "why does this code exist?" answerable in seconds rather than by archaeology.

---

## D-23 — Subagents are used for parallel, well-bounded work only

**Decided by the user** ("you are able to use agents (with different models) where it makes sense").

Delegated: independent arcade games, UI screens against a settled design system, achievement content,
test suites for finished interfaces, art and audio passes, mechanical refactors. Model chosen per
task class.

Not delegated: engine core, determinism, netcode, rating and economy math, anything crossing the
sport-module seam, and anything where two agents would touch the same files. The main session always
reviews, runs the suite, and owns the commit. Protocol in `CLAUDE.md` §7.

---

## D-24 — The visual overhaul is sprites, not pseudo-3D

**Decided 2026-08-17 (T-13.1).** Phase 13 replaces the coloured-disc athletes with layered,
runtime-tinted **top-down sprites**, y-sorted for depth. Pseudo-3D (isometric or raised-perspective
projection) is rejected. The full implementation design is
[`13-visual-overhaul.md`](./13-visual-overhaul.md).

### Why not pseudo-3D

- **It re-opens Phase 12.** The camera, director, and framing stack (9 tasks, done, v1.2) is built
  on an orthographic top-down `ViewTransform { x, y, scale }` — spans measured in world units of
  the viewport axis, `legibleSpan`, the LOD policy, and every hit test assume screen distance is a
  scalar multiple of world distance. An isometric projection breaks that assumption everywhere at
  once: field renderers, playbook diagrams, pointer→world mapping, all visual snapshots, and the
  spans arithmetic the whole framing system is tested against.
- **It doesn't remove the sprite cost — it adds to it.** Isometric athletes still need directional
  sprite art (a projected disc looks worse, not better). So pseudo-3D = the whole sprite bill
  *plus* the projection churn, for a perspective gain the sprite art itself can carry (see below).
- **The floor requirement favours the smaller diff.** Gate 13 keeps the disc renderer selectable as
  the performance floor. Sprites are a pure alternative implementation behind the existing
  `SportRenderer` seam — same signatures, same camera, same field geometry. Pseudo-3D would need
  *two* camera/projection stacks kept alive simultaneously.
- **The "3-D feel" is mostly recoverable inside sprite art.** Athletes drawn with a slight
  top-down tilt (head above shoulders above feet), a feet-anchored shadow, ball height already
  carried by shadow offset (T-13.4), and y-sorted overlap (T-13.6) read as depth without any
  projection change.

### Budget arithmetic

Recorded at Gate 12: initial JS **70.8 KB gzip** of a 200 KB budget; total precache
**544.5 KB** of a 6 MB budget (`pnpm budget`). Headroom ≈ **5.46 MB precache, ~129 KB gzip JS**.

Sprite bill (design in `13-visual-overhaul.md` §2–3; frames are 32×48 px, authored as text pixel
grids and rasterised at load — no image files, no fetch path, INV-4 by construction):

| Item | Arithmetic | Raw | Expected gzip |
|---|---|---|---|
| Shared humanoid base sheet | 17 poses × 5 authored facings (8 via mirroring) × ~4 frames avg ≈ 340 frames × 1 536 px ≈ 522 k chars, × 2 layers (body + kit mask) | ~1.0 MB | ~100 KB |
| Per-sport prop/pose layer × 4 sports | ~60 frames × 1 536 px × 4 | ~370 KB | ~40 KB |
| Ball sheets, nets, dressing | small | ~60 KB | ~8 KB |
| **Ceiling** | | **~1.5 MB** | **~150 KB** |

Even at the ceiling that is **<28% of the precache headroom**, and none of it lands in the initial
JS chunk — art modules are code-split behind the Live/Arcade routes and rasterised once at load.
Runtime kit tinting composites each (team × pattern) atlas **once per match load** into an
off-screen canvas; per-frame drawing is plain `drawImage` blits of pre-composited sprites — the
cheapest per-frame operation a 2D canvas has — so the `12` §6 16 ms p95 at 22 entities is held by
construction, and verified by T-13.9.

### Constraints carried forward

- Kit **pattern is geometry, not colour**: the pattern (solid / stripes / hoops / halves, `10`
  §3.1) is a separate authored mask layer, so team identity survives every colour-vision
  simulation (`10` §11, Gate 13).
- The disc renderer is untouched and remains the floor (T-13.11); sprites are additive.
- No `Math.random()` anywhere in the render path (INV-2): run-cycle phase derives from
  per-entity distance travelled, ambient variation from `fork`-labelled seeds.
