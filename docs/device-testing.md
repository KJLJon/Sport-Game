# Testing on a real phone

The `12` §7 device matrix and both gates' "does it actually feel right" questions need a real
device. This is how to get the app onto one.

## If you work from the mobile app: deploy is the only route

The Claude Code sessions that build this run in a disposable cloud container. Anything served from
one of those is unreachable from your phone, and the container is gone when the session ends. So
there is no local-server trick available — **the deployed site is the way in.**

**A Claude session cannot start the deploy.** Pushing a tag is refused (403 — the git proxy allows
the session's own branch and nothing else), and dispatching the workflow through the API is refused
too (403, no `actions: write` on the app token). It is a two-minute job from the GitHub mobile app
or the web UI, and it has to be you.

**Step 1, once ever:** repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
Without this the deploy job fails at its final step no matter who starts it. If a deploy has already
failed, check this first.

**Step 2, to publish.** Either works:

- _Actions tab → Deploy → Run workflow →_ pick the branch. No tag; good for a quick test build.
- _Releases → Draft a new release →_ tag `v0.2.0`, target the branch, Publish. Creates the tag
  **and** triggers the deploy, and leaves a real milestone behind. Preferred for v0.2.

From a checkout it is just:

```
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/deploy.yml` picks up any `v*` tag, re-runs typecheck, lint, the full unit suite,
and the bundle budget, and only then publishes to Pages. A broken build cannot reach the live site.

The site lands at `https://<user>.github.io/Sport-Game/`. It is installable and works offline, so
the whole PWA half of `12` §7 is testable from it directly.

## If you have a laptop with the repo checked out

```
pnpm serve
```

Builds the real production bundle and serves it on every network interface, printing a Network URL
like `http://192.168.1.24:4173/Sport-Game/`. Open that on a phone on the same Wi-Fi.

**The catch:** service workers only run in a "secure context" — HTTPS or a `localhost` origin. A
plain `http://192.168.x.x` address is neither, so over LAN you get the real build, real base path,
and real touch input, but no install prompt, no offline, and no update flow.

To get those too, on Android:

1. Enable Developer options → USB debugging on the phone, and plug it in.
2. `pnpm serve` on the laptop.
3. Desktop Chrome → `chrome://inspect/#devices` → **Port forwarding…** → `4173` → `localhost:4173`.
4. On the phone, open `http://localhost:4173/Sport-Game/`.

The phone now sees the app on `localhost`, which _is_ a secure context, so install, offline, and the
update flow all behave as they will in production. `chrome://inspect` also gives you the phone's
console on the laptop.

iOS has no port-forwarding equivalent — either a locally-trusted certificate (`mkcert` plus
`vite preview --https`) or use the deployed site for the PWA-specific checks.

## What to actually look for

The gates are blocked on judgement, not on measurements. While you have it in your hand:

- **The shot release meter.** It is the mechanic the whole shooting model hangs on and it has never
  been felt. Is the window readable at a glance? Does a good release feel good?
- **One-handed reach.** Every screen is supposed to be usable one-handed in portrait.
- **The athlete card.** `10` §6 calls it "the thing you show someone". Does switching sports on it
  land?
- **Gate 2's question:** is a match fun enough to play twice?
- **Gate 3's chain:** create an athlete → play them → play several more → watch familiarity move →
  export a backup → wipe data → reimport → check you are exactly where you left off.

Record what you find in `specs/001-initial-dev/PROGRESS.md`; the gate records have a place for it.
