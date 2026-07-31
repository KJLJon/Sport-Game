/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.5 — Free Throw — release timing under mounting pressure
 * @task    T-4.6 — Three-Point Contest — five racks, rhythm and timing, 60 s
 * @task    T-4.7 — Buzzer Beater — contested shot, shrinking window
 * @task    T-4.8 — Fast Break — finish past a recovering defender
 * @task    T-4.9 — Pickpocket — reaction test, jump the lane without fouling
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.2 (the launch set), 05-data-model.md §3.1 (basketball weights)
 * @invariant INV-9 (one event stream), INV-10 (the window is the athlete's)
 *
 * Purpose: what basketball's five mini-games share — the rating tables they calibrate against, the
 * event shapes they emit, and the drawing primitives their canvases have in common.
 *
 * Kept small on purpose. Anything that is genuinely one game's business belongs in that game's file;
 * what is here is only the things that must agree between them, because a shot event emitted in one
 * shape by Free Throw and another by Buzzer Beater would make arcade XP (T-4.10) a per-game rule.
 */
import { EventKind, type SportEvent } from '../../../engine/match/events.ts';
import { BasketballEvent } from '../rules.ts';
import { calibrateForAthlete } from '../../../modes/arcade/calibration.ts';
import type { ArcadeWindowShape } from '../../../modes/arcade/calibration.ts';
import type { ArcadeCalibration } from '../../../modes/arcade/types.ts';
import type { Athlete } from '../../../athletes/types.ts';
import type { Difficulty } from '../../../modes/difficulty.ts';
import { BASKETBALL_PHYSICAL, BASKETBALL_WEIGHTS } from '../weights.ts';

export const BASKETBALL_ARCADE_SPORT = 'basketball';

/**
 * The entity every arcade event is attributed to. An arcade run has one athlete and no world, but
 * `xp.ts` awards by entity id, so the run needs *an* id — and one constant beats five games each
 * picking their own. `0` is a real entity in a match; here it is simply "the athlete playing".
 */
export const ARCADE_ACTOR = 0;

const TABLES = { weights: BASKETBALL_WEIGHTS, physicalModifiers: BASKETBALL_PHYSICAL };

/**
 * The calibration for one game, given the ratings it reads. Every basketball game goes through here,
 * so all five read the *same* derived ratings the athlete card and the Live sim read (`09` §7).
 */
export function basketballCalibration(
  athlete: Athlete,
  difficulty: Difficulty,
  ratings: readonly string[],
  shape?: ArcadeWindowShape,
): ArcadeCalibration {
  return calibrateForAthlete({
    athlete,
    sport: BASKETBALL_ARCADE_SPORT,
    tables: TABLES,
    ratings,
    difficulty,
    ...(shape === undefined ? {} : { shape }),
  });
}

/**
 * A made shot, in the shape Live emits it (INV-9). `step` is stamped by the framework; `zone` is
 * what `xpAwards` matches on, so an arcade three trains three-point shooting exactly as a Live one
 * does — which is the whole of `09` §3.4.
 *
 * **`zone` must come from basketball's own vocabulary** (`xp.ts`): a zone name invented here would
 * match no award rule and the run would silently train nothing. There is a test asserting every
 * zone the arcade set emits is one the award table knows.
 */
export function shotEvents(options: {
  readonly made: boolean;
  readonly points: number;
  readonly zone: string;
  readonly distance: number;
}): readonly SportEvent[] {
  const shot: SportEvent = {
    kind: EventKind.SHOT,
    step: 0,
    side: 0,
    actor: ARCADE_ACTOR,
    value: options.distance,
    detail: { zone: options.zone, made: options.made, points: options.points },
  };
  if (!options.made) return [shot];

  return [
    shot,
    {
      kind: EventKind.SCORE,
      step: 0,
      side: 0,
      actor: ARCADE_ACTOR,
      value: options.points,
      detail: { zone: options.zone },
    },
  ];
}

/** A steal, and the foul that a mistimed one becomes. */
export function stealEvent(): SportEvent {
  return {
    kind: EventKind.SPORT,
    sportKind: BasketballEvent.STEAL,
    step: 0,
    side: 0,
    actor: ARCADE_ACTOR,
    value: 1,
  };
}

export function foulEvent(): SportEvent {
  return {
    kind: EventKind.FOUL,
    step: 0,
    side: 0,
    actor: ARCADE_ACTOR,
    value: 1,
    detail: { kind: 'reach-in' },
  };
}

export {
  ARCADE_COLOURS,
  METER_THUMB_SIDE,
  bar,
  drawMeter,
  label,
  mirrorX,
} from '../../../modes/arcade/draw.ts';
