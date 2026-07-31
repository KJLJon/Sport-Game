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
