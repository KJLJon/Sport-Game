# Phase 6 notes — Soccer · all three modes

Long-form rationale for the Phase 6 task rows in [`../PROGRESS.md`](../PROGRESS.md). The
one-sentence version lives there; this is the part a future session needs only when it touches the
code.

---

## Task notes

### T-6.1

*Pitch geometry, zones, goals, boundary lines*

**The shape of the file is basketball's on purpose.** `src/sports/soccer/pitch.ts` deliberately
mirrors `court.ts` member for member — a `PITCH` constants block, `CENTRE_X` / `CENTRE_Y`, a private
`GOALS` array feeding `FieldGeometry`, `defended*` / `attacked*` / `attackDirection`, zone
predicates, `crossedBoundary`, restart spots, `mirrorX`. That is not copy-paste for its own sake: it
is the cheapest available check that the seam's `FieldGeometry` is genuinely sport-agnostic. Every
place the two files *had* to diverge is a place the seam was doing real work, and there were only
two of them, both inside the sport where they belong (below).

**A goal is a mouth, not a point.** Basketball's target is a rim, and `Goal.radius` is the rim's
radius; the whole of scoring is "is the ball within radius of that point". Soccer's target is a
rectangle, and two questions fall out that a court never had to answer:

- `isGoal(x, y, z, defendingSide)` — past the line, *between the posts*, *under the bar*. The
  whole-ball-over-the-line law is not modelled; the ball is a point everywhere else in the engine,
  and adding a radius correction here would make this the one place it isn't.
- `goalAngle(x, y, side)` — how much of the mouth the shooter can actually see. This is the honest
  measure of a chance, and it is why a shot from the by-line is bad however short it is.

`Goal.radius` is filled with the mouth's *half-width* (3.66), since the field type documents it as
the target's size and for a mouth that is the half-width. `z` is the crossbar, matching
basketball's use of it for the rim.

**`goalOpenness` exists because `goalAngle` alone cannot say "tight angle".** The first cut of
`shotZone` classified anything under 20° of subtended goal as `wide`. That is wrong, and the test
caught it: the angle shrinks with *distance* as well as with lateral offset, so a perfectly central
shot from 21 m subtends 19.6° and was being filed next to a shot from the corner flag. Dividing by
the best angle available at that distance — `2·atan(halfWidth / distance)` — separates *far* from
*narrow*, which are two different problems for the shooting model to solve. `goalOpenness` is `1`
dead centre at any distance and falls towards `0` at the by-line; `wide` is below `0.5`. T-6.6 and
T-6.9 both want the ratio rather than the raw angle.

**Zones carry the defending side as their suffix**, exactly as `court.ts` does — `penaltyArea0` is
the box side 0 defends. The alternative reads better in isolation and is a bug factory the moment
`goals[side]` (also the defended one) is nearby.

**Thirds are in `zones` even though nothing reads them yet.** T-6.10's shape-by-phase and T-6.14's
Playbook both talk about territory in thirds rather than halves, and a third is a rectangle, so it
belongs with the other rectangles rather than in whichever module needs it first.

**Restart spots are geometry, not rules.** `throwInSpot`, `cornerSpot`, `goalKickSpot`,
`penaltySpot`, and `kickOffSpot` all answer *where*, and none of them decides *which* restart
applies — that is T-6.2's job, and it needs `crossedBoundary` plus who touched the ball last, which
geometry cannot know. Corner and goal-kick spots are pulled fractionally infield so the taker is
never standing on a flag or a line.

**Feel note:** nothing to play yet — this is a table of numbers. The one thing that already feels
right is `goalOpenness`: dropping the by-line case into it and watching it read 0.05 is the first
sign the pitch understands soccer rather than a court with different dimensions.

### T-6.2

*Soccer Live rules: halves, clock, stoppage, throw-ins, corners, goal kicks*

**The seam held, once, with a caveat.** `MatchRules.clockRunsInStoppage` was already there, written
in Phase 1 with the comment "Basketball: no. Soccer: yes." It cost nothing to use and it is the
whole of what makes a soccer clock a soccer clock: the ball goes out, the clock keeps running, and
the player never gets the time back. That is the seam working exactly as designed.

**The one engine change, and why it is a core improvement.** Added time cannot be expressed from
outside `MatchStateMachine`. A period's length was `rules.periodSteps`, a constant, and the machine
ends the period the instant `periodStep` reaches it — so "this half runs three minutes longer than
the whistle said" had nowhere to live. T-6.2 adds `extendPeriod(steps)` plus an `extension` getter,
cleared at `nextPeriod()` and carried in the snapshot as an optional field.

It is worth being precise about why this is not soccer leaking into the engine, because the Gate 6
criterion is exactly that question:

- Nothing in the method knows what a stoppage is, what a referee is, or that soccer exists. It
  takes a step count. The *policy* — which stoppages buy time, how much, rounded how — is entirely
  in `src/sports/soccer/rules.ts`.
- The capability is general. Hockey's Phase 11 rules have no added time but American football's
  "the period cannot end on a defensive penalty" is the same shape, and so is any mercy-rule or
  practice-mode variant that wants a shorter or longer period than the rules table said.
- The alternative was worse in a way that would have shown up in the build. Keeping the half a
  fixed length makes added time a constant, which is not added time; sizing `periodSteps` to
  45 + max-added and ending early needs the *sport* to end a period, which is a far bigger hole in
  the seam than lengthening one.

`MatchSnapshot.periodExtension` is optional on purpose: a replay or a P2P peer from an older build
restores as an unextended period rather than failing to restore at all. There is a test for that
path.

**Added time matches the board exactly, and that took some care.** The model: qualifying stoppages
(goal, card, penalty, injury, substitution — *not* a throw-in) accrue an allowance in game seconds;
the board is that accrual rounded **up** to whole minutes, capped at six, and monotone within a
half. The half is then extended by exactly the board figure, paid in instalments —
`pendingExtensionSteps(state, alreadyExtended)` returns only what is still owed, so calling it every
step totals the board figure and no more. The naive version (extend by the raw accrual, display the
rounded figure) ends the half *before* the board minimum, which is the one thing about added time
every viewer would notice.

Note that "clock runs through stoppages, and qualifying stoppages are added back" is deliberately
*not* the same as `clockRunsInStoppage: false`. A throw-in costs you the time; an injury does not.
That difference is what makes a scrappy half run to 48:00 and a clean one to 45:30.

**Restarts: geometry answers where, rules answer which.** `restartFor(x, y, lastTouch)` is the
three-way split on the goal line that everybody knows and nobody writes down — out off the
*defender* is a corner, out off the *attacker* is a goal kick, over a touchline is always a throw-in
to whoever did not touch it. It leans on `crossedBoundary`'s deepest-overshoot rule from T-6.1,
which is what decides a ball that clears the corner flag.

**A restart that is sat on is given away.** Thirty game seconds after the taker is *ready*. This is
not a Law — the Laws say caution for time-wasting — but a restart that can be held indefinitely is
an exploit in a game with a running clock, and turning the ball over is the version of the
punishment that does not need the card system (T-6.4) to exist yet. The count starts on
`readyRestart`, never on the award, because the taker may have to run forty metres to fetch the
ball, and a goal celebration blocks readying entirely.

**Ends do not swap at half time.** Real teams change ends. Doing so would move every goal, every
formation anchor, and the camera twice a match, and `court.ts` already set the project's convention
by not doing it for basketball. Side 0 attacks high x for the whole match. Recorded here so a
future session doesn't file it as a bug.

**Fouls, cards, and advantage are not here.** They are T-6.4. What T-6.2 did do is include
`freeKick` and `penalty` in `RestartKind`, so T-6.4 adds a *cause* rather than a mechanism.

**Feel note:** still nothing to play. The one thing that reads as genuinely soccer-shaped is
watching a test half tick past 45:00 and keep going because someone scored — the clock behaving
differently from basketball's is the first place the two sports stop being the same game with
different numbers.

### T-6.3

*Offside detection and enforcement*

**The whole law turns on one instant, so the module is a two-part transaction.**
`captureOffside()` freezes the picture as the ball is played; `judgeOffside()` reads that frozen
picture when someone next touches it. Nothing recomputes a position in between. The alternative —
one function that measures everything at arrival time — is subtly, permanently wrong, because a
striker level at the pass and ten metres clear when it lands is *onside*, and that single fact is
what every argument about offside is actually about. Making it a snapshot means the rule is right
by construction rather than by the caller remembering to call things in the right order.

That instant is a contract with T-6.5: the passing suite calls `captureOffside` at release and
carries the snapshot with the ball. Written down here because it is the kind of coupling that gets
quietly broken by a later refactor.

**`attackDepth` is the reason nothing else in the file branches on side.** Every comparison in
Law 11 is "nearer to the opponents' goal line than", so one projection — distance towards the goal
you are attacking — turns the whole law into `>` on a number. Without it every predicate carries
its own `side === 0 ? x : length - x`, and the second-last-defender sort has to be written twice.

**Sorting rather than special-casing the keeper.** "Second-last opponent" is worded that way
precisely because the keeper is *usually* but not *always* the last man. Sorting the defenders by
depth and taking index 1 gets a keeper caught upfield right for free; a `defenders.filter(isKeeper)`
implementation would have needed a rule it doesn't have. There is a test for the rushed keeper.

**Level is a band, not a plane.** `LEVEL_TOLERANCE = 0.15 m`. The Law says level is onside and
measures to the millimetre; a simulation that decides a match on a centimetre of float error is a
bug however technically correct it is. Fifteen centimetres is roughly a shoulder, which is the unit
real offside arguments are conducted in anyway.

**What is deliberately not modelled.** The Law lists three ways to be "involved in active play":
interfering with play, interfering with an opponent, and gaining an advantage. Only the first is
here — a flagged player becomes the first attacker to touch the ball. The other two need a judgement
about intent and sight-lines that a simulation cannot make honestly, and faking them would produce
calls a player could not predict, which is worse than not making them. The visible consequence: a
player standing offside who lets the ball run to an onside teammate is not penalised here and
sometimes would be in a real match. Flagged rather than hidden.

**The three exempt restarts live in the snapshot.** Throw-in, goal kick, corner. Putting the
exemption in `captureOffside` rather than at judgement time means there is one place to be wrong
about it, and it survives the fact that by the time the ball arrives the restart is long over.

**Enforcement returns rather than mutates.** `offsideOffence()` hands back a `Restart` and the
events; it never touches `RulesState`. Offside is a judgement, and keeping it one means the module
tests with no rules state at all, and T-6.4's fouls can reuse the same shape when they land.

**Feel note:** not playable yet, but the level-at-the-pass test is the first test in the phase that
would make a soccer fan nod. If that case is right, the rest of the law is bookkeeping.

### T-6.4

*Fouls, advantage, cards, free kicks, penalties*

**Three questions, kept apart.** Where the restart is (`restartForFoul`), what card is shown
(`cardFor`), and whether play stops at all (advantage). Only `commitFoul` knows all three. Tangling
them is how a rules module acquires the one function nobody dares change, and the three have
genuinely different inputs — geometry, discipline, and the state of the attack.

**It is the offender's *own* box that makes a penalty.** Not "the box the ball is in". An attacker
fouling a defender inside the opposition penalty area concedes an ordinary free kick. Obvious once
stated, easy to get wrong with an `isInPenaltyArea(x, y)` that forgot to take a side, and there is a
test for it in both directions.

**Double jeopardy is handled deliberately rather than by accident.** A foul denying an obvious
goal-scoring opportunity is a red — *unless* it was a genuine attempt to play the ball inside the
offender's own penalty area, where since 2016 it is a caution because the penalty is punishment
enough. Handball and holding are not attempts to play the ball, so those stay red. This is the
single most-argued line in the Laws; the code should land on a side of it on purpose.

**Advantage carries a fully-built `Restart`, and that is the whole design.** The free kick, if the
advantage is pulled back, is taken from *where the foul happened*. By the time the referee decides
the attack came to nothing, three seconds of play have passed and everybody has moved — so
rebuilding the restart from the state at pull-back time would award a completely different free
kick. Building it at the moment of the foul and carrying it is the fix, and it is why
`AdvantageState` lives in `rules.ts` (as plain data, holding a `Restart`) rather than in `fouls.ts`:
that way `RulesState` needs no import from `fouls.ts` and there is no cycle.

**The advantage window is in real seconds, not game seconds.** Three real seconds. At 11.25×
compression the equivalent game-second figure would be over before a player could see it happen —
this is a window on *play*, not on the clock, and it is the first place in the phase where the
compression forced a unit choice. Basketball hit the same wall from the other side and dropped the
eight-second backcourt count for it.

**A caution is applied at the foul, not at the next stoppage.** The Laws defer the card when
advantage is played. Modelling that faithfully leaves an athlete on two yellows still playing for
several seconds, which reads as a bug and changes no outcome.

**No advantage on a penalty.** There is no advantage better than a penalty, so `commitFoul` refuses
to play one on even when the caller asks.

**Nothing here rolls dice.** `FoulSeverity` is the Laws' own three degrees — careless, reckless,
excessive — which gives T-6.8's tackle model an honest place to put its output: it decides how badly
the challenge went with a seeded RNG, and this decides what that costs (INV-2).

**Fouls mutate `RulesState`; offside does not.** A deliberate inconsistency. Discipline is a running
record that has to live somewhere, and basketball's `recordFoul` set the precedent that it lives
with the rule producing it. Offside has no record to keep, so it stayed pure.

**Feel note:** the advantage window is the first thing in the phase that will need playing rather
than testing. Three seconds is a guess; whether letting a promising move run *feels* like a
reward or like the referee missing a foul is not something the suite can tell me.

### T-6.5

*Passing suite: short, through-ball, lofted, cross, with weight and rating-driven error*

**Weight is the soccer-shaped half, and basketball genuinely does not have it.** A basketball pass
goes wrong by being aimed wrong; `passing.ts` there has one error term and it is angular. A soccer
pass mostly goes wrong by being hit too hard or not hard enough — an underweighted through ball is
cut out, an overweighted one runs through to the keeper — and neither of those is a direction
error. So `passError` returns two independent numbers, and `weightError` is where the four pass
types actually differ. A through ball's is three times a short pass's; that single figure is the
whole reason one is the safe option and the other wins matches. Not a separate code path, not a
success rate bolted on top.

**Grounded and aerial are two code paths, and trying to unify them was the first thing that
failed.** `launchVelocity` given a short pass's distance and speed produces an eighty-centimetre
apex — a floated ten-metre pass, which nobody has ever played. A ground pass has no vertical
component at all: it is released flat with `vz = 0` and rolls. Lofted balls and crosses do use
`launchVelocity`, because an arc over a defensive line is precisely what it computes.

**The engine's rolling friction turned out to be linear in distance, which made weighting trivial.**
The integrator decays a rolling ball at `rollingFriction` per second: `dv/dt = −k·v`. Divide by
`dx/dt = v` and you get `dv/dx = −k` — speed falls **linearly with distance**, k m/s per metre. So
"how hard must I hit this to arrive at 7 m/s twenty metres away" is `7 + k·20`, a sum rather than a
solve, and the arrival speed of a mis-weighted pass is the same arithmetic backwards. An underhit
pass arrives slower; hit badly enough it stops short, and the model produces that with no special
case. `ROLL_DECAY_PER_METRE` in `ball.ts` records the derivation so nobody has to redo it.

The flight *time*, on the other hand, is a logarithm rather than a division, because the ball is
slowing the whole way. `distance / releaseSpeed` is optimistic by better than a tenth on any pass
long enough for weight to matter — which is exactly the passes where the lead has to be right, so
the cheap version would have been wrong precisely where it counted.

**Weight means something different in the air.** An overhit cross is not a faster cross, it is one
that sails long — so on an aerial ball the weight error divides the flight time rather than
multiplying the speed, which comes out as a flatter, faster ball arriving past its target.

**`arrivalHeight` is where "that was a bad cross" lives.** A cross arrives at 1.9 m and a lofted
pass at 0.6 m. Putting head height in the pass profile rather than in the header model (T-6.9's
neighbour) means a cross whipped in too flat is bad because of *where it arrives*, which is the
reason it is actually bad.

**The offside contract is enforced by construction.** `throwPass` calls `captureOffside` itself, at
release, and hands the snapshot back on the `PassInFlight`. There is deliberately no way to build a
`PassInFlight` with a snapshot taken at any other moment — the T-6.3 note warned this was the kind
of coupling a later refactor breaks quietly, and this is the version that cannot be broken by
calling things in the wrong order. `PassContext` is optional as a whole, because a practice mode or
an arcade game has no defensive line and offside cannot apply to it.

**No composure rating.** Basketball's passer has one; soccer's derived set (`05` §3.2) does not —
composure is an attribute, already spent inside `finishing`. Rather than invent a thirteenth rating
to make this file symmetrical with basketball's, pressure is resisted by the same rating that
strikes the pass. Noted because it is the sort of asymmetry that looks like an oversight.

**Feel note:** untested by hand, but the numbers say the through ball should already be the most
interesting button in the game — it is the only one where getting it *slightly* wrong is worse than
getting it very wrong, because a slightly underhit through ball arrives at a defender's feet at
walking pace. Whether that reads as skill or as noise is the thing to watch when it is playable.
