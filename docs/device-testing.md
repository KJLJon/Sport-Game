# Testing on a real phone, before anything is deployed

The `12` §7 device matrix and both gates' "does it actually feel right" questions need a real
device. None of that requires GitHub Pages. This is how to get the app onto a phone from a laptop.

## The catch that decides which method you need

**Service workers only run in a "secure context"** — HTTPS, or a `localhost` origin. A plain
`http://192.168.x.x` address is neither. So there are two tiers of testing:

| What you want to check                                                                    | Needs a secure context? | Method                                                     |
| ----------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| Feel, touch targets, layout, one-handed use, the shot meter, readability at 1.3× UI scale | No                      | **LAN** (below)                                            |
| Install to home screen, offline launch, update banner, Repair, storage persistence        | Yes                     | **Port forwarding** (Android) or wait for the deploy (iOS) |

Most of what the gates are actually blocked on is the first row.

## LAN — works on any phone, no setup

```
pnpm serve
```

That builds and serves the real production bundle (not the dev server) on every network interface.
It prints a Network URL like `http://192.168.1.24:4173/Sport-Game/`. Open it on a phone on the same
Wi-Fi.

You get: the real build, the real base path, real touch input. You do **not** get the service
worker, so no install prompt, no offline, no update flow.

## Port forwarding — Android, full PWA testing

This is the good one. It maps a port on the phone to the laptop, so the phone sees the app on
`localhost` — which _is_ a secure context, so everything works.

1. Enable Developer options → USB debugging on the phone, and plug it in.
2. `pnpm serve` on the laptop.
3. Open `chrome://inspect/#devices` in desktop Chrome.
4. Click **Port forwarding…**, add `4173` → `localhost:4173`, tick "Enable port forwarding".
5. On the phone, open `http://localhost:4173/Sport-Game/`.

Now install-to-home-screen, offline, and the update flow all behave exactly as they will in
production. `chrome://inspect` also gives you the phone's DevTools console from the laptop, which is
worth having anyway.

## iOS

Safari has no port-forwarding equivalent. The options are a locally-trusted HTTPS certificate
(`mkcert` plus `vite preview --https`, with the CA installed on the device) or simply doing the
PWA-specific checks after the first Pages deploy. For everything in the first row of the table, LAN
is enough — and Safari Web Inspector still works over USB for the console.

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
