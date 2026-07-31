/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.15 — Soccer arcade: Penalty Shootout
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §3.2 ("aim + power + keeper read; also the defending side"),
 *          §3.3 (one structure for every game), 06-game-design.md §3.2 (soccer)
 * @invariant INV-2 (seeded PRNG only), INV-8 (determinism), INV-10 (the window is the athlete's)
 *
 * Purpose: the first soccer mini-game, and the one the rest of the set depends on.
 *
 * **A shootout is two jobs, so this game is two jobs.** `09` §3.2 says "also the defending side",
 * which is the only entry in the whole launch set that asks a game to swap roles. Odd rounds you
 * take the kick, even rounds you are in goal — and it is the *right* shape for a shootout, because
 * a shootout is exactly that alternation and because standing in goal is where the tension in one
 * actually lives.
 *
 * **Taking: aim, then power, on one meter.** `ArcadeGameView` exposes one meter, deliberately — a
 * HUD that grew a second axis for one game would carry that game's vocabulary into shared UI. So
 * the kick is two sequential passes of the same meter: the first stops the marker to place the shot
 * across the goal, the second to strike it. Two taps, and no reading.
 *
 * **The read is what the keeper shows you before you kick.** On some rounds the keeper commits
 * early and visibly — and the aim band narrows onto the half of the goal they have abandoned. On
 * the rest they hold their ground, and the band is the whole frame: no read, so anywhere on target
 * is as good as anywhere else, and you are guessing like everybody else who ever took one. Whether
 * they commit early, and to where, is drawn at the start of the round from the run's own generator,
 * before your aim exists.
 *
 * **Saving: a read, not a guess.** The keeper's half is a reaction test with a tell. The kicker
 * plants and *then* the ball is struck, and from the plant you have the athlete's own
 * `reactionSeconds` to commit to a side. A pure coin flip would be an unwinnable round dressed as a
 * mini-game; a tell you can beat with reactions is the goalkeeping equivalent of a timing band, and
 * it is calibrated the same way.
 *
 * That is the fairness line `09` §2.4 draws, applied to a mini-game: what makes a penalty hard is
 * the size of the goal and your own nerve, not an opponent holding your inputs. It is also why the
 * game stays deterministic under a replay.
 *
 * Feel note: the swap is the thing. Taking five in a row would be Free Throw with a bigger target;
 * alternating means every round you have just been on the other end of, which is what makes the
 * sixth kick feel like something. Standing in goal is the better half, and that surprised me.
 */
import { Button, wasPressed, type InputFrame } from '../../../engine/input/types.ts';
import type { Canvas2D } from '../../../engine/render/renderer.ts';
import { ReleaseMeter, outcomeChance, resolveShot } from '../../../modes/arcade/meter.ts';
import { qualityLabel } from '../../../modes/arcade/scoring.ts';
import { ARCADE_COLOURS, drawMeter, label, mirrorX } from '../../../modes/arcade/draw.ts';
import type {
  ArcadeGameDef,
  ArcadeGameView,
  ArcadeHost,
  ArcadeLayout,
  ArcadeSession,
} from '../../../modes/arcade/types.ts';
import { ARCADE_UNLOCKS } from '../../../achievements/ids.ts';
import { PITCH } from '../pitch.ts';
import { SOCCER_ARCADE_SPORT, saveEvent, shotEvents, soccerCalibration } from './shared.ts';

/**
 * Rounds in a scored run: five each way, as a shootout is, then five more because a run that ends
 * at ten attempts is under `09` §3.1's twenty-second floor for a confident player.
 *
 * **A count, not a clock**, for the reason basketball's Free Throw records: a novice's meter runs
 * faster, and under a clock that hands them more attempts per run than a specialist gets. The
 * athlete's speed must make each round harder, never make the run longer.
 */
export const ROUNDS_PER_RUN = 10;

/** `06` §3.2 — the spot is eleven metres out, and it is the same kick every time. */
const PENALTY_DISTANCE_M = PITCH.penaltySpotFromGoalLine;

const POINTS_PER_GOAL = 100;
const POINTS_PER_SAVE = 140;
/** Consecutive successes are worth more, up to a cap — the reason a run is worth continuing. */
const STREAK_BONUS = 30;
const MAX_STREAK_BONUS = 240;

/** How much faster the meter runs per round, and where the ramp stops. */
const RAMP_PER_ROUND = 0.07;
const MAX_RAMP = 2.1;

/** Seconds between an outcome landing and the next round starting. */
const RESET_SECONDS = 0.7;

/**
 * Seconds to get the kick away once the marker is moving, per stage.
 *
 * A lives-only game with no per-attempt limit never ends for a player who simply does not press —
 * the same hole basketball's Free Throw found with its shot clock, and worth closing at the seam
 * rather than rediscovering per game.
 */
const STAGE_SECONDS = 4;

/** Where the keeper can commit to, across the goal. Meter units, matching the aim meter. */
const SIDES = { left: 0.2, centre: 0.5, right: 0.8 } as const;
type GoalSide = keyof typeof SIDES;
const SIDE_ORDER: readonly GoalSide[] = ['left', 'centre', 'right'];

/** How far from the keeper's committed side a shot has to be placed to beat them, in meter units. */
const REACH = 0.18;

/**
 * How much of the goal a badly-placed kick misses altogether.
 *
 * Aim quality decides *placement*, and placement decides whether the keeper can reach it. But a shot
 * aimed at the very edge of the frame is also a shot that can miss the target — which is why the
 * corners are worth going for rather than free.
 */
const OFF_TARGET_EDGE = 0.08;

/** Share of rounds on which the keeper commits early enough to be read. */
const KEEPER_SHOWS_EARLY = 0.55;

type Stage = 'aim' | 'power' | 'keeper-set' | 'keeper-dive' | 'reset';

/** What a round is: who is taking it, and how it went. */
export interface ShootoutRound {
  readonly taking: boolean;
  readonly scored: boolean;
}

class PenaltyShootoutSession implements ArcadeSession {
  readonly prompt = 'Place it, strike it — then keep one out.';

  private readonly host: ArcadeHost;
  private readonly meter: ReleaseMeter;
  private stage: Stage = 'aim';
  private stageClock = STAGE_SECONDS;
  private cooldown = 0;
  private round = 0;
  private streak = 0;
  private caption = 'Aim';

  /** Where the kick was placed, in meter units, once the aim stage is done. */
  private placement = 0.5;
  /** Which side the keeper has gone, this round. */
  private keeperSide: GoalSide = 'centre';
  /** Seconds into the aim stage at which the keeper shows their hand, or `Infinity` if they hold. */
  private keeperShowsAt = Infinity;
  /** Seconds the aim stage has run, for the tell above. */
  private aiming = 0;
  /** Which side the kicker is going, on a round the player is saving. Hidden until the strike. */
  private kickerSide: GoalSide = 'centre';
  /** Seconds the player has had since the tell. */
  private sinceTell = 0;

  constructor(host: ArcadeHost) {
    this.host = host;
    this.meter = new ReleaseMeter({ calibration: host.calibration, rng: host.rng });
    this.beginRound();
  }

  /** Odd rounds are taken, even rounds are saved — a shootout alternates, so the game does. */
  private get taking(): boolean {
    return this.round % 2 === 0;
  }

  update(input: InputFrame, dt: number): void {
    if (this.stage === 'reset') {
      this.cooldown -= dt;
      if (this.cooldown <= 0) this.beginRound();
      return;
    }

    if (this.taking) {
      this.meter.update(dt);
      if (this.stage === 'aim') {
        this.aiming += dt;
        if (this.readable && this.caption === 'Aim')
          this.caption = `Keeper's gone ${this.keeperSide}`;
      }
      if (wasPressed(input, Button.A)) {
        if (this.stage === 'aim') this.lockAim();
        else this.strike();
        return;
      }
      this.stageClock -= dt;
      // Not kicking is a miss. It costs a life, like every other way of not scoring one.
      if (this.stageClock <= 0) this.settleKick(false, 0, 'Too slow', true);
      return;
    }

    this.keeping(input, dt);
  }

  // ── Taking ────────────────────────────────────────────────────────────────

  /** True once the keeper has shown their hand on this round — the read the aim band is built on. */
  private get readable(): boolean {
    return this.aiming >= this.keeperShowsAt;
  }

  /**
   * Where it is safe to place the kick, in meter units.
   *
   * With a read, the widest stretch of goal more than the keeper's reach away from where they have
   * gone. Without one, the whole frame inside the posts — which is the honest answer: nothing you
   * can see tells you more, and a band that pretended otherwise would be the HUD lying.
   */
  aimBand(): { readonly from: number; readonly to: number } {
    const inside = { from: OFF_TARGET_EDGE, to: 1 - OFF_TARGET_EDGE };
    if (!this.readable) return inside;

    const keeper = SIDES[this.keeperSide];
    const left = { from: inside.from, to: Math.min(inside.to, keeper - REACH) };
    const right = { from: Math.max(inside.from, keeper + REACH), to: inside.to };
    const width = (band: { from: number; to: number }): number => band.to - band.from;
    if (width(left) <= 0) return right;
    if (width(right) <= 0) return left;
    return width(right) >= width(left) ? right : left;
  }

  /** The first pass of the meter places the shot; where the marker stopped *is* the placement. */
  private lockAim(): void {
    this.placement = this.meter.position;
    this.stage = 'power';
    this.stageClock = STAGE_SECONDS;
    this.caption = 'Strike';
    this.meter.reset();
  }

  /**
   * The second pass strikes it. Three things have to go right and they are separable, which is what
   * makes the game teachable: place it away from the keeper, strike it cleanly, and do not put it
   * so close to the post that it misses the goal entirely.
   */
  private strike(): void {
    const { quality, inBand } = this.meter.judge();
    const beatsKeeper = Math.abs(this.placement - SIDES[this.keeperSide]) > REACH;
    const onTarget =
      this.placement > OFF_TARGET_EDGE && this.placement < 1 - OFF_TARGET_EDGE && inBand;

    // The athlete's own outcome band still decides a clean strike (`09` §2.4): a perfect release
    // from a novice is not a certainty, and this is the one place their finishing shows up.
    const struck = onTarget && resolveShot(this.host.calibration, quality, this.host.rng);
    const scored = struck && beatsKeeper;

    const said = !onTarget
      ? this.placement <= OFF_TARGET_EDGE || this.placement >= 1 - OFF_TARGET_EDGE
        ? 'Wide'
        : 'Skied it'
      : !beatsKeeper
        ? 'Keeper saves'
        : qualityLabel(quality);

    // A life is spent on a *release* that was wrong, never on the athlete's band coming up short —
    // the same split basketball's set draws, and the reason a novice's ceiling is not a punishment.
    this.settleKick(scored, quality, said, !inBand);
  }

  private settleKick(scored: boolean, quality: number, said: string, costsLife: boolean): void {
    this.caption = said;
    this.streak = scored ? this.streak + 1 : 0;

    this.host.attempt({
      made: scored,
      points: scored ? POINTS_PER_GOAL + this.streakBonus() : 0,
      quality,
      label: said,
      costsLife,
      events: shotEvents({ made: scored, zone: 'penaltyArea', distance: PENALTY_DISTANCE_M }),
    });

    this.endRound();
  }

  // ── Keeping ───────────────────────────────────────────────────────────────

  /**
   * The keeper's half.
   *
   * `keeper-set` is the plant — the tell, held for a beat that shrinks as the run ramps. `dive` is
   * the athlete's own `reactionSeconds` to commit. Committing before the tell is a guess and is
   * allowed to be right; what the reaction allowance buys is the chance to be right *because* you
   * saw it.
   */
  private keeping(input: InputFrame, dt: number): void {
    this.meter.update(dt);

    if (this.stage === 'keeper-set') {
      this.stageClock -= dt;
      if (wasPressed(input, Button.A)) {
        this.dive(true);
        return;
      }
      if (this.stageClock <= 0) {
        this.stage = 'keeper-dive';
        this.sinceTell = 0;
        this.caption = `Struck ${this.kickerSide}!`;
      }
      return;
    }

    this.sinceTell += dt;
    if (wasPressed(input, Button.A)) {
      this.dive(false);
      return;
    }
    // Not moving is a goal conceded. A keeper who stands still has made a choice.
    // Not moving at all is a player error, and the only one the keeper's half has besides the guess.
    if (this.sinceTell >= this.host.calibration.reactionSeconds)
      this.settleSave(false, 0, 'Beaten', true);
  }

  /**
   * Commits to a side: whichever third of the meter the marker is in when the button goes down.
   *
   * The meter doubles as the dive because a keeper's problem is the same shape as a kicker's — pick
   * a moment, and where the marker happens to be is what you get. It also means the two halves of
   * the game are one control, which is what keeps it playable with one thumb.
   */
  private dive(guessed: boolean): void {
    const chosen = SIDE_ORDER[Math.min(2, Math.floor(this.meter.position * 3))] as GoalSide;
    const right = chosen === this.kickerSide;

    if (!right) {
      // Going the wrong way is the player's own call, and it is the one thing here that costs a life.
      this.settleSave(false, 0, guessed ? 'Guessed wrong' : `Went ${chosen}`, true);
      return;
    }

    // Right side, and then the athlete's band: a keeper who reads it still has to reach it, and how
    // fast they got there is what decides where in the band they land.
    const promptness = guessed
      ? 0.35
      : Math.max(0, 1 - this.sinceTell / Math.max(0.05, this.host.calibration.reactionSeconds));
    const saved = this.host.rng.next() < outcomeChance(this.host.calibration, promptness);
    // Right side, wrong outcome: the athlete's band came up short, which is never a life (`09` §2.4).
    // **T-6.18 changed this**, and it is why a run used to be six attempts long: every concession
    // cost a life, including the ones where the player read it perfectly, so the balance harness
    // found a game whose best observed score was 390 against a 600 first-star threshold.
    this.settleSave(saved, promptness, saved ? qualityLabel(promptness) : 'Fingertips', false);
  }

  private settleSave(saved: boolean, quality: number, said: string, costsLife: boolean): void {
    this.caption = said;
    this.streak = saved ? this.streak + 1 : 0;

    this.host.attempt({
      made: saved,
      points: saved ? POINTS_PER_SAVE + this.streakBonus() : 0,
      quality,
      label: said,
      costsLife,
      events: saved ? [saveEvent()] : [],
    });

    this.endRound();
  }

  // ── Round plumbing ────────────────────────────────────────────────────────

  private streakBonus(): number {
    return Math.min(MAX_STREAK_BONUS, this.streak * STREAK_BONUS);
  }

  private endRound(): void {
    this.round += 1;
    this.stage = 'reset';
    this.cooldown = RESET_SECONDS;
    if (this.round >= ROUNDS_PER_RUN) this.host.finish('complete');
  }

  private beginRound(): void {
    this.meter.reset();
    // The ramp is a property of how far into the run you are, not of how well you have been doing —
    // which is what keeps it clear of INV-10. A player on five saves and one on five concessions
    // face the same meter.
    this.meter.speedScale = Math.min(MAX_RAMP, 1 + this.round * RAMP_PER_ROUND);
    this.stageClock = STAGE_SECONDS;

    if (this.taking) {
      // The keeper commits from the run's own generator, before the aim exists. It cannot read you.
      this.keeperSide = pickSide(this.host.rng.next());
      // Two draws, always, so a round where the keeper holds consumes the same stream as one where
      // they commit — otherwise the tell would shift every later draw in the run (INV-8).
      const tell = this.host.rng.next();
      this.keeperShowsAt = tell < KEEPER_SHOWS_EARLY ? tell * 1.6 : Infinity;
      this.stage = 'aim';
      this.aiming = 0;
      this.placement = 0.5;
      this.caption = 'Aim';
      return;
    }

    this.kickerSide = pickSide(this.host.rng.next());
    this.stage = 'keeper-set';
    // The tell shortens as the run goes on, so the last kicks are the ones you have to read fastest.
    this.stageClock = Math.max(0.25, 0.9 - this.round * 0.05);
    this.sinceTell = 0;
    this.caption = 'Watch the plant';
  }

  view(): ArcadeGameView {
    const band =
      !this.taking || this.stage === 'reset'
        ? null
        : this.stage === 'aim'
          ? this.aimBand()
          : this.meter.band();
    return {
      meter: this.meter.position,
      target: band,
      caption: this.caption,
      urgency:
        this.stage === 'keeper-dive'
          ? Math.min(1, this.sinceTell / Math.max(0.05, this.host.calibration.reactionSeconds))
          : Math.min(1, (this.meter.speedScale - 1) / (MAX_RAMP - 1)),
    };
  }

  draw(ctx: Canvas2D, layout: ArcadeLayout): void {
    drawGoal(ctx, layout, {
      keeper: this.taking ? SIDES[this.keeperSide] : this.meter.position,
      // The kicker's side is hidden until the ball is struck: showing it during the plant would
      // remove the read the round is about.
      ball: this.taking
        ? this.placement
        : this.stage === 'keeper-dive'
          ? SIDES[this.kickerSide]
          : null,
      // Taking, the keeper appears only once they have committed — that *is* the read.
      showKeeper: !this.taking || this.stage !== 'aim' || this.readable,
    });

    if (this.taking) {
      drawMeter(ctx, layout, {
        position: this.meter.position,
        band: this.stage === 'aim' ? this.aimBand() : this.meter.band(),
      });
    }

    label(ctx, this.caption, layout.width / 2, layout.height * 0.12, { size: 22 });
    label(
      ctx,
      `Round ${Math.min(ROUNDS_PER_RUN, this.round + 1)} of ${ROUNDS_PER_RUN}`,
      layout.width / 2,
      layout.height * 0.94,
      {
        size: 14,
        colour: ARCADE_COLOURS.dim,
      },
    );
  }
}

/** Which third of the goal a `0–1` draw names. Even thirds; the keeper has no favourite side. */
export function pickSide(draw: number): GoalSide {
  return SIDE_ORDER[Math.min(2, Math.floor(draw * 3))] as GoalSide;
}

/**
 * The goalmouth. Drawn as a frame with posts and a crossbar, so where the ball went and where the
 * keeper went are both readable as *positions* rather than as colours (`10` §11, T-4.12).
 */
function drawGoal(
  ctx: Canvas2D,
  layout: ArcadeLayout,
  options: {
    readonly keeper: number;
    readonly ball: number | null;
    readonly showKeeper: boolean;
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

  // The two edges a shot has to stay inside. Marked, so "Wide" is a thing you can see coming.
  ctx.lineWidth = 1;
  for (const edge of [OFF_TARGET_EDGE, 1 - OFF_TARGET_EDGE]) {
    ctx.beginPath();
    ctx.moveTo(at(edge), top);
    ctx.lineTo(at(edge), top + height);
    ctx.stroke();
  }

  if (options.showKeeper) {
    const keeperWidth = width * REACH * 2;
    ctx.fillStyle = ARCADE_COLOURS.danger;
    ctx.fillRect(at(options.keeper) - keeperWidth / 2, top, keeperWidth, height);
  }

  if (options.ball !== null) {
    ctx.fillStyle = ARCADE_COLOURS.marker;
    ctx.beginPath();
    ctx.arc(
      at(options.ball),
      top + height * 0.55,
      Math.max(6, layout.width * 0.018),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

export const penaltyShootoutGame: ArcadeGameDef = {
  id: 'soccer.penalty-shootout',
  sport: SOCCER_ARCADE_SPORT,
  name: 'Penalty Shootout',
  blurb: 'Five to take, five to save. Place it, strike it, then read the plant.',
  durationSeconds: 75,
  unlockAchievement: ARCADE_UNLOCKS.penaltyScored.id,
  scored: { lives: 3, seconds: null },
  stars: [600, 1700, 3000],
  // Both halves of the game, in the order the picker explains them: you kick first.
  ratings: ['finishing', 'shotPower', 'goalkeeping'],
  calibrate: (athlete, difficulty) =>
    soccerCalibration(athlete, difficulty, ['finishing', 'shotPower', 'goalkeeping']),
  mount: (host) => new PenaltyShootoutSession(host),
};
