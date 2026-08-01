/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.4 — Basketball Live AI depth: pick-and-roll, cuts, zone vs man, rating-driven shot selection
 * @story   US-3.3 — Face a CPU that plays basketball
 * @design  06-game-design.md §3.1 (schemes: motion / iso / pick-and-roll; man / 2-3 zone), §5 (utility scoring)
 * @invariant INV-1 (difficulty never touches a rating), INV-2 (seeded PRNG only), INV-8 (determinism)
 *
 * Purpose: the four things `03` names for this task — the pick-and-roll, cuts that are decided
 * rather than rolled for, a scheme chosen from who is on the floor, and a shot bar that knows how
 * good the offence taking it is.
 *
 * **Everything here is a decision, not a die.** T-2.8 shipped cuts at a flat 0.4% per step and a
 * screener picked because they were a big and it was their turn. That produces movement, which was
 * the point at the time, but it produces the *same amount* of movement whoever is playing and
 * whatever the defence is doing — a shooter cuts away from an open look, a screen is set for a
 * handler nobody is guarding. Each of those is now scored through T-7.1's framework, so the
 * randomness that is left is the tie-break rather than the reason.
 *
 * **Ratings decide, difficulty does not** (INV-1). A screener pops because they can shoot, not
 * because the level is Legend; the level reaches these functions only as the decision noise and
 * threshold `06` §7 already defines, passed in from the caller and applied by `selectOption()`.
 */
import { consider, inverse, normalise, selectOption, utility } from '../../engine/ai/utility.ts';
import type { Rng } from '../../engine/rng.ts';
import { COURT, type Side, attackedBasket } from './court.ts';
import type { BasketballRatings } from './roster.ts';

/** A place to stand. Structurally `cpu.ts`'s, kept separate so neither file owns the other. */
export interface Spot {
  readonly x: number;
  readonly y: number;
}

export const OFFBALL = {
  /**
   * How much better at shooting threes than at finishing a screener must be before they pop rather
   * than roll. Above zero because rolling is the higher-percentage action for a tie: a roll ends at
   * the rim, and a pop ends behind the arc.
   */
  popEdge: 6,
  /** How far behind the handler a popping screener spots up, in metres. */
  popDistance: 5.5,
  /** How close to the rim a rolling screener is aiming, in metres. */
  rollDistance: 1.9,
  /** Metres of separation at which a handler counts as pressured enough to want a screen. */
  screenPressure: 2.2,
  /** A cut is only worth making from outside this radius, in metres. */
  cutFrom: 4.5,
  /** Metres of separation from their own defender at which a cutter is being ignored. */
  cutSlack: 3.2,
  /** A lane counts as clear when the nearest defender to it is this far away, in metres. */
  laneClear: 3.5,

  /**
   * The continuation value of a possession, for a team of exactly average shooters. `cpu.ts` held
   * this as one constant; T-7.4 spreads it around this midpoint by how good the offence is, because
   * a shot worth declining for one team is the best shot another team is going to get.
   */
  possessionValue: 0.85,
  /** How far either way a whole team's shooting moves that bar, in points. */
  possessionSpread: 0.14,

  /**
   * The three-point rating at which a team is dangerous enough from range that a zone stops being
   * worth playing. Below it, packing the paint is the right answer.
   */
  zoneShootingBar: 62,
  /** A defence in foul trouble sits down in a zone: fouls per team at which it starts to matter. */
  zoneFoulBar: 8,
} as const;

/** How a screener leaves the screen. */
export const RollChoice = {
  /** To the rim. */
  ROLL: 'roll',
  /** Behind the arc. */
  POP: 'pop',
} as const;

export type RollChoice = (typeof RollChoice)[keyof typeof RollChoice];

/**
 * Whether a screener rolls or pops, from their own ratings and nothing else.
 *
 * This is the whole of "a great shooter plays differently from a great finisher" for the screener:
 * a stretch big pops to the top of the arc and drags the help out of the paint with them; a rim
 * runner rolls into the space that leaves. Getting it backwards — a non-shooter spotting up — is
 * the single most obvious way a basketball AI reads as not understanding the sport.
 *
 * @spec-ref 06-game-design.md §5 — "option scoring uses derived ratings"
 */
export function rollOrPop(ratings: BasketballRatings): RollChoice {
  return ratings.threePoint - ratings.finishing >= OFFBALL.popEdge
    ? RollChoice.POP
    : RollChoice.ROLL;
}

/**
 * Where the screener goes once the screen is set: at the rim on a roll, and behind the handler —
 * away from the basket, where the arc is — on a pop.
 */
export function rollTarget(
  choice: RollChoice,
  handler: Spot,
  side: Side,
  screener: Spot = handler,
): Spot {
  const basket = attackedBasket(side);

  if (choice === RollChoice.ROLL) {
    const dx = basket.x - screener.x;
    const dy = basket.y - screener.y;
    const length = Math.hypot(dx, dy);
    if (length <= OFFBALL.rollDistance) return { x: screener.x, y: screener.y };
    const step = length - OFFBALL.rollDistance;
    return { x: screener.x + (dx / length) * step, y: screener.y + (dy / length) * step };
  }

  // Popping is away from the rim, along the line the handler is on, so the pass is a straight one.
  const dx = handler.x - basket.x;
  const dy = handler.y - basket.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: handler.x, y: handler.y };
  return {
    x: clampToCourt(handler.x + (dx / length) * OFFBALL.popDistance, COURT.length),
    y: clampToCourt(handler.y + (dy / length) * OFFBALL.popDistance, COURT.width),
  };
}

function clampToCourt(value: number, extent: number): number {
  return value < 0.5 ? 0.5 : value > extent - 0.5 ? extent - 0.5 : value;
}

export interface ScreenLook {
  /** The candidate screener. */
  readonly id: number;
  /** Metres from the screener to the handler — a screen is only on if they can get there. */
  readonly distance: number;
  /** Metres between the handler and their nearest defender. */
  readonly handlerSeparation: number;
  /** The screener's own ratings: a big who can screen is worth more than a guard who cannot. */
  readonly ratings: BasketballRatings;
  /** Whether this athlete is one of the two bigs. */
  readonly big: boolean;
}

export interface DecisionNoise {
  /** `06` §7's option-score jitter, from the level. Passed through, never derived here (INV-1). */
  readonly noise?: number;
  readonly rng?: Rng;
  /** The utility a screen has to reach to be worth setting at all. */
  readonly threshold?: number;
}

/**
 * Who sets the ball screen, or `null` for "nobody, this possession does not want one".
 *
 * Four considerations, and the veto is the one that matters: a screen for a handler nobody is
 * near is worse than no screen, because it brings a second defender into the space the handler
 * was about to drive into.
 */
export function screenChoice(
  looks: readonly ScreenLook[],
  options: DecisionNoise = {},
): { readonly id: number; readonly urge: number } | null {
  const candidates = looks.map((look) => ({
    key: `screen:${look.id}`,
    option: look.id,
    considerations: [
      // Nobody guarding the handler ⇒ no screen. A veto, not a low score.
      consider(
        'handler is pressured',
        look.handlerSeparation <= OFFBALL.screenPressure
          ? 1
          : inverse(look.handlerSeparation, OFFBALL.screenPressure, OFFBALL.screenPressure * 3),
        1.4,
      ),
      consider('close enough to arrive', inverse(look.distance, 3, 12)),
      consider('big enough to set it', look.big ? 1 : 0.35),
      // A screener who can punish the switch is a better screener, whichever way they leave it.
      consider(
        'can punish the switch',
        normalise(Math.max(look.ratings.threePoint, look.ratings.finishing), 40, 90),
        0.8,
      ),
    ],
  }));

  const chosen = selectOption(candidates, { threshold: 0.22, ...options });
  return chosen === null ? null : { id: chosen.option, urge: chosen.perceived };
}

export interface CutLook {
  /** Metres from the cutter to the basket they are attacking. */
  readonly toBasket: number;
  /** Metres between the cutter and the defender marking them. */
  readonly separation: number;
  /** Metres from the lane the cut would run through to the nearest other defender. */
  readonly laneGap: number;
  /** Metres from the cutter to the ball — a cut nobody can feed is a cut into traffic. */
  readonly toBall: number;
  /** The cutter's own ratings. */
  readonly ratings: BasketballRatings;
  /** Whether the ball-handler can see them: a cut behind the handler's back is not a cut. */
  readonly inSight: boolean;
}

/**
 * How badly an off-ball athlete wants to cut, `0–1`. `0` is a veto — there is no cut here at all.
 *
 * The considerations are what makes a back-cut work, and the last two are why this is a judgement
 * rather than a timer: a spot-up shooter standing wide open behind the arc should *not* cut, and a
 * flat per-step chance cuts them into the paint anyway.
 *
 * An urge rather than a yes/no on purpose. A boolean evaluated sixty times a second is a state, and
 * the whole point of a cut is that it is an event — so the caller keeps its tuned per-step rate and
 * multiplies it by this, which leaves T-2.13's balance intact while making *who* cuts, and *when*,
 * a matter of the situation instead of the die.
 */
export function cutUrge(look: CutLook): number {
  return utility([
    // Already at the rim: there is nowhere to cut to.
    consider('room to cut into', normalise(look.toBasket, OFFBALL.cutFrom, 9), 1.2),
    // Being ignored is the trigger. A defender in your chest is not a cutting lane.
    consider('defender has let go', normalise(look.separation, 1.2, OFFBALL.cutSlack), 1.5),
    consider('lane is clear', normalise(look.laneGap, 1.5, OFFBALL.laneClear)),
    consider('the pass is on', look.inSight ? inverse(look.toBall, 4, 14) : 0),
    // A finisher cuts; a shooter who cannot finish is worth more standing still.
    consider('can finish it', normalise(look.ratings.finishing, 35, 85), 0.7),
  ]);
}

/**
 * The continuation value of a possession for *this* offence, in points.
 *
 * `06` §5 asks for shot selection driven by derived ratings, and the shot bar is where that lands
 * for the team as a whole: a side that cannot shoot has to take the shot it has, and a side that
 * can should pass it up. Read straight off the five athletes' shooting, which is also why it moves
 * with fatigue and with substitutions without anything else needing to know.
 */
export function possessionValueFor(team: readonly BasketballRatings[]): number {
  if (team.length === 0) return OFFBALL.possessionValue;

  let total = 0;
  for (const ratings of team) {
    total += (ratings.threePoint + ratings.midRange + ratings.finishing) / 3;
  }
  const average = total / team.length;

  // 50 is the middle of the rating scale, and 85 a genuinely elite shooting team.
  const quality = normalise(average, 40, 80) * 2 - 1;
  return OFFBALL.possessionValue + quality * OFFBALL.possessionSpread;
}

export interface SchemeLook {
  /** The five the defence is facing. */
  readonly opponents: readonly BasketballRatings[];
  /** Fouls this side has already committed — a team in trouble stops reaching. */
  readonly fouls: number;
}

/**
 * Man or zone, chosen from who is on the other side of the ball rather than from the match seed.
 *
 * `06` §3.1 gives basketball exactly two schemes, and the choice between them is the clearest
 * rating-driven decision in the sport: a 2-3 zone concedes the three to take away the rim, so it is
 * right against a team that cannot shoot and wrong against one that can. Foul trouble pushes the
 * same way for a different reason — a zone is the scheme you play when you cannot afford to reach.
 *
 * @spec-ref 06-game-design.md §3.1 — "man / 2-3 zone"
 */
export function schemeFor(look: SchemeLook): 'man' | 'zone' {
  if (look.opponents.length === 0) return 'man';

  let shooting = 0;
  for (const ratings of look.opponents) shooting += ratings.threePoint;
  const average = shooting / look.opponents.length;

  // Every foul past the bar buys the offence about a point of shooting before man is worth it.
  const trouble = Math.max(0, look.fouls - OFFBALL.zoneFoulBar);
  return average >= OFFBALL.zoneShootingBar + trouble ? 'man' : 'zone';
}
