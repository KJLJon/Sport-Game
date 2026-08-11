# Phase 9 notes — UI/UX, accessibility, performance, data safety

Long-form rationale for the Phase 9 task rows in [`../PROGRESS.md`](../PROGRESS.md). The
one-sentence version lives there; this is the part a future session needs only when it touches the
code.

---

## Task notes

### T-9.1

*Design system completion: tokens, all components, full state matrices, dev gallery*

**The task is an audit before it is a build.** `10` §5 lists a component inventory and requires two
things of each entry — a states matrix, and an appearance in the dev gallery at `#/dev/ui`, which
§5 also names as the visual-regression target. Nothing had ever checked either requirement, so the
first thing written was `tests/unit/ui/gallery.test.ts`: the inventory as a table of selectors,
asserted against the rendered page. That is what found the gaps, and it is what stops the next one.

**Four entries had no component behind them.**

- **Attribute radar** (`10` §6). The eleven sport-neutral attributes as one shape. The polygon is
  `aria-hidden` and the numbers are emitted as a list beside it, because a shape is exactly what a
  screen reader cannot read; the second series is dashed rather than merely a second colour
  (INV-11). `radarPoints()` is exported and tested against trigonometry rather than against a
  coordinate string — testing the string tests the formatter.
- **Stat table**. A real `<table>` with a caption, `<th scope>` on both axes, and a `<tfoot>` for
  totals. The Live box score became its first caller rather than staying a second implementation,
  which moved its team line from "last row of the body" to the foot, where a totals row belongs.
- **Athlete list row**. Four screens had each built one. The Sell screen is the first caller of the
  shared component; `sell.css` now adds only what the *sell* screen adds — the squad-lock edge.
- **Onboarding coach-mark**. New, for T-9.3 to build the first-launch flow on. It never traps
  (button, Escape, idempotent) and never blocks the control it points at.

**The tab bar existed but was not a component.** It had been built inside `app/shell.ts` since
Phase 0, which is why it had no states matrix and never appeared in the gallery. Extracting it left
the shell with placement rules only, and put one definition of "which tab is this path" —
`activeTab()` — behind both the first render and the route sync, which had been separate copies of
the same prefix logic.

#### What the audit found that was not a missing component

**Two token vocabularies.** Alongside the tokens `10` §3 names, the Phase-2 stylesheets spent
`--color-border`, `--color-text-muted`, `--type-sm`, `--space-2`, `--radius-md`, `--shadow-lg` —
none of which is declared anywhere in the project. Every use carried a hardcoded fallback that was
doing all the work, which is what `10` §3.1's "nothing is hardcoded in components" exists to
prevent. CSS custom properties have no compile step, so this failed silently for seven phases.

One of them was a live visual bug rather than untidiness. `var(--space-4, 16px)` names a token that
*does* exist and means 4 px, so the fallback was unreachable and all four sides of the Live
overlay's inset had been rendering at a quarter of the intended padding since Phase 2.

`tests/unit/ui/tokens.test.ts` reads the stylesheets as text and holds the whole rule: no dangling
property, no synonym vocabulary, no fallback on a token that cannot fall back, every scale in
§3.1–§3.3 declared, and no stylesheet that spends no tokens at all.

**Two element ids built from the clock.** `dialog()` used `performance.now()` and `callSheet()`
used `Date.now()`. Two dialogs constructed in the same millisecond shared a title id, pointing the
second one's `aria-labelledby` at the first one's heading; two call sheets shared a radio-group
name, so choosing a call in one would clear the other. Both are counters now. The gallery's
"renders identically twice" assertion is what surfaced them — the ids are not drawn, so nothing
visual would ever have caught it.

**The tab bar's active marker had never rendered.** `10` §11 forbids carrying state by colour
alone, and the bar above the active tab is the non-colour channel. Its `::before` was
`position: absolute` on a tab that was not `position: relative`, so it resolved against whatever
ancestor happened to be positioned and drew nowhere near the tab. Since Phase 0, the active tab
was marked by colour and by `aria-current` and by nothing else. Fixed, and re-pinned to the tab's
top edge — `translateY(-6px)` from the static position drew it across the icon once it started
rendering at all.

#### The states matrix, and `data-force`

`10` §5 asks for default/pressed/disabled/loading/error/focus. Two of those are transient and a
screenshot cannot hold them. Rather than restating their declarations in the gallery's stylesheet —
where they would drift — `components.css` matches `.button[data-force='pressed']` and
`[data-force='focus']` alongside `:active` and `:focus-visible`, so the matrix shows the real
declarations. Nothing outside `#/dev/ui` sets the attribute.

#### Verification

`auto` — 3 442 unit tests green, typecheck and lint clean — plus the gallery driven in Chromium at
390 × 844 in both themes and at 1.0× and 1.3× UI scale. Three things were found only in the browser
and would not have failed a unit test:

1. The radar's axis labels ran off the viewBox on the left-hand axes and rendered as `\WA`. The
   plot radius is `centre - 34` now, not `centre - 26`.
2. The tab bar's active marker, above.
3. The athlete row squeezed its meta line over three lines when a price and a button trailed it.
   The row wraps its trailing block instead, and carries `width: 100%` — a shrink-to-fit parent
   plus `flex-wrap` otherwise sizes a row to its widest single child and wraps it against nothing.

**Feel note.** The gallery is the first screen in this project that looks like one designed thing
rather than fourteen screens that happen to share a colour. Scrolling it is oddly satisfying. The
radar is the piece that will sell the game — two athletes side by side as two silhouettes is the
cross-sport hook made visible, and it took no explaining.

#### Left for the tasks that own them

- The loading button's spinner animates, so a naïve screenshot of the gallery can catch it
  mid-flight. **T-9.9** owns the visual-regression suite and should freeze animation before
  capturing.
- The compact athlete card, the pack reveal, the match HUD, the minimap, and the court diagram are
  drawn by screens and by the sports' canvas renderers rather than by primitives, so they are
  deliberately absent from the gallery's inventory table. **T-9.9**'s screen-level suite covers
  them.
- `roster.ts` still renders compact cards in a grid rather than list rows. That is correct for a
  grid; whether the roster should offer a list view is **T-9.2**'s call, not this task's.
