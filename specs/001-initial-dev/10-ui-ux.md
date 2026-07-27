# 10 — UI / UX Design

The stated goal is a game you want to play with your family. That makes UX a first-class deliverable,
not a polish pass — so it gets its own document, its own phase tasks, and its own quality gate.

## 1. Who is playing

| Player | What they need |
|---|---|
| **You** | Depth, roster management, the cross-sport system, hard difficulties |
| **A partner or older kid** | To be competitive without practice — Playbook mode, clear tactical choices, readable feedback |
| **A young kid** | To have fun in ten seconds — Arcade mode, big targets, no reading required to start |
| **Someone handed the phone at a party** | To understand what to do without being told |

Every screen is designed against the weakest of these, not the strongest. If a seven-year-old can't
find the Play button, the screen is wrong.

## 2. Principles

1. **Two taps to play.** Home → Play. Everything else is optional depth reachable from there.
2. **The athlete card is the hero.** It's the thing you show someone. It gets the most design
   attention of any component.
3. **Show, don't tell.** Ratings as bars with context, familiarity as a filling ring, outcomes as
   animated diagrams. Numbers are available, never required.
4. **One thumb wherever possible.** Everything except Live gameplay is operable with one hand,
   bottom-anchored.
5. **Never a dead end.** Every screen has an obvious way back and an obvious way forward.
6. **Fast beats fancy.** A 150 ms transition that never drops a frame beats a 400 ms one that does.
7. **Explain the game inside the game.** No feature requires reading a manual; hints appear where
   the feature is.

## 3. Visual language

### 3.1 Palette

Dark-first (games look better dark, and it saves battery on OLED), with a full light theme. All
colours are design tokens; nothing is hardcoded in components.

| Token | Dark | Light | Use |
|---|---|---|---|
| `surface-0` | `#0B0F14` | `#F7F8FA` | App background |
| `surface-1` | `#131A22` | `#FFFFFF` | Cards, sheets |
| `surface-2` | `#1C2530` | `#EEF1F5` | Raised, inputs |
| `text-hi` | `#F2F6FA` | `#0D1319` | Primary text |
| `text-lo` | `#94A3B4` | `#5A6673` | Secondary text |
| `accent` | `#3DDC91` | `#0F9D58` | Primary actions, positive |
| `accent-alt` | `#FFB020` | `#E08600` | Rewards, coins, highlights |
| `danger` | `#FF5C5C` | `#D93636` | Destructive, fouls, cards |
| `info` | `#4EA8FF` | `#1668C1` | Neutral emphasis |

Team colours are user-chosen from a curated set that is guaranteed contrast-safe against both
surfaces and distinguishable under all three colourblind simulations. Team identity is **never**
carried by colour alone — kit patterns (solid, stripes, hoops, halves) and marker shapes carry it
too.

### 3.2 Type and space

- One variable font, self-hosted and subset (no external font requests, per `04` §12).
- Scale: 12 / 14 / 16 / 20 / 24 / 32 / 44, `rem`-based, multiplied by the user's UI Scale setting
  (0.85× – 1.3×).
- Spacing: 4 / 8 / 12 / 16 / 24 / 32 / 48. Radii: 8 / 12 / 20 / full.
- Minimum interactive target 44 × 44 px; primary actions 56 px tall.
- Numbers use tabular figures so ratings and scores don't jitter.

### 3.3 Motion

| Purpose | Duration | Easing |
|---|---|---|
| Micro feedback (press, toggle) | 90 ms | ease-out |
| Screen transition | 180 ms | ease-in-out |
| Card flip / reveal | 320 ms | spring |
| Pack opening beat | 600 ms per card | custom |
| Celebration | ≤1200 ms, skippable | — |

Every animation is skippable by tapping, and every one is disabled or reduced under Reduced Motion.
No animation ever blocks input.

## 4. Layout

- **Portrait**: menus, roster, Playbook, most Arcade games. Bottom tab bar, content scrolls, primary
  action pinned above the tab bar.
- **Landscape**: Live matches, some Arcade games. No tab bar; HUD respects safe-area insets on both
  sides for notches and rounded corners.
- **Thumb zones**: on portrait screens, everything routinely tapped lives in the bottom third.
  Destructive actions deliberately do not.
- **Desktop**: content max-width 1100 px, centred; the tab bar becomes a left rail.

## 5. Component inventory

Buttons (primary/secondary/ghost/destructive/icon) · Segmented control · Tab bar · Sheets (half and
full) · Dialog · Toast · Athlete card (§6) · Athlete list row · Rating bar · Familiarity ring ·
Attribute radar · Stat table · Coin pill · Progress bar · Star rating · Empty state · Skeleton
loader · Error state · Onboarding coach-mark · Timing meter (arcade) · Play-call card (Playbook) ·
Court/pitch diagram · Minimap · Match HUD · Pack reveal.

Each ships with a states matrix (default/pressed/disabled/loading/error/focus) and appears in an
in-repo component gallery route (`#/dev/ui`, dev builds only) that doubles as the visual regression
target.

## 6. The athlete card

The single most important piece of UI. It has to make you want to show it to someone.

**Compact** (lists, packs, lineup slots): portrait, name, primary-sport icon, current-sport overall,
rarity frame, familiarity ring, position fit chip.

**Full** (tap through):
- Portrait, name, physical line (height / weight / age / handedness), rarity frame with subtle
  material treatment per tier.
- **Sport switcher** across the top — tap a sport and the whole card re-renders to that sport's
  ratings with an animated transition. This is the feature in one gesture: watch a soccer star's
  numbers reshape into a basketball card.
- Familiarity ring with a plain-language rank (Novice → Learning → Competent → Comfortable →
  Natural) and, in words, `"playing at 58% of their athletic ceiling"`.
- Derived ratings as bars, each expandable to "why": the top three contributing attributes in
  plain language.
- Attribute radar for the eleven sport-neutral attributes.
- Sub-skills, level, XP to next.
- Recent form, career stats per sport, traits with readable effects.
- Provenance line: created / pack / market / imported / traded, with date.

**Cross-sport compare** is a secondary view: the same athlete's overall in every sport side by side,
with a projection for sports they've never played.

## 7. Screen map

```
Home ─┬─ Play ─┬─ Live      ─ setup ─ match ─ results
      │        ├─ Playbook  ─ setup ─ match(turns + arcade moments) ─ results
      │        └─ Arcade    ─ hub ─ game(practice | scored | daily | party)
      ├─ Squad ─┬─ Roster (browse/search/filter)
      │         ├─ Athlete card ─ edit
      │         ├─ Create athlete
      │         ├─ Teams ─ Lineup editor
      │         └─ Import / Export
      ├─ Store ─┬─ Packs ─ opening
      │         ├─ Market
      │         └─ Sell
      ├─ Progress ─┬─ Achievements
      │            ├─ Stats & history
      │            └─ Tournaments
      └─ Settings ─┬─ Controls & assists   ├─ Display & accessibility
                   ├─ Audio & haptics      ├─ Data & backup
                   ├─ App & updates        └─ About
```

Bottom tabs: **Play · Squad · Store · Progress**. Settings lives behind the avatar in the header.

## 8. Key flows

### 8.1 First launch (target: playing within 60 seconds)
1. One screen: what this game is, in two sentences and one image.
2. "Pick your first sport" — two big cards.
3. "Pick how you want to play" — Live / Playbook / Arcade, each with a one-line description and an
   honest difficulty hint.
4. Straight into a match with the starter roster. No account, no settings, no roster management.
5. Post-match: results, coins, and *one* prompt — "Make your own athlete" — which introduces the
   cross-sport hook with a concrete example.

### 8.2 Quick Play
Home → the big Play button uses your last sport, mode, teams, and difficulty. One tap from cold
launch to loading a match.

### 8.3 Create an athlete
Name → photo (camera / library / skip) → primary sport → physicals → attributes. Attributes offer
three paths: **presets** (a handful of archetypes to tap), **sliders** with a live budget meter, or
**roll**. A live preview card updates as you go, and the moment you set a primary sport the card
shows what they'd be in the *other* sports too. Save is always enabled; nothing is mandatory except
a name.

### 8.4 Playbook turn
Court diagram up top, your call options as three-to-six large cards along the bottom, opponent's
last call and the running score always visible. Tap a card → brief confirm-by-tap on a target
athlete if the call needs one → resolution animates → narration line → next turn. A key moment
interrupts with a full-screen arcade challenge and returns you to the flow.

### 8.5 Arcade session
Pick game → pick athlete (with a one-line "this athlete's window is wide/narrow here") → three-second
countdown → play → score, stars, personal best, and a single "Again" button under your thumb.

### 8.6 Pack opening
Buy → odds shown → reveal one card at a time with escalating treatment by rarity → summary grid with
"Add to squad" / "Sell" inline on each. Skippable at any point with a tap-and-hold.

### 8.7 Update available
A bottom banner, never a blocking dialog, never during a match. See `11` §4.

## 9. Feel

- **Haptics** on: successful timing window, score, foul, pack rarity reveal, achievement unlock.
  Never on routine navigation. Off-switchable.
- **Audio**: crowd ambience that swells with game state, crisp action SFX, a short achievement
  sting. Menu music only, off by default on mobile.
- **Juice**: hit-pause on big scores, subtle screen shake, particle bursts on rarity reveals and
  goals — all gated by Reduced Motion and the quality setting.
- **Copy tone**: short, warm, never smug. "Nice window." not "PERFECT!!!". Never blame the player.

## 10. States that are usually forgotten

Specified explicitly because they're where a family-friendly app either holds up or doesn't:
empty roster · empty market · zero coins · first-ever launch · offline · storage denied · storage
nearly full · update available · update failed · migration in progress · corrupt save recovered ·
P2P connecting / failed / desynced · arcade game locked · sandbox athlete blocked from a mode ·
interrupted match found on launch.

Each gets a designed screen or inline state with a plain-language explanation and exactly one
suggested action.

## 11. Accessibility

- WCAG AA contrast on all text and meaningful UI; verified by automated audit in CI.
- Colourblind-safe team palettes plus non-colour differentiation (patterns, marker shapes, name
  labels). A live preview simulates protanopia, deuteranopia, and tritanopia.
- UI Scale 0.85×–1.3× affecting type, targets, and HUD.
- Reduced Motion honours the OS setting and is separately overridable.
- Full keyboard navigation with visible focus rings; logical focus order; skip links.
- Screen-reader labels on all controls; live regions for score and match events.
- No essential information conveyed by sound alone.
- Left-handed layout mirroring for every control surface, including arcade games.
- Colour-independent timing meters (position and shape, not just green/red).

## 12. Design QA gate

Ships with Phase 9 and blocks v1.0:

- [ ] Every screen usable one-handed in portrait on a 5.4" device
- [ ] Every screen legible at 1.3× UI scale without clipping or overlap
- [ ] Every interactive element ≥44 px and reachable in the thumb zone where it's routine
- [ ] Light and dark themes both audited for contrast
- [ ] All three colourblind simulations pass the team-differentiation check
- [ ] Reduced Motion produces a complete, non-broken experience
- [ ] Every one of the states in §10 has a designed, tested appearance
- [ ] A person who has never seen the game reaches a played match in under 60 seconds unaided
- [ ] Visual regression snapshots for every screen in both themes, both orientations
- [ ] Nothing drops below 55 fps during navigation on the target device
