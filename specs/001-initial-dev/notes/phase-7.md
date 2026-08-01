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
