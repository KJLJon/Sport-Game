# Phase 2 notes — Basketball · Live

Long-form rationale for the Phase 2 task rows in [`../PROGRESS.md`](../PROGRESS.md). The one-sentence version lives there; this
is the part a future session needs only when it touches the code.

---

## Task notes

### T-2.1

*Court geometry, zones, arc, key, hoop, boundaries*

FIBA dimensions in metres (28 × 15), origin at a corner, `goals[side]` is the basket that side *defends* — same convention as the seam. The three-point test is deliberately two rules, not one: beyond the arc **or** outside the straight corner lines, because a distance-only test scores the corner three as a two. World bounds equal court bounds, so an inbounder stands on the line rather than a metre behind it; nothing in the rules depends on that metre. `court-render.ts` draws the line art from the same constants, and its test asserts the arc's radius and sweep match the rules' — the one piece of art with a derived shape.

### T-2.2

*Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts*

Clock compression is 4× — a three-real-minute quarter showing 12:00 (`06` §3.1) — and it is *derived* from the two quarter figures rather than authored, so the pair can never disagree. Every duration is written in game seconds, the number on the HUD, and converted to steps in one place. The shot clock is therefore 24 on screen and six real seconds in the hand, which gives ~23 possessions a quarter. Two bugs found in the first headless run: the five-second inbound count was running while the inbounder was still sprinting the length of the court (it now starts when they *have* the ball, which is the real rule), and the setup counter was not reset on a new restart, so violations cascaded. Simplification: every restart gives a fresh 24, where the real rules sometimes keep the remaining clock. Fouls, free throws, and the bonus are T-2.7 — the state shape has room for them.

### T-2.3

*Shooting: hold-release meter, arc trajectory, make probability from ratings × distance × pressure × release*

The outcome is decided at release and the trajectory is then aimed to match — dead at the rim for a make, deliberately off it for a miss. Letting collision decide would make the make rate a property of the physics tuning rather than of the athlete, which is the one thing `06` §3.1 rules out. The model is multiplicative, so a smothered elite shooter is still a bad shot; each of the seven terms `06` §3.1 names has a test that moves only that term. Difficulty enters through exactly one number — `timingAssist`, which scales the *player's* release window — and never appears in the probability model (INV-1). Player and CPU share the meter; the CPU's release is a seeded target hold. **Feel note:** untested by hand — the meter has no HUD until T-2.10, so the timing is currently a number rather than a feeling. Headless, a game runs 75–52 on ~135 shots at ~46%, which is the right shape and the wrong shot chart: nearly everything is at the rim because shot selection is still a placeholder (T-2.8).

### T-2.4

*Passing: aimed, lead passes, interceptions, turnovers*

Unlike a shot, a pass is *flown* rather than resolved at release: whether it arrives depends on where five defenders happen to be while it is in the air, so interceptions fall out of proximity — which is also what makes jumping a lane something a player can do rather than a die the sim rolls for them. The lead is solved in two iterations, because one uses the receiver's current position and is wrong exactly when the lead matters. Two bugs found headless: a defender draped over the passer was inside catching range the instant the ball left the hand (there is now a six-step delay — taking it out of someone's hands is a *steal*, T-2.7), and a pass spends ten-odd steps inside a defender's reach, so each defender now gets one read per pass rather than ten. Interceptions went from 37% of passes to ~5%. Difficulty's only lever is the pass-assist cone width (INV-1).

### T-2.5

*Dribbling & driving: handling control, contact absorption, blow-by*

All three costs are per-*step* draws, because a drive is two seconds of sustained pressure rather than an event — the model has to be able to say "he lost it halfway in". That makes the fumble chance a number that looks tiny and, times the three hundred steps of a possession, quietly decides how often anyone keeps the ball; the test asserts the compounded rate, not the per-step one. Bug found headless: contact was resolving on every step two bodies leaned on each other — 2 197 collisions a game — and now resolves on the step they meet, giving ~113. Contact reports a `severity` for T-2.7's foul model and decides no whistle itself. Blow-by is one attempt per defender per possession, so a drive is a move rather than a dice tower.

### T-2.6

*Rebounding: height/vertical/strength/box-out/timing contest*

A weighted draw, not a highest-score contest: taking the best score would mean the same five athletes rebound in the same order every time and a possession would be readable from the box score before the shot went up. Skill enters the draw squared — linear, an elite rebounder beats a guard only 60/40 with everything else equal, which does not read as elite. Better rebounders get a *narrower* timing spread rather than a bonus, which is the difference between good and lucky. **Known imbalance:** the offensive rebound share is around half, because nobody boxes out yet — the defence has no reason to put a body between shooter and rim until T-2.7, so the team driving the basket is simply nearer the ball. The contest is right; the positioning is T-2.7's and the balance is T-2.13's. Also fixed here: a restart reset the shot clock without saying so, which would have left the HUD showing the old count.

### T-2.7

*Defence: marking, contest, steal, block, foul model, free throws*

Every defensive action carries a foul risk, and that is the design: a steal that could only succeed or fail would be free to spam, one that can also concede two shots is a decision. Ball before whistle, always — a defender who gets it cleanly has not fouled, however fast they arrived. Three bugs and one model error found headless: **(1)** the first free throw of the first game was never taken, because `arrive` with a tight slowing radius cannot decelerate a sprinting athlete in time and they orbit the spot for ever; **(2)** a first guess of `baseFoul: 0.3` produced fifty fouls and ten disqualifications in one game — every athlete on the floor fouled out; **(3)** the CPU block rate gave thirteen blocks a game, two or three times a real one, because a shot hangs half a second and every step was another chance; and **(4)** contest was computed from the nearest opponent regardless of *direction*, so a defender standing behind the shooter contested as hard as one in the shot line, and tight man defence dropped the whole floor to 25% — it is now weighted by alignment with the basket. The release meter also came down from 30 steps to 22, because at half a second the defence closed between the decision to shoot and the shot. A game now runs 62–43 with 25 fouls, 8 blocks, 29/36 from the line, and 34% from the field. **Feel note:** still nothing played by hand — no HUD until T-2.10. 34% is low and the shot chart is still rim-heavy; both are shot selection, which is T-2.8's, and the numbers are T-2.13's. Zone defence is deferred to T-2.8 with scheme selection.

### T-2.8

*Baseline CPU: role-based offence (spacing, cuts, screens), man defence, possession decisions*

Decisions are **expected points**, not thresholds. "Shoot if open and close" has to be re-tuned for every change to the shooting model; "shoot if this is worth more than what the possession is otherwise worth" re-tunes itself — and it is the only formulation that takes the corner three, because a 36% three beats a 40% two and no distance-and-openness rule will ever say so. Four things found by running it: **(1)** with five athletes properly spaced somebody always looks marginally better, so at a low pass margin the offence ping-ponged — 1 264 passes and 167 turnovers in one game; the margin plus a settle delay on the receiver cut it to ~170. **(2)** The shot bar was first set at league-average efficiency (1.06), which means only above-average shots are ever taken — arithmetically impossible, and it produced 61 attempts instead of 160. It is now the *continuation* value (0.85): declining a shot costs clock and risks a turnover, so what is left is worth less than the possession was. **(3)** The CPU valued every shot as if set and then took it on the move, which filled the shot chart with mid-range pull-ups; it now values the movement state it is actually in. **(4)** A 2-3 zone with its top pair inside the arc lost 104–32 — it now sits outside the arc and closes out on the ball, which brought it to 49–83. A game runs ~132 points on 133 attempts at 37%, 76 rebounds split 25/51, 8 blocks, and a real shot chart (36 threes, 43 mid, 54 inside). **Feel note:** still unplayed by hand; no HUD until T-2.10. The remaining scheme gap — zone still loses to man by more than it should — is T-2.13's, along with the low team scores.

### T-2.9

*Control switching: auto on turnover, manual cycle, controlled-athlete indicator*

Hysteresis is the whole feature: without a margin, two athletes a hand's breadth apart trade control every few frames and the player's thumb is attached to nobody. Auto-switch is modelled as an *assist* (`06` §2 lists it beside aim and pass assist, tunable on its own), not as a difficulty setting — so with it off the player keeps whoever they picked and cycles by hand, and the only thing that overrides that is their athlete leaving the floor. The switch is published as a `SportEvent` rather than only written to state, because the HUD has to flash the indicator on it and neither it nor the audio layer can poll a field without guessing when it changed. **The indicator itself is deferred to T-2.10** — it is a HUD element and there is no HUD.

### T-2.10

*Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators*

Built the Live mode host first, because there wasn't one — `03` never gave it a task, it is implied by this one. Two seam decisions came out of it. The sport now publishes a `SportStatus` ("action clock", not "shot clock"): a HUD reading `state.rules.shotClock` would carry basketball's field names into shared UI and break the no-sport-branching rule the moment a second sport arrived. And the sport's `score` event is a *request* while the match clock's is the record — emitting both counted every basket twice, and two sources of a scoreline is how a HUD and a summary end up disagreeing. Assists are inferred in the box score rather than emitted by the sport, so every sport with the concept gets it free. The HUD layout is a pure function of viewport and insets, which is the only way a notch is testable without a device. **Not delegated after all** — `03` marks it `sonnet`, but the host underneath it is the sport-module seam, which `CLAUDE.md` §7.2 says never to delegate, and the HUD is thin once the host exists. T-2.12 was delegated instead.

### T-2.11

*Pause menu, quit, in-match settings, post-match summary with box score*

Lives in the same file as the HUD wiring, because the pause menu, the summary, and the HUD are three views of one running match and what they share is its lifecycle — when to stop the loop, when to release held input. A lifecycle with three owners has none. The box score is a real `<table>` with `scope` on every header, so "shows the box score" and "a screen reader can read the box score" are the same claim. Backgrounding the tab pauses, and pausing releases held input — a joystick still held when the menu opens would keep steering an athlete nobody is watching. **In-match settings are deliberately two:** handedness and sound, both of which take effect the instant they are toggled. The assist strengths `06` §2 lists need the settings store and difficulty seam that arrive in Phase 7; a toggle that quietly does nothing is worse than no toggle. Bug found in testing: a checkbox nested inside its own label has ambiguous activation, so the settings use a `for`/`id` pair instead.

### T-2.12

*Basketball art & audio pass*

**Delegated to `sonnet`** — see the delegation log. Palette hex is mirrored from `10` §3.1's tokens with the token name commented beside each value, because a canvas paints pixels and cannot cascade a custom property; `art.test.ts` is the tripwire for the two drifting apart. Colour is never the only signal (`10` §11): the teams differ by kit stripe as well as hue, and at MINIMAL detail by *shape* — one circle, one diamond — so team identity survives the LOD that throws detail away. The controlled marker is a stroked ring at every tier, because "which one is mine" is not decoration. Audio is entirely synthesised — oscillators and gain envelopes, no files — which keeps it inside the no-network rule (INV-14) with no licensing story; the `AudioContext` is never constructed at import time, since browsers refuse one before a user gesture, so the screen builds it on the first tap. A `null` context and `muted` are both first-class no-ops rather than a volume of zero. The main session wired the art into the match screen (replacing duplicated inline drawing) and the audio to the event bus, the sound setting, and the pause state. **One agent judgement worth knowing:** there is no "shot missed" event, so the rim-miss cue triggers on `rebound`, which is only reachable from the missed-shot path; documented in `audio.ts` rather than papered over.

### T-2.13

*Balance pass #1: shooting percentages and pace plausible over 500 headless games*

A **tool, not a test**: five hundred matches is six minutes of CPU, and a suite that takes minutes is a suite people stop running. Bands, not exact numbers — pinning a number pins the seed, and the next upstream draw turns it red for nothing. The run found three real bugs and one mis-calibration. **(1)** `Rng.int` is half-open, so `int(0, 1)` is the constant zero — and it was used as a coin flip in three places, which gave the home side *every* opening tip and *every* zone in five hundred games. Now `bool()`. **(2)** Loose balls and contested passes went to the first eligible athlete in entity order, and entity order is team order: the home side won every simultaneous scramble. Now nearest. **(3)** Once man marking existed, every receiver had a defender beside them, so 19% of all passes were intercepted and half the rest deflected; a defender's reach and control are now much smaller than a receiver's. **(4)** The shooting constants were authored for "clean, set, perfect release" and never checked against what a *typical* shot looks like after the penalty stack — 30% from the field against a real game's 46%. Final: 75.5 points, 78.7 attempts, 44.5% eFG, 30.7% from three on a 52% three-rate, 45.6 rebounds, 21.8 turnovers, 11.8 fouls, home win rate 44.2%. **Two known residuals, both recorded rather than hidden:** the offensive-rebound share sits at 44%, at the top of its band, because box-out positioning is still weak; and the away side wins 55.8% (n=500, ≈2.6σ), a real but small structural edge I could not localise — T-7.10's win-rate verification is the right place to finish it.

---

## Decisions taken during implementation

Small calls that did not warrant a spec change. Anything that changes the product goes in
[`../07-decisions.md`](../07-decisions.md) instead.

### 2026-07-27 · T-2.1 — FIBA court dimensions (28 × 15 m), not NBA

The world already works in metres; FIBA's numbers are metric by definition rather than by conversion, so no constant in the file is a rounded foot.

### 2026-07-27 · T-2.1 — World bounds equal court bounds — an inbounder stands *on* the line, not behind it

Keeps `world.clampToBounds` the whole out-of-bounds containment story for athletes. Nothing in the rules depends on that metre, and an offset coordinate space would have to be undone everywhere.

### 2026-07-27 · T-2.2 — Clock compression is 4× (3 real minutes shown as 12:00) and derived from the two quarter figures

`06` §3.1 fixes both ends; deriving the ratio means a future tuning change to either cannot leave them inconsistent.

### 2026-07-27 · T-2.2 — Every restart gives a fresh 24, where the real rules sometimes retain the clock

The retention cases all depend on *why* the ball went out, which needs the foul model (T-2.7). Revisit at the balance pass (T-2.13) if possessions feel long.

### 2026-07-27 · T-2.2 — No eight-second backcourt count

At 4× clock compression it gives a ball-handler two real seconds to cover fourteen real metres — not a rule, a guaranteed turnover. It cost one team 79 of them in the first headless game. `06` §3.1 asks for the *backcourt violation*, which is the over-and-back rule, and that is implemented.

### 2026-07-27 · T-2.3 — A shot's outcome is drawn at release; the trajectory is then aimed to match it

The alternative — fly the ball and let collision decide — makes the make rate a property of the physics tuning rather than of the athlete's ratings, which `06` §3.1 explicitly rules out. The ball still travels a real arc and a miss still caroms off a real rim.

### 2026-07-27 · T-2.3 — Placeholder shot selection got two small tweaks it did not strictly need

Without a pull-up behaviour for perimeter roles, every possession was a drive and the three-point half of the shooting model never ran in a real match. Both tweaks are T-2.8's to replace.

### 2026-07-27 · T-2.4 — A pass is flown and resolved by proximity; a shot is resolved at release

They fail differently. A shot's outcome depends only on the shooter's circumstances at release, so drawing it there keeps the make rate a property of the athlete. A pass's outcome depends on where the defence is *during* the flight, which cannot be known at release without simulating it.

### 2026-07-27 · T-2.6 — The rebound is a weighted draw rather than the highest score

The best score always winning makes the same five athletes rebound in the same order every game, and a possession's outcome readable before the shot goes up. The draw keeps the better rebounder winning most of them and leaves the guard who got position his share.

### 2026-07-27 · T-2.7 — Zone defence deferred to T-2.8

`06` §3.1 lists man and 2-3 zone as *schemes*. A scheme is a variation on marking, and marking is what T-2.7 builds; picking between schemes is a CPU decision and belongs with the rest of them.

### 2026-07-27 · T-2.7 — Contest is weighted by direction, not just distance

A defender standing behind the shooter is not contesting the shot however close they are. Without it, tight man marking made every shot maximally contested from every angle and the whole floor shot 25%.

### 2026-07-27 · T-2.8 — The CPU decides by expected points rather than by rules of thumb

A threshold table has to be re-tuned for every change to the shooting model and never takes the corner three. Expected points re-tunes itself and gets the three right by construction.

### 2026-07-27 · T-2.8 — The shot bar is a possession's *continuation* value, not its total value

Set at league-average efficiency it means only above-average shots are ever taken, which cannot be true of an average. Declining a shot burns clock and risks a turnover, so what remains is worth less than the possession was.

### 2026-07-27 · T-2.9 — Auto-switch is an assist, not a difficulty setting

`06` §2 lists it beside aim and pass assist, tunable independently. Modelling it as difficulty would make it a thing the player cannot choose separately, which is the opposite of what the spec asks for.

### 2026-07-27 · T-2.9 — With auto-switch off, the player is *not* switched to the ball-carrier

Off means off. The alternative reading — always follow the ball — makes the setting do nothing on offence, which is most of the game.

### 2026-07-27 · T-2.13 — `Rng.int(min, max)` is half-open, and reads as inclusive

`int(0, 1)` returning a constant zero is a trap that cost this phase three coin flips and a structural home advantage nobody would have found by reading the code. The engine is not mine to change mid-phase and other call sites may rely on the range; `bool()` is used for coin flips instead. Worth revisiting as an engine ergonomics fix.

### 2026-07-27 · T-2.13 — Balance targets are bands, and `eFG%` carries the tight one

Raw field-goal percentage is not comparable across offences with different shot mixes — a team taking half its shots from three has a lower one by construction, and chasing the league-average number would mean tuning the CPU into taking *worse* shots.

### 2026-07-27 · T-2.12 — **Raised, not fixed: the `@invariant` IDs in spec headers do not match `12` §3's table.** Headers across Phases 0–2 use `INV-5` for "no sport-specific branching in engine core" and `INV-11` for "no information by colour alone" — but in `12` §3, INV-5 is the pack-economy rule and INV-11 is cross-mode outcome parity. Those two meanings come from **CLAUDE.md §8's** numbered constraint list, which is a *different* numbering from the INV table.

The convention was set in Phase 1 (`src/sports/types.ts`, `testsport/index.ts`) and this session followed it, so 26 references across 13 files are consistent with each other and inconsistent with `12` §3. Every use carries its meaning in parentheses, so no reader is actually misled — which is why this is recorded rather than mass-edited mid-phase. It needs one decision (renumber the headers, or give CLAUDE.md §8's list its own prefix such as `C-4`/`C-11`) and one mechanical pass. Raised with the user at the Phase 2 gate.

### 2026-07-27 · T-2.10 — Built the Live mode host, which `03` has no task for

The HUD needs something to be a HUD *of*. `03` implies the host in T-2.10/T-2.11 without naming it; rather than invent a task ID, it is recorded against both.

### 2026-07-27 · T-2.10 — T-2.10 was not delegated despite `03` marking it `sonnet`

The host underneath it is the sport-module seam, which `CLAUDE.md` §7.2 says never to delegate — and once the host exists the HUD is thin. T-2.12 was delegated instead.

### 2026-07-27 · T-2.11 — In-match settings are handedness and sound only

Everything else `06` §2 lists — aim assist, pass assist, auto-switch strength, timing forgiveness — needs the settings store and the difficulty seam from Phase 7. A toggle that quietly does nothing is worse than no toggle.

### 2026-07-27 · T-2.6 — No delegation this session, despite the offer

The tasks marked `sonnet` in `03` are the HUD (T-2.10), the pause/summary screens (T-2.11), and the art pass (T-2.12). All three are out of order, and the art pass in particular has nothing to be viewed in until the HUD exists — reviewing a large diff for it would have cost more than the gameplay tasks it displaced. Worth revisiting once T-2.10 lands.

---

## Gate record

### Gate 2 — Basketball · Live (v0.1)

- **Date:** 2026-07-27
- **Result:** **NOT PASSED — automatable checks all green, blocked on human verification.**
  Seven of the nine `CLAUDE.md` §5 steps are satisfied. The two that are not need a phone and a
  person, and neither can honestly be signed off from here.

**What passed**

| § | Check | Result |
|---|---|---|
| 1 | Every task `done` or `cut` | ✅ 13/13 `done`, none cut |
| 2 | Full suite green | ✅ 1 069 unit/integration/invariant/determinism across 60 files; 32 E2E in headless Chromium, including 4 new match tests and the axe audit of the paused screen |
| 3 | Coverage thresholds (`12` §2) | ✅ 91.2% overall against ≥85%. **Two thresholds `12` §2 requires were not being enforced at all** — the overall floor and `src/sports/*/rules` ≥90% — and were added at this gate rather than noticed later. `rules.ts` is at 100%. |
| 4 | No `12` §3 invariant regressed | ✅ 22 invariant tests green |
| 6 | Gate criteria in `03` | ⚠️ partly — see below |
| — | Perf budget (`12` §6) | ✅ 0.074 ms mean sim step against a 4 ms budget, 23 entities |
| — | Size budget | ✅ 25.4 KB initial JS / 200 KB; 179 KB install / 6 MB |

**What did not**

| § | Check | Why not |
|---|---|---|
| 5 | Manual device matrix (`12` §7) | No device available to this session. Nothing in Phase 2 has been touched by a thumb: every "feel note" in the table above is honestly recorded as unknown, and the release-timing meter — the mechanic the whole shooting model hangs on — has never been *felt*. |
| 7 | Tag, deploy, verify install-from-scratch and offline on a real device | Not done, deliberately. Deploying is outward-facing and hard to reverse; it wants a decision rather than an assumption. The verification half needs the device from §5 anyway. |
| 6 | "…and it's fun enough to play twice" | A human judgement. The machine half of `03`'s gate criterion — *a full basketball game is playable end to end against the CPU, offline, from the installed app* — is evidenced: the E2E suite mounts a match in a real browser, watches the canvas change between frames, opens the pause menu, reads the box score as markup, and quits cleanly; the PWA lifecycle suite already covers offline and install-from-scratch for the shell. The other half is not something a test can claim. |

**The balance run, in full** (`pnpm balance`, 500 matches, 1 000 team-games):

| | Value | Band |
|---|---|---|
| Points per team | 75.5 | 55–125 |
| Field-goal attempts | 78.7 | 45–110 |
| Field-goal % | 36.5% | 33–55% |
| Effective FG% | 44.5% | 40–58% |
| Three-point % | 30.7% | 25–45% |
| Three-point share of attempts | 51.9% | 8–55% |
| Free-throw % | 68.7% | 55–85% |
| Rebounds per team | 45.6 | 20–60 |
| Offensive rebound share | 44.4% | 15–45% |
| Turnovers per team | 21.8 | 6–30 |
| Personal fouls per team | 11.8 | 4–30 |
| Steals per team | 9.5 | 2–18 |
| Blocks per team | 4.5 | 0.5–12 |
| Home win rate | 44.2% | 35–65% |
| Ties | 0.0% | 0–2% (overtime resolves them) |

**Deferred, with reasons**

- **The away side wins 55.8% over 500 matches** (≈2.6σ). Two structural causes were found and
  fixed at T-2.13 — an entity-order tie-break that was really a team-order tie-break, and
  `Rng.int(0, 1)` used as a coin flip when the range is half-open — but a small residual survives
  and I could not localise it. `T-7.10` verifies win-rate bands by design and is the right place to
  finish it.
- **Offensive rebounds are 44.4% of all rebounds**, at the very top of the band. Box-out
  positioning exists (`defence.boxOutSpot`) but is weak against an offence that crashes.
- **`src/modes/live/screen.ts` is at 37% line coverage.** Its mount-and-loop path is covered by the
  four browser E2E tests, which vitest cannot see. Not gamed with a shim; recorded as-is.
- **Spec-header `@invariant` IDs do not match `12` §3's table** — see the implementation-decisions
  table. Needs one decision from the user and one mechanical pass.

---
