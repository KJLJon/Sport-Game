# 01 — Plan

## 1. Vision

A single installable web app that holds several sports games at once, where the roster is **yours**.
You build athlete profiles — name, photo, physical build, athletic attributes — and then drop any of
them into any sport. A soccer profile can start at power forward. He'll be bad at it at first, and
he'll get better the more you play him there. Around that sits a CPU ladder across four difficulty
levels, an achievement set, and an economy where you earn coins, open packs, sell what you don't
want, work an offline transfer market, and — over a direct peer link — trade players with a friend
and play them head-to-head.

There are **three ways to play the same roster** (`09`):

- **Live** — real-time top-down matches you control with a virtual joystick.
- **Playbook** — turn-based tactical matches where you call plays and the big moments hand off to an
  arcade mini-game.
- **Arcade** — those mini-games standalone, unlocked by playing, for practice or a two-minute go.

That range is deliberate: Live is the game you get good at, Playbook is the game you can win by
thinking, and Arcade is the game a child can start unaided. All three share one roster, one
progression, one economy, one achievement set.

Everything runs client-side. There is no backend, no account, and no network call to any server we
operate. The app is served as static files from GitHub Pages and confines itself — service worker,
caches, and all persisted data — to the repository's own path.

## 2. Product pillars

1. **Your roster, every sport.** The cross-sport athlete is the reason this game exists, not a side
   feature. Rating derivation, familiarity, and skill growth get first-class design attention.
2. **Real gameplay, not menus.** Matches you actually play. Menus serve the matches, never the
   reverse.
3. **Anyone can play it.** Three modes at three levels of demand, so the game works for you, for a
   partner who doesn't want a twitch game, and for a kid with ten seconds of patience. UI/UX is a
   deliverable with its own phase and its own gate, not a polish pass.
4. **Phone-first.** Designed for a 6-inch screen and a mid-range Android device, then allowed to look
   good on a desktop. Not a desktop game that shrinks.
5. **Fully offline, fully yours — and always updatable.** Installs, then works on a plane, and still
   works on a plane six months later. Updates always reach you. Data is local, exportable, and never
   leaves the device unless you hand it to a peer.
6. **Honest difficulty.** Higher difficulties make the CPU play better and give you less assistance.
   They never secretly buff CPU player attributes.
7. **Traceable.** Every module in the codebase names the spec, phase, task, and story it exists for,
   and a generated report proves it.

## 3. Scope

### 3.1 In scope for v1.0

- Installable PWA served from `https://<user>.github.io/Sport-Game/`, offline-capable, with a
  reliable update path and self-healing offline cache (`11`).
- Shared top-down real-time match engine, deterministic and fixed-timestep.
- **Basketball** (5v5) and **Soccer** (11v11), both fully playable against the CPU.
- **Three play modes** — Live, Playbook (turn-based with arcade key moments), and Arcade — for both
  sports (`09`).
- Ten arcade mini-games, each unlocked by an achievement earned through play, each with practice,
  scored, and daily-challenge runs.
- **Hot-seat local multiplayer** for Playbook and Arcade, 2–4 players on one device.
- A designed UI with a full design system, onboarding that reaches a played match in under 60
  seconds, and an accessibility pass (`10`).
- Athlete profile creation, editing, portraits, and a starter set of fictional filler athletes so a
  new install isn't an empty shell.
- Optional roster import from a user-supplied JSON file or URL, with a documented schema.
- Cross-sport rating derivation, sport familiarity, and per-sport skill XP progression.
- Squad/lineup management per sport, including position assignment and auto-fill.
- Four difficulty levels with distinct CPU behaviour and assist profiles.
- Exhibition matches and a knockout tournament mode.
- Achievements (~60 at launch) with coin/pack rewards.
- Economy: coins, packs with rarity tiers and a pity timer, sell-back, and an offline rotating
  transfer market.
- Settings: controls, handedness, UI scale, colourblind palettes, reduced motion, haptics, audio.
- Data safety: schema versioning with forward migrations, full export/import backup, storage
  persistence request, and clear "storage may be evicted" messaging.

### 3.2 In scope for v1.1 (Phase 11, specified here, built after v1.0 ships)

- **Ice Hockey** (5v5 + goalie behaviours) and **American Football** (11v11, play-call layer), each
  across all three modes.
- Achievement, arcade, and economy content extended to the new sports.

### 3.3 In scope, flagged as the bonus (Phase 10)

Delivered in confidence order, because the new modes make most of it much more achievable (`09` §6):

1. Asynchronous **challenge codes** — a seeded scenario shared as a code, no connection needed.
   Always works.
2. **Playbook P2P** — turn exchange over a WebRTC data channel. A few hundred bytes per turn, fully
   latency-tolerant, works on any connection that establishes.
3. **Live lockstep P2P** — the hard one: deterministic lockstep with input delay.
4. **Player trading** with signed transfer receipts and a custody ledger.

All signaling is manual (QR code or copyable link). No server of ours is involved at any point.

### 3.4 Explicitly out of scope

- Any server, database, account system, leaderboard, or telemetry we host.
- Bundled real-athlete names, photos, ratings, or team/league branding. See §6.
- Real-money purchases of any kind.
- Career/franchise simulation (multi-season contracts, drafts, salary caps). Post-v1 candidate.
- Native app store builds.
- Online matchmaking, lobbies, or discovery. P2P is invite-only, peer-to-peer, by design.
- Sports beyond the four named (baseball, tennis, volleyball) — engine stays extensible for them.

## 4. Target platforms

| | Baseline | Notes |
|---|---|---|
| Primary | Android Chrome 120+, mid-range device (Moto G / Pixel A-series class) | 60 fps target, install prompt supported |
| Primary | iOS Safari 17+ | Add-to-Home-Screen install; no `beforeinstallprompt`, needs custom instructions |
| Secondary | Desktop Chrome/Edge/Firefox/Safari | Keyboard + gamepad controls, larger canvas |
| Orientation | Landscape for matches, portrait allowed for menus | Request lock where supported, graceful rotate prompt where not |
| Offline | Full — every feature except P2P works with the radio off | |

## 5. Success criteria

The build is done when all of the following hold on a real mid-range Android phone:

| # | Criterion |
|---|---|
| S1 | Install from the Pages URL, turn off networking, launch from the home screen, play a full basketball and a full soccer match |
| S2 | All app storage lives under keys/caches namespaced by the repo base path; another PWA on the same GitHub Pages origin cannot collide with it |
| S3 | Create an athlete, play them in their primary sport and a secondary sport, and see the familiarity penalty visibly shrink over several matches |
| S4 | Beat the CPU comfortably on Rookie and lose to it on Legend, with no CPU attribute inflation anywhere in the code |
| S5 | Earn coins, open a pack, sell a duplicate, and buy from the market, all offline |
| S6 | Unlock at least 10 achievements through normal play, including one cross-sport achievement |
| S7 | Sustained ≥55 fps during 11v11 soccer; initial JS payload ≤ 200 KB gzipped |
| S8 | Export a backup, wipe site data, reimport, and be exactly where you left off |
| S9 | Play the same roster in Live, Playbook, and Arcade, and see one shared progression respond to all three |
| S10 | Hand the phone to someone who has never seen the game; they reach a played match in under 60 seconds unaided |
| S11 | Deploy a new version: the running install offers it within one launch and applies it cleanly. Delete cache entries by hand: the app self-heals. Press Repair: the roster survives |
| S12 | Two phones connect via QR and complete a P2P Playbook match; two phones on one Wi-Fi complete a Live match without desync (bonus) |

## 6. Legal and content position

The app ships **no real-athlete likeness data**. Athlete profiles are user-created; the built-in
starter athletes are fictional. If a user types "Messi" into a profile they create on their own
device, that is their local data, not our published content. The optional roster import feature
accepts a file or URL the user supplies; we do not host, link, endorse, or distribute rosters, and
the importer displays a notice that the user is responsible for the content they load. No real team
names, league names, logos, or kit designs ship in the repository — teams are user-named, and
built-in kits are generic colourways.

## 7. Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | **Scope.** Real-time top-down team sports with full squads is the most expensive option chosen. Two sports at 5v5 and 11v11 is a large build. | High | One shared engine; sports are rule modules. Basketball is the vertical slice that proves the engine before soccer starts. Phase gates in `03` are hard checkpoints — if a gate slips, Phase 11 sports drop, not quality. |
| R2 | **11v11 on a phone.** 22 entities, small screen, thumb controls. Readability and framerate both at risk. | High | Ball-following camera with dynamic zoom, minimap, off-screen teammate indicators, aggressive LOD for far entities, spatial hash for collision. Perf budget enforced in CI (`T-1.9`). |
| R3 | **Team AI is the hard part.** Formation, off-ball movement, and defensive assignment across two very different sports. | High | Utility-scoring AI over a shared role framework; per-sport role tables, not per-sport AI rewrites. Budgeted its own phase (Phase 7) rather than being smuggled into sport phases. |
| R4 | **Browser storage eviction.** GitHub Pages origins get no special treatment; a user can lose their roster. | Med | `navigator.storage.persist()` on first save, quota display in settings, prominent export/backup flow, periodic "back up your roster" nudge after milestones. |
| R5 | **P2P NAT traversal fails** on symmetric NAT / carrier-grade NAT without TURN, which needs a server. | Med | Public STUN by default (user-configurable, disable-able); same-LAN always works; asynchronous challenge codes as the always-works fallback. Documented as a known limitation, not a bug. |
| R6 | **P2P cheating / player duplication** cannot be prevented without an authority. | Med | Per-install WebCrypto keypair, signed transfer receipts, local custody ledger, refuse to import a custody ID already seen. Documented honestly: this deters casual dupes, not a modified client. Traded players are flagged in the UI. |
| R7 | **Cross-sport balance.** Familiarity and derivation weights could make secondary-sport play either pointless or trivially optimal. | Med | Weight matrix and familiarity curve live in one tunable data file with unit-tested invariants; balance pass is an explicit task, not an afterthought. |
| R8 | **PWA update loops / stale caches** on a path-scoped GitHub Pages deploy. | Med | Versioned cache names keyed to the build hash, explicit skip-waiting-on-user-confirm update flow, precache manifest generated at build, `sw.js` served with no-cache headers where possible. |
| R9 | **iOS Safari PWA gaps** — install UX, storage eviction after 7 days of non-use, no vibration API. | Med | Feature-detect everything; custom iOS install instructions; storage persistence requested; haptics degrade silently. Test on iOS every phase. |
| R10 | **Determinism drift** breaks lockstep P2P and replay tests. | Med | Seeded PRNG only, no `Math.random` in sim (lint rule), fixed timestep, integer/quantised math where it matters, golden-seed replay tests in CI from Phase 1. |
| R11 | **Three modes triple the surface area** — three balance curves, three UIs, three sets of bugs per sport. | High | One rating model and one `SportEvent` stream feed all three, so progression/economy/achievements are written once. Cross-mode parity is an enforced invariant (INV-11/12), not a hope. Playbook and Arcade are each far cheaper than Live, and Arcade doubles as Playbook's key-moment component rather than being separate content. |
| R12 | **Arcade calibration** could make mini-games feel like a reflex test that ignores the roster, undermining the whole athlete system. | Med | The fairness rule in `09` §2.4 is an invariant (INV-10): ratings set the window, your input picks where in the band you land. Tested by asserting window size is a pure function of the athlete. |
| R13 | **UI/UX under-delivers** because it's scheduled late and gets compressed. | High | Phase 9 has its own gate with a hard checklist (`10` §12) including an unaided-newcomer test, and the cut order in `03` explicitly forbids cutting it. Design tokens and the component gallery start in Phase 0, so quality accrues rather than being retrofitted. |
| R14 | **Update/offline regressions** reappear as the app grows (new asset classes, code splitting). | Med | All sixteen lifecycle scenarios in `11` §9 are automated E2E tests running on every commit from Phase 0, and the integrity self-check is manifest-driven so new assets are covered automatically. |

## 8. Release strategy

| Release | Phase | Contents | Gate |
|---|---|---|---|
| **v0.1 Playable** | 2 | PWA shell + lifecycle, engine, basketball Live vs CPU | Engine proven, S7 perf holds, S11 |
| **v0.2 Roster** | 3 | Profiles, cross-sport ratings, squads, import/export | S3, S8 |
| **v0.3 Arcade** | 4 | Arcade framework, five basketball mini-games, hot-seat party | S10 in miniature |
| **v0.4 Playbook** | 5 | Turn-based mode with arcade key moments, hot-seat | S9 |
| **v0.5 Two sports** | 6 | Soccer across all three modes | S1 |
| **v1.0** | 7–9 | Difficulty ladder, achievements, full economy, UI/UX and a11y pass | S1–S11 |
| **v1.0.x** | 10 | P2P bonus | S12 |
| **v1.1** | 11 | Hockey + American Football, all three modes | Sport-module extension proven |

Every push builds and tests; only tagged releases publish to Pages, so the live site is always a
deliberate release and a half-finished phase never auto-updates into an installed app.

## 9. Guiding constraints for implementation

These are non-negotiable and are enforced by review and, where possible, by lint/CI:

1. No hardcoded `/Sport-Game/` anywhere. The base path is derived at build/runtime.
2. No runtime network requests except optional STUN during P2P. No CDNs, no web fonts, no analytics.
3. No `Math.random()` inside the simulation or Playbook resolution. Seeded PRNG only.
4. No sport-specific branching in engine core. Sports extend via the module interface.
5. No mode-specific branching in progression, economy, or achievements. All three modes emit the same
   `SportEvent` stream.
6. Difficulty never modifies athlete attributes.
7. Arcade difficulty windows are a pure function of the athlete, never of the player's history.
8. Nothing that tells you what version you're on is ever served cache-first.
9. Every persisted schema carries a version and a migration path.
10. Touch targets ≥ 44 px; nothing critical conveyed by colour alone.
11. Every module in `src/` carries a spec header naming its spec, phase, task, and story.
12. Every task's status lives in `PROGRESS.md`, updated in the same commit as the work.

These are enforced by lint rules and the invariant tests in `12` §3, not by good intentions.
