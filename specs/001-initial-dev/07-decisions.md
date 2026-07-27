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

Basketball and soccer at v1.0; hockey and American football in Phase 9 (v1.1), specified here.
They differ enough — hand vs foot, court vs pitch, 5v5 vs 11v11, possession-dense vs possession-sparse
— that building both genuinely proves the module seam.

**Note on the MUST:** the requirement for multiple sports is met at v1.0 with two, and fully met
against the named list at v1.1. Phase 9 is in scope of this spec, not deferred out of it.

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
mechanisms make an accidental coin loop much more likely; trading ships in Phase 8 with the rest of
P2P, and the economy is complete and coherent without it.

---

## D-08 — P2P via WebRTC with manual QR/link signaling

**Decided by the user.**

Rejected: async challenge codes only, both, skipping P2P.

A direct data channel with signaling done by hand — the host's offer becomes a QR code and a link, the
guest returns an answer the same way. No server of ours is involved at any point.

**Amendment made during specification:** asynchronous challenge codes are included anyway, as
`T-8.1`, ahead of the WebRTC work. Not as a substitute — as the fallback for the case WebRTC cannot
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
buys replays (US-2.7), headless balance testing (T-2.13, T-5.9, T-6.14), match resume from an input
triple rather than a state dump (T-6.4), and lockstep P2P (T-8.6). Retrofitting determinism after the
fact is close to a rewrite, which is why it is a Phase 1 constraint rather than a Phase 8 one.

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
