# 09 — Play Modes: Live, Playbook, and Arcade

## 1. Three ways to play the same roster

The game now has three modes. They are genuinely different experiences, but they share one roster,
one rating system, one progression, one economy, and one achievement set. An athlete you develop in
Playbook is the same athlete, with the same familiarity and skill XP, when you take them into Live.

| | **Live** | **Playbook** | **Arcade** |
|---|---|---|---|
| What it is | Real-time top-down match you control with a joystick | Turn-based tactical match where you call plays, with arcade mini-games at key moments | Standalone skill mini-games |
| You are | The athlete on the field | The coach, plus the athlete in clutch moments | Just the athlete, one skill at a time |
| Session length | 4–8 min | 4–6 min, pausable between turns | 20–90 s |
| Orientation | Landscape | Portrait or landscape | Either, per game |
| Hands | Two thumbs | One thumb | One thumb |
| Difficulty to learn | Highest | Lowest | Low |
| Local multiplayer | Desktop/gamepad only | **Hot-seat, 2–4 players** | **Hot-seat, 2–4 players** |
| P2P suitability | Hard (lockstep, latency-sensitive) | Easy (turn exchange, latency-tolerant) | Easy (async challenge codes) |

**Why this matters beyond variety.** Playbook and Arcade are what make this playable with a family.
Live is a game you have to be good at; Playbook is a game you can think about and win with a good
roster and good calls; Arcade is a game a seven-year-old can pick up in ten seconds. And both of the
new modes are dramatically easier to make work peer-to-peer than real-time lockstep is — which
de-risks the bonus considerably (see §6).

The mode selector is on the home screen and is remembered per sport.

---

## 2. Playbook mode (turn-based)

### 2.1 Shape of a match

A Playbook match is a sequence of **turns**. On each turn you make a tactical decision, the CPU (or
hot-seat opponent) makes theirs, and the engine resolves the outcome from your athletes' derived
ratings, the matchup, fatigue, and a seeded roll. The result is shown as a short animated diagram on
the court/pitch — moving markers, passing lines, a shot arc — with a one-line narration, not a wall
of text.

Turn length is 4–8 seconds of resolution. You can hold to fast-forward, and an **Auto-call** toggle
hands play-calling to your assistant coach for stretches, so a match never becomes a chore.

### 2.2 Basketball: possession turns

Each possession you choose a play and, optionally, a target athlete.

| Offensive call | Best when | Keys off |
|---|---|---|
| Isolation | You have a star mismatch | `ballHandling`, `finishing`, defender `perimeterD` |
| Pick & Roll | Opponent defends man | Handler + screener chemistry, `passing`, `interiorD` |
| Post Up | Size advantage inside | `strength`, `finishing`, height differential |
| Motion | Balanced roster, no star | Team average `passing`, `awareness` |
| Spot-Up / Three-Set | Good shooters, opponent packs the paint | `threePoint`, `awareness` |
| Push Tempo | After a stop, stamina in hand | `courtSpeed`, `stamina` |

| Defensive call | Effect |
|---|---|
| Man | Baseline; strong perimeter defenders shine |
| 2-3 Zone | Suppresses drives, concedes threes |
| Press | Forces turnovers, drains stamina, concedes easy buckets when broken |
| Double the Star | Blunts one athlete, opens their teammates |
| Protect the Rim | Cuts finishing, concedes mid-range |

Rock-paper-scissors is deliberately *soft*: no call hard-counters another. Calls shift probability
distributions, and a much better athlete usually still wins the matchup. Ratings beat mind-games,
which is what keeps the roster meaningful.

### 2.3 Soccer: phase turns

Soccer possessions are long and continuous, so turns are **phases of play** rather than possessions:
build-up, progression, final third, chance, set piece, and the defensive equivalents. Instead of a
discrete play call, you set an intent for the phase:

- **Tempo** — patient / balanced / direct
- **Width** — narrow / balanced / wide
- **Risk** — safe / balanced / ambitious (through balls, overlapping runs)
- **Press line** — deep block / mid block / high press
- **Focus** — a flank, a channel, or a specific athlete

Intent choices persist until you change them, so a soccer match asks for fewer, larger decisions than
basketball does, matching the sport. A typical match is 18–24 turns.

### 2.4 Key moments → arcade

When the sim generates a high-leverage event, it hands control to an Arcade mini-game. You play the
moment yourself; your result feeds straight back into the simulation.

| Sport | Moments that trigger arcade |
|---|---|
| Basketball | Wide-open three · clutch free throw · fast-break finish · buzzer-beater · steal opportunity |
| Soccer | Penalty · direct free kick · one-on-one with the keeper · header from a cross · goal-line save |
| Hockey (v1.1) | Penalty shot · breakaway · one-timer · faceoff |
| Football (v1.1) | Field goal · deep throw window · goal-line carry · two-minute drill |

**Frequency setting:** Off (pure sim) · Clutch only · Standard (default) · Every chance.

**Fairness rule.** The arcade challenge is *calibrated by the athlete's ratings and familiarity*, not
by your reflexes alone. A great shooter gets a wide, slow, forgiving timing window; a soccer player
taking a basketball free throw gets a narrow, fast, drifting one. Your input decides where in the
outcome band you land; the athlete decides how wide that band is. This is the single most important
rule in the mode — it keeps arcade moments feeling like *your athlete's* moment rather than a
skill-check that ignores the roster you built.

The sim also computes what *would* have happened without your input. If your arcade result is worse
than the sim's expectation, the post-match screen tells you — which is both honest and funny.

### 2.5 Shared systems

Playbook emits the **same `SportEvent` stream** as Live. Consequently, with zero extra work:
stats and box scores, achievements, sport skill XP, familiarity growth, stamina and injuries, coin
earnings, and match history all behave identically across modes. Difficulty applies through the same
four levels, affecting CPU call quality, its exploitation of your weaknesses, and your arcade window
sizes.

---

## 3. Arcade mode (standalone)

### 3.1 What it is

A hub of short, self-contained skill games. Each one is a single mechanic, one thumb, 20–90 seconds,
instantly readable. They exist for three reasons: they're the key moments in Playbook, they're
practice for those moments, and they're the easiest possible on-ramp for someone who's never played
the game before.

### 3.2 The launch set

| Game | Sport | Mechanic | Unlocked by |
|---|---|---|---|
| **Free Throw** | Basketball | Release timing on a moving meter, with pressure ramping | Achievement: make a free throw in any mode |
| **Three-Point Contest** | Basketball | Rack of five spots, timing + rhythm, 60 s clock | Achievement: make 3 threes in one match |
| **Buzzer Beater** | Basketball | Contested shot, shrinking window, hand in your face | Achievement: win a match by ≤3 points |
| **Fast Break** | Basketball | Timing the finish past a recovering defender | Achievement: score 10 fast-break points |
| **Pickpocket** | Basketball | Reaction test — jump the passing lane without fouling | Achievement: record 5 steals |
| **Penalty Shootout** | Soccer | Aim + power + keeper read; also the defending side | Achievement: score a penalty |
| **Free Kick** | Soccer | Curve and aim over a wall, wind and distance vary | Achievement: win a match on All-Star+ |
| **One-on-One** | Soccer | Timing the touch and the finish past an onrushing keeper | Achievement: score 20 career goals |
| **Header** | Soccer | Jump timing and direction on incoming crosses | Achievement: score a header |
| **Last Line** | Soccer | Play the keeper — reaction saves | Achievement: keep a clean sheet |

Hockey and football arcade sets arrive with those sports in v1.1 (Shootout, Slapshot Accuracy,
Faceoff; Field Goal, Throw Window, Two-Minute Drill).

Everything is unlocked by **playing**, never by paying. Unlock notifications explicitly say
"unlocked — you can practise this any time now", which is the point.

### 3.3 Structure of each arcade game

- **Practice** — unlimited, no rewards, no pressure, athlete selectable so you can feel the
  difference between a specialist and a novice.
- **Scored run** — three lives or a fixed clock, a score, and a 1–3 star rating.
- **Personal bests** per athlete and overall.
- **Daily challenge** — a seeded run identical for everyone that day, with a fixed athlete and
  modifiers, sharable as a challenge code (see §6).
- **Coin rewards** — first 3-star of the day per game pays out, with sharply diminishing returns
  after, so grinding a mini-game never out-earns playing matches.

### 3.4 Why arcade also serves the roster

Playing an athlete in an arcade game grants that sport's skill XP and familiarity, at a reduced rate
versus a real match. So practising free throws with your soccer star genuinely helps them learn
basketball — a small thing that ties the modes into one progression instead of three.

---

## 4. Hot-seat local multiplayer

Playbook and Arcade support 2–4 players on one device, passing it around.

- **Playbook hot-seat** — each player calls their own team's plays on their turn; a clear "pass the
  phone to <name>" screen sits between turns, with an optional hide-my-calls curtain.
- **Arcade hot-seat** — party rounds: everyone takes the same seeded challenge in turn, scores are
  ranked at the end. Best-of-N and elimination formats.
- **Live** supports two players only on a device with two gamepads (desktop), which is a real
  limitation, honestly labelled.

Local player names are kept per device (not full save slots — see `08` Q-13) so the party screens
say "Dad" and "Ana" instead of "Player 2".

---

## 5. Mode architecture

The seam from `04` §5 grows two adapters. Engine core, storage, economy, and achievements are
untouched by any of this.

```ts
export interface SportModule<S extends SportState = SportState> {
  // ... existing: id, meta, field, ratingWeights, roles, live sim, ai, render, hud

  playbook: PlaybookAdapter;   // turn structure, play catalogue, resolution model
  arcade:   ArcadeGameDef[];   // the sport's mini-games
}

export interface PlaybookAdapter {
  turnKind: 'possession' | 'phase';
  calls(state: PlaybookState, side: Side): CallOption[];
  resolve(state: PlaybookState, calls: CallPair, rng: Rng): TurnResolution;  // → SportEvent[]
  keyMoment(res: TurnResolution): ArcadeInvocation | null;
  narrate(res: TurnResolution): NarrationLine;
}

export interface ArcadeGameDef {
  id: ArcadeGameId;
  sport: SportId;
  unlockAchievement: AchievementId;
  /** Ratings/familiarity → difficulty window. THE fairness contract of §2.4. */
  calibrate(athlete: Athlete, difficulty: Difficulty): ArcadeCalibration;
  mount(host: ArcadeHost, cfg: ArcadeConfig): ArcadeSession;   // returns score + SportEvent[]
}
```

Three consequences worth stating:

1. **Adding a sport still means adding one module.** It now carries three modes' worth of content,
   but it plugs into the same single seam.
2. **All three modes emit `SportEvent`.** Achievements, XP, stats, and economy subscribe to that
   stream and remain mode-agnostic.
3. **Arcade games are reusable components.** One implementation serves the key moment, the practice
   mode, the daily challenge, and the hot-seat party round.

---

## 6. What the new modes do for P2P

This is a genuine strategic gain, not a side effect.

| | Bandwidth | Latency tolerance | Determinism requirement | Verdict |
|---|---|---|---|---|
| Live lockstep | Input frames at 60 Hz | Very low | Absolute | Hard, fragile |
| **Playbook** | A few hundred bytes per turn | Seconds are fine | Sim-only, per turn | **Easy and robust** |
| **Arcade async codes** | One code, no connection | Infinite | Seeded scenario | **Trivial** |

So Phase 10 now ships in confidence order: async arcade challenge codes first (works everywhere,
always), then Playbook P2P over the data channel (tolerant of any connection that establishes at
all), then Live lockstep (the hard one). If NAT traversal defeats us for a given pair of players,
they still have two real ways to play each other.

Playbook is also naturally **asynchronous-friendly**: a turn is a small message, so a
correspondence-style match where each side plays turns hours apart is a modest extension rather than
a new system. Flagged in `08` Q-14.

---

## 7. Balance across modes

Three modes must not become three difficulty curves and three economies.

- **Reward parity per minute.** Coin and XP rates are normalised so no mode is the efficient farm.
  Live pays most per match, Playbook slightly less for a shorter match, Arcade least per minute and
  capped daily.
- **One difficulty ladder.** Rookie/Pro/All-Star/Legend mean the same thing everywhere: better CPU
  decisions, less assistance to you.
- **Ratings are the constant.** Playbook resolution, Live simulation, and arcade calibration all read
  the same derived ratings from `05` §3. Tuning an athlete's basketball ability tunes all three.
- **Cross-mode balance testing.** Headless batches simulate the same rosters across Live and Playbook
  and assert that outcome distributions agree within tolerance. If a roster wins 70% in one mode and
  40% in the other, something is wrong with the model, and the test says so.
