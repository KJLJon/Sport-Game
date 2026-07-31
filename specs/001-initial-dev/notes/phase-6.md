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

### T-6.11

*22-entity performance work: LOD, culling, spatial-hash tuning, zero-allocation hot path*

**The bench was measuring the wrong sport, and fixing that was the first half of the task.**
T-1.13's harness ran the *test* sport at eleven a side because that was the only thing that could.
Now a real one exists, and `pnpm bench` reports both: the test sport as a floor, and soccer as the
workload the `12` §6 budget is actually about. The test sport moves 22 entities; soccer moves 22
entities and then decides what they should do.

**Speed was never the problem; jank was.** Soccer's mean sim step measured 0.041 ms against a 4 ms
budget — 100× headroom. But the *worst* step was 0.98 ms, 24× the mean, which is not a slow
algorithm, it is the collector. Per step the module was allocating two shape arrays of eleven fresh
objects, a profile map with 22 more, and an eleven-object array on every carrier decision and twice
on every pass. Roughly sixty objects a step, 3 600 a second, all of it garbage.

Two fixes, both boring, both measurable:

- **`cachedShape`** — a shape is a pure function of `(formation, phase, side)` and there are eighteen
  combinations in the entire game. Computed once, frozen, cached forever. Frozen matters: the cache
  hands the same array to every caller, so a single mutation would corrupt every later step and look
  like a physics bug.
- **Scratch buffers** for `pressureFor` and `positionsOf`. Both are consumed synchronously and never
  retained, which is what makes reuse safe — `pressureOn` returns a number, and `captureOffside`
  copies what it keeps into its own snapshot.

Worst step **0.98 ms → 0.35 ms**, a 65% cut; mean 0.041 → 0.036; p95 0.073 → 0.057.

**What this task did *not* do, deliberately.** `03` lists LOD, culling, and spatial-hash tuning.
None of those is needed: the sim is 100× inside budget, and the hash is already sized for the pitch
via `cellSize: 6`. Culling and LOD are *render* concerns — they matter when the camera moves and
draws a subset of the world — and that is now T-12.8 in the bonus camera phase, where it belongs.
Doing it here would have been optimising a measurement that reads 0.036 ms.

**Feel note:** nothing to feel, which is the correct outcome for a performance task. The number that
matters is the worst frame, because that is the one a player perceives.

### T-6.12

*Camera and minimap tuning for the larger pitch*

**The camera now follows the play instead of fitting the field**, which the user asked for directly
after seeing a match on a phone. One rule: keep `VISIBLE_SPAN` (45 m) of the field's long axis on
screen, or the whole field if it is smaller than that. 45 m is a little over a pitch's width — it
frames a phase of play rather than a match — and it is wider than a basketball court is long, so
**basketball's framing is unchanged by this**. That is what makes the rule safe to apply to every
sport without naming one.

**One engine change, and it was a real bug.** `Camera.resize()` did
`this.minScale = Math.min(this.minScale, this.fitScale())`, which silently clamped an explicitly
requested zoom floor back down to fit-the-field. Since a rotation or a browser-chrome change counts
as a resize, on a phone it would have undone the zoom almost immediately — the kind of bug that
looks like the feature was never implemented. The camera now remembers what the caller *asked for*
and only recomputes the floor for a camera that asked for the default. There is a test for the
resize path specifically.

Setting `minScale` above the fit scale is now the documented way to say "do not show the whole
field". `clampCentre` already handled a viewport smaller than the world, so nothing else needed to
change — the off-screen indicators and the minimap were both already built and simply had nothing to
do until now.

**Where the line is with Phase 12.** T-6.12 does the minimum that makes a 105 × 68 pitch legible.
Dynamic zoom by phase of play, off-screen awareness beyond what exists, the minimap rework, camera
handoff, and per-sport profiles are all Phase 12, added at the user's request as a bonus phase. A
sport id in `screen.ts` would be the first thing T-12.6 had to remove, so there isn't one.

**Feel note:** this is the first change in the phase that made it look like a game. Athletes are
readable, the off-screen triangles are doing real work, and the minimap earns its space now that it
shows something the main view does not. Still unplayed on an actual phone.

### T-6.13

*Soccer derivation weights, sub-skills, familiarity tuning*

**The weights themselves already existed** — `SOCCER_WEIGHTS` and `SOCCER_PHYSICAL` shipped in
Phase 3 (T-3.3) precisely so the compare view had two rating tables to compare. What was missing was
the other two thirds of `05` §3: the *position* table (§3.4) and the *XP* table (§3.3).

**The keeper row is the whole point of the position table.** `goalkeeping: 0.6` for `gk`, and
literally zero for every other role — there is a test asserting that. It means an outfielder's
overall *as a goalkeeper* is correctly dreadful, so playing someone out of position reads as a
decision rather than a rounding error. It is also the clearest thing in the project so far that the
cross-sport system works at the level of positions and not just sports.

**Roles that share a job share a row.** Both centre backs, both strikers, all three central
midfielders. A position table is about the job, not the shirt number, and an unlisted role falls back
to a generic outfield row — so adding 4-2-3-1 to `formations.ts` does not require touching this file.

**Defending had to be paid differently from basketball, and it is the honest weak spot.** A
basketball steal is a discrete event. Soccer's defending is mostly *not* events — it is standing in
the right place for ninety minutes — and an XP table can only pay for things that emit. A won tackle
pays `tackling` properly; `marking` is paid from the events that *imply* good positioning happened,
which is a turnover and catching someone offside. That is an approximation, not a good model, and it
is written down here as the first place to look if defenders turn out to learn too slowly.

**Two silent failure modes, both tested.** A weight row that does not sum to 1.0 puts the derived
rating off the 1–99 scale with nothing failing, and a rating *name* that does not exist trains a
sub-skill derivation never reads. Both are typos that produce a plausible-looking game, so the tests
walk every row of both tables and check the names against `SOCCER_WEIGHTS`.

**Familiarity needed no soccer-specific tuning at all**, which is worth recording as a positive
result: `couplingFor()` and `fatigueMultiplier()` are sport-agnostic, `roster.ts` calls them exactly
as basketball's does, and the two attributes soccer reads raw (`coordination`, `strength`) are
deliberately ungated for the same reason basketball's five are. The seam held here too.

**Feel note:** nothing to play, but the position table is the first thing that will make an athlete
card *about soccer* rather than about ratings — a 34-rated overall for a striker at centre back is
the sort of number that starts an argument, which is what a position table is for.

### T-6.14

**The first `PlaybookAdapter` that is not basketball's, which is the whole point of the row.** T-5.1
built the seam against one sport and a spec paragraph. This is the test of it, and the honest answer
is that **the turn engine needed no change at all**. Soccer's turns are phases rather than
possessions, its clock counts one half at a time, a goal is worth one point rather than two or three,
and its calls persist between turns — and every one of those was already expressible. The two members
that carried it are `turnKind` (already `'possession' | 'phase'`) and `CallOption.persists`, which
T-5.1 added on the strength of `09` §2.3 alone, before there was a soccer to need it. Zero engine
changes; this task adds nothing to the Gate 6 list.

**One phase enum, two points of view.** `09` §2.3 lists "build-up, progression, final third, chance,
set piece, and the defensive equivalents". The defensive equivalents are deliberately *not* a second
enum. A phase is a fact about where the ball is and what is being attempted, and both sides are in it
at once — one playing out, one pressing. `PlaybookState.possession` already says which is which, so a
second enum would be the same five states written twice and one more thing to keep in step;
`phaseName(phase, attacking)` supplies each side's wording instead.

**The turn budget was derived, not picked, and the derivation is in the module doc.** `09` §2.3 wants
18–24 turns and regulation is 5400 game seconds, so a turn has to average 225–300 of them. Solving
the transition graph's visit frequencies gives `f = b` exactly and `p = b·α/β`, and
`PHASE_TURN_SECONDS` was then solved *backwards* from a target of 22 turns — which is why the figures
are 340/300/220/90/100 and not round numbers. Measured over 40 CPU-vs-CPU matches: **20.6 turns** in
normal time. The arithmetic cannot rot unnoticed because `adapter.test.ts` fails when the mean leaves
the band.

**The transition graph is the part worth keeping when T-6.20 replaces the odds.** `LOST_TO` is where
the model stops being a queue of identical build-ups: lose it playing out from the back and the
opponent starts in *your* final third, lose it in their box and they restart from theirs. That single
table is what makes a high press a bet rather than a stat tweak, and it is the hook T-6.19's press
line will pull on.

**A real defect found, capped inside the sport module, and not fixed at its root.**
`MatchStateMachine` offers another overtime period for as long as the score is level and
`MatchRules.overtimeSteps` is set. That is right for basketball — a tied basketball game plays OT
after OT — and wrong for soccer, which plays exactly two extra halves and then takes penalties.
Nothing capped it, so a level soccer match ran until the turn engine's `MAX_TURNS` guard caught it:
**the worst seed in the first batch reached period 15.** The adapter's `isFinished` now caps it at two
extra halves. **Live has the same bug**, and it is not fixed here: T-6.14 owns a Playbook adapter, not
soccer's Live clock. The proper fix is an engine-side `maxOvertimePeriods` on `MatchRules`, which
would serve every sport instead of one mode of one — logged for **T-6.17**, whose whole job is
engine-core work of exactly this shape. A match still level after extra time is a draw for now; the
shootout that should decide it is T-6.15's arcade game, wired in by T-6.22.

**What is deliberately baseline, and who takes it.** `resolve()` walks the graph off a table of base
probabilities (`PHASE_ODDS`) rather than off Live's own models, because **T-6.20** owns that swap —
and a phase graph nothing walks is untestable, so the alternative was not "no resolution" but "no
proof". The graph, the actor selection, the events, and the expectation are final; only the middle
moves. Likewise `calls.ts` ships **two of `09` §2.3's five intent dimensions** — tempo and press line,
the two that move how long a turn is and where the ball is won, which is the whole of what a phase
turn is. **T-6.19** adds width, risk, and focus, none of which change the graph. Narration is one line
per outcome with a tone, which **T-6.21** deepens into variety plus the animated pitch diagram. Key
moments return `null`, because **T-6.22** owns them and `09` §2.4's soccer row needs the arcade games
T-6.15 and T-6.23–T-6.26 have not built yet — proposing a moment whose mini-game is missing would
make the screen fall back to the sim's outcome on every single turn, which is worse than not asking.

**The open design question T-6.19 has to settle, recorded rather than pre-empted.**
`PlaybookCall.call` is a single `CallId`, and five independent intent dimensions do not fit in one.
Either the id becomes composite (`tempo:direct|width:wide|…`), which keeps the seam untouched and
makes the CPU's search space explicit, or `PlaybookCall` grows a field, which reads better on the
screen. One dimension per side needs neither, so it is not decided here.

**Goals per match sit at 1.8 against a real ~2.7, and chasing it now would be the wrong fix.** The
shortfall is in how often a possession reaches the box, not in how often a chance is taken — so
raising `chanceGoal` would buy the scoreline by making every chance a coin flip. **T-6.18** owns it,
with T-6.20's swap to Live's models landing in between and moving the shape again. Recorded here so
the next session does not rediscover it as a surprise.

**Not done, and named so it is not mistaken for done: the Playbook screen is still basketball-only.**
`src/ui/screens/playbook-match.ts` imports `basketball` and `basketballSquads` directly, so
`#/play/playbook` cannot reach soccer and this task is headless. That is on purpose — the screen work
belongs with **T-6.21**, which is when there is a pitch diagram to draw rather than a court one, and
doing it now would mean two passes over the same file and an E2E run for each.

**INV-11's cross-mode parity harness is basketball-only** (`tests/invariants/inv-11-cross-mode-parity.test.ts`
imports `basketball` and `basketballSquads` by name). Soccer now has both modes, so a soccer parity
run is possible for the first time — it belongs with **T-6.18**, since parity is a balance
measurement and the resolution model changes under it in T-6.20 first.

**Feel note:** unplayable by hand so far, but reading a simulated match back turn by turn, the phase
ladder does the thing it was supposed to: a possession that survives two turns *feels* like it is
building towards something, and losing it in your own third genuinely stings because you can see the
opponent start their next turn in your box. The one-line narration is doing more work than expected —
"Home 7 wins it back off Away 4" reads as a match report already. What is obviously missing is
variety; by turn ten the same eight sentences are recognisable, which is exactly T-6.21's job.

### T-6.19

**The question T-6.14 left open, and how it was answered.** `PlaybookCall.call` is a single
`CallId`, and `09` §2.3's five intent dimensions do not fit in one. The two candidates were a
composite id (`tempo:direct|width:wide|…`) and an optional `intents` map on `PlaybookCall`. **The map
won**, for three reasons: it costs one optional field that every sport not setting it ignores; it
keeps `call` meaning exactly what it has always meant, so narration, match history, and T-6.22's read
window never have to learn what a dimension is; and it keeps the CPU's own decision out of a string
parser. The composite id would also have made `PlaybookCall.call` a value that no `CallOption.id`
returned by `calls()` ever equals, which is a quiet lie about the seam. `CallOption` also gained an
optional `dimension`, which is what lets the call sheet lay out four rows of chips instead of one
list of twelve. Both additions are additive and optional; basketball is untouched.

**Each side holds all five intents, always — that is the model, and it took a false start to see
it.** The obvious reading is two catalogues that swap over with possession, offence and defence. That
is wrong: a manager sets a shape and it is their shape whether the ball is theirs or not. What
changes with possession is which of the five *say* anything. Tempo speaks only with the ball, the
press line only without it, and **width, risk, and focus speak in both roles and mean different
things in each** — playing wide stretches a defence, defending wide covers the flanks and opens the
middle; ambitious with the ball is a through ball, ambitious without it is diving in. That is why
every option carries an `attack` effect *and* a `defend` effect rather than living in one catalogue.

**The composition rule, which replaced T-6.14's hand-written polarity.** Applied odds are
`base + attackerSum − defenderSum`. Subtracting the defender is what makes a defensive intent *deny*
rather than help: a high press raises `climb` in its defend column, and raising the number that gets
subtracted is what makes the ball harder to move. T-6.14 wrote that by hand for two intents
(`tempo.climb − press.denyClimb`); this is the same arithmetic generalised to five with no special
cases. A sum rather than a product, deliberately — five small independent decisions should add up to
a noticeable one and never multiply into a runaway.

**Every dimension's middle option is exactly neutral, and a test asserts it.** This is not tidiness:
it is what keeps T-6.14's turn-budget derivation true. A match of balanced intents *is* the match
that derivation describes, and everything else is a departure the player chose. Measured after the
change: **20.9 turns** in normal time and **1.9 goals** — both effectively unmoved, and drawn matches
fell from 15/40 to 10/40, which is the five intents making matches more decisive rather than longer.

**Focus is the odd one out and moves *who*, not *how likely*.** `09` §2.3 makes it "a flank, a
channel, or a specific athlete", which is a statement about people. So it steers `primaryFor()`'s
selection — pointing at a flank adds to everyone in that channel, naming an athlete adds to them, and
being named by the *other* side subtracts. A focus that also moved probabilities would just be a
second risk dial wearing a different label. **The one exception** is marking: naming an opponent both
follows them around and costs them something on the occasions they get on the ball anyway, which is
`09` §2.2's "Double the Star" in soccer's terms.

**Channels come from the formation's own `y`, averaged across every formation that names the role,**
because a role's position differs slightly between shapes (`lcb` is 0.38 in 4-4-2 and 0.30 in 3-5-2)
and a squad's formation is chosen when the squad is built rather than carried on every athlete. The
boundaries are at 0.30 and 0.70 rather than at the thirds, so **a *left*-sided centre back is a centre
back** — the widest central role averages 0.41 and the narrowest wide one 0.16, so the averaging
cannot flip an answer.

**The baseline CPU grew with the catalogue and is still deliberately blind.** It now scores every
option on every dimension it is asked about by the ratings that option names (`IntentOption.keys`),
with a seeded wobble, and takes the best per dimension — forked by `dimension:option` so adding an
option later cannot shift the ones beside it. It never looks at what the other side is doing, which
is exactly the line `modes/playbook/types.ts` draws between `coach` and `autoCall`, and the gap
**T-6.22** fills.

**`calls.ts` is gone.** T-6.14 put the two intents it shipped there; with all five and their effect
tables the file was a thin re-export in front of `intents.ts`, so it was deleted rather than kept as
a hop. One owner for the catalogue.

**Feel note:** the intents are the first thing in the Playbook run that feels like *managing* rather
than picking. Pinning a side to `wide` and watching corners climb over thirty matches is a real
tactical lever, and defending `deep` genuinely does turn a match into a siege. The one that does not
land yet is focus — steering the ball to a flank is invisible without the pitch diagram to see it on,
which is T-6.21's job and the point at which this whole set becomes legible rather than statistical.

### T-6.20

**Basketball needed no equivalent of `model.ts`, and that is the whole shape of this task.**
Basketball's Playbook calls `shotProbability()` directly, because basketball's Live shot model *is* a
probability — one function, one number, borrow it. Soccer's is not. `takeShot()` puts a ball in the
air with a placement error on it, and whether that is a goal is then decided by geometry and by a
goalkeeper who dives at it. There is no number to borrow. So `09` §7's "read the same model, not
merely the same numbers" had to be satisfied by **composition**: set up the shot the Live sim would
set up, put it through the same `placementError`, `shotSpeed`, `keeperSpot`, and `saveOutcome`, and
read off what happened. Five Live functions, no second curve.

That is a *stronger* guarantee than basketball's, not a weaker one. Tuning `SHOOTING.baseError` or
`KEEPER.diveSpeed` now moves Playbook too — which is exactly what `09` §7 exists for and what a
hand-fitted table could never promise. The tests are written to fail if somebody reintroduces one:
raising `shortPass` must not help a lofted ball, because `PASS_PROFILES.lofted.rating` is `longPass`.

**The passing conversion is the piece worth understanding.** `passError()` returns an *angular*
error, so the lateral miss at the receiver is `angle × distance`. Treating that as the standard
deviation of a normal draw and asking for the chance the ball lands inside a receiver's control
radius is the whole conversion — and it is why a longer ball is harder without anyone writing down
that a longer ball is harder. It needed the normal CDF, so there is now a local `erf()` (A&S 7.1.26);
kept in `model.ts` rather than promoted to `engine/`, because one caller is not a seam.

**Tempo and width stopped being modifiers.** A phase is carried by a *pass plan* — patient is three
short balls, balanced is two, direct is one lofted one, and in the final third `wide` buys a cross
rather than a through ball. The risk difference then falls out of `PASS_PROFILES`' own figures
instead of being asserted by a tuning constant, and the compounding across three passes is the honest
reason a patient possession still breaks down in midfield.

**The headline result: `MODEL_CALIBRATION` is zero on all three phases.** The hook was built expecting
to need it — a physical model does not land on a target distribution by itself — and the measurement
said otherwise. With the Live passing model driving the climb and the create, the baseline batch came
back at **21.98 turns** in normal time. T-6.14 derived 18–24 from a hand-fitted table solved backwards
from `09` §2.3; T-6.20 reached the middle of the same band from soccer's own passing physics with
nothing tuned to make it. **Two independent routes to the same number** is the strongest evidence
available that the phase durations in `PHASE_TURN_SECONDS` are actually right. The zeros are kept
rather than deleted because T-6.18 wants one named number per phase to hold, and a non-zero value
there would mean the model and the budget drifted apart and somebody chose the budget — a decision
worth being able to see.

**A tension that had to be resolved rather than tuned away: 18–24 turns and ~25 shots do not fit.**
One attempt per `chance` turn measured out at 5.8 shots and **1.45 goals** a match. Raising the
create odds did nothing — `sequenceSuccess` was already hitting the 0.9 ceiling — because the
bottleneck was never conversion, it was that a 22-turn match cannot contain 25 shots. The resolution
is that a `chance` phase *is* minutes of pressure in and around the box, so it gets **several
attempts**: the ball comes back, someone else has a go, and the phase ends at the first one that goes
in. That is one turn either way, so the budget is untouched. After it: **22.0 turns, 2.4 goals, 10.6
attempts**, and matches going to extra time fell from 18/40 to 16/40. Still short of a real ~2.7 and
~25, and the remaining distance is more attempts per spell rather than better shots — **T-6.18**.

**The expectation is now real xG.** `expectedGoalChance()` walks the same three stages the draw walks
— past a body, into the frame, past the keeper — analytically, using the normal CDF of the placement
error against the distance from the aim point to each post and to the bar. It is the same geometry
the draw uses rather than a second model of it, and a test asserts the sampled goal rate and the mean
analytic xG agree over 1 500 shots. That matters because `09` §2.4's "the sim also computes what
*would* have happened" is only honest if the number is the model's own opinion.

**Two things were deleted rather than left lying around.** `PHASE_ODDS` lost every entry that was a
model of play (`buildUpAdvance`, `progressionAdvance`, `finalThirdChance`, `chanceGoal`,
`setPieceGoal`, `savedShare`, `blockedShare`); the three that survive were never models of anything,
just how a phase that produced no chance still ends up with a corner. `SOCCER_RESOLUTION` lost its
three `…FromEdge` levers, because after the swap the rating edge reaches the odds through
`interceptChance` *and* through the Live models' own rating terms, and a third lever on top would have
been the same rating counted twice.

**One simplification, consistent with an existing logged gap.** `saveChance` measures the dive from
the keeper's y to the *aim* point, which `keeper.ts` documents as correct only for a keeper on their
line — an advanced keeper should be judged against the intercept point, and computing that needs the
launch velocity threaded through, which is the same gap T-6.9 logged for the chip. So the Playbook
keeper stands near their line (`SHOT_MODEL.keeperAggression` 0.35), which makes the two agree instead
of quietly flattering the shooter. Fixing the chip fixes this too.

**Feel note:** this is the first version where a match *reads* like soccer rather than like a Markov
chain. Watching a spell go save → corner → header wide, with the xG on each attempt, is genuinely
tense in a way the flat table never was — and a 25-yard effort from a poor finisher now misses the
frame entirely rather than being a slightly worse coin flip, which is exactly the difference between
a probability and a physical model. Still no way to see it but a test log; T-6.21.

### T-6.21

Soccer Playbook: narration and the animated pitch diagram. Two pieces on paper, three in practice —
the third one was the whole task.

**The screen was the task.** `PROGRESS.md` framed this as "narration variety plus a diagram, and by
the way the screen imports basketball by name". That ordering was backwards. Narration variety is
strings and the diagram is geometry; both are an afternoon. What actually mattered is that
`src/ui/screens/playbook-match.ts` imported `basketball`, `basketballSquads`, and
`createBasketballPlaybook` at module scope, so **no amount of soccer Playbook code could be reached
by a player**. T-6.14, T-6.19, and T-6.20 all shipped `done` with a complete adapter behind a screen
that could not open it — the same shape as the T-8.1 bug, one layer down: every unit test passed
because every unit test called the adapter directly.

The fix is one seam member. `PlaybookAdapter.squads(home, away)` turns a roster into two squads, and
it is the only thing the screen could not get from what it already had:

- `module.playbook` — the adapter, already on `SportModule`.
- `module.rules` — the clock, already on `SportModule`.
- `module.meta.squadSize` — five or eleven, already on `SportModule`. `splitRoster`'s hardcoded
  `SQUAD_SIZE = 5` became a parameter.
- `module.meta.periodName` — `Q1` for basketball, `H1` for soccer. A soccer match showing `Q2` is
  the sort of small wrongness that makes a whole screen read as a port of another one.
- `module.arcade` — where a key moment's mini-game comes from.

Everything else in the screen was already sport-agnostic, which is the part of T-5.10's design that
did hold. The sport travels on the query string (`#/play/playbook?sport=soccer`) rather than a path
segment, because `/play/playbook/match` already owns the segment after `playbook` and a `:sport`
pattern beside it would be two routes competing for one shape.

**Narration: the material was richer than it looked.** T-6.14 left one line per outcome, so a
twenty-two-turn match said the same eight sentences. The variants are picked by a seeded hash — the
same one basketball's T-5.3 wrote, now shared in `modes/playbook/narration.ts`, because a stability
property implemented twice is a property that will eventually hold in one place only. Two decisions
worth recording:

1. **The lines read the events, not the state.** `turn-facts.ts` reads the phase, the pass kind and
   count, the shot distance and its xG, and the marked flag back off the turn's own `SportEvent`
   stream. Reading `state.detail.phase` — which is what T-6.14's narration did — is *wrong*, and
   subtly: the turn engine commits a turn, calls `apply()`, and only then asks the screen to
   narrate, so `detail.phase` is the phase the **next** turn will be played in. A build-up that
   worked was being narrated as a progression.
2. **Templates are keyed `outcome/phase` with a fallback to `outcome`.** An advance out of the back
   is not an advance into the final third, and a set-piece goal is not an open-play one. Merging the
   two lists instead of falling through would have diluted the specific lines on exactly the turns
   they were written for.

**The diagram reads the formation.** Basketball's diagram lists five hand-placed spots per call
because a half-court set is a drawing. Soccer already has eleven positions written down, so
`rolePoint()` averages a role's `x`/`y` across every formation that names it — the same choice
`squad.ts`'s `channelOf` makes, and for the same reason: a `PlaybookSquad` carries role ids, not the
formation they came from. A hand-placed table here would have been a second formation definition
that nothing keeps in step with the first.

The phase animates as a block moving up the pitch: `BLOCK.base` is what everybody follows the ball
by, and `BLOCK.forward` is the extra share a role already playing high takes, so the shape stretches
rather than collapsing onto the ball. At `chance` a striker closes about 60% of the distance and a
centre back about a third — enough that eleven markers do not land on top of each other, and enough
that a build-up and a chance are visibly different pictures. Ten outfielders plus the one defender
the turn was resolved against; twenty-two markers on a phone is a crowd, and the attacking keeper is
never the point of a phase turn.

Shot arcs come from the `SHOT` events' own `x`/`y`, mirrored into a frame where the attacking side
always runs left-to-right. One attempt, one arc, up to three — a phase of pressure reads as three
shots rather than one, which is what `resolvePressure` actually simulated.

**Feel note.** It is legible, and it is the first time soccer's Playbook has been *watchable*: the
block sliding up the pitch tells you which phase you are in before you read the caption, and a
match's worth of narration no longer repeats itself. It is not yet exciting — a phase turn is
minutes wide, so the diagram is a diagram rather than a highlight, and the two-second gap between
"chance" and the shot arc is where the tension should be and is not. T-6.22's key moments are the
thing that fills it; until then the honest description is "clear", not "thrilling".

**Not done here, deliberately:** the soccer arcade card on the hub still says its mini-games are
being built, because they are (T-6.15, T-6.23–T-6.27). `catalogue.ts` keeps the rule it was written
with — availability is what a *screen* can start, not what a module supplies — and only soccer's
Playbook row moved.

**A real layout bug, and only two sports could find it.** The E2E tap-through failed on the first
call: `.playbook-match__board` had `min-height: 0` and no `overflow`, so when the call sheet grew
taller than the space left over, the board's score row spilled out of its own box and sat on top of
the sheet, swallowing the tap. Basketball's sheet is six cards and never grew far enough; soccer's
is four rows of intent chips and does. The board now clips and holds a floor of 32%, and the stage
scrolls instead of being pushed off the bottom. This is the second time in two tasks that a screen
was verified only against the sport it was written for — see T-8.1.

**A stale test, the third of its kind.** `tests/unit/modes/last-played.test.ts` used soccer +
Playbook as its example of a pairing the hub does not offer. It is now a real pairing, so the test
was re-pointed at soccer + arcade rather than deleted — the behaviour still matters. Expect more of
these; the note in `PROGRESS.md` about Phase-3 tests using soccer as an unplayable sport is the same
pattern, and it will keep happening as each sport is finished.

### T-6.22

Key moments → arcade, and the Playbook CPU's call selection. **The CPU half is done; the key-moment
half is parked, and the parking is the decision worth recording.**

**Why it is parked.** `09` §2.4's soccer row is five mini-games — penalty, direct free kick,
one-on-one, header from a cross, goal-line save — and none of them exist. T-6.15 and T-6.23–T-6.27
build them. `startKeyMoment()` already handles the "sport proposed a game this build does not have"
case by taking the sim's outcome, so wiring `keyMoment()` now would *work*, in the sense of not
crashing: it would interrupt the player on every shooting phase and then quietly resolve it for
them. That is worse than not being offered a moment, and it would also make the feature look done
when the thing it exists for is missing. `keyMoment()` keeps returning `null` and keeps explaining
itself in its own comment.

**`baselineCall` was not replaced — it was reclassified.** It moved to `adapter.coach` unchanged.
T-6.14 wrote it as a stand-in for a CPU, but what it actually is is a *coach*: it scores its own
squad's fit for each option and never looks at the opponent. That is precisely the line
`modes/playbook/types.ts` draws — `coach` answers "what suits us" for a human who left Auto-call on,
`autoCall` also reads the opponent — and soccer's Playbook now has both, where before it had one
function doing the easier job under the harder name.

**Four decisions, not one.** Basketball's CPU picks one call from a sheet and its whole design
follows from that. Soccer's picks a value on each of four dimensions, scored and sampled
independently. Bundling them into composite calls was the alternative and it is wrong twice: it
invents thirty-six "calls" the player never sees, and it asserts a dependency between decisions that
is not there — deciding to press high says nothing about how wide to play.

**Three things the score is made of**, all in the same units the intent effects are written in
(`INTENT_OPTIONS`' figures are 0.05-ish, deliberately):

1. `phaseValue` — what the option is worth *in the phase actually being played*. A build-up is
   decided by `climb` and nothing else, so an option chosen for what it does to a shot is a wasted
   decision there. This is most of what separates the CPU from `baselineCall`, which scored every
   option identically in every phase of the match.
2. `squadFit` — a 20-point rating edge on what the option asks for is worth 0.05, so ratings and
   tactics matter about equally (`09` §2.2).
3. `clockValue` — the one piece of match awareness it has, and the one every real coach has: a side
   in front wants the clock gone, a side behind wants turns. `duration` is the only effect about
   time rather than probability, so it is priced separately.

**The one counter table, and why there is exactly one.** `IntentEffect` says what an option is worth
*on its own*. It has no way to say "against", and `09` §2.3 describes precisely one genuine
counter in words: a high press wins the ball high against a side that plays out, and is bypassed by
one that goes long. So `PRESS_COUNTERS` is written down as a table rather than smuggled into a
number that means something else. It is symmetrical by construction — every row and column sums to
zero, which a test asserts — so a read is a redistribution and never a free gain, and a CPU facing a
balanced opponent chooses on the merits alone.

**`READ_WEIGHT` was sized, not picked, and the first value was wrong.** At 0.06 the read never
flipped a call: in a build-up, a high press denies `climb` 0.08 and a deep block concedes 0.05, so
the intrinsic gap is **0.13**, while the counters at ±1 moved the two apart by only `2 × 0.06` =
0.12. The test that caught it is the one asserting the CPU drops off against a direct-playing side,
and it failed by 0.01 — a soft counter that can never actually change a decision is decoration.
At **0.08** the spread is 0.16: enough to flip, and only when the tendency is near-total. A
20-point rating edge is 0.1 across two options, so a side genuinely built to press still presses
through a read telling it not to. That is the right way round, and it is what "ratings beat
mind-games" has to mean numerically.

**The read window is ten, not basketball's twelve.** A soccer Playbook match is 22 turns where a
basketball one is near 200. Twelve turns would be half the match and no longer a *recent* tendency
at all. Ten is about a half, which is the unit a coach actually adjusts on.

**A test that could not be written the obvious way.** "A Legend CPU beats a Rookie one over a batch"
is how basketball's ladder is asserted, and it is meaningless here: `simulatePlaybookMatch` puts one
difficulty on the state and *both* sides read it, so a CPU-vs-CPU batch at Legend is Legend against
Legend. What the ladder actually moves is the sampling temperature, so what the test measures is how
often the CPU takes the option its own scoring rated best — monotone down the ladder, and 25
percentage points between the ends. Paired with the INV-1 test that no rating on either side differs
by difficulty, that is the real claim: it gets better by choosing better.

**Feel note.** Not playable yet by a human against it — the turn screen exists, so it is, but I have
only watched simulated matches. What is visible in those is that the CPU now *changes its mind*: a
side that plays out from the back for a spell gets pressed, and stopping doing that stops the press
within a few turns. That is the loop `09` §2.2 describes and it is legibly there. Whether it is fun
to play against depends entirely on the key moments that are still missing.

### T-6.15

Penalty Shootout — soccer's first mini-game, and the dependency root of T-6.23–T-6.27.

**Both roles, because `09` §3.2 asked for one.** "Aim + power + keeper read; **also the defending
side**" is the only entry in the whole launch set that asks a game to swap roles, and it is right:
a shootout *is* that alternation. Odd rounds you take, even rounds you keep. Taking five in a row
would be Free Throw with a bigger target.

**Aim and power on one meter.** `ArcadeGameView` exposes exactly one meter, deliberately — a HUD
that grew a second axis for one game would carry that game's vocabulary into shared UI and the fifth
game would break it. So the kick is two sequential passes of the same meter: stop the marker to
place the shot, then stop it again to strike.

**The keeper read went through one redesign, and the first version was wrong.** Originally the
keeper was hidden during the aim stage and `ArcadeGameView.target` was `null` there. Two problems,
one of which the shared test helper found immediately: `pressInBand` returns false when there is no
band, so a competent player never pressed at all and every round timed out. The deeper problem was
that "keeper read" with an invisible keeper is not a read — it is a coin flip with extra steps.

The fix: on 55% of rounds the keeper commits early and visibly, and the aim band narrows onto the
widest stretch of goal more than their reach away. On the rest they hold, and the band is the whole
frame inside the posts — which is the *honest* band, because nothing you can see tells you more.
Two draws are taken either way, so a round where the keeper holds consumes the same stream as one
where they commit; otherwise the tell would shift every later draw in the run (INV-8).

**A count, not a clock**, for the reason basketball's Free Throw records: a novice's meter runs
faster, and under a clock that hands them more attempts per run than a specialist gets. Ten rounds.

**Two hardcoded-basketball bugs in screens, both found by asking "can this game be reached?"**

1. `arcade.ts` and `arcade-game.ts` both built their catalogue from `[basketball]`. A game added to
   soccer's module simply would not have appeared. Same class as T-6.21's, third instance this
   session.
2. Worse, and it would not have shown up as a missing tile: `arcade-game.ts` passed
   `basketball.xpAwards` to `arcadeProgression()` for **every** run. A penalty kick emits
   `zone: 'penaltyArea'`, which basketball's table does not know, so it would have trained nothing —
   or, with an unluckier zone name, trained the wrong rating. `09` §3.4's promise that the arcade
   trains the same ratings the sim does would have been quietly false for half the build's games.
   It now loads the award table of the game's *own* sport.

Both now go through `PLAYABLE_SPORTS`, which is the one place a sport's import path is written down.

**The drawing helpers moved.** `ARCADE_COLOURS`, `drawMeter`, `label`, `bar`, and `mirrorX` were in
`sports/basketball/arcade/shared.ts` and are now in `modes/arcade/draw.ts`. None of it is about
basketball: a release meter is a release meter, and the mirroring rule (T-4.12) and the
never-colour-alone rule (`10` §11) are app-wide promises that should not hold in one sport because
that sport was written first. Basketball's file re-exports them, so nothing there changed.

**A test that could not be written the obvious way, again.** "Ten rounds, so five shots" is wrong:
a three-life run usually ends before ten rounds. The alternation is asserted as
`shots === ceil(attempts / 2)` against the run's own attempt count, which holds for a run of any
length and would fail immediately if the game ever took two rounds in a row.

**A "flake" that was not one.** After T-6.21, `pwa-lifecycle.spec.ts` PWA-1 began failing in full
E2E runs. The cheap reading was CPU contention, and it was wrong. Bisecting by spec file: PWA-1
passes alone, passes after `a11y-and-smoke`, passes after `live-match`, and fails after
`play-hub` — and passes again with T-6.21's soccer Playbook test excluded from `play-hub`. So it
was caused by this branch, and worth finding.

The bug was in PWA-1 all along. It called `waitForWaitingWorker()` — which resolves only once a
second worker reaches the waiting state, and *is* the assertion — and then read
`registration.waiting` a second time. A waiting worker activates the moment nothing is controlling
the page, so between the two calls it can legitimately move on, and the test then fails because the
update was applied **too promptly**: the opposite of what it guards. It survived for two phases
because every spec before it was fast. The soccer Playbook test is slower than its neighbours and
lost that race on every run. The redundant re-read is gone; what is re-read now is
`waiting || installing`, both of which mean the update was seen.

The lesson is not about service workers: *a test that waits for a condition and then re-checks it
has two chances to be wrong and only one to be right.*

**Feel note.** The swap is the whole thing, and standing in goal is the better half — which
surprised me. Taking is a solved problem once you have the read; keeping is a genuine flinch test,
and the tell shortening as the run goes on is what makes rounds seven through ten feel different
from one through four. The one thing that is not right yet: a round you lose to a keeper who
guessed correctly reads as unfair rather than unlucky, because nothing on screen distinguishes
"they read you" from "they got lucky". T-6.16's audio pass is probably where that gets fixed.

---

### T-6.23

Free Kick — soccer's second mini-game, and the first one where the interesting decision is not a
timing decision.

**Two gates, two taps, and one axis each.** `09` §3.2 asks for four things — curve, aim, wind,
distance — and the obvious way to build that is one blob of "shot quality" that all four feed. That
would have been a worse Penalty Shootout. Instead the wall and the keeper were split into two
different kinds of obstacle:

- The **wall is a height gate**, and height is the strike meter. Under the band the kick never
  clears the wall; over it, it clears the bar. Distance moves the band *up* and narrows it.
- The **keeper is a width gate**, and width is the aim meter. Where the marker stops is the line,
  and the wind then drags the ball off it.

So each tap answers one question, and a miss can say which one you got wrong: "Into the wall",
"Over the bar", "Wide", "Keeper saves". That wording is the whole of the game's teaching.

**The band shows where to aim, not where to score, and that is the design.** The aim band is the
unguarded stretch of goal *shifted back by the wind*. A band drawn on the target itself would be an
instrument that lies about the only decision in the game — you would aim at it, the wind would take
the ball off it, and the HUD would have set you up. Showing the compensated line is the same honesty
the Shootout's aim band keeps when the keeper has not committed. It also means the wind is legible
without any arithmetic: the band moves, you follow it.

**Both gaps stay live.** The band shows whichever of the two stretches either side of the keeper
survives the wind shift wider, but scoring is judged against the real frame — posts and keeper reach
— so the smaller gap still works for anyone who wants it. A band is a recommendation.

**Registered on landing, not at T-6.27.** `index.ts` previously said T-6.27 would register all five
games. That is now the wrong order: a game that is not in `SOCCER_ARCADE` is not covered by
`games.test.ts`'s set-wide contract, which is the file that exists specifically so five games cannot
quietly disagree. Free Kick joins the array in the commit that builds it, and T-6.27's job narrows
to the unlock wiring and the cross-set `calibrate()` sweep. The array's comment now says "what has
actually been built" rather than naming a future task.

**Tuned against a measurement, not a guess — and the first numbers were wrong three ways.** A
throwaway probe drove twenty seeded runs per rating with both `pressInBand` and `humanPlayer`:

1. **Eight rounds ran 14–17 s**, under `09` §3.1's twenty-second floor. Ten rounds puts a competent
   run at 20–24 s.
2. **Three stars were arithmetically unreachable.** Eight perfect rounds topped out around 2,276
   against a 2,300 threshold. Ten rounds caps near 3,160, so 2,300 is now a genuinely good run
   rather than an impossible one.
3. **Every miss cost a life**, which is not the split the rest of the set draws. A life is now spent
   only on a *player* error — the height, the line, or the corner — and never on the athlete's
   outcome band coming up short. That is `09` §2.4 applied to run length: a novice's ceiling should
   be a lower score, not a shorter run.

`durationSeconds` is **35**, which is what a run measurably takes rather than a round number.

The human-model curve after tuning, mean score over twenty seeds: rating 30 → 313, 55 → 1,031,
75 → 1,353, 90 → 1,869. Monotonic and well separated, which is the claim `09` §2.4 actually makes.

**A finding that is not this task's to fix: Penalty Shootout is badly under-tuned.** The same probe
pointed at T-6.15's game gives a rating-90 athlete a mean score of **156 against a 600 first-star
threshold** — three stars are unreachable, one star is unreachable, and a run lasts ~12 s against a
declared 75. Nothing about it is broken, and every test it has still passes, because none of them
assert what a good player actually scores. It belongs to **T-6.18**, and it is the strongest argument
yet that the balance pass needs a scored-run harness (the equivalent of `pnpm balance` for arcade)
rather than a read-through.

Feel note: the wind is the thing. Aiming a post's width outside the frame and watching it curl back
inside is the best moment in soccer's arcade set so far, and it is better than anything in the
Shootout. The rounds where the wind draws near zero are noticeably flatter — if the range is ever
tuned, tune it *up*. The one thing not yet right is that the wall is invisible as an obstacle: it is
drawn, but the failure "Into the wall" happens on the meter, so the picture and the reason live in
two different places on the screen. T-6.16's art pass is where that gets joined up.

---

### T-6.24

One-on-One — through on goal, keeper coming out.

**The two taps are cause and effect, and that is what makes it a different game.** In the Shootout
and the Free Kick the taps are independent — placing the shot well does not make striking it easier.
Here the first tap *is* the second's difficulty: the touch decides how much goal is open, and the
finish is played into whatever it left. A scuffed touch is a harder finish rather than a failed
attempt, which is what a one-on-one actually feels like and why `09` §3.2 names both halves in one
line. Mechanically it is one field: `meter.windowScale` is set from the touch quality when the touch
lands, between `OPENING.scuffed` (0.55) and `OPENING.perfect` (1.75).

**The approach is a countdown, not a sweep — the first one-way meter in the project.** Every other
meter bounces, so a missed moment comes round again. A keeper closing you down does not. The marker
runs once and there is one moment in it worth taking.

This turned out to be free: `humanPlayer`'s "sweep" branch estimates marker velocity and aims at the
band's centre, which is exactly right for a one-way marker too. Its *countdown* branch is for a band
that spans the whole track, which this is not. No helper changes were needed, and that is worth
recording because the next game that wants a one-way meter will wonder.

**The window's position is asserted, not just its width.** `TOUCH_AT` is 0.67 — late, because the
keeper has to commit before the touch beats them. That is the lesson the game teaches, so there is a
test that samples the band during the approach and asserts its centre is past the midpoint. A
constant nobody reads would have drifted.

**Where the window comes from, and a thing that is genuinely not pressure.** The window's width in
*seconds* is the athlete's (INV-10). `APPROACH_SECONDS` varies 1.15–2.05 s per round, which changes
how big a *slice* of the marker's travel that window is — but in real seconds the difficulty is
identical either way. So a fast keeper is not mechanically harder; it is harder because the moment
arrives with less warning. Worth being honest about: the round-to-round variety here is pacing, not
difficulty, and if the game ever needs a real difficulty ramp it has to come from somewhere else.

**Tuned against the probe.** Human-model mean over twenty seeds: rating 30 → 275, 55 → 920,
75 → 1,277, 90 → 2,168. The first star thresholds gave a rating-90 athlete three stars *on average*,
which is not what three stars should mean; raised to 450/1,300/2,500, so the average good run is two
stars and a strong one is three. `durationSeconds` 35, against a measured 24 s for a competent run.

Feel note: the late window is the whole game, and going early feels safe and scores nothing — it took
about six rounds to stop doing it. That is the right shape for a mini-game, but it does mean the
first run is discouraging in a way the Free Kick's is not, and "Went too early" is doing a lot of
work as the only thing telling you why. If one of these three games needs a coaching line on the
run-over screen, it is this one.

---

### T-6.25

Header — attack the cross.

**The jump is contested, and that is this game's own idea.** Everywhere else in the set you are timed
against a clock or a keeper. Here you are timed against *another jumper*: `jumpBand()` is centred on
the cross's meeting point and then shifted by `CONTEST_SHIFT` (±0.09 of the flight, drawn per round),
so the window is somewhere slightly different every time and cannot be learned as a number. Early and
the defender is still rising into you; late and you are under it.

**A great leap buys hang time, and hang time is control.** Jump quality sets the direction meter's
*speed*, not its width — deliberately a different lever from One-on-One's, which widens the band. A
good touch gives you more goal; a good leap gives you more time.

**Contact height is read from the sim, not restated.** `PASS_PROFILES.cross.arrivalHeight` is 1.9 m,
and the PROGRESS note from T-6.9 flagged it as heading's hook. A test asserts the two agree, so a
change to what a cross *is* reaches this game rather than diverging from it.

**Two bugs, both of which punished exactly the athletes they were meant to reward.** The probe caught
both, and neither was visible to the test suite, because `pressInBand` presses the instant the band
is under the marker and so cannot experience either failure. Under the human model the curve came out
**409 / 993 / 888 / 802** for ratings 30 / 55 / 75 / 90 — rating 55 beating rating 90.

1. **The direction band was wider than the gap.** It is centred on the opening the keeper leaves;
   when the athlete's window grew wider than that opening, the surplus sat *over the keeper*, so a
   press inside the band could still be claimed. The better the athlete, the more of their reward
   landed on unsafe ground. `fitBandToOpening()` now shrinks the band to the gap after `speedScale`
   is known, and being in the band is the whole truth — one check, no separate keeper test.
2. **The directing clock was denominated in seconds.** A better athlete's meter sweeps *slower* —
   that is how the framework pays them — and the band sits wherever the round's gap is. At rating 90
   with a good leap the marker needed ~3.6 s to cross the track and had 1.6 s, so specialists timed
   out on precisely the far-side chances novices converted. The clock is now `DIRECT_SWEEPS` (1.25)
   of the meter's own sweep, floored at 1.1 s, which is the same promise at every rating.

**The second one generalises and is worth carrying forward.** Any game that puts a band somewhere
other than the middle of the track and then imposes a fixed clock has this bug latent in it. The
other three are safe by inspection — the Free Kick's power band tops out at 0.76 against a 4 s stage,
One-on-One's finish is centred at 0.5 against 2.2 s — but **T-6.26 should be checked against it
deliberately**, and any future game should denominate its clock in sweeps whenever its band moves.

After both fixes, human-model means: **485 / 859 / 1,543 / 1,923**. Monotonic, and the top two are
finally separated. There is a regression test at 75-vs-90 stated against the human model, because
`pressInBand` scores 1,848 against 1,913 across the same pair and would not have failed.

Feel note: the best of the four. Beating a defender to a ball is a more interesting thing to be good
at than beating a clock, and the floated cross — slow jump, frantic finish — has a rhythm none of the
others have. The driven one is nearly the opposite and the alternation is what carries the run.

---

### T-6.26

Last Line — play the keeper. The fifth and final game of `09` §3.2's soccer set.

**One tap, one clock, no aiming — and it is the only game in the set shaped that way.** Everything
else is two taps and a count of rounds. A keeper's job does not decompose into a placement and a
strike, and a run that ended after ten shots would be over before the rhythm started. So Last Line is
forty-five seconds and a single button, and it is soccer's only clocked run.

**The window is the athlete's reaction time, undisguised.** The marker crosses the whole track in
exactly `calibration.reactionSeconds`. A novice's shot is past them in a fifth of a second; a
specialist's hangs for more than half of one. Nothing else in the project puts a derived rating on
screen this directly, and it is the clearest demonstration of `09` §2.4 anywhere in the game — two
players tapping identically get different results and the reason needs no explaining.

**The band spans the whole track on purpose.** That is precisely how `humanPlayer` tells a countdown
from a sweep: it reacts to what was on screen a latency ago rather than estimating where the marker
is heading. Anticipation is the one thing a reaction test must not reward, so the band's shape is
load-bearing and there is a test that says so.

**Two ways to cheat, both closed.** The meter reads `null` through the wait before each strike, so a
press then is a keeper committing early and concedes. A masher lands an edge in every wait and saves
nothing; a holder lands one edge ever and is then beaten by every shot after it. Both are asserted
against a rating-90 keeper who would otherwise save about half.

**Rebounds.** A save spills back out 35% of the time, and the follow-up arrives with no wait and 70%
of the allowance. Conceding to a rebound you had already saved is the most annoying thing in the
game, which is exactly why it belongs — it is what makes a save the start of something rather than
the end of it.

**T-6.25's latent bug was checked for and is not present.** Last Line's band spans the track, so
there is no "marker cannot reach the band in time" failure available to it; the clock is the run's,
not the stage's.

**A set-wide test had to be rewritten, and it was wrong before this game existed.** The contract said
*every* game emits a `SHOT` whose zone the XP table knows. That was an accident of the first four all
being shooting games: Last Line takes no shots at all and trains `goalkeeping` through saves. The
assertion is now the claim that actually mattered — every game emits **at least one event the XP
table pays a rating for** — plus a separate, weaker one that any game which *does* shoot names a
known zone. Strictly stronger, and it no longer assumes what kind of game a game is.

Human-model means over twenty seeds: **524 / 1,108 / 1,691 / 1,978** for ratings 30 / 55 / 75 / 90,
at 4/28 saves for the novice and 13.5/29 for the specialist. Every run lasts exactly 45 s, so the
declared duration is the truth rather than an estimate.

Feel note: the one I kept replaying, and the only game in the set where the athlete *is* the
experience rather than a modifier on it. Playing a novice keeper is legibly hopeless in a way that
teaches more about the rating system than the athlete card does.

---

### T-6.27

Set registration, unlock wiring, and `calibrate()` tests — and **two of the three needed no code**.

**Registration was already done, one commit at a time.** T-6.23 changed the rule: a game joins
`SOCCER_ARCADE` in the commit that builds it, because a game outside the array is invisible to
`games.test.ts`'s set-wide contract — the one file whose whole job is stopping five games quietly
disagreeing. Leaving registration to this task would have meant four games shipping untested by the
contract and then all being wired at once, which is the opposite of what the contract is for.

**Unlock wiring turned out to be a seam that already worked.** The hub reads `unlockStates()`
generically over whatever catalogue it is given, `ARCADE_UNLOCKS_BY_ID` has had all ten ids since
T-4.1, and T-6.15 had already fixed `arcade.ts` to build its catalogue from every playable sport
rather than from `[basketball]`. So soccer's five got unlock handling by existing. Recorded as a
non-event rather than dressed up as work.

**What was actually missing was any test of the catalogue as a whole**, and that is the deliverable:
`tests/unit/modes/arcade/launch-set.test.ts`, thirteen tests over both sports at once. The per-game
files cannot make these claims, and three of them would have caught real, invisible bugs:

- **An unlock claimed twice**, which would ship a hub where two tiles opened together — a ceremony
  that lies. Asserted in both directions, so an unlock claimed by *nobody* also fails.
- **A game unlocked by the other sport's achievement.** The tile would work; it would simply open
  when the player did something in a sport they were not playing.
- **A `calibrate()` whose reported rating drifts from the ratings it says it reads.** Asserted
  against `deriveRatings` + `arcadeRating` directly, which is the tie `09` §7 rests on: tuning an
  athlete's soccer ability has to tune all three modes, and this is where that stops being a claim.

Also: `calibrate()` is *pure* (INV-10's signature can be satisfied by a function that memoises a
personal best; the behavioural half is now stated), difficulty moves the forgiveness and never the
rating or the label (INV-1, `06` §7), and each sport's five games spread across at least five
ratings with no single rating appearing in all five — a set whose games all read `finishing` would
be one game with five pictures.

**Three assumptions I had to correct against the code rather than assert into it**, all worth knowing:

1. **Game ids are not prefixed with the sport id.** Basketball's are `bball.`, not `basketball.`. The
   assertion became the claim that holds — one prefix per sport, no two sports sharing one.
2. **The arrays are not in `09` §3.2's order.** Each `index.ts` orders its set *easiest first*,
   because that is hub order and the first tile a newcomer taps should need the least explaining.
   Membership is asserted; sequence deliberately is not.
3. **`unlockStates()` currently returns `unlocked: true` for everything**, because
   `ACHIEVEMENTS_LANDED` is `false` until T-8.6 — a hub of ten permanently locked tiles is worse than
   an honest temporary shortcut. Rather than work around it, there is now a test asserting the
   shortcut *is still in force*, so the commit that flips the flag has to come here and invert this
   test rather than discovering the change in the hub.

---

### T-6.22 — closed

The key-moment half, written once all five mini-games existed. The CPU half is above, from the
earlier session; this is what finished the row.

**Four of `09` §2.4's five soccer moments are wired, and the fifth has no trigger to give it.**

| Moment | Game | What it reads |
|---|---|---|
| Direct free kick | `soccer.free-kick` | a shot from the `setPiece` phase, played *without* width |
| Header from a cross | `soccer.header` | a shot with the attacking side's width intent set to `wide` |
| One-on-one | `soccer.one-on-one` | a `chance`-phase shot the shooting model rates ≥ 0.18 xG |
| Goal-line save | `soccer.last-line` | the **defending** player, and the shot was on target |
| Penalty | — | **nothing.** See below. |

**Why the penalty stays unwired, and where it actually belongs.** Soccer's Playbook resolves a phase
into `advance · chance · corner · goal · saved · off-target · blocked · lost`. There are **no fouls
in the model**, so nothing can award a spot kick. The available fake was to invent a foul roll inside
the key-moment detector, which would have put a rules change in the wrong file and made Playbook and
Live disagree about how often penalties happen. The Penalty Shootout's real home is the shootout that
decides a match still level after extra time — which `index.ts`'s `isFinished` has named as missing
since T-6.14 and which needs match-level support, not a moment. There is a test asserting the
mapping table does *not* contain it, so the gap is a decision rather than an oversight.

**Width outranks phase, deliberately.** A cross swung into the box from a corner is a header, not a
free kick, and the player *asked for the cross* — reading a call they made beats reading a hidden
roll. The ordering has its own test because it is the one thing about detection that is not obvious
from the table.

**The defending moment inverts `made`, and that is the most breakable line in the file.** `made`
always means "the player did their job". Attacking, that is a goal; in goal, it is a shot **kept
out**. Getting it backwards would score the entire defending half of the mode exactly wrong, every
test in the project would still pass, and the symptom — conceding when you save — would look like a
bug in the mini-game. It has its own test that says so in as many words.

**Tuned against a probe, like the mini-games.** Detection fired on synthetic resolutions but the
real question is what a real match produces. Thirty simulated matches, ~25 turns each:

| | before | after |
|---|---|---|
| `last-line` | 2.70 / match | 2.70 |
| `header` | 0.93 | 0.93 |
| `free-kick` | 0.90 | 0.90 |
| `one-on-one` | **0.13** | **0.73** |

`CLEAR_CHANCE` started at 0.3 xG, which made the marquee soccer moment appear roughly **once every
eight matches**. At 0.18 the whole set is about one moment every five turns, which is what "Standard"
should feel like. A trimmed version of that probe is now a test: it asserts all four moments actually
fire across twelve simulated matches, because detection reads `detail.phase` and `detail.chance` off
events `resolution.ts` builds, and a rename on either side would zero a moment out in total silence.

**A note for T-6.18.** The rates above are a first pass, not a balance decision. `last-line` at 2.7 a
match is three times either attacking moment, because the player defends half the time and shots on
target are common; whether that is the right feel is a question for the balance pass with a phone in
hand, not for a unit test.

---

### T-6.16

Soccer art and audio — and it turned out to be a **bug fix**, not a polish pass.

**A soccer match was being played by basketball players chasing an orange ball with seams on it.**
`modes/live/screen.ts` imported `sports/basketball/art.ts` by name and drew every athlete and every
ball with it. Its own comment explained why that was fine — "entities are drawn generically here…
because a top-down athlete is not sport-specific" — and that sentence is exactly what made it
invisible for a whole phase. The *body* is generic. The **kit** is not.

The same file constructed `BasketballAudio` unconditionally, so a soccer goal played a basketball
swish, a save played nothing at all, and the "denied" cue was wired to `EventKind.REBOUND` — an event
soccer never emits. **This is the fourth instance of the pattern the In-flight block warns about**,
after `#/play`, `playbook-match.ts`, and `arcade.ts`. All four passed every test they had.

**Three seam changes, all of them the sport module gaining a member it should always have had:**

1. **`SportRenderer.drawAthletes(ctx, state, world, controlled)`** and **`.drawBall(...)`**. They
   take the sport's *state*, which is the interesting part: soccer's goalkeeper wears a different
   kit, that is a rule of the game rather than a decoration, and **only soccer knows which entity
   the keeper is** (`SoccerState.keepers`). A signature that passed a colour could not have
   expressed it. Basketball's implementation is the code moved verbatim out of the screen.
2. **`SportModule.audio?: SportAudio`** — one method, `cue(event): AudioCue | null`. The sport
   chooses *which* cue; `modes/live/audio.ts` keeps the *synthesis*, one voicing per cue, so two
   sports sound like one game rather than like two engines. `BasketballAudio` became `MatchAudio` and
   the file no longer imports a sport at all (INV-5). **A sport with no mapping is silent**, which is
   a better default than borrowing somebody else's.
3. `modes/live/screen.ts` now names **no sport anywhere**.

**Soccer's own art**, in `sports/soccer/art.ts`:

- **Three kits, not two.** Both outfield sides plus the keeper, and the keeper is told apart by
  *shape* as well as hue — a band across the shoulders that neither outfield kit has — because a
  colour nobody can resolve on a 105 m pitch shrunk to a phone is not an answer to "which dot is the
  keeper" (`10` §11).
- **A football, not a disc.** White with three dark panels and no seam line. The seam was the single
  most visible symptom of the borrowed art, and the radius was the second: 0.11 m against a
  basketball's 0.24.
- **Not shared with basketball's art, deliberately.** The two draw a similar body and will not stay
  similar. Two implementations of a hundred lines is not duplication worth an abstraction; a third
  sport wanting the same body is, and **T-6.17 owns that call** when Phase 11 arrives.
- `Canvas2D` has no `ellipse` — it is the slice of the real context the renderer actually uses
  (T-1.7), which is what makes all of this testable with no browser. Shadows are circles. At this
  size nobody can tell.

**Soccer's `drawOverlay` draws the offside line**, which was `null` before. The second-last
defender's x, drawn only for the side in possession, because that is when it constrains anything. It
is soccer's one overlay that is information rather than decoration: a player who cannot see the line
is guessing at a rule the sim is enforcing against them. `offside.ts` still owns the model; this
reads a position and draws a line.

**Soccer's cue mapping disagrees with basketball's instincts in one place, and that is the point.** A
*save* is a cue and a shot on target is not. Soccer scores about three times a match against
basketball's eighty, so every attempt announcing itself would be noise; what carries the tension is
the outcome. The goal cue is the only one in the vocabulary allowed to be an event rather than a
noise — a rising two-note figure, longer than anything else — and it keeps both notes under Reduced
Audio, because the cue that tells you the score changed is not decoration.

**Not verified on a device.** Every claim here is asserted against the recording canvas; whether the
keeper actually reads as a keeper at phone size, and whether the goal cue is satisfying rather than
twee, are both questions for the deploy that has been blocked since Gate 2.

---

### T-6.17

Engine-core refactor: extract anything basketball-shaped that leaked into core.

**The audit found nothing in `src/engine/`, and that is the honest headline.** A sweep for basketball
vocabulary turns up three hits and all three are fine:

- `MatchRules.clockRunsInStoppage` — a comment naming both sports as examples, which is the seam
  working rather than leaking.
- `DEFAULT_BALL_PHYSICS.restitution` — same, a comment giving both sports' values.
- `EventKind.REBOUND` — a shared kind that today only basketball emits. Left alone deliberately: a
  rebound off a keeper's parry is a real thing in soccer, hockey has them, and renaming a kind
  ripples through every XP table, box score, audio mapping, and achievement rule in the project for
  no gain. Recorded rather than churned.

**The leaks were one layer up, and T-6.16 had just fixed the worst of them** — `modes/live/screen.ts`
drawing every sport with `sports/basketball/art.ts` and playing basketball's audio cues. That is the
useful finding: `engine/` was never the problem, because it has no reason to import a sport, while a
*mode* legitimately imports both and so is where "the first sport's name" actually survives.

**So the deliverable is the test that stops the next one.** A one-off audit that finds nothing is
worth exactly as much as the guard it leaves behind: `layering.test.ts` now asserts that no file
under `src/engine/` imports from `src/sports/` or `src/modes/`. INV-5 in structural form, next to the
domain-must-not-import-UI rule that has been there since T-3.10.

**One real core change, and it was the gap logged since T-6.14: `MatchRules.maxOvertimePeriods`.**

`MatchStateMachine` offered another overtime period for as long as the score was level and
`overtimeSteps` was set. That is right for basketball — a tied game plays OT after OT until somebody
leads — and wrong for every sport with a different tiebreak. Soccer plays exactly two extra halves
and then takes penalties, and with nothing to cap it a level Playbook match reached **period 15**
before the turn engine's `MAX_TURNS` guard caught it.

**Why it had to be here rather than in the sport.** T-6.14 fixed Playbook by overriding
`adapter.isFinished`, which worked and left **Live broken** — Live has no `isFinished` to override.
Any sport with a bounded tiebreak would have to reimplement the same cap in each mode that gave it a
hook. One optional number on `MatchRules` serves every sport and every mode, the default stays
unbounded so basketball is untouched, and `SOCCER_RULES` now carries `maxOvertimePeriods: 2`.

What happens *instead* of another period is deliberately not the engine's business. The field says
only that the match stops; a sport whose laws call for a shootout runs one above this layer, which is
where the unwired Penalty Shootout still sits.

Soccer's `isFinished` override is kept as a belt-and-braces guard (the turn loop has two exits and
that is the cheaper one), but its comment now says the engine owns the rule.

**Gate 6's engine-change list is therefore three, all justified**: `extendPeriod` (T-6.2),
`Camera.resize` (T-6.12), and `maxOvertimePeriods` (T-6.17). None of them names a sport.
