# Phase 8 notes — Modes hub, progression, achievements, economy

Long-form rationale for the Phase 8 task rows in [`../PROGRESS.md`](../PROGRESS.md). The
one-sentence version lives there; this is the part a future session needs only when it touches the
code.

---

## Task notes

### T-8.1

*Home screen, mode selector, Quick Play (two taps from cold launch)*

**Taken out of order, at the user's request, because the shipped game could not be played.** Phase 6
was mid-flight with T-6.21 next. The user opened `https://kjljon.github.io/Sport-Game/`, tapped
Play, and got "Arrives in Phase 2" — so they reported both that they could not start a game and that
the deployment pipeline looked broken. The pipeline was fine: `Deploy` run #4 shipped `v0.5.0` from
`main` on 2026-07-30 and succeeded, and every mode was present in that build. What was missing was
any way to *reach* them. `#/play` was still the Phase-0 `stub()` placeholder, and Live, Playbook and
the arcade were only ever entered by typing a hash by hand.

This is worth writing down because of how it survived six phase gates. Each phase verified its own
mode through its own deep link — `live-match.spec.ts` goes to `#/play/live/basketball`,
`soccer-match.spec.ts` to `#/play/live/soccer`, and the Playbook and arcade suites mount their
screens directly. Every one of those passed. None of them started where a player starts, so the
question "can you get here from the home screen" was never asked by anything. `12` §7's manual
device matrix should have caught it and evidently was run the same way — from a deep link.
`tests/e2e/play-hub.spec.ts` exists to ask that question from now on, and its first test is
literally two taps from a cold launch.

**Availability is declared, not derived.** `src/modes/catalogue.ts` lists which sports each mode can
currently start. The tempting alternative — read `SportModule.arcade` and `.playbook` — is wrong
right now: soccer has a complete `PlaybookAdapter` (T-6.19, T-6.20) and no Playbook *screen*, since
`playbook-match.ts` still imports `basketball` and `basketballSquads` by name. Deriving from the
module would have put a soccer Playbook card on the hub that dead-ends. When T-6.21 makes that
screen sport-aware, the fix is one entry in the catalogue and the `pending` line goes away.

**A mode a sport cannot start is shown, not hidden.** `10` §10 asks for honest states, and a card
that quietly disappears is indistinguishable from a broken install to someone who has read that the
game has three modes. So the card renders unselectable with a sentence saying what is missing.

**The home button changes shape.** `10` §8.2 wants one tap from cold launch into your last match;
`10` §8.1 wants a first launch that asks which sport and which mode before starting anything. Those
are different buttons, so there are two: nothing remembered means the primary action is the picker,
and something remembered means it is that match, named in full (`Quick Play · Live Soccer`) so a
one-tap launch is never a surprise. `09` §1's "remembered per sport" is taken literally —
`last-played.ts` stores the last sport *and* a last mode keyed by sport, because a player whose
soccer is Live and whose basketball is Arcade should get both back.

#### Two real bugs the verification found

Both were pre-existing, and both are the same species as the one above: something that worked when
you arrived by URL and not when you arrived by tapping.

1. **Starting a Playbook match landed on Not Found.** `playbook.ts` called
   ``navigate(`#/play/playbook/match?${setupQuery(choice)}`)``, but `Router.navigate(path, query)`
   builds and escapes the hash itself — so the whole string was percent-encoded into one
   unmatchable segment (`#/%23/play/playbook/match%3Fdifficulty%3Dpro…`). Every Playbook match
   since T-5.10 has 404'd. `setupQuery` (a string) is now `setupParams` (a record), which removes
   the shape that invited the mistake.

   It survived because the unit test's `navigate` stub was `(to: string) => navigated.push(to)` —
   it dropped the second argument, so it asserted a string the app never navigated to. The stub now
   records `buildHash(to, params)`, and the assertions resolve that hash back through `ROUTES`.

2. **The sport radios floated over the page heading.** `position: absolute` with no positioned
   ancestor; the invisible inputs landed on top of the legend and swallowed taps meant for it. Found
   by driving the real build in Chromium, not by any test — a jsdom `.click()` on the input never
   reproduces it. `.play-sports` is now `position: relative`, and the inputs use the
   `opacity: 0; pointer-events: none` idiom `.segmented__input` already established.

**Verified** on the real static build under `/Sport-Game/`, driven in Chromium at 390×844 and
900×460: home → hub → Live basketball, Live soccer, Playbook (through setup, into a call sheet with
athlete targeting), and an arcade run (`bball.free-throw`, scored). No console errors on any path.
Quitting a Live match now lands on the hub rather than on the placeholder, which is what
`onQuit: () => context.navigate('/play')` always intended.

**Feel note:** the game finally introduces itself. Two taps from a cold launch to a soccer match is
the first time the thing has behaved like a product rather than a set of routes, and the honest
"Soccer coaching is still being built" on the Playbook card reads much better than the mode simply
not being there — you can see the shape of what is coming. The mode blurbs are doing real work: "One
thumb, no reflexes needed. The easiest way in." is the sentence that would actually get a
seven-year-old to pick Playbook over Live.

### T-8.2

*Match setup screens for Live and Playbook*

**Two things were already built and simply not connected, and finding them was most of the task.**

1. **Live matches never used your athletes.** `MatchOptions.rosters` had existed since T-3.17 and
   `liveScreen` had no parameter to pass it, so every Live match was played by athletes rolled from
   the seed while the player's squad sat in IndexedDB. Playbook used the real roster. Nothing looked
   broken from the outside because both modes produced a plausible match — they were just playing
   different games. INV-11's cross-mode parity harness could not see it either: it passes rosters to
   both modes explicitly, which is exactly the path Live's screen did not have.
2. **`generateCpuTeam` had no caller.** T-7.9 built a named opponent with a crest, a kit, and a
   playing style, tested it, and nothing a player could reach ever invoked it. `resolveRosters` is
   its first caller, and `CpuStyle.blurb`'s own comment — "for the pre-match screen when there is
   one" — turned out to be describing this screen.

**The spec conflict, and why the resolution is the better design anyway.** T-8.2 asks for a setup
screen. `10` §2 promises "two taps to play" and T-8.1's gate criterion is *two taps from a cold
launch reach a live match*. The first implementation put the screen in front of the Live card and
three E2E tests immediately said so. The card still plays, and **"Set up a match" is a second,
smaller target beneath it** — the fast path is untouched and configuring costs one extra tap. That
is also the order `10` §8.1 describes, so the conflict was in the implementation rather than in the
spec.

**Rule switches are a bag the sport reads, not a branch the engine takes.** `RuleOptions` is
`{ fouls, offside }`; a sport reads the ones it implements and ignores the rest, and declares which
it honours through `SportModule.ruleSwitches` so the setup screen can offer a switch for offside to
soccer and not to basketball without knowing which is which. The first draft *did* have a
`{ soccer: true }` map in the screen — a sport id in mode code, which is precisely what INV-5
forbids — and the seam capability replaced it.

There are three foul sites in basketball and two rule sites in soccer, and each degrades to the
sensible non-call: a reach-in becomes a failed steal, a tackle becomes a failed tackle, and a
shooting foul leaves the shot standing as it fell with no free throws. `tests/unit/modes/
rule-options.test.ts` asserts the simulation actually changes, with the fouls-on case as a control
so "no fouls when off" cannot pass for the wrong reason.

**Deliberately not shipped: an injuries toggle**, which `US-10.2` names. Nothing in either sport
injures anybody during a match — `athletes/condition.ts` models injury as an *availability* state a
match reads and never writes — so the switch would control nothing. It arrives when in-match
injuries do.

**Deliberately not shipped: rules toggles in Playbook.** Playbook gained the shared match-length
control, so "Short" means the same thing in both modes. It did not gain the rule switches because
soccer's Playbook adapter has no foul model at all — its own header says so — and a switch that does
something in one sport and nothing in another, in one mode and not the other, is the half-working
control this codebase keeps deciding is worse than none.

**A CSS lesson worth writing down.** The first version of `match-setup.css` used invented token
names (`--color-text-dim`, `--space-3`, `--radius-md`) each with a hardcoded fallback. Every one was
unresolved, and because the fallbacks were dark-theme values nothing looked wrong — until the axe
sweep hit the light theme and found the "dim" fallback rendering near-white on near-white at 1.04:1.
**A fallback on a design token is a spelling mistake that renders.** The real names are `--text-lo`,
`--space-12`, `--radius-12`, and they are now used without fallbacks so the next typo fails loudly.
