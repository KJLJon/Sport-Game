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
import { Button, isHeld } from '../../engine/input/types.ts';
import { EventKind, event, type SportEvent } from '../../engine/match/events.ts';
import { NO_ENTITY, type EntityId, type World } from '../../engine/world.ts';
import {
  DEFAULT_BALL_PHYSICS,
  attach,
  canCatch,
  createBall,
  release,
  stepBall,
  type BallState,
} from '../../engine/physics/ball.ts';
import { integrate, movementProfile, type MovementProfile } from '../../engine/physics/movement.ts';
import { resolveCollisions } from '../../engine/physics/collision.ts';
import { arrive, seek } from '../../engine/physics/steering.ts';
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
  onPeriodStart,
  registerTouch,
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

    if (ball.carrier === NO_ENTITY) {
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
    if (state.ballState.carrier !== actor) return [];
    if (action.kind !== 'pass') return [];

    // Shooting is T-2.3 and real passing is T-2.4; this is enough to move the ball and to make
    // the rule book's turnover paths reachable from a test.
    const facing = world.facing[actor] as number;
    const spread = rng.float(-0.05, 0.05);
    const power = action.power ?? 11;
    release(
      world,
      state.ballState,
      Math.cos(facing + spread) * power,
      Math.sin(facing + spread) * power,
      1.4,
    );

    const side = state.sides.get(actor);
    if (side !== undefined) registerTouch(state.rules, side);
    return [event(EventKind.PASS, state.step, side ?? -1, { actor })];
  },

  isFinished(): boolean {
    // The match clock decides; basketball has no early finish.
    return false;
  },
};

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
    } else if (ball.carrier === id) {
      const basket = attackedBasket(side);
      seek(
        world.x[id] as number,
        world.y[id] as number,
        basket.x,
        basket.y,
        profile.maxSpeed,
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

    integrate(world, id, profile, desired, dt);
    world.clampToBounds(id, world.radius[id] as number);
  });
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
  const wasOffence = state.rules.possession === side;
  return grantPossession(
    state.rules,
    side,
    state.step,
    wasOffence ? ShotClockReset.KEEP : ShotClockReset.FULL,
    world.x[taker] as number,
    taker,
  );
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
