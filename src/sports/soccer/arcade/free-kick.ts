/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.23 — Soccer arcade: Free Kick
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §3.2 ("curve and aim over a wall, wind and distance vary"),
 *          §3.1 (a run is 20–90 s), §2.4 (the fairness rule), 06-game-design.md §3.2 (soccer)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: soccer's dead-ball game — bend one round a wall, with the wind and the distance changing
 * under you every round.
 *
 * **The wall is a height gate, and the keeper is a width gate.** That split is the whole design.
 * `09` §3.2 asks for four things — curve, aim, wind, distance — and the temptation is to model them
 * as one blob of "shot quality". Instead each tap owns one axis:
 *
 * - **Aim** places the ball *across* the goal. The wind then drags it, so where you stop the marker
 *   is deliberately not where the ball ends up: you aim off and let it come back. That is the curve,
 *   and it is the only part of the game that asks you to think rather than to react.
 * - **Strike** decides *height*. Under the band the ball never clears the wall; over it, it clears
 *   the bar. Distance moves the band up — a thirty-metre kick needs more of everything — and
 *   narrows it, because the same forgiveness in seconds buys less from further out.
 *
 * Two taps, like the Shootout, and for the same reason: `ArcadeGameView` exposes one meter, so a
 * game with three axes would have to grow its own HUD vocabulary.
 *
 * **Why the band is drawn where it is, not where the goal is.** The aim band is the unguarded
 * stretch of goal *shifted back by the wind* — that is, where to stop the marker, not where the ball
 * should finish. A band that showed the target itself would be an instrument that lies about the
 * only interesting decision in the game. Showing the compensated line is the same honesty the
 * Shootout's aim band keeps when the keeper has not committed: the HUD tells you what it knows.
 *
 * Feel note: the wind is the thing. A kick you aimed a post's width outside the frame curling back
 * inside it is the single best moment in soccer's arcade set so far — and the rounds where the wind
 * is still are noticeably flatter, which is worth remembering if the range ever gets tuned down.
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
import { SOCCER_ARCADE_SPORT, shotEvents, soccerCalibration } from './shared.ts';

/**
 * Kicks in a scored run.
 *
 * **A count, not a clock**, for the reason the Shootout records: under a clock a novice's faster
 * meter hands them more attempts than a specialist gets, and the athlete's speed must make each
 * round harder rather than the run longer.
 */
export const FREE_KICK_ROUNDS = 10;

/**
 * How far out a kick is taken from, in metres. The near end is a shooting-practice free kick just
 * outside the box; the far end is the optimistic one.
 *
 * @spec-ref 06-game-design.md §3.2 — the pitch these distances are measured on
 */
export const FREE_KICK_DISTANCE = { min: 18, max: 32 } as const;

/** Beyond this, a kick is a long-range effort rather than one from the edge of the box. */
const LONG_RANGE_FROM_M = 24;

const POINTS_PER_GOAL = 120;
/** Points per metre beyond the near end — the reason to want the hard one. */
const POINTS_PER_METRE = 6;
const STREAK_BONUS = 35;
const MAX_STREAK_BONUS = 280;

/** How much faster the meter runs per round, and where the ramp stops. */
const RAMP_PER_ROUND = 0.06;
const MAX_RAMP = 1.7;

/** Seconds between an outcome landing and the next kick. */
const RESET_SECONDS = 0.7;

/**
 * Seconds to get each half of the kick away.
 *
 * A lives-only game with no per-stage limit never ends for a player who does not press — closed at
 * the seam here for the same reason the Shootout closes it, rather than rediscovered per game.
 */
const STAGE_SECONDS = 4;

/** How much of the frame a shot has to stay inside to be on target — the posts. */
const POST_EDGE = 0.06;

/** How far either side of themselves the keeper covers, in frame units. */
const KEEPER_REACH = 0.19;

/** Where the keeper can set themselves, in frame units. Never so wide that one gap vanishes. */
const KEEPER_RANGE = { from: 0.28, to: 0.72 } as const;

/** The most the wind can drag a kick across the frame, in frame units. */
const WIND_MAX = 0.11;

/** Below this the wind reads as still, and the caption says so rather than showing a lying arrow. */
const WIND_STILL = 0.02;

/** Where the strike band sits at the near and far ends of the range — height, as a meter position. */
const POWER_CENTRE = { near: 0.42, far: 0.76 } as const;

/** How much of the athlete's window a maximum-distance kick gives up. */
const DISTANCE_TIGHTENING = 0.28;

type Stage = 'aim' | 'power' | 'reset';

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** The wider of two stretches, by width. Ties go to the first, which is arbitrary and fine. */
function wider(a: ArcadeBand, b: ArcadeBand): ArcadeBand {
  return b.to - b.from > a.to - a.from ? b : a;
}

class FreeKickSession implements ArcadeSession {
  readonly prompt = 'Bend it round the wall.';

  private readonly host: ArcadeHost;
  private meter: ReleaseMeter;
  private stage: Stage = 'aim';
  private stageClock = STAGE_SECONDS;
  private cooldown = 0;
  private round = 0;
  private streak = 0;
  private caption = '';

  /** This round's kick: where from, which way the wind blows, and where the keeper has set. */
  private distance: number = FREE_KICK_DISTANCE.min;
  private wind = 0;
  private keeperCentre = 0.5;

  /** Where the marker was stopped in the aim stage — the line, before the wind gets to it. */
  private aim = 0.5;
  /** Where the ball finished, once it has been struck. `null` while the kick is still being set. */
  private placement: number | null = null;

  constructor(host: ArcadeHost) {
    this.host = host;
    this.meter = this.newMeter();
    this.beginRound();
  }

  update(input: InputFrame, dt: number): void {
    if (this.stage === 'reset') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.beginRound();
      return;
    }

    this.meter.update(dt);

    if (wasPressed(input, Button.A)) {
      if (this.stage === 'aim') this.lockAim();
      else this.strike();
      return;
    }

    this.stageClock -= dt;
    // Not kicking is a miss, and it costs a life like every other way of not scoring one.
    if (this.stageClock <= 0)
      this.settle({ scored: false, quality: 0, said: 'Too slow', costsLife: true });
  }

  // ── Aiming ────────────────────────────────────────────────────────────────

  /**
   * Where to stop the marker, in meter units.
   *
   * The unguarded stretches of goal are the two either side of the keeper; each is shifted back by
   * the wind, because the marker sets the *line* and the ball arrives somewhere else. Whichever of
   * the two survives that shift wider is the one worth showing — a band is a recommendation, and the
   * smaller gap is still there to be found by anyone who wants it.
   */
  aimBand(): ArcadeBand {
    const shift = (band: ArcadeBand): ArcadeBand => ({
      from: clamp01(band.from - this.wind),
      to: clamp01(band.to - this.wind),
    });
    const near = shift({ from: POST_EDGE, to: this.keeperCentre - KEEPER_REACH });
    const far = shift({ from: this.keeperCentre + KEEPER_REACH, to: 1 - POST_EDGE });
    const best = wider(near, far);
    // Both gaps closing is not reachable with the constants above, and a zero-width band would be
    // an unwinnable round rather than a hard one — so the frame is the honest fallback.
    return best.to > best.from ? best : { from: POST_EDGE, to: 1 - POST_EDGE };
  }

  /** The first pass sets the line; where the marker stopped *is* the aim. */
  private lockAim(): void {
    this.aim = this.meter.position;
    this.stage = 'power';
    this.stageClock = STAGE_SECONDS;
    this.caption = 'Strike';
    this.meter.reset();
  }

  // ── Striking ──────────────────────────────────────────────────────────────

  /**
   * The second pass strikes it, and decides height.
   *
   * Three separable things have to go right, which is what makes the game teachable: clear the wall
   * without clearing the bar, let the wind put the ball inside the posts, and put it somewhere the
   * keeper is not. Each has its own wording, so a miss says which one you got wrong.
   */
  private strike(): void {
    const { quality, inBand, early } = this.meter.judge();
    const placement = clamp01(this.aim + this.wind);
    this.placement = placement;

    const onTarget = placement > POST_EDGE && placement < 1 - POST_EDGE;
    const beatsKeeper = Math.abs(placement - this.keeperCentre) > KEEPER_REACH;

    // The athlete's own outcome band still decides a clean strike (`09` §2.4): a perfect release
    // from a novice is not a certainty, and this is where their dead-ball ability shows up.
    const struck = inBand && onTarget && resolveShot(this.host.calibration, quality, this.host.rng);
    const scored = struck && beatsKeeper;

    const said = !inBand
      ? early
        ? 'Into the wall'
        : 'Over the bar'
      : !onTarget
        ? 'Wide'
        : !beatsKeeper
          ? 'Keeper saves'
          : qualityLabel(quality);

    // A life is spent on a *player* error — the height, the line, or the corner — and never on the
    // athlete's outcome band coming up short. The same split the Shootout draws, and the reason a
    // novice's ceiling is a lower score rather than a shorter run.
    const playerError = !inBand || !onTarget || !beatsKeeper;
    this.settle({ scored, quality, said, costsLife: playerError });
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
        zone: this.distance >= LONG_RANGE_FROM_M ? 'longRange' : 'edgeOfBox',
        distance: this.distance,
      }),
    });

    this.round += 1;
    this.stage = 'reset';
    this.cooldown = RESET_SECONDS;
    if (this.round >= FREE_KICK_ROUNDS) this.host.finish('complete');
  }

  private goalPoints(): number {
    const forDistance = Math.round((this.distance - FREE_KICK_DISTANCE.min) * POINTS_PER_METRE);
    return POINTS_PER_GOAL + forDistance + Math.min(MAX_STREAK_BONUS, this.streak * STREAK_BONUS);
  }

  // ── Round plumbing ────────────────────────────────────────────────────────

  /** How far into the range this kick is, `0–1`. Drives the strike band and what a goal is worth. */
  private get reach(): number {
    const span = FREE_KICK_DISTANCE.max - FREE_KICK_DISTANCE.min;
    return (this.distance - FREE_KICK_DISTANCE.min) / span;
  }

  private newMeter(): ReleaseMeter {
    return new ReleaseMeter({
      calibration: this.host.calibration,
      // Height, not time: a longer kick has to be struck harder, so its band sits further up.
      centre: POWER_CENTRE.near + (POWER_CENTRE.far - POWER_CENTRE.near) * this.reach,
      windowScale: 1 - DISTANCE_TIGHTENING * this.reach,
      // The ramp is a property of how far into the run you are and never of how well you have been
      // doing, which is what keeps it clear of INV-10.
      speedScale: Math.min(MAX_RAMP, 1 + this.round * RAMP_PER_ROUND),
      rng: this.host.rng,
    });
  }

  private beginRound(): void {
    // Three draws, then the meter's two, every round without exception — a branch that skipped one
    // would shift every later draw in the run and break the golden seeds with it (INV-8).
    this.keeperCentre =
      KEEPER_RANGE.from + this.host.rng.next() * (KEEPER_RANGE.to - KEEPER_RANGE.from);
    this.wind = (this.host.rng.next() * 2 - 1) * WIND_MAX;
    this.distance =
      FREE_KICK_DISTANCE.min +
      this.host.rng.next() * (FREE_KICK_DISTANCE.max - FREE_KICK_DISTANCE.min);

    this.meter = this.newMeter();
    this.stage = 'aim';
    this.stageClock = STAGE_SECONDS;
    this.aim = 0.5;
    this.placement = null;
    this.caption = `${Math.round(this.distance)} m · ${windLabel(this.wind)}`;
  }

  view(): ArcadeGameView {
    return {
      meter: this.stage === 'reset' ? null : this.meter.position,
      target:
        this.stage === 'reset' ? null : this.stage === 'aim' ? this.aimBand() : this.meter.band(),
      caption: this.caption,
      urgency: Math.min(1, (this.meter.speedScale - 1) / (MAX_RAMP - 1)),
    };
  }

  draw(ctx: Canvas2D, layout: ArcadeLayout): void {
    drawGoal(ctx, layout, {
      keeper: this.keeperCentre,
      ball: this.placement,
      // The line you have chosen, before the wind gets to it — shown from the moment it is locked so
      // that the drift is something you watch happen rather than something you are told about.
      aim: this.stage === 'power' ? this.aim : null,
      wind: this.wind,
    });

    if (this.stage !== 'reset') {
      drawMeter(ctx, layout, {
        position: this.meter.position,
        band: this.stage === 'aim' ? this.aimBand() : this.meter.band(),
      });
    }

    label(ctx, this.caption, layout.width / 2, layout.height * 0.12, { size: 22 });
    label(
      ctx,
      `Kick ${Math.min(FREE_KICK_ROUNDS, this.round + 1)} of ${FREE_KICK_ROUNDS}`,
      layout.width / 2,
      layout.height * 0.94,
      { size: 14, colour: ARCADE_COLOURS.dim },
    );
  }
}

/** What the caption says about the wind. Words, never an arrow alone (`10` §11, T-4.12). */
export function windLabel(wind: number): string {
  if (Math.abs(wind) < WIND_STILL) return 'still';
  const strength = Math.abs(wind) > WIND_MAX * 0.6 ? 'strong' : 'light';
  return `${strength} wind ${wind > 0 ? '→' : '←'}`;
}

/**
 * The goalmouth, the wall at its foot, and the keeper. Everything is a *position* rather than a
 * colour, so the picture survives a colour-blind player and a monochrome screenshot (`10` §11).
 */
function drawGoal(
  ctx: Canvas2D,
  layout: ArcadeLayout,
  options: {
    readonly keeper: number;
    readonly ball: number | null;
    readonly aim: number | null;
    readonly wind: number;
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

  // The posts, marked, so "Wide" is something you can see coming.
  ctx.lineWidth = 1;
  for (const edge of [POST_EDGE, 1 - POST_EDGE]) {
    ctx.beginPath();
    ctx.moveTo(at(edge), top);
    ctx.lineTo(at(edge), top + height);
    ctx.stroke();
  }

  // The keeper: a block of goal that is not available.
  const keeperWidth = width * KEEPER_REACH * 2;
  ctx.fillStyle = ARCADE_COLOURS.danger;
  ctx.fillRect(at(options.keeper) - keeperWidth / 2, top, keeperWidth, height);

  // The wall, across the foot of the frame — the height a strike has to clear.
  const wallHeight = height * 0.22;
  ctx.fillStyle = ARCADE_COLOURS.line;
  ctx.fillRect(left, top + height - wallHeight, width, wallHeight);

  if (options.aim !== null) {
    ctx.strokeStyle = ARCADE_COLOURS.bandEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(at(options.aim), top);
    ctx.lineTo(at(options.aim), top + height);
    ctx.stroke();
  }

  if (options.ball !== null) {
    ctx.fillStyle = ARCADE_COLOURS.marker;
    ctx.beginPath();
    ctx.arc(
      at(options.ball),
      top + height * 0.5,
      Math.max(6, layout.width * 0.018),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  label(ctx, windLabel(options.wind), layout.width / 2, top + height + 28, {
    size: 14,
    colour: ARCADE_COLOURS.dim,
  });
}

export const freeKickGame: ArcadeGameDef = {
  id: 'soccer.free-kick',
  sport: SOCCER_ARCADE_SPORT,
  name: 'Free Kick',
  blurb: 'Aim off, let the wind bring it back, and clear the wall.',
  durationSeconds: 35,
  unlockAchievement: ARCADE_UNLOCKS.allStarWin.id,
  scored: { lives: 3, seconds: null },
  stars: [500, 1300, 2300],
  // The three the kick actually asks for: the placement, the strike, and the bend on it.
  ratings: ['finishing', 'shotPower', 'crossing'],
  calibrate: (athlete, difficulty) =>
    soccerCalibration(athlete, difficulty, ['finishing', 'shotPower', 'crossing']),
  mount: (host) => new FreeKickSession(host),
};
