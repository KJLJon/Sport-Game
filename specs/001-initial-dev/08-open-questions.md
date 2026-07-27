# 08 — Open Questions

Every question below has a **working assumption** already written into the spec, so none of these
block starting Phase 0. Answer any you disagree with and I'll amend the affected documents.

---

## Q-1 — Phase 10 ordering · *affects `03` Phase 10, `07` D-08, D-15*

You chose live WebRTC for the P2P bonus. Adding Playbook mode changes the calculus: turn-based P2P is
a few hundred bytes per turn and tolerates any latency, so it works on connections where lockstep
never will. Phase 10 is now ordered by confidence — async challenge codes, then Playbook P2P, then
Live lockstep.

**Working assumption:** that order. It means the bonus delivers something usable early even if NAT
traversal proves painful, and Live lockstep is the thing that gets cut if anything does.

---

## Q-2 — How much realism in the sports? · *affects `06` §3, Phases 2 and 6*

Currently a fairly full rule set: shot clock, team fouls and bonus, backcourt violations; offside,
advantage, cards, stoppage time. Each is small alone and they add up.

**Working assumption:** implement the full sets, with rules toggles in match setup so you can turn off
offside/fouls/injuries for a looser game with the family.
**Alternative:** "core rules only" at v1.0, depth in v1.1.

---

## Q-3 — Does a career or season mode belong in v1.0? · *affects `01` §3.4*

Out of scope currently: exhibition and knockout tournament only. A season layer (schedule, standings,
ageing, contracts) would be the natural home for long-term familiarity progression — and Playbook
mode makes it far cheaper than it would have been with Live only, since a season of turn-based
matches is genuinely playable in an evening.

**Working assumption:** out of v1.0, revisit after v1.1. Roughly one additional phase if you want it.

---

## Q-4 — Attribute budget number · *affects `05` §2.1, `07` D-13*

580 across eleven attributes (≈53 average), with Sandbox mode to exceed it. That number controls how
special a created athlete feels versus a pulled one, and it's a guess.

**Working assumption:** 580, tuned during the Phase 8 economy balance pass.

---

## Q-5 — Should pack athletes be editable? · *affects `02` US-5.5*

Currently athletes from packs, market, and peers are not freely editable; created ones are.

**Working assumption:** as above, with a Settings toggle that makes everything editable and flags the
save as sandbox.

---

## Q-6 — Match lengths · *affects `06` §3, `09` §2*

Live basketball 4 × 3 real minutes; Live soccer 2 × 4. Playbook basketball ~40 turns at 4–8 s;
Playbook soccer 18–24 phase turns. All configurable.

**Working assumption:** those defaults, tuned by feel in Phase 9. If you want a strict five-minute
family session, say so — it changes stamina, comeback pacing, and turn counts together.

---

## Q-7 — Portrait photos in backups and trades · *affects `04` §12, `05` §7*

Photos are local blobs. They make backups large (200 athletes with photos could be tens of MB) and
they travel with an athlete in a P2P trade.

**Working assumption:** downscale to 256×256 WebP on import, include in backups and trades, with an
"exclude photos" option on export.

---

## Q-8 — Public STUN servers on by default? · *affects `04` §8, `11`*

Cross-network P2P needs STUN. It's the only time the app contacts an external host, and it reveals
your IP to that host — which any WebRTC connection does to your peer anyway.

**Working assumption:** a public STUN list on by default, disclosed in Settings, one tap to disable
(same-network play still works with it off).

---

## Q-9 — Pages setup · *affects `03` T-0.15, `04` §2*

The base path is derived from the repo name, so `Sport-Game` → `/Sport-Game/` with no hardcoding, and
renaming later costs nothing.

**Needs you:** set repository Settings → Pages → Source to **GitHub Actions**. The deploy workflow
assumes it, and it's a one-time manual step I can't do for you.

---

## Q-10 — Visual style reference · *affects `10` §3, now a bigger deal*

Art direction is currently "flat vector, strong team colours, minimal shading, dark UI chrome,
readability over realism", with a full token palette in `10` §3.1. Now that UI/UX has its own phase
and gate, a reference would meaningfully improve the result.

**If you have anything in mind** — a game you like the look of, a colour you want, flat vs lightly
shaded, playful vs serious — now is the cheapest possible time to say so. A single screenshot is
worth several paragraphs here.

---

## Q-11 — Which mode leads? · *affects `10` §8.1, `09` §1*

First launch offers a mode choice (Live / Playbook / Arcade) with an honest difficulty hint before
the first match.

**Working assumption:** offer the choice, default the highlight to **Playbook**, because it's the
mode most people can win at immediately and it shows off the roster system best. Live is the mode
you graduate to.
**Alternative:** default to Arcade (fastest to fun, weakest at showing what the game is) or Live
(most impressive, most likely to lose a newcomer).

---

## Q-12 — Per-person save slots for family members? · *affects `05` §1, `07` D-17*

Hot-seat currently stores **local player names** so party screens say "Dad" and "Ana", but everyone
shares one roster, one coin balance, and one achievement set.

Full per-person save slots — separate rosters, coins, and progress with a quick switcher — would let
each family member have their own game. It's a real feature, and it multiplies every store,
migration, backup path, and settings screen.

**Working assumption:** names only, shared progression, at v1.0. Tell me if separate slots matter and
I'll spec them properly rather than bolting them on later.

---

## Q-13 — Correspondence Playbook matches? · *affects `09` §6, Phase 10*

Because a Playbook turn is a small message, a match where each side plays turns hours apart (over a
shared link, no live connection) is a modest extension rather than a new system. Genuinely nice for
family who don't live together.

**Working assumption:** not in v1.0; noted as a strong post-v1 candidate. Say the word and it becomes
a Phase 10 task.

---

## Q-14 — Turn-based-only sports? · *affects `01` §3.4*

Playbook mode doesn't need real-time physics, so a sport could ship in Playbook and Arcade only, at a
fraction of the cost of a Live implementation. Baseball is the obvious candidate — it's naturally
turn-based and expensive to build in real time. Tennis and volleyball too.

**Working assumption:** not specced. This is a cheap way to widen the "multiple sports" requirement
after v1.1 if variety matters more to you than every sport being playable in every mode.

---

## Q-15 — How often do you want to review? · *affects `CLAUDE.md` §5*

Phase gates are the natural check-in points — eleven of them, each with a deployed, installable
build you can actually play.

**Working assumption:** I report at every gate, and otherwise work continuously, committing and
pushing throughout so you can watch the branch at any time. Tell me if you'd rather review more
often (e.g. every milestone release) or less (only at v0.1, v0.5, v1.0).

---

## Q-16 — Scope reality check · *affects everything*

Honest note rather than a question, updated after this round.

The build was already substantial. Three modes, a UI/UX phase, the PWA lifecycle work, and a full
test suite have made it considerably larger — roughly 170 tasks across twelve phases. Nothing here is
padding; it's what you asked for, and each piece is justified. But it is a long build, and I'd rather
say that plainly now than discover it at Phase 7.

Two things make it tractable. First, everything shares one spine: one rating model, one event stream,
one economy, so the three modes and four sports don't multiply the systems work. Second, the cut
order in `03` is decided in advance:

1. Phase 11 — hockey and football (always a later release)
2. Live lockstep P2P (async codes and Playbook P2P already deliver the bonus)
3. The transfer market
4. Tournament mode
5. Soccer's Playbook and Arcade depth (soccer ships Live-only, the rest follows)

**Never cut:** engine quality, the cross-sport athlete system, Phase 9 UI/UX, the PWA lifecycle work,
or the test suite.

**Tell me** if you'd reorder that. For example, if hockey and football matter more to you than the
market and P2P, I'll restructure so those sports land before the economy depth.
