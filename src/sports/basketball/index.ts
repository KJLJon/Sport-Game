/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.2 — Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts
 * @task    T-2.3 — Shooting: hold-release meter, arc trajectory, make probability
 * @task    T-2.4 — Passing: aimed, lead passes, interceptions, turnovers
 * @task    T-2.5 — Dribbling & driving: handling control, contact absorption, blow-by
 * @task    T-2.6 — Rebounding: height/vertical/strength/box-out/timing contest
 * @task    T-2.7 — Defence: marking, contest, steal, block, foul model, free throws
 * @task    T-2.8 — Baseline CPU: role-based offence (spacing, cuts, screens), man defence, possession decisions
 * @task    T-2.9 — Control switching: auto on turnover, manual cycle, controlled-athlete indicator
 * @story   US-3.1 — Play a 5v5 basketball match
 * @story   US-3.2 — Shoot, drive, pass, and rebound
 * @story   US-3.3 — Defend
 * @story   US-7.1 — Play against a CPU that plays the sport properly
 * @story   US-2.2 — Switch which athlete I am controlling
 * @story   US-2.4 — See the state of the match at a glance
 * @design  06-game-design.md §3.1 (basketball), 04-architecture.md §5 (the sport module seam)
 * @invariant INV-2 (seeded PRNG only), INV-5 (no sport logic in the engine), INV-8 (determinism)
 *
 * Purpose: the basketball `SportModule` — the object the rest of the game plays basketball through.
 * It owns the world (ten athletes and a ball), drives the rule book in `rules.ts` and the models in
 * its sibling modules, and turns all of it into the one `SportEvent` stream everything downstream
 * consumes.
 *
 * This file is deliberately the *only* place those models meet. `shooting.ts`, `passing.ts`,
 * `dribbling.ts`, `rebounding.ts`, and `defence.ts` are pure and know nothing about each other or
 * about the world's step order; the wiring lives here, once, where the order is visible.
 *
 * **What is still crude here.** The numbers the CPU produces are T-2.13's to balance, and the
 * difficulty ladder that varies its reaction latency and decision noise is T-7's. What is *not*
 * crude is any of the machinery: a possession really does end on the shot clock, a shot really is
 * decided by the athlete's ratings, a foul really does come from approach angle and speed
 * differential, the CPU really does choose by expected points, and play really does restart from
 * the right spot.
 */
import { createRng, type Rng } from '../../engine/rng.ts';
import type { InputFrame } from '../../engine/input/types.ts';
import { Button, EMPTY_FRAME, isHeld, wasPressed, wasReleased } from '../../engine/input/types.ts';
import { EventKind, event, type SportEvent } from '../../engine/match/events.ts';
import { NO_ENTITY, type EntityId, type World } from '../../engine/world.ts';
import {
  DEFAULT_BALL_PHYSICS,
  attach,
  canCatch,
  createBall,
  stepBall,
  type BallState,
} from '../../engine/physics/ball.ts';
import { integrate, movementProfile, type MovementProfile } from '../../engine/physics/movement.ts';
import { resolveCollisions } from '../../engine/physics/collision.ts';
import { arrive } from '../../engine/physics/steering.ts';
import {
  ShotMovement,
  caromOffRim,
  releaseWindow,
  shotProbability,
  contestFromDirection,
  dropThroughNet,
  isOverheld,
  releaseQuality,
  shotInputAt,
  startShot,
  takeShot,
  type ShooterRatings,
  type ShotInFlight,
  type ShotMeter,
  type ShotMovementName,
} from './shooting.ts';
import {
  PASSING,
  ballSpeed,
  canIntercept,
  catchControl,
  contest as contestCatch,
  interceptControl,
  leadTarget,
  selectPassTarget,
  throwPass,
  type InterceptorRatings,
  type PassInFlight,
  type PasserRatings,
  type ReceiverRatings,
} from './passing.ts';
import {
  Contact,
  DRIBBLING,
  blowByChance,
  canBlowBy,
  fumbleBall,
  fumbleChance,
  resolveContact,
  staggerFactor,
  type BodyRatings,
  type HandlerRatings,
} from './dribbling.ts';
import {
  REBOUNDING,
  contenderWeight,
  isBoxedOut,
  jumpTiming,
  pickRebounder,
  type Contender,
  type RebounderRatings,
} from './rebounding.ts';
import {
  BlockResult,
  DEFENCE,
  StealResult,
  approachAngle,
  assignMarks,
  boxOutSpot,
  foulChance,
  freeThrowProbability,
  markingSpot,
  resolveBlock,
  resolveSteal,
  type AttackerRatings,
  type DefenderRatings,
  type FreeThrowRatings,
} from './defence.ts';
import {
  CPU,
  Decision,
  decide,
  expectedPoints,
  offensiveSpot,
  screenSpot,
  shouldCut,
  shouldHelp,
  zoneSpot,
  type Look,
} from './cpu.ts';
import { cycleControlled, pickControlled, shouldAutoSwitch, type Candidate } from './control.ts';
import { BASKETBALL_ARCADE } from './arcade/index.ts';
import { basketballPlaybook } from './playbook/index.ts';
import type {
  ActionIntent,
  MatchSetup,
  RoleTable,
  SportAiAdapter,
  SportHudSpec,
  SportModule,
  SportRenderer,
  SportState,
} from '../types.ts';
import {
  CENTRE_Y,
  COURT,
  attackedBasket,
  basketballCourt,
  defendedBasket,
  freeThrowSpot,
  mirrorX,
  shotValue,
  shotZone,
  type Side as CourtSide,
} from './court.ts';
import { Detail } from '../../engine/render/renderer.ts';
import type { SportAudio } from '../../modes/live/audio.ts';
import { courtKey, drawCourt } from './court-render.ts';
import { drawAthlete, drawBall, paletteFor } from './art.ts';
import { BASKETBALL_PHYSICAL, BASKETBALL_POSITION_WEIGHTS, BASKETBALL_WEIGHTS } from './weights.ts';
import { BASKETBALL_XP_AWARDS } from './xp.ts';
import { rosterEntry } from './roster.ts';
import type { Athlete } from '../../athletes/types.ts';
import {
  NO_COUPLING,
  degradeControl,
  delayReaction,
  timingSpread,
  type Coupling,
} from '../../athletes/coupling.ts';
import {
  BASKETBALL_RULES,
  BasketballEvent,
  RestartKind,
  ShotClockReset,
  checkBackcourt,
  checkOutOfBounds,
  completeRestart,
  createRulesState,
  gameClockSeconds,
  grantPossession,
  inBonus,
  isFouledOut,
  markRestartReady,
  onBasketMade,
  onPeriodStart,
  recordFoul,
  registerTouch,
  resolveFreeThrow,
  shotClockSeconds,
  tickClocks,
  type RulesState,
} from './rules.ts';

/** Entity kinds. Opaque to the engine; only this module assigns meaning. */
const Kind = { ATHLETE: 0, BALL: 1 } as const;

/** How close an athlete must be to collect a loose ball. */
const CATCH_REACH = 1.0;

/**
 * Default placements as fractions of the court, measured from the end the role's team defends —
 * the convention `RoleTable` sets. A defensive shell, because that is the shape a possession
 * starts from and everything else is a movement away from it.
 */
const roles: RoleTable = {
  roles: [
    { id: 'PG', name: 'Point Guard', x: 0.34, y: 0.5 },
    { id: 'SG', name: 'Shooting Guard', x: 0.28, y: 0.2 },
    { id: 'SF', name: 'Small Forward', x: 0.28, y: 0.8 },
    { id: 'PF', name: 'Power Forward', x: 0.17, y: 0.34 },
    { id: 'C', name: 'Centre', x: 0.14, y: 0.55 },
  ],
};

export interface BasketballState extends SportState {
  readonly ball: EntityId;
  readonly ballState: BallState;
  /** Per-entity movement profiles, indexed by entity id. */
  readonly profiles: Map<EntityId, MovementProfile>;
  readonly sides: Map<EntityId, CourtSide>;
  /** Index into `roles.roles`, per athlete. */
  readonly roleIndex: Map<EntityId, number>;
  /** Basketball ratings, per athlete. Real athletes replace these at T-3.17. */
  readonly ratings: Map<EntityId, AthleteRatings>;
  /**
   * How lost each athlete is in basketball (T-3.6). Absent means at home — which is what a
   * seeded fallback roster always is, and what a real athlete is in their own sport.
   */
  readonly coupling: Map<EntityId, Coupling>;
  /**
   * Entity → the athlete playing it, for entities backed by a real athlete (T-3.17). Absent for a
   * seeded fallback athlete, which has no record to attribute anything to. This is what lets the
   * post-match progression pass (`athletes/progression.ts`) award minutes and XP to the right
   * person without the sim knowing anything about XP.
   */
  readonly athleteIds: Map<EntityId, string>;
  /** The shot being charged, if any — at most one, since only the carrier can shoot. */
  meter: ShotMeter | null;
  /** Who is charging it, and the hold a CPU shooter is aiming for. */
  shooter: EntityId;
  cpuRelease: number;
  /** The ball's current flight, or `null`. */
  shot: ShotInFlight | null;
  /** The pass currently in the air, or `null`. */
  pass: PassInFlight | null;
  /** True between a miss and whoever collects it — what makes the next catch a rebound. */
  reboundLive: boolean;
  /** Steps of reduced speed per athlete — a beaten defender, or a carrier stood up by contact. */
  readonly stagger: Map<EntityId, number>;
  /** Defenders the carrier has already tried to beat this possession, so a drive is one attempt. */
  readonly beaten: Set<EntityId>;
  /** The defender the carrier is currently leaning on, so contact resolves once per collision. */
  contactWith: EntityId;
  /** Defender → the attacker they are marking, recomputed when possession changes. */
  readonly marks: Map<EntityId, EntityId>;
  /** Which side the current assignments were drawn for, so they are recomputed exactly once. */
  marksFor: 0 | 1 | -1;
  /** Steps until each defender may lunge again — a steal is an attempt, not a state. */
  readonly stealCooldown: Map<EntityId, number>;
  /** Steps the free-throw shooter has been set at the line. */
  freeThrowSetup: number;
  /** Steps of cut left, per off-ball attacker. */
  readonly cutting: Map<EntityId, number>;
  /** The screener and how long they keep setting it. */
  screener: EntityId;
  screenSteps: number;
  /** Which side plays zone this match, or `-1` for man on both sides. */
  zoneSide: 0 | 1 | -1;
  /** The step the current carrier took possession, so a receiver squares up before passing on. */
  receivedAt: number;
  /** Whether control follows the ball automatically. An assist (`06` §2), not a difficulty. */
  autoSwitch: boolean;
  /** Possession as of the previous step, so a change can be detected rather than inferred. */
  previousPossession: 0 | 1 | -1;
  readonly playerSide: 0 | 1 | -1;
  controlled: EntityId;
  step: number;
  /** The rule book. */
  readonly rules: RulesState;
  /** Steps since the current period started, which is what the game clock counts. */
  periodStep: number;
  /** Steps the inbounder has held the ball at the spot, waiting to put it in play. */
  restartSetup: number;
  /** The athlete taking the pending restart, or `NO_ENTITY`. */
  inbounder: EntityId;
  /** Scratch buffer for neighbour queries — allocated once, never per step. */
  readonly scratch: Int32Array;
}

const hud: SportHudSpec = {
  showShotClock: true,
  showPossession: true,
  // Both of these were the HUD's hardcoded assumptions until T-6.28 made them the sport's to state.
  // Named explicitly rather than left to default, so the contrast with soccer is readable here.
  clock: 'remaining',
  foulLabel: 'PF',
  // @spec-ref 06-game-design.md §2 — context-sensitive button labels
  buttonLabels: {
    onBall: ['Shoot', 'Pass'],
    offBall: ['Call', 'Screen'],
    defence: ['Steal', 'Block'],
  },
};

/**
 * What basketball sounds like (T-2.12's mapping, moved out of `modes/live/audio.ts` by T-6.16 so
 * that file stops importing a sport).
 */
const audio: SportAudio = {
  cue(sportEvent) {
    switch (sportEvent.kind) {
      case EventKind.SHOT:
        return 'attempt';
      case EventKind.SCORE:
        return 'swish';
      case EventKind.REBOUND:
        // @spec-ref 06-game-design.md §9 — "rim". There is no dedicated "miss" event on the bus:
        // `EventKind.SHOT` fires at release regardless of outcome and a make is `EventKind.SCORE`,
        // so a rebound — which only ever follows a miss — is the one observable proxy this stream
        // offers for "the shot missed".
        return 'clank';
      case EventKind.FOUL:
        return 'whistle';
      case EventKind.PERIOD_END:
      case EventKind.MATCH_END:
        return 'buzzer';
      case EventKind.SPORT:
        return sportEvent.sportKind === BasketballEvent.CONTROL_SWITCH ? 'tick' : null;
      default:
        return null;
    }
  },
};

const render: SportRenderer = {
  fieldKey: courtKey,
  drawField(ctx, field) {
    drawCourt(ctx, field);
  },

  /**
   * Bodies and kit. **Moved here from `modes/live/screen.ts` by T-6.16**, which found the shared
   * screen importing this module by name and therefore drawing soccer with basketball's art.
   */
  drawAthletes(ctx, _state, world, controlled) {
    const palette = paletteFor('dark');
    world.forEach((id) => {
      if (world.kind[id] === 1) return;
      const team = world.team[id] === 1 ? 1 : 0;
      drawAthlete(
        ctx,
        world.x[id] as number,
        world.y[id] as number,
        world.facing[id] as number,
        palette.teams[team],
        Detail.FULL,
        { team, controlled: id === controlled, radius: world.radius[id] as number },
      );
    });
  },

  drawBall(ctx, _state, world, ball) {
    if (ball === NO_ENTITY) return;
    drawBall(
      ctx,
      world.x[ball] as number,
      world.y[ball] as number,
      world.z[ball] as number,
      paletteFor('dark'),
      Detail.FULL,
      { radius: world.radius[ball] as number },
    );
  },

  drawOverlay() {
    // Possession arrows and zone highlights land with the art pass (T-2.12).
  },
};

/** Placeholder until T-2.8. Enough shape that the framework has something to score. */
const ai: SportAiAdapter = {
  options(state, _world, actor, out) {
    const s = state as BasketballState;
    if (s.ballState.carrier === actor) {
      out.push({ kind: 'drive' });
      out.push({ kind: 'pass' });
    } else {
      out.push({ kind: 'position' });
    }
  },
  score(_state, _world, _actor, option) {
    return option.kind === 'drive' ? 0.6 : option.kind === 'pass' ? 0.5 : 0.2;
  },
};

/** Steps an inbounder is given to walk to the spot before the ball is put in play. */
const RESTART_SETUP_STEPS = 30;

/** Shot-clock seconds below which a shooter is hurrying. */
const LATE_CLOCK_SECONDS = 6;

/** Steps of hold that make a perfect release — mirrored from `SHOOTING.idealHoldSteps`. */
const SHOT_IDEAL_HOLD = 22;

/** Above this the ball is still on its way down and nobody has a hand on it. */
const REBOUND_MAX_HEIGHT = 2.6;

/**
 * Per-step chance the CPU acts on a decision to pass. Stands in for reaction latency until T-7.x
 * makes it a difficulty dial (`06` §7); it is not a judgement, only a delay.
 */
const CPU_PASS_REACTION_PER_STEP = 0.06;

/** Steps a receiver takes to gather and square up before they will pass again. */
const PASS_SETTLE_STEPS = 40;

/**
 * The release quality the CPU assumes when valuing its own shot. Not a perfect one: assuming a
 * perfect release makes the CPU shoot from everywhere, because every shot looks better in the
 * decision than it turns out to be at the meter.
 */
const CPU_ASSUMED_RELEASE = 0.62;

/** Per-step chance a CPU defender in range lunges for the ball, before the steal itself is rolled. */
const CPU_STEAL_CHANCE_PER_STEP = 0.006;

/**
 * Per-step chance a CPU defender in range goes up to contest a shot in the air. Very low, because
 * the shot hangs for half a second and every step is another chance — and because T-2.8's help
 * defence puts a defender near the shooter far more often than the man-only version did. At 0.05
 * a headless game produced thirteen blocks; with help rotations the same number gave twenty-one.
 * The balance pass (T-2.13) halved it again: at 0.009 the five-hundred-game run blocked 8.8% of all
 * field-goal attempts, which is roughly twice a real game and was holding the whole floor's
 * shooting percentage below its band on its own.
 */
const CPU_BLOCK_CHANCE_PER_STEP = 0.0045;

/** Steps a free-throw shooter takes to set before the ball goes up. */
const FREE_THROW_SETUP_STEPS = 25;

/**
 * Pass-assist strength (`06` §2). One number, on the player's side of the ball, widening the cone
 * target selection snaps within. Difficulty sets it from T-7.x; until then, "moderate" (INV-1).
 */
const PASS_ASSIST = 1;

export const basketball: SportModule<BasketballState> = {
  id: 'basketball',
  meta: { displayName: 'Basketball', squadSize: 5, periodName: 'Quarter' },
  rules: BASKETBALL_RULES,
  field: basketballCourt,
  ratingWeights: BASKETBALL_WEIGHTS,
  physicalModifiers: BASKETBALL_PHYSICAL,
  positionWeights: BASKETBALL_POSITION_WEIGHTS,
  xpAwards: BASKETBALL_XP_AWARDS,
  roles,
  ai,
  render,
  hud,
  audio,
  arcade: BASKETBALL_ARCADE,
  playbook: basketballPlaybook,

  createState(setup: MatchSetup, world: World, rng: Rng): BasketballState {
    const squadSize = Math.min(setup.squadSize ?? this.meta.squadSize, roles.roles.length);
    const profiles = new Map<EntityId, MovementProfile>();
    const sides = new Map<EntityId, CourtSide>();
    const roleIndex = new Map<EntityId, number>();
    const ratings = new Map<EntityId, AthleteRatings>();
    // Empty until T-3.17: every athlete is at home in basketball, so nothing is coupled and no
    // call site below draws for it.
    const coupling = new Map<EntityId, Coupling>();
    const athleteIds = new Map<EntityId, string>();

    // Rosters come from their own fork, so adding a draw elsewhere cannot change who is fast.
    const rosterRng = rng.fork('roster');

    for (const side of [0, 1] as const) {
      for (let index = 0; index < squadSize; index++) {
        const role = roles.roles[index] as (typeof roles.roles)[number];
        const spot = roleSpot(role.x, role.y, side);

        const id = world.spawn({
          x: spot.x,
          y: spot.y,
          facing: side === 0 ? 0 : Math.PI,
          radius: 0.42,
          mass: 95,
          team: side,
          kind: Kind.ATHLETE,
          tag: index,
        });

        sides.set(id, side);
        roleIndex.set(id, index);

        // A real athlete if the lineup supplied one; otherwise a seeded stand-in, so a match can
        // always start (T-3.17). The fallback draws from `rosterRng` exactly as it always did, so
        // a rosterless match is byte-identical to the pre-T-3.17 one and every golden-seed test
        // and the 500-game balance harness keep their results.
        const athlete = setup.rosters?.[side]?.[index];
        if (athlete === undefined) {
          const rating = rosterRng.int(45, 85);
          profiles.set(
            id,
            movementProfile({ speed: rating, acceleration: rating, agility: rating }),
          );
          ratings.set(id, rollRatings(rosterRng, index));
        } else {
          const entry = rosterEntry(athlete);
          profiles.set(id, entry.movement);
          ratings.set(id, entry.ratings);
          athleteIds.set(id, entry.athleteId);
          // Zero coupling is the common case and costs no random draw; only store a real one.
          if (entry.coupling.lostness > 0) coupling.set(id, entry.coupling);
        }
      }
    }

    const ballState = createBall(
      world,
      COURT.length / 2,
      CENTRE_Y,
      DEFAULT_BALL_PHYSICS,
      Kind.BALL,
    );

    const controlled =
      setup.playerSide === -1
        ? NO_ENTITY
        : ([...sides.entries()].find(([, side]) => side === setup.playerSide)?.[0] ?? NO_ENTITY);

    world.reindex();

    const state: BasketballState = {
      sport: 'basketball',
      ball: ballState.entity,
      ballState,
      profiles,
      sides,
      roleIndex,
      ratings,
      coupling,
      athleteIds,
      meter: null,
      shooter: NO_ENTITY,
      cpuRelease: 0,
      shot: null,
      pass: null,
      reboundLive: false,
      stagger: new Map(),
      beaten: new Set(),
      contactWith: NO_ENTITY,
      marks: new Map(),
      marksFor: -1,
      stealCooldown: new Map(),
      freeThrowSetup: 0,
      cutting: new Map(),
      screener: NO_ENTITY,
      screenSteps: 0,
      receivedAt: 0,
      autoSwitch: true,
      previousPossession: -1,
      // One side plays a 2-3 zone, chosen by the match seed, so both schemes get exercised.
      //
      // One fork, two draws. Forking twice with the same label gives two *identical* streams, so
      // the second draw was a deterministic function of the first — and the answer was always
      // side 0. Every zone in five hundred headless games was played by the home team.
      zoneSide: pickScheme(rng.fork('scheme')),
      playerSide: setup.playerSide,
      controlled,
      step: 0,
      periodStep: 0,
      rules: createRulesState(rng.fork('tip').bool() ? 1 : 0),
      restartSetup: 0,
      inbounder: NO_ENTITY,
      scratch: new Int32Array(64),
    };

    onPeriodStart(state.rules, 1, 0);
    return state;
  },

  step(
    state: BasketballState,
    world: World,
    inputs: ReadonlyMap<EntityId, InputFrame>,
    dt: number,
    rng: Rng,
  ): readonly SportEvent[] {
    const events: SportEvent[] = [];
    state.step++;
    state.periodStep++;

    const ball = state.ballState;

    moveEveryone(state, world, inputs, dt);

    world.reindex();
    resolveCollisions(world, state.scratch);
    world.reindex();

    events.push(...advanceRestart(state, world, rng));
    events.push(...driveControl(state, world, inputs));
    driveOffBall(state, world, rng);
    events.push(...driveFreeThrows(state, world, inputs, rng));
    events.push(...driveDefence(state, world, inputs, rng));
    events.push(...driveDribbling(state, world, inputs, rng));
    events.push(...driveShooting(state, world, inputs, rng));
    events.push(...drivePassing(state, world, inputs, rng));
    events.push(...resolveFlight(state, world, rng));
    events.push(...resolvePass(state, world, rng));

    // A ball in flight is nobody's to catch — that is what makes a shot a shot.
    if (
      ball.carrier === NO_ENTITY &&
      state.shot === null &&
      state.pass === null &&
      state.rules.freeThrows === null
    ) {
      events.push(...collectLooseBall(state, world, rng));
    }

    stepBall(world, ball, dt, DEFAULT_BALL_PHYSICS);

    const ballX = world.x[ball.entity] as number;
    const ballY = world.y[ball.entity] as number;

    // Only a loose ball can go out: athletes are clamped to the court, so a carried ball's
    // position is always a consequence of a legal one.
    if (ball.carrier === NO_ENTITY) {
      events.push(...checkOutOfBounds(state.rules, ballX, ballY, state.step));
    }
    events.push(...checkBackcourt(state.rules, ballX, state.step));
    events.push(...tickClocks(state.rules, ballX, state.step));

    return events;
  },

  resolveAction(
    state: BasketballState,
    world: World,
    actor: EntityId,
    action: ActionIntent,
    rng: Rng,
  ): readonly SportEvent[] {
    if (state.ballState.carrier !== actor || action.kind !== 'pass') return [];
    const side = state.sides.get(actor);
    if (side === undefined) return [];

    const target =
      action.target !== undefined && state.sides.get(action.target) === side
        ? action.target
        : pickTarget(state, world, actor, side, action.targetX ?? 0, action.targetY ?? 0);

    return makePass(state, world, actor, side, target, action.power ?? 1, rng);
  },

  isFinished(): boolean {
    // The match clock decides; basketball has no early finish.
    return false;
  },

  /**
   * What the presentation layer is allowed to know (`modes/live/match.ts`).
   *
   * The HUD reading `state.rules.shotClock` directly would put basketball's field names in shared UI
   * and break INV-5 the moment a second sport arrives. This is the sport's side of that contract:
   * generic names, generic units, nothing basketball-shaped escaping.
   */
  status(state: BasketballState) {
    const rules = state.rules;
    return {
      actionClock: shotClockSeconds(rules),
      teamFouls: [rules.teamFouls[0], rules.teamFouls[1]] as [number, number],
      bonus: [inBonus(rules, 0), inBonus(rules, 1)] as [boolean, boolean],
      possession: rules.possession,
      controlled: state.controlled,
      stoppage:
        rules.freeThrows !== null
          ? 'free throw'
          : rules.restart !== null
            ? rules.restart.reason
            : null,
      meter: state.meter === null ? null : Math.min(1, state.meter.charge / SHOT_IDEAL_HOLD),
      periodClock: gameClockSeconds(state.periodStep, 1),
    };
  },

  /** Called by the mode host when a new period starts, so the sport can reset what it owns. */
  startPeriod(state: BasketballState, period: number): void {
    state.periodStep = 0;
    onPeriodStart(state.rules, period, state.step);
  },
};

/**
 * Steals and blocks — the two things a defender can do about the ball, and the two things that can
 * put the other team on the line.
 *
 * A steal that could only succeed or fail would be free to spam. One that can also concede two
 * shots is a decision, which is what `06` §3.3 is asking for.
 */
function driveDefence(
  state: BasketballState,
  world: World,
  inputs: ReadonlyMap<EntityId, InputFrame>,
  rng: Rng,
): SportEvent[] {
  for (const [id, steps] of state.stealCooldown) {
    if (steps <= 1) state.stealCooldown.delete(id);
    else state.stealCooldown.set(id, steps - 1);
  }

  if (state.rules.restart !== null || state.rules.freeThrows !== null) return [];

  const offence = state.rules.possession;
  if (offence === -1) return [];
  const carrier = state.ballState.carrier;

  const events: SportEvent[] = [];
  const defenders: EntityId[] = [];
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (state.sides.get(id) !== offence) defenders.push(id);
  });

  for (const defender of defenders) {
    if (events.length > 0) break;
    if ((state.stealCooldown.get(defender) ?? 0) > 0) continue;
    if (isFouledOut(state.rules, defender)) continue;

    const input = inputs.get(defender);
    // Block a shot in the air; otherwise go for the ball.
    if (state.shot !== null) {
      events.push(...tryBlock(state, world, defender, input, rng));
    } else if (carrier !== NO_ENTITY) {
      events.push(...trySteal(state, world, defender, carrier, input, rng));
    }
  }

  return events;
}

/** A lunge at the ball-handler. */
function trySteal(
  state: BasketballState,
  world: World,
  defender: EntityId,
  carrier: EntityId,
  input: InputFrame | undefined,
  rng: Rng,
): SportEvent[] {
  const defenderRatings = state.ratings.get(defender);
  const carrierRatings = state.ratings.get(carrier);
  const defenderSide = state.sides.get(defender);
  const carrierSide = state.sides.get(carrier);
  if (
    defenderRatings === undefined ||
    carrierRatings === undefined ||
    defenderSide === undefined ||
    carrierSide === undefined
  ) {
    return [];
  }

  const distance = Math.hypot(
    (world.x[defender] as number) - (world.x[carrier] as number),
    (world.y[defender] as number) - (world.y[carrier] as number),
  );
  if (distance > DEFENCE.stealReach) return [];

  const wants =
    input !== undefined ? wasPressed(input, Button.A) : rng.bool(CPU_STEAL_CHANCE_PER_STEP);
  if (!wants) return [];

  state.stealCooldown.set(defender, DEFENCE.stealCooldown);

  const approach = approachAngle(
    { x: world.vx[defender] as number, y: world.vy[defender] as number },
    { x: world.vx[carrier] as number, y: world.vy[carrier] as number },
  );
  const differential = Math.hypot(
    (world.vx[defender] as number) - (world.vx[carrier] as number),
    (world.vy[defender] as number) - (world.vy[carrier] as number),
  );

  const result = resolveSteal(
    defenderRatings,
    carrierRatings,
    distance,
    approach,
    differential,
    rng,
  );

  if (result === StealResult.STOLEN) {
    attach(world, state.ballState, defender);
    state.beaten.clear();
    state.contactWith = NO_ENTITY;
    return [
      event(EventKind.TURNOVER, state.step, carrierSide, { detail: { reason: 'stolen' } }),
      event(EventKind.SPORT, state.step, defenderSide, {
        sportKind: BasketballEvent.STEAL,
        actor: defender,
        target: carrier,
      }),
      ...grantPossession(
        state.rules,
        defenderSide,
        state.step,
        ShotClockReset.FULL,
        world.x[defender] as number,
        defender,
      ),
    ];
  }

  if (result === StealResult.FOULED) {
    return recordFoul(state.rules, defender, defenderSide, carrier, state.step, {
      ballX: world.x[state.ballState.entity] as number,
    });
  }

  return [];
}

/** A challenge on a shot already in the air. */
function tryBlock(
  state: BasketballState,
  world: World,
  defender: EntityId,
  input: InputFrame | undefined,
  rng: Rng,
): SportEvent[] {
  const shot = state.shot;
  if (shot === null) return [];

  const defenderRatings = state.ratings.get(defender);
  const defenderSide = state.sides.get(defender);
  if (defenderRatings === undefined || defenderSide === undefined) return [];
  if (!world.isAlive(shot.shooter)) return [];

  const distance = Math.hypot(
    (world.x[defender] as number) - (world.x[shot.shooter] as number),
    (world.y[defender] as number) - (world.y[shot.shooter] as number),
  );
  if (distance > DEFENCE.blockReach) return [];

  const wants =
    input !== undefined ? wasPressed(input, Button.B) : rng.bool(CPU_BLOCK_CHANCE_PER_STEP);
  if (!wants) return [];

  state.stealCooldown.set(defender, DEFENCE.stealCooldown);

  const approach = approachAngle(
    { x: world.vx[defender] as number, y: world.vy[defender] as number },
    { x: world.vx[shot.shooter] as number, y: world.vy[shot.shooter] as number },
  );
  const differential = Math.hypot(
    (world.vx[defender] as number) - (world.vx[shot.shooter] as number),
    (world.vy[defender] as number) - (world.vy[shot.shooter] as number),
  );

  const result = resolveBlock(defenderRatings, distance, shot.release, approach, differential, rng);

  if (result === BlockResult.BLOCKED) {
    state.shot = null;
    caromOffRim(world, state.ballState, shot.side, rng);
    state.reboundLive = true;
    registerTouch(state.rules, defenderSide);
    return [
      event(EventKind.SAVE, state.step, defenderSide, { actor: defender, target: shot.shooter }),
      event(EventKind.SPORT, state.step, defenderSide, {
        sportKind: BasketballEvent.BLOCK,
        actor: defender,
        target: shot.shooter,
      }),
    ];
  }

  if (result === BlockResult.FOULED) {
    // A foul on a shooter is a shooting foul, and the shot still counts if it drops.
    state.shot = null;
    const made = shot.made;
    const events: SportEvent[] = [];
    if (made) {
      dropThroughNet(world, state.ballState, shot.side);
      events.push(
        event(EventKind.SCORE, state.step, shot.side, {
          value: shot.value,
          actor: shot.shooter,
        }),
      );
    } else {
      caromOffRim(world, state.ballState, shot.side, rng);
    }
    state.reboundLive = false;
    events.push(
      ...recordFoul(state.rules, defender, defenderSide, shot.shooter, state.step, {
        shooting: true,
        shotValue: shot.value,
        made,
      }),
    );
    return events;
  }

  return [];
}

/**
 * The trip to the line. Play stops, the shooter sets, and each attempt goes through the same
 * release meter as every other shot — because a free throw is the release meter with nothing else
 * attached, and that is what makes `freeThrow` worth having as its own rating.
 */
function driveFreeThrows(
  state: BasketballState,
  world: World,
  inputs: ReadonlyMap<EntityId, InputFrame>,
  rng: Rng,
): SportEvent[] {
  const set = state.rules.freeThrows;
  if (set === null) {
    state.freeThrowSetup = 0;
    return [];
  }

  const shooter = set.shooter;
  const ratings = state.ratings.get(shooter);
  if (ratings === undefined || !world.isAlive(shooter)) return [];

  const line = freeThrowSpot(set.side);
  attach(world, state.ballState, shooter);

  const atLine =
    Math.hypot((world.x[shooter] as number) - line.x, (world.y[shooter] as number) - line.y) < 1.3;
  if (!atLine) {
    state.freeThrowSetup = 0;
    state.meter = null;
    return [];
  }

  state.freeThrowSetup++;
  if (state.freeThrowSetup < FREE_THROW_SETUP_STEPS) return [];

  // The release meter, with nothing on it but the shooter's nerve. Same meter as every other shot,
  // which is what makes `freeThrow` worth having as its own rating rather than a flat percentage.
  const input = inputs.get(shooter);
  if (state.meter === null) {
    state.meter = {
      charge: 0,
      window: releaseWindow(ratings.freeThrow),
      movement: ShotMovement.SET,
    };
    state.shooter = shooter;
    state.cpuRelease = Math.round(
      SHOT_IDEAL_HOLD +
        rng.float(-1, 1) * state.meter.window * 0.7 * timingSpread(couplingOf(state, shooter)),
    );
    return [];
  }

  state.meter.charge++;
  const letGo =
    input !== undefined
      ? wasReleased(input, Button.A) || isOverheld(state.meter)
      : state.meter.charge >= state.cpuRelease || isOverheld(state.meter);
  if (!letGo) return [];

  const quality = releaseQuality(state.meter);
  state.meter = null;
  state.shooter = NO_ENTITY;
  state.freeThrowSetup = 0;

  // The last of a set is the one that matters, and composure is what answers it.
  const pressure = set.remaining === 1 && set.total > 1 ? 1 : 0;
  const probability = freeThrowProbability(ratings, quality, pressure);
  const made = rng.bool(probability);

  const events: SportEvent[] = [
    event(EventKind.SHOT, state.step, set.side, {
      actor: shooter,
      value: 1,
      x: line.x,
      y: line.y,
      detail: { zone: 'freeThrow', release: round3(quality), probability: round3(probability) },
    }),
  ];

  if (made) dropThroughNet(world, state.ballState, set.side);
  events.push(...resolveFreeThrow(state.rules, made, state.step));

  // A missed last free throw is a live ball on the rim.
  if (!made && state.rules.freeThrows === null) {
    caromOffRim(world, state.ballState, set.side, rng);
    state.reboundLive = true;
  }

  return events;
}

/**
 * Everything that can happen to the ball while somebody is carrying it: losing the handle, meeting
 * a body, and getting past one.
 *
 * All three are per-step draws, because a drive is two seconds of sustained pressure rather than an
 * event — the model has to be able to say "he lost it halfway in".
 */
function driveDribbling(
  state: BasketballState,
  world: World,
  inputs: ReadonlyMap<EntityId, InputFrame>,
  rng: Rng,
): SportEvent[] {
  for (const [id, steps] of state.stagger) {
    if (steps <= 1) state.stagger.delete(id);
    else state.stagger.set(id, steps - 1);
  }

  const carrier = state.ballState.carrier;
  if (carrier === NO_ENTITY || state.rules.restart !== null || state.rules.freeThrows !== null) {
    state.contactWith = NO_ENTITY;
    return [];
  }
  // A planted shooter is not dribbling.
  if (state.meter !== null) return [];

  const side = state.sides.get(carrier);
  const ratings = state.ratings.get(carrier);
  const profile = state.profiles.get(carrier);
  if (side === undefined || ratings === undefined || profile === undefined) return [];

  const pressure = contestOn(state, world, carrier, side);
  const speed = Math.hypot(world.vx[carrier] as number, world.vy[carrier] as number);
  const sprinting = isHeld(inputs.get(carrier) ?? EMPTY_FRAME, Button.MODIFIER);

  if (rng.bool(fumbleChance(ratings, pressure, speed, profile.maxSpeed, sprinting))) {
    fumbleBall(world, state.ballState, carrier, rng);
    registerTouch(state.rules, side);
    state.reboundLive = false;
    return [
      event(EventKind.SPORT, state.step, side, {
        sportKind: BasketballEvent.FUMBLE,
        actor: carrier,
      }),
    ];
  }

  return resolveDefenderContact(state, world, carrier, side, ratings, rng);
}

/** The nearest defender in the carrier's way: beaten, absorbed, or a wall. */
function resolveDefenderContact(
  state: BasketballState,
  world: World,
  carrier: EntityId,
  side: CourtSide,
  ratings: AthleteRatings,
  rng: Rng,
): SportEvent[] {
  const target = carryTarget(state, world, carrier, side);

  let defender = NO_ENTITY;
  let gap = Infinity;
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (state.sides.get(id) === side) return;
    const d = Math.hypot(
      (world.x[id] as number) - (world.x[carrier] as number),
      (world.y[id] as number) - (world.y[carrier] as number),
    );
    if (d < gap) {
      gap = d;
      defender = id;
    }
  });

  if (defender === NO_ENTITY) return [];
  const defenderRatings = state.ratings.get(defender);
  if (defenderRatings === undefined) return [];

  // One attempt per defender per possession, so a drive is a move rather than a dice tower.
  if (!state.beaten.has(defender) && canBlowBy(world, carrier, defender, target.x, target.y)) {
    state.beaten.add(defender);
    if (rng.bool(blowByChance(ratings, defenderRatings))) {
      state.stagger.set(defender, DRIBBLING.blowByStaggerSteps);
      return [
        event(EventKind.SPORT, state.step, side, {
          sportKind: BasketballEvent.BLOW_BY,
          actor: carrier,
          target: defender,
        }),
      ];
    }
  }

  const touching =
    gap <=
    (world.radius[carrier] as number) +
      (world.radius[defender] as number) +
      DRIBBLING.contactMargin;

  // Contact is a collision, not a state: it resolves on the step the two bodies meet and not on
  // each of the eighty steps they then spend leaning on each other.
  if (!touching) {
    if (state.contactWith === defender) state.contactWith = NO_ENTITY;
    return [];
  }
  if (state.contactWith === defender) return [];
  state.contactWith = defender;

  const closing = Math.hypot(
    (world.vx[carrier] as number) - (world.vx[defender] as number),
    (world.vy[carrier] as number) - (world.vy[defender] as number),
  );
  const result = resolveContact(ratings, defenderRatings, closing, rng);

  if (result.kind === Contact.ABSORBED) return [];

  // `06` §3.1's foul is approach angle × speed differential × discipline, which is precisely what a
  // driver meeting a body is. Scaled by how heavy the collision was.
  const defenderSide = state.sides.get(defender);
  if (defenderSide !== undefined && !isFouledOut(state.rules, defender)) {
    const approach = approachAngle(
      { x: world.vx[defender] as number, y: world.vy[defender] as number },
      { x: world.vx[carrier] as number, y: world.vy[carrier] as number },
    );
    if (rng.bool(foulChance(defenderRatings, approach, closing) * result.severity)) {
      state.contactWith = NO_ENTITY;
      return recordFoul(state.rules, defender, defenderSide, carrier, state.step, {
        ballX: world.x[state.ballState.entity] as number,
      });
    }
  }

  state.stagger.set(carrier, DRIBBLING.contactStaggerSteps);
  world.vx[carrier] = (world.vx[carrier] as number) * result.speedFactor;
  world.vy[carrier] = (world.vy[carrier] as number) * result.speedFactor;

  const events: SportEvent[] = [
    event(EventKind.SPORT, state.step, side, {
      sportKind: BasketballEvent.CONTACT,
      actor: carrier,
      target: defender,
      // T-2.7's foul model reads this; nothing here decides whether a whistle blows.
      detail: { outcome: result.kind, severity: round3(result.severity) },
    }),
  ];

  if (result.kind === Contact.STRIPPED) {
    fumbleBall(world, state.ballState, carrier, rng);
    registerTouch(state.rules, side);
    state.reboundLive = false;
  }

  return events;
}

/**
 * Charges and releases shots.
 *
 * The player and the CPU go through the same meter: the player's release is their thumb, the CPU's
 * is a seeded target hold. One code path means the CPU cannot get a shot the player cannot take,
 * which is the difficulty invariant (INV-1) expressed as code rather than as a promise.
 */
function driveShooting(
  state: BasketballState,
  world: World,
  inputs: ReadonlyMap<EntityId, InputFrame>,
  rng: Rng,
): SportEvent[] {
  const ball = state.ballState;
  const carrier = ball.carrier;

  if (state.rules.freeThrows !== null) return [];

  // A shot cannot survive losing the ball.
  if (state.meter !== null && state.shooter !== carrier) {
    state.meter = null;
    state.shooter = NO_ENTITY;
  }
  if (carrier === NO_ENTITY || state.rules.restart !== null) return [];

  const side = state.sides.get(carrier);
  const ratings = state.ratings.get(carrier);
  if (side === undefined || ratings === undefined) return [];

  const x = world.x[carrier] as number;
  const y = world.y[carrier] as number;
  const input = inputs.get(carrier);

  if (state.meter === null) {
    const start =
      input !== undefined
        ? wasPressed(input, Button.A)
        : cpuWantsToShoot(state, world, carrier, side, rng);
    if (!start) return [];

    state.meter = startShot(ratings, shotZone(x, y, side), movementOf(world, carrier, side));
    state.shooter = carrier;
    // The CPU aims for the middle of its own window, missing by a seeded amount.
    state.cpuRelease = Math.round(
      SHOT_IDEAL_HOLD +
        rng.float(-1, 1) * state.meter.window * 0.8 * timingSpread(couplingOf(state, carrier)),
    );
    return [];
  }

  state.meter.charge++;

  const letGo =
    input !== undefined
      ? wasReleased(input, Button.A) || isOverheld(state.meter)
      : state.meter.charge >= state.cpuRelease || isOverheld(state.meter);
  if (!letGo) return [];

  const quality = releaseQuality(state.meter);
  const movement = state.meter.movement;
  state.meter = null;
  state.shooter = NO_ENTITY;

  const shotInput = shotInputAt(x, y, side, ratings, {
    contest: contestOn(state, world, carrier, side),
    release: quality,
    movement,
    clockPressure: clockPressure(state),
  });

  registerTouch(state.rules, side);
  const shot = takeShot(world, ball, carrier, side, shotInput, state.step, rng);
  state.shot = shot;

  return [
    event(EventKind.SHOT, state.step, side, {
      actor: carrier,
      value: shot.value,
      x,
      y,
      detail: {
        zone: shot.zone,
        release: round3(quality),
        contest: round3(shotInput.contest),
        probability: round3(shot.probability),
        movement,
      },
    }),
  ];
}

/** Turns a shot in flight into a basket or a rebound when it reaches the rim. */
function resolveFlight(state: BasketballState, world: World, rng: Rng): SportEvent[] {
  const shot = state.shot;
  if (shot === null || state.step < shot.resolveStep) return [];
  state.shot = null;

  if (!shot.made) {
    caromOffRim(world, state.ballState, shot.side, rng);
    state.reboundLive = true;
    return [];
  }

  dropThroughNet(world, state.ballState, shot.side);
  state.reboundLive = false;

  return [
    event(EventKind.SCORE, state.step, shot.side, {
      value: shot.value,
      actor: shot.shooter,
      x: world.x[state.ballState.entity] as number,
      y: world.y[state.ballState.entity] as number,
    }),
    ...onBasketMade(state.rules, shot.side, state.step),
  ];
}

/**
 * How smothered an athlete is: the worst contest any opponent is putting on them, weighted by
 * whether that opponent is actually *in the way* of the basket rather than merely nearby.
 */
function contestOn(state: BasketballState, world: World, actor: EntityId, side: CourtSide): number {
  const x = world.x[actor] as number;
  const y = world.y[actor] as number;
  const basket = attackedBasket(side);
  const toBasketX = basket.x - x;
  const toBasketY = basket.y - y;
  const toBasket = Math.hypot(toBasketX, toBasketY);
  if (toBasket < 1e-6) return 0;

  let worst = 0;
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (state.sides.get(id) === side) return;

    const dx = (world.x[id] as number) - x;
    const dy = (world.y[id] as number) - y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) return;

    const alignment = (dx * toBasketX + dy * toBasketY) / (distance * toBasket);
    const contest = contestFromDirection(distance, alignment);
    if (contest > worst) worst = contest;
  });

  return worst;
}

/** `0` with time to spare, `1` at the buzzer. */
function clockPressure(state: BasketballState): number {
  const seconds = shotClockSeconds(state.rules);
  return seconds >= LATE_CLOCK_SECONDS ? 0 : 1 - seconds / LATE_CLOCK_SECONDS;
}

/** Set, off the dribble, or fading — read from where the carrier is going, not from a button. */
function movementOf(world: World, actor: EntityId, side: CourtSide): ShotMovementName {
  const speed = Math.hypot(world.vx[actor] as number, world.vy[actor] as number);
  if (speed < 1) return ShotMovement.SET;

  const basket = attackedBasket(side);
  const toBasketX = basket.x - (world.x[actor] as number);
  const toBasketY = basket.y - (world.y[actor] as number);
  const towards = toBasketX * (world.vx[actor] as number) + toBasketY * (world.vy[actor] as number);
  return towards < 0 ? ShotMovement.FADEAWAY : ShotMovement.OFF_DRIBBLE;
}

/**
 * Placeholder shot selection, replaced by T-2.8. Deliberately simple and honest about it: take the
 * layup, take the open three, and never let the shot clock expire with the ball in your hands.
 */
function cpuWantsToShoot(
  state: BasketballState,
  world: World,
  actor: EntityId,
  side: CourtSide,
  rng: Rng,
): boolean {
  if (!state.rules.frontcourt) return false;
  return cpuDecision(state, world, actor, side, rng) === Decision.SHOOT;
}

/**
 * The possession decision, in expected points.
 *
 * The whole of the CPU's judgement runs through here, so shooting, passing, and driving cannot
 * disagree about what a possession is worth — which is what a separate rule per verb always ends up
 * doing.
 */
function cpuDecision(
  state: BasketballState,
  world: World,
  actor: EntityId,
  side: CourtSide,
  rng: Rng | null = null,
): ReturnType<typeof decide> {
  const coupling = couplingOf(state, actor);
  const own = misjudge(lookFor(state, world, actor, side), coupling, rng);
  const raw = bestTeammateLook(state, world, actor, side);
  const best = raw === null ? null : { ...raw, look: misjudge(raw.look, coupling, rng) };
  const seconds = shotClockSeconds(state.rules);
  return decide(own, best, laneContest(state, world, actor, side), seconds);
}

/** How lost this athlete is in basketball. At home — and so free — until T-3.17 (`05` §3.3). */
function couplingOf(state: BasketballState, actor: EntityId): Coupling {
  return state.coupling.get(actor) ?? NO_COUPLING;
}

/**
 * Blurs what a look is worth *to the athlete looking at it*. A lost athlete does not choose badly
 * on purpose — they misread the situation, and sometimes the misreading is right.
 *
 * The draw is skipped entirely when nothing is coupled, so an at-home athlete's PRNG stream is
 * byte-identical to the one before T-3.6 existed (INV-8).
 */
function misjudge(look: Look, coupling: Coupling, rng: Rng | null): Look {
  if (rng === null || coupling.decisionNoise === 0) return look;
  return { ...look, expected: look.expected + rng.gaussian(0, coupling.decisionNoise) };
}

/** What a shot from where this athlete stands is worth, right now. */
function lookFor(state: BasketballState, world: World, actor: EntityId, side: CourtSide): Look {
  const ratings = state.ratings.get(actor);
  const x = world.x[actor] as number;
  const y = world.y[actor] as number;
  const contest = contestOn(state, world, actor, side);
  if (ratings === undefined) return { expected: 0, contest };

  // Judged on a *typical* release rather than a perfect one — the CPU has to live with its own
  // timing like everyone else, and assuming a perfect release makes it shoot from everywhere.
  //
  // And judged on how it is actually moving. Valuing every shot as a set one made the CPU pull up
  // mid-stride from mid-range, which is the worst shot on the court taken in the worst way.
  const input = shotInputAt(x, y, side, ratings, {
    contest,
    release: CPU_ASSUMED_RELEASE,
    movement: movementOf(world, actor, side),
    clockPressure: clockPressure(state),
  });
  return { expected: expectedPoints(shotProbability(input), shotValue(x, y, side)), contest };
}

/** The teammate with the best look, and whether they are open enough to pass to. */
function bestTeammateLook(
  state: BasketballState,
  world: World,
  actor: EntityId,
  side: CourtSide,
): { look: Look; open: boolean; athlete: EntityId } | null {
  let best: { look: Look; open: boolean; athlete: EntityId } | null = null;

  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (id === actor || state.sides.get(id) !== side) return;

    const away = Math.hypot(
      (world.x[id] as number) - (world.x[actor] as number),
      (world.y[id] as number) - (world.y[actor] as number),
    );
    if (away < 2.5 || away > 17) return;

    const look = lookFor(state, world, id, side);
    if (best === null || look.expected > best.look.expected) {
      best = { look, open: look.contest < 0.55, athlete: id };
    }
  });

  return best;
}

/** How contested the path to the rim is — what makes a drive a good idea or a bad one. */
function laneContest(
  state: BasketballState,
  world: World,
  actor: EntityId,
  side: CourtSide,
): number {
  const basket = attackedBasket(side);
  const x = world.x[actor] as number;
  const y = world.y[actor] as number;
  const toBasketX = basket.x - x;
  const toBasketY = basket.y - y;
  const length = Math.hypot(toBasketX, toBasketY);
  if (length < 1e-6) return 0;

  let worst = 0;
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (state.sides.get(id) === side) return;

    const dx = (world.x[id] as number) - x;
    const dy = (world.y[id] as number) - y;
    const along = (dx * toBasketX + dy * toBasketY) / length;
    if (along < 0 || along > length) return;

    // Perpendicular distance from the drive line.
    const off = Math.abs((dx * toBasketY - dy * toBasketX) / length);
    const blocked = Math.max(0, 1 - off / 2.2) * Math.max(0, 1 - along / (length + 2));
    if (blocked > worst) worst = blocked;
  });

  return worst;
}

/**
 * Passing, from the player's thumb or the CPU's judgement.
 *
 * A pass and a shot are the same gesture from the sim's point of view — the ball leaves with a
 * velocity — but they fail differently, which is why they are separate modules and separate state.
 */
function drivePassing(
  state: BasketballState,
  world: World,
  inputs: ReadonlyMap<EntityId, InputFrame>,
  rng: Rng,
): SportEvent[] {
  const carrier = state.ballState.carrier;
  if (carrier === NO_ENTITY || state.rules.restart !== null) return [];
  if (state.rules.freeThrows !== null) return [];
  // A shot being charged owns the ball; you cannot pass out of the release.
  if (state.meter !== null) return [];

  const side = state.sides.get(carrier);
  if (side === undefined) return [];

  const input = inputs.get(carrier);

  if (input !== undefined) {
    if (!wasPressed(input, Button.B)) return [];
    const target = pickTarget(state, world, carrier, side, input.moveX, input.moveY);
    return makePass(state, world, carrier, side, target, 1, rng);
  }

  // You cannot catch and release in the same instant: a receiver has to square up first, and
  // without the delay the ball bounces straight back to where it came from.
  if (state.step - state.receivedAt < PASS_SETTLE_STEPS) return [];
  if (cpuDecision(state, world, carrier, side, rng) !== Decision.PASS) return [];
  // The decision says pass; the rate is how long it takes to see it, which is Phase 7's
  // reaction-latency dial (`06` §7) rather than a judgement — and, from T-3.6, how at home in
  // basketball this athlete is (`05` §3.3).
  if (!rng.bool(delayReaction(CPU_PASS_REACTION_PER_STEP, couplingOf(state, carrier)))) return [];

  const best = bestTeammateLook(state, world, carrier, side);
  if (best === null) return [];
  return makePass(state, world, carrier, side, best.athlete, 1, rng);
}

/** Pass assist: the teammate nearest the aim, or the nearest teammate if there is no aim. */
function pickTarget(
  state: BasketballState,
  world: World,
  passer: EntityId,
  side: CourtSide,
  aimX: number,
  aimY: number,
): EntityId {
  const mates: EntityId[] = [];
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (id !== passer && state.sides.get(id) === side) mates.push(id);
  });

  return selectPassTarget(
    world,
    { x: world.x[passer] as number, y: world.y[passer] as number },
    aimX,
    aimY,
    mates,
    PASS_ASSIST,
  );
}

/** Throws it, and says so. */
function makePass(
  state: BasketballState,
  world: World,
  passer: EntityId,
  side: CourtSide,
  target: EntityId,
  power: number,
  rng: Rng,
): SportEvent[] {
  const ratings = state.ratings.get(passer);
  if (ratings === undefined) return [];

  const from = { x: world.x[passer] as number, y: world.y[passer] as number };
  const lead =
    target === NO_ENTITY
      ? {
          x: from.x + Math.cos(world.facing[passer] as number) * 6,
          y: from.y + Math.sin(world.facing[passer] as number) * 6,
          flightTime: 0.5,
        }
      : leadTarget(world, from, target, power);

  const pressure = contestOn(state, world, passer, side);
  state.pass = throwPass(
    world,
    state.ballState,
    passer,
    side,
    target,
    lead.x,
    lead.y,
    lead.flightTime,
    ratings,
    pressure,
    state.step,
    rng,
  );
  registerTouch(state.rules, side);
  state.reboundLive = false;

  return [
    event(EventKind.PASS, state.step, side, {
      actor: passer,
      ...(target === NO_ENTITY ? {} : { target }),
      x: from.x,
      y: from.y,
      detail: { lead: round3(state.pass.leadDistance), pressure: round3(pressure) },
    }),
  ];
}

/**
 * Resolves a pass in the air: anyone who gets a hand to it may take it.
 *
 * Opponents are offered the ball first at equal reach, because a defender in the lane is *in front
 * of* the receiver — that is what jumping a passing lane means. Their control is deliberately lower
 * than a receiver's, so a covered lane mostly produces a deflection rather than a clean steal.
 */
function resolvePass(state: BasketballState, world: World, rng: Rng): SportEvent[] {
  const pass = state.pass;
  if (pass === null) return [];

  if (state.ballState.carrier !== NO_ENTITY || state.step > pass.expireStep) {
    state.pass = null;
    return [];
  }

  const speed = ballSpeed(world, state.ballState);
  const events: SportEvent[] = [];

  const flown = state.step - pass.releaseStep;
  const remaining = pass.expireStep - PASSING.graceSteps - state.step;
  const jumpable = flown >= PASSING.interceptDelaySteps && remaining >= PASSING.interceptTailSteps;

  for (const wantOpponent of [true, false]) {
    if (wantOpponent && !jumpable) continue;
    // Nearest to the ball, for the same reason the loose-ball pickup is: entity order is team
    // order, so "the first one who can reach it" quietly means "the home team".
    let taker = NO_ENTITY;
    let nearest = Infinity;
    const ballX = world.x[state.ballState.entity] as number;
    const ballY = world.y[state.ballState.entity] as number;
    world.forEach((id) => {
      if ((world.kind[id] as number) !== Kind.ATHLETE) return;
      const isOpponent = state.sides.get(id) !== pass.side;
      if (isOpponent !== wantOpponent) return;
      if (id === pass.passer || pass.contested.includes(id)) return;
      if (!canIntercept(world, state.ballState, id)) return;
      const d = Math.hypot((world.x[id] as number) - ballX, (world.y[id] as number) - ballY);
      if (d < nearest) {
        nearest = d;
        taker = id;
      }
    });
    if (taker === NO_ENTITY) continue;

    const ratings = state.ratings.get(taker);
    const side = state.sides.get(taker);
    if (ratings === undefined || side === undefined) continue;
    pass.contested.push(taker);

    // First touch is where an out-of-sport athlete looks worst (`05` §3.3).
    const control = degradeControl(
      wantOpponent ? interceptControl(ratings) : catchControl(ratings, speed),
      couplingOf(state, taker),
    );
    if (!contestCatch(world, state.ballState, taker, control, rng)) {
      // Deflected. The ball is loose and it is nobody's pass any more.
      state.pass = null;
      registerTouch(state.rules, side);
      return [
        event(EventKind.SPORT, state.step, side, {
          sportKind: BasketballEvent.PASS_DEFLECTED,
          actor: taker,
        }),
      ];
    }

    state.pass = null;
    if (wantOpponent) {
      events.push(
        event(EventKind.TURNOVER, state.step, pass.side, { detail: { reason: 'intercepted' } }),
      );
      events.push(
        event(EventKind.SPORT, state.step, side, {
          sportKind: BasketballEvent.INTERCEPTION,
          actor: taker,
        }),
      );
    }

    events.push(
      ...grantPossession(
        state.rules,
        side,
        state.step,
        wantOpponent ? ShotClockReset.FULL : ShotClockReset.KEEP,
        world.x[taker] as number,
        taker,
      ),
    );
    return events;
  }

  return events;
}

/**
 * Everything an athlete's basketball actions read.
 *
 * Structurally identical to `roster.ts`'s `BasketballRatings`, which is what a real athlete
 * produces; this alias stays because the models are typed against the intersection of what each
 * one needs, and narrowing them to one concrete interface would let a model start reading a field
 * it never declared.
 */
type AthleteRatings = ShooterRatings &
  PasserRatings &
  ReceiverRatings &
  InterceptorRatings &
  HandlerRatings &
  BodyRatings &
  RebounderRatings &
  DefenderRatings &
  AttackerRatings &
  FreeThrowRatings;

/**
 * Seeded ratings, biased by role — guards shoot and pass, bigs finish.
 *
 * No longer the main path: a match given a lineup uses real athletes (T-3.17). This is the
 * fallback for a match given none, which is every headless balance run, every determinism test,
 * and any rules test that should not have to build ten athletes to check the shot clock.
 */
function rollRatings(rng: Rng, roleIndex: number): AthleteRatings {
  const perimeter = roleIndex <= 1;
  const shot = rng.int(perimeter ? 55 : 35, perimeter ? 88 : 68);
  const inside = rng.int(perimeter ? 45 : 62, perimeter ? 75 : 92);
  return {
    finishing: inside,
    midRange: Math.round((shot + inside) / 2),
    threePoint: shot,
    freeThrow: rng.int(55, 90),
    composure: rng.int(40, 85),
    passing: rng.int(perimeter ? 55 : 40, perimeter ? 90 : 72),
    ballHandling: rng.int(perimeter ? 60 : 35, perimeter ? 92 : 68),
    perimeterD: rng.int(perimeter ? 50 : 35, perimeter ? 88 : 70),
    interiorD: rng.int(perimeter ? 35 : 58, perimeter ? 68 : 90),
    agility: rng.int(perimeter ? 60 : 35, perimeter ? 92 : 70),
    strength: rng.int(perimeter ? 35 : 60, perimeter ? 70 : 92),
    vertical: rng.int(perimeter ? 45 : 55, perimeter ? 88 : 92),
    rebounding: rng.int(perimeter ? 25 : 58, perimeter ? 60 : 92),
    discipline: rng.int(35, 90),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Which side, if any, plays a 2-3 zone this match. Roughly one match in three.
 *
 * `bool()`, not `int(0, 1)`. The engine's `int` range is half-open — `[min, max)` — so `int(0, 1)`
 * is the constant zero, not a coin flip. Used as one it gave the home side every zone in the
 * balance run, and the zone loses; the same mistake gave the home side every opening tip.
 */
function pickScheme(rng: Rng): 0 | 1 | -1 {
  if (!rng.bool(1 / 3)) return -1;
  return rng.bool() ? 1 : 0;
}

/** Absolute court position for a role fraction, measured from the end `side` defends. */
function roleSpot(fx: number, fy: number, side: CourtSide): { x: number; y: number } {
  const x = fx * COURT.length;
  return { x: side === 0 ? x : mirrorX(x), y: fy * COURT.width };
}

/**
 * Placeholder movement, replaced by T-2.5 and T-2.8.
 *
 * The one thing here that is not placeholder: the local player's input always wins over the
 * automatic behaviour, so control switching (T-2.9) has something real to switch between.
 */
function moveEveryone(
  state: BasketballState,
  world: World,
  inputs: ReadonlyMap<EntityId, InputFrame>,
  dt: number,
): void {
  const ball = state.ballState;
  const ballX = world.x[ball.entity] as number;
  const ballY = world.y[ball.entity] as number;
  const restart = state.rules.restart;
  const freeThrows = state.rules.freeThrows;
  refreshMarks(state, world);

  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    const profile = state.profiles.get(id);
    const side = state.sides.get(id);
    if (profile === undefined || side === undefined) return;

    const desired = { x: 0, y: 0 };
    const input = inputs.get(id);

    if (input !== undefined && (input.moveX !== 0 || input.moveY !== 0)) {
      const sprint = isHeld(input, Button.MODIFIER) ? 1 : 0.78;
      desired.x = input.moveX * profile.maxSpeed * sprint;
      desired.y = input.moveY * profile.maxSpeed * sprint;
    } else if (restart !== null && restart.side === side && id === state.inbounder) {
      arrive(
        world.x[id] as number,
        world.y[id] as number,
        restart.x,
        restart.y,
        profile.maxSpeed,
        0.5,
        desired,
      );
    } else if (freeThrows !== null) {
      const spot =
        id === freeThrows.shooter
          ? freeThrowSpot(freeThrows.side)
          : stationSpot(state, world, id, side);
      // A generous slowing radius, not a tight one: at full speed a tight radius cannot decelerate
      // in time and the athlete orbits the spot for ever, which is how the first free throw of the
      // first headless game never got taken.
      arrive(
        world.x[id] as number,
        world.y[id] as number,
        spot.x,
        spot.y,
        profile.maxSpeed,
        1.6,
        desired,
      );
    } else if (state.meter !== null && state.shooter === id) {
      // A shooter plants. Everything about the meter is about standing still and letting go.
    } else if (ball.carrier === id) {
      const target = carryTarget(state, world, id, side);
      arrive(
        world.x[id] as number,
        world.y[id] as number,
        target.x,
        target.y,
        profile.maxSpeed,
        1,
        desired,
      );
    } else if (ball.carrier === NO_ENTITY && restart === null) {
      arrive(
        world.x[id] as number,
        world.y[id] as number,
        ballX,
        ballY,
        profile.maxSpeed,
        1.5,
        desired,
      );
    } else {
      const spot = stationSpot(state, world, id, side);
      arrive(
        world.x[id] as number,
        world.y[id] as number,
        spot.x,
        spot.y,
        profile.maxSpeed,
        1.2,
        desired,
      );
    }

    const slowed = staggerFactor(state.stagger.get(id) ?? 0);
    desired.x *= slowed;
    desired.y *= slowed;

    integrate(world, id, profile, desired, dt);
    world.clampToBounds(id, world.radius[id] as number);
  });
}

/**
 * Where the ball-handler is heading. Bigs drive; perimeter roles pull up behind the arc.
 *
 * Placeholder, replaced by T-2.8 — but not an arbitrary one: without it every possession is a
 * drive to the rim and the three-point half of the shooting model never runs.
 */
function carryTarget(
  state: BasketballState,
  world: World,
  id: EntityId,
  side: CourtSide,
): { x: number; y: number } {
  const basket = attackedBasket(side);

  // Cross half-court first; nothing else is a decision until then.
  if (!state.rules.frontcourt) return { x: basket.x, y: basket.y };

  const decision = cpuDecision(state, world, id, side);
  if (decision === Decision.DRIVE) return { x: basket.x, y: basket.y };

  // Holding: stand on your spot and let the offence move around you.
  return offensiveSpot(state.roleIndex.get(id) ?? 0, side);
}

/** Guards and wings shoot from range; the forward and the centre work inside. */
function isPerimeterRole(state: BasketballState, id: EntityId): boolean {
  return (state.roleIndex.get(id) ?? 0) <= 2;
}

/**
 * Where an athlete stands when they are neither carrying nor chasing: their role spot, in the
 * attacking half if their team has the ball and the defending half if it does not.
 */
function stationSpot(
  state: BasketballState,
  world: World,
  id: EntityId,
  side: CourtSide,
): { x: number; y: number } {
  const index = state.roleIndex.get(id) ?? 0;
  const attacking = state.rules.possession === side;

  if (attacking) {
    const basket = attackedBasket(side);
    // A cut beats a spot: the whole point of one is to leave it.
    if ((state.cutting.get(id) ?? 0) > 0) return { x: basket.x, y: basket.y };
    if (id === state.screener && state.screenSteps > 0) {
      const screen = screenTarget(state, world, side);
      if (screen !== null) return screen;
    }
    return offensiveSpot(index, side);
  }

  const role = roles.roles[index] as (typeof roles.roles)[number];
  const base = roleSpot(role.x, role.y, side);
  // Nobody marks anybody at the line.
  if (state.rules.freeThrows !== null) return base;

  const ball = {
    x: world.x[state.ballState.entity] as number,
    y: world.y[state.ballState.entity] as number,
  };
  if (state.zoneSide === side) {
    // A zone still closes out. Whoever is nearest the ball leaves their area to meet it —
    // without that the offence simply shoots over a stationary shape.
    const carrier = state.ballState.carrier;
    if (
      carrier !== NO_ENTITY &&
      state.sides.get(carrier) !== side &&
      isNearestTo(state, world, id, side, carrier)
    ) {
      const ratings = state.ratings.get(id);
      const carrierSide = state.sides.get(carrier);
      if (ratings !== undefined && carrierSide !== undefined) {
        return markingSpot(
          { x: world.x[carrier] as number, y: world.y[carrier] as number },
          attackedBasket(carrierSide),
          ratings,
          false,
        );
      }
    }
    return zoneSpot(index, side, ball);
  }

  const mark = state.marks.get(id);
  const ratings = state.ratings.get(id);
  if (mark === undefined || ratings === undefined || !world.isAlive(mark)) return base;

  const markSide = state.sides.get(mark);
  if (markSide === undefined) return base;

  const basket = attackedBasket(markSide);
  const at = { x: world.x[mark] as number, y: world.y[mark] as number };

  if (state.shot !== null || state.reboundLive) return boxOutSpot(at, basket);

  // Help on a drive: leave your man to meet the ball at the rim, which is what a defence does.
  const carrier = state.ballState.carrier;
  if (carrier !== NO_ENTITY && state.sides.get(carrier) !== side) {
    const toBall = Math.hypot(
      (world.x[id] as number) - (world.x[carrier] as number),
      (world.y[id] as number) - (world.y[carrier] as number),
    );
    const ballToBasket = Math.hypot(
      (world.x[carrier] as number) - basket.x,
      (world.y[carrier] as number) - basket.y,
    );
    if (shouldHelp(toBall, ballToBasket, mark === carrier)) {
      return markingSpot(
        { x: world.x[carrier] as number, y: world.y[carrier] as number },
        basket,
        ratings,
        true,
      );
    }
  }

  const inPaint = Math.hypot(at.x - basket.x, at.y - basket.y) < 5;
  return markingSpot(at, basket, ratings, inPaint);
}

/** Whether `id` is the closest athlete on its side to `target`. Ties go to the lower entity id. */
function isNearestTo(
  state: BasketballState,
  world: World,
  id: EntityId,
  side: CourtSide,
  target: EntityId,
): boolean {
  const own = Math.hypot(
    (world.x[id] as number) - (world.x[target] as number),
    (world.y[id] as number) - (world.y[target] as number),
  );

  let nearest = true;
  world.forEach((other) => {
    if (!nearest || other === id) return;
    if ((world.kind[other] as number) !== Kind.ATHLETE) return;
    if (state.sides.get(other) !== side) return;
    const d = Math.hypot(
      (world.x[other] as number) - (world.x[target] as number),
      (world.y[other] as number) - (world.y[target] as number),
    );
    if (d < own || (d === own && other < id)) nearest = false;
  });
  return nearest;
}

/** Where the screener should stand: in front of the handler's nearest defender. */
function screenTarget(
  state: BasketballState,
  world: World,
  side: CourtSide,
): { x: number; y: number } | null {
  const handler = state.ballState.carrier;
  if (handler === NO_ENTITY || state.sides.get(handler) !== side) return null;

  let defender = NO_ENTITY;
  let nearest = Infinity;
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (state.sides.get(id) === side) return;
    const d = Math.hypot(
      (world.x[id] as number) - (world.x[handler] as number),
      (world.y[id] as number) - (world.y[handler] as number),
    );
    if (d < nearest) {
      nearest = d;
      defender = id;
    }
  });
  if (defender === NO_ENTITY) return null;

  return screenSpot(
    { x: world.x[handler] as number, y: world.y[handler] as number },
    { x: world.x[defender] as number, y: world.y[defender] as number },
  );
}

/**
 * Keeps the player attached to somebody worth being.
 *
 * The switch is published as an event rather than only written to state, because the HUD has to
 * flash the indicator on it (T-2.10) and the audio layer has to sting it (T-2.12) — and neither of
 * those can poll a field without guessing when it changed.
 */
function driveControl(
  state: BasketballState,
  world: World,
  inputs: ReadonlyMap<EntityId, InputFrame>,
): SportEvent[] {
  if (state.playerSide === -1) return [];

  const order: EntityId[] = [];
  const candidates: Candidate[] = [];
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (state.sides.get(id) !== state.playerSide) return;
    if (isFouledOut(state.rules, id)) return;
    order.push(id);

    const ball = state.ballState;
    candidates.push({
      athlete: id,
      toBall: Math.hypot(
        (world.x[id] as number) - (world.x[ball.entity] as number),
        (world.y[id] as number) - (world.y[ball.entity] as number),
      ),
      toOwnBasket: Math.hypot(
        (world.x[id] as number) - defendedBasket(state.playerSide as CourtSide).x,
        (world.y[id] as number) - defendedBasket(state.playerSide as CourtSide).y,
      ),
      carrier: ball.carrier === id,
    });
  });

  const previous = state.controlled;
  const frame = inputs.get(previous);

  if (frame !== undefined && wasPressed(frame, Button.SWITCH)) {
    state.controlled = cycleControlled(order, previous);
  } else {
    const changed = shouldAutoSwitch(
      state.previousPossession,
      state.rules.possession,
      state.autoSwitch,
    );
    state.controlled = pickControlled(candidates, changed ? NO_ENTITY : previous, state.autoSwitch);
  }

  state.previousPossession = state.rules.possession;
  if (state.controlled === previous) return [];

  return [
    event(EventKind.SPORT, state.step, state.playerSide, {
      sportKind: BasketballEvent.CONTROL_SWITCH,
      actor: state.controlled,
      ...(previous === NO_ENTITY ? {} : { target: previous }),
    }),
  ];
}

/**
 * Off-ball movement: cuts and screens.
 *
 * Both are timers rather than states, because both are *actions* — a cut that never ends is just a
 * different spot, and a screen that never ends is a second defender standing in your own lane.
 */
function driveOffBall(state: BasketballState, world: World, rng: Rng): void {
  for (const [id, steps] of state.cutting) {
    if (steps <= 1) state.cutting.delete(id);
    else state.cutting.set(id, steps - 1);
  }

  if (state.screenSteps > 0) state.screenSteps--;
  else state.screener = NO_ENTITY;

  const offence = state.rules.possession;
  const carrier = state.ballState.carrier;
  if (offence === -1 || carrier === NO_ENTITY || state.rules.restart !== null) return;
  if (state.rules.freeThrows !== null || !state.rules.frontcourt) return;

  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (id === carrier || state.sides.get(id) !== offence) return;
    if ((state.cutting.get(id) ?? 0) > 0) return;

    const basket = attackedBasket(offence);
    const away = Math.hypot((world.x[id] as number) - basket.x, (world.y[id] as number) - basket.y);
    if (shouldCut(away, true, rng)) state.cutting.set(id, CPU.cutSteps);
  });

  // One screener at a time, and only a big — a guard screening for a guard is a Phase 7 refinement.
  if (state.screener === NO_ENTITY && rng.bool(CPU.screenChance)) {
    world.forEach((id) => {
      if (state.screener !== NO_ENTITY) return;
      if ((world.kind[id] as number) !== Kind.ATHLETE) return;
      if (state.sides.get(id) !== offence || id === carrier) return;
      if (isPerimeterRole(state, id)) return;
      state.screener = id;
      state.screenSteps = CPU.screenSteps;
    });
  }
}

/** Redraws man assignments when the ball changes hands, and not on any other step. */
function refreshMarks(state: BasketballState, world: World): void {
  const offence = state.rules.possession;
  if (offence === -1 || state.marksFor === offence) return;
  state.marksFor = offence;

  const attackers: EntityId[] = [];
  const defenders: EntityId[] = [];
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    (state.sides.get(id) === offence ? attackers : defenders).push(id);
  });

  state.marks.clear();
  for (const [defender, attacker] of assignMarks(attackers, defenders)) {
    state.marks.set(defender, attacker);
  }
}

/**
 * Walks a pending restart forward: the inbounder collects the ball at the spot, and once they have
 * had a moment to set, the ball is put in play.
 *
 * A tip-off is different: nobody inbounds it, so it is awarded by a seeded draw and the arrow goes
 * to the side that lost it — which is the actual rule, not a shortcut.
 */
function advanceRestart(state: BasketballState, world: World, rng: Rng): SportEvent[] {
  const restart = state.rules.restart;
  if (restart === null) {
    state.restartSetup = 0;
    state.inbounder = NO_ENTITY;
    return [];
  }

  if (restart.kind === RestartKind.TIP_OFF) {
    state.restartSetup++;
    if (state.restartSetup < RESTART_SETUP_STEPS) return [];

    const winner: CourtSide = rng.bool() ? 1 : 0;
    state.rules.arrow = winner === 0 ? 1 : 0;
    state.restartSetup = 0;

    const events = [...completeRestart(state.rules, state.step, COURT.length / 2)];
    const taker = nearestAthleteOf(state, world, winner, COURT.length / 2, CENTRE_Y);
    if (taker !== NO_ENTITY) {
      attach(world, state.ballState, taker);
      events.push(
        ...grantPossession(
          state.rules,
          winner,
          state.step,
          ShotClockReset.FULL,
          world.x[taker] as number,
          taker,
        ),
      );
    }
    return events;
  }

  if (restart.side === -1) return [];
  if (state.inbounder === NO_ENTITY) {
    state.inbounder = nearestAthleteOf(state, world, restart.side, restart.x, restart.y);
    state.restartSetup = 0;
  }
  const inbounder = state.inbounder;
  if (inbounder === NO_ENTITY) return [];

  const atSpot =
    Math.hypot(
      (world.x[inbounder] as number) - restart.x,
      (world.y[inbounder] as number) - restart.y,
    ) < 1.5;
  if (!atSpot) {
    state.restartSetup = 0;
    return [];
  }

  // The inbounder has it: now the five-second count is legitimately running.
  attach(world, state.ballState, inbounder);
  const events = [...markRestartReady(state.rules, state.step)];

  state.restartSetup++;
  if (state.restartSetup < RESTART_SETUP_STEPS) return events;

  state.restartSetup = 0;
  state.inbounder = NO_ENTITY;
  const ballX = world.x[state.ballState.entity] as number;
  events.push(
    ...completeRestart(state.rules, state.step, ballX),
    ...grantPossession(
      state.rules,
      restart.side,
      state.step,
      ShotClockReset.KEEP,
      ballX,
      inbounder,
    ),
  );
  return events;
}

/** The athlete of a side closest to a point. Lowest id breaks a tie, so the choice is stable. */
function nearestAthleteOf(
  state: BasketballState,
  world: World,
  side: CourtSide,
  x: number,
  y: number,
): EntityId {
  let found = NO_ENTITY;
  let best = Infinity;
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (state.sides.get(id) !== side) return;
    const d = Math.hypot((world.x[id] as number) - x, (world.y[id] as number) - y);
    if (d < best) {
      best = d;
      found = id;
    }
  });
  return found;
}

/** A loose ball goes to the nearest athlete in reach. Lowest id wins a tie, so scrambles resolve. */
function collectLooseBall(state: BasketballState, world: World, rng: Rng): SportEvent[] {
  const ball = state.ballState;

  // A live rebound is a contest, not a race. Everyone with a claim gets weighed.
  if (state.reboundLive) {
    const contest = contestRebound(state, world, rng);
    if (contest !== null) return contest;
  }

  // Nearest, not first. Taking the first athlete in entity order looks like a harmless tie-break
  // until you notice entity order *is* team order: the home side spawns first, so it won every
  // simultaneous scramble in the match, and the balance run showed it as a 73% home win rate.
  let taker = NO_ENTITY;
  let nearest = Infinity;
  const ballX = world.x[ball.entity] as number;
  const ballY = world.y[ball.entity] as number;
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (!canCatch(world, ball, id, CATCH_REACH, 2.2)) return;
    const d = Math.hypot((world.x[id] as number) - ballX, (world.y[id] as number) - ballY);
    if (d < nearest) {
      nearest = d;
      taker = id;
    }
  });

  if (taker === NO_ENTITY) return [];
  const side = state.sides.get(taker);
  if (side === undefined) return [];

  return takeLooseBall(state, world, taker, side, false);
}

/**
 * The rebound. Everyone within reach of the ball is weighed on the five things `06` §3.1 names and
 * one of them comes down with it.
 *
 * Returns `null` when nobody is close enough yet, so the caller can fall through to an ordinary
 * loose-ball pickup once the rebound window has passed.
 */
function contestRebound(state: BasketballState, world: World, rng: Rng): SportEvent[] | null {
  const ball = state.ballState;
  if (ball.catchCooldown > 0) return null;
  if ((world.z[ball.entity] as number) > REBOUND_MAX_HEIGHT) return null;

  const ballX = world.x[ball.entity] as number;
  const ballY = world.y[ball.entity] as number;

  const nearby: { id: EntityId; side: CourtSide; ratings: AthleteRatings; distance: number }[] = [];
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    const side = state.sides.get(id);
    const ratings = state.ratings.get(id);
    if (side === undefined || ratings === undefined) return;

    const distance = Math.hypot((world.x[id] as number) - ballX, (world.y[id] as number) - ballY);
    if (distance <= REBOUNDING.reach) nearby.push({ id, side, ratings, distance });
  });

  if (nearby.length === 0) return null;
  // Nobody has a hand on it yet; wait rather than awarding it from across the paint.
  if (!nearby.some((c) => c.distance <= CATCH_REACH)) return null;

  const contenders: Contender[] = nearby.map((c) => {
    const self = { x: world.x[c.id] as number, y: world.y[c.id] as number };
    const basket = attackedBasket(c.side);
    const boxedOut = nearby.some(
      (other) =>
        other.side !== c.side &&
        isBoxedOut(
          self,
          { x: world.x[other.id] as number, y: world.y[other.id] as number },
          basket,
        ),
    );
    const timing = jumpTiming(c.ratings, rng);
    return {
      athlete: c.id,
      side: c.side,
      boxedOut,
      timing,
      weight: contenderWeight(c.ratings, c.distance, boxedOut, timing),
    };
  });

  const winner = pickRebounder(contenders, rng);
  if (winner === null) return null;

  return takeLooseBall(state, world, winner.athlete, winner.side, true, winner);
}

/** Hands a loose ball to somebody and says what kind of gain it was. */
function takeLooseBall(
  state: BasketballState,
  world: World,
  taker: EntityId,
  side: CourtSide,
  rebound: boolean,
  contender?: Contender,
): SportEvent[] {
  attach(world, state.ballState, taker);
  state.receivedAt = state.step;
  state.beaten.clear();
  state.contactWith = NO_ENTITY;

  const wasOffence = state.rules.possession === side;
  state.reboundLive = false;

  const events: SportEvent[] = [];
  if (rebound) {
    events.push(
      event(EventKind.REBOUND, state.step, side, {
        actor: taker,
        detail: {
          kind: wasOffence ? 'offensive' : 'defensive',
          ...(contender === undefined
            ? {}
            : { boxedOut: contender.boxedOut, timing: round3(contender.timing) }),
        },
      }),
    );
  }

  const reset = rebound
    ? wasOffence
      ? ShotClockReset.OFFENSIVE_REBOUND
      : ShotClockReset.FULL
    : wasOffence
      ? ShotClockReset.KEEP
      : ShotClockReset.FULL;

  events.push(
    ...grantPossession(state.rules, side, state.step, reset, world.x[taker] as number, taker),
  );
  return events;
}

/** Builds a match ready to step — used by the rules tests and, later, the balance harness. */
export function createBasketballMatch(
  world: World,
  seed: string,
  playerSide: 0 | 1 | -1 = -1,
  rosters?: readonly (readonly Athlete[])[],
): { state: BasketballState; rng: Rng } {
  const rng = createRng(seed);
  const state = basketball.createState(
    { seed, playerSide, ...(rosters === undefined ? {} : { rosters }) },
    world,
    rng,
  );
  return { state, rng: rng.fork('sim') };
}

export { BasketballEvent };
