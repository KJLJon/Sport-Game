# 08 — Open Questions

Every question below has a **working assumption** already written into the spec, so none of these
block starting Phase 0. Answer any you disagree with and I'll amend the affected documents.

---

## Q-1 — Async challenge codes as a P2P fallback · *affects `03` T-8.1, `07` D-08*

You chose live WebRTC over the async option. I've included asynchronous challenge codes anyway, as
the **first** task of Phase 8, because WebRTC without a TURN server cannot connect peers behind
symmetric or carrier-grade NAT, and that is not a bug we can fix without running a server.

**Working assumption:** build async codes first (small, always works), then WebRTC.
**Say so if** you'd rather Phase 8 be WebRTC-only and simply document the NAT limitation.

---

## Q-2 — How much realism in the sports? · *affects `06` §3, Phase 2 and 4 scope*

The spec currently implements a fairly full rule set: shot clock, team fouls and bonus, backcourt
violations; offside, advantage, cards, stoppage time. Each rule is small on its own and they add up.

**Working assumption:** implement the full sets above, with rules toggles in exhibition setup so you
can turn off offside/fouls/injuries for a looser game.
**Alternative:** a "core rules only" v1.0 (scoring, out of bounds, basic fouls) that ships sooner and
adds depth in v1.1.

---

## Q-3 — Does a career or season mode belong in v1.0? · *affects `01` §3.4*

Currently out of scope: exhibition and knockout tournament only. A season/franchise layer (schedule,
standings, athlete ageing, contracts) is the natural home for long-term familiarity progression and
would give the cross-sport system somewhere to breathe.

**Working assumption:** out of v1.0, revisit after v1.1.
**Say so if** you want it specced now — it's roughly one additional phase.

---

## Q-4 — Attribute budget number · *affects `05` §2.1, `07` D-13*

The cap is 580 across eleven attributes (≈53 average), with Sandbox mode to exceed it. That number is
a guess and directly controls how special a created athlete feels versus a pulled one.

**Working assumption:** 580, tuned during the Phase 6 balance pass.
**Alternative:** raise it (created athletes feel like stars, packs matter less), or drop the cap
entirely and let Sandbox be the default (progression becomes cosmetic).

---

## Q-5 — Should pack athletes be editable? · *affects `02` US-5.5*

Currently, athletes from packs/market/peers are not freely editable, so the economy means something.
Created athletes are fully editable.

**Working assumption:** as above, with the Settings toggle that makes everything editable (and flags
the save as sandbox).

---

## Q-6 — Match length defaults · *affects `06` §3*

Basketball: 4 × 3 real minutes. Soccer: 2 × 4 real minutes. Both with compressed game clocks, both
configurable in exhibition setup.

**Working assumption:** those defaults, tuned by feel in Phase 7. If you want a five-minute total
session, say so — it changes stamina and comeback pacing meaningfully.

---

## Q-7 — Portrait photos in backups and trades · *affects `04` §12, `05` §7*

Photos are stored as local blobs. They make backups large (a 200-athlete roster with photos could be
tens of megabytes) and they travel with an athlete in a P2P trade.

**Working assumption:** downscale to 256×256 WebP on import, include in backups, include in trades,
with a "exclude photos" option on export.

---

## Q-8 — Public STUN servers on by default? · *affects `04` §8*

Cross-network P2P needs STUN. Using a public STUN server is the only time the app contacts any
external host, and it reveals your IP to that host — which any WebRTC connection does to your peer
anyway.

**Working assumption:** a public STUN list on by default, clearly disclosed in Settings, one tap to
disable (same-network play still works with it off).

---

## Q-9 — Repository name and Pages URL · *affects `04` §2*

The spec derives the base path from the repo name, so `Sport-Game` → `/Sport-Game/` with no
hardcoding. Renaming later costs nothing.

**Confirm:** GitHub Pages will serve from this repository's `main` branch via Actions (the workflow in
T-0.11 assumes `actions/deploy-pages`, which needs Pages set to "GitHub Actions" as its source in
repository settings — a one-time manual step you'll need to do).

---

## Q-10 — Do you want a visual style reference? · *affects `06` §9*

Art direction is currently "clean high-contrast top-down vector, readability over realism", with
generic fields and kits. If you have a look in mind — a game you like, a colour palette, flat vs
lightly shaded — now is the cheapest time to say so.

**Working assumption:** flat vector, strong team colours, minimal shading, dark UI chrome.

---

## Q-11 — Scope reality check · *affects everything*

Honest note rather than a question. Phases 0–7 as written are a substantial build — four sports'
worth of engine work compressed into two sports, plus roster, AI, economy, achievements, and PWA
infrastructure. The phase gates exist so that if effort runs short, the cut is Phase 9 (extra sports),
then Phase 8 (P2P), then Phase 6 depth (market, achievement count) — in that order, and never engine
quality or the cross-sport system, which are what make this game the thing you described.

**Tell me** if you'd rather reorder that cut list — for example, if hockey and football matter more
to you than the market and P2P, I'll restructure the phases so those sports land before the economy
depth.
