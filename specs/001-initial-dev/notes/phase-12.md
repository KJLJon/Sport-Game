# Phase 12 notes — Camera, framing, and readability

Long-form rationale for the Phase 12 task rows in [`../PROGRESS.md`](../PROGRESS.md). The
one-sentence version lives there; this is the part a future session needs only when it touches the
code.

**Why this phase ran out of order.** `03` schedules Phase 12 after v1.0 and lists it second in the
cut order. It was taken here, before Phase 8, because the user asked and because the argument was
good: the only thing blocking Gate 7 is the user *playing* the game, and the framing was the thing
that made playing it on a phone unpleasant. Every dependency was met — T-1.8 since Phase 1 — and
Phase 8 is untouched and still next.

---

## Task notes

### T-12.1

*Follow camera: lookahead, deadzone, and speed-scaled framing*

**The deadzone is the part that matters and the part that is invisible when it works.** A camera
with no deadzone converts every jitter of the ball into a translation of the entire world. That is
both nauseating and the main reason a following camera can read as *worse* than a static one, even
though it shows more. Inside the deadzone the world holds still and only the athletes move, which is
what the eye expects from a camera operator.

It is expressed as a fraction of the visible half-extent rather than as a distance in metres,
because it has to mean the same thing at every zoom the director picks. A deadzone in fixed metres
is most of a phone screen when tight on a duel and a pixel when wide on a set piece.

**The lead cap is a bug fix waiting to happen.** Lookahead is linear in speed, and a struck ball is
fast: at 0.35 s of lead a 25 m/s shot aims nearly nine metres past the ball, which on a phone puts
the ball itself off the bottom of the frame. The camera looks so far ahead that it loses the thing
it is following. The cap is on the lead's *magnitude*, not per axis — a per-axis clamp would let a
diagonal lead 1.41× further than a straight line, and there is a test for exactly that.

**The focus is a blend that gives up.** Ball and controlled athlete, weighted towards the ball, and
past `splitDistance` it commits to the ball entirely. The reason is that a midpoint between two
things thirty metres apart frames the empty grass between them — the worst of the three available
shots. Past that distance the athlete is found by the edge markers (T-12.3), which is what they are
for.

### T-12.2

*Dynamic zoom by phase of play*

**The phase is classified, not reported.** `duel` / `openPlay` / `counter` / `setPiece` are read out
of numbers any sport can produce — ball speed, distance from the ball to the nearest opponent,
whether play is stopped. The alternative, asking the sport "are we on a counter-attack", puts a
sport-shaped hole in the engine, and the second sport to answer it differently would make the camera
behave differently for no reason a player could see (INV-5).

Order matters in the classifier and both cases are load-bearing. A stoppage outranks everything,
because a stopped ball moving at speed is a ball being *placed*, not a counter. A duel outranks a
counter, because sprinting away from a defender still on your shoulder is a duel that happens to be
fast, and zooming out at exactly that moment loses the only detail that matters.

**Hysteresis is not polish.** Pressure crosses the duel radius several times a second when two
players run together. Without `phaseDwell` the zoom hunts, and a camera that re-frames on every
threshold crossing is unwatchable. A set piece is the deliberate exception — it begins and ends on a
rules event rather than a threshold, so it takes effect immediately in both directions, and waiting
out a dwell before widening for a free kick shows the player the wrong thing at the one moment they
have time to look at it.

**The real change in this task: `legibleSpan()`.** T-6.12 fixed the visible span at 45 m, which was
doing two jobs at once — it was the framing *and* the floor. That meant every span above 45 m was
unreachable: the camera could be *asked* to frame a set piece at 70 m and would silently be clamped
back, so the widest framing this phase adds could never actually happen. Worse, 45 m was measured
against one phone, so a tablet was framed as though it were that phone.

`legibleSpan(viewWidth, profile) = athleteSize × viewWidth / minAthletePixels` replaces the constant
with the question it was standing in for: how wide can this go before an athlete stops being a
shape. It is per-viewport, so a 360 px phone gets a *tighter* cap than the old constant gave it and
a 1200 px tablet gets a wider one, and every phase span becomes reachable on a screen big enough for
it. `zoomFloor()` kept its name and is now derived from it.

The constants: `athleteSize` 1.4 m (a drawn top-down athlete, not a physics radius) and
`minAthletePixels` 18. Eighteen is a judgement — comfortably above the "about three pixels" the user
reported, and about a third of a 44 px touch target. It has not been checked on a phone.

### T-12.3

*Off-screen awareness*

**What was here before pointed at the wrong half of the problem.** T-2.10's `offScreenIndicators`
showed *teammates only* — never an opponent, never the ball. That was defensible while the camera
fitted the whole field and the arrows were for a teammate at the far end. With a following camera
the ball is the thing that leaves the frame, and it had no arrow at all: a ball you cannot find is a
game you cannot play.

**Four kinds, four silhouettes, in priority order:** the ball (a disc with a tail — the only round
marker, because it is the thing you look for rather than scan for), your own athlete (a hollow ring,
hollow because it is not urgent — it is where you left it), the nearest opponents (an open chevron),
then the nearest teammates (the solid triangle this file inherited). Shape rather than colour is
INV-11 with a specific reason here: a player who cannot distinguish the two kits is exactly the
player who needs to know which of these is chasing them.

**Capped at two opponents and three teammates.** A screen edged with eleven arrows conveys less than
one edged with three. The cap is why the priority order exists at all.

**Distance is in world units, measured from the athlete you control.** The old type documented
`distance` as "world units" and computed a *screen*-space hypotenuse, which nothing read, so nothing
noticed. Only the ball and your own athlete are labelled with it: six numbers to read while both
thumbs are busy is none of them read.

### T-12.4

*Minimap rework*

**The minimap only earns its space now.** While the camera fitted the field it was a smaller copy of
what was already on screen. It is now the only place the far end of the pitch exists.

Three additions. **The viewport box** is the important one — without it the map says where everyone
is but not where *you are looking*, and those became different questions the moment the camera
stopped fitting the field. **Tap-to-look** turns a diagram into a control; it is implemented as
`CameraDirector.peek()`, which holds the requested point for ~1.6 s and then pans back, because the
play has moved on while the player was looking away and a cut back would be the thing T-12.5
forbids. **A 44 px floor and the field's own aspect ratio.**

That last one was a bug. `hudLayout` sized the minimap at `(width * 15) / 28` — a basketball court's
proportions — in a file whose own header says it "never sees a `World`, a `RulesState`, or the word
basketball". A 105 × 68 pitch was being drawn squashed into a 28 × 15 box. `layout.minimap` now
reserves an *area* and `minimapFrame()` shapes it to whatever the field is, anchored to the bottom
of the reserved area so a tall field grows upward into the screen rather than downward through the
safe-area inset.

### T-12.5

*Camera handoff*

**Where the cut actually happens.** `snap()` was written with this file's rule in its docstring —
"the single place a cut is correct is a period boundary" — and for a while had **no caller at all**,
which made the rule aspirational and left two smaller things wrong. A match opened by easing in from
the widest zoom the floor allows rather than starting framed on the kickoff, and half-time panned
the camera the length of the pitch as though the restart were live play. `screen.ts` now cuts on the
first frame and on every `period.start`.

It is a flag read on the next frame rather than a `snap()` inside the event handler: `period.start`
is emitted *during* a step and the sport repositions everyone for the restart after it, so snapping
in the handler would cut to where the players were a moment earlier.

The ball teleports several times a match: a throw-in, a kickoff after a goal, a jump ball. The sim
is right to teleport it and the camera must not follow suit. Anything that moves the focus further
than `jumpDistance` (12 m — more than anything can travel under its own power in a frame, less than
any restart) starts a handoff: the deadzone collapses so the camera re-centres, and the follow rate
is raised so it crosses the distance briskly and is still *seen* to cross it.

A dead ball may be reached faster than a live one. Nobody is watching the pitch during a throw-in,
they are waiting for it; mid-action the pan **is** the information.

A possession change starts a handoff even without a jump, which is the subtler half. The frame's
*meaning* changes when the ball changes side, and a camera that keeps drifting as if nothing
happened leaves the player to work out for themselves that they are now defending.

The one place a cut is correct is a period boundary, and that is `snap()` — a call, not a threshold.

### T-12.6

*Per-sport camera profiles through the seam*

`SportModule.camera` takes a `PartialCameraProfile`; anything a sport does not mention comes from
`DEFAULT_CAMERA_PROFILE`. Nothing in `engine/render` or `modes/live` names a sport, which is the
whole point — and `screen.ts` has been careful about this since T-6.12, whose note says a sport id
in that file "would be the first thing T-12.6 had to remove". There was none to remove.

**The two profiles, and why they differ.** Soccer widens the counter span to 64 m and drops
`counterSpeed` to 9.5 so a *clearance* reads as a counter, not only a shot — a pitch is the one
field where twelve seconds of open grass ahead is a distinct thing that needs to be seen coming.
Basketball tightens `duelRadius` to 2.4 m, because at soccer's 5 m every possession on a 28 m court
would read as a duel, and gives the duel an 18 m span while leaving every other phase clamped to the
court. That last number is the only real behaviour change for basketball and it is a guess: an
isolation at the top of the key is the one moment in that sport where the other eight players are
not the information. **It has not been played.** If basketball feels worse than it did, this is the
line to revert.

### T-12.7

*Reduced motion and accessibility*

**Three levels, not a checkbox, and the third one is deliberately bad.** Global reduced motion is a
blunt yes/no, and here "no motion" has a real cost: with the camera fixed, a 105 × 68 pitch is the
three-pixel athlete this entire phase exists to fix. So:

- `full` — lookahead, dynamic zoom, handoff pans, shake.
- `reduced` — still follows, at one fixed zoom, wide deadzone, no lookahead, no zoom changes, no
  shake. This is what global reduced motion selects, so somebody who set the OS preference gets a
  calm camera without ever opening Settings.
- `fixed` — does not move at all. The whole field, always, athletes as dots.

`fixed` is worse to play and it is nobody's business but the player's whether they want it. An
accessibility setting that stops short of the option somebody actually needs is not one.

**It is in the pause menu.** Whether a camera makes you unwell is not something you discover on a
settings screen — it is something you discover ninety seconds into a match, and the fix has to be
reachable from there without losing the game you are in the middle of. It writes through to the same
preference an app-wide Settings screen will read when T-9.5 builds one.

**`app/motion.ts` is new and is a merge, not an addition.** `modes/arcade/accessibility.ts` had
owned the reduced-motion resolution rule since T-4.12. Once the camera needed the same answer, two
implementations would have been two chances to disagree. Arcade re-exports it, so no arcade import
changed.

**Tap-to-look is exempt.** A peek is the one camera movement the player asked for directly. A
setting that exists to stop the camera moving *on its own* must not disable the control that moves
it deliberately.

### T-12.8

*Culling and LOD against a moving viewport*

Deferred here from T-6.11, and that deferral was correct: with a camera that fitted the whole field
the viewport never excluded anything, so there was nothing to cull.

The find while implementing it: `Detail.FULL` / `REDUCED` / `MINIMAL` have been honoured by both
sports' art since Phase 2, and **nothing had ever passed anything but `FULL`**. The tiers were
written, tested, and dead.

**The engine owns the policy, the sport owns the drawing.** `Renderer.lodFor(view)` returns an
`EntityLod` that answers "draw this, and how much of it" per entity; `null` means off-screen. The
sport asks it, because only the sport knows which athlete is a goalkeeper and what a goalkeeper
looks like (T-6.16) — but *what is on screen and how much detail it deserves* is a question about
the camera, and two sports answering it separately would be two sports answering it differently.

Calling `detail()` also records the decision, which is what makes the debug overlay's LOD line a
measurement rather than a guess.

The athlete you are controlling is always drawn at full detail regardless of distance: losing detail
on your own body is losing the thing the frame is about.

### T-12.9

*Device pass*

**Half of this task cannot be done by a session, and the half that can is done.**

Automated: `tests/e2e/camera-framing.spec.ts` runs a soccer match at 360 × 640 and 640 × 360 — the
smallest phone in `12` §7, both orientations — and asserts the canvas fills the viewport, the page
does not scroll, consecutive frames differ (so the camera is following rather than sitting on a
fitted pitch), and a tap on the minimap moves the camera and brings it back. Basketball is checked
in the same run so the seam is exercised by two fields. 51 E2E pass.

Not automated, and not claimed:

- **Whether it is comfortable.** Legible and watchable are different properties and only one of them
  is a measurement.
- **≥55 fps at 11v11 with the camera moving**, from Gate 12. `pnpm bench` measures the *sim* (0.094
  ms mean, 0.39 ms worst for soccer at 23 entities, against a 4 ms budget), and the sim was never
  the thing at risk. Frame time with a moving camera, a redrawn static layer, and the new markers is
  a render measurement on real hardware.
- **One-handed reach**, which is a fact about a hand.
- **Whether the basketball duel span (18 m) is an improvement or a regression.**

`legibleSpan` says an athlete on a 360 px phone is drawn 18 px across where the old fixed 45 m span
gave 11 px. That is arithmetic, and arithmetic is not a device pass.

---

## Gate record

**Gate 12 — evaluated 2026-08-03. Result: NOT PASSED.**

Every automatable check is green. What is missing is the same two things that have blocked every
gate since Gate 2 — the device matrix and a tagged deploy — plus, specific to this gate, a criterion
that is a *render* measurement on real hardware and one that is a claim about comfort. For a phase
whose entire subject is how a phone looks, the fraction that a session can close is smaller here
than at any previous gate, and that should be read as a statement about this gate rather than about
the code.

### 1. Every task done or cut

**9 of 9 `done`, none cut.** T-12.9's row is `done` with `Verified: auto — not device`, which is the
honest reading: the assertions a headless browser can make are made and passing, and the assertions
that need a hand holding a phone are listed below rather than signed off.

### 2. Full suite green

| Check | Result |
|---|---|
| `pnpm verify` (typecheck · lint · unit) | **177 files, 3 151 tests, green** |
| `pnpm e2e` | **51 passed**, including six new framing cases at 360 × 640 and 640 × 360 |
| `pnpm bench` | soccer 11v11 (23 entities) **0.094 ms mean, 0.39 ms worst** against a 4 ms budget |
| `pnpm build && pnpm budget` | initial JS **70.8 KB gzip / 200 KB**; install **544.5 KB / 6 MB** |
| `pnpm trace` · `pnpm api` · `pnpm progress:check` | regenerated and clean — 229 modules, 112 tasks |

**One fragility was found and fixed during the gate run, and it is worth recording because it hid a
gate check rather than a bug.** `tests/invariants/inv-11-cross-mode-parity.test.ts` plays hundreds of
whole matches: about 2.5 minutes for the file under `pnpm test`, roughly double under V8 coverage
instrumentation. Its 120 s per-test budgets cleared the first comfortably and the second by nothing,
so `pnpm test:coverage` failed intermittently — and **Vitest writes no coverage report at all for a
failed run**, so the coverage gate could not be evaluated because of a timeout that had nothing to do
with coverage. The budgets are now 300 s. Gate 7 fixed the same class of problem the same way in
`tests/sim/ai-ladder.test.ts`. Nothing in this phase made anything slower: every file it touches is
render-side, and that harness is headless.

### 3. Coverage thresholds (`12` §2)

Hold, against an 85% floor overall and 80% branches:

| | % |
|---|---|
| Statements / lines | **94.91%** (28 436 / 29 960) |
| Branches | **92.05%** (7 727 / 8 394) |
| Functions | **93.86%** (1 989 / 2 119) |

The per-directory floors are enforced in `vitest.config.ts` and the run passed, so `athletes`,
`economy`, `achievements` and `storage` are all above their 95%. Every module this phase added is at
**100% lines**; the lowest branch coverage among them is `framing.ts` at 80%, which is the default
arms of the optional-profile merge.

`modes/live/framing.ts` sat at 7.7% lines when the gate first ran — exercised only through the
screen, never directly. It is the bridge between a running match and the camera, and a `pressure`
that counted the wrong side would have made the camera frame duels that were not happening with
nothing failing. It now has its own tests and is at 100%.

### 4. Invariants (`12` §3)

None regressed, and two were *tightened* by accident of the work:

- **INV-5** — two sport-specific constants were found hiding in sport-generic code and removed. The
  minimap's aspect ratio was a hardcoded basketball court in `hud.ts`, a file whose header claims
  never to have heard of basketball. Framing is now supplied by the sport through the seam.
- **INV-11** — the four edge-marker kinds are distinguished by *silhouette*, with a test asserting
  that no two kinds emit the same sequence of path calls; the minimap keeps a 44 px floor on both
  axes.
- **INV-8** remains true by construction: nothing in `engine/render` is read by the sim, and the
  director advances on frame time.

### 5. Device matrix (`12` §7)

**Not run.** No device. Unchanged since Gate 2, now seven gates deep — and for this phase it is not
a formality. Phase 12 is *about* what a phone looks like.

### 6. Gate 12's own criteria (`03`)

> *An athlete is legible on a 360 px-wide phone without pinch-zoom; the player can always tell where
> the ball and the nearest opponent are, on screen or off; ≥55 fps holds at 11v11 with the camera
> moving; and every camera motion has an off switch.*

| Criterion | Result |
|---|---|
| The ball and the nearest opponent are always findable | **Met.** T-12.3 gives the ball, your athlete, and the nearest opponents their own markers, each a distinct silhouette, and T-12.4's minimap carries the rest with a viewport box. Both are unit-tested. |
| Every camera motion has an off switch | **Met.** T-12.7's three levels, reachable mid-match from the pause menu, including a `fixed` camera that does not move at all. |
| An athlete is legible on a 360 px phone | **Arithmetically met, not seen.** `legibleSpan` puts an athlete at 18 px on a 360 px viewport where the old fixed 45 m span gave about 11. That is a calculation, and legibility is a thing eyes do. |
| ≥55 fps at 11v11 with the camera moving | **Not measured.** `pnpm bench` measures the *sim*, and the sim was never the risk — 0.094 ms of a 16.7 ms frame. Frame time with a moving camera, a redrawn static layer, and the new markers is a render measurement on real hardware. |

### 7. Tag and deploy

**Not done, and this is the user's to do.** The work is on `claude/phase-12-next-steps-xeminm`
behind draft PR #17. `deploy.yml` fires on `push: tags: ['v*']` and `workflow_dispatch`, and neither
is reachable from a sandboxed session — the git proxy refuses tag pushes and the GitHub App has no
`actions: write`. **A tag is the only way to ship**, so nothing in this phase can be seen on a phone
until PR #17 is merged and a tag is pushed.

### 8. What a session cannot close here

Beyond the two criteria above:

- **Whether the framing is comfortable.** Legible and watchable are different properties.
- **Whether basketball's 18 m duel span is an improvement.** It is a guess: an isolation is the one
  moment in that sport where the other eight players are not the information. If basketball feels
  worse than it did, that line in `sports/basketball/index.ts` is the revert.
- **One-handed reach**, which is a fact about a hand.
- **The feel note for the phase**, which cannot honestly be written by something that has not
  played it.
