/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.25 — Soccer arcade: Header
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §3.2 ("jump timing and direction on incoming crosses"),
 *          §3.1 (a run is 20–90 s), §2.4 (the fairness rule), 06-game-design.md §3.2 (soccer)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: attack the cross — win the jump, then pick where it goes.
 *
 * **The jump is contested, and that is this game's own idea.** Every other soccer mini-game times
 * you against a clock or a keeper. Here the thing you are timing against is *another jumper*: the
 * band is where you beat the defender to the ball, and it moves round the cross rather than sitting
 * in a fixed place. Go early and the defender is still rising into you; go late and you are under
 * it. There is no version of this where standing still is safe, which is the difference between a
 * header and a free kick.
 *
 * **A great leap buys hang time, and hang time is control.** Jump quality does not decide the goal —
 * it decides how *fast the direction meter runs* for the second tap. Hanging above everyone with the
 * ball dropping onto your forehead is the moment a header is actually decided, and the meter slowing
 * down is the only honest way to put that in a thumb. It is deliberately a different lever from
 * One-on-One's, which widens the band instead: a good touch gives you more *goal*, a good leap gives
 * you more *time*.
 *
 * **The cross type is the round-to-round variety, and it is drawn before your jump exists.** A
 * driven cross arrives fast and late and leaves the keeper rooted; a floated one hangs, which is
 * easier to attack and brings the keeper out to claim it. So the easier jump is the harder finish,
 * and neither cross is simply the good one.
 *
 * **Contact height comes from the sim, not from here.** `PASS_PROFILES.cross.arrivalHeight` is
 * 1.9 m because that is what a cross that is worth attacking arrives at, and the header model has
 * always been meant to hang off it (`06` §3.2). Reading it rather than restating it means a change
 * to what a cross *is* reaches this game for free.
 *
 * Feel note: the best of the three so far, and it is the contest that does it. Beating a defender to
 * a ball is a more interesting thing to be good at than beating a clock, and the floated cross —
 * slow jump, frantic finish — has a rhythm none of the others have.
 */
import { Button, wasPressed, type InputFrame } from '../../../engine/input/types.ts';
import type { Canvas2D } from '../../../engine/render/renderer.ts';
import { BASE_SWEEP_SECONDS, ReleaseMeter, resolveShot } from '../../../modes/arcade/meter.ts';
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
import { PASS_PROFILES } from '../passing.ts';
import { SOCCER_ARCADE_SPORT, shotEvents, soccerCalibration } from './shared.ts';

/** Crosses in a scored run. A count, not a clock. */
export const HEADER_ROUNDS = 10;

/**
 * The height a cross worth attacking arrives at, in metres.
 *
 * Read from the sim's own cross profile rather than restated, so this game and Live cannot disagree
 * about what a cross is.
 *
 * @spec-ref 06-game-design.md §3.2 — heading
 */
export const CONTACT_HEIGHT_M = PASS_PROFILES.cross.arrivalHeight;

/**
 * The two crosses, and the trade they represent.
 *
 * A **driven** ball is on you before you are ready but the keeper cannot come for it, so the goal is
 * open. A **floated** one hangs — an easy ball to attack, and the keeper claims the space in front
 * of goal while it is in the air. Neither is the good one, which is the point.
 */
export const CROSSES = {
  driven: { flightSeconds: 1.1, meetAt: 0.78, keeperReach: 0.14, distance: 9, label: 'Driven' },
  floated: { flightSeconds: 1.95, meetAt: 0.62, keeperReach: 0.26, distance: 6, label: 'Floated' },
} as const;
export type CrossKind = keyof typeof CROSSES;

/** How wide the jump window may get as a slice of the flight, whatever the arithmetic says. */
const JUMP_SLICE_LIMITS = { min: 0.07, max: 0.32 } as const;

/**
 * How far the defender's leap shifts the window, either way.
 *
 * The band moves round the cross rather than sitting still, which is the whole of "contested": what
 * you are timing is not the ball's arrival but the moment you get to it first.
 */
const CONTEST_SHIFT = 0.09;

/** How fast the direction meter runs after the worst and the best leap. Lower is more control. */
const HANG = { scrambled: 1.55, hanging: 0.62 } as const;

/** How much of the frame a header has to stay inside — the posts. */
const POST_EDGE = 0.07;

const POINTS_PER_GOAL = 130;
/** What winning the jump well is worth on top of the goal it set up. */
const POINTS_PER_LEAP = 60;
const STREAK_BONUS = 35;
const MAX_STREAK_BONUS = 280;

/**
 * How long you get to direct it, measured in **sweeps of the meter rather than in seconds**.
 *
 * This is not a stylistic choice, it is a correctness one. A better athlete's meter sweeps *slower*
 * — that is how the framework pays them — and the band sits wherever this round's gap is. Under a
 * fixed clock a specialist's marker could not physically reach a far-side gap before time ran out,
 * so the best athletes timed out on exactly the chances the worst ones converted, and the scoring
 * curve inverted: rating 55 out-scored rating 90. A sweep-denominated clock means "you get one look
 * and a bit" for everybody, which is the same promise at every rating.
 */
const DIRECT_SWEEPS = 1.25;

/** However fast the meter runs, nobody gets less than this to pick a corner. */
const MIN_DIRECT_SECONDS = 1.1;

/** Seconds between an outcome landing and the next cross. */
const RESET_SECONDS = 0.7;

type Stage = 'flight' | 'direct' | 'reset';

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

class HeaderSession implements ArcadeSession {
  readonly prompt = 'Beat them to it, then place it.';

  private readonly host: ArcadeHost;
  private meter: ReleaseMeter;
  private stage: Stage = 'flight';
  private round = 0;
  private streak = 0;
  private caption = '';

  /** How far through the cross's flight the ball is, `0–1`. One way, once. */
  private flight = 0;
  /** Which cross this is. */
  private cross: CrossKind = 'driven';
  /** Where the defender's leap has pushed the window, in flight units. */
  private contest = 0;
  /** Where the keeper has set themselves across the frame. */
  private keeperCentre = 0.5;

  /** How well the jump was won, `0–1`, once it is won. */
  private leap = 0;
  /** Seconds left to direct the header, and what it started at (for the urgency ring). */
  private clock = MIN_DIRECT_SECONDS;
  private clockFull = MIN_DIRECT_SECONDS;
  /** Where the header went, for the picture. `null` until it is met. */
  private placement: number | null = null;

  constructor(host: ArcadeHost) {
    this.host = host;
    this.meter = this.newMeter();
    this.beginRound();
  }

  private get profile(): (typeof CROSSES)[CrossKind] {
    return CROSSES[this.cross];
  }

  update(input: InputFrame, dt: number): void {
    if (this.stage === 'reset') {
      this.clock -= dt;
      if (this.clock <= 0) this.beginRound();
      return;
    }

    if (this.stage === 'flight') {
      this.flight += dt / this.profile.flightSeconds;
      if (wasPressed(input, Button.A)) {
        this.jump();
        return;
      }
      // The ball goes through. Not attacking a cross is a decision, and it is the wrong one.
      if (this.flight >= 1)
        this.settle({ scored: false, quality: 0, said: 'Let it go', costsLife: true });
      return;
    }

    this.meter.update(dt);
    if (wasPressed(input, Button.A)) {
      this.meet();
      return;
    }
    this.clock -= dt;
    if (this.clock <= 0)
      this.settle({ scored: false, quality: 0, said: 'Headed nowhere', costsLife: true });
  }

  // ── The jump ──────────────────────────────────────────────────────────────

  /**
   * When you beat the defender to it, as a slice of the flight.
   *
   * Centred on the cross's own meeting point and then shifted by however the defender jumped — so
   * the window is somewhere slightly different every round and cannot be learned as a number.
   */
  jumpBand(): ArcadeBand {
    const slice = this.host.calibration.windowSeconds / this.profile.flightSeconds;
    const half = Math.min(JUMP_SLICE_LIMITS.max, Math.max(JUMP_SLICE_LIMITS.min, slice));
    const centre = this.profile.meetAt + this.contest;
    return { from: clamp01(centre - half), to: clamp01(centre + half) };
  }

  private jump(): void {
    const band = this.jumpBand();
    const centre = (band.from + band.to) / 2;
    const half = Math.max(0.001, (band.to - band.from) / 2);
    const offset = Math.abs(this.flight - centre);

    if (offset >= half) {
      this.settle({
        scored: false,
        quality: 0,
        // Two different mistakes, and a player can only fix the one they are told about.
        said: this.flight < centre ? 'Beaten in the air' : 'Under it',
        costsLife: true,
      });
      return;
    }

    this.leap = 1 - offset / half;
    this.stage = 'direct';
    // Hang time is control: the better the leap, the slower the direction meter runs.
    this.meter.speedScale = HANG.scrambled + (HANG.hanging - HANG.scrambled) * this.leap;
    this.fitBandToOpening();
    this.meter.reset();
    this.clockFull = Math.max(
      MIN_DIRECT_SECONDS,
      (DIRECT_SWEEPS * BASE_SWEEP_SECONDS) / this.meter.sweepRate,
    );
    this.clock = this.clockFull;
    this.caption = `${qualityLabel(this.leap)} leap`;
  }

  /**
   * Shrinks the band to the opening, if the athlete's window is wider than the gap.
   *
   * **This is the fix for a bug that made a rating-90 athlete measure no better than a rating-75
   * one.** The band is centred on the gap; when it grew wider than the gap, part of it sat over the
   * keeper, so a press *inside the band* could still be claimed — and the better the athlete, the
   * more of their reward landed on unsafe ground. Now the band never exceeds the opening, so being
   * in the band is the whole truth and a wider window is unambiguously better. Run after
   * `speedScale` is set, because the band's width in meter units depends on how fast it sweeps.
   */
  private fitBandToOpening(): void {
    const open = this.openGoal();
    const gapHalf = (open.to - open.from) / 2;
    this.meter.windowScale = 1;
    this.meter.windowScale = Math.min(1, gapHalf / Math.max(0.001, this.meter.halfWidth));
  }

  // ── The direction ─────────────────────────────────────────────────────────

  /**
   * Where the goal is open: inside the posts, away from the keeper.
   *
   * The keeper's reach is the cross's, not the athlete's — a floated ball lets them claim the space
   * a driven one does not, which is the trade the two crosses exist for.
   */
  openGoal(): ArcadeBand {
    const reach = this.profile.keeperReach;
    const near = { from: POST_EDGE, to: this.keeperCentre - reach };
    const far = { from: this.keeperCentre + reach, to: 1 - POST_EDGE };
    const best = far.to - far.from > near.to - near.from ? far : near;
    return best.to > best.from ? best : { from: POST_EDGE, to: 1 - POST_EDGE };
  }

  private meet(): void {
    const { quality, inBand } = this.meter.judge();
    const placement = this.meter.position;
    this.placement = placement;

    // The band sits inside the opening (`fitBandToOpening`), so being in it *is* beating the keeper
    // and staying inside the posts. One check, and the athlete's window is the whole truth.
    const scored = inBand && resolveShot(this.host.calibration, quality, this.host.rng);

    // A miss still says where it went, because "wide" and "at the keeper" are different mistakes.
    const said = inBand
      ? scored
        ? qualityLabel(quality)
        : 'Straight at them'
      : placement <= POST_EDGE || placement >= 1 - POST_EDGE
        ? 'Over the bar'
        : Math.abs(placement - this.keeperCentre) <= this.profile.keeperReach
          ? 'Keeper claims it'
          : 'Glanced it';

    // A life is spent on a *player* error — the leap and the contact — and never on the athlete's
    // outcome band coming up short. The same split the Free Kick draws.
    this.settle({ scored, quality, said, costsLife: !inBand });
  }

  private settle(outcome: {
    scored: boolean;
    quality: number;
    said: string;
    costsLife: boolean;
  }): void {
    this.caption = outcome.said;
    this.streak = outcome.scored ? this.streak + 1 : 0;

    this.host.attempt({
      made: outcome.scored,
      points: outcome.scored ? this.goalPoints() : 0,
      quality: outcome.quality,
      label: outcome.said,
      costsLife: outcome.costsLife,
      events: shotEvents({
        made: outcome.scored,
        // A cross attacked at the near post is a six-yard header; a floated one is met further out.
        zone: this.profile.distance <= 6 ? 'sixYard' : 'penaltyArea',
        distance: this.profile.distance,
      }),
    });

    this.round += 1;
    this.stage = 'reset';
    this.clock = RESET_SECONDS;
    if (this.round >= HEADER_ROUNDS) this.host.finish('complete');
  }

  private goalPoints(): number {
    const leapBonus = Math.round(POINTS_PER_LEAP * this.leap);
    return POINTS_PER_GOAL + leapBonus + Math.min(MAX_STREAK_BONUS, this.streak * STREAK_BONUS);
  }

  // ── Round plumbing ────────────────────────────────────────────────────────

  /**
   * The direction meter, sitting on the gap this round's keeper has left.
   *
   * **The band is the athlete's, not the gap's**, which is the correction that made this game read
   * as a game. The first version scored placement against the opening directly, so the target was
   * the same width for a novice and a specialist and the only thing separating them was the outcome
   * roll — a rating-90 athlete measured barely better than a rating-30 one. Now the gap sets where
   * the band *is* and how forgiving it is relative to a reference opening, and the athlete sets its
   * width in seconds, exactly as everywhere else (INV-10).
   */
  private newMeter(): ReleaseMeter {
    const open = this.openGoal();
    return new ReleaseMeter({
      calibration: this.host.calibration,
      centre: (open.from + open.to) / 2,
      rng: this.host.rng,
    });
  }

  private beginRound(): void {
    // Three draws, then the meter's two, every round without exception (INV-8).
    this.cross = this.host.rng.next() < 0.5 ? 'driven' : 'floated';
    this.contest = (this.host.rng.next() * 2 - 1) * CONTEST_SHIFT;
    this.keeperCentre = 0.3 + this.host.rng.next() * 0.4;

    this.meter = this.newMeter();
    this.stage = 'flight';
    this.flight = 0;
    this.leap = 0;
    this.placement = null;
    this.caption = `${this.profile.label} cross`;
  }

  view(): ArcadeGameView {
    if (this.stage === 'reset') {
      return { meter: null, target: null, caption: this.caption, urgency: 0 };
    }
    if (this.stage === 'flight') {
      return {
        meter: clamp01(this.flight),
        target: this.jumpBand(),
        caption: this.caption,
        urgency: clamp01(this.flight),
      };
    }
    return {
      meter: this.meter.position,
      target: this.meter.band(),
      caption: this.caption,
      urgency: clamp01(1 - this.clock / this.clockFull),
    };
  }

  draw(ctx: Canvas2D, layout: ArcadeLayout): void {
    drawBox(ctx, layout, {
      keeper: this.keeperCentre,
      keeperReach: this.profile.keeperReach,
      open: this.stage === 'direct' ? this.meter.band() : null,
      ball: this.placement,
      // The cross coming in, drawn as the ball crossing the box while the flight runs.
      incoming: this.stage === 'flight' ? clamp01(this.flight) : null,
    });

    drawMeter(ctx, layout, {
      position: this.stage === 'flight' ? clamp01(this.flight) : this.meter.position,
      band: this.stage === 'flight' ? this.jumpBand() : this.meter.band(),
    });

    label(ctx, this.caption, layout.width / 2, layout.height * 0.12, { size: 20 });
    label(
      ctx,
      `Cross ${Math.min(HEADER_ROUNDS, this.round + 1)} of ${HEADER_ROUNDS}`,
      layout.width / 2,
      layout.height * 0.94,
      { size: 14, colour: ARCADE_COLOURS.dim },
    );
  }
}

/**
 * The six-yard box seen from the attacker: goal across the top, keeper in it, and the cross coming
 * in from the side. Positions carry the meaning; no colour is load-bearing (`10` §11, T-4.12).
 */
function drawBox(
  ctx: Canvas2D,
  layout: ArcadeLayout,
  options: {
    readonly keeper: number;
    readonly keeperReach: number;
    readonly open: ArcadeBand | null;
    readonly ball: number | null;
    readonly incoming: number | null;
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

  ctx.lineWidth = 1;
  for (const edge of [POST_EDGE, 1 - POST_EDGE]) {
    ctx.beginPath();
    ctx.moveTo(at(edge), top);
    ctx.lineTo(at(edge), top + height);
    ctx.stroke();
  }

  const keeperWidth = width * options.keeperReach * 2;
  ctx.fillStyle = ARCADE_COLOURS.danger;
  ctx.fillRect(at(options.keeper) - keeperWidth / 2, top, keeperWidth, height * 0.55);

  if (options.open !== null) {
    const from = at(options.open.from);
    const to = at(options.open.to);
    ctx.fillStyle = ARCADE_COLOURS.band;
    ctx.fillRect(Math.min(from, to), top, Math.abs(to - from), 10);
  }

  if (options.incoming !== null) {
    // The ball travelling across the box, and dropping as it comes.
    ctx.fillStyle = ARCADE_COLOURS.marker;
    ctx.beginPath();
    ctx.arc(
      at(0.05 + 0.9 * options.incoming),
      top + height * (0.2 + 0.5 * options.incoming),
      Math.max(5, layout.width * 0.014),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  if (options.ball !== null) {
    ctx.fillStyle = ARCADE_COLOURS.marker;
    ctx.beginPath();
    ctx.arc(at(options.ball), top + 5, Math.max(6, layout.width * 0.018), 0, Math.PI * 2);
    ctx.fill();
  }

  label(ctx, `${CONTACT_HEIGHT_M.toFixed(1)} m`, layout.width / 2, top + height + 26, {
    size: 13,
    colour: ARCADE_COLOURS.dim,
  });
}

export const headerGame: ArcadeGameDef = {
  id: 'soccer.header',
  sport: SOCCER_ARCADE_SPORT,
  name: 'Header',
  blurb: 'Attack the cross. Win the jump, then pick your corner.',
  durationSeconds: 35,
  unlockAchievement: ARCADE_UNLOCKS.headerScored.id,
  scored: { lives: 3, seconds: null },
  stars: [450, 1300, 2500],
  // Getting there, getting above them, and what you do with it.
  ratings: ['offBall', 'heading', 'finishing'],
  calibrate: (athlete, difficulty) =>
    soccerCalibration(athlete, difficulty, ['offBall', 'heading', 'finishing']),
  mount: (host) => new HeaderSession(host),
};
