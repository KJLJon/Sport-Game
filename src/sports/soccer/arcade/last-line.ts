/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.26 — Soccer arcade: Last Line
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §3.2 ("play the keeper — reaction saves"), §3.1 (a run is
 *          20–90 s), §2.4 (the fairness rule), 06-game-design.md §3.2 (soccer)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: stand in the goal and keep them out — the set's only pure reaction test.
 *
 * **One tap, one clock, and no aiming.** Every other game in soccer's set is two taps and a count of
 * rounds. This one is a forty-five-second volley of shots and a single button, because that is what
 * `09` §3.2 asked for and because a keeper's job does not decompose into a placement and a strike.
 * It is the only clocked game soccer has, which is the right way round: a run that ended after ten
 * shots would be over before the rhythm of it started.
 *
 * **The window is the athlete's reaction time, undisguised.** The marker crosses the whole track in
 * exactly `calibration.reactionSeconds`, and the band is the whole track. So the meter *is* the
 * athlete: a novice's shot is past them in a fifth of a second and a specialist's hangs for more than
 * half of one. Nothing else in the project puts a derived rating on screen this directly, and it is
 * the clearest demonstration of `09` §2.4 in the game — two players tapping identically get different
 * results, and the reason is legible without a word of explanation.
 *
 * **The band spans the track deliberately, and the test helpers know what that means.** A band from
 * 0 to 1 is how `humanPlayer` recognises a countdown rather than a sweep: it reacts to what was on
 * screen a latency ago instead of anticipating where the marker is heading. Anticipation is exactly
 * what a reaction test must not reward, so the shape of the band is load-bearing rather than lazy.
 *
 * **You cannot dive before the shot.** There is a wait before every strike, drawn per shot, and the
 * meter reads `null` through it — nothing to react to yet. Going anyway is a keeper committing early
 * and it concedes, which is what stops the game being solved by holding the button down.
 *
 * **Rebounds are the reason a save feels like the start of something.** A save spills back out often
 * enough to matter, and the follow-up arrives with no wait and less time. Conceding to a rebound you
 * had already saved once is the most annoying thing in the game, which is precisely why it belongs.
 *
 * Feel note: this is the one I kept replaying. It is also the only one where the athlete is the whole
 * experience rather than a modifier on it — playing a novice keeper is genuinely, legibly hopeless,
 * and that is more instructive than any number on the athlete card.
 */
import { Button, wasPressed, type InputFrame } from '../../../engine/input/types.ts';
import type { Canvas2D } from '../../../engine/render/renderer.ts';
import { outcomeChance } from '../../../modes/arcade/meter.ts';
import { qualityLabel } from '../../../modes/arcade/scoring.ts';
import { ARCADE_COLOURS, label, mirrorX } from '../../../modes/arcade/draw.ts';
import type {
  ArcadeGameDef,
  ArcadeGameView,
  ArcadeHost,
  ArcadeLayout,
  ArcadeSession,
} from '../../../modes/arcade/types.ts';
import { ARCADE_UNLOCKS } from '../../../achievements/ids.ts';
import { SOCCER_ARCADE_SPORT, saveEvent, soccerCalibration } from './shared.ts';

/** How long a run lasts. The only clocked game in soccer's set (`09` §3.1 — 20–90 s). */
export const LAST_LINE_SECONDS = 45;

/** Seconds between one shot resolving and the next shooter setting themselves. */
const WAIT = { min: 0.45, max: 1.35 } as const;

/** A rebound comes straight back, so it gets the shortest wait there is. */
const REBOUND_WAIT = 0.22;

/** How much less time a rebound gives you than a first shot. */
const REBOUND_URGENCY = 0.7;

/** How often a save spills back out rather than being held. */
const REBOUND_CHANCE = 0.35;

/**
 * How hard the shot itself is, independent of the reaction.
 *
 * A shot into the corner beats a keeper who got there; one straight at them does not. This is the
 * shot's own difficulty and it scales the athlete's outcome band rather than the window — the
 * window is the athlete's and nothing else touches it (INV-10).
 */
const PLACEMENT = { tame: 1, corner: 0.55 } as const;

/** Never less than this long to react, however fast the shot and however raw the keeper. */
const MIN_REACTION_SECONDS = 0.16;

const POINTS_PER_SAVE = 90;
/** What keeping out a shot placed in the corner is worth on top of the save. */
const POINTS_PER_CORNER = 70;
const STREAK_BONUS = 25;
const MAX_STREAK_BONUS = 250;

/** Seconds an outcome stays on screen before the next shooter sets. */
const SHOW_SECONDS = 0.45;

type Stage = 'wait' | 'react' | 'show';

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

class LastLineSession implements ArcadeSession {
  readonly prompt = 'Keep them out. React, do not guess.';

  private readonly host: ArcadeHost;
  private stage: Stage = 'wait';
  private clock = 0;
  private streak = 0;
  private caption = 'Set yourself';

  /** How far through the reaction allowance the shot is, `0–1`. */
  private travel = 0;
  /** Seconds this shot allows — the athlete's reaction time, shortened on a rebound. */
  private allowance: number = MIN_REACTION_SECONDS;
  /** How well placed this shot is: `1` is at the keeper, `PLACEMENT.corner` is in the corner. */
  private placement: number = PLACEMENT.tame;
  /** Whether this shot is a rebound off the last save. */
  private rebound = false;
  /** Where the shot is headed across the frame, for the picture only. */
  private side = 0.5;
  /** Whether the last shot was kept out, for the picture. */
  private saved: boolean | null = null;

  constructor(host: ArcadeHost) {
    this.host = host;
    this.nextShot(false);
  }

  update(input: InputFrame, dt: number): void {
    if (this.stage === 'show') {
      this.clock -= dt;
      if (this.clock <= 0) this.nextShot(this.rebound);
      return;
    }

    if (this.stage === 'wait') {
      this.clock -= dt;
      // Committing before the strike is a keeper diving early, and it is beaten every time. This is
      // what stops the game being solved by holding the button down.
      if (wasPressed(input, Button.A)) {
        this.settle(false, 0, 'Dived early');
        return;
      }
      if (this.clock <= 0) {
        this.stage = 'react';
        this.travel = 0;
        this.caption = this.rebound ? 'Rebound!' : 'Struck';
      }
      return;
    }

    this.travel += dt / this.allowance;
    if (wasPressed(input, Button.A)) {
      this.dive();
      return;
    }
    // The shot beats a keeper who never moved. Standing still is a choice and it is the wrong one.
    if (this.travel >= 1) this.settle(false, 0, 'Beaten');
  }

  /**
   * How good the reaction was: `1` on the instant of the strike, `0` as it crosses the line.
   *
   * That is then read through the athlete's outcome band — a keeper who gets there still has to keep
   * it out, and where the shot was placed decides how much of the band is available (`09` §2.4).
   */
  private dive(): void {
    const promptness = clamp01(1 - this.travel);
    const chance = outcomeChance(this.host.calibration, promptness) * this.placement;
    const saved = this.host.rng.next() < chance;
    this.settle(saved, promptness, saved ? qualityLabel(promptness) : 'Got a hand to it');
  }

  private settle(saved: boolean, quality: number, said: string): void {
    this.caption = said;
    this.saved = saved;
    this.streak = saved ? this.streak + 1 : 0;

    this.host.attempt({
      made: saved,
      points: saved ? this.savePoints() : 0,
      quality,
      label: said,
      // A clocked run has no lives to spend: conceding costs you the shot and the streak, and the
      // clock is what ends the run.
      costsLife: false,
      events: saved ? [saveEvent()] : [],
    });

    this.stage = 'show';
    this.clock = SHOW_SECONDS;
    // Only a save can spill. A goal is not a rebound, whatever it felt like.
    this.rebound = saved && this.host.rng.next() < REBOUND_CHANCE;
  }

  private savePoints(): number {
    // A corner is worth more than one at you, in proportion to how much less of the band it left.
    const cornerBonus = Math.round(POINTS_PER_CORNER * (1 - this.placement));
    return POINTS_PER_SAVE + cornerBonus + Math.min(MAX_STREAK_BONUS, this.streak * STREAK_BONUS);
  }

  private nextShot(rebound: boolean): void {
    // Three draws, every shot without exception, whether or not it is a rebound (INV-8).
    const wait = WAIT.min + this.host.rng.next() * (WAIT.max - WAIT.min);
    this.placement = PLACEMENT.corner + this.host.rng.next() * (PLACEMENT.tame - PLACEMENT.corner);
    this.side = 0.12 + this.host.rng.next() * 0.76;

    this.rebound = rebound;
    this.allowance = Math.max(
      MIN_REACTION_SECONDS,
      this.host.calibration.reactionSeconds * (rebound ? REBOUND_URGENCY : 1),
    );
    this.stage = 'wait';
    this.clock = rebound ? REBOUND_WAIT : wait;
    this.travel = 0;
    this.saved = null;
    this.caption = rebound ? 'It is still live' : 'Set yourself';
  }

  view(): ArcadeGameView {
    return {
      // Nothing to react to until the ball is struck — and the band spans the whole track, which is
      // how a countdown is told apart from a sweep.
      meter: this.stage === 'react' ? clamp01(this.travel) : null,
      target: this.stage === 'react' ? { from: 0, to: 1 } : null,
      caption: this.caption,
      urgency: this.stage === 'react' ? clamp01(this.travel) : 0,
    };
  }

  draw(ctx: Canvas2D, layout: ArcadeLayout): void {
    const left = layout.width * 0.1;
    const width = layout.width * 0.8;
    const top = layout.height * 0.2;
    const height = layout.height * 0.42;
    const at = (x: number): number => mirrorX(left + width * x, layout);

    ctx.fillStyle = ARCADE_COLOURS.court;
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = ARCADE_COLOURS.line;
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, width, height);

    // The ball, coming at you: across towards its side and down the frame as the allowance runs out.
    if (this.stage === 'react') {
      const y = top + height * (0.08 + 0.84 * clamp01(this.travel));
      ctx.fillStyle = ARCADE_COLOURS.marker;
      ctx.beginPath();
      ctx.arc(at(this.side), y, Math.max(7, layout.width * 0.022), 0, Math.PI * 2);
      ctx.fill();
    }

    // The keeper, across the foot of the goal. Green when the last one was kept out, so the outcome
    // is readable from the picture as well as from the caption — never from colour alone.
    const keeperY = top + height - 14;
    ctx.fillStyle = this.saved === true ? ARCADE_COLOURS.band : ARCADE_COLOURS.danger;
    ctx.fillRect(at(0.5) - width * 0.09, keeperY, width * 0.18, 14);

    label(ctx, this.caption, layout.width / 2, layout.height * 0.12, { size: 22 });
    label(ctx, `${this.allowance.toFixed(2)} s to react`, layout.width / 2, top + height + 28, {
      size: 14,
      colour: ARCADE_COLOURS.dim,
    });
  }
}

export const lastLineGame: ArcadeGameDef = {
  id: 'soccer.last-line',
  sport: SOCCER_ARCADE_SPORT,
  name: 'Last Line',
  blurb: 'Forty-five seconds in goal. React, do not guess.',
  durationSeconds: LAST_LINE_SECONDS,
  unlockAchievement: ARCADE_UNLOCKS.cleanSheet.id,
  // The only clocked run in soccer's set: a keeper's game is a volley, not a count of chances.
  scored: { lives: null, seconds: LAST_LINE_SECONDS },
  stars: [700, 1600, 2800],
  // Getting there, and keeping it out once you have.
  ratings: ['offBall', 'goalkeeping'],
  calibrate: (athlete, difficulty) =>
    soccerCalibration(athlete, difficulty, ['offBall', 'goalkeeping']),
  mount: (host) => new LastLineSession(host),
};
