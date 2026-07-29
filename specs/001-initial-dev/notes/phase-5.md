# Phase 5 notes — Playbook (turn-based) + basketball Playbook

Long-form rationale for the Phase 5 task rows in [`../PROGRESS.md`](../PROGRESS.md). The
one-sentence version lives there; this is the part a future session needs only when it touches the
code.

---

## Task notes

### T-5.1

*`PlaybookAdapter` interface + turn engine: turn loop, state, seeded resolution*

**The line between the adapter and the engine.** The adapter owns everything sport-shaped — the call
catalogue, the resolution model, what counts as a key moment, how to say it in one line. The turn
engine owns everything *turn*-shaped: the turn counter, the clock, periods and overtime, the score,
possession, the seeded RNG, and emitting the stream. Basketball and soccer disagree about almost
everything below the turn and about nothing above it, which is where the line belongs.

**Periods are Live's `MatchStateMachine`, not a second clock.** A Playbook turn spends *steps* — the
same steps Live integrates — and the state machine decides when a period ends, when overtime starts,
and what the score is. Giving Playbook its own clock would have been half a day less work and would
have made INV-11's parity test a comparison of two different things: `SportEvent.step` has to mean
the same thing in both modes or the box score, achievements, and XP are reading two incompatible
streams. So Playbook does not get its own clock; it gets a coarser way of spending the same one.

**The sim resolves first and the arcade replaces the outcome afterwards.** This is what makes `09`
§2.4's "the sim also computes what *would* have happened" true rather than aspirational — the
counterfactual is not reconstructed later from the box score, it is the value that was actually
drawn, recorded at the only moment it is knowable. `settleKeyMoment()` captures it before the
adapter is allowed to rewrite anything.

**Events are held until the turn commits.** A turn's events are not the match's until `advance()`,
because a key moment can replace them wholesale. Emitting at resolution time would put a missed
three into the box score and then have to take it back out — and "take it back out" is the class of
bug that only shows up in a stat total three screens later.

**Deliberate deviation from `09` §5's sketch.** The sketch lists five members — `turnKind`, `calls`,
`resolve`, `keyMoment`, `narrate`. Three more are needed to actually run a match: `createState`
(the sport's between-turn state has to come from somewhere), `isFinished` (basketball ends on the
clock, soccer on phases), and `applyKeyMoment` (T-5.5 has to fold an arcade result back in, and the
sketch's `// → SportEvent[]` comment does not say who does that). `apply` and `autoCall` are
optional, for T-5.7's assistant coach and T-5.8's CPU. The five from the spec keep their names and
signatures exactly.

**RNG forks by turn number, not from a running stream.** `fork('turn-3:resolve')` means a resolution
model that grows one more draw next month cannot shift the turn after it. There is a test that
proves it: two matches that differ only in whether turn 0 went to a key moment agree on turn 1.

**`playbook?` on `SportModule` is optional for the same stated reason `arcade?` is** — a sport
arrives in Live first, and soccer's Playbook (T-6.14) lands a phase after its Live rules do. The
comment on `arcade?` had already anticipated this; it now reads in the past tense.

### T-5.2

*Resolution model: ratings → matchup → outcome distribution → sampled `SportEvent` stream*

**The one decision that makes INV-11 achievable: the shot is Live's shot.** `shotProbability()` from
`shooting.ts` — the function the Live sim calls — is called with Playbook's circumstances. `09` §7
asks that "Playbook resolution, Live simulation, and arcade calibration all read the same derived
ratings"; the cheapest way to guarantee that is to read the same *model*, not merely the same
numbers. Playbook's job is therefore to decide the circumstances of a shot — zone, distance,
contest, movement, release — and hand them over. It shows in the first measurement: Playbook's
eFG% is 44.6% against Live's 44.8%, with nothing tuned to make that true. Two separate curves,
however carefully written, would have drifted the first time either was touched.

**What stands in for the release meter.** Live gets `release` from the player's timing. A Playbook
turn has no meter, so the athlete's execution stands in: rating sets the centre, composure narrows
the spread, and the draw is seeded. Anything flatter would make ratings matter *less* in Playbook
than in Live, which is exactly the failure INV-11 exists to catch.

**Draw order is fixed and named:** broken scheme → turnover → foul → shot → rebound, each from its
own labelled fork. Inserting a sixth stage later cannot shift the stages after it.

**Free throws are separate scores, not a lump sum.** `TurnResolution.scores` was added to the engine
seam for this: the box score reads `score.value` to tell a free throw from a field goal, so booking
a two-shot trip as one score of 2 would record a made two. This is the kind of thing that only shows
up three screens later in a stat total, so the seam carries it rather than each sport re-deriving it.

**The shot profile lives on the call.** A play *is* the shot it tends to produce, so `calls.ts`
carries the zone, the distance, the movement, the turnover and foul rates, the clock cost, and the
assist share. Resolution reads one table instead of switching on call ids, and a seventh play is a
row.

**Assists needed their own share.** The first batch booked an assist on 95% of makes, because every
made shot emitted a pass. `assisted` per call — Isolation 0.15, Motion 0.82 — brought it to 19.7 a
team, which is basketball. Worth remembering that this was invisible until the box score was built
off the Playbook stream; the model itself looked fine.

**Playbook is ~105 possessions a team, which is ~210 turns a match.** That is what `09` §2.2's
"each possession you choose a play" means once the clock is Live's clock, and it is why T-5.7's
auto-call and fast-forward are not optional polish.

**Deviation: the play catalogue landed here, not in T-5.4.** The model cannot be tuned without all
six offensive and five defensive calls existing, so `calls.ts` carries `09` §2.2's two tables in
full. T-5.4 is therefore the call-selection *UI* plus whatever metadata the sheet turns out to need.

**`autoCall` is uniform over the catalogue on purpose** until T-5.8. A placeholder that quietly
favoured one call would look like tuning and be mistaken for it, and T-5.8's regression harness
needs a flat baseline to measure a real CPU against.

### T-5.3

*Narration + animated court-diagram renderer for turn outcomes*

**The timeline is data; the drawing is separate.** `diagramAt(diagram, seconds)` is a pure function,
so every claim worth making about the animation — the pass line appears before the shot, markers
finish where they were sent and never overshoot, nothing is drawn before its beat, an over-run
clamps to the final frame — is a unit test with no canvas in it. `drawDiagram()` is the only part
that needs one, and it gets the recording double the renderer already had.

**Positions are field fractions, not metres.** A diagram is drawn into whatever rectangle the turn
screen has, and `10` §8.4 puts the court up top on a phone in portrait. The sport does not have to
know the size of the box and the box does not have to know the sport. Beats are fractions of the
diagram's own duration too, so T-5.7's turn-speed control is one multiplier rather than a rewrite.

**Reduced motion is a different picture, not a faster one.** `finalFrame()` renders where the
markers ended, the shot line drawn, the outcome shown. There is nothing to watch, which is the
point of `10` §6 — a shortened animation is still animation.

**The shape of a play is part of the play.** Each of `09` §2.2's six calls sends the five markers
somewhere different: Isolation clears out, Motion moves everyone, Post Up sends a body to the block,
Spot-Up spreads to the arc. A test asserts all six shapes are distinct. This is the reason the
diagram is worth animating at all — a player who has called Motion twice should recognise it a third
time without reading anything.

**Narration variety is a hash, not a draw.** A line is chosen from the turn number and the outcome,
so a replay says the same things in the same order, and narration consumes nothing from the match's
generator — it cannot shift a resolution by existing. A test asserts every outcome
`describeOutcome()` can produce has a line, enumerated from the function itself, so a new branch in
the model cannot ship silent.

**Deviation: `narrate` takes the state.** `09` §5's sketch writes `narrate(res)`, but the ids on a
resolution only mean something against a squad, and a line that cannot name the athlete it is about
is a status code rather than narration. `diagram(state, resolution)` is new and optional, on the
same reasoning as `arcade?` and `playbook?`.

**Feel note.** Honestly unknown. The pieces read correctly in tests and 5.5 seconds is the middle of
`09` §2.1's 4–8 s band, but whether a possession *feels* like 5.5 seconds is a question about a
thumb and a phone, and neither is available to this session. It is the first thing to check on a
device, and the first number I would expect to change.

### T-5.4

*Basketball play catalogue (offence + defence calls) and call-selection UI*

**The catalogue itself landed with T-5.2** — the resolution model cannot be tuned without all eleven
calls existing. What is here is the sheet: `10` §8.4's "three-to-six large cards along the bottom",
the opponent's last call, and the confirm-by-tap target picker.

**The sheet knows no sport.** It renders `CallOption`s and `PlaybookAthlete`s, both mode-layer
types. Basketball's catalogue is `09` §2.2's table and soccer's will be its intent controls; neither
is named in the component, and there is a test that mounts an invented soccer-shaped catalogue to
prove it.

**Radio semantics, not buttons.** A call sheet is one choice from a set, which is what a radio group
is — so roving focus, keyboard navigation, and the screen reader's "3 of 6" come from the platform
rather than being approximated. Selection shows as a border weight and an inset mark as well as a
colour (`10` §11).

**Two taps, never a sheet over a sheet.** A targeted call switches the same rectangle into its
target picker, with one back affordance. On a phone, a layer over a layer is where a mis-tap becomes
a call you did not make. `reset()` exists so a half-made choice cannot survive a force-resolved
turn.

**The cards take `--target-primary` (56 px), not the 44 px floor.** They are the primary target on
the screen and there are up to six of them in a grid; 44 px is the minimum for anything, not the
size for the thing the screen is *for*.

### T-5.5

*Key-moment detection → arcade invocation → result fed back into resolution*

**The second caller of the arcade seam, and the first outside the hub.** Everything goes through
`startRun(game, config)` in `modes/arcade/modes.ts`, so a modifier, a calibration rule, or a scoring
change applied in one place is applied here too. The seam held: no changes to `ArcadeGameDef`,
`ArcadeRun`, or `calibrate()` were needed to make Playbook a second consumer. `09` §5's third
consequence — "arcade games are reusable components" — is now demonstrated rather than asserted.

**`09` §2.4's five moments map one-to-one onto `09` §3.2's five games.** Wide-open three →
three-point, clutch free throw → free-throw, fast-break finish → fast-break, buzzer-beater →
buzzer-beater, steal opportunity → pickpocket. No new mini-games, and a test asserts every mapped id
exists in `BASKETBALL_ARCADE`.

**A key moment is unrewarded, and that is INV-12 talking.** The match already pays for the
possession through the event stream and `applyMatch`. Paying arcade coins on top would make
Playbook-with-key-moments the efficient farm, which `09` §7 forbids. The run is `practice`, whose
`isRewarded` is already `false`; the reason is stated once in `key-moment.ts` rather than
re-derived at each caller.

**The run's own events are thrown away.** The arcade session emits `SportEvent`s for T-4.10's
progression, describing the same possession the turn is about. Forwarding them would book the shot
twice. `applyKeyMoment` rebuilds the turn's stream instead, and a test asserts no committed turn
ever carries two field-goal attempts.

**Leverage is what makes the frequency setting mean something specific.** Each moment carries a
base, lifted by how late and how close the match is. On "Clutch only" a three in the first quarter
of a blowout never interrupts and the same three to tie it with twenty seconds left always does. A
garbage-time buzzer-beater stays at its base, which is the case worth getting right — it is the one
that would otherwise interrupt for nothing.

**A moment belongs to the player, not to the sim.** The steal is offered when the human is
*defending*; the other four when they are attacking; a CPU-vs-CPU match proposes nothing, because
there is nobody to play it. That last one is also why the balance harness and the parity batches
can ignore key moments entirely.

**Deviation: `keyMoment` takes the state.** Same reasoning as `narrate` — leverage is a function of
the score, the clock, and which side the human is on, none of which are on a `TurnResolution`.

**A missed key-moment shot keeps the board the sim gave out.** The player changed whether it went
in, not who was standing under the rim. Getting this wrong would have quietly deleted an offensive
rebound every time a moment was missed.

**Bug found writing the tests:** the first pass computed the sim's contribution to a free-throw trip
as `totalMade − 1`, which is wrong whenever the sim missed the first and made the second — the
player's make would silently eat the sim's. It now reads the drawn attempts in order and keeps the
results for attempts 2..n.

### T-5.6

*Expectation comparison ("the sim would have made it") + post-match reporting*

**The counterfactual is recorded, not reconstructed.** The first draft computed what the sim's shot
was worth by dividing `expectedPoints` by `successChance` — which is only correct if the turnover
term happens to be zero, and is guesswork dressed as arithmetic either way. `KeyMomentOutcome` now
carries `simPoints`, written by `settleKeyMoment()` at the only moment it is knowable: after the sim
drew and before the player touched it. The swing is `turn.points − simPoints` and nothing else.

**Expected points come from the model, not from the outcome.** Every `TurnResolution` already
carried the `TurnExpectation` its own resolution computed before drawing, so "you were unlucky" is a
claim with a number behind it rather than a consolation.

**The report knows no sport.** Calls are ids and outcomes are strings; it groups and counts. Soccer's
phases will produce the same shape with different words.

**A steal belongs to the side that made it.** Key moments are attributed by who took them, not by
who had the ball — otherwise every defensive moment would be credited to the opponent, which is
exactly the bug that would go unnoticed until someone read their own report.

**One copy bug, caught by a test that was wrong first.** `describeKeyMoments` said "the sim would
have gone exactly the same" whenever the tallies matched — including when the player made a three
the sim would have missed and missed a two it would have made. Same tally, different match. It now
requires the tallies *and* the points to agree.

**Honest before funny.** `09` §2.4 asks for "both honest and funny", and the funny half only works
if the honest half is unflinching, so the sentence names the number even when it is unkind: "That
cost you 5 points."

### T-5.7

*Auto-call assistant coach, fast-forward, turn-speed control*

**Speed is one multiplier on the diagram's own clock.** T-5.3 made the beats fractions of the
diagram's duration precisely so this could be a single number. Nothing in `pace.ts` touches
resolution: fast-forwarding changes how long you watch a possession, never what happened in it.

**Reduced motion is `instant`, not `fast`.** A quadruple-speed animation is still animation, and
`10` §6 is about people motion makes ill rather than people in a hurry. Asked for it, playback lands
on the final frame in one call — and a test asserts the picture is identical however it got there.

**The coach and the CPU are separate members.** `coach?` answers "what suits us" and stops;
`autoCall?` is T-5.8's opponent, which reads the other side. Keeping them apart means a toggle the
player leaves on cannot quietly out-think the opponent they are playing against — and it leaves
T-5.8's regression harness the flat `autoCall` baseline it needs.

**Auto-call always hands back for a key moment.** "For stretches" is the whole point of `09` §2.1's
toggle: the coach covers the possessions you do not care about, and the ones you do are still yours.

**Flat jitter did not work, and the failure is worth recording.** The first version added
`rng.float(0, 0.08)` to each score. On an even roster one call still won all forty times, because
the gap between the best call and the rest is roster-dependent — any fixed noise is invisible on one
roster and decisive on another. It now samples a softmax at 0.12 points-per-possession: a call a
tenth of a point worse gets picked about a third as often, one three tenths worse almost never.
Two hundred turns of the identical play is not a coach, and neither is a coin toss.

**The coach names a target.** A targeted call gets the athlete the play would have found anyway, so
auto-calling never produces a call the player could not have made themselves.
