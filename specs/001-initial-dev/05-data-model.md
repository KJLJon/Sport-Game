# 05 — Data Model, Rating Math, and Economy

All numbers here are **starting values for balance passes**, not final truth. They live in one
tunable data module (`src/athletes/tuning.ts`, `src/economy/tuning.ts`) so balancing never means
touching logic.

## 1. Storage overview

| Store | Key | Contents |
|---|---|---|
| `athletes` | `id` | Athlete profiles, including derived-rating cache |
| `teams` | `id` | Team identity, colours, crest |
| `squads` | `teamId:sportId` | Lineup, formation, bench |
| `progress` | singleton | Career stats, unlocks, tournament state |
| `achievements` | `achievementId` | Unlock state, progress counters |
| `economy` | singleton | Coin balance, ledger, pity counters, market state |
| `matches` | `id` | Match records, box scores, replay triples |
| `settings` | singleton | All user preferences |
| `ledger` | `custodyId` | P2P transfer receipts (Phase 10) |
| `meta` | singleton | `schemaVersion`, install ID, keypair, timestamps |

## 2. Athlete

```ts
interface Athlete {
  id: string;                    // uuid
  schemaVersion: number;

  displayName: string;
  portraitBlobId?: string;       // local blob in IndexedDB; never uploaded
  nationalityLabel?: string;     // free text, purely cosmetic
  jerseyNumber?: number;

  heightCm: number;              // 150–230
  weightKg: number;              // 45–160
  handedness: 'left' | 'right' | 'both';
  age: number;                   // 16–45, affects growth rate only

  primarySport: SportId;
  attributes: Attributes;        // §2.1
  sportSkills: Record<SportId, SportSkill>;   // §3.3

  rarity: Rarity;
  traits: TraitId[];             // 0–3 modifiers, e.g. 'clutch', 'glass-cannon'
  condition: { stamina: number; injuredUntil?: number; suspendedGames?: number };

  source: 'starter' | 'created' | 'pack' | 'market' | 'peer' | 'import';
  sandbox: boolean;              // true if created outside the attribute budget
  custodyId: string;             // provenance identity for P2P (§7)
  createdAt: number;
  editable: boolean;
}
```

### 2.1 Attributes — sport-neutral, 1–99

The whole cross-sport system rests on these eleven. They describe an athlete, not a sport.

| Attribute | Meaning | Drives |
|---|---|---|
| `speed` | Top running/skating speed | Sprints, fast breaks, chases |
| `acceleration` | Time to reach top speed | First step, pressing, cuts |
| `agility` | Change of direction, balance | Dribbling, defending, evasion |
| `strength` | Contact force, ability to hold ground | Posting up, shielding, tackling, shot power |
| `vertical` | Jump height and quickness off the floor | Rebounds, blocks, headers, saves |
| `stamina` | Endurance and recovery rate | Late-match performance |
| `coordination` | Fine control of ball/puck with hands or feet | Handling, dribbling, first touch |
| `accuracy` | Precision of a released action | Shooting, passing, crossing |
| `awareness` | Reading play, positioning, decisions | Off-ball movement, interceptions, AI decision quality |
| `composure` | Performance under pressure | Clutch shots, penalties, free throws |
| `discipline` | Control of aggression and timing | Foul avoidance, card risk, turnover avoidance |

**Creation budget.** Each attribute is 20–95; the sum for a user-created athlete is capped at **580**
(≈53 average). Exceeding it requires Sandbox mode in Settings, which sets `sandbox: true`; sandbox
athletes are playable in exhibitions but excluded from tournaments, achievements with fairness
implications, and P2P unless the peer opts in. This keeps the "make Messi" fantasy fully available
without silently poisoning progression.

**Physical modifiers.** `heightCm` and `weightKg` feed derivation directly rather than being
attributes: height helps rebounding, interior defence, and goalkeeping and hurts low centre-of-gravity
agility; weight helps contact and hurts acceleration past an optimum.

## 3. Cross-sport rating derivation

Three stages: derive → gate by familiarity → add learned skill.

```
raw_r        = Σ_a ( weight[sport][r][a] × attributes[a] ) + physicalMod[sport][r]
familiarity  = sportSkills[sport].familiarity          // 0–100
famMult(f)   = 0.55 + 0.45 × (f / 100) ^ 0.75
skillBonus_r = subSkill[r] × 0.75                       // subSkill 0–20 → 0–15
rating_r     = clamp( round( raw_r × famMult(familiarity) + skillBonus_r ), 1, 99 )
```

A total novice therefore plays at **55%** of their athletic ceiling in a new sport; at full
familiarity they reach 100% plus learned sub-skill bonuses. That range is wide enough for the penalty
to be felt and narrow enough that a genuinely elite athlete is still worth playing out of position —
which is exactly the fantasy.

### 3.1 Basketball weights (starting values, rows sum to 1.0)

| Derived | speed | accel | agility | strength | vertical | coord | accuracy | aware | composure | discipline |
|---|---|---|---|---|---|---|---|---|---|---|
| `finishing` | – | .10 | .15 | .20 | .20 | .20 | .10 | – | .05 | – |
| `midRange` | – | – | – | – | .05 | .25 | .40 | .10 | .20 | – |
| `threePoint` | – | – | – | – | .05 | .25 | .45 | .05 | .20 | – |
| `freeThrow` | – | – | – | – | – | .15 | .50 | – | .35 | – |
| `ballHandling` | – | .10 | .30 | – | – | .35 | .10 | .15 | – | – |
| `passing` | – | – | – | – | – | .20 | .30 | .40 | .10 | – |
| `perimeterD` | .20 | .15 | .25 | .05 | – | – | – | .20 | – | .15 | 
| `interiorD` | – | – | .05 | .30 | .25 | – | – | .20 | – | .20 |
| `rebounding` | – | – | .05 | .25 | .35 | .10 | – | .25 | – | – |
| `courtSpeed` | .50 | .30 | .10 | – | – | .10 | – | – | – | – |

Physical mods: `rebounding` and `interiorD` `+ (heightCm − 195) × 0.35`; `ballHandling` and
`perimeterD` `− (heightCm − 195) × 0.15`.

### 3.2 Soccer weights (starting values)

| Derived | speed | accel | agility | strength | vertical | coord | accuracy | aware | composure | discipline |
|---|---|---|---|---|---|---|---|---|---|---|
| `finishing` | – | – | – | .10 | – | .25 | .35 | – | .30 | – |
| `shotPower` | – | – | – | .45 | – | .30 | .25 | – | – | – |
| `shortPass` | – | – | – | – | – | .30 | .40 | .30 | – | – |
| `longPass` | – | – | – | .30 | – | .10 | .35 | .25 | – | – |
| `dribbling` | – | .20 | .30 | – | – | .35 | – | .15 | – | – |
| `crossing` | – | – | – | .10 | – | .30 | .40 | .20 | – | – |
| `heading` | – | – | – | .25 | .40 | .10 | .15 | .10 | – | – |
| `tackling` | – | – | .20 | .30 | – | – | – | .25 | – | .25 |
| `marking` | .20 | – | .25 | – | – | – | – | .35 | – | .20 |
| `offBall` | .30 | .30 | – | – | – | – | – | .40 | – | – |
| `pace` | .60 | .40 | – | – | – | – | – | – | – | – |
| `goalkeeping` | – | .10 | .35 | – | .20 | .25 | – | .10 | – | – |

### 3.3 Sport skill and familiarity

```ts
interface SportSkill {
  familiarity: number;              // 0–100; primary sport starts at 85, others at 10
  level: number;                    // 1–20
  xp: number;
  subSkills: Record<string, number>;// per-derived-rating, 0–20
  minutesPlayed: number;
}
```

**Familiarity growth**, applied per match from minutes actually played:

```
gain = 0.9 × minutes × (1 − familiarity/100)^1.3 × ageFactor / sportComplexity
familiarity = min(cap, familiarity + gain)
cap = 100 for the primary sport, 95 for any other
ageFactor = clamp(1.25 − (age − 22) × 0.02, 0.55, 1.25)
sportComplexity = { basketball 1.0, soccer 1.15, football 1.30, hockey 1.40 }
```

Roughly: ~15 full matches to go from novice to competent, ~50 to approach the cap. Diminishing
returns mean the first few matches are the most visibly rewarding, which is where the feature needs
to sell itself.

**XP and sub-skills.** XP comes from minutes plus events (a made three grants three-point XP, a
tackle grants tackling XP). Level threshold `xpFor(level) = 100 × level^1.6`. Each level grants
sub-skill points auto-allocated toward the actions the athlete actually performed, so an athlete
develops into what you use them for.

**Behavioural coupling.** Low familiarity is not only a smaller number: it also adds decision noise,
increases control error on first touch and handling, and lengthens reaction latency in the AI layer,
so an out-of-sport athlete visibly looks lost before they look merely weak.

### 3.4 Overall and position fit

```
overall(sport, position) = Σ_r ( positionWeight[sport][position][r] × rating_r )
positionFit             = overall(sport, position) / max over positions
```

Position fit under 0.85 raises a warning in the lineup editor rather than blocking selection.

## 4. Rarity and traits

| Rarity | Attr. total roll | Trait slots | Value base | Notes |
|---|---|---|---|---|
| Common | 380–470 | 0 | 200 | Squad filler |
| Uncommon | 450–540 | 0–1 | 500 | Rotation |
| Rare | 520–600 | 1 | 1 200 | Starter quality |
| Epic | 580–660 | 1–2 | 3 000 | Star |
| Legendary | 640–720 | 2–3 | 8 000 | Franchise athlete |

Rarity affects the roll range and trait count only — it never multiplies ratings, so a well-built
Rare can beat a badly-built Epic. Traits are named modifiers with explicit, readable effects
(`clutch`: +8 composure in the final two minutes; `motor`: −25% stamina drain; `hothead`: +6
aggression, −10 discipline).

## 5. Economy

### 5.1 Valuation

```
value      = base(rarity) × (overall / 60) ^ 2.4 × (1 + 0.02 × level)
sellPrice  = round10( 0.35 × value )
marketAsk  = round10( value × rand(0.90, 1.35) )
buyOffer   = round10( value × rand(0.40, 0.75) )
```

### 5.2 Packs

| Pack | Price | Cards | Common | Uncommon | Rare | Epic | Legendary |
|---|---|---|---|---|---|---|---|
| Bronze | 750 | 3 | 70% | 25% | 4.5% | 0.5% | – |
| Silver | 2 000 | 4 | 45% | 40% | 13% | 1.8% | 0.2% |
| Gold | 5 000 | 5 | 20% | 42% | 28% | 8.5% | 1.5% |
| Elite | 12 000 | 5 | – | – | 60% | 32% | 8% |

Odds are shown in the purchase screen before confirmation. **Pity timers:** guaranteed Rare+ within
6 Bronze, Epic+ within 12 Silver, Epic+ within 8 Gold, Legendary within 25 Elite. Counters persist in
the `economy` store and reset on trigger.

### 5.3 Earning

| Source | Coins |
|---|---|
| Match completed | 100 |
| Win | +150 |
| Difficulty multiplier | Rookie ×0.75 · Pro ×1.0 · All-Star ×1.4 · Legend ×2.0 |
| Assists fully disabled | +15% |
| Performance milestones (per match, capped) | 25–150 each |
| First win of the day | +250 |
| Tournament win | 1 500 + one Gold pack |
| Achievements | 100–2 000 depending on tier |

### 5.4 Market

Six listings, refreshing every 4 hours, plus up to three paid manual refreshes per day (250, 500,
1 000 coins). Two buy-offers for athletes you own rotate on the same timer. Prices follow a seeded
random walk anchored to `value`, modulated by rarity and by scarcity at positions your roster is thin
at. Refresh timing is clamped against device-clock tampering: the stored `lastRefresh` only advances,
and a jump larger than the refresh interval grants exactly one refresh, not many.

### 5.5 The anti-farm invariant

For every pack tier, `expectedSellValue(pack) < price(pack)`. Packs must be a coin **sink** whose
payoff is athletes, not coins. This is asserted by a unit test over the odds tables and valuation
formula, so a future odds tweak cannot silently open a money loop. Similarly, `sellPrice < marketAsk`
for the same athlete, closing the buy-low-sell-high loop.

## 6. Achievements

```ts
interface AchievementDef {
  id: string;
  category: 'onboarding'|'basketball'|'soccer'|'hockey'|'football'|'crossSport'|'difficulty'|'collection'|'economy'|'p2p';
  title: string;
  description: string;
  hidden: boolean;
  target: number;                       // 1 for one-shot, N for cumulative
  reward: { coins?: number; pack?: PackTier };
  evaluate(event: SportEvent | MetaEvent, ctx: EvalContext): number | null; // progress delta
}
```

Evaluated against the same event stream the stats and XP systems consume. Grants are recorded
once-only and are idempotent across migrations.

Representative selection from the ~60 at launch:

| Category | Title | Condition | Reward |
|---|---|---|---|
| Onboarding | First Whistle | Finish your first match | 200 |
| Onboarding | Architect | Create your first athlete | 300 |
| Basketball | Downtown | Make 5 threes in one game | 400 |
| Basketball | Glass Cleaner | 20 rebounds with one athlete in a game | 500 |
| Basketball | Perfect Line | 10/10 free throws in a game | 600 |
| Soccer | Hat-Trick | 3 goals by one athlete in a match | 500 |
| Soccer | Clean Sheet | Win without conceding on All-Star+ | 600 |
| Soccer | Set-Piece Specialist | Score 10 career free kicks | 800 |
| **Cross-sport** | Wrong Sport, Right Athlete | Score 30+ in basketball with a soccer-primary athlete | 1 500 |
| **Cross-sport** | Naturalised | Take any athlete's non-primary familiarity to the cap | 2 000 |
| **Cross-sport** | Decathlete | Play the same athlete in every available sport | 1 200 |
| **Cross-sport** | Convert | Have an athlete's secondary-sport overall exceed their primary | 1 800 |
| Difficulty | Step Up | Win one match on each difficulty | 700 |
| Difficulty | No Help Needed | Win on Legend with every assist disabled | 2 000 |
| Collection | Scout | Own 25 athletes | 400 |
| Collection | Golden Ticket | Pull a Legendary from a pack | 1 000 |
| Economy | Bargain Hunter | Buy a market listing below 95% of value | 500 |
| Economy | Liquidation | Sell 20 athletes | 300 |
| Hidden | ??? | Win a match after trailing by 20+ in basketball | 1 200 |
| P2P | Handshake | Complete a P2P match | 800 |
| P2P | Fair Trade | Complete a peer trade | 600 |

## 7. P2P custody (Phase 10)

```ts
interface TransferReceipt {
  custodyId: string;        // stable across the athlete's whole life
  athleteId: string;
  fromKey: string;          // sender public key (JWK thumbprint)
  toKey: string;
  timestamp: number;
  signature: string;        // sender-signed over the above
  previous?: string;        // hash of the prior receipt — the provenance chain
}
```

Import rules: reject if `custodyId` is already in the local `ledger`; reject if the chain fails
signature verification; on accept, append the receipt and mark the athlete `source: 'peer'`. The
sender deletes atomically in the same transaction that emits the receipt. Limitations are stated in
the UI — see `04` §8.

## 8. Roster import schema

Documented publicly in the README so anyone can author a roster file. Import is strictly validated;
unknown fields are dropped, out-of-range values are clamped with a per-record warning, and a bad
record never aborts the whole file.

```jsonc
{
  "formatVersion": 1,
  "name": "My roster",
  "athletes": [
    {
      "displayName": "A. Example",         // required
      "primarySport": "soccer",            // required: basketball|soccer|hockey|football
      "heightCm": 170, "weightKg": 72, "age": 30,
      "handedness": "left",
      "attributes": {                      // required, all eleven, 1–99
        "speed": 84, "acceleration": 91, "agility": 95, "strength": 68,
        "vertical": 70, "stamina": 78, "coordination": 96, "accuracy": 92,
        "awareness": 94, "composure": 93, "discipline": 74
      },
      "rarity": "legendary",               // optional, defaults from attribute total
      "traits": ["clutch"]                 // optional
    }
  ]
}
```

Imported athletes get `source: 'import'`, a fresh `custodyId`, primary-sport familiarity 85, and
everything else at defaults. The importer shows a notice that the user is responsible for the content
they load; the app ships no rosters and links to none.

## 9. Migrations

`meta.schemaVersion` drives a forward-only chain of pure, idempotent migration functions. Rules:

1. Every schema change ships with its migration in the same commit.
2. A snapshot is written before the chain runs and restored if any step throws.
3. Migrations are unit-tested from every prior version's fixture to current.
4. Backups carry their schema version and are run through the same chain on import; a backup from a
   newer version than the app is rejected with a clear message, never partially applied.
5. Achievement re-evaluation after a migration must not re-grant rewards already granted.
