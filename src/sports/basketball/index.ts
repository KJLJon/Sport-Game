/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.2 — Basketball rules: quarters, game clock, shot clock, possession, out-of-bounds, restarts
 * @story   US-3.1 — Play a 5v5 basketball match
 * @story   US-2.4 — See the state of the match at a glance
 * @design  06-game-design.md §3.1 (basketball), 04-architecture.md §5 (the sport module seam)
 * @invariant INV-2 (seeded PRNG only), INV-5 (no sport logic in the engine), INV-8 (determinism)
 *
 * Purpose: the basketball `SportModule` — the object the rest of the game plays basketball through.
 * It owns the world (ten athletes and a ball), drives the rule book in `rules.ts`, and turns both
 * into the one `SportEvent` stream everything downstream consumes.
 *
 * **What is deliberately crude here.** Movement is "carrier drives at the rim, everyone else goes
 * to their spot". That is placeholder behaviour, replaced task by task: shooting (T-2.3), passing
 * (T-2.4), driving (T-2.5), rebounding (T-2.6), defence (T-2.7), and the real CPU (T-2.8). What is
 * *not* placeholder is everything the clock and the rule book do — a possession really does end on
 * the shot clock, the ball really does go out of bounds against whoever touched it last, and play
 * really does restart from the right spot. That is what T-2.2 is for.
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
  contestLevel,
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
  mirrorX,
  shotDistance,
  shotZone,
  type Side as CourtSide,
} from './court.ts';
import { courtKey, drawCourt } from './court-render.ts';
import { BASKETBALL_WEIGHTS } from './weights.ts';
import {
  BASKETBALL_RULES,
  BasketballEvent,
  RestartKind,
  ShotClockReset,
  checkBackcourt,
  checkOutOfBounds,
  completeRestart,
  createRulesState,
  grantPossession,
  markRestartReady,
  onBasketMade,
  onPeriodStart,
  registerTouch,
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
  readonly playerSide: 0 | 1 | -1;
  controlled: EntityId;
  step: number;
  /** The rule book. */
  readonly rules: RulesState;
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
  // @spec-ref 06-game-design.md §2 — context-sensitive button labels
  buttonLabels: {
    onBall: ['Shoot', 'Pass'],
    offBall: ['Call', 'Screen'],
    defence: ['Steal', 'Block'],
  },
};

const render: SportRenderer = {
  fieldKey: courtKey,
  drawField(ctx, field) {
    drawCourt(ctx, field);
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
const SHOT_IDEAL_HOLD = 30;

/** Where a perimeter ball-handler stops rather than driving — comfortably behind the arc. */
const PULL_UP_DISTANCE = 7.9;

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
  roles,
  ai,
  render,
  hud,

  createState(setup: MatchSetup, world: World, rng: Rng): BasketballState {
    const squadSize = Math.min(setup.squadSize ?? this.meta.squadSize, roles.roles.length);
    const profiles = new Map<EntityId, MovementProfile>();
    const sides = new Map<EntityId, CourtSide>();
    const roleIndex = new Map<EntityId, number>();
    const ratings = new Map<EntityId, AthleteRatings>();

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

        // Real athletes arrive in T-3.17; until then, a seeded spread so play is not uniform.
        const rating = rosterRng.int(45, 85);
        profiles.set(id, movementProfile({ speed: rating, acceleration: rating, agility: rating }));
        sides.set(id, side);
        roleIndex.set(id, index);
        ratings.set(id, rollRatings(rosterRng, index));
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
      meter: null,
      shooter: NO_ENTITY,
      cpuRelease: 0,
      shot: null,
      pass: null,
      reboundLive: false,
      stagger: new Map(),
      beaten: new Set(),
      contactWith: NO_ENTITY,
      playerSide: setup.playerSide,
      controlled,
      step: 0,
      rules: createRulesState(rng.fork('tip').int(0, 1) === 0 ? 0 : 1),
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

    const ball = state.ballState;

    moveEveryone(state, world, inputs, dt);

    world.reindex();
    resolveCollisions(world, state.scratch);
    world.reindex();

    events.push(...advanceRestart(state, world, rng));
    events.push(...driveDribbling(state, world, inputs, rng));
    events.push(...driveShooting(state, world, inputs, rng));
    events.push(...drivePassing(state, world, inputs, rng));
    events.push(...resolveFlight(state, world, rng));
    events.push(...resolvePass(state, world, rng));

    // A ball in flight is nobody's to catch — that is what makes a shot a shot.
    if (ball.carrier === NO_ENTITY && state.shot === null && state.pass === null) {
      events.push(...collectLooseBall(state, world));
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
};

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
  if (carrier === NO_ENTITY || state.rules.restart !== null) {
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
    state.cpuRelease = Math.round(SHOT_IDEAL_HOLD + rng.float(-1, 1) * state.meter.window * 0.8);
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

/** How smothered the carrier is, from the nearest opponent. */
function contestOn(state: BasketballState, world: World, actor: EntityId, side: CourtSide): number {
  let nearest = Infinity;
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (state.sides.get(id) === side) return;
    const d = Math.hypot(
      (world.x[id] as number) - (world.x[actor] as number),
      (world.y[id] as number) - (world.y[actor] as number),
    );
    if (d < nearest) nearest = d;
  });
  return nearest === Infinity ? 0 : contestLevel(nearest);
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

  const x = world.x[actor] as number;
  const y = world.y[actor] as number;
  const distance = shotDistance(x, y, side);
  const contest = contestOn(state, world, actor, side);
  const seconds = shotClockSeconds(state.rules);

  if (seconds < 3) return true;
  if (distance < 3.5 && contest < 0.6) return rng.bool(0.25);
  if (!isPerimeterRole(state, actor)) return false;
  // Behind the arc: take the open one, and never let the clock die holding it.
  if (distance > 6.9 && distance < 9.2)
    return rng.bool(contest < 0.5 ? 0.12 : seconds < 8 ? 0.2 : 0);
  return false;
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

  // Placeholder judgement, replaced by T-2.8: move the ball when the pressure says to.
  if (contestOn(state, world, carrier, side) < 0.5) return [];
  if (!rng.bool(0.06)) return [];

  const target = mostOpenTeammate(state, world, carrier, side);
  if (target === NO_ENTITY) return [];
  return makePass(state, world, carrier, side, target, 1, rng);
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

/** The teammate with the most space, at a distance worth passing. Placeholder for T-2.8. */
function mostOpenTeammate(
  state: BasketballState,
  world: World,
  passer: EntityId,
  side: CourtSide,
): EntityId {
  let best = NO_ENTITY;
  let bestSpace = 1.5;

  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (id === passer || state.sides.get(id) !== side) return;

    const away = Math.hypot(
      (world.x[id] as number) - (world.x[passer] as number),
      (world.y[id] as number) - (world.y[passer] as number),
    );
    if (away < 3 || away > 16) return;

    const space = nearestOpponentDistance(state, world, id, side);
    if (space > bestSpace) {
      bestSpace = space;
      best = id;
    }
  });

  return best;
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

  const jumpable = state.step - pass.releaseStep >= PASSING.interceptDelaySteps;

  for (const wantOpponent of [true, false]) {
    if (wantOpponent && !jumpable) continue;
    let taker = NO_ENTITY;
    world.forEach((id) => {
      if (taker !== NO_ENTITY) return;
      if ((world.kind[id] as number) !== Kind.ATHLETE) return;
      const isOpponent = state.sides.get(id) !== pass.side;
      if (isOpponent !== wantOpponent) return;
      if (id === pass.passer || pass.contested.includes(id)) return;
      if (canIntercept(world, state.ballState, id)) taker = id;
    });
    if (taker === NO_ENTITY) continue;

    const ratings = state.ratings.get(taker);
    const side = state.sides.get(taker);
    if (ratings === undefined || side === undefined) continue;
    pass.contested.push(taker);

    const control = wantOpponent ? interceptControl(ratings) : catchControl(ratings, speed);
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

/** Distance from an athlete to the nearest opponent. */
function nearestOpponentDistance(
  state: BasketballState,
  world: World,
  actor: EntityId,
  side: CourtSide,
): number {
  let nearest = Infinity;
  world.forEach((id) => {
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (state.sides.get(id) === side) return;
    const d = Math.hypot(
      (world.x[id] as number) - (world.x[actor] as number),
      (world.y[id] as number) - (world.y[actor] as number),
    );
    if (d < nearest) nearest = d;
  });
  return nearest;
}

/** Everything an athlete's basketball actions read. Real athletes replace this at T-3.17. */
type AthleteRatings = ShooterRatings &
  PasserRatings &
  ReceiverRatings &
  InterceptorRatings &
  HandlerRatings &
  BodyRatings;

/** Seeded ratings, biased by role — guards shoot and pass, bigs finish. Replaced at T-3.17. */
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
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
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
      const spot = stationSpot(state, id, side);
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
  // Bigs always drive; so does anyone whose look has not come by the time the clock gets short.
  if (!isPerimeterRole(state, id) || shotClockSeconds(state.rules) < LATE_CLOCK_SECONDS * 2) {
    return { x: basket.x, y: basket.y };
  }

  const x = world.x[id] as number;
  const y = world.y[id] as number;
  const away = Math.hypot(x - basket.x, y - basket.y);
  if (away <= PULL_UP_DISTANCE) return { x, y };

  const scale = PULL_UP_DISTANCE / away;
  return { x: basket.x + (x - basket.x) * scale, y: basket.y + (y - basket.y) * scale };
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
  id: EntityId,
  side: CourtSide,
): { x: number; y: number } {
  const index = state.roleIndex.get(id) ?? 0;
  const role = roles.roles[index] as (typeof roles.roles)[number];
  const attacking = state.rules.possession === side;
  const base = roleSpot(role.x, role.y, side);
  return attacking ? { x: mirrorX(base.x), y: base.y } : base;
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

    const winner: CourtSide = rng.int(0, 1) === 0 ? 0 : 1;
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
function collectLooseBall(state: BasketballState, world: World): SportEvent[] {
  const ball = state.ballState;
  let taker = NO_ENTITY;

  world.forEach((id) => {
    if (taker !== NO_ENTITY) return;
    if ((world.kind[id] as number) !== Kind.ATHLETE) return;
    if (canCatch(world, ball, id, CATCH_REACH, 2.2)) taker = id;
  });

  if (taker === NO_ENTITY) return [];

  const side = state.sides.get(taker);
  if (side === undefined) return [];

  attach(world, ball, taker);
  state.beaten.clear();
  const wasOffence = state.rules.possession === side;
  const rebound = state.reboundLive;
  state.reboundLive = false;

  const events: SportEvent[] = [];
  if (rebound) {
    // The contest itself is T-2.6; the event is already true and downstream stats want it.
    events.push(event(EventKind.REBOUND, state.step, side, { actor: taker }));
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
): { state: BasketballState; rng: Rng } {
  const rng = createRng(seed);
  const state = basketball.createState({ seed, playerSide }, world, rng);
  return { state, rng: rng.fork('sim') };
}

export { BasketballEvent };
