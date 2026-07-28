/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.7 — Buzzer Beater — contested shot, shrinking window
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.2 (the launch set), §2.4 (key moments), 06-game-design.md §3.1
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: one shot, a hand coming into your face, and a clock that is already running. Repeat for a
 * fifteen possessions, or until three of them get blocked.
 *
 * **The window shrinks *within* a possession, never between them.** Each possession starts with the
 * full window the athlete earned and closes it as the defender's hand rises — so waiting costs you,
 * and the cost is the same on the first possession as on the twentieth. That is deliberately the
 * opposite of shrinking it as you succeed: the pressure comes from the clock inside the moment
 * rather than from the scoreboard outside it, which keeps INV-10 intact and keeps the game honest
 * about what it is testing.
 *
 * **The shot clock is the actual mechanic.** You may take the shot at any moment; early is a wide
 * band and a low-value shot, late is a narrow band and a big one. The whole game is that trade,
 * made twenty times.
 *
 * Feel note: the good version of this is the one where you *know* you left it too late and shoot
 * anyway. The value ramp is what produces that, so it is steep on purpose.
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
  bar,
  drawMeter,
  label,
  mirrorX,
  shotEvents,
} from './shared.ts';

/**
 * Possessions in a scored run. A count rather than a clock, for the reason Free Throw explains.
 */
const POSSESSIONS_PER_RUN = 15;

/** Seconds on each possession's clock. Short enough that hesitating is a decision, not a pause. */
const POSSESSION_SECONDS = 4;
/** How far the band closes by the buzzer — never to nothing, or the last instant is unplayable. */
const MIN_WINDOW_SCALE = 0.35;

const BASE_POINTS = 130;
/** Points at the buzzer. The ramp is steep because the whole game is the temptation to wait. */
const MAX_POINTS = 620;

const RESET_SECONDS = 0.6;
const THREE_DISTANCE_M = 7.24;

class BuzzerBeaterSession implements ArcadeSession {
  readonly prompt = 'Shoot before the buzzer. Later is worth more.';

  private readonly host: ArcadeHost;
  private readonly meter: ReleaseMeter;
  private clock = POSSESSION_SECONDS;
  private cooldown = 0;
  private possessions = 0;
  private caption = 'Shoot';

  constructor(host: ArcadeHost) {
    this.host = host;
    this.meter = new ReleaseMeter({ calibration: host.calibration, rng: host.rng });
  }

  /** `0–1` through the possession. Drives both the closing window and the shot's value. */
  private get pressure(): number {
    return 1 - Math.max(0, this.clock) / POSSESSION_SECONDS;
  }

  update(input: InputFrame, dt: number): void {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.startPossession();
      return;
    }

    this.clock -= dt;
    this.meter.windowScale = 1 - (1 - MIN_WINDOW_SCALE) * this.pressure;
    this.meter.update(dt);

    if (wasPressed(input, Button.A)) {
      this.release();
      return;
    }

    if (this.clock <= 0) this.buzzer();
  }

  private startPossession(): void {
    this.clock = POSSESSION_SECONDS;
    this.meter.windowScale = 1;
    this.meter.reset();
    this.caption = 'Shoot';
  }

  private release(): void {
    const { quality, inBand } = this.meter.judge();
    const made = inBand && resolveShot(this.host.calibration, quality, this.host.rng);
    const value = Math.round(BASE_POINTS + (MAX_POINTS - BASE_POINTS) * this.pressure);
    const late = this.pressure > 0.8;

    this.caption = made ? (late ? 'Buzzer beater!' : 'Bucket') : inBand ? 'Contested' : 'Blocked';

    this.host.attempt({
      made,
      points: made ? value : 0,
      quality,
      label: this.caption,
      // Getting blocked is a bad decision and costs a life; a contested shot that rimmed out is the
      // athlete's outcome band doing its job, and does not (`09` §2.4).
      costsLife: !inBand,
      events: shotEvents({
        made,
        points: 3,
        zone: 'topThree',
        distance: THREE_DISTANCE_M,
      }),
    });

    this.nextPossession();
  }

  /** Letting the clock run out is a miss, and reads as one. */
  private buzzer(): void {
    this.caption = 'No shot';
    this.host.attempt({
      made: false,
      points: 0,
      quality: 0,
      label: 'No shot',
      events: [],
    });
    this.nextPossession();
  }

  private nextPossession(): void {
    this.possessions++;
    this.cooldown = RESET_SECONDS;
    if (this.possessions >= POSSESSIONS_PER_RUN) this.host.finish('complete');
  }

  view(): ArcadeGameView {
    return {
      meter: this.meter.position,
      target: this.meter.band(),
      caption: this.caption,
      urgency: this.cooldown > 0 ? 0 : this.pressure,
    };
  }

  draw(ctx: Canvas2D, layout: ArcadeLayout): void {
    drawMeter(ctx, layout, { position: this.meter.position, band: this.meter.band() });
    label(ctx, this.caption, layout.width / 2, layout.height * 0.1, { size: 22 });

    // The possession clock as a draining bar. Reduced motion gets the same bar without the pulse the
    // renderer would otherwise add (T-4.12) — the information is in the length, not the movement.
    const width = layout.width * 0.6;
    const x = mirrorX(layout.width / 2 - width / 2, layout);
    bar(ctx, x, layout.height * 0.05, width, 8, ARCADE_COLOURS.court);
    bar(
      ctx,
      x,
      layout.height * 0.05,
      width * Math.max(0, this.clock / POSSESSION_SECONDS),
      8,
      this.pressure > 0.75 ? ARCADE_COLOURS.danger : ARCADE_COLOURS.bandEdge,
    );

    const value = Math.round(BASE_POINTS + (MAX_POINTS - BASE_POINTS) * this.pressure);
    label(ctx, `${value} if it drops`, layout.width / 2, layout.height * 0.94, {
      size: 14,
      colour: ARCADE_COLOURS.dim,
    });
  }
}

export const buzzerBeaterGame: ArcadeGameDef = {
  id: 'bball.buzzer-beater',
  sport: BASKETBALL_ARCADE_SPORT,
  name: 'Buzzer Beater',
  blurb: 'A hand in your face and four seconds. Later is worth more.',
  durationSeconds: 70,
  unlockAchievement: ARCADE_UNLOCKS.closeWin.id,
  scored: { lives: 3, seconds: null },
  stars: [800, 1800, 2900],
  ratings: ['threePoint', 'midRange'],
  calibrate: (athlete, difficulty) =>
    basketballCalibration(athlete, difficulty, ['threePoint', 'midRange']),
  mount: (host) => new BuzzerBeaterSession(host),
};
