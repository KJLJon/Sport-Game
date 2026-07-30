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

### T-6.6

*Shooting: power meter, placement, curve, deflections*

**Placement error, not angular error.** A pass misses by an angle; a shot misses *the goal*, and the
goal is a rectangle. So error is applied in the plane of the mouth — metres across, metres up —
which makes "he dragged it wide" and "he skied it" separate outcomes with separate causes instead
of one number pointing somewhere random. It also composes with `goalOpenness` for free: a tight
angle shrinks the target the same error is sprayed across, with no extra term saying so. Vertical
error is 0.6× horizontal, because dragging a shot wide is commoner than ballooning it.

**Power is a trade, and that is the only reason the meter exists.** More power buys speed and costs
accuracy, both. If power were free there would be no meter, only a shoot button — so the test that
matters is the pair: `shotSpeed` rises with power *and* `placementError` rises with power. A full
blast from thirty metres should be a bad idea most of the time and a wonderful one occasionally.

`shotPower` raises the *ceiling*, not the floor: a weak striker's tap and a strong one's tap are the
same shot, and the rating shows up only when both wind up. That is both truer and better for the
game than scaling the whole range.

**Curve is earned by the run, not asked for with a button.** `06` §3.2: "curve comes from approach
angle and `coordination`". Zero running straight at goal, most cutting across the ball, sign
following the approach so a right-sided run curls back towards the near post. The player never
requests bend; they get it by making the run, which is the whole appeal.

**And `coordination` is an attribute, not a derived rating.** Soccer's `05` §3.2 table has no
coordination row — it is an attribute, already spent inside `finishing`. `06` §3.2 nonetheless names
it directly for curve, so `ShooterRatings` carries it and this is the one place in the sport module
that reads an attribute rather than a rating derived from one. Substituting "the nearest rating"
would have been the easy answer and would have quietly made the spec line untrue.

**Nothing here decides whether it goes in.** The ball gets a real velocity towards a real point and
the keeper, the defenders, and `isGoal` settle it between them — same reason passes are flown rather
than resolved, and the reason a save is something a *player* can make rather than a number the sim
rolled. Flight time comes from the distance to the *aim point* rather than to the goal centre, so a
shot into the far corner is in the air longer than one down the middle. That is what gives a keeper
a chance, and it falls out of the geometry instead of being a keeper-model fudge.

**A shot deflects once.** `ShotInFlight.deflected` latches. A ball ricocheting off three legs in a
row is a physics bug, not drama. The deflection turns the ball in the horizontal plane only and
kills the spin — a boot that lifts a shot over the bar is a different event and belongs to T-6.9.

**Two bugs the tests caught, both mine and both in the tests.** `curveFrom(angle, 0)` returns `-0`,
which `toBe(0)` rejects; and my "tight angle" fixture was 16 m out against a "good chance" at 10 m,
so the assertion that the bad chance is the *closer* one failed on a position that was simply
further away. The second is worth recording because it is the exact confusion `goalOpenness` exists
to prevent, and I still made it while writing the test for it.

**Feel note:** unplayed. The number I most expect to move after a phone test is `chargeRealSeconds`
(0.8 s) — a power meter that fills faster than a thumb can react is a random number generator, and
0.8 s is a guess made without a thumb.

### T-6.7

*Dribbling, sprint, shielding, stamina drain*

**No second movement model.** This file produces the `MovementProfile` that
`engine/physics/movement.ts` already consumes: a carrier is an athlete with a worse profile than
they would have without the ball. Writing soccer's own integrator would have been the fastest route
to making the engine's basketball's in disguise, which is precisely what Gate 6 is checking for.

**Sprinting is three costs for one benefit.** Speed, in exchange for stamina, close control, and
turning. A sprint button that only made you faster is a button nobody ever releases, which is not a
mechanic — so the test file pins all three costs rather than just the speed gain.

**`touchDistance` is the heart of dribbling and it needs no dice.** A poor dribbler at a full sprint
pushes the ball over a metre ahead; an elite one keeps it inside 0.9 m flat out. That single number
is what makes a bad dribbler dispossessable — the defender simply arrives at the ball first —
without a "retain possession" roll anywhere. Skill shortens the leash, speed lengthens it.

**Stamina is in real seconds, like the advantage window and for the same reason.** It is a budget on
the player's aggression across a match; at 11.25× compression a game-second figure would empty a
full tank in twenty real seconds. 90 s of unbroken sprinting to empty, 150 s of walking to refill.

**One entry point, not two.** `tickStamina(state, athlete, effort)` covers draining *and* recovering,
with the jogging threshold deciding which. A model with separate `drain` and `recover` calls is a
model that eventually gets called with the wrong one on some code path nobody tested.

**Stamina never touches a rating.** A tired athlete's `dribbling` is unchanged; what changes is the
profile derived from it. This is INV-6's discipline applied to fatigue rather than difficulty, and
it keeps the athlete card honest — a rating is what someone *can* do, not what they can do at the
eighty-ninth minute. There is a test asserting the ratings object is not mutated.

**Shielding is geometry first, ratings second.** `shieldPosition` is a pure `-1…1` term: `1` is the
defender directly behind you, `-1` is them goalside with a clear run at the ball. It is weighted
above agility in the contest, so where you put your body matters more than how good you are — which
is what makes shielding something a player *does* rather than a stat they have. The contest itself
is the engine's `contest()`, fed derived ratings; nothing here awards a foul, because leaning on
someone is legal and whether *this* one was a foul is T-6.8's question.

**Feel note:** the numbers say a clumsy sprinter should be robbable on sight, which is the right
shape. The risk is the opposite one — that `sprintTurnPenalty` at 1.9 makes sprinting feel like
driving a bus, and a player just never uses it. That is a thumb question, not a test question.

### T-6.8

*Defending: pressure, standing and slide tackles, foul/card risk*

**This module decides how badly a challenge went; it never decides a card.** `FoulSeverity` was put
in `fouls.ts` in T-6.4 for exactly this handover: T-6.8 draws the outcome and hands back
`{ kind, severity }`, and `commitFoul` turns that into a caution, a dismissal, or nothing. Two
modules that both know the card table is one too many — and it is the kind of duplication that
survives happily until the day they disagree. There is a test that runs `severityOf` straight into
`cardFor` to pin the seam.

**Timing beats ratings, and that is the point of the whole file.** Ratings decide how *wide* the
window is; where you swung inside it decides what happens. Below `hopelessTiming` no rating saves
the challenge at all. The test that matters is the comparison — a well-timed tackle from a
20-rated defender beating a wild one from a 95-rated defender — because the alternative model
rewards having rather than playing.

**The slide is the interesting button because it is the only dangerous one.** Twice the reach, a
better chance when it lands, a much worse chance of a foul when it doesn't, and the only challenge
that can reach `excessive` — a straight red. It also commits: the defender is on the ground and out
of the play whether or not it worked, which is the cost that makes the reward legible.

A standing challenge can never be `excessive`. A standing tackle that hurts somebody is a different
offence from a mistimed one — violent conduct, not a bad tackle — and this model has no honest way
to tell them apart, so it does not try.

**One draw per tackle.** `resolveTackle` spends exactly one RNG value and partitions it: below the
odds is a clean win, and the remainder is split between a clean miss and a foul. Drawing twice would
work and would double the seed consumption of the most frequent event in the sport, which matters
for replay size and for determinism auditing (INV-8).

**Winning the ball is never a foul.** By definition here: getting there first is what a fair
challenge *is*, and "won it but caught him afterwards" is a judgement call with no honest model
behind it. Flagged as a simplification — real referees give that foul.

**Closing speed makes fouls worse, never more likely.** A fast, well-timed tackle is the best tackle
in the sport, and a model where speed itself is risky would teach players to jog into challenges.

**`pressureOn` lives here because it is consumed everywhere.** `passing.ts` and `shooting.ts` both
take a `pressure` term and neither knows how to compute one. Saturating rather than summing, so a
fourth defender arriving cannot push it past 1 and flatten the term.

**Feel note:** unplayed, and the slide is the thing to watch. On paper it is a good risk/reward
trade; in the hand, a challenge that commits you to the floor for a second may simply feel bad
enough that nobody presses it, in which case the reach or the win bonus goes up rather than the
foul rate going down.

### T-6.9

*Goalkeeper AI: positioning, shot-stopping, claims, distribution; manual on penalties*

**A save is a race, not a dice roll.** The keeper has a position and a reach; the shot has an aim
point and a flight time. Cover the distance in the time available and it is saved. `goalkeeping`
decides how fast they cover ground, not how often a hidden number comes up — so the far corner beats
a good keeper because it is *further away*, which is also what it will look like on screen.

This is what T-6.6's flight-time decision was for. Taking flight time from the distance to the aim
point rather than the goal centre means a far-corner shot hangs longer, partly offsetting the longer
dive. The two effects fighting is what makes the near post correct from a tight angle without anyone
writing a rule that says so.

**The tuning was wrong on the first pass and the test caught it.** At `diveSpeed` 4.6 + 3.4 an
*average* keeper saved 58% of top-corner shots from twelve metres — a wall with a radius rather than
a goalkeeper. Around 4 m/s of lateral dive is what footage supports; at 3.0 + 2.2 the same shot sits
near 16%. Worth recording as a number that came from a failing assertion rather than from taste,
because it will be re-tuned in T-6.18's balance pass and the starting reasoning should be visible.

**`interceptPoint` is what makes coming off the line worth anything — and it exposed a claim I had
written but not implemented.** The first draft measured the dive to the aim point in the plane of
the goal, which is the right answer only for a keeper standing *on* the line: it made advancing
worth precisely nothing, and the test asserting otherwise failed. The fix is to measure where the
ball passes the keeper's own depth.

**Known limitation, stated rather than papered over: the chip is not modelled.** Height along the
intercept is the *chord*, not the parabola. A real lofted shot peaks above the bar and drops, so an
advanced keeper meets it higher and it goes over them; a straight line from boot to goal is never
above the bar, so here they meet it lower. My header comment originally claimed the chip fell out of
the same geometry — it does not, and the test I wrote to prove it failed. The test that replaced it
asserts what the model *actually does* and says why. Fixing it properly means threading the launch
velocity through and evaluating the true parabola; the right time is when something needs the chip,
which is probably T-6.15's arcade set.

**`saveOutcome` is three-valued on purpose.** Caught, parried, beaten. A keeper who only catches or
concedes has no rebounds in them, and a rebound is most of what makes a penalty box interesting. A
ball is held only when it is slow enough *and* the keeper had it comfortably.

**Softness, not a cliff.** The save chance is a logistic on `reach − distance`, so a shot just
inside range is usually but not always saved and one just outside is occasionally clawed out. That
is the difference between a goalkeeper and a collision circle.

**Distribution returns a `PassKind`.** It goes through `passing.ts` like every other pass rather
than growing its own throw model, which means playing out from the back can go wrong in exactly the
ways passing can.

**Manual on penalties is a flag, not a fifth model.** `06` §3.2 offers it there and nowhere else;
the same `saveOutcome` runs either way and `isKeeperManual` only says who supplies the dive.

**`aggression` belongs to the formation, not to difficulty.** A sweeper-keeper is a tactical choice
(T-6.10); scaling it by difficulty would be the rating-tampering INV-1 forbids, one level removed.

**Feel note:** unplayed. The number to watch is `softness` (0.45) — too low and every save is
predetermined by geometry, too high and a keeper flaps at shots they should hold, and there is no
way to tell which from a test.

### T-6.10

*Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase — **plus the `SportModule`
assembly***

**The assembly was folded in here, and it was raised with the user first.** Phase 6's eighteen rows
have no "register the sport" task: they cover geometry, rules, five skill models, formations,
performance, camera, weights, Playbook, arcade, art, refactor, and balance, and none of them wires
the module into the seam. T-6.11's 22-entity performance work needs 22 entities actually moving, so
it had to exist by then. It went here because T-6.10 already owns `RoleTable` and where everybody
stands.

**Formations are data.** A `FormationRole` carries a base position plus `push`, `drop`, and `tuck`,
and no code branches on a formation name — adding 4-2-3-1 is adding a row. Shape by phase falls out
of two numbers per role rather than four authored shapes: 4-4-2 defends as two banks and attacks as
something wider without anyone drawing both. The wing-backs in 3-5-2 carry the biggest `push` *and*
`drop` in the file, which is the formation's whole idea expressed as numbers.

**`phaseFor` reuses T-6.1's halfway-line rule rather than restating it.** The first version wrote
`ballX < CENTRE_X` inline and disagreed with `isInAttackingHalf` about a ball exactly on the line —
a one-test bug, and exactly the sort of duplicated rule that ends up making offside and shape
disagree about which half the ball is in. It now calls `isInAttackingHalf`.

**`building` is deliberately the widest band.** A team with the ball in its own half is neither
attacking nor defending. Treating that as attacking is what makes AI teams suicidally open.

### The `SportModule` assembly

**The seam held.** `src/sports/soccer/index.ts` fills in `SportModule`'s own members and nothing
else. One engine change in the entire phase (`extendPeriod`, T-6.2), and nothing in `engine/` knows
this file exists. Soccer is also the first sport to exercise `SportStatus.actionClock === null` and
`SportHudSpec.showShotClock === false` — those members were written in Phase 1 on the assumption a
sport might not have an action clock, and soccer is the proof they were right.

**One bug worth recording: stamina was being drained twice a step.** `integrateAll` asks for a
profile and a desired velocity through separate callbacks, and the first version ticked stamina
inside `profileOf`. Building every profile once, up front, into a `Map` fixed it and also gave
`desiredOf` the profile it needs — the engine's signature does not hand it over.

**`playable.ts` is new, and it exists because `routes.ts` had a hardcoded sport.** The Live route
imported `basketball` directly, which was harmless with one playable sport and a second registry the
moment there were two. Loaders are lazy: a sport module pulls in its rules, five skill models,
renderer, and roster tables, and eagerly importing every sport would put all of them in the initial
bundle. `catalogue.ts` answers the neighbouring question (which sports an athlete can be *rated* in)
and rateable stays a superset of playable — that is what stops a rating table dragging a renderer
into the launch path.

The `as unknown as SportModule<never>` in that list is load-bearing, not laziness: `SportModule<S>`
is invariant in `S` because it both accepts and returns state, so a heterogenous list of modules has
no supertype to inhabit. Every consumer treats the state as opaque and hands it back to the same
module, which is exactly what `SportState` documents, and the erasure is confined to the one list.

**Two things the screenshot showed that the tests could not.** Both are real and both are already
someone's task:

1. **Athletes are ~3 px on a 105 × 68 pitch.** The camera fits the whole field, which works for a
   28 × 15 court and does not work here. That is T-6.12 (camera and minimap tuning for the larger
   pitch) — the screenshot is the evidence that task is real work rather than polish.
2. **The HUD is basketball-shaped.** It shows `0 PF` (personal fouls) and a *counting-down* clock.
   Soccer has team fouls and counts up; `elapsedGameSeconds` exists for exactly this and nothing
   calls it yet. `SportStatus.periodClock` is documented as *remaining*, so the module is honouring
   the contract and the gap is on the HUD side. Not in any Phase 6 row — logged in `PROGRESS.md` as
   a known gap for T-6.16 or Phase 9.

**Feel note:** it moves, and the shape holds and shifts — 22 dots keeping a recognisable 4-4-2 and
sliding forward as a unit is the first moment in the phase that looked like soccer. It is also
obviously not *playable* yet at that zoom, which is the honest read.
