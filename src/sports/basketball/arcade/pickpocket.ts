/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.9 — Pickpocket — reaction test, jump the lane without fouling
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.2 (the launch set), 06-game-design.md §3.3 (defending)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: the one game in the set that is not a release meter. You are guarding the passing lane;
 * when the pass goes, you jump it. Go early and it is a reach-in foul.
 *
 * **The tell is what makes it a skill rather than a lottery.** A pass with no warning is a test of
 * how fast you can react to nothing, which rewards mashing. So the handler telegraphs for a fixed
 * quarter-second before the ball leaves, and the athlete's `perimeterD` sets how long the lane then
 * stays jumpable. A great defender does not see the tell sooner — everyone sees it at the same
 * moment — they have longer to act on it, which is the same fairness contract the meter games make
 * and the reason this game calibrates through the identical path.
 *
 * **Fouling is the only thing that ends the run.** Missing a lane costs the possession and nothing
 * else, because a game that punished patience would teach exactly the wrong instinct for the
 * behaviour it is practising. Three reach-ins and you are done.
 *
 * Feel note: the fun is entirely in the moment *after* the tell where you have already committed.
 * If the tell is too long the game becomes trivial; if it is absent the game becomes a coin flip.
 */
import { Button, wasPressed, type InputFrame } from '../../../engine/input/types.ts';
import type { Canvas2D } from '../../../engine/render/renderer.ts';
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
  foulEvent,
  label,
  mirrorX,
  stealEvent,
} from './shared.ts';

/**
 * Possessions in a scored run. A count rather than a clock: a specialist's *longer* lane means a
 * longer possession, and under a clock that would hand the novice more chances than the specialist —
 * the fairness rule running exactly backwards.
 */
const POSSESSIONS_PER_RUN = 20;

/** How long the handler telegraphs before the ball leaves. The same for every athlete, on purpose. */
export const TELL_SECONDS = 0.25;

/** How long the handler holds the ball before committing to a pass. */
const HOLD_RANGE = { min: 0.7, max: 2.3 } as const;

const STEAL_POINTS = 60;
/**
 * A steal taken at the very front of the window. Most of the score, deliberately: everyone who
 * reacts at all gets the ball, and what separates a specialist is *how early* — so the bonus, not
 * the base, is where the athlete shows up.
 */
const PERFECT_BONUS = 180;
const STREAK_BONUS = 25;
const MAX_STREAK_BONUS = 150;

const RESET_SECONDS = 0.5;

type Phase = 'holding' | 'tell' | 'lane' | 'over';

class PickpocketSession implements ArcadeSession {
  readonly prompt = 'Jump the pass. Do not reach in early.';

  private readonly host: ArcadeHost;
  private phase: Phase = 'holding';
  private timer = 0;
  private cooldown = 0;
  private steals = 0;
  private possessions = 0;
  private caption = 'Watch the handler';

  constructor(host: ArcadeHost) {
    this.host = host;
    this.startPossession();
  }

  private get window(): number {
    return this.host.calibration.reactionSeconds;
  }

  private startPossession(): void {
    this.phase = 'holding';
    this.timer = HOLD_RANGE.min + this.host.rng.next() * (HOLD_RANGE.max - HOLD_RANGE.min);
    this.caption = 'Watch the handler';
  }

  update(input: InputFrame, dt: number): void {
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.startPossession();
      return;
    }

    const pressed = wasPressed(input, Button.A);
    this.timer -= dt;

    switch (this.phase) {
      case 'holding':
        if (pressed) return this.foul();
        if (this.timer <= 0) {
          this.phase = 'tell';
          this.timer = TELL_SECONDS;
          this.caption = 'Now!';
        }
        return;

      case 'tell':
        // Reading the tell and going with it is *not* early — the ball is already on its way out.
        if (pressed) return this.steal(1);
        if (this.timer <= 0) {
          this.phase = 'lane';
          this.timer = this.window;
        }
        return;

      case 'lane': {
        if (pressed) return this.steal(Math.max(0, this.timer / this.window));
        if (this.timer <= 0) return this.missed();
        return;
      }

      case 'over':
        return;
    }
  }

  private steal(quality: number): void {
    this.steals++;
    const streak = Math.min(MAX_STREAK_BONUS, (this.steals - 1) * STREAK_BONUS);
    this.caption = quality > 0.85 ? 'Picked clean!' : 'Steal';

    this.host.attempt({
      made: true,
      points: STEAL_POINTS + Math.round(PERFECT_BONUS * quality) + streak,
      quality,
      label: this.caption,
      events: [stealEvent()],
    });

    this.endPossession();
  }

  /** A reach-in: the only thing that costs a life. */
  private foul(): void {
    this.steals = 0;
    this.caption = 'Reach-in foul';
    this.host.attempt({
      made: false,
      points: 0,
      quality: 0,
      label: 'Reach-in foul',
      events: [foulEvent()],
    });
    this.endPossession();
  }

  /** A lane not taken. Costs the possession and the streak, and nothing more. */
  private missed(): void {
    this.steals = 0;
    this.caption = 'Pass got through';
    this.host.attempt({
      made: false,
      points: 0,
      quality: 0,
      label: 'Pass got through',
      costsLife: false,
      events: [],
    });
    this.endPossession();
  }

  private endPossession(): void {
    this.phase = 'over';
    this.cooldown = RESET_SECONDS;
    this.possessions++;
    if (this.possessions >= POSSESSIONS_PER_RUN) this.host.finish('complete');
  }

  view(): ArcadeGameView {
    // The meter reads as "how much of the lane is left", which is the only quantity that matters.
    const open = this.phase === 'lane' ? Math.max(0, this.timer / this.window) : null;
    return {
      meter: open,
      target: open === null ? null : { from: 0, to: 1 },
      caption: this.caption,
      urgency: open === null ? 0 : 1 - open,
    };
  }

  draw(ctx: Canvas2D, layout: ArcadeLayout): void {
    label(ctx, this.caption, layout.width / 2, layout.height * 0.2, { size: 24 });

    // The handler and the receiver, with the lane between them. The lane is drawn as a filling bar
    // rather than a colour change, so it reads in greyscale (T-4.12).
    const handlerX = mirrorX(layout.width * 0.25, layout);
    const receiverX = mirrorX(layout.width * 0.75, layout);
    const y = layout.height * 0.55;

    for (const x of [handlerX, receiverX]) {
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fillStyle = ARCADE_COLOURS.dim;
      ctx.fill();
    }

    const laneLeft = Math.min(handlerX, receiverX) + 18;
    const laneWidth = Math.abs(receiverX - handlerX) - 36;
    bar(ctx, laneLeft, y - 5, laneWidth, 10, ARCADE_COLOURS.court);

    if (this.phase === 'lane' || this.phase === 'tell') {
      const open = this.phase === 'tell' ? 1 : Math.max(0, this.timer / this.window);
      bar(ctx, laneLeft, y - 5, laneWidth * open, 10, ARCADE_COLOURS.bandEdge);
    }

    label(ctx, `${this.steals} in a row`, layout.width / 2, layout.height * 0.9, {
      size: 14,
      colour: ARCADE_COLOURS.dim,
    });
  }
}

export const pickpocketGame: ArcadeGameDef = {
  id: 'bball.pickpocket',
  sport: BASKETBALL_ARCADE_SPORT,
  name: 'Pickpocket',
  blurb: 'Twenty possessions. Jump the lane; three reach-ins and you are out.',
  durationSeconds: 50,
  unlockAchievement: ARCADE_UNLOCKS.fiveSteals.id,
  scored: { lives: 3, seconds: null },
  stars: [2800, 4200, 5300],
  ratings: ['perimeterD'],
  calibrate: (athlete, difficulty) => basketballCalibration(athlete, difficulty, ['perimeterD']),
  mount: (host) => new PickpocketSession(host),
};
