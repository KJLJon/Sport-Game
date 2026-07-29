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
