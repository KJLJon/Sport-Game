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
