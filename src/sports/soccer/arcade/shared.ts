/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.15 — Soccer arcade: Penalty Shootout
 * @story   US-16.1 — Play a quick skill game
 * @story   US-16.3 — Feel my athlete in the mini-game
 * @design  09-modes-and-arcade.md §3.2 (the launch set), §3.4 (arcade trains the same ratings),
 *          05-data-model.md §3.3 (soccer weights and XP)
 * @invariant INV-9 (one event stream), INV-10 (the window is the athlete's)
 *
 * Purpose: what soccer's mini-games share — the rating tables they calibrate against and the event
 * shapes they emit.
 *
 * Deliberately smaller than basketball's equivalent, because the drawing half of that file was never
 * about basketball and now lives in `modes/arcade/draw.ts`. What is left here is the two things that
 * genuinely have to agree between soccer's five games: how an athlete becomes a window, and what a
 * shot on goal looks like on the stream.
 *
 * **`zone` must come from soccer's own vocabulary** (`xp.ts`). A zone name invented here would match
 * no award rule and the run would silently train nothing — `SOCCER_XP_AWARDS` names `sixYard`,
 * `penaltyArea`, `edgeOfBox`, `longRange`, `wide`, and `speculative`, and a test asserts that every
 * zone the arcade set emits is one of them.
 */
import { EventKind, type SportEvent } from '../../../engine/match/events.ts';
import { calibrateForAthlete, type ArcadeWindowShape } from '../../../modes/arcade/calibration.ts';
import type { ArcadeCalibration } from '../../../modes/arcade/types.ts';
import type { Athlete } from '../../../athletes/types.ts';
import type { Difficulty } from '../../../modes/difficulty.ts';
import { SOCCER_PHYSICAL, SOCCER_WEIGHTS } from '../weights.ts';

export const SOCCER_ARCADE_SPORT = 'soccer';

/**
 * The entity every arcade event is attributed to. An arcade run has one athlete and no world, but
 * `xp.ts` awards by entity id, so the run needs *an* id — and one constant beats five games each
 * picking their own. The same choice basketball's set made, for the same reason.
 */
export const ARCADE_ACTOR = 0;

const TABLES = { weights: SOCCER_WEIGHTS, physicalModifiers: SOCCER_PHYSICAL };

/**
 * The calibration for one game, given the ratings it reads. Every soccer game goes through here, so
 * all five read the *same* derived ratings the athlete card, the Live sim, and Playbook read
 * (`09` §7 — tuning an athlete's soccer ability tunes all three modes, by construction).
 */
export function soccerCalibration(
  athlete: Athlete,
  difficulty: Difficulty,
  ratings: readonly string[],
  shape?: ArcadeWindowShape,
): ArcadeCalibration {
  return calibrateForAthlete({
    athlete,
    sport: SOCCER_ARCADE_SPORT,
    tables: TABLES,
    ratings,
    difficulty,
    ...(shape === undefined ? {} : { shape }),
  });
}

/** A shot on goal, in the shape Live emits it (INV-9). `step` is stamped by the framework. */
export function shotEvents(options: {
  readonly made: boolean;
  readonly zone: string;
  readonly distance: number;
}): readonly SportEvent[] {
  const shot: SportEvent = {
    kind: EventKind.SHOT,
    step: 0,
    side: 0,
    actor: ARCADE_ACTOR,
    value: options.distance,
    detail: { zone: options.zone, made: options.made, points: 1 },
  };
  if (!options.made) return [shot];

  return [
    shot,
    {
      kind: EventKind.SCORE,
      step: 0,
      side: 0,
      actor: ARCADE_ACTOR,
      value: 1,
      detail: { zone: options.zone },
    },
  ];
}

/** A save. The one keeper action that reliably emits, and what `SOCCER_XP_AWARDS` pays for. */
export function saveEvent(): SportEvent {
  return { kind: EventKind.SAVE, step: 0, side: 0, actor: ARCADE_ACTOR, value: 1 };
}
