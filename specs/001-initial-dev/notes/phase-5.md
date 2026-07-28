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
