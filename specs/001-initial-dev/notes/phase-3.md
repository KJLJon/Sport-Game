# Phase 3 notes — Athletes, cross-sport ratings, roster

Long-form rationale for the Phase 3 task rows in [`../PROGRESS.md`](../PROGRESS.md). The one-sentence version lives there; this
is the part a future session needs only when it touches the code.

---

## Task notes

### T-3.1

*Athlete schema, IndexedDB store, indexes, repository*

Schema written against `05` §2 field for field; bounds live beside it, the creation *budget* does not (that is T-3.2's, in `tuning.ts`). **Bug found:** the `athletes` store's `byName` index from T-0.11 pointed at `name`, a property no athlete has, so it indexed nothing — the roster browser would have sorted on an empty index. Now `byDisplayName`. IndexedDB has no "alter index", so `openDatabase` now reconciles: creates what is missing, drops what is undeclared, rebuilds a changed key path. `DB_VERSION` 1 → 2; no entry in the *data* chain, since an index is derived and a backup carries none. Search normalises accents, so `ibrahimovic` finds `Ibrahimović`.

### T-3.2

*Attribute system: the eleven attributes, budget rules, sandbox flag, random roll*

`tuning.ts` holds every `05` number so a balance pass never touches logic. Sandbox is a *flag, not a refusal*: `judgeCreation` returns the reason and points at Settings, because `05` §2.1 is explicit that the make-Messi fantasy stays available. The roll draws each attribute around the band average and then settles to the exact total; the settle step picks its ±1 targets from the RNG rather than walking in order, because "first attribute with room" is a systematic bias toward `speed` — the same shape as an id-order tie-break. There is a test for it. `fitToBudget` scales only the headroom above the floor, so a shooter stays a shooter. `createAthlete` clamps rather than throws and omits absent optionals entirely (`exactOptionalPropertyTypes`, and an `undefined` value is a real IndexedDB key).

### T-3.3

*Derivation engine: weight matrix, physical modifiers, unit-tested invariants*

No `if (sport === …)` anywhere: every sport-specific number arrives as a table from the sport module, so a new sport is a new table rather than an edit. The seam gained `physicalModifiers` and `positionWeights` (both optional). **Two judgement calls, both recorded in the decisions table below:** `05` §3.4 gives the position-fit *formula* but no position-weight table, so basketball's is new; and `05` §3.2 gives soccer's weights but no physical modifiers, so soccer's are read off §2.1's prose at half basketball's magnitude. **`src/sports/soccer/weights.ts` exists before Phase 6's soccer module, deliberately** — data only, no `SportModule`. T-3.9 has nothing to compare against otherwise, and a derivation engine tested against one table is one written for that table; soccer's twelve differently-shaped rows are what prove it generic. Properties asserted: monotonic in every weighted attribute, always integer 1–99, never above the athlete's own ceiling, projections through identical arithmetic.

### T-3.4

*Familiarity model: per-sport familiarity, penalty curve, growth from minutes*

The penalty curve was already in `derivation.ts` (`familiarityMultiplier`); T-3.4 is the growth half. **`minutes` means *real* minutes, not game-clock minutes** — `05` §3.3's formula and its own claim of "~15 matches to competent, ~50 to the cap" only agree under that reading; read as game minutes the same formula gets there in three. `learningMinutes()` is the one place the two units meet, so the box score keeps showing game minutes. There is a test for both readings. Growth is pure and returns the change alongside the new record, so the post-match screen shows exactly what was stored. Bands are words, not colours (CLAUDE.md §8.11).

### T-3.5

*Sport skill XP: levels, sub-skills, event-driven awards, diminishing returns*

The sport owns the event→sub-skill table (`xpAwards` on the seam) — only basketball knows a shot from `cornerThree` is a three, and the athlete layer must never learn it. **Diminishing returns come from two places doing different jobs:** the level curve (`100 × level^1.6`, so level 19 costs ~100× level 1) and a within-session decay on repeated identical actions, so forty threes is not forty threes' worth. Without the second, farming one action would be the fastest route to a maxed sub-skill. Attempts pay less than makes but *not nothing* — an athlete paid only for makes learns fastest by never taking a hard shot. `xpFor(level)` read as the cost to leave a level, not a cumulative total (decision below). `minutesPlayed` is banked by familiarity **only**; `applySession` deliberately does not touch it, and `progression.ts` composes the two — a double-count there would surface fifty matches later. `progression.applyMatch` is the single door every mode uses; T-4.10's reduced arcade rate is a `rate` scalar, not a branch (INV: `05` §8.5).

### T-3.6

*Behavioural coupling: familiarity → decision noise, control error, reaction penalty in-sim*

`05` §3.3's claim is behavioural, so it is tested behaviourally: four seeded matches with one side made novice and the other at home, **identical ratings on both**, asserting more turnovers, fewer completed passes, and fewer points. Four coupling points in the sim: decision noise on how a look is valued, degraded first touch on catches and intercepts, a slower per-step reaction on the pass decision, and a wider release-timing scatter. **The design constraint that shaped all of it: an at-home athlete must cost zero random draws.** Coupling fades to exactly nothing at 75 familiarity — below every athlete's own-sport 85 — so no call site draws for it, and the PRNG stream is byte-identical to before T-3.6 existed. There is a test asserting a coupled-at-100 match serialises identically to an uncoupled one; without that property every golden-seed determinism test would have broken for no behaviour change. This is **not** difficulty (CLAUDE.md §8.6): no attribute and no derived rating is touched. The map is empty until T-3.17 fills it. `pnpm balance` re-run after the change: all 14 bands pass, 75.5 points on 78.7 attempts at 36.5%, home win rate 44.2% — unchanged from T-2.13's run, which is the expected result and the point of the zero-draw property.

### T-3.7

*Profile editor: fields, presets/sliders/roll with live budget meter, photo capture + downscale*

**Delegated to `sonnet`** (CLAUDE.md §7.1); the agent owned an explicit file list, was told not to commit, and this session reviewed and committed. What worked: settling every interface first and pushing it, so the agent called `budgetState`/`judgeCreation`/`createAthlete` rather than reinventing the budget. Over-budget is a *conversation, not a block* — `judgeCreation`'s reason plus a "turn on Sandbox mode and save" action, per `05` §2.1. Photos are downscaled to a 512 px edge locally and never uploaded; the blob is produced but not yet persisted (`TODO(T-3.16)` — no blob store exists yet). **Two review findings:** the agent's first draft duplicated `explain.ts`'s label humaniser with its own table (it was briefed before `explain.ts` existed) — now sourced from `attributeLabels()`; and it correctly reported that the only failing tests were *this session's* fault, a missing `Purpose:`/`@story` in `athlete-card.css`. Verified independently rather than taken on trust.

### T-3.8

*Athlete card component: compact + full, sport switcher, familiarity ring, "why this rating"*

The card computes no rating: it is handed derivation's output and the explanation beside it, so what a player reads and what the sim uses cannot drift. Sentences live in `athletes/explain.ts`, because a string built in a component is a string with no test — and under `10` §11 they are load-bearing, being the non-colour channel for every meter. The "why" is a `<details>`, so it is keyboard-operable and announced with no JavaScript of ours. `sports/catalogue.ts` separates **rateable** from **playable**: the sport switcher needs two rating tables, not two playable sports, and the card says which rather than implying soccer is a real matchup. **Two bugs found:** the familiarity ring computed its own rank in even fifths while `05` §3.3's bands are uneven, so the ring could read "Natural" beside text reading "Comfortable"; and several explanation strings said "1 points". Also added a router test — `/squad/athlete/new` and `/squad/athlete/:id` are both three segments, and if specificity ever stopped preferring the literal, creating an athlete would silently become "No such athlete".

### T-3.9

*Cross-sport compare view with projections for unplayed sports*

Each row shows **two** numbers — what the athlete rates today and what they would rate once they knew the sport — because showing only one would either flatter every athlete or bury the feature. The projection is `derivation.ts`'s own arithmetic with familiarity pinned at the cap, not a separate estimate; a test asserts they agree, since a compare view disagreeing with the sim would be lying about a number the sim is about to use. Rows rank on **potential**, not on today's number: ranking on current sorts by which sport happens to have been played, which is a fact about the save file rather than about the athlete. Adds "about N matches to close it" from T-3.4's `matchesToReach`.

### T-3.10

*Roster browser: search, sort, filter, bulk select*

**Delegated to `sonnet`.** Query logic is pure and DOM-free, so the edge cases are testable without a screen: sorting is **total** rather than relying on `Array.prototype.sort`'s stability (an engine detail, not a contract), rarity orders by `RARITIES`' declared sequence rather than alphabetically, an unrecognised filter value matches nothing rather than everything, and "sort by rating" falls back to each athlete's *own* primary sport rather than ranking everyone through one table. Bulk delete gets both things US-5.5 asks for and that are easy to skip: a confirming dialog and an undo, which is why `deleteMany` returns the records rather than a count. **Architectural fix found in review:** the agent reused `cardOverall` from the athlete *card* as instructed, which made `src/athletes/` depend on `src/ui/` — backwards. The arithmetic moved to `derivation.sportOverall()` and the card now imports it. Guarded by a new `tests/invariants/layering.test.ts`, because the failure is invisible until something headless (a balance run, a migration) drags a DOM module into a context with no DOM.

### T-3.11

*Teams: create/edit, name, colours, generic crests*

Data model built here first and pushed before delegating (CLAUDE.md §7.3 rule 1); screens delegated to `sonnet`. Two relational rules live in the repository rather than in callers: deleting a team deletes its squads in one transaction, and deleting an athlete strips them from every lineup — both are orphans that stay invisible until they are a bug report. Colour is never the only difference between two teams (`10` §11): a short name and one of eight crest *shapes* carry it too, and palettes ship named so the picker never asks anyone to pick "the green one". CPU teams (`editable: false`) are refused with an explanation rather than silently edited. **The agent hit the account's monthly spend limit mid-run**; it had already finished and self-verified, and this session re-ran `verify` and coverage independently rather than trusting the partial report.

### T-3.12

*Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best*

**Auto-fill is an assignment problem and the naive answer is biased.** Walking the slots in order and giving each its best remaining athlete makes the *first* position outrank every other — the same shape as tie-breaking in entity-id order. Pairings are ranked globally and taken best-first instead, with ties on athlete id; two tests assert the result is unchanged when the slot order and the candidate order are reversed. Greedy, not optimal, and deliberately: "your best player went to their best position" is what a player expects, and an optimal solver moving someone off their best spot to gain a point would read as a bug. **`03` says "drag-to-slot"; this is tap-to-place, and that is a considered deviation** — HTML5 drag does not work on touch without a polyfill and is unusable one-handed, invisible to a screen reader, and impossible by keyboard. Select-then-place works identically with a thumb, mouse, keyboard, and screen reader; every slot is a real `<button>`. Recorded in the decisions table.

### T-3.13

*Stamina, injury, suspension, availability*

US-6.3's "low stamina degrades performance visibly" is the phrase that shaped this: fatigue produces a multiplier the sim applies at the point of use, in the same shape as T-3.6's coupling, and — like that one — it is **exactly 1.0 above the threshold**, so a fresh athlete costs the sim nothing and the PRNG stream is untouched for anyone who is not actually tired. It degrades to a floor rather than to zero: a player who cannot substitute must still be able to finish the match. Neither attributes nor derived ratings are modified, so CLAUDE.md §8.6 holds and the card still shows who they are when rested. Injuries are deliberately **rare** and likelier when tired — which is what makes a substitution a decision — because an injury system that fires often turns a game about playing into a game about squad admin. `05` gives the `condition` fields but no rates, so every number is this task's, in `tuning.ts`.

### T-3.14

*Starter roster: generated fictional athletes, enough for both sports*

**Delegated to `haiku`** (bulk content against a fixed schema, CLAUDE.md §7.1). 38 athletes from a seeded roll: two basketball fives, two soccer elevens, and spares, with position-coherent bodies and no legendaries — a fresh install should not hand out a franchise athlete. Names combine 187 given names and 280 surnames of many origins; verified by hand that the pools are ordinary names rather than real athletes. **Seeding is an install step, not a side effect of opening the database** — folding it into `appDatabase()` handed 38 athletes to every test and every headless caller, and thirteen tests said so within a minute. It now runs from app bootstrap after first paint, guarded by a `meta` flag rather than by "is the roster empty", because a player who deleted everyone made a decision and handing them back 38 strangers would undo it.

### T-3.15

*Roster import: file + URL, schema validation, per-record errors, merge/conflict, responsibility notice*

**Delegated to `sonnet`.** `05` §8 followed exactly: unknown fields dropped, out-of-range values clamped **with a per-record warning**, and a bad record never aborting the file — that last one is the whole point of the section and is tested explicitly. A `formatVersion` from the future is rejected outright rather than partially applied, the same principle as `05` §9 rule 4. Conflicts are flagged on duplicate `custodyId` *or* matching name + primary sport, and default to skip so nothing is silently overwritten. The URL fetch is the one permitted exception to CLAUDE.md §8.2's no-network rule — user-initiated, and commented with the citation. **Agent judgement call, accepted:** the wire schema names four sports where the catalogue rates two, so it validates against the documented four; a `hockey` file imports cleanly and simply is not playable yet, which is the same rateable/playable split `catalogue.ts` already draws.

### T-3.16

*Roster and full-backup export/import with version checks and change preview*

**The preview is the dry run of the restore, not a second implementation** — `restoreBackup` calls `previewBackup` and returns it, and a test asserts the two agree. A preview that said one thing while the restore did another would be the worst possible bug in a data-safety feature. A backup from a newer build is refused whole (`05` §9 rule 4) before a single record is written, and every parse failure is a *value* rather than an exception: this is the one screen where an unhandled throw leaves someone staring at a broken page holding the only copy of their data. Merge is the default because it is the recoverable mistake — a merge meant as a replace leaves extra athletes; a replace meant as a merge loses them. Reachable from Settings → Data & backup.

### T-3.17

*Wire real athletes into basketball Live — lineups drive the sim*

**Phase 2's biggest loose end, closed.** `rollRatings()` is no longer the main path: a match given a lineup reads real derived ratings, real movement from `courtSpeed`, real familiarity coupling, and real fatigue. The headline test is the one that matters — two squads with *identical attributes and bodies*, differing only in which sport they know, and the basketball side wins. A soccer squad that has learned basketball closes the gap. **The seeded fallback stays, deliberately**: a rosterless match is byte-identical to the pre-T-3.17 one, which is why the 500-game balance harness returns exactly the T-2.13 numbers and every golden-seed test is untouched. Real rosters are an input, not a prerequisite — a rules test should not have to build ten athletes to check the shot clock. `MatchSetup` gained `rosters?`, which closes a type-only import cycle with `athletes/types.ts`; both directions are erased at build, and the alternative was pretending a match is played by something other than athletes. Five of the fourteen numbers (`composure`, `agility`, `strength`, `vertical`, `discipline`) are attributes read as themselves and **not** gated by familiarity — a novice does not get weaker or shorter, they get worse at basketball.

---

## Decisions taken during implementation

Small calls that did not warrant a spec change. Anything that changes the product goes in
[`../07-decisions.md`](../07-decisions.md) instead.

### 2026-07-27 · T-3.4 — `minutes` in `05` §3.3's growth formula is real minutes of play, not game-clock minutes

The formula and the paragraph under it disagree otherwise. A full basketball match is 48 game minutes but twelve real ones at `06` §3.1's 4× compression; a starter plays ~8 real minutes, which lands on §3.3's own "~15 matches to competent, ~50 to approach the cap" almost exactly. Read as game minutes it is three matches to competent. `minutesPlayed` still stores game minutes, because that is what a box score means; `learningMinutes()` converts. Raised at the Gate 3 review; the alternative is to read `minutes` as game minutes and drop the 0.9 coefficient to ~0.225, which produces an identical curve with one fewer unit in play. Both were explained to the user; **left as real minutes** unless they say otherwise.

### 2026-07-28 · T-3.6 — Behavioural coupling fades to exactly zero at 75 familiarity, not at 100

Two reasons, one design and one mechanical. Design: a competent-but-still-learning athlete should play *cleanly and a little worse*, not clumsily — looking lost is for the genuinely lost. Mechanical: every athlete's own sport starts at 85, so a fade-out below that means an at-home athlete is coupled by nothing, every call site can skip its random draw, and the PRNG stream stays byte-identical to the pre-T-3.6 one. Drawing-and-discarding instead would have broken every golden-seed determinism test for no behaviour change.

### 2026-07-28 · T-3.8 — `src/sports/catalogue.ts` distinguishes *rateable* from *playable* sports

`10` §6's sport switcher and T-3.9's compare view both need at least two rating tables and neither needs two playable sports. Rather than fake a soccer `SportModule` or defer the card to Phase 6, the catalogue carries a `playable` flag and the card says "not playable yet — this is a projection" instead of implying a real matchup. Phase 6 flips one boolean.

### 2026-07-28 · T-3.12 — The lineup editor is tap-to-place, not drag-to-place, despite `03` naming the task "drag-to-slot"

HTML5 drag-and-drop does not work on touch without a polyfill, and a drag is unusable one-handed, invisible to a screen reader, and impossible with a keyboard — all four of which this game's `10` §11 commitments require. Select-then-place works identically with a thumb, a mouse, a keyboard, and a screen reader, and every slot is a real `<button>` so focus and Enter come free. Pointer dragging can be layered on later as an accelerator over the same model. Raise it if the intent was specifically the drag gesture.

### 2026-07-28 · T-3.17 — `MatchSetup.rosters` is optional, and a rosterless match keeps the seeded fallback forever

Real rosters are an input, not a prerequisite. The 500-game balance harness has no save file, the golden-seed determinism tests replay from `(seed, setup, inputs)` alone, and a rules test checking the shot clock should not have to build ten athletes first. The fallback draws from the same `rosterRng` in the same order, so a rosterless match is byte-identical to the pre-T-3.17 one — which is why the balance bands came back unchanged.

### 2026-07-28 · T-3.17 — `sports/types.ts` and `athletes/types.ts` now import each other, type-only

`MatchSetup` needs `Athlete`; `athletes/types.ts` needs `SportId`. Both imports are `import type` and erased at build, so there is no runtime cycle. The alternatives were worse: a sport-specific setup extension read through a cast, or pretending at the seam that a match is played by something other than athletes.

### 2026-07-28 · T-3.5 — `xpFor(level) = 100 × level^1.6` is the cost to advance *from* that level, not a cumulative total

`05` §3.3 calls it a "level threshold" without saying which. As a per-level cost it gives a round 100-XP on-ramp and a ~102× span across the twenty levels — the shape "diminishing returns" describes. As a cumulative total the span is identical but level 1 → 2 is free, which makes the first level-up meaningless. Either reading is defensible; this one is the tunable-friendlier of the two.

### 2026-07-28 · T-3.5 — Within a session, the n-th award of one action is worth `0.93^(n-1)` of the first, floored at 0.2

`05` §3.3 asks for diminishing returns and the level curve alone does not deliver them *within* a match: without this, the fastest route to a maxed sub-skill is to stop playing the sport and farm one action, which is the shape `05` §5.5 forbids for coins. Tuned so a varied match out-earns a farmed one; both are asserted.

### 2026-07-27 · T-3.1 — The `athletes` store's name index is `byDisplayName` on `displayName`, and `openDatabase` now reconciles indexes

T-0.11's `byName` pointed at `name`, which no athlete has, so it indexed nothing and would have failed silently in the roster browser. IndexedDB cannot alter an index, so the fix has to be a drop-and-recreate; making the upgrade path reconcile against the spec means the next such drift is corrected rather than merely detectable. `DB_VERSION` 1 → 2, no data-chain entry — an index is derived data.

### 2026-07-27 · T-3.3 — Basketball's position-weight table (`05` §3.4) is new, not quoted

`05` §3.4 gives the fit *formula* and the 0.85 warning threshold but no `positionWeight` table for any sport. Written to `05`'s own standard — starting values for a balance pass — and shaped so the positions differ enough that the warning means something; a centre at point guard falls well under 0.85, and there is a test asserting it.

### 2026-07-27 · T-3.3 — Soccer's physical modifiers are read off `05` §2.1's prose, at half basketball's magnitude

`05` §3.2 gives soccer's weights but no modifier table. §2.1 says height helps goalkeeping and hurts low-centre-of-gravity agility, which in soccer is heading and goalkeeping up, dribbling down. Halved because soccer's height spread is narrower and basketball's per-cm figure would swamp the weighted sum. Revisit when Phase 6 can actually play it.

### 2026-07-27 · T-3.3 — `src/sports/soccer/weights.ts` ships in Phase 3, ahead of Phase 6's soccer module

Data only — no `SportModule`, nothing registered. Two reasons: T-3.9 projects ratings for unplayed sports and with only basketball in the build has nothing to project *to*, and a derivation engine tested against a single table is one written for that table. Soccer's twelve differently-shaped rows are the evidence it is generic.

---

## Gate record

### Gate 3 — Athletes, cross-sport ratings, roster (v0.2)

- **Date:** 2026-07-28
- **Result:** **NOT PASSED — every automatable check green, blocked on the same human verification
  as Gate 2, which is now two gates of debt rather than one.**

`03`'s criterion for this gate is a single end-to-end sentence: *create an athlete, play them in
basketball, watch familiarity move over several matches, export a backup, wipe data, reimport, land
exactly where you left off.* Every link in that chain exists and is covered by tests, and the chain
has never been walked by a person.

**What is evidenced:**

| Link | Evidence |
|---|---|
| Create an athlete | `tests/unit/ui/athlete-editor.test.ts` — the editor saves through `createAthlete` and the record lands in the repository |
| Play them in basketball | `tests/integration/sports/basketball-rosters.test.ts` — a lineup drives the sim; ratings, movement, coupling, and fatigue all read from the athlete |
| Watch familiarity move | `tests/unit/athletes/{familiarity,progression}.test.ts` — 20 simulated matches move a novice past 60 familiarity and raise the derived rating it gates |
| Export a backup | `tests/integration/storage/backup.test.ts` — every store, with its schema version |
| Wipe and reimport | same file — a full round trip through a wipe restores every store, and the preview is the restore's own dry run |

**Checks run:**

| § | Check | Result |
|---|---|---|
| 1 | Every task `done` or `cut` with a reason | ✅ 17 of 17 `done`, none cut |
| 2 | Full suite green | ✅ 1 682 tests across 93 files; 32 E2E specs in a real browser |
| 3 | Coverage thresholds (`12` §2) | ✅ 94.7% overall against ≥85%; `src/athletes/**` and `src/storage/**` hold their 95% floors |
| 4 | No invariant regressed | ✅ including a new one — `tests/invariants/layering.test.ts`, added after the domain layer was caught importing the UI layer |
| 6 | Gate criteria in `03` | ⚠️ machine half evidenced above; the "land exactly where you left off" *feeling* is unverified |
| 8 | Gate record appended, committed, pushed | ✅ this record |
| 5 | Manual device matrix (`12` §7) | ❌ no device available to this session |
| 7 | Tag and deploy | ❌ not done — outward-facing, and wants a decision rather than an assumption |

**Balance after T-3.17** (`pnpm balance`, 500 matches): all 14 bands pass, identical to T-2.13's
figures — 75.5 points on 78.7 attempts at 36.5%, home win rate 44.2%. That is the expected result
and the point of the design: a rosterless match is byte-identical to the pre-T-3.17 one, so wiring
real athletes in could not move the harness. **The corollary is worth stating plainly: the balance
suite does not yet cover matches played by real athletes.** Every band above describes seeded
stand-ins. Balancing real rosters is Phase 7's problem and it has not been started.

**Two regressions this gate caught, both mine, neither caught by the unit suite:**

- `DB_VERSION` 1 → 2 (T-3.1) broke five E2E specs, because a test helper opened IndexedDB at a
  hardcoded version 1 and threw `VersionError` against a database the app had already upgraded. CI
  does not run on branches, so nothing surfaced it until the gate. The helper now opens
  version-less.
- Seeding the starter roster inside `appDatabase()` (T-3.14) handed 38 athletes to every test and
  every headless caller. Thirteen tests said so within a minute. Opening the database is a read;
  filling it is an install step, and it now runs from bootstrap.

**Deferred, with reasons:** the device matrix and the deploy, unchanged from Gate 2 and now
compounding. Gate 2 was not signed off; Gate 3 is not either, and both are waiting on the same two
things.

**Correction, 2026-07-28.** An earlier version of this record said the device matrix did not need a
deploy, because `pnpm serve` can put the real build on a LAN. That is true only with a laptop
holding a checkout. The user works through the Claude Code mobile app, and these sessions run in a
disposable cloud container that no phone can reach — so for this project **the deploy is the only
route to a real device**, not one option among several. Written up in
[`docs/device-testing.md`](../../docs/device-testing.md), which now leads with it.

**Deploy, authorised by the user but NOT done — this session cannot do it.** Both routes are
refused by the credentials these sessions run with:

- `git push origin v0.2.0` → **HTTP 403**. The git proxy permits pushes to the session's own branch
  and nothing else; tags are not branch pushes.
- Dispatching `deploy.yml` through the GitHub API → **403 "Resource not accessible by
  integration"**. The app token has no `actions: write`.

So the deploy is a **user action**, and the steps are in
[`docs/device-testing.md`](../../docs/device-testing.md). `package.json` was bumped `0.0.0` →
`0.2.0` in preparation, because that version is what `version.json` reports and what Settings → App
& updates displays — publishing a v0.2 milestone that tells the player it is `0.0.0` would make the
update machinery lie about itself, which is the one thing `11` §3 exists to prevent.

**Also requires one thing only the repository owner can do:** Settings → Pages → Build and
deployment → Source: *GitHub Actions*. Without it the deploy job fails at its final step, whoever
starts it.

---
