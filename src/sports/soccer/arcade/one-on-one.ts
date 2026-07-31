/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.24 — Soccer arcade: One-on-One
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §3.2 ("timing the touch and the finish past an onrushing keeper"),
 *          §3.1 (a run is 20–90 s), §2.4 (the fairness rule), 06-game-design.md §3.2 (soccer)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: through on goal with the keeper coming out — take the touch, then finish.
 *
 * **The two taps are cause and effect, which is what makes this different from the other two.** In
 * the Shootout and the Free Kick the two taps are independent: place it, then strike it, and getting
 * the first right does not make the second easier. Here the first *is* the second's difficulty. The
 * touch decides how much goal is open, and the finish is played into whatever the touch left you.
 * A scuffed touch is not a failure, it is a harder finish — which is exactly what a one-on-one feels
 * like and is the reason `09` §3.2 names both halves in one line.
 *
 * **The approach is a countdown, not a sweep.** Every other meter in soccer's set bounces, so a
 * missed pass comes round again. A keeper closing you down does not come round again: the marker
 * runs once, from the ball leaving the last defender to the moment you are smothered, and there is
 * one moment in there worth taking. That moment is late — the keeper has to commit before you touch
 * it — so the honest window sits past the middle of the run and the temptation is always to go early.
 *
 * **Where the window comes from.** Its width in *seconds* is the athlete's, exactly as everywhere
 * else (INV-10). What varies per round is how long the approach lasts, so the same window in seconds
 * is a wider or narrower slice of the marker's travel depending on how fast this keeper came out.
 * That is the pressure, and it never touches who the athlete is.
 *
 * Feel note: the late window is the whole game. Going early feels safe and scores nothing, and it
 * took about six rounds before I stopped doing it — which is the right shape for a mini-game, but it
 * does mean the first run is discouraging in a way the Free Kick's is not.
 */
import { Button, wasPressed, type InputFrame } from '../../../engine/input/types.ts';
import type { Canvas2D } from '../../../engine/render/renderer.ts';
import { ReleaseMeter, resolveShot } from '../../../modes/arcade/meter.ts';
import { qualityLabel } from '../../../modes/arcade/scoring.ts';
import { ARCADE_COLOURS, drawMeter, label, mirrorX } from '../../../modes/arcade/draw.ts';
import type {
  ArcadeBand,
  ArcadeGameDef,
  ArcadeGameView,
  ArcadeHost,
  ArcadeLayout,
  ArcadeSession,
} from '../../../modes/arcade/types.ts';
import { ARCADE_UNLOCKS } from '../../../achievements/ids.ts';
import { PITCH } from '../pitch.ts';
import { SOCCER_ARCADE_SPORT, shotEvents, soccerCalibration } from './shared.ts';

/** Chances in a scored run. A count, not a clock — the athlete's speed must not buy more of them. */
export const ONE_ON_ONE_ROUNDS = 10;

/**
 * How long the approach lasts, in seconds — from through-on-goal to smothered.
 *
 * The spread is the round-to-round pressure: a keeper who comes flying out gives you a shorter run
 * and therefore a narrower slice of it to hit, without the athlete's window in seconds changing at
 * all.
 */
export const APPROACH_SECONDS = { min: 1.15, max: 2.05 } as const;

/**
 * Where in the approach the touch wants to be taken, as a fraction of it.
 *
 * Late, always, and that is the lesson the game teaches: the keeper has to commit before the touch
 * beats them, so a touch taken early goes round nobody.
 */
const TOUCH_AT = 0.67;

/**
 * How wide the touch window may get as a slice of the approach, whatever the arithmetic says.
 *
 * The floor keeps a novice's window visible rather than a pixel wide; the ceiling stops a
 * specialist's covering so much of a short approach that there is no timing left in it.
 */
const TOUCH_SLICE_LIMITS = { min: 0.04, max: 0.3 } as const;

/** How far from goal the chance falls, in metres, before the touch is taken. */
const CHANCE_DISTANCE = { min: 6, max: 15 } as const;

/** How much closer to goal a perfect touch takes you. */
const TOUCH_CLOSES = 0.35;

/**
 * How much goal a touch opens, as a scale on the finishing meter's band.
 *
 * A scuffed touch leaves a real chance rather than a dead one — `09` §2.4 again: the athlete's
 * window is the athlete's, and what the player did with the touch moves it within a range that
 * never reaches zero.
 */
const OPENING = { scuffed: 0.55, perfect: 1.75 } as const;

const POINTS_PER_GOAL = 110;
/** What a clean touch is worth on top of the goal it set up. */
const POINTS_PER_TOUCH = 70;
const STREAK_BONUS = 35;
const MAX_STREAK_BONUS = 280;

/** Seconds to get the finish away once the touch is taken. The keeper is still coming. */
const FINISH_SECONDS = 2.2;

/** Seconds between an outcome landing and the next chance. */
const RESET_SECONDS = 0.7;

/** How much faster the finishing meter runs per round, and where the ramp stops. */
const RAMP_PER_ROUND = 0.06;
const MAX_RAMP = 1.7;

type Stage = 'approach' | 'finish' | 'reset';

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

class OneOnOneSession implements ArcadeSession {
  readonly prompt = 'Take the touch late, then finish.';

  private readonly host: ArcadeHost;
  private meter: ReleaseMeter;
  private stage: Stage = 'approach';
  private round = 0;
  private streak = 0;
  private caption = '';

  /** How far through the approach the marker is, `0–1`. One way, once. */
  private advance = 0;
  /** Seconds this round's approach lasts. */
  private approachSeconds: number = APPROACH_SECONDS.min;
  /** How far out the chance fell, in metres. */
  private distance: number = CHANCE_DISTANCE.min;

  /** How good the touch was, `0–1`, once it has been taken. */
  private touch = 0;
  /** Seconds left to get the finish away. */
  private finishClock = FINISH_SECONDS;
  /** Where the finish was placed, for the picture. `null` until it is struck. */
  private placement: number | null = null;

  constructor(host: ArcadeHost) {
    this.host = host;
    this.meter = this.newMeter();
    this.beginRound();
  }

  update(input: InputFrame, dt: number): void {
    if (this.stage === 'reset') {
      this.finishClock -= dt;
      if (this.finishClock <= 0) this.beginRound();
      return;
    }

    if (this.stage === 'approach') {
      this.advance += dt / this.approachSeconds;
      if (wasPressed(input, Button.A)) {
        this.takeTouch();
        return;
      }
      // Running out of approach is being smothered. The keeper wins the ones you dither over.
      if (this.advance >= 1) this.settle({ scored: false, quality: 0, said: 'Smothered' });
      return;
    }

    this.meter.update(dt);
    if (wasPressed(input, Button.A)) {
      this.finish();
      return;
    }
    this.finishClock -= dt;
    if (this.finishClock <= 0) this.settle({ scored: false, quality: 0, said: 'Keeper recovers' });
  }

  // ── The touch ─────────────────────────────────────────────────────────────

  /**
   * When to take it, as a slice of the approach.
   *
   * The athlete's window is in *seconds*, so it becomes a wider or narrower slice depending on how
   * long this round's approach is — which is how a fast keeper makes the same athlete's touch
   * harder without making them a worse athlete.
   */
  touchBand(): ArcadeBand {
    const slice = this.host.calibration.windowSeconds / this.approachSeconds;
    const half = Math.min(TOUCH_SLICE_LIMITS.max, Math.max(TOUCH_SLICE_LIMITS.min, slice));
    return { from: clamp01(TOUCH_AT - half), to: clamp01(TOUCH_AT + half) };
  }

  private takeTouch(): void {
    const band = this.touchBand();
    const centre = (band.from + band.to) / 2;
    const half = Math.max(0.001, (band.to - band.from) / 2);
    const offset = Math.abs(this.advance - centre);

    if (offset >= half) {
      // Outside the window entirely. Early is the common one and it deserves its own wording,
      // because "you went too soon" is the single most useful thing this game can tell anybody.
      this.settle({
        scored: false,
        quality: 0,
        said: this.advance < centre ? 'Went too early' : 'Left it too late',
      });
      return;
    }

    this.touch = 1 - offset / half;
    this.stage = 'finish';
    this.finishClock = FINISH_SECONDS;
    // The touch *is* the finish's difficulty: a clean one takes you round the keeper and leaves the
    // goal open, a scuffed one leaves a chance you still have to bury.
    this.meter.windowScale = OPENING.scuffed + (OPENING.perfect - OPENING.scuffed) * this.touch;
    this.meter.reset();
    this.caption = `${qualityLabel(this.touch)} touch`;
  }

  // ── The finish ────────────────────────────────────────────────────────────

  private finish(): void {
    const { quality, inBand } = this.meter.judge();
    this.placement = this.meter.position;

    const scored = inBand && resolveShot(this.host.calibration, quality, this.host.rng);
    const said = !inBand ? (quality > 0 ? 'Keeper blocks' : 'Dragged wide') : qualityLabel(quality);

    this.settle({ scored, quality, said });
  }

  private settle(outcome: { scored: boolean; quality: number; said: string }): void {
    this.caption = outcome.said;
    this.streak = outcome.scored ? this.streak + 1 : 0;

    // How far out it was actually struck from — a good touch carries you closer to goal, and the
    // event stream should say so rather than reporting where the chance began.
    const struckFrom = this.distance * (1 - TOUCH_CLOSES * this.touch);

    this.host.attempt({
      made: outcome.scored,
      points: outcome.scored ? this.goalPoints() : 0,
      quality: outcome.quality,
      label: outcome.said,
      // Every way of not scoring here is the player's: the timing of the touch, and the finish they
      // played with whatever it left them.
      costsLife: !outcome.scored,
      events: shotEvents({
        made: outcome.scored,
        zone: struckFrom <= PITCH.goalAreaDepth ? 'sixYard' : 'penaltyArea',
        distance: struckFrom,
      }),
    });

    this.round += 1;
    this.stage = 'reset';
    this.finishClock = RESET_SECONDS;
    if (this.round >= ONE_ON_ONE_ROUNDS) this.host.finish('complete');
  }

  private goalPoints(): number {
    const touchBonus = Math.round(POINTS_PER_TOUCH * this.touch);
    return POINTS_PER_GOAL + touchBonus + Math.min(MAX_STREAK_BONUS, this.streak * STREAK_BONUS);
  }

  // ── Round plumbing ────────────────────────────────────────────────────────

  private newMeter(): ReleaseMeter {
    return new ReleaseMeter({
      calibration: this.host.calibration,
      // The ramp is a property of how far into the run you are and never of how well you have been
      // doing, which is what keeps it clear of INV-10.
      speedScale: Math.min(MAX_RAMP, 1 + this.round * RAMP_PER_ROUND),
      rng: this.host.rng,
    });
  }

  private beginRound(): void {
    // Two draws, then the meter's two, every round without exception (INV-8).
    this.approachSeconds =
      APPROACH_SECONDS.min + this.host.rng.next() * (APPROACH_SECONDS.max - APPROACH_SECONDS.min);
    this.distance =
      CHANCE_DISTANCE.min + this.host.rng.next() * (CHANCE_DISTANCE.max - CHANCE_DISTANCE.min);

    this.meter = this.newMeter();
    this.stage = 'approach';
    this.advance = 0;
    this.touch = 0;
    this.placement = null;
    this.caption = `${Math.round(this.distance)} m — through on goal`;
  }

  view(): ArcadeGameView {
    if (this.stage === 'reset') {
      return { meter: null, target: null, caption: this.caption, urgency: 0 };
    }
    if (this.stage === 'approach') {
      return {
        meter: clamp01(this.advance),
        target: this.touchBand(),
        caption: this.caption,
        // The keeper closing. This is the one meter in the set that only goes one way, so its
        // urgency is the marker itself rather than a ramp.
        urgency: clamp01(this.advance),
      };
    }
    return {
      meter: this.meter.position,
      target: this.meter.band(),
      caption: this.caption,
      urgency: clamp01(1 - this.finishClock / FINISH_SECONDS),
    };
  }

  draw(ctx: Canvas2D, layout: ArcadeLayout): void {
    drawApproach(ctx, layout, {
      keeper: this.stage === 'approach' ? clamp01(this.advance) : 1,
      opening: this.stage === 'finish' ? this.meter.band() : null,
      ball: this.placement,
    });

    drawMeter(ctx, layout, {
      position: this.stage === 'approach' ? clamp01(this.advance) : this.meter.position,
      band: this.stage === 'approach' ? this.touchBand() : this.meter.band(),
    });

    label(ctx, this.caption, layout.width / 2, layout.height * 0.12, { size: 20 });
    label(
      ctx,
      `Chance ${Math.min(ONE_ON_ONE_ROUNDS, this.round + 1)} of ${ONE_ON_ONE_ROUNDS}`,
      layout.width / 2,
      layout.height * 0.94,
      { size: 14, colour: ARCADE_COLOURS.dim },
    );
  }
}

/**
 * The goal, the keeper coming out of it, and — once the touch is taken — how much of it is open.
 * The keeper's *position* carries the pressure, so the picture works with no colour at all
 * (`10` §11, T-4.12).
 */
function drawApproach(
  ctx: Canvas2D,
  layout: ArcadeLayout,
  options: {
    readonly keeper: number;
    readonly opening: ArcadeBand | null;
    readonly ball: number | null;
  },
): void {
  const left = layout.width * 0.12;
  const width = layout.width * 0.76;
  const top = layout.height * 0.22;
  const height = layout.height * 0.36;
  const at = (value: number): number => mirrorX(left + width * value, layout);

  ctx.fillStyle = ARCADE_COLOURS.court;
  ctx.fillRect(left, top, width, height);
  ctx.strokeStyle = ARCADE_COLOURS.line;
  ctx.lineWidth = 3;
  ctx.strokeRect(left, top, width, height);

  // The keeper, advancing down the frame towards you as the approach runs out.
  const keeperY = top + height * (0.12 + 0.74 * options.keeper);
  const keeperWidth = width * (0.24 + 0.4 * options.keeper);
  ctx.fillStyle = ARCADE_COLOURS.danger;
  ctx.fillRect(at(0.5) - keeperWidth / 2, keeperY - 8, keeperWidth, 16);

  if (options.opening !== null) {
    // What the touch left you, drawn across the goal line at the top of the frame.
    const from = at(options.opening.from);
    const to = at(options.opening.to);
    ctx.fillStyle = ARCADE_COLOURS.band;
    ctx.fillRect(Math.min(from, to), top, Math.abs(to - from), 10);
  }

  if (options.ball !== null) {
    ctx.fillStyle = ARCADE_COLOURS.marker;
    ctx.beginPath();
    ctx.arc(at(options.ball), top + 5, Math.max(6, layout.width * 0.018), 0, Math.PI * 2);
    ctx.fill();
  }
}

export const oneOnOneGame: ArcadeGameDef = {
  id: 'soccer.one-on-one',
  sport: SOCCER_ARCADE_SPORT,
  name: 'One-on-One',
  blurb: 'Through on goal. Take the touch late, then pick your spot.',
  durationSeconds: 35,
  unlockAchievement: ARCADE_UNLOCKS.twentyGoals.id,
  scored: { lives: 3, seconds: null },
  stars: [450, 1300, 2500],
  // The run, the touch, and the finish, in the order they happen.
  ratings: ['pace', 'dribbling', 'finishing'],
  calibrate: (athlete, difficulty) =>
    soccerCalibration(athlete, difficulty, ['pace', 'dribbling', 'finishing']),
  mount: (host) => new OneOnOneSession(host),
};
