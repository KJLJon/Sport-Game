# Phase 7 notes — CPU AI depth & difficulty ladder

Long-form rationale for the Phase 7 task rows in [`../PROGRESS.md`](../PROGRESS.md). The
one-sentence version lives there; this is the part a future session needs only when it touches the
code.

---

## Task notes

### T-7.1

*Utility-scoring decision framework shared across sports and modes*

**Two files, split along the line between "what is worth doing" and "when to change your mind".**
`src/engine/ai/utility.ts` is pure scoring: weighted considerations in, a ranked list out.
`src/engine/ai/decider.ts` holds the only mutable state in the framework — what each actor is
currently doing — and turns a per-tick ranking into behaviour a human can read.

**Considerations multiply, they do not average.** `06` §5 says each athlete "scores options against
weighted considerations", and the obvious reading — a weighted mean — is wrong in a way that shows
up immediately in play: an option that is wonderful on four counts and *impossible* on the fifth
still scores well, so the CPU passes to a man who is not there. Multiplying makes a zero fatal.
The known cost of multiplying is that every extra consideration drags the product down, so a
carefully-reasoned option loses to a lazy one; the standard compensation from Dave Mark's
infinite-axis utility system (pull each score back towards 1 by `1 - 1/n`) is applied, and there is
a test asserting two-consideration and three-consideration options stay within a tenth of each
other.

**A veto is absolute, and decision noise cannot undo one.** This is the load-bearing rule for
INV-1. Difficulty enters the framework at exactly two points — the gaussian jitter added to each
option's utility, and the reaction latency in the decider — and neither can produce an *illegal*
decision, only a worse one. Rookie's CPU misjudges which pass is best; it never passes to a
defender because the noise was loud. A test runs 200 draws at maximum noise against a vetoed option
and asserts it is never chosen.

**The decider exists because scoring every tick is not enough.** Acting on the per-tick winner
produces an athlete that twitches between two nearly-equal options sixty times a second, and one
that reacts to a loose ball before it has finished bouncing. Three behaviours fix it:

- *Reaction latency* — a new best option is noticed at once and acted on only after the level's
  reaction time (`06` §7: Rookie 420 ms → Legend 90 ms). This is the whole of how difficulty slows
  the CPU down, and it is why nothing in Phase 7 needs to scale a rating.
- *Commitment* — a challenger must beat the incumbent by a margin. Latency alone still dithers when
  two options trade the lead each tick, which the "does not dither" test demonstrates.
- *Immediate abandonment* — if what the athlete was doing has left the option list or been vetoed,
  the switch is instant. Waiting out a reaction time before stopping an impossible action is not
  realism, it is a bug that looks like one.

**Time is a parameter, never a clock.** `decide(actor, nowMs, candidates)` takes sim time, so a
headless balance batch and a played match make identical decisions (INV-8). Likewise noise takes a
forked `Rng` and draws once per candidate *in input order, whether or not the candidate can win* —
otherwise adding a hopeless option to a sport's list would shift every later draw and break golden
seeds on a refactor that changed nothing.

**What this task deliberately does not do.** It does not wire either sport up. `SportAiAdapter` in
`src/sports/types.ts` still exposes the older `options()`/`score()` pair returning a single number,
and both sports' Live AI still lives in hand-rolled priority logic (`basketball/cpu.ts`, and
soccer's inside `index.ts`). Replacing those is T-7.4 and T-7.5, on top of the roles (T-7.2) and
team coordination (T-7.3) that give the considerations something to read. `AiTuning` in
`decider.ts` is the seam T-7.7 fills from `06` §7's table — the engine takes plain numbers so it
never imports a mode (`04` §5).

### T-7.7

*Difficulty model across all three modes — latency, noise, error, aggression, assists, arcade windows*

**`06` §7's table was already data; what was missing was everywhere it should have been read.** The
four profiles have existed since T-4.2, and exactly one field of one of them was consumed
(`timingWindow`, by arcade). Live had no difficulty at all: `LiveMatch` took a seed, a sport, and a
side, and both sports' CPUs ran off hardcoded constants. This task closed that, and the shape of the
closing is the point — difficulty reaches the simulation through four named channels and no others:

| Channel | Where it lands |
|---|---|
| `cpuLatencyMs` | `reactionChance()` — a memoryless per-step roll whose mean is the level's reaction time |
| `decisionNoise` | Gaussian jitter on a look's expected points (basketball) and on how open the goal is (soccer) |
| `executionError` | Angular error on CPU passes and shots, and how wide of its own ideal a CPU shooter releases |
| `aggression` | How often a defender *commits* to a challenge — never whether they win it |

**Memoryless reaction rather than a countdown.** A countdown makes all five defenders react at
exactly the same instant after a turnover, which reads as a hive mind. `1 - exp(-dt/latency)` gives
the same mean delay with a spread around it, so five athletes look like five people. It also
happens to land Pro at 0.058 per step against the 0.06 that basketball's hand-tuned constant used,
which is why T-2.13's balance pass largely survived this change.

**One number moved and had to be tuned back.** Adding decision noise at 0.35 expected points per
unit pushed basketball's three-point share of attempts from 51.9% to 57.7%, past the 55% band —
jitter tips marginal threes over the bar more often than marginal twos, because the marginal three
sits closer to it. Dropped to 0.18 and the share came back inside. T-7.11 owns the real tuning
against the win-rate curve; this was only about not shipping a red band.

**The preference had to live somewhere other than `difficulty.ts`.** `lastDifficulty()` /
`rememberDifficulty()` started there and broke `pnpm balance` instantly: `difficulty.ts` is imported
by the *sports* layer, so importing `storage/prefs.ts` dragged `import.meta.env.BASE_URL` into a
headless `tsx` run that has no Vite env. They moved to `modes/last-played.ts`, which already owns
"what was played last" and is only ever reached from a mode or a screen. The layering rule that
falls out: anything `sports/` can import must be safe to load outside a browser.

**One ladder, one memory.** `09` §7 says the same four levels apply in all three modes, so there is
one stored preference shared by the Play hub, Playbook's setup screen, and Live — and a
`?difficulty=` in the URL beats it in all of them, so a match stays a shareable link.

**INV-1 has two tests, on purpose.** A behavioural one plays the same seed at all four levels and
asserts every rating of every athlete on *both* sides is byte-identical, and a structural one greps
`src/` for arithmetic mentioning a rating and a difficulty knob on the same line. The behavioural
one would miss a scaling on a path the seed never reached; the structural one would miss one written
around the regex. Neither is sufficient; together they are hard to get past by accident.

**Soccer's Shoot and Pass buttons had never been wired to anything.** Found while adding the
difficulty gate to `decide()`: the function ran for *every* carrier, the player's included, so the
human's athlete shot and passed on its own while the HUD drew two buttons that did nothing at all
(`hud.buttonLabels` has promised `Shoot`/`Pass`/`Tackle`/`Slide` since T-6.29). A human carrier now
acts on A and B and the CPU path is skipped for them; a human defender challenges when they press,
rather than automatically. This is a large part of what the user meant by "not easy to control" —
in soccer, they were not controlling much.

**Soccer's Live balance moved a long way and is still out of band.** T-6.18 left an open finding
against Phase 7: Live soccer scored **12.84 goals a match on 58.5 shots** (band 1.2–5.5), with
conversion inside band at 21.9% — volume, not finishing, because a placeholder CPU shoots the moment
it reaches the final third with a metre of space. With the reaction gate on the carrier's decision:

| | before | after | band |
|---|---|---|---|
| Live · goals per match | 12.84 | **7.50** | 1.2–5.5 |
| Live · shots per match | 58.5 | **16.9** | 8–45 ✓ |
| Live · conversion | 21.9% | **44.5%** | 4–30% |

Shot volume is fixed and the failure has changed shape rather than gone away: a carrier who has to
wait ~280 ms to decide keeps running at goal in the meantime, so the shots it does take are from
almost on top of the keeper. Fewer, far better chances. The remaining defect is now two things
neither of which this task owns — nobody stops the carrier walking into the box (T-7.5's press lines
and defensive shape) and the keeper saves too little of what arrives (a keeper-model question). It
stays an open Phase 7 finding, to be closed by T-7.5 and measured again at T-7.11.


**Pro is the fixed point, and that had to be made true deliberately.** Three of the four channels
were written first as curves through zero — `0.4 + 1.2 × aggression`, `0.5 + 2 × error` — which made
*every* level, Pro included, a slightly different game from the one T-2.13 balanced over five
hundred matches. It showed up immediately: the three-point share left its band, and T-3.6's coupling
tests started disagreeing with themselves. All four now pass through 1× at Pro:

- `contestChance()` is `base × (0.45 + aggression)`, and Pro's aggression is 0.55.
- `releaseSpread()` is `0.4 + 3 × error`, and Pro's error is 0.2.
- The pass reaction is `CPU_PASS_REACTION_PER_STEP × (level ÷ pro)`, anchored on T-2.13's tuned
  constant rather than replacing it.
- Decision noise is measured *above Pro's*, so Rookie misjudges more and the two levels above Pro
  get their sharpness from reaction time and execution error instead.

The one channel that cannot pass through 1× is execution error itself — a Pro CPU that misplaces
passes is the feature — so it draws from **its own forked stream** (`state.executionRng`) rather
than the sim's. Without that, adding the draw shifted every later draw in the match and a Pro game
diverged from the pre-difficulty build for reasons that had nothing to do with difficulty. With it,
basketball's balance table came back to within 2% of T-2.13's on every row.

**Two of T-3.6's coupling assertions were measuring variance, and were rewritten.** `turns the ball
over more` and `scores less` both compared *raw counts* over four seeds. Measured over eight, on the
build before any of this existed, a lost squad scored **165 points to a home squad's 158** — the
assertion was false and had been passing on a four-seed sample. The effect is real and large, but it
is a *rate*: a lost squad turns the ball over once every two passes against once every three and a
half, and shoots 21.0% against 33.7%. What made raw points useless is that a lost squad takes 271
shots to a home squad's 169 — the volume of bad decisions cancels out their badness. Both tests now
assert the rate, over eight seeds, and the file says why.

### T-7.8

*Assist system: aim, pass, auto-switch, timing forgiveness; independent of difficulty; no-assist bonus*

**"Independently of difficulty" is the whole design, and it is two rules.** The level supplies the
*default* — Rookie starts with everything on, Legend with everything off — and the moment the player
touches a dial their choice wins at every level thereafter. `assistsAreCustom()` is what the screen
uses to tell the player which of the two states they are in, because "why did my settings change
when I picked All-Star?" is a bug report waiting to happen.

**Four dials, one place each lands.** Pass assist widens the cone `selectPassTarget()` snaps within;
aim assist pulls a soccer shot's placement back towards the middle of the goal; auto-switch is
basketball's existing `state.autoSwitch`, which had been hardcoded `true`; timing forgiveness
multiplies the *player's* release window and only the player's — giving the CPU the same widening
would quietly make the setting a difficulty knob, which is the one thing `06` §2 says it is not.

**The window moves; the shot does not.** Forgiveness widens the release window, so more of the
player's releases count as good ones. It never touches the probability a good release goes in. That
is the same line INV-1 draws for difficulty, drawn again for assists, and it is why the assist can
be generous without making anyone a better shooter than they are.

**A spectated match gets no assists; a played one gets its level's.** `assistsFor()` reads
`playerSide === -1` — nobody is holding the stick in a balance batch or a rules test, so nothing
should be helping them. Getting this wrong the other way round switched auto-switch off in every
headless match and broke two control tests, which is a good sign the distinction is load-bearing.

**The bonus is computed, not paid.** `assistMultiplier()` returns 1.15 for a no-assist run.
`src/economy/` is still empty until T-8.9, so this is the number Phase 8's payout will multiply by,
alongside the level's own `rewardMultiplier` — the same shape T-4.13 used for arcade coins.

### T-7.2

*Role system: per-sport role tables driving off-ball movement and responsibility*

**A duty answers three questions, and the third is the new one.** Where a role belongs (an anchor as
a fraction of the field, from the end it defends), how far the ball drags it (`ballShade` and
`leash`), and — the part neither sport had — *what it is for* (`job`). The first two the sports
already had in some form: basketball has `offensiveSpot`/`zoneSpot`, soccer has a whole formation
module with `push`/`drop`/`tuck`. Neither had anywhere to say "this position's job, right now, is to
run in behind" or "to hold the space the press leaves", which is why both CPUs orbit the ball.

**`leash` is the number that stops the table collapsing.** Without it every role's spot is
"somewhere between home and the ball", which over sixty ticks is indistinguishable from everyone
chasing the ball — the exact behaviour the role layer exists to prevent. A point guard's leash is
0.3 of the court and a centre's is 0.14, and that one difference is most of what makes a shape look
like a shape.

**The shade is applied and then clamped, in that order.** Clamping the *ball's* position to the
leash first gives a role that stands at the end of its rope pointing at the ball, which reads as a
dog rather than as a defender.

**Basketball's table is written out; soccer's is derived.** Five positions × four phases is a table
worth reading, so it is a literal. Soccer has three formations of eleven, a fourth would be a table
somebody forgot to extend, and `formations.ts` already carries each role's home and its licence to
push, drop, and tuck — so `soccerDuties()` computes the duties from that plus the *line* the role
plays in, classified by where it stands rather than by what it is called. Adding a formation gives
it duties for free. The cost is that a single role in a single formation cannot be hand-tuned; the
benefit is that the formation and the duty table can never disagree about where a left back stands,
which is the failure that actually happens.

**Transition is a phase, not an instant.** `phaseFor()` takes steps-since-possession-changed, and
for a beat *both* teams are in a shape built for the other situation. That beat is where fast breaks
and counter-attacks live, and a model that resets the shape instantly can never produce one — or
concede one. Basketball counts 90 steps, soccer 150, because a soccer team is spread over a hundred
metres and takes correspondingly longer to be in the wrong shape about it.

**Not wired to either sport yet, deliberately.** The duties are the seam T-7.3 (team coordination)
consumes and T-7.4/T-7.5 act on. Wiring off-ball movement to them without the team layer above would
mean two sources of truth for where an athlete stands, which is worse than one that is too simple.

### T-7.3

*Team coordination: formation shape, phase of play, pressing triggers, help defence, transition*

**One call per side per tick.** `createTeam({side, table, field, transitionSteps, shape}).plan(situation)`
returns an `Assignment` per athlete — job, intent, target, mark, urgency — and that is the whole
interface T-7.4 and T-7.5 build on. The sport passes where everybody is and who has the ball; it
gets back where everybody should be and what for. Nothing in `engine/ai/team.ts` knows what a sport
is (INV-5) and nothing in it draws a number (INV-2, INV-8): the plan is a pure function of the
situation plus two pieces of remembered state, the possession clock and last tick's marks.

**Four things a duty table cannot say, which is why this layer exists at all.**

1. *Shape is a team property.* Every one of eleven roles can be individually correct and the block
   still be forty metres too long. `compact()` pulls every target towards the unit's own centroid,
   and it is applied only when the team does not have the ball — compacting an attack is how a
   build-up turns into eleven athletes standing in one half.
2. *Somebody has to go.* Roles all shading towards the ball is not a press, it is eleven people
   watching. The press names a few — ranked by `distance / urgency`, so the role that is *supposed*
   to go beats the one that happens to be a metre closer — and everybody else keeps the shape behind
   them. Triggers are the press line (a fraction of the field, `06` §7's passive → relentless row)
   plus a `trigger` flag the sport raises for cues the engine cannot see: a heavy touch, a pass
   played backwards.
3. *Marks are one-to-one.* `marking.ts` matches defenders to attackers greedily, danger first, and
   — the part that matters — *keeps* the match: an incumbent's cost is discounted by `hysteresis`
   metres. Re-running a nearest-first match every tick is what produces two defenders trading marks
   as an attacker crosses between them, both turning, and the attacker walking through the gap they
   just made for each other. Greedy rather than optimal on purpose: optimal matching happily sends
   one defender sprinting across the pitch so two others save a metre each.
4. *Help costs something.* A helper is a defender who has left their man, so help is capped by
   `helpCount`, never comes off the carrier's marker, and stands on the carrier-to-goal segment at
   `helpDepth` rather than running at the ball.

**The v0.6.0 finding is now structurally answerable.** Live soccer conceded 7.5 goals a match because
nobody stopped the carrier walking into the box. Two of this layer's outputs are exactly that:
the carrier has `danger: 1` so it is picked up before anybody argues about the rest, and the press
sends a named athlete at the ball. There is a test for the penalty-spot case. It is *answerable*,
not answered — until T-7.5 turns an assignment into steering, no soccer athlete reads any of this.

**A loose ball is not a change of possession.** It is the *question* of one. Counting it as an answer
restarts the transition clock twice on every deflection, and transition is the phase whose whole
value is that it lasts a known number of steps.

**A role the table has never heard of gets no assignment**, rather than a plausible made-up one. The
sport keeps whatever it was doing and the missing row is visible instead of silently wrong.

**Difficulty does not appear in this file** (INV-1) and there is no parameter through which a rating
could arrive. A level reaches the team layer by being handed a different `TeamShape` — lower press
line, fewer pressers, a looser block — which is `06` §7's aggression row and touches nothing else.

### T-7.4

*Basketball Live AI depth: pick-and-roll, cuts, zone vs man, rating-driven shot selection*

**The theme is "a decision, not a die".** T-2.8 shipped cuts at a flat 0.4% per step and picked a
screener because they were a big and it was their turn. That produced movement, which was the point
at the time, and it produced the *same* movement whoever was playing: a wide-open shooter cutting
away from their own look, a screen set for a handler nobody was guarding. All four of `03`'s named
pieces now run through T-7.1's scoring.

**An urge, not a boolean.** `cutUrge()` returns a `0–1` utility and the caller multiplies its tuned
per-step rate by it (`CUT_URGE_SCALE`, `SCREEN_URGE_SCALE` = 2.2, so a good look lands near the old
rate). A `selectOption()` boolean evaluated sixty times a second is a *state*, and a cut is an
*event* — wiring it as a yes/no would have every off-ball athlete cutting continuously the moment
their defender relaxed. This way what changed is *who* cuts and *when*, not how much the sport cuts,
which is what keeps T-2.13's balance numbers meaningful.

**The pick-and-roll is the screen's second half.** `screenSteps` counts down; above the halfway mark
the screener holds `screenSpot()`, below it they leave — `rollOrPop()` reads their own ratings and
sends a stretch big to the arc and a rim runner to the rim. Getting that backwards is the most
visible way a basketball AI reads as not understanding the sport, and it is decided by
`threePoint - finishing >= 6` and nothing else (INV-1: no parameter through which a difficulty could
arrive; there is a test asserting the arity).

**The scheme is now a read, not a coin flip.** `pickScheme(rng)` gave one side a 2-3 zone for the
whole match, one match in three. `schemeFor()` runs every possession, in `refreshMarks()` — a zone
concedes the three to take away the rim, so it is right against a team that cannot shoot and wrong
against one that can, and foul trouble pushes the same way for a different reason. Both schemes
still get exercised in the integration suite; what changed is that a team of shooters now sees man.

**The shot bar knows who is taking the shot.** `CPU.possessionValue` was one constant for everybody.
`possessionValueFor()` reads the five on the floor and spreads it ±0.14 points: a side that cannot
shoot takes the shot it has, a side that can passes it up. It moves with fatigue and substitutions
for free because it is recomputed rather than cached.

**Balance moved the right way, all in band.** FG% 36.8 → 38.1, eFG 44.9 → 45.8, three-point share
52.2% → 48.8% (it was near the 55% ceiling), turnovers 22.7 → 21.5, points 76.9 → 77.3. Better shot
selection showing up as better shooting rather than as more shooting is the shape you want.

**One integration test had to change and it is worth knowing why.** *"still ends a stalled possession
on the shot clock"* asserted at least one violation in one quarter of seed `flow`, and with the new
bar that seed produces zero — the offence shoots instead of stalling. It now sums four seeds, so it
tests the mechanism rather than one seed's luck. Verified first that violations still fire (1 per
quarter on four other seeds) before touching the test.

**Not done here:** the team layer (T-7.3) still has no basketball reader. Basketball's off-ball
positioning is `offensiveSpot`/`zoneSpot`/`markingSpot` and it works; replacing it with duty-driven
targets is a spacing change that would re-open every balance number, and it belongs with T-7.11's
tuning pass rather than in the middle of this one.

### T-7.5

*Soccer Live AI depth: build-up phases, press lines, offside trap, counter-attacks*

**The headline: Live goals per match 7.5 → 3.25, inside the 1.2–5.5 band for the first time.** That
number had been the project's oldest open finding, carried from T-6.18 through five gates. Shots per
match 16.9 → 10.6, also in band. What closed it is exactly what T-7.3 predicted would: a *named*
athlete is now sent at the carrier, and the carrier is marked before anybody argues about the rest.
Before this, eleven athletes all shaded towards the ball and none of them arrived, so every shot was
taken from on top of the keeper.

**This is the team layer's first reader.** `planTeams()` runs `createTeam(...).plan()` for both sides
once per step in `moveEveryone()`; an outfield athlete with an assignment takes its target, and a
presser `seek`s the ball rather than `arrive`s at a spot — the difference between being sent and
being pointed. The old formation shape is still the fallback for anybody the plan has no row for.

**The keeper is deliberately not in the plan.** `keeper.ts` is a better model of what a keeper does
than any duty, and a keeper in the marking pool is a keeper who gets assigned a striker.

**Build-up came free.** `03` lists "build-up phases" as part of this task and it needed no code: the
duty table's `BUILD_UP` anchors drop the back line and the phase clock says when. That is the whole
argument for having built T-7.2 and T-7.3 as tables and a clock rather than as soccer code.

**The trap and the counter are soccer's, not the engine's** (`tactics.ts`). Both are *situations*
rather than positions — the same centre-back in the same phase steps up or drops depending on where
the ball is — and a duty anchor has nowhere to say so. The trap has two conditions and both are
refusals: not with the ball behind the line (that is a gap, not a trap) and not with the ball at the
attacker's feet (a through-ball into an empty net). `offside.ts` has enforced the rule since T-6.12
and nothing had ever tried to exploit it.

**Difficulty reaches all of it through `aggression` and nothing else** (INV-1). `soccerShape()`
multiplies the formation's own aggression by the level's, rather than averaging: a cautious
formation on Legend is still a cautious formation, because `06` §7's row is about how hard the same
team competes, not about replacing its manager.

**The one measure still out of band, and why tuning it made it worse.** Conversion is 30.7% against
a 30% ceiling. Two attempts to close it both *raised* it: more helpers (2 rather than 1) gave 34.6%
on 8.3 shots, and a higher, wider press gave 34.9% on 9.3. The mechanism is the same both times —
suppressing shot volume removes the *bad* shots first, so what is left converts better. Lowering
conversion needs the carrier to shoot from distance more often, which lives in soccer's shooting
decision rather than in its shape. Left for **T-7.11**, whose job it is, and the shape reverted to
the setting that produced the best goals-and-shots pair.

**A test had to be loosened, honestly.** The plan is drawn before the step's fouls resolve, so a red
card lands *after* that step's plan was made and the sent-off athlete still appears in it for one
step. The integration assertion is `>= 9` outfield actors with no duplicates and no keeper, rather
than exact set equality. Seed `plans` produces a red card inside ten seconds, which is how this was
found — and is itself worth a look by whoever owns the foul rates.

### T-7.10

*AI regression harness: headless batches per difficulty per mode, asserted win-rate bands*

**What a headless batch can honestly assert, and what it cannot.** `06` §7's bands are written about
a *human*: "a new player should win ~80%+ on Rookie; an experienced player should sit near 50% on
All-Star and below 40% on Legend." No batch can measure that — there is no human in it — and
nominating some CPU as "a new player" would produce a number that looks like the spec's and means
something else. What a batch *can* assert is the property those human bands depend on: **that the
four levels are four different opponents, ordered and spaced.** If Legend does not beat Pro more
often than All-Star does, no amount of playtesting will make the human bands come out right. The
human half stays `12` §7's device matrix and T-7.11's feel work; this is the half that can regress
silently, and now cannot.

**Pro is the reference**, because the CPU was tuned at Pro by T-2.13 and T-6.18 — it is the anchor
everywhere else in the sim, so it is the anchor here.

**Every level plays both sides.** A batch that always put the level under test on side 0 would
measure the level plus whatever home advantage the sport has. Each pairing runs twice with the sides
swapped and the results pool, so home advantage cancels; the balance tools measure it separately and
this one has no business re-discovering it.

**The enabling change was a level per side, and it was most of the task.** With one level for the
whole match both CPUs play identically and a headless win rate is 50% by symmetry. `difficulties`
is now optional on `MatchSetup`, `MatchOptions`, and `PlaybookState`; every CPU decision in both
sports and both modes reads `levels[side]` / `levelOf(state, side)` rather than `state.difficulty`.
Absent, it *is* `state.difficulty`, so every match a player plays is unchanged — verified by the
soccer balance run coming back byte-identical and by a test that a two-legend match and a
`difficulty: 'legend'` match produce the same score.

**The first version of this harness measured luck, and said so by disagreeing with itself.** It
reported the same pairing at 36.7% on one seed set and 81.3% on another — a 45-point swing that no
sampling story explains. Two defects, both mine:

1. **The rosters were not the same.** A match left to itself rolls anonymous ratings from its seed,
   *independently per side*. A random roster edge is worth more than a whole difficulty step, so the
   tool was measuring the draw. Both sides now field the same squad.
2. **The two legs of a pairing used different seeds**, so swapping the sides *averaged over* home
   advantage instead of cancelling it. Both legs now share a seed and a squad and differ in exactly
   one thing: which side got which level.

That last change bought a free self-check. At the reference level both legs are literally the same
match with the sides named the other way round, so Pro must come back at exactly 50% and a margin of
exactly zero — and `judge()` reports it as a bug in the harness if it does not. Every group in the
run below reads `50.0% / +0.00`, which is the tool certifying itself.

**Margin, not win rate, is the headline.** A basketball match is 80 points a side and a soccer match
is two goals; who won is one bit of that, and a batch small enough to run before a gate cannot see
a difficulty step through it. The mean scoreline margin uses the whole scoreline and separates the
levels an order of magnitude sooner — visible below, where basketball's win rates look flat and its
margins are cleanly ordered.

**What the fixed harness actually says.** 30 paired matches per level per sport-and-mode, every
level against Pro, margin in points or goals:

| | rookie | pro | allStar | legend |
|---|---|---|---|---|
| basketball · live | −0.17 | +0.00 | +3.70 | **+5.40** |
| basketball · playbook | −2.13 | +0.00 | +4.20 | **+6.00** |
| soccer · live | −0.40 | +0.00 | +0.27 | **−0.37** |
| soccer · playbook | −0.43 | +0.00 | +0.43 | **−0.07** |

**Basketball's ladder is healthy and soccer's collapses at the top.** Both basketball rows are
monotone with a real gap; the only complaints against them are win-rate spread bands, which the
margins say are noise. Soccer is flat in both modes and *inverted at the top*: Legend is no better
than Rookie, and worse than All-Star.

That it fails in **both** soccer modes is the useful part of the finding. Playbook soccer's only
difficulty channel is the call-sampling temperature, so this is not simply Live's aggression
punishing a relentless defender — something about how soccer converts a better decision into a
better outcome gives out above All-Star. **T-7.11 owns it.**

**Not in the suite.** `pnpm ai:ladder` is a pre-gate tool like `pnpm balance`, and it exits non-zero
today, on purpose. What runs in the suite is `judge()` against fixtures — so the bands cannot rot
silently — plus the one thing a batch cannot check about itself: that swapping which side is Legend
actually produces a different match.

### T-7.11

*Balance pass #3: tune all four levels against the target win-rate curve*

**The bug, and it was a real one rather than a tuning nudge.** A CPU defender's decision to challenge
was `contestChance(base, aggression)` and nothing else — no reference to whether *this* challenge was
any good. `tackleTiming(distance, 'standing')` was computed on the line *after* the commit roll and
handed straight to `resolveTackle`, so the number that says "you are about to swing at nothing" was
already in scope and simply not consulted. `relentless` therefore meant "lunge from the edge of your
reach as often as you lunge when you are on the ball", and the ladder measured the consequence:
Legend conceded 53.6 fouls a match against Pro's 47.5 and lost to a level it outclasses in latency,
noise, and execution error. The same shape was in basketball's steal and block.

**`commitChance()` is mean-preserving, and that is the design, not an implementation detail.** The
first version scaled willingness down by how badly placed the challenge was. It fixed the ladder and
broke the game: judgement became a second aggression dial, every level defended less, and soccer went
from 3.25 goals a match to **4.85** with its cross-mode ratio out of band at 2.06×. The version that
shipped normalises the gate at a neutral challenge, so a level commits exactly as often *on average*
as aggression alone said it would and judgement (`1 - decisionNoise`) only decides *which* ones. There
is a test asserting exactly that property for all four levels, because losing it silently invalidates
every balance band in the project.

**The soccer conversion finding closed from the attacking side, which is the opposite of where it
looked.** Conversion sat at 31.6% against a 30% ceiling — the last soccer band out, and out since
T-6.18. Two attempts to fix it defensively both made it *worse* (more helpers → 34.6%; a higher,
wider press → 34.9%) for the same reason each time: suppressing shot volume removes the *bad* shots
first, so what survives converts better. It was never a defence problem. `SHOOTING_RANGE` had been
tightened to 22 m by T-6.18 to stop a placeholder shooting from halfway, and with the defence T-7.5
gave soccer, 22 m meant the CPU only ever shot from a position it had earned. **27 m** — the edge of
the area, which is where a soccer team does have a go — took conversion to **25.5%** on 14.7 shots
with goals per match unmoved.

**Where the four levels ended up.** 30 paired matches per level per sport-and-mode, against Pro,
margin in points or goals — `pnpm ai:ladder`, zero findings:

| | rookie | pro | allStar | legend |
|---|---|---|---|---|
| basketball · live | −12.73 | +0.00 | −0.53 | **+5.00** |
| basketball · playbook | −2.13 | +0.00 | +4.20 | **+6.00** |
| soccer · live | −0.77 | +0.00 | +1.10 | **+1.20** |
| soccer · playbook | −0.43 | +0.00 | +0.43 | **−0.07** |

Soccer Live was flat and inverted (−0.40 / +0.27 / −0.37) and is now a ladder. Basketball Live's
Rookie fell from −0.17 to −12.73, which is what "comfortably winnable by a newcomer" should look like
in a sport that scores 78 points a side.

**Both balance harnesses are green, soccer for the first time.** All ten soccer bands
(goals 3.75, shots 14.7, conversion 25.5%, ratio 1.60×) and all fifteen basketball bands, with
basketball's fouls falling 11.4 → 10.2 and steals 9.2 → 8.3 — defenders reaching less recklessly,
which is the change working rather than a side effect.

**Left open, honestly.** *Playbook soccer's Legend is still not better than its All-Star* (−0.07
against +0.43). It passes the bands and the direction check, so it is not a gate failure, but it is
not right either. Playbook's only difficulty channel is the call-sampling temperature, and at
Legend's `decisionNoise: 0.04` the CPU is very close to picking the argmax every turn — which against
an opponent that reads tendencies is the most *predictable* thing it could do. Minimal decision noise
making a CPU exploitable is a genuine design finding and it belongs to **T-7.6** (tendency modelling,
counter-calling), which is the task that owns Playbook's read model.

**Feel note.** Not played by a human this session. The ladder is a batch result, and the half of
`06` §7 that is written about a person — "comfortably winnable by a newcomer", "beats an experienced
player more often than not" — still needs somebody to sit down with it. That is Gate 7's device
matrix, and it should not be signed off from a table of margins.

### T-7.6

*Playbook AI depth for both sports: tendency modelling, counter-calling*

**Both halves are `06` §7's exploits row, which had no reader anywhere in the project.** *Exploits
mismatches and low familiarity: no · rarely · often · consistently* was in the difficulty table from
the start, and `DifficultyProfile.exploits` was carried, stored, and never once read. Playbook's
only difficulty channel was the sampling temperature.

**Counter-calling is now a level.** Both sports already modelled the opponent's tendencies and
adjusted call scores by a fixed `READ_WEIGHT`, so a Rookie CPU punished a repeated call exactly as
ruthlessly as a Legend one — which is not what the table says and not what a Rookie should be.
`scaleRead()` applies the level at the one place it belongs: *after* the sport has priced the read,
so no sport has to know what a level is.

**Not being read is the other half, and it is the one the ladder found.** At Legend's
`decisionNoise: 0.04` the CPU took the top-scored call nearly every turn. Against an opponent that
reads tendencies — which is exactly what the other half of this task builds — playing the argmax
every turn is the most exploitable thing a CPU can do, and T-7.10 measured the consequence as
Playbook soccer's Legend being no better than its All-Star. `repeatPenalty()` discounts a call the
CPU has itself been leaning on, by the same measure it uses against the opponent. The symmetry is
the point: punishing your patterns while having none of its own is what "reads you" should mean.

**The baseline is an even spread of the sheet, not of what it played.** The first version compared a
call's share against the calls the CPU had actually made, which is circular — a CPU that had called
one thing ten times came out perfectly balanced, penalty zero. It now takes the option count and
compares against `1 / options`, so a CPU spreading evenly pays nothing on any of it and one that has
found a single favourite pays the most.

**Variety is a tiebreak, not a strategy, and the first weights got that wrong.** At two thirds of the
read weight, basketball's Playbook Legend fell from **+6.00** to **+0.93** against Pro: it was
varying off genuinely better calls to avoid being predictable. Both sports now express the repeat
weight as `READ_WEIGHT / 3`, which states the trade in the code rather than hiding it in two
unrelated constants.

**Don't tune against noise — a 30-match Playbook batch cannot see these effects.** Two intermediate
runs reported findings (basketball Rookie 46.7%, soccer All-Star 41.7%) that both vanished at 160
matches a level. Playbook batches are seconds where Live is minutes, so `AI_MODE=playbook` was added
to the harness to make a decisive sample cheap. Every tuning decision below is from 160.

**And then the default was fixed, because that lesson should not have to be learned twice.**
`pnpm ai:ladder` now runs 24 matches a level in Live and **160 in Playbook** — a Playbook match costs
a hundredth of a Live one, so there was never a reason for both to share a sample size. A regression
harness whose default cannot tell a regression from a coin flip is worse than no harness, because
somebody will eventually tune against it. It reports zero findings on those defaults.

**Where Playbook ended up**, margin against Pro at 160 matches a level:

| | rookie | pro | allStar | legend |
|---|---|---|---|---|
| basketball · playbook | −3.73 | +0.00 | +3.70 | **+8.35** |
| soccer · playbook | −0.20 | +0.00 | +0.14 | **+0.30** |

Both monotone, both in band, zero findings. Basketball's Legend is now *better* than it was before
this task (+8.35 against the old +6.00), which is what adding a channel should do rather than
trading one for another.

**Soccer's Playbook ladder is thin, and that is a real product observation.** A soccer match is two
goals and its intents score close together, so a level has far less room to show an edge than in
basketball — the whole ladder spans half a goal. `NOISE_TO_TEMPERATURE` went 0.3 → 0.55 to give
Rookie somewhere to be bad, which was enough to clear the band. If soccer's Playbook levels ever
need to feel more different than this, the lever is the *spread of the scores*, not the sampling.

### T-7.9

*CPU team generation: coherent opponents and identities scaled to difficulty*

**"Scaled to difficulty" cannot mean what it sounds like, and the user stories say so.** Read
carelessly, `03`'s row asks for a Legend opponent that fields better athletes. US-7.2 forbids it in
as many words — *"difficulty never alters any athlete's attributes or ratings on either team, and
this is verified by a test"* — and `06` §7 gives the reason: stat-cheating difficulty makes wins feel
unearned. Generating a stronger roster is stat-cheating with an extra step; the athlete card would
be honest and the match would still be rigged.

US-7.1 says what actually scales, and it is the more interesting reading anyway: *"the CPU fields a
**coherent** lineup and plays to a **recognisable style**."* So a level buys **coherence**, not
points:

- Every level draws from the same budget. The squad's total attribute points are identical at Rookie
  and at Legend, seed for seed — and *per athlete*, not just in aggregate, because a generator that
  took from one athlete and gave to another would pass a squad-total test while handing the CPU a
  star. Both are asserted.
- What rises is how well those points fit the style the team plays. A Legend opponent's athletes are
  *shaped* for what it does; a Rookie's are the same points spread anywhere, so it fields a
  collection rather than a team.

`06` §7's `tactics` row is the dial, because "was this side assembled by somebody who knows what they
are doing" is the same question as "does it use advanced tactics", one turn earlier.

**`shapeToward()` is the whole INV-1 argument in one function.** Coherence decides the *shape* of a
spread and has no way to decide its *size*: points are taken proportionally from what the style does
not want and given proportionally to what it does, and `settle()` puts the rounding residue back so
the total is exact rather than exact-on-average. A Legend opponent's centre-back is not a better
athlete than a Rookie opponent's — they are a better centre-back.

**The move is bounded at both ends, which the first version got wrong.** Capping only what the
unwanted attributes could spare meant a style wanting a single attribute piled every spare point
onto it: `speed` came out at 99 from a flat 50 spread. The move is now bounded by what the wanted
attributes can *hold* as well, so a style is recognisable rather than a spike — and 45% of the
available room is the ceiling even then.

**Five styles, and the constraints on the list are tested rather than trusted:** no two want the same
three attributes (or two opponents would be indistinguishable) and between them they want all eleven
(or some attribute is dead weight in every opponent the game generates).

**Not yet wired to a screen.** `generateCpuTeam()` returns a `Team`, its athletes, and its style;
nothing calls it, because the mode that picks an opponent is Phase 8's modes hub (T-8.1) and the
pre-match screen that would show the style and blurb does not exist. The generator is the part that
belongs to this phase.
