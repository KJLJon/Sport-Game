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
