/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.5 — Free Throw — release timing under mounting pressure
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §3.2 (the launch set), §3.3, 06-game-design.md §3.1 (shooting)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: the simplest game in the set, and therefore the one that has to be perfect. One meter,
 * one button, three misses. Everything else is pressure.
 *
 * **The pressure ramp is the game.** A free throw with a static meter is a metronome test that stops
 * being interesting on the fourth shot. So every make speeds the meter up and narrows nothing: the
 * band stays exactly as wide as the athlete earned, in *seconds*, and the marker crossing it faster
 * is what turns a comfortable window into a nervy one. That distinction matters — narrowing the band
 * as you succeed would be difficulty that reacts to your scores, which is the thing INV-10 exists to
 * forbid. Speeding the meter is a property of the run, applies from the first shot to everyone
 * equally, and leaves who the athlete is untouched.
 *
 * Feel note: the streak counter climbing while the meter accelerates is the whole hook — around
 * shot eight it stops being a timing test and becomes a nerve test, which is what a free throw is.
 */
import { Button, wasPressed, type InputFrame } from '../../../engine/input/types.ts';
import type { Canvas2D } from '../../../engine/render/renderer.ts';
import { ReleaseMeter, resolveShot } from '../../../modes/arcade/meter.ts';
import { qualityLabel } from '../../../modes/arcade/scoring.ts';
import type {
  ArcadeGameDef,
  ArcadeGameView,
  ArcadeHost,
  ArcadeLayout,
  ArcadeSession,
} from '../../../modes/arcade/types.ts';
import { ARCADE_UNLOCKS } from '../../../achievements/ids.ts';
import {
  ARCADE_COLOURS,
  BASKETBALL_ARCADE_SPORT,
  basketballCalibration,
  drawMeter,
  label,
  shotEvents,
} from './shared.ts';

/**
 * Shots in a scored run.
 *
 * **A count, not a clock.** A novice's meter runs *faster* (`09` §2.4), and under a clock that hands
 * them more attempts per run — enough, measured, to outscore a specialist outright. The athlete's
 * speed is meant to make each shot harder, not to make the run longer, so the run is a fixed number
 * of shots and the meter's pace decides only how hard each one is.
 */
const SHOTS_PER_RUN = 20;

/** `06` §3.1 — a free throw is 4.6 m from the basket, and always the same shot. */
const FREE_THROW_DISTANCE_M = 4.6;

const POINTS_PER_MAKE = 100;
/** Each consecutive make is worth more, up to a cap — the reason a run is worth continuing. */
const STREAK_BONUS = 25;
const MAX_STREAK_BONUS = 200;

/** How much faster the meter runs per make, and where the ramp stops. */
const RAMP_PER_MAKE = 0.09;
const MAX_RAMP = 2.4;

/** Seconds between the outcome landing and the next shot starting. */
const RESET_SECONDS = 0.55;

/**
 * Seconds to get the shot off. The rulebook gives a shooter ten; five is the arcade reading of the
 * same rule, and it exists for a reason a rulebook does not care about: a lives-only game with no
 * per-attempt limit never ends for a player who simply does not shoot. Found by the "a player who
 * never touches the screen still finishes" test, which is exactly what it is for.
 */
const SHOT_CLOCK_SECONDS = 5;

class FreeThrowSession implements ArcadeSession {
  readonly prompt = 'Tap when the marker hits the band.';

  private readonly host: ArcadeHost;
  private readonly meter: ReleaseMeter;
  private cooldown = 0;
  private shotClock = SHOT_CLOCK_SECONDS;
  private shots = 0;
  private makes = 0;
  private caption = 'Shoot';

  constructor(host: ArcadeHost) {
    this.host = host;
    this.meter = new ReleaseMeter({ calibration: host.calibration, rng: host.rng });
  }

  update(input: InputFrame, dt: number): void {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        this.meter.reset();
        this.shotClock = SHOT_CLOCK_SECONDS;
        this.caption = 'Shoot';
      }
      return;
    }

    this.meter.update(dt);
    if (wasPressed(input, Button.A)) {
      this.release();
      return;
    }

    this.shotClock -= dt;
    if (this.shotClock <= 0) this.violation();
  }

  /** Not shooting is a miss. It costs a life, like every other way of not making one. */
  private violation(): void {
    this.caption = 'Shot clock';
    this.host.attempt({ made: false, points: 0, quality: 0, label: 'Shot clock', events: [] });
    this.nextShot();
  }

  private release(): void {
    const { quality, inBand, early } = this.meter.judge();
    const made = inBand && resolveShot(this.host.calibration, quality, this.host.rng);

    // Missing does not reset the ramp: the pressure is a property of how far into the run you are,
    // not of how well you have been doing. It is the same for a player on eight makes and one on
    // eight attempts, which keeps it out of INV-10's way.
    if (made) this.makes++;
    this.meter.speedScale = Math.min(MAX_RAMP, 1 + this.makes * RAMP_PER_MAKE);

    const streakBonus = Math.min(MAX_STREAK_BONUS, this.makes * STREAK_BONUS);
    this.caption = made
      ? qualityLabel(quality)
      : inBand
        ? 'Rimmed out'
        : early
          ? 'Too early'
          : 'Too late';

    this.host.attempt({
      made,
      points: made ? POINTS_PER_MAKE + streakBonus : 0,
      quality,
      label: this.caption,
      // A life is spent on a *release* that was wrong, never on the athlete's outcome band coming up
      // short. `09` §2.4 splits the two — your input decides where in the band you land, the athlete
      // decides how wide it is — so what ends a run is your timing, and what fills the scoreboard is
      // the pair of you. A rim-out that ended the run would make a novice's ceiling a punishment.
      costsLife: !inBand,
      events: shotEvents({
        made,
        points: 1,
        zone: 'freeThrow',
        distance: FREE_THROW_DISTANCE_M,
      }),
    });

    this.nextShot();
  }

  /** Ends the run once the rack is done. */
  private nextShot(): void {
    this.shots++;
    this.cooldown = RESET_SECONDS;
    if (this.shots >= SHOTS_PER_RUN) this.host.finish('complete');
  }

  view(): ArcadeGameView {
    return {
      meter: this.meter.position,
      target: this.meter.band(),
      caption: this.caption,
      urgency: Math.min(1, (this.meter.speedScale - 1) / (MAX_RAMP - 1)),
    };
  }

  draw(ctx: Canvas2D, layout: ArcadeLayout): void {
    drawMeter(ctx, layout, { position: this.meter.position, band: this.meter.band() });
    label(ctx, this.caption, layout.width / 2, layout.height * 0.1, { size: 22 });
    label(ctx, `${this.makes} made`, layout.width / 2, layout.height * 0.94, {
      size: 14,
      colour: ARCADE_COLOURS.dim,
    });
  }
}

export const freeThrowGame: ArcadeGameDef = {
  id: 'bball.free-throw',
  sport: BASKETBALL_ARCADE_SPORT,
  name: 'Free Throw',
  blurb: 'Twenty shots. The meter gets faster every time you make one.',
  durationSeconds: 60,
  unlockAchievement: ARCADE_UNLOCKS.freeThrowMade.id,
  scored: { lives: 3, seconds: null },
  stars: [700, 2000, 3400],
  ratings: ['freeThrow'],
  calibrate: (athlete, difficulty) => basketballCalibration(athlete, difficulty, ['freeThrow']),
  mount: (host) => new FreeThrowSession(host),
};
