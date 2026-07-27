# 11 — PWA Lifecycle: Updates and Offline Durability

You've been bitten by both failure modes before: an update you couldn't get because the old version
was cached, and an offline app that quietly stopped working after a while. They're opposite symptoms
of the same root cause — a service worker whose caching strategy is uniform. This document specifies
a design where those two goals stop fighting each other, plus the escape hatches for when something
still goes wrong.

## 1. The two failure modes, named

| | **Stale-lock** | **Cache decay** |
|---|---|---|
| Symptom | New version deployed, app keeps serving the old one, hard refresh doesn't help | App worked offline, then one day launches to a blank screen or missing assets |
| Cause | `index.html` or the SW script itself served from cache; SW never re-evaluated; no user-facing way to force it | Partial cache eviction under storage pressure or iOS's 7-day rule; app assumes precache is complete forever |
| Fix here | §2 (split strategies), §3 (aggressive update detection), §6 (Repair) | §5 (integrity self-check + heal), §7 (persistence) |

**The core principle: never cache-first anything that tells you what version you're on.**

## 2. Cache strategy, per resource class

Three caches, all namespaced per `04` §3 and suffixed with the build hash.

| Resource | Strategy | Cache | Why |
|---|---|---|---|
| `version.json` | **Network-only**, `cache: 'no-store'`, falls back to "unknown" offline | none | The source of truth about what's deployed. Must never be cached. |
| `sw.js` | Network-first, browser-managed; served with `Cache-Control: no-cache` | none | The SW script itself must be re-fetched or updates are impossible. |
| `manifest.webmanifest` | Network-first, cache fallback | runtime | Small, changes rarely, must not stale-lock install metadata. |
| Navigations (`index.html`) | **Network-first with a 2.5 s timeout**, cache fallback | shell | This is the single most important line in this document. Cache-first HTML is what causes stale-lock. |
| Hashed build assets (`*.[hash].js/css`) | **Cache-first, immutable** | precache | Content-hashed URLs can never be stale — a new build has new URLs. |
| Images, audio, fonts (hashed) | Cache-first | precache | Same reasoning. |
| User blobs (portraits) | IndexedDB, not Cache Storage | — | Not part of the app; must survive cache clears. |

Because every code and asset URL is content-hashed, cache-first is *safe* for them: staleness is
impossible by construction. The only unhashed resources are the three at the top of the table, and
all three are network-first. That combination is what makes updates reliable without giving up
offline.

## 3. Update detection

Multiple independent triggers, because any single one can be missed:

1. **On every launch** — `registration.update()` immediately after registration.
2. **On foreground** — `visibilitychange` → visible, if more than 60 s since the last check.
3. **On a timer** — every 15 minutes while the app is open and online.
4. **On navigation to Settings → App & updates** — an explicit "Check now" button with visible
   result ("You're on the latest version, built 3 days ago").
5. **Version poll** — `version.json` is fetched on launch and compared to the running build. If it
   differs but no waiting worker has appeared, the app knows something is wrong with the SW and can
   surface Repair (§6) rather than silently doing nothing.

Trigger 5 is the specific answer to "I couldn't get the latest update": the app can *detect* the
mismatch even when the service worker mechanism has failed, and tell you so.

```jsonc
// version.json — emitted at build, never cached
{
  "buildHash": "8f3c2a1",
  "version": "1.2.0",
  "builtAt": "2026-07-27T10:14:00Z",
  "minSupportedVersion": "1.0.0"   // forces a non-dismissable update below this
}
```

## 4. Applying an update

```
new SW installs → waits → app is notified
   ├─ in a match?          → hold everything until the match ends
   ├─ auto-update ON  (default) and app is idle at a safe point → apply silently, reload
   └─ auto-update OFF or user is mid-flow → bottom banner: "Update ready · Update now / Later"
```

- **Safe points** for a silent auto-update: on the home screen, no match in progress, no unsaved
  editor open, idle ≥5 s. Never mid-match, never mid-pack-opening, never mid-edit.
- **Applying** posts `SKIP_WAITING` to the waiting worker, waits for `controllerchange`, then reloads
  once (guarded against reload loops by a one-shot flag).
- **"Later"** is remembered for 24 h, then the banner returns. It is never a modal.
- **Forced updates**: if the running version is below `minSupportedVersion`, the banner is
  non-dismissable and explains why. Reserved for save-breaking or badly broken releases.
- **Migrations** run after the reload, inside the normal migration chain (`05` §9), with the
  pre-migration snapshot in place.
- Settings shows the current version, build hash, build date, and the last update-check time, so
  "am I actually on the new one?" is always answerable.

## 5. Offline durability

### 5.1 Atomic precache install

The SW install step fetches the entire precache manifest and **fails as a unit**. If any asset 404s
or errors, install fails, the new worker is discarded, and the previous version keeps running intact.
The app is never left half-updated with missing assets — which is one of the ways an offline PWA
starts failing after a deploy.

### 5.2 Integrity self-check and self-heal

Cache decay is caused by the browser evicting entries we assumed were permanent. So we stop
assuming.

- **On launch, and once per 24 h**, the app compares the precache manifest against the actual
  contents of the cache.
- **Missing entries, online** → silently re-fetched and restored. No user-visible event.
- **Missing entries, offline** → a quiet, non-blocking notice: "Some game files are missing and will
  be restored next time you're online." Anything still playable stays playable.
- **Critical entries missing** (app shell, engine chunk) → the Repair flow (§6) is offered directly.
- The check runs in an idle callback and is budgeted so it never affects launch time.

### 5.3 Offline readiness indicator

Settings → App & updates shows an explicit **"Ready to play offline"** state with a checkmark, or
"Downloading game files… 82%" with progress, or "Incomplete — reconnect to finish". Per-sport asset
packs report individually, since sports are code-split.

You can also tap **"Download everything for offline"** to force a full precache including sports you
haven't played yet — the thing you want to do before a flight.

### 5.4 iOS specifics

iOS Safari evicts storage for PWAs unused for 7 days. Mitigation: request persistent storage (§7),
run the integrity check on every launch, and re-precache automatically when online. If storage was
evicted while offline, the app says so plainly rather than showing a broken screen. Data in
IndexedDB is protected by the same persistence request and the export/backup nudges from `05`.

## 6. Repair — the escape hatch

Settings → App & updates → **Repair app**. One button that fixes every stuck state, with a clear
explanation of what it will and won't touch.

```
Repair:
  1. Snapshot a full data backup to a downloadable file (offered, not forced)
  2. Unregister every service worker in our scope
  3. Delete every cache whose name carries our namespace  ← ours only, never a sibling project's
  4. Clear our runtime caches; DO NOT touch IndexedDB
  5. Hard-reload with a cache-busting query param
  6. Re-register the SW and re-precache from scratch
```

**Your roster, progress, coins, and achievements are in IndexedDB and are never touched by Repair.**
The UI says exactly that, because otherwise nobody would ever press the button.

There is also **"Check for update now"** for the softer case, and a documented manual fallback in the
README for the truly stuck (browser site-data clear, after exporting a backup).

## 7. Storage persistence

- `navigator.storage.persist()` is requested on first write, and re-requested after meaningful
  milestones (first athlete created, first pack opened) since browsers grant it more readily once
  engagement is established.
- Settings displays the grant state, current usage, and quota from `navigator.storage.estimate()`.
- If persistence is denied, Settings shows a plain warning and a one-tap backup export, and the app
  nudges for a backup after milestones.
- Quota pressure (>80% used) surfaces a warning with a "manage data" action (clear old match
  replays, remove unused portraits).

## 8. What ships in Phase 0 versus later

Phase 0 delivers the whole strategy in §2–§4 plus Repair, because retrofitting it later is exactly
how these bugs get shipped. Phase 0 tasks: `T-0.5` through `T-0.10`.

Later refinements: the offline-readiness UI and per-sport asset packs land with the sports that need
them; the integrity self-check is written in Phase 0 and extended as new asset classes appear.

## 9. Test coverage (detailed in `12`)

Every one of these is an automated Playwright test, not a manual check:

| ID | Scenario | Expected |
|---|---|---|
| PWA-1 | Install v1, deploy v2, relaunch | Update banner appears within one launch |
| PWA-2 | Accept update | Runs v2 after exactly one reload; no reload loop |
| PWA-3 | Decline update, relaunch 24 h later (clock-shifted) | Banner returns |
| PWA-4 | Update while a match is in progress | Nothing happens until the match ends |
| PWA-5 | Auto-update ON, idle at home | Applies silently, state preserved |
| PWA-6 | Deploy v2 with a 404 asset | Install fails, v1 still fully works |
| PWA-7 | Cold launch fully offline | App loads and a match is playable |
| PWA-8 | Delete random precache entries, launch online | Silently restored; integrity check passes |
| PWA-9 | Delete precache entries, launch offline | Honest notice; no crash; heals when back online |
| PWA-10 | Delete the entire cache, launch online | Full re-precache, data intact |
| PWA-11 | Run Repair | Caches cleared, SW re-registered, **IndexedDB untouched** |
| PWA-12 | `minSupportedVersion` above current | Non-dismissable update prompt |
| PWA-13 | Update carrying a schema migration | Migration runs once, data correct, rollback works on induced failure |
| PWA-14 | Two tabs open, update applied in one | Other tab does not break or double-migrate |
| PWA-15 | Sibling app's caches present on the same origin | Repair and cleanup leave them untouched |
| PWA-16 | Offline for 30 simulated days, then launch | Still works; integrity check heals anything evicted |
