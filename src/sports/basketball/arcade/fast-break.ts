/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.8 — Fast Break — finish past a recovering defender
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.2 (the launch set), 06-game-design.md §3.1 (finishing)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: you are ahead of one defender and closing on the rim. Go up too early and you finish from
 * too far out; go up too late and the recovering defender is there. Two ways to be wrong, one narrow
 * strip of right, and it moves.
 *
 * **This is the one game where the meter is a place rather than a moment.** The marker is the
 * athlete's position running at the rim, the band is the window where the layup is on, and the
 * defender closing from behind is what shuts the band's late edge. Same arithmetic as the other
 * three, different reading, and it is the reading that makes the athlete's `courtSpeed` matter:
 * a quicker athlete arrives with more of the window still open.
 *
 * Feel note: the honest test of this one is whether you ever go up a beat early *on purpose*
 * because you can hear the defender. If the answer is no, the closing sound cue is doing nothing and
 * the game is just a third timing meter.
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

/**
 * Breaks in a scored run. A count rather than a clock, for the reason Free Throw explains: a
 * novice's faster meter must make each break harder, not hand them more of them.
 */
const BREAKS_PER_RUN = 15;

/** Seconds a break lasts before the defender has fully recovered and the window is gone. */
const BREAK_SECONDS = 2.6;
/** How much of the window the defender has taken by the time they arrive. */
const MIN_WINDOW_SCALE = 0.3;

const LAYUP_POINTS = 260;
const DUNK_POINTS = 520;
/** A finish taken with the defender genuinely on you. The reason to hold. */
const AND_ONE_BONUS = 180;

const RESET_SECONDS = 0.7;
const RIM_DISTANCE_M = 1.2;

class FastBreakSession implements ArcadeSession {
  readonly prompt = 'Go up before the defender gets back.';

  private readonly host: ArcadeHost;
  private readonly meter: ReleaseMeter;
  private elapsed = 0;
  private cooldown = 0;
  private breaks = 0;
  private caption = 'Go';
  /** How fast the defender recovers on this break, `0.8–1.2`. The one thing that varies per rep. */
  private recovery = 1;

  constructor(host: ArcadeHost) {
    this.host = host;
    // The band sits high on the track: the layup is on near the rim, not halfway down the floor.
    this.meter = new ReleaseMeter({ calibration: host.calibration, centre: 0.72, rng: host.rng });
    this.startBreak();
  }

  /** `0–1`: how close the defender is. 1 is level with you. */
  private get closing(): number {
    return Math.min(1, (this.elapsed * this.recovery) / BREAK_SECONDS);
  }

  private startBreak(): void {
    this.elapsed = 0;
    this.recovery = 0.8 + this.host.rng.next() * 0.4;
    this.meter.windowScale = 1;
    this.meter.reset();
    this.caption = 'Go';
  }

  update(input: InputFrame, dt: number): void {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.startBreak();
      return;
    }

    this.elapsed += dt;
    this.meter.windowScale = 1 - (1 - MIN_WINDOW_SCALE) * this.closing;
    this.meter.update(dt);

    if (wasPressed(input, Button.A)) {
      this.finish();
      return;
    }

    if (this.closing >= 1) this.recovered();
  }

  private finish(): void {
    const { quality, inBand } = this.meter.judge();
    const contested = this.closing > 0.65;
    const made = inBand && resolveShot(this.host.calibration, quality, this.host.rng);
    // A dunk needs a clean look *and* a clean release; anything less is a layup that went in.
    const dunk = made && quality > 0.8 && !contested;

    const points = made ? (dunk ? DUNK_POINTS : LAYUP_POINTS) + (contested ? AND_ONE_BONUS : 0) : 0;

    this.caption = made
      ? dunk
        ? 'Dunk!'
        : contested
          ? 'And one!'
          : 'Layup'
      : contested
        ? 'Blocked'
        : 'Off the glass';

    this.host.attempt({
      made,
      points,
      quality,
      label: this.caption,
      // Only a mistimed take costs a life; a good look that rattled out does not (`09` §2.4).
      costsLife: !inBand,
      events: shotEvents({
        made,
        points: 2,
        zone: dunk ? 'dunk' : 'rim',
        distance: RIM_DISTANCE_M,
      }),
    });

    this.nextBreak();
  }

  /** Never going up is a miss. Holding the ball is a decision with a cost, like everything else. */
  private recovered(): void {
    this.caption = 'Recovered';
    this.host.attempt({ made: false, points: 0, quality: 0, label: 'Recovered', events: [] });
    this.nextBreak();
  }

  private nextBreak(): void {
    this.breaks++;
    this.cooldown = RESET_SECONDS;
    if (this.breaks >= BREAKS_PER_RUN) this.host.finish('complete');
  }

  view(): ArcadeGameView {
    return {
      meter: this.meter.position,
      target: this.meter.band(),
      caption: this.caption,
      urgency: this.cooldown > 0 ? 0 : this.closing,
    };
  }

  draw(ctx: Canvas2D, layout: ArcadeLayout): void {
    drawMeter(ctx, layout, { position: this.meter.position, band: this.meter.band() });
    label(ctx, this.caption, layout.width / 2, layout.height * 0.1, { size: 22 });

    // The defender, drawn as a chasing marker on its own track beside the meter. Position carries
    // the information; the colour change at the end is a second channel, not the only one.
    const trackX = mirrorX(layout.width * 0.5 + Math.max(28, layout.width * 0.09), layout);
    const top = layout.height * 0.15;
    const height = layout.height * 0.7;
    ctx.beginPath();
    ctx.arc(trackX, top + height * (1 - this.closing), 10, 0, Math.PI * 2);
    ctx.fillStyle = this.closing > 0.65 ? ARCADE_COLOURS.danger : ARCADE_COLOURS.dim;
    ctx.fill();

    label(
      ctx,
      this.closing > 0.65 ? 'Defender on you' : 'Defender chasing',
      layout.width / 2,
      layout.height * 0.94,
      { size: 14, colour: ARCADE_COLOURS.dim },
    );
  }
}

export const fastBreakGame: ArcadeGameDef = {
  id: 'bball.fast-break',
  sport: BASKETBALL_ARCADE_SPORT,
  name: 'Fast Break',
  blurb: 'Fifteen breaks. Time the finish before the defender gets back.',
  durationSeconds: 55,
  unlockAchievement: ARCADE_UNLOCKS.fastBreakPoints.id,
  scored: { lives: 3, seconds: null },
  stars: [700, 1800, 3400],
  ratings: ['finishing', 'courtSpeed'],
  calibrate: (athlete, difficulty) =>
    basketballCalibration(athlete, difficulty, ['finishing', 'courtSpeed']),
  mount: (host) => new FastBreakSession(host),
};
