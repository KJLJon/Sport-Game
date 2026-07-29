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
