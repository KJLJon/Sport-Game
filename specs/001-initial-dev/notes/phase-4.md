# Phase 4 notes — Arcade framework + basketball arcade set

Long-form rationale for the Phase 4 task rows in [`../PROGRESS.md`](../PROGRESS.md). The one-sentence version lives there; this
is the part a future session needs only when it touches the code.

---

## Task notes

### T-4.1

*Arcade framework: `ArcadeGameDef`, host, session lifecycle, scoring, star ratings*

**The split that decides everything downstream: a game owns a *mechanic*, the framework owns the run.** Lives, clock, score, streaks, stars, and event collection live in `ArcadeRun` once, because five games owning them five times is five places for the rules of a scored run to drift — and `09` §3.3 describes one structure for every game. A game reports `host.attempt({made, points, quality, label, events})` and never reads the score, so it cannot invent its own scoring. `ArcadeRun` is headless: no canvas, no DOM, stepped by a caller-supplied `dt`, which is what lets T-4.11 run several in turn and T-4.13 drive hundreds with synthetic input. Events carry no mode field and are stamped by the framework, so an arcade `score` is indistinguishable from a Live one (INV-9). The seam gained `SportModule.arcade?`, optional for the same reason `playbook` will be. `src/achievements/ids.ts` declares the ten unlock ids from `09` §3.2 — the vocabulary Phase 8 will evaluate against; all ten are earned by playing.

### T-4.3

*Arcade hub: grid, locked/unlocked states, personal bests, athlete picker with window hint*

**The window hint is the feature, not decoration.** US-16.3 asks the picker to state plainly whether this athlete's window is wide or narrow, and this is the only place the fairness rule is visible *before* you play — so it is on every tile, in words, recomputed when the athlete changes. **The unlock interim is one greppable constant.** The achievement system is Phase 8, so nothing ever writes an unlock and an honest check would lock all five games permanently, making Gate 4's "a child can start one unaided" unreachable. `ACHIEVEMENTS_LANDED = false` in `unlocks.ts` opens everything until T-8.6 flips it; a quietly permissive check would have been the same behaviour with none of the accountability. The run screen makes **the whole stage one labelled `<button>`** — `09` §3.1's one thumb, no reading — with Space and Enter bound to the same action, so it is playable by keyboard and announced by a screen reader rather than being an unlabelled canvas. Everything the HUD reports it reports in text (`10` §11). A canvas with no 2D context is treated as a real state rather than an error: the run stays playable, because none of the information is only on the canvas.

### T-4.4

*Practice / scored / daily modes; seeded daily challenge*

**Modifiers are applied outside `calibrate()`, deliberately.** A modifier is a fact about today's scenario — the same for everyone — while a calibration is a fact about the athlete; folding them together would widen INV-10's signature to admit something that is not the athlete, and the next thing through that door is a personal best. So `startRun()` calibrates first and applies the day's twists on top, and it is the one door every arcade entry point uses. **The daily rolls its own athlete.** "Identical for everyone" and "played with your own squad" cannot both be true and US-16.4 picks the first, so the day's seed rolls a `rare` athlete in the game's own sport: everyone plays the same person, and the challenge measures the run rather than the collection. **The day boundary is UTC** — a local one means two players disagree about which challenge is today's, and a code shared across a timezone resolves to a different run at each end; the screen will say so rather than implying it follows your clock. Challenge codes are Crockford base32 (no `I`/`L`/`O`/`U`) with a two-character checksum, so a mistyped code fails immediately instead of starting the wrong run; the format is versioned (`SG1`) so T-10.1 can extend the payload without invalidating codes already in someone's messages. New `arcade` IndexedDB store, `DB_VERSION` 2 → 3 — a *new* store, so structural only and no entry in the data chain, same as T-3.1's index fix. Backups pick it up with no change, since `backup.ts` walks `STORES`.

### T-4.5

*Free Throw — release timing under mounting pressure*

**The pressure ramp speeds the meter and narrows nothing.** The band stays exactly as wide as the athlete earned, *in seconds*; the marker crossing it faster is what turns a comfortable window into a nervy one. Narrowing the band as you succeed would be difficulty reacting to your scores, which is the thing INV-10 forbids. **Two bugs the tests found, both real.** First, a lives-only game never ends for a player who simply does not shoot — hence the five-second shot clock, which is also the rulebook's own answer. Second, and much worse: a run bounded by *time* hands a novice more attempts, because a novice's meter is faster. Measured, an attribute-35 athlete outscored an attribute-92 one at Fast Break — the fairness rule running exactly backwards. Every game is now a fixed count of attempts, so the athlete's speed decides how hard each one is and never how many you get.

### T-4.6

*Three-Point Contest — five racks, rhythm and timing, 60 s*

Rhythm is the second skill, and it keys on the *variance* between releases rather than on how short they are — so a steady slow tempo pays and mashing does not. The money ball is the last ball of each rack, worth two, and it is the only reason the rhythm bonus has a decision in it: taking the extra half-second breaks the tempo. The contest is the one game with no lives — twenty-five balls and a clock — because ending a sixty-second contest on a miss would make the clock meaningless. Its fixed ball count is also why it was the *only* game already immune to the attempts-inflation bug T-4.5's note describes.

### T-4.7

*Buzzer Beater — contested shot, shrinking window*

The window shrinks **within** a possession and never between them: every possession opens at the full width the athlete earned and closes as the defender's hand rises. The pressure is therefore the clock inside the moment rather than the scoreboard outside it, which is what keeps it clear of INV-10. Points ramp steeply with lateness, so the whole game is one trade made fifteen times. Getting blocked (a release outside the band) costs a life; a contested shot that rimmed out does not — `09` §2.4 splits input from athlete, and lives measure the input.

### T-4.8

*Fast Break — finish past a recovering defender*

The one game where the meter reads as a *place* rather than a moment: the marker is the athlete running at the rim, the band is where the layup is on, and the recovering defender shuts its late edge. Same arithmetic as the other three, different reading — and the reading is what makes `courtSpeed` matter, since a quicker athlete arrives with more of the window still open. A dunk needs a clean look *and* a clean release; an and-one needs the defender genuinely on you, which is the reason to hold.

### T-4.9

*Pickpocket — reaction test, jump the lane without fouling*

The only game in the set that is not a release meter, and the one that forced an honest test harness. **A fixed quarter-second tell, identical for every athlete** — a great defender does not see the pass sooner, they have longer to act on it, which is `perimeterD` setting the lane's duration. Fouling is the only thing that costs a life; letting a pass through costs the possession and nothing else, because punishing patience would teach exactly the wrong instinct for the behaviour being practised. Most of the score is the *earliness* bonus rather than the base, since everyone who reacts at all gets the ball.

### T-4.10

*Arcade → progression: XP, familiarity, `SportEvent` emission at reduced rate*

**The reduced rate is a number, not a branch.** `applyMatch` already took a `rate` scalar for exactly this (T-3.5's note), so arcade pays less without progression ever learning arcade exists (INV-6); there is a test asserting no `if` in `progression.ts` mentions it. **Why 0.6 and not something much lower.** A run is already about a twentieth of a match in wall time, so the rate multiplies something small — a rate low enough to make practising take five hundred runs would satisfy `09` §7's "least per minute" and quietly break §3.4's promise that practice *genuinely* helps. At 0.6, roughly twenty runs are worth a match's learning. **A real bug this found:** the games were emitting zones of their own invention (`aboveBreakThree`, `rim`, `dunk`), none of which appear in `BASKETBALL_XP_AWARDS` — every arcade shot would have trained nothing at all, silently. They now use basketball's own vocabulary, the Three-Point racks map to corner/wing/top exactly as the real spots do, and a test asserts every zone the arcade set emits is one the award table knows. Practice pays nothing, checked here rather than trusted to the caller, because "unlimited and unrewarded" is the sentence that makes unlimited safe.

### T-4.11

*Arcade hot-seat: party rounds, seeded fairness, ranking, elimination formats*

**Seeded fairness has two halves and the second is the one that is easy to miss.** Everyone in a round plays the same seed — that is `09` §4 read literally — *and* everyone plays the same athlete. An arcade window is calibrated to the athlete (INV-10), so letting each player bring their own would make the winner whoever owns the better card; a party is a contest between people, not between collections, so it picks one athlete exactly as the daily does. **Elimination ties send everyone tied at the bottom out together**, unless that would be everybody, in which case nobody goes and the field replays: knocking out one arbitrary player from a three-way tie would make the format depend on seating order, and a tie for last is precisely the moment a party is watching. Standings rank on total, then on best single round, then on seating — a tie broken by something a player did rather than by nothing. Local player names live in preferences, not the database (`08` Q-13, US-17.3): they are labels on seats rather than save slots, they never enter a backup or a P2P handshake, and there is nowhere for them to leak from. A party turn deliberately touches **no** personal best and **no** progression — the athlete is not the player's.

### T-4.12

*Arcade accessibility: left-hand mirroring, colour-independent meters, reduced motion*

**A test asked what mirroring actually changed and the answer was nothing.** The release meter was drawn centred, so `mirrorX` was a no-op for four of the five games and a left-handed player got an identical layout. The meter now sits at 66% of the width — the thumb's side — and mirroring puts it at 34%. **Reduced motion is not "slow the game down":** the marker's movement *is* the game, so what it removes is everything that moves and is not the mechanic — the outcome banner's rise and fade become a static panel with the same words. The banner marks a make with a tick and a miss with a cross, structurally different shapes, so the two read with the colour removed entirely, and the meter's band gained a centre tick so the one place worth hitting is a line rather than "the greener part". Also closed a live gap: nothing in the app was setting `data-motion` on the root, so `tokens.css`'s reduced-motion switch was inert; the run screen sets it now, with a note that T-9.x should move it to bootstrap.

### T-4.13

*Arcade balance: daily reward caps, anti-farm verification (INV-12)*

**Two rules, because either alone fails.** A decay alone still pays forever if you rotate between five games; a cap alone makes the first twenty runs of one game identically worth playing, which is the grind `09` §3.3 rules out. Together: your first run of each game today is worth playing, your fourth is worth almost nothing, and the day has a ceiling regardless — 320 coins, whatever anyone does, asserted over three hundred simulated runs. The headline is the **first three-star of the day per game**, which rewards playing well once rather than playing often. **INV-12 forced a real correction.** T-4.10 shipped the arcade learning rate at 0.6; the invariant is ±25% per minute across modes, so 0.6 failed it outright. Raised to 0.8 — the only band that satisfies both halves of `09` §7, since below 0.75 the invariant breaks and at 1.0 arcade stops being "least per minute". What stops grinding is the cap, not a crushed rate. **The coin half of INV-12 is not checkable yet and the test says so**: `src/economy/` is empty until T-8.9, so there is no Live coin rate to compare against; what *is* asserted is that arcade's own payout is bounded, which is the anti-farm mechanism `09` §3.3 actually names. The file is written so T-5.11 and T-8.9 extend it rather than replace it.

---

## Gate record

### Gate 4 — Arcade framework + basketball arcade set (v0.3)

- **Date:** 2026-07-28
- **Result:** **NOT PASSED — every automatable check green; blocked on the same human verification
  as Gates 2 and 3, which is now three gates of debt.**

`03`'s criterion is four claims: *five arcade games playable and fun standalone; a child can start
one unaided; rewards can't be farmed; calibration demonstrably reflects the chosen athlete.* Two of
the four are machine-checkable and are checked. Two are not, and no amount of test-writing will
change that.

**What is evidenced:**

| Claim | Evidence |
|---|---|
| Five games playable | `tests/unit/sports/basketball/arcade/{games,rules}.test.ts` — all five produce attempts, events, and a result; all five end on their own terms; a player who never touches the screen still finishes with nothing |
| Rewards can't be farmed | `tests/invariants/inv-12-reward-parity.test.ts` — three hundred simulated runs across all five games stay under a 320-coin ceiling; the second hour of grinding pays under 5% of the first |
| Calibration reflects the athlete | `tests/sim/arcade-calibration.test.ts` — every game's median score rises across four athlete tiers, driven by a human-like player with real timing precision and reaction latency; a specialist reaches three stars where a novice does not |
| …and fun standalone | ❌ unverified — a feel note per game is recorded below, written by the author of the game, which is the weakest possible evidence |
| A child can start one unaided | ❌ unverified — every prompt is ten words or fewer and the whole stage is one button, but "unaided" is a claim about a person, not about a prompt |

**Checks run:**

| § | Check | Result |
|---|---|---|
| 1 | Every task `done` or `cut` with a reason | ✅ 13 of 13 `done`, none cut |
| 2 | Full suite green | ✅ 1 941 tests across 115 files; 32 E2E specs in a real browser |
| 3 | Coverage thresholds (`12` §2) | ✅ 94.9% statements / 92.2% branches against ≥85% / ≥80%; every per-area floor holds |
| 4 | No invariant regressed | ✅ and one gained: `tests/invariants/inv-10-arcade-calibration.test.ts`, plus INV-12's first real assertion |
| 6 | Gate criteria in `03` | ⚠️ two of four evidenced; see the table above |
| 8 | Gate record appended, committed, pushed | ✅ this record |
| 5 | Manual device matrix (`12` §7) | ❌ no device available to this session |
| 7 | Tag and deploy | ❌ not done — a user action, for the reasons in the Gate 3 record |

**Budgets and balance.** Initial JS 29.9 KB gzip against a 200 KB budget; install 362.9 KB against
6 MB. `pnpm balance` (500 matches) returns exactly the Gate 3 figures — 75.5 points on 78.7 attempts
at 36.5%, home win rate 44.2%. That is the correct result and worth stating rather than glossing:
**arcade does not touch the Live simulation at all**, so the harness could not have moved. The
corollary from Gate 3 still stands — the balance suite covers seeded stand-ins, not real rosters.

**Three real bugs this phase's tests found, none of which a reading would have caught:**

- A lives-only game never ends for a player who does not shoot. Free Throw has a shot clock now.
- **A time-bounded run hands a novice more attempts**, because a novice's meter runs faster —
  measured, an attribute-35 athlete outscored an attribute-92 one at Fast Break. The fairness rule
  running exactly backwards. Every game is now a fixed count of attempts.
- The games emitted shot zones of their own invention, none of which appear in
  `BASKETBALL_XP_AWARDS`, so every arcade shot would have trained **nothing**, silently.

And one from the accessibility pass: left-hand mirroring was a no-op for four of the five games,
because the meter was drawn centred. A test asked what mirroring changed and the answer was nothing.

**Feel notes (`CLAUDE.md` §9), author-written and therefore the weakest evidence in this record:**

| Game | Note |
|---|---|
| Free Throw | The streak counter climbing while the meter accelerates is the hook; around shot eight it stops being a timing test and becomes a nerve test, which is what a free throw is. |
| Three-Point Contest | Rack four with fifteen seconds left is where it comes alive — you can feel yourself choosing between the tempo bonus and getting the money ball off. |
| Buzzer Beater | The good version is the one where you *know* you left it too late and shoot anyway. The value ramp is steep on purpose to produce that. |
| Fast Break | The honest test is whether you ever go up a beat early *on purpose* because you can hear the defender. If not, it is a third timing meter. |
| Pickpocket | The fun is entirely in the moment *after* the tell, where you have already committed. |

**Deferred, with reasons:** the device matrix and the deploy, unchanged since Gate 2 and now
compounding across three gates. Nothing in this phase changes the analysis in the Gate 3 record:
the deploy is the only route to a real device for this project, it is a user action, and it also
needs Settings → Pages → Source: *GitHub Actions* set by the repository owner.

**One thing worth a decision, not just a note.** Arcade games are unlocked by achievements, and the
achievement system is Phase 8. Rather than ship a hub of five permanently locked tiles, `unlocks.ts`
carries `ACHIEVEMENTS_LANDED = false` and opens everything until T-8.6 flips it. That is a
deliberate, greppable shortcut, and it means **US-16.2 — "earn my mini-games" — is not actually
demonstrated by this phase.** It is built and tested; it is not yet true in the running app.

---
