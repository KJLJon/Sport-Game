# 02 — User Stories

Format: `US-<epic>.<n>`. Priority is **M** (must, v1.0), **S** (should, v1.0 if time), **C** (could,
v1.1+), **B** (bonus). Acceptance criteria are written to be testable.

There is one persona: **the player** — a single person on their own phone. There is no admin, no
account, no other role. Where a second human appears, they are **the peer**.

---

## E1 — Install, offline, and repository scoping

### US-1.1 — Install the game from the GitHub Pages URL · **M**
As a player, I want to install the game to my home screen from the hosted page, so it launches like
an app.
- Visiting the Pages URL on Android Chrome offers an install prompt within the first session.
- On iOS Safari, an in-app hint explains Share → Add to Home Screen, shown only on iOS and only when
  not already installed.
- Launching from the home screen opens standalone (no browser chrome) in the game's own window.
- The installed app's name, icon (including maskable), theme colour, and splash screen are correct
  on both platforms.

### US-1.2 — Play with no network · **M**
As a player, I want every feature except P2P to work offline.
- After one online visit, airplane mode still allows: launch, full match, roster edits, packs,
  market, achievements, settings.
- No feature shows a network error or spinner when offline; P2P is the only entry point that states
  it needs a connection.
- A cold launch offline (app fully closed, device rebooted) works identically.

### US-1.3 — Keep everything inside the repository path · **M**
As a player hosting other projects on the same GitHub Pages account, I want this game to stay
confined to its own directory.
- The service worker is registered at, and scoped to, the repo base path; it never claims clients
  outside it.
- The manifest's `id`, `scope`, and `start_url` are all the repo base path.
- Every Cache Storage name and every persisted storage key/database name is namespaced with the base
  path, because browser storage is origin-scoped rather than path-scoped (see `04` §3).
- Renaming the repository or serving from a different sub-path requires no code change.

### US-1.4 — Update to a new version without breaking a save · **M**
As a player, I want updates to be safe and obvious.
- When a new build is available, a non-blocking banner offers "Update now"; nothing reloads
  mid-match.
- Accepting swaps to the new version and reloads; declining keeps playing on the current one.
- After update, saved data is migrated forward and no progress is lost.
- Old caches from prior versions are deleted on activation.

### US-1.5 — Keep my data from being evicted · **M**
As a player, I want the browser to treat my save as important.
- The app requests persistent storage on first write and reports the outcome in Settings.
- Settings shows estimated usage and quota.
- If persistence was denied, Settings shows a plain-language warning and a one-tap backup export.

### US-1.6 — Never get stuck on an old version · **M**
As a player who has been burned by this before, I want to be certain I can always get the latest
version, even though the app caches itself for offline use.
- `index.html`, `sw.js`, and `version.json` are never served cache-first, so a new deploy is always
  detectable (`11` §2).
- The app checks for updates on launch, on returning to the foreground, on a timer, and on demand.
- If a newer version exists on the server but the service worker hasn't picked it up, the app detects
  the mismatch itself and offers Repair rather than silently doing nothing.
- Settings always shows the running version, build hash, build date, and last check time, so
  "am I on the latest?" is answerable without guessing.

### US-1.7 — Update without thinking about it · **S**
As a player, I want updates to just happen, but never at a bad moment.
- Auto-update (default on) applies a waiting update silently at a safe point — home screen, no match,
  no open editor, idle.
- Auto-update never fires mid-match, mid-pack-opening, or mid-edit.
- With auto-update off, a non-blocking banner offers the update; "Later" is respected for 24 hours.
- A release marked below `minSupportedVersion` shows a non-dismissable prompt with the reason.

### US-1.8 — Stay playable offline, indefinitely · **M**
As a player, I don't want the game to quietly stop working offline after a few weeks.
- On launch and daily, the app verifies its cached files against the build manifest.
- Missing files are silently restored when online; when offline, a quiet notice says they'll be
  restored later and everything still playable stays playable.
- A failed deploy can never leave a half-cached app: the precache installs atomically or not at all.
- Settings shows an explicit "Ready to play offline" state, with progress when incomplete.
- "Download everything for offline" fetches every sport and mode ahead of a flight.

### US-1.9 — Repair the app when something's wrong · **M**
As a player, I want one button that fixes a stuck app without losing my roster.
- Settings → Repair app unregisters our service workers, deletes only our namespaced caches, and
  re-downloads everything.
- Repair never touches IndexedDB — roster, progress, coins, and achievements survive, and the UI says
  so before you press it.
- Repair offers a backup export first.
- Caches belonging to other apps on the same domain are never touched.

---

## E2 — Core match engine and controls

### US-2.1 — Control my athlete with a virtual joystick · **M**
As a player on a phone, I want responsive touch controls.
- A floating joystick appears wherever my left thumb lands in the left half of the screen and
  supports 360° movement with an analog magnitude.
- Two to three context action buttons sit under my right thumb; their labels change with game state
  (e.g. Shoot/Steal, Pass/Tackle).
- Input-to-on-screen response is under 100 ms on the target device.
- Handedness can be flipped in Settings, mirroring the whole control layout.

### US-2.2 — Switch which athlete I'm controlling · **M**
As a player, I want control of the athlete who matters right now.
- On losing possession, control auto-switches to the athlete best placed to defend.
- A dedicated switch button cycles to the next-nearest teammate to the ball.
- The controlled athlete is unambiguously marked (indicator + name), readable in motion.

### US-2.3 — See the whole field on a small screen · **M**
As a player, I want to understand play I can't fully see.
- The camera follows the ball with smoothing and dynamic zoom based on play spread.
- A minimap shows all athletes, the ball, and the attacking direction.
- Off-screen teammates in a passable position show edge indicators.
- Nothing important renders inside device safe-area insets or under the notch.

### US-2.4 — Play a match that feels like the sport · **M**
As a player, I want real rules enforced.
- Clock, score, periods/halves, and stoppages behave per the sport's rules (`06` §3).
- Out-of-bounds, restarts, fouls/penalties, and scoring all resolve without the game getting stuck.
- The match reaches a definite result including overtime/extra-time and tie-breaks.
- I can pause, see a live box score, adjust settings, and resume or quit to menu.

### US-2.5 — Run at a steady frame rate · **M**
As a player, I want smooth play on my mid-range phone.
- Simulation runs at a fixed 60 Hz timestep, independent of render rate.
- Sustained ≥55 fps during 11v11 soccer with all effects on; a quality setting drops effects for
  weaker devices.
- No input lag or physics change if the render rate drops.

### US-2.6 — Alternative input on desktop · **S**
As a player at a computer, I want to use a keyboard or gamepad.
- WASD/arrows + configurable action keys work; a connected gamepad is detected and mapped.
- On-screen touch controls hide when a non-touch input is active and return on touch.

### US-2.7 — Watch a replay of what just happened · **C**
As a player, I want to rewatch a goal or dunk.
- Because the sim is deterministic and seeded, the last N seconds can be replayed from recorded
  inputs.
- Replay offers play/pause, slow motion, and a camera that stays on the ball.

---

## E3 — Basketball (v1.0 sport #1)

### US-3.1 — Play a 5v5 basketball match · **M**
- Full court, 5 per side, standard positions, four quarters with a compressed clock.
- Shot clock, three-point line, free throws, fouls with bonus, and out-of-bounds all implemented.
- Shot outcome is driven by derived ratings, defender pressure, shot distance, movement, and timing
  input — not by a coin flip.

### US-3.2 — Shoot, drive, pass, and rebound · **M**
- Hold-and-release shoot with a timing window; release quality modifies make probability.
- Drive with the joystick; contact with defenders is resolved by strength/agility, and can draw a
  foul.
- Aimed passing to a targeted teammate, with interception possible.
- Contested rebounds resolved via height, vertical, strength, positioning, and timing of the jump.

### US-3.3 — Defend · **M**
- On-ball defence: stay in front, contest shots, attempt steals and blocks with foul risk.
- Team defence honours the chosen scheme (man / zone) via assignments and help rotations.

---

## E4 — Soccer (v1.0 sport #2)

### US-4.1 — Play an 11v11 soccer match · **M**
- Full pitch, 11 per side including a goalkeeper, two halves with a compressed clock, stoppage time.
- Throw-ins, goal kicks, corners, offside, fouls, free kicks, penalties, yellow/red cards.
- Selectable formation (at minimum 4-4-2, 4-3-3, 3-5-2) that visibly drives positioning.

### US-4.2 — Pass, shoot, dribble, and cross · **M**
- Short pass, through ball, lofted pass/cross, and power-metered shooting.
- Dribbling with close control affected by ratings and pressure; sprint drains stamina.
- Set pieces are playable: aimed free kicks and penalties with a timing/aim mechanic.

### US-4.3 — Defend and keep goal · **M**
- Pressure, standing tackle, and slide tackle, each with a foul/card risk model.
- The goalkeeper is AI-controlled by default with positioning, reflex saves, and distribution;
  optional manual control on penalties.

---

## E5 — Athlete profiles and cross-sport play

### US-5.1 — Create an athlete profile · **M**
As a player, I want to make an athlete for anyone I can think of.
- I can set display name, an optional photo from my device or camera, height, weight, preferred
  hand/foot, jersey number, and primary sport.
- I set the eleven athletic attributes with sliders, or roll them randomly, within a total budget so
  profiles stay comparable.
- Photos are stored locally, downscaled, and never uploaded anywhere.
- The profile appears immediately in my roster and is usable in any sport.

### US-5.2 — Play any athlete in any sport · **M**
This is the headline feature.
- Any athlete can be selected for any sport's squad, regardless of primary sport.
- Their per-sport derived ratings are computed from their sport-neutral attributes (`05` §3).
- Playing outside their primary sport applies a visible familiarity penalty, shown as a badge with
  an explanation on the athlete card.
- The athlete's on-court behaviour reflects the penalty (worse control, worse decisions, slower
  reads), not just a smaller number.

### US-5.3 — Watch an athlete learn a new sport · **M**
- Minutes played and in-match events award sport skill XP for that sport.
- Skill level and familiarity increase with diminishing returns; the familiarity penalty shrinks
  correspondingly.
- The athlete card shows current level, progress to next, and what improved after a match.
- Per-sport sub-skills (e.g. three-point shooting, tackling) develop from the actions the athlete
  actually performs.

### US-5.4 — Understand why an athlete is good or bad at a sport · **M**
- The athlete card explains each derived rating's biggest contributing attributes in plain language.
- A comparison view shows the same athlete's ratings across every sport side by side.

### US-5.5 — Edit and delete profiles · **M**
- Any user-created profile can be edited or deleted, with confirmation and undo for deletion.
- Editing attributes re-derives all sport ratings immediately.
- Athletes acquired from packs/market/peers are marked and, by default, not freely editable
  (togglable in Settings as "sandbox mode").

### US-5.6 — Start with something to play with · **M**
- A fresh install contains a small set of fictional starter athletes, enough to field both sports.
- Onboarding invites me to create my first athlete but never forces it.

### US-5.7 — Import a roster file · **S**
- I can import a JSON roster from a local file or a URL I type in.
- The importer validates against the documented schema and reports per-record errors without
  aborting the whole import.
- A notice states that imported content is my responsibility; nothing is bundled or linked by the app.
- Imports merge rather than overwrite, with a conflict prompt on duplicate IDs.

### US-5.8 — Export my roster · **S**
- I can export my whole roster, or a selection, to a JSON file for backup or to share.

---

## E6 — Teams, squads, and lineups

### US-6.1 — Build a team · **M**
- I can create teams with a name, colours, and a crest picked from generic built-ins.
- A team holds a squad per sport, drawn from my one shared roster of athletes.

### US-6.2 — Set a lineup · **M**
- Drag or tap athletes into positions on a formation/court diagram.
- Each slot shows the derived rating for that position and warns on poor fits.
- "Auto-fill best" assigns the strongest legal lineup for the sport.
- Substitutions can be made pre-match and during pauses.

### US-6.3 — See fatigue and availability · **S**
- Stamina depletes across a match and recovers over subsequent matches; low stamina degrades
  performance visibly.
- Injured or suspended athletes (from cards/fouls) are flagged and blocked from selection for the
  configured duration.

---

## E7 — CPU opponents and difficulty

### US-7.1 — Play against the computer · **M**
- Every sport is playable versus a CPU-controlled team in exhibition and tournament modes.
- The CPU fields a coherent lineup and plays to a recognisable style.

### US-7.2 — Choose a difficulty · **M**
- Four levels: **Rookie, Pro, All-Star, Legend**, selectable per match and rememberable as a default.
- Each level changes CPU reaction time, decision quality, error rate, aggression, and the strength
  of my aim/pass assists (`06` §7).
- Difficulty never alters any athlete's attributes or ratings on either team, and this is verified by
  a test.
- Coin and XP rewards scale with difficulty.

### US-7.3 — Get help without being carried · **S**
- Assist settings (aim assist, auto-switch, pass assist) can be tuned independently of difficulty.
- Disabling assists at a given difficulty grants a small reward bonus.

### US-7.4 — Play a tournament · **S**
- A single-elimination bracket of 4/8/16 CPU teams with my chosen difficulty.
- Progress persists across sessions; the bracket, results, and my run are shown.
- Winning awards coins, a pack, and an achievement.

---

## E8 — Achievements

### US-8.1 — Unlock achievements as I play · **M**
- At least 60 achievements at launch across onboarding, per-sport, cross-sport, difficulty,
  collection, economy, and P2P categories.
- Unlocks are evaluated from match and meta events, and fire an unobtrusive in-match toast plus a
  post-match summary.
- Achievements never trigger retroactively-incorrectly after a data migration.

### US-8.2 — Browse my achievements · **M**
- A gallery shows locked/unlocked state, description, reward, unlock date, and progress bars for
  multi-step achievements.
- Hidden achievements show as "???" until unlocked.
- Filter by sport, category, and completion.

### US-8.3 — Be rewarded for achievements · **M**
- Achievements grant coins and occasionally packs; rewards are granted exactly once, ever.

### US-8.4 — Cross-sport achievements exist and are prominent · **M**
- Explicit achievements for the signature feature, e.g. score 30+ in basketball with a
  soccer-primary athlete, or take an athlete's non-primary familiarity to max.

---

## E9 — Economy: earning, packs, selling, market

### US-9.1 — Earn coins · **M**
- Coins are awarded for match completion, wins, performance milestones, achievements, and a
  first-win-of-the-day bonus, scaled by difficulty.
- The post-match screen itemises every coin award.

### US-9.2 — Open packs to earn new athletes · **M**
- Multiple pack tiers at different coin prices, with published rarity odds shown before purchase.
- Pack opening is an animated reveal that can be skipped.
- A pity timer guarantees a high-rarity pull within a bounded number of packs of the same tier.
- New athletes are generated procedurally with fictional names and coherent attribute spreads;
  a pack athlete's primary sport is part of the roll.

### US-9.3 — Sell athletes for coins · **M**
- Any athlete I own (except ones locked in a squad, unless I confirm) can be sold for coins.
- Sell value is derived from rarity, overall rating, and level, and is always below the expected
  value of buying, so there's no farming loop.
- Selling requires confirmation and shows the exact payout.

### US-9.4 — Work the transfer market · **S**
- An offline market shows a rotating set of listed athletes at generated prices, refreshing on a
  timer, with a limited number of paid manual refreshes.
- The market also generates buy-offers for athletes I own, sometimes above standard sell value.
- Prices vary with rarity, rating, position scarcity, and a seeded random walk — never with real
  money.
- Clock tampering can't be used to farm refreshes (refresh state is clamped and monotonic).

### US-9.5 — Understand my economy at a glance · **S**
- A wallet view shows coin balance and a ledger of recent earnings and spends.

---

## E10 — Modes and session flow

### US-10.1 — Jump straight into a game · **M**
- From the home screen, "Quick Play" starts a match in two taps using last-used sport, teams, and
  difficulty.

### US-10.2 — Set up an exhibition · **M**
- Choose sport, my team, opponent team, difficulty, period length, and rules toggles (fouls,
  offside, injuries).

### US-10.3 — Resume an interrupted match · **S**
- If the app is backgrounded or killed mid-match, the match state is checkpointed and I'm offered a
  resume on next launch.

### US-10.4 — See my history and stats · **S**
- Match history with box scores per match, plus per-athlete career stats aggregated per sport.

---

## E11 — P2P (bonus)

### US-11.1 — Connect to a peer with no server · **B**
- Host generates an invite containing its compressed WebRTC offer, rendered as a QR code and a
  copyable link; the guest scans or pastes it and returns an answer the same way.
- QR generation and scanning happen entirely on-device, with no external service.
- Connection state is clearly reported, with a plain-language explanation and fallback suggestion on
  failure.
- STUN servers are optional and configurable in Settings; with STUN disabled, same-network play still
  works.

### US-11.2 — Play a head-to-head match · **B**
- Both peers play the same deterministic match via lockstep with a small input delay.
- Desync is detected via periodic state hashes and surfaces an honest error rather than diverging
  silently.
- Disconnection offers reconnect, and failing that, a clean abandon with no data corruption.

### US-11.3 — Trade athletes with a peer · **B**
- Both sides propose athletes, review the full cards, and must each confirm.
- A traded athlete leaves the sender's roster and arrives in the receiver's, carrying a signed
  transfer receipt and provenance chain.
- The client refuses to import an athlete whose custody ID is already in the local ledger.
- The UI states plainly that trades are peer-trusted and cannot be enforced against a modified client.

### US-11.5 — Play a Playbook match against a peer · **B**
- Turn-based matches exchange a few hundred bytes per turn, so they work on any connection that
  establishes at all — no lockstep, no latency sensitivity.
- Either side can drop and reconnect without losing the match.
- This is the P2P mode we expect to actually work reliably (`09` §6).

### US-11.4 — Asynchronous challenge codes · **B**
- I can generate a compact code/link from a completed scenario (seed + rules + my result), share it
  by any means, and my friend can play the identical scenario and compare results.
- Works with no live connection whatsoever.

---

## E12 — Data safety

### US-12.1 — Back up and restore everything · **M**
- One-tap export of a single JSON backup containing roster, teams, progress, achievements, economy,
  and settings.
- Import restores it, with a preview of what will change and a required confirmation.
- Backups carry a schema version and are rejected with a clear message if from a newer app version.

### US-12.2 — Survive app updates · **M**
- Persisted schemas are versioned; migrations run automatically and idempotently on launch.
- A pre-migration snapshot is retained so a failed migration can roll back.

### US-12.3 — Reset · **S**
- Settings offers "erase all data" with a typed confirmation and an offer to export first.

---

## E13 — Mobile experience, accessibility, settings

### US-13.1 — Feel native on a phone · **M**
- Landscape lock requested for matches; a rotate prompt appears where the API is unavailable.
- Safe-area insets respected; no browser pull-to-refresh or text selection during play; scroll
  bounce disabled in the match view.
- Optional haptics on key events where supported.

### US-13.2 — Play comfortably regardless of ability · **M**
- Colourblind-safe team palettes with a preview; team differentiation never relies on colour alone
  (patterns/markers).
- Reduced-motion mode removes screen shake and heavy particle effects.
- UI scale setting; all interactive targets ≥ 44 px.
- Text contrast meets WCAG AA; menus are keyboard-navigable with visible focus.

### US-13.3 — Control audio · **S**
- Independent music and SFX volume with mute; audio respects device silent-mode conventions and
  never autoplays before interaction.

### US-13.4 — Understand how to play · **M**
- A short interactive tutorial for each sport and each mode, replayable from Settings.
- A rules/controls reference reachable from the pause menu.
- First launch reaches a played match in under 60 seconds without instruction.

### US-13.5 — Enjoy using it · **M**
As someone who wants to show this to their family, I want the app to look and feel good.
- A consistent design system: one token set, one component library, every component with a complete
  state matrix (`10` §5).
- Transitions are quick (≤180 ms) and never drop frames; every animation is skippable.
- The athlete card is genuinely nice to look at, and switching sports on it animates.
- Copy is short, warm, and never blames the player.
- Every screen is usable one-handed in portrait and legible at 1.3× UI scale.

### US-13.6 — Never hit a broken-looking screen · **M**
- Empty roster, empty market, zero coins, offline, storage denied, storage nearly full, update
  available, update failed, migration running, save recovered, P2P failed, arcade game locked,
  sandbox athlete blocked, interrupted match found — each has a designed state (`10` §10).
- Each states what happened in plain language and offers exactly one suggested action.

---

## E14 — Sport expansion (v1.1)

### US-14.1 — Play ice hockey · **C**
- 5v5 plus goalies, three periods, puck physics with passing and one-timers, shooting and
  deflections, checking, offside/icing, penalties and power plays, faceoffs.

### US-14.2 — Play American football · **C**
- 11v11, downs and distance, a play-call layer for offence and defence, snap, QB throw with receiver
  targeting, running plays, tackling, field goals and punts, two-minute clock rules.

### US-14.3 — Carry progression into new sports · **C**
- New sports automatically gain derived ratings, familiarity, skill XP, achievements, and economy
  support from existing athletes with no data migration required by the player.

### US-14.4 — Prove the engine is extensible · **C**
- Adding a sport requires only a new rules module, asset set, and rating-weight table — no changes
  to engine core, storage, or economy code.

---

## E15 — Playbook mode (turn-based)

### US-15.1 — Play a match as the coach · **M**
As a player who doesn't want a twitch game, I want to win with decisions instead of reflexes.
- A Playbook match runs as a sequence of turns: I make a tactical call, the opponent makes theirs,
  the engine resolves the outcome from my athletes' ratings and a seeded roll.
- Resolution is shown as a short animated court/pitch diagram with one line of narration — never a
  wall of text.
- A full match takes 4–6 minutes, is pausable between turns, and is playable one-handed in portrait.
- The same athletes, ratings, familiarity, XP, stats, achievements, and coins apply as in Live.

### US-15.2 — Make meaningful tactical choices · **M**
- Basketball offers possession-level play calls (iso, pick and roll, post up, motion, spot-up, push
  tempo) and defensive schemes (man, zone, press, double, protect the rim).
- Soccer offers phase-level intents (tempo, width, risk, press line, focus) that persist until
  changed, matching how the sport actually flows.
- Calls shift probabilities; none hard-counters another, and a much better athlete usually still wins
  the matchup.
- The call screen shows why a call suits my roster.

### US-15.3 — Understand what just happened · **M**
- Every turn produces a readable animated diagram and a plain-language narration line.
- A running turn log is scrollable; the box score is always one tap away.

### US-15.4 — Play the big moments myself · **M**
- High-leverage moments (open three, clutch free throw, penalty, one-on-one, free kick) hand control
  to an Arcade mini-game whose result feeds back into the simulation.
- The challenge is calibrated by the athlete's ratings and familiarity — a great shooter gets a wide,
  forgiving window; a novice gets a narrow, fast one.
- Frequency is configurable: off, clutch only, standard, or every chance.

### US-15.5 — Know whether I helped or hurt · **S**
- The post-match screen compares my arcade results against what the simulation expected, so I can see
  where I won or lost the game myself.

### US-15.6 — Keep it moving · **S**
- Hold to fast-forward resolution; an auto-call assistant coach can take over stretches of the match.
- Turn speed is configurable.

### US-15.7 — Face a real opponent · **M**
- The CPU calls plays according to its roster's strengths and my tendencies, at four difficulty
  levels, and exploits weaknesses more at higher levels.

### US-15.8 — Get consistent results across modes · **M**
- The same rosters produce comparable outcomes in Live and Playbook; neither mode is the easy one.
- Coin and XP rates per minute are comparable across modes; neither is the efficient farm.

---

## E16 — Arcade mode

### US-16.1 — Play a quick skill game · **M**
As a player with two minutes, or a kid who's never played before, I want something instantly fun.
- A hub of short mini-games, each one mechanic, one thumb, 20–90 seconds.
- Basketball at launch: Free Throw, Three-Point Contest, Buzzer Beater, Fast Break, Pickpocket.
  Soccer: Penalty Shootout, Free Kick, One-on-One, Header, Last Line.
- Each is playable within ten seconds of tapping it, with no reading required.
- Practice mode is unlimited and unrewarded; scored runs have lives or a clock, a score, and stars.

### US-16.2 — Earn my mini-games · **M**
- Each arcade game unlocks via an achievement earned by playing — never by paying.
- The unlock is a clear moment that says "you can practise this any time now".
- Locked games show what unlocks them.

### US-16.3 — Feel my athlete in the mini-game · **M**
- The chosen athlete's ratings and familiarity set the difficulty window, not my past scores.
- The athlete picker states plainly whether this athlete's window here is wide or narrow.
- Practising with a soccer star at basketball visibly differs from practising with a specialist.

### US-16.4 — Take a daily challenge · **S**
- A seeded daily run, identical for everyone that day, with a fixed athlete and modifiers.
- Shareable as a challenge code so a friend can attempt the identical run.

### US-16.5 — Have practice count · **S**
- Arcade play grants that sport's skill XP and familiarity at a reduced rate versus a real match, so
  practice genuinely helps an athlete learn a new sport.

### US-16.6 — Not be able to farm it · **M**
- Coin rewards are capped daily and diminish sharply, so no mini-game out-earns playing matches.

---

## E17 — Playing with other people on one device

### US-17.1 — Play Playbook against someone next to me · **S**
- 2–4 players on one device, each calling their own team's plays on their turn.
- A clear "pass to <name>" screen between turns, with an optional curtain hiding my calls.

### US-17.2 — Play Arcade party rounds · **S**
- Everyone takes the same seeded challenge in turn; scores are ranked at the end.
- Best-of-N and elimination formats.

### US-17.3 — Be recognised by name · **S**
- Local player names are remembered on the device, so party screens say "Dad" and "Ana" rather than
  "Player 2".
- Names are local only, never transmitted, and editable or removable at any time.

### US-17.4 — Know the honest limit · **M**
- Live mode supports two local players only with two gamepads on a desktop; this is stated plainly
  in the mode selector rather than discovered by failure.
