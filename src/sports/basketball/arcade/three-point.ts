/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.6 — Three-Point Contest — five racks, rhythm and timing, 60 s
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.2 (the launch set), 06-game-design.md §3.1 (shooting)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: five racks, twenty-five balls, sixty seconds. Timing, and then rhythm on top of timing.
 *
 * **Rhythm is the second skill.** With only a release meter this is Free Throw with a clock, so the
 * contest adds the thing that actually distinguishes a shooter in a rack: a repeatable tempo. Shots
 * released at a steady interval pay a rhythm bonus that grows the longer the tempo holds and resets
 * the moment it breaks. It rewards flow rather than speed — mashing scores worse than a metronome —
 * which is why the bonus keys on the *variance* between releases rather than on how short they are.
 *
 * **The money ball** is the last ball of each rack, worth two, exactly as the real contest scores it.
 * It is the one moment where taking an extra half-second is right, and it is the only reason the
 * rhythm bonus has a decision in it at all.
 *
 * Feel note: rack four with fifteen seconds left is where it comes alive — you can feel yourself
 * choosing between the tempo bonus and getting the money ball off.
 */
import { Button, wasPressed, type InputFrame } from '../../../engine/input/types.ts';
import type { Canvas2D } from '../../../engine/render/renderer.ts';
import { ReleaseMeter, resolveShot } from '../../../modes/arcade/meter.ts';
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
  mirrorX,
  shotEvents,
} from './shared.ts';

export const RACKS = 5;
export const BALLS_PER_RACK = 5;
const CONTEST_SECONDS = 60;

/** `06` §3.1 geometry — the five spots run corner to corner, all beyond the arc. */
const SPOT_DISTANCE_M = [7.0, 7.1, 7.24, 7.1, 7.0] as const;

/**
 * Which zone each rack shoots from, in basketball's own vocabulary (`xp.ts`). The racks really do
 * run corner → wing → top → wing → corner, so the sub-skill a rack trains is the sub-skill that
 * spot trains in a match.
 */
const SPOT_ZONE = ['cornerThree', 'wingThree', 'topThree', 'wingThree', 'cornerThree'] as const;

const POINTS_PER_MAKE = 100;
const MONEY_BALL_POINTS = 200;

/** Seconds between releases that count as "in tempo", and how much drift is tolerated. */
const TEMPO_TOLERANCE = 0.28;
const RHYTHM_BONUS = 40;
const MAX_RHYTHM = 5;

/** A rack change costs a beat — the tempo cannot carry across the walk. */
const RACK_CHANGE_SECONDS = 0.9;
const RESET_SECONDS = 0.3;

class ThreePointSession implements ArcadeSession {
  readonly prompt = 'Five racks, sixty seconds. Last ball is worth two.';

  private readonly host: ArcadeHost;
  private readonly meter: ReleaseMeter;

  private rack = 0;
  private ball = 0;
  private cooldown = 0;
  private caption = 'Rack 1';
  private sinceRelease = 0;
  private lastInterval: number | null = null;
  private rhythm = 0;

  constructor(host: ArcadeHost) {
    this.host = host;
    this.meter = new ReleaseMeter({ calibration: host.calibration, rng: host.rng });
  }

  /** The last ball of a rack is the money ball. */
  private get isMoneyBall(): boolean {
    return this.ball === BALLS_PER_RACK - 1;
  }

  update(input: InputFrame, dt: number): void {
    this.sinceRelease += dt;

    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.meter.reset();
      return;
    }

    this.meter.update(dt);
    if (wasPressed(input, Button.A)) this.release();
  }

  private release(): void {
    const { quality, inBand } = this.meter.judge();
    const made = inBand && resolveShot(this.host.calibration, quality, this.host.rng);
    const money = this.isMoneyBall;

    this.updateRhythm();

    const base = made ? (money ? MONEY_BALL_POINTS : POINTS_PER_MAKE) : 0;
    const bonus = made ? this.rhythm * RHYTHM_BONUS : 0;

    this.caption = made ? (money ? 'Money ball!' : 'Good') : 'Off the rim';

    this.host.attempt({
      made,
      points: base + bonus,
      quality,
      label: this.rhythm > 1 && made ? `${this.caption} · ${this.rhythm}× rhythm` : this.caption,
      // A clock-limited contest has no lives to lose; a miss costs the ball and the tempo, which is
      // punishment enough, and ending the run on a miss would make the clock meaningless.
      costsLife: false,
      events: shotEvents({
        made,
        points: 3,
        zone: SPOT_ZONE[this.rack] ?? 'topThree',
        distance: SPOT_DISTANCE_M[this.rack] ?? 7.24,
      }),
    });

    this.advance();
  }

  /**
   * The tempo test: two consecutive intervals within `TEMPO_TOLERANCE` of each other extend the
   * streak. Keyed on the *difference* between intervals rather than on their length, so a steady
   * slow rhythm counts and frantic mashing does not.
   */
  private updateRhythm(): void {
    const interval = this.sinceRelease;
    const previous = this.lastInterval;
    if (previous !== null && Math.abs(interval - previous) <= TEMPO_TOLERANCE) {
      this.rhythm = Math.min(MAX_RHYTHM, this.rhythm + 1);
    } else {
      this.rhythm = 0;
    }
    this.lastInterval = interval;
    this.sinceRelease = 0;
  }

  private advance(): void {
    this.ball++;
    if (this.ball < BALLS_PER_RACK) {
      this.cooldown = RESET_SECONDS;
      return;
    }

    this.ball = 0;
    this.rack++;
    if (this.rack >= RACKS) {
      this.host.finish('complete');
      return;
    }

    // Walking to the next rack breaks the tempo, so the bonus starts again from nothing.
    this.rhythm = 0;
    this.lastInterval = null;
    this.cooldown = RACK_CHANGE_SECONDS;
    this.caption = `Rack ${this.rack + 1}`;
  }

  view(): ArcadeGameView {
    return {
      meter: this.meter.position,
      target: this.meter.band(),
      caption: this.caption,
      urgency: this.host.remaining === null ? 0 : 1 - this.host.remaining / CONTEST_SECONDS,
    };
  }

  draw(ctx: Canvas2D, layout: ArcadeLayout): void {
    drawMeter(ctx, layout, { position: this.meter.position, band: this.meter.band() });
    label(ctx, this.caption, layout.width / 2, layout.height * 0.1, { size: 22 });

    // The rack strip: one pip per ball, the money ball drawn larger as well as differently coloured.
    const pipY = layout.height * 0.88;
    const spacing = Math.min(28, layout.width / (BALLS_PER_RACK + 2));
    for (let i = 0; i < BALLS_PER_RACK; i++) {
      const x = mirrorX(layout.width / 2 + (i - (BALLS_PER_RACK - 1) / 2) * spacing, layout);
      const money = i === BALLS_PER_RACK - 1;
      const shot = i < this.ball;
      ctx.beginPath();
      ctx.arc(x, pipY, money ? 9 : 6, 0, Math.PI * 2);
      ctx.fillStyle = shot
        ? ARCADE_COLOURS.dim
        : money
          ? ARCADE_COLOURS.bandEdge
          : ARCADE_COLOURS.marker;
      ctx.fill();
    }

    if (this.rhythm > 1) {
      label(ctx, `${this.rhythm}× rhythm`, layout.width / 2, layout.height * 0.96, {
        size: 14,
        colour: ARCADE_COLOURS.bandEdge,
      });
    }
  }
}

export const threePointGame: ArcadeGameDef = {
  id: 'bball.three-point',
  sport: BASKETBALL_ARCADE_SPORT,
  name: 'Three-Point Contest',
  blurb: 'Five racks in sixty seconds. Keep a rhythm; the last ball counts double.',
  durationSeconds: CONTEST_SECONDS,
  unlockAchievement: ARCADE_UNLOCKS.threeThrees.id,
  scored: { lives: null, seconds: CONTEST_SECONDS },
  stars: [900, 1900, 3000],
  ratings: ['threePoint'],
  calibrate: (athlete, difficulty) => basketballCalibration(athlete, difficulty, ['threePoint']),
  mount: (host) => new ThreePointSession(host),
};
