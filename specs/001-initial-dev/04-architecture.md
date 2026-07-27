# 04 — Technical Architecture

## 1. Principles

1. **Static, serverless, self-contained.** Every byte is served from the repo's GitHub Pages path.
   The only permitted runtime network traffic is optional STUN during P2P.
2. **The engine knows nothing about sports.** Sports are modules that plug into a fixed seam.
3. **The simulation is deterministic.** Same seed + same inputs = same result, always. This is what
   makes replays, headless balance testing, and lockstep P2P possible.
4. **Path-portable.** Nothing hardcodes `/Sport-Game/`. Rename the repo and it still works.
5. **Data is the player's.** Local, exportable, never transmitted except by explicit peer action.

## 2. Hosting, base path, and PWA scoping

The app is served from `https://<user>.github.io/<repo>/`. The base path is resolved once, at build
time, from the repository name, and consumed everywhere through `import.meta.env.BASE_URL`.

```ts
// vite.config.ts
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'Sport-Game';
export default defineConfig({
  base: process.env.BASE_PATH ?? `/${repo}/`,   // trailing slash required
  // ...
});
```

CI passes `GITHUB_REPOSITORY` automatically, so renaming the repository needs no code change. Local
dev overrides with `BASE_PATH=/`.

**Service worker scope.** A service worker's maximum scope is its own directory. Serving `sw.js`
from the base path therefore gives us path scoping for free — it physically cannot claim clients
outside `/<repo>/`.

```ts
navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
  scope: import.meta.env.BASE_URL,
});
```

**Manifest.** Generated at build so its paths follow the base path:

```jsonc
{
  "id":         "/Sport-Game/",   // stable app identity, tied to the path
  "scope":      "/Sport-Game/",   // navigations outside this leave the app
  "start_url":  "/Sport-Game/",
  "display":    "standalone",
  "orientation": "any"            // matches request landscape lock themselves
}
```

Because `id` is the base path, the installed app is a distinct app from any other PWA published on
the same `github.io` account.

**SPA routing on Pages.** GitHub Pages has no rewrite rules, so deep links use hash routing
(`#/roster`) rather than history paths. A `404.html` copy of `index.html` is also emitted as a
belt-and-braces fallback.

## 3. Storage scoping — the important caveat

Browser storage is scoped to the **origin**, not the path. Every PWA on `<user>.github.io` shares
one IndexedDB namespace, one localStorage, and one Cache Storage. There is no browser mechanism that
confines storage to a sub-directory. So "storage scoped to the repository directory" is implemented
as **strict namespacing derived from the base path**, which achieves the same practical isolation:

```ts
// storage/scope.ts
export const SCOPE = import.meta.env.BASE_URL;          // "/Sport-Game/"
export const NS    = `sportgame${SCOPE}`;               // "sportgame/Sport-Game/"

export const dbName    = ()           => `${NS}db`;
export const cacheName = (k: string)  => `${NS}${k}@${__BUILD_HASH__}`;
export const lsKey     = (k: string)  => `${NS}${k}`;
```

Rules, enforced by lint and review:

- No direct `indexedDB.open`, `localStorage`, or `caches.open` outside `src/storage/`.
- Every cache name carries the namespace **and** the build hash, so activation can delete exactly
  the caches that belong to this app and no others.
- The erase-all-data routine enumerates and deletes only namespace-prefixed keys, databases, and
  caches — it never wipes a sibling project's data.

| Layer | Used for | Namespacing |
|---|---|---|
| IndexedDB | Roster, teams, saves, match history, achievements, economy, ledger | Database name prefixed |
| localStorage | Small prefs, last-used selections, feature flags | Every key prefixed |
| Cache Storage | Precached app shell and assets | Cache name prefixed + build-hash suffixed |
| In-memory | Live match state | n/a |

Quota is requested via `navigator.storage.persist()` and reported via `navigator.storage.estimate()`.

## 4. Repository layout

```
/
├─ .github/workflows/       # build + test on push; deploy to Pages on tag
├─ public/                  # static passthrough (icons, manifest template)
├─ specs/001-initial-dev/   # this specification
├─ src/
│  ├─ main.ts               # bootstrap, SW registration, router mount
│  ├─ app/                  # shell, screen router, layout, design tokens
│  ├─ engine/               # sport-agnostic core — no sport names in here
│  │  ├─ loop.ts            # fixed timestep + interpolation
│  │  ├─ rng.ts             # seeded PRNG
│  │  ├─ world.ts           # entity SoA + spatial hash
│  │  ├─ physics/           # movement, collision, ball
│  │  ├─ render/            # canvas renderer, camera, LOD
│  │  ├─ input/             # joystick, buttons, keyboard, gamepad
│  │  ├─ ai/                # utility scoring, roles, difficulty modifiers
│  │  └─ match/             # state machine, event bus, replay recorder
│  ├─ sports/
│  │  ├─ types.ts           # the SportModule seam
│  │  ├─ basketball/
│  │  ├─ soccer/
│  │  ├─ hockey/            # phase 9
│  │  └─ football/          # phase 9
│  ├─ athletes/             # attributes, derivation, familiarity, skill XP
│  ├─ meta/                 # teams, squads, seasons, stats
│  ├─ economy/              # coins, packs, sell, market
│  ├─ achievements/         # definitions + evaluation engine
│  ├─ p2p/                  # webrtc, signaling codec, lockstep, ledger
│  ├─ storage/              # scoped storage, schemas, migrations, backup
│  └─ ui/                   # screens and widgets
├─ tests/
│  ├─ unit/                 # vitest
│  ├─ sim/                  # golden-seed determinism + headless balance batches
│  └─ e2e/                  # playwright: install, offline, scoping, smoke
└─ tools/                   # sw manifest generation, asset pipeline, benchmarks
```

## 5. The sport module seam

The single extension point. Adding a sport means adding one of these — nothing in `engine/`,
`storage/`, `economy/`, or `achievements/` changes.

```ts
export interface SportModule<S extends SportState = SportState> {
  readonly id: SportId;                       // 'basketball' | 'soccer' | ...
  readonly meta: SportMeta;                   // display name, squad size, periods, icon

  readonly field: FieldGeometry;              // dimensions, zones, goals, boundaries
  readonly ratingWeights: RatingWeightTable;  // attributes → derived per-sport ratings
  readonly roles: RoleTable;                  // positions, responsibilities, default formations

  createState(setup: MatchSetup, rng: Rng): S;
  step(state: S, world: World, inputs: InputFrame, dt: number, rng: Rng): SportEvent[];
  resolveAction(state: S, actor: EntityId, action: ActionIntent, rng: Rng): SportEvent[];
  isFinished(state: S): MatchResult | null;

  ai: SportAiAdapter;                         // option generators + utility scorers per role
  render: SportRenderer;                      // field + sport-specific overlays
  hud: SportHudSpec;                          // which HUD elements the sport needs
}
```

`SportEvent`s (shot, goal, foul, turnover, save, period-end…) are the one currency flowing outward:
achievements, stats, XP, and the economy all subscribe to that stream and never inspect sport
internals.

## 6. Engine architecture

**Loop.** Fixed 60 Hz simulation with an accumulator; rendering interpolates between the last two
sim states. Render rate never affects physics. A spiral-of-death clamp caps catch-up steps.

**Entities.** Struct-of-arrays typed arrays for athlete kinematics, plus a uniform-grid spatial hash
for neighbour queries (marking, collision, passing lanes). No per-frame allocation in the hot path.

**Determinism.** One seeded PRNG instance threaded through the sim. `Math.random` is lint-banned in
`engine/` and `sports/`. Floating-point math is kept to a single ordering discipline, and state
hashes over quantised values back the determinism tests and P2P desync checks.

**AI.** A shared utility-scoring framework: each tick, an AI-controlled athlete generates candidate
options from its role (pass to X, drive, shoot, cut, press, drop), scores each with weighted
considerations, and picks the best above a threshold. Sports supply option generators and scoring
weights; the framework, difficulty modifiers, and reaction-latency queues are shared. Difficulty
adjusts latency, scoring noise, execution error, and aggression — never attributes.

**Match state machine.** `PreMatch → Live → Stoppage → PeriodBreak → Final`, with an event bus that
feeds HUD, stats, achievements, XP, and the replay recorder.

**Rendering.** Canvas 2D with layered draws (field, shadows, athletes, ball, effects, HUD),
off-screen canvases for static field layers, distance-based LOD, and a reduced-motion path that
disables shake and heavy particles.

## 7. State, persistence, migrations

- **Live match state** is in-memory and reconstructible from `(seed, setup, inputs)`; checkpoints for
  resume-after-kill store exactly that triple, not a state dump.
- **Persistent state** lives in IndexedDB object stores: `athletes`, `teams`, `squads`, `progress`,
  `achievements`, `economy`, `matches`, `settings`, `ledger`, `meta`.
- **Schema versioning.** `meta.schemaVersion` gates a forward-only migration chain. Migrations are
  pure, idempotent, and unit-tested; a snapshot is written before running and restored on failure.
- **Backups** are a single JSON document carrying `schemaVersion`, exported/imported through the same
  migration chain. A backup from a newer version is rejected with a clear message rather than
  partially applied.

## 8. P2P architecture (bonus)

**Signaling without a server.** The host creates an `RTCPeerConnection` and data channel, waits for
ICE gathering to complete, then trims and compresses the SDP (drop unused m-lines and attributes →
`CompressionStream('deflate-raw')` → base64url). The payload is shown as a QR code and a copyable
link with the payload in the URL fragment (fragments are never sent to GitHub's servers). The guest
ingests it, produces an answer, and returns it the same way. QR encode/decode is done by vendored
in-repo code plus `BarcodeDetector` with a bundled fallback — no external service.

**Reachability.** Same-network play works with host candidates alone. Cross-network needs STUN;
a configurable public STUN list is on by default and can be disabled. Symmetric/CGNAT paths need
TURN, which requires a server we will not run — those cases fail over to async challenge codes. This
is a documented limitation.

**Netcode.** Deterministic lockstep: both peers share a seed, exchange input frames with a 2–3 tick
delay, and step identically. Every N ticks each side exchanges a state hash; a mismatch aborts with
an honest desync message. Bandwidth is a few hundred bytes per second.

**Trading and the honest limits of trustlessness.** Each install generates a WebCrypto keypair. A
transfer produces a receipt signed by the sender over `{athleteId, custodyId, fromKey, toKey, ts}`,
appended to both ledgers; the sender removes the athlete atomically. Receivers reject a `custodyId`
already present. This defeats accidental and casual duplication. It **cannot** defeat a modified
client, because there is no authority — the UI says so plainly, and traded athletes are flagged.

## 9. Mobile and performance

| Budget | Target |
|---|---|
| Initial JS (gzipped) | ≤ 200 KB |
| Total install size | ≤ 6 MB |
| Sim step | ≤ 4 ms at 22 entities |
| Frame time | ≤ 16 ms sustained on target device |
| Steady-state allocation during a match | ~0 |

Techniques: per-sport code splitting (soccer isn't loaded to play basketball), object pooling,
typed arrays, off-screen static layers, LOD, `requestAnimationFrame`-driven render with the sim
decoupled, and a quality setting for weaker devices. Screen Wake Lock is held during matches.
Landscape lock is requested where supported, with a rotate prompt where it isn't. Touch handling
suppresses pull-to-refresh, double-tap zoom, text selection, and scroll bounce inside the match view.

## 10. Build and CI/CD

- **On push to any branch:** typecheck, lint, unit tests, determinism tests, build, bundle-size
  budget check, Playwright smoke.
- **On tag:** build with `GITHUB_REPOSITORY`-derived base path and deploy to GitHub Pages via
  `actions/deploy-pages`. `main` therefore always equals the live site.
- The service-worker precache manifest is generated at build from the emitted asset list with content
  hashes; `sw.js` itself is emitted unhashed and the workflow avoids long-lived caching on it.

## 11. Testing strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | Rating derivation, familiarity curves, XP, economy formulas, rules resolution, migrations |
| Determinism | Vitest + golden seeds | Identical state hashes across runs; regression guard for the sim |
| Balance | Headless batch sims | Score distributions, win rates per difficulty, economy loop sanity |
| Integration | Vitest + fake-indexeddb | Storage repositories, backup round-trip, migration chains |
| E2E | Playwright | Install/manifest validity, offline cold load, storage-scope assertions, screen smoke |
| Manual | Device matrix | Touch feel, framerate, iOS behaviours, P2P across two phones |

Invariant tests worth calling out, because they protect design decisions rather than code:

- Difficulty changes no athlete attribute or derived rating (asserted by diffing derived ratings
  across all four levels).
- No coin loop yields a net positive (asserted over simulated buy/sell/market cycles).
- No storage key, database, or cache name lacks the base-path namespace.
- No `Math.random` reachable from the sim.

## 12. Privacy and security

- No accounts, no telemetry, no third-party scripts, no external fonts or CDNs.
- Photos are read locally, downscaled, and stored as blobs in IndexedDB. They never leave the device
  except inside a backup the user exports or a trade the user confirms.
- Imported roster files are validated and treated as untrusted data: no HTML, no URLs auto-fetched
  beyond the one the user typed, strict schema validation, and size caps.
- A strict Content-Security-Policy meta tag disallows external origins; P2P STUN hosts are the only
  configurable exception.
