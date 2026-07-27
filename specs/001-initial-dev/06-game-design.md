# 06 — Game Design

## 1. The core loop

```
Play a match  →  earn coins + XP + familiarity + achievements
      ↑                              ↓
  improve squad  ←  packs / market / sell / trade
```

A session should be able to be three minutes long (Quick Play, one match, collect) or forty (build an
athlete, run a tournament, work the market). Everything is designed so a match is never more than two
taps away from the home screen.

## 2. Controls (mobile-first)

**Layout.** Landscape. Left thumb: floating analog joystick that originates wherever the thumb lands
in the left half. Right thumb: two primary context buttons plus one modifier. Handedness setting
mirrors the entire layout.

**Context sensitivity.** The same two buttons carry different verbs depending on state, with labels
and icons that change to match:

| State | Button A | Button B | Modifier (hold) |
|---|---|---|---|
| Basketball, on ball | Shoot (hold/release) | Pass (aimed) | Sprint |
| Basketball, off ball (attack) | Call for ball | Screen | Sprint |
| Basketball, defence | Steal | Block/Contest | Intense D (sprint) |
| Soccer, on ball | Shoot (power meter) | Pass | Sprint |
| Soccer, on ball + modifier | Lofted/Cross | Through ball | — |
| Soccer, defence | Tackle | Pressure/Switch | Sprint |

**Timing mechanics.** Shooting uses hold-and-release against a release window sized by the athlete's
relevant rating and current pressure — a great shooter has a forgiving window, a soccer player
shooting a basketball has a tiny one. This is where familiarity is *felt* rather than read.

**Assists**, tunable independently of difficulty: aim assist (pass/shot direction snapping), pass
assist (target selection), auto-switch on possession change, and shot-timing forgiveness. Playing
with all assists off grants a coin bonus.

**Other input.** Desktop keyboard (WASD + configurable keys) and Gamepad API with standard mapping.
Touch controls hide when a non-touch input is used and reappear on the next touch.

## 3. Sports

### 3.1 Basketball — v1.0

| | |
|---|---|
| Squad | 5v5, full court, positions PG/SG/SF/PF/C |
| Format | 4 quarters, default 3 real minutes each with a compressed game clock; configurable |
| Rules | Shot clock, 3-point line, free throws, personal and team fouls with bonus, out-of-bounds, backcourt violation, timeouts |
| Overtime | Untimed-ish 2-minute periods until a winner |
| Schemes | Offence: motion / iso / pick-and-roll emphasis. Defence: man / 2-3 zone |

**Shooting model.** Make probability is built from: relevant derived rating (three-point / mid-range /
finishing), distance from hoop, defender proximity and contest height, shooter movement state
(set / off-dribble / fadeaway), release-timing quality, stamina, and composure under late-clock
pressure. Rebounds are contested by height, vertical, strength, box-out positioning, and jump timing.
Fouls come from defender approach angle, speed differential, and `discipline`.

### 3.2 Soccer — v1.0

| | |
|---|---|
| Squad | 11v11 including a goalkeeper |
| Format | 2 halves, default 4 real minutes each with a compressed clock, plus stoppage time |
| Rules | Throw-ins, goal kicks, corners, offside, fouls with advantage, yellow/red cards, free kicks, penalties |
| Formations | 4-4-2, 4-3-3, 3-5-2 at launch, data-driven so more are cheap |
| Extra time | Extra time then penalties in knockout contexts |

**Ball model.** Position plus height with gravity, bounce, and spin, so lofted passes, crosses,
headers, and curled shots all fall out of one system rather than being special-cased. Shooting uses a
power meter with placement from the joystick; curve comes from approach angle and `coordination`.
The goalkeeper is AI by default (positioning, reflex saves, claims, distribution), with manual
control offered on penalties.

### 3.3 Ice hockey — v1.1

5v5 plus goalies, three periods, skating movement with momentum and edge control (distinctly heavier
than running), puck passing and one-timers, shooting with deflections and screens, body checking,
offside and icing, penalties and power plays, faceoffs.

### 3.4 American football — v1.1

11v11, downs and distance, a pre-snap play-call layer with offensive and defensive playbooks, snap,
QB dropback with receiver targeting and throw windows, running plays with blocking, tackling, field
goals and punts, clock rules including the two-minute drill.

### 3.5 Sport-agnostic guarantees

Every sport gets, for free from the shared systems: cross-sport rating derivation, familiarity and
skill growth, difficulty levels, achievements, economy integration, stats and box scores, replays,
and P2P support. A new sport supplies geometry, rules, actions, role tables, weights, and art — and
nothing else.

## 4. Match presentation

- Pre-match: teams, lineups, difficulty, and a "who am I controlling" note.
- In-match HUD: score, clocks, period, sport-specific extras (fouls, shot clock, downs), minimap,
  off-screen teammate indicators, and the controlled-athlete marker.
- Stoppages: brief, skippable, with the reason stated (foul, offside, out).
- Post-match: result, box score, coin itemisation, XP and familiarity changes per athlete,
  achievements unlocked.

## 5. CPU behaviour

A shared utility-scoring framework. Every tick, each AI athlete generates candidate options from its
**role**, scores them against weighted considerations, and executes the best above a threshold.

| Layer | Responsibility |
|---|---|
| Team | Formation shape, phase of play (build-up / attack / transition / defend), pressing triggers |
| Role | What this position should be doing in this phase — off-ball runs, spacing, marking assignment |
| Athlete | Immediate option choice: pass / drive / shoot / cut / press / drop / tackle |

Option scoring uses derived ratings, so an AI-controlled athlete plays to their strengths — a great
shooter takes more shots, a poor handler passes earlier. Familiarity feeds directly into decision
noise, so a hockey player thrown into soccer makes bad reads as well as bad touches.

## 6. The cross-sport experience

This is the feature the game is built around, so it gets explicit design attention rather than being
a number in a table.

**Discovery.** After a new athlete's first match, the game surfaces "Try them in another sport" with
a projection of their ratings in each. Seeing a soccer star's projected basketball card is the hook.

**The penalty must be legible.** A novice in a new sport is not just weaker; they visibly fumble
first touches, hesitate before decisions, and miss timing windows. The athlete card states plainly:
*"Novice at basketball — playing at 58% of their athletic ceiling."*

**Progress must be visible per match.** Post-match shows familiarity moving with a bar and a
plain-language rank (Novice → Learning → Competent → Comfortable → Natural), and calls out sub-skills
that improved.

**The payoff.** A genuinely elite athlete is worth playing out of position even at a penalty, because
the underlying attributes are that good — and after a dozen matches they're a legitimate star in
their second sport. That arc, from "why is he like this" to "he's better at this than his own sport",
is the emotional core of the game, and the achievement set is written to reward walking it.

## 7. Difficulty

Four levels. They change how well the CPU plays and how much help you get. **They never change any
athlete's attributes or derived ratings on either team** — this is an invariant with a test behind it
(`04` §11), because stat-cheating difficulty makes wins feel unearned.

| | Rookie | Pro | All-Star | Legend |
|---|---|---|---|---|
| CPU reaction latency | 420 ms | 280 ms | 170 ms | 90 ms |
| Decision noise (option-score jitter) | high | moderate | low | minimal |
| Execution error (pass/shot deviation) | high | moderate | low | very low |
| Defensive aggression / pressing | passive | balanced | high | relentless |
| Uses advanced tactics (P&R, offside trap, help rotations) | rarely | sometimes | often | consistently |
| Exploits mismatches and low familiarity | no | rarely | often | consistently |
| Your aim/pass assist strength | strong | moderate | light | off by default |
| Your shot-timing window | generous | normal | tight | tight |
| Coin/XP multiplier | ×0.75 | ×1.0 | ×1.4 | ×2.0 |

Target win-rate bands, verified by headless batch simulation (T-5.9): a new player should win ~80%+
on Rookie; an experienced player should sit near 50% on All-Star and below 40% on Legend.

## 8. Progression and pacing

| Milestone | Roughly when |
|---|---|
| First athlete created | Match 1–2 |
| First pack affordable | ~3 matches |
| Noticeable familiarity gain in a second sport | ~5 matches with that athlete |
| First Epic athlete | ~15–20 matches |
| Cross-sport familiarity cap on one athlete | ~50 matches with them |
| Full achievement completion | Long tail, deliberately |

## 9. Art and audio direction

**Visual.** Clean, high-contrast, top-down vector-style rendering. Readability beats realism: athletes
are legible shapes with clear team colours, kit patterns for colourblind differentiation, a strong
controlled-athlete marker, and a distinct ball with a shadow that communicates height. Fields are
generic — no real team or league branding anywhere.

**Audio.** Sport-appropriate ambience (crowd swell tied to game state), crisp action SFX (swish,
rim, whistle, net, boot), and light UI feedback. Music is menu-only by default. All audio is
interaction-gated and respects device silent-mode conventions.

**Haptics.** Short taps on scoring, fouls, and successful timing windows, where supported and enabled.

## 10. Onboarding

1. First launch: a 30-second explanation of what the game is — your athletes, any sport.
2. An interactive control tutorial for the sport you pick first, replayable from Settings.
3. A starter roster is already present, so the first match is immediate; creating an athlete is
   prompted after that first match rather than before it.
4. The cross-sport hook is introduced explicitly on the post-match screen of match one.
