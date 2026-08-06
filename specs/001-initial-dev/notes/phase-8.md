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

### T-8.4

*Match checkpointing and resume-after-kill*

**The decision this task turns on: a checkpoint is not a snapshot.**

It cannot be, without a seam change that does not belong here. `SportState` is opaque to the engine
by design — that opacity *is* the sport seam (INV-5) — so serialising a live match would mean every
sport growing a `serialize`/`restore` pair and every future sport owing one before it could be
played. That is a decision about the seam, made once, against the sport that actually needs it.

So what is stored is the match's **public state**: the setup that started it, the score, the period,
and how far the clock had run. Resuming replays the setup and puts the scoreboard back.

- **Survives:** sport, mode, team, opponent, difficulty, length, rules, score, period, clock.
- **Does not:** positions, possession, the box score, team fouls, stamina.

The home card says that in words — "Picks up at that score and clock. Positions and the box score
start fresh." — rather than implying a perfect restore. For the case `US-10.3` names, it is most of
what was wanted: a phone that died with two minutes left in a close game gives back a close game
with two minutes left. `LiveMatch` starts with an empty box score in that case and does not
fabricate a plausible one, because a plausible box score is a lie told in numbers.

**Resuming is navigation, and that is what makes it work in every mode.** A checkpoint stores an
href; the home screen appends `?resume=42-38:3:1200` and follows it. Nothing about checkpointing
knows how a mode starts a match. This only became possible because T-8.2 made a setup a link — the
two tasks landed in the right order by luck rather than by planning.

**Two writes, because there are two different failures.** A ten-second timer and a
`visibilitychange`. Backgrounding is the one the browser warns you about; a kill — the case the
story actually names — gives no warning at all, and the timer is the only thing that survives it.
Both writes swallow their errors: a full or denied database must never interrupt a match in
progress. A resume that is not offered is a smaller failure than a match that stops.

**Arcade is deliberately not resumable, and this is the one place "all three modes" is answered
with a no.** Two reasons, the second decisive:

1. A run is about a minute long, so "resume" means dropping the player back mid-swing at a timing
   game — the worst possible moment to hand control over.
2. A *scored* run resumed from persisted numbers is **a score you can edit**. Arcade personal bests
   (T-4.4) are a record; restoring `score` from IndexedDB would make every one of them writable from
   a devtools console.

So an arcade run is checkpointed — the game you were playing is remembered and offered — and the
button says "Play again", because that is what it does.

**A checkpoint from an older build is discarded, not migrated.** It is the only persisted record
where that is the right answer: it describes a match at most one session old, and a wrong resume is
worse than no resume. `isCurrentCheckpoint` is deliberately strict about every field it will later
read, because this is the one record written by a previous *version* of the app and read by this one
with no migration in between.

**One clamp worth knowing about.** T-8.2 lets a player change match length between sessions, so a
`periodStep` recorded in a full match can exceed a short period. Unclamped, the resumed period would
start already expired and end on its first step.

### T-8.5

*Stats store: match history, box scores, career stats*

**This is the task where INV-9 stopped being a rule and became a saving.** Live steps a simulation
sixty times a second; Playbook resolves a turn at a time. Both push the same `SportEvent`s onto the
same bus, so both arrive at `buildRecord` as an array of events and a final score, and it never asks
which mode produced them. `mode` is stored so a row can *say* how a match was played and so a career
can be filtered — never so that stats are computed differently. There is a test asserting the two
modes produce byte-identical lines from an identical stream, because the failure it guards against
is one nobody would notice: a Playbook assist counted by a slightly different rule, discovered
months later in numbers nobody can attribute.

**`SportModule.lineup()` is a new seam member and a small one.** Both shipped sports already kept an
entity → athlete-id map — they need it to give an entity real ratings — and nothing outside the sport
could read it. So a box score could be built and never attached to anybody, which makes career stats
impossible. Progression's `applyMatch` has been asking *its* caller for exactly this mapping since
Phase 3, so the join was already assumed to exist; this is the first thing to expose it.

It is optional, and a sport that returns nothing records its box score with `athleteId: null`. Those
lines are then **skipped** by `buildCareers` rather than pooled under a placeholder id — an "unknown
athlete" whose career grew with every rosterless harness run would make the whole screen
untrustworthy.

**Careers are per sport, deliberately.** `05` §3 makes ratings per sport, so a career total that
mixed basketball and soccer would be answering a question nobody asks. `byMode` sits alongside the
total rather than replacing it: "how do I do in Playbook" is a real question and it is a *filter* on
one set of numbers, not a second set.

**A win is counted only for the side the player was on.** The opponent's athletes have real lines in
every record, and crediting them with a result would record the player's own outcome twice — once as
a win for them and once as a loss for the CPU, in a table that is supposed to be about the player's
squad.

**History is capped at 500 matches.** A record is small, but a store nothing prunes grows for as long
as the app is installed, on a device whose quota is not ours. The honest cost is that a pruned match
leaves a career line slightly short; 500 is about a year of daily play.

**The Progress tab was a placeholder and is now a screen.** Two tables, each scrolling inside its own
box because a career table has eight columns and a 360 px phone has room for four. Results are the
*words* "Won"/"Lost"/"Drew" rather than a coloured row (INV-11), and both tables carry real row and
column headers so a screen reader can navigate them as the tabular data they are.

### T-8.11

*Procedural athlete generator*

**The gap was shape, not spread.** `rollAthlete` has existed since T-3.2 and it draws every attribute
from *one* gaussian around the rarity band's mean. That is a perfectly correct spread and it produces
athletes with no identity: eleven of them are eleven slightly different blobs, all mediocre at
everything, none of them anybody. A pack you open to find another blob is a pack not worth opening.

**Seven archetypes**, each wanting a distinct pair of attributes and carrying a body bias to match —
a Sprinter is light and a little short, an Anchor is tall and heavy and slow. No two want the same
pair and every attribute is wanted by somebody, the same rule `CPU_STYLES` follows and for the same
reason: an archetype nobody can distinguish is not one.

**Coherence rises with rarity, and that is the whole design.** Rarity decides *how many* points an
athlete has; the archetype decides *where they sit*; coherence decides how hard the archetype pulls.
So a Legendary is not merely higher-total — it is more **pointed**, clearly the best sprinter you own
rather than uniformly slightly better at everything. That is what makes a good pull feel different
rather than only score higher.

**INV-1 is the thing to be careful about here**, and it has the strictest test in the file: for every
rarity, across 25 seeds each, a generated athlete's attribute total is *exactly* the total the rarity
roll produced. `shapeToward` moves points and never mints them. It would be very easy — and
completely invisible from the outside — for shaping to leak a few points, at which point rarity would
stop being the only thing that decides how good somebody is.

**`shapeToward` moved from `teams/cpu-team.ts` to `athletes/shape.ts`.** It was written for T-7.9 to
shape an opponent to a team style; a pack rolling an archetype wants exactly the same operation, and
a copy in `athletes/` would have been two implementations of the one function INV-1 rests on.
`cpu-team.ts` re-exports it so nothing that imported it from there had to change.

**Names had been written twice and were about to be written a third time.** `starter-roster.ts` kept
a private pair of pools and `cpu-team.ts` kept place-and-nickname lists for teams. `athletes/names.ts`
is the athlete half, extracted and widened — three name generators would have drifted into three
different-sounding worlds. Every name is invented: `US-9.2` asks for fictional ones, and the reason
is not squeamishness but that a roster reading like a licensed one invites exactly the comparison it
should not.

**It has a caller, deliberately.** This phase has already turned up three things built and never
connected — `generateCpuTeam`, `CameraDirector.snap`, the LOD tiers — so the generator was not left
waiting for T-8.12's packs. CPU squads were named "Kestrel 1" through "Kestrel 11", which is a list
rather than a team sheet; they now draw from the shared pools. Names come from their own RNG fork, so
the name draws cannot shift the attribute draws and **every existing seed still produces exactly the
athletes it did** — the balance harnesses' numbers are untouched.

### T-8.15

*Local player names and party flows*

**The model was finished; the flows were not.** `modes/local-players.ts` has stored, seated, renamed
and forgotten local players since T-4.11. Two things were missing, and both were about reach rather
than about code:

1. **Playbook could never name its hot-seat opponent.** The only name fields in the app were on the
   arcade hub, so a Playbook hot-seat player was "Player 2" for as long as they never opened Arcade
   — which is precisely the "rather than Player 2" `US-17.3` is named for.
2. **`forgetPlayers()` had no caller.** A name typed once could not be taken back out of the app.
   That is the "editable or removable **at any time**" half of the story, and it is not a nicety: a
   name somebody entered about a person who no longer plays, with nowhere to remove it, is a small
   thing on entirely the wrong side of the line this project keeps.

So: `ui/components/party.ts` holds the seat rows, used by Arcade (whose inline copy it replaced),
Playbook's setup, and a new **Settings → People** screen that can remove the lot. Three copies of one
control would have been three chances for them to save differently.

**A name saves as it is typed.** There is no Save button because there is no moment a player would
press one — they type a name and start a match, and a name lost between those two actions is the
whole feature failing quietly.

**Opening the People screen does not create people.** The seats are defaulted for display, and
nothing is written unless a name is edited or something was already stored. A screen that recorded
four players because somebody looked at it would be inventing a party.

**Where the names are, said out loud.** `US-17.3` promises local-only, and they live in preferences
rather than IndexedDB — not in a backup, not in a roster export, not in a P2P handshake. The screen
says that in a sentence, because a promise nobody can see is indistinguishable from one nobody kept.

---

### T-8.10

*Wallet, coin ledger, earning rules, difficulty scaling, itemised post-match payout*

**Taken before T-8.3, which is lower-numbered.** T-8.3's own line ends in "results, **rewards**", and
a tournament that pays 1 500 coins into a wallet that does not exist would have to be built twice.
The economy is also the Gate 8 spine — T-8.10 → T-8.12 → T-8.13 → T-8.14 → T-8.16 — so it goes first
and tournaments get a real payout when they land.

**A payout is a pure function of a `MatchRecord`.** That one decision does most of the work.
`buildRecord` (T-8.5) already turns either mode's event stream into the same record, so `matchPayout`
takes the record and nothing else: no mode, no simulation, no clock. INV-6 is not upheld here by
discipline — there is nowhere for a mode to be branched on, because a mode is not an argument. The
invariant test asserts the consequence: the same record with `mode` swapped pays identically.

**Performance milestones are relative, not absolute.** `05` §5.3 asks for "performance milestones,
25–150 each, capped". Every milestone that comes to mind is basketball's — 20 points, a
double-double — and a soccer match would never pay one. Branching on the sport would put a rule about
basketball inside the economy, so instead each milestone reads a *ratio*: a share of the team's
scoring, a margin as a fraction of the score, a turnover count against the opponent's. A 2–0 soccer
win and a 100–80 basketball win both earn "Dominant win", and hockey gets the whole table for free.

**Milestones read the scoreline, not the box score, for anything about the result.** The two can
differ — an anonymous fixture records no lines at all, an own goal belongs to nobody's line — and a
shutout awarded because the box score happened to be empty is a bug a test found within the hour.

**Multipliers scale performance; the daily bonus does not.** `05` §5.3 lists the difficulty
multiplier, the no-assist bonus and the flat awards in one table without saying what multiplies what.
Both multipliers scale what you did — completion, the win, the milestones — and the
first-win-of-the-day 250 is added flat afterwards. Scaling it too would make the first Legend win of
the day worth 500 on its own, turning a "come back tomorrow" nudge into the biggest number on the
screen.

**Every multiplier line carries the coins it added, computed against the running total.** So the
lines always sum to the headline, whatever the rounding does. A player who adds up the post-match
screen and gets a different number stops trusting the screen; there is a test per difficulty level.

**First-win-of-the-day is settled with the credit, not before it.** It is a fact about the wallet's
history rather than about the match — has today already paid one — so `settleMatch` decides it and
marks it in the same pure step, and the repository serialises the whole thing. Two matches finishing
in the same second cannot both be "the first". A loss or a draw does not consume it either: an
unlucky evening should not cost tomorrow morning's 250.

**The repository queues every write.** A wallet is read-modify-write by nature, both match screens
credit from a `.then()` on the shared database promise, and an arcade run can settle while a match is
still writing. Without a queue the second write reads the old balance and the player is simply short.
There is an integration test that issues three credits in one tick and expects all three.

🧵 **The recurring find, again — and this time it was already written down.**
`modes/arcade/rewards.ts` has computed a coin award for every scored run since T-4.13, and its own
header says crediting it "is one call away and belongs with the economy that owns the balance".
Nobody had ever been paid one. Three lines in `arcade-game.ts` fixed it. The day record is written
*before* the credit deliberately: if the second write fails the player is short a run's coins, which
is a bad afternoon, whereas the reverse order would credit coins the day never counted and break the
daily cap — the thing that makes arcade unfarmable.

**And the find had a twin.** `coinPill` (T-0.4) has carried `aria-label` on a bare `<span>` since
the design system landed. That is a *prohibited* ARIA attribute — axe fails it as serious — and no
sweep had ever caught it, because until this task the component existed only in the dev gallery,
which the a11y sweep does not visit. The wallet was the first real screen to use it, and the Store
audit went red on the first run. It now carries `role="img"`, as `starRating` beside it always has.
Worth stating as a rule: **a component that only the gallery uses has not been tested.**

**The Store tab is a real screen now**, which also removed the last `stub()` from the route table:
every route in the app loads something real. Packs, the market, and selling land alongside the wallet
at T-8.12 to T-8.14 rather than instead of it — all three spend from the balance it shows.

#### ⚠️ A balance finding for T-8.16

The match rate is now visible for the first time, and arcade's numbers from T-4.13 do not line up
with it. Measured:

| | Coins | Minutes | Per minute |
|---|---|---|---|
| Won Live match, Pro | 250 | 12 | 20.8 |
| First three-star free-throw run | 160 | 0.35 | **453** |
| 200 arcade runs (the day's ceiling) | 320 | 103 | 3.1 |

Both arcade figures come from the same tuning; that is what a sharp decay plus a daily cap does. The
problem is not the ceiling — 320 a day is about 1.3 matches, which is a reasonable place for arcade
to sit — it is that **the whole ceiling can be collected in under three minutes**. For a player with
five minutes, arcade is the efficient farm, which is exactly what `09` §7 rules out.

Retuning it is a cross-mode balance decision: it means either much smaller star values or spreading
the cap over the day, and both interact with pack prices that do not exist yet. That is T-8.16's job
(economy balance pass, simulated over 200 matches), so this is recorded rather than quietly changed
by the task that merely made it measurable.

It also decided how INV-12's coin half is tested. A daily cap is a rate that falls the longer you
play, so no capped payout can sit inside a fixed ±25% per-minute band — the band is meaningful for
XP, which is uncapped, and meaningless here. So the invariant test asserts what the cap is actually
*for*: Live and Playbook pay identically, and a day of arcade is worth less than the same minutes
spent playing matches.

**Verified in a real browser.** The a11y and smoke E2E suite runs green against a build, including
the Store audit that found the pill.

**Feel note.** Finishing a match and watching four lines add themselves up to a number is the first
time this game has felt like it has a *why* outside the match. "First win today +250" is the one that
lands hardest — it is the only line that rewards coming back rather than playing well, and it makes
tomorrow feel like something. The arcade credit is the opposite: 160 coins for twenty seconds reads
as a bug even though it is the spec's own table, which is its own argument for the finding above.

---

### T-8.6

*Achievement engine: declarative defs, event-stream evaluation, progress, once-only grants*

**A def is data with one function on it, and the function sees one event.** That is `05` §6's shape
taken literally, and everything else follows from it. `evaluate(event, ctx) → number | null` returns
a *progress delta*, so "make 5 threes in one game" and "sell 20 athletes" are the same kind of
object; and because it sees one event and has nowhere to keep a counter, anything that needs memory
is declared rather than written. Hence `scope: 'career' | 'match'`, which the tracker keeps.

**Match scope stores the best attempt, not the running total.** A progress bar on "3 threes in one
game" that read a career total of 40 would be a lie about what the achievement is. Best-so-far is
the honest number and the useful one.

**INV-7 is two fields, and that is the whole design.** `unlockedAt` says the condition was met;
`rewardedAt` says the coins were paid. A kill between the two writes leaves "unlocked, unpaid" — an
unambiguous state that the bootstrap grant resolves on the next launch, exactly once. One flag could
not express it, so a retry would either double-pay or never pay. `grantPending` is the only place in
the app that credits an achievement, so "at most once" is a property of one function rather than a
convention spread across callers.

**Writing the invariant test found the other half of INV-7.** Two settlements in the same tick both
read "unpaid" and both paid — 600 coins for a 300-coin achievement. Not hypothetical: a match
finishing while the bootstrap grant is still running does exactly that. The store now serialises the
read-decide-write step the way the wallet already did, and the race is a passing test.

**A broken def cannot break a match.** `evaluate` runs inside a try, for the same reason `EventBus`
contains listener errors. Losing an unlock is bad; losing the match somebody is playing is worse.

**Reachable on day one.** Live, Playbook, arcade runs, and athlete creation all emit into it, and
achievement coins land in the wallet ledger under the achievement's own title. The post-match panel
shows what unlocked; the gallery is T-8.9.

---

### T-8.7

*Achievement content: 79 defs*

**79 across every category `05` §6 names**, against a promise of sixty. The count, the categories,
and the reward shape are asserted rather than eyeballed — a content file dropped from the registry
now fails a test instead of quietly halving the gallery.

**The ten arcade-unlock ids are load-bearing and now have a test.** `modes/arcade/registry.ts` gates
each game behind an id from `achievements/ids.ts`; if no def ever awards one, the game is
permanently unreachable and *nothing anywhere fails*. There is now a test that every gated id is
awarded by a real def, and that none of the ten is hidden — a hidden unlock condition would leave a
locked tile telling the player to do something the gallery refuses to describe.

**Two of `09` §3.2's conditions asked for data the sim does not emit**, and neither needed a change
to a sport to answer:

- *"Score 10 fast-break points."* A fast break is not a thing the rules produce; it is points scored
  moments after winning the ball back. The tracker keeps a bounded window of the match's recent
  events, and the def asks for a basket within three seconds of the player's own steal or defensive
  rebound.
- *"Score a header."* Soccer emits no header event, but it does emit a `lofted` pass beyond thirty
  metres — a cross. A goal within two seconds of one is the header from a cross, which is the same
  reading `soccer/playbook/key-moments.ts` already takes.

That window (`EvalContext.recent`) is the one facility this task added to the engine, and it is
general: sequence-shaped achievements were otherwise impossible without every sport learning new
vocabulary for facts already present in the stream's ordering.

**Career facts are computed where the career is, not counted inside a def.** "Win on each
difficulty" and "win in two sports" were briefly written as closures holding a `Set`. That is a bug
with a long fuse: the set forgets itself on reload, so a player who wins at basketball today and
soccer tomorrow would never be credited. Those facts are now computed from the match history when
the meta event is built, and the def reads a number.

**Every economy achievement is about spending or collecting, never about earning coins.** An
achievement that paid coins for having coins is a loop, and `05` §5.5 exists to keep the economy
closed.

**Feel note.** The cross-sport ones are the best thing in the list, and reading them back is the
first time the *game's* pitch is legible from inside the game: "Wrong Sport, Right Athlete — score
30+ in a basketball match with a soccer-primary athlete", paying three times what a hat-trick does.
That row is an argument for trying something, which is more than most achievement lists manage.

---

### T-8.8

*Arcade unlock wiring: achievements gate arcade games, with a clear unlock moment*

**`ACHIEVEMENTS_LANDED` is `true`.** T-4.3 introduced that constant with a note saying Phase 8 would
flip it: nothing wrote an unlock back then, so ten permanently locked tiles would have made Gate 4's
"a child can start one unaided" unreachable, and the hub opened everything through one greppable
boolean rather than a quietly permissive check. That was the right shortcut and this is the commit
that pays it back. The flag stays rather than being deleted — it is the switch a future sport's
arcade set flips on itself.

**`earnedAchievements` had to learn what "earned" means.** It was written before there were records
to read and counted every row in the store. The store is now full of *progress* — three of five
steals — and an unlocked achievement is one with a non-null `unlockedAt`. Counting progress as an
unlock would have opened games the player is still working towards, which is the feature backwards.

**The unlock is a moment, not a state change.** `09` §3.2 asks the notification to say "unlocked —
you can practise this any time now", and it is right to insist: five of these achievements exist *to*
open a game, and an unlock you have to infer from a tile that stopped being grey is not a moment. The
post-match panel prints the sentence with the game named. Doing that needed the game's display name
somewhere a UI component can read without loading two sport modules, so `ARCADE_UNLOCKS` gained a
`game` field — `09` §3.2 pairs them in one table anyway — with a test asserting each name matches
the real game def.

**The hub's tests had to earn their unlocks.** Half of `arcade.test.ts` asserted things about
playable tiles and quietly depended on everything being open. They now write the achievements first,
the way a player would earn them, and there is a new case for the fresh save: ten locked tiles, each
naming what earns it, and the word "buy" nowhere on the screen.

---

### T-8.9

*Achievement UI: gallery, filters, progress bars, in-match toast, post-match summary*

**The gallery shows locked achievements, and that is the design.** A list of only what you have done
is a trophy cabinet; this is also the list of things worth trying, which is where the cross-sport
ones do their work. Hidden ones appear as "???" — present, so the count is honest, and undescribed,
so the surprise survives. There is a test, because a refactor that rendered `def.title`
unconditionally would spoil seven of them silently.

**Three `<select>`s, not a row of chips.** Chips would look better and be worse: a select is one
tap, is announced properly, and does not wrap into four lines at 360 px. Each has a real `<label>`
(INV-11).

**The counter sits above the filters.** "23 of 79 unlocked · 4 500 coins earned" is what a player
opens this screen for, and narrowing the list must never appear to change it. Asserted.

**A progress bar prints its own numbers.** A bar alone is information conveyed by width, which is no
better than information conveyed by colour for anyone who cannot see it — so every bar carries
"3 / 5" beside it and `role="progressbar"` with the real values.

**The in-match toast runs a *preview* tracker.** Seeded from the stored records, fed the same events
as they happen, writing nothing and paying nothing; the authoritative settlement replays the whole
history after the final whistle. So the toast is free to be best-effort — it is built from an async
database read and is allowed to miss the first few events, because the post-match pass catches them.
A toast that delayed kick-off to read IndexedDB would be the wrong trade, and a toast that granted
anything would put INV-7 back in play for no benefit.
