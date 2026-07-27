/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.11 — `SportModule` interface + a trivial test sport proving the seam
 * @story   US-14.4 — Add a sport without touching the engine
 * @design  04-architecture.md §5, 03-phases-and-tasks.md Gate 1
 * @invariant INV-2 (seeded only), INV-5 (no sport logic in the engine), INV-8 (determinism)
 *
 * Purpose: the smallest thing that is genuinely a sport, and Gate 1's subject. Two teams chase one
 * ball on an open field and try to carry it into the opponent's goal. There is no dribbling, no
 * fouls, and no skill expression — that is the point. If the engine can run *this* through the
 * whole seam, then basketball in Phase 2 is content rather than plumbing.
 *
 * It is also the determinism fixture: T-1.12's golden-seed tests run this sport, because a bug in
 * a simple sport is a bug in the engine, whereas a bug in basketball might be basketball's.
 */
import { createRng, type Rng } from '../../engine/rng.ts';
import type { InputFrame } from '../../engine/input/types.ts';
import { Button, isHeld } from '../../engine/input/types.ts';
import { EventKind, event, type SportEvent } from '../../engine/match/events.ts';
import type { MatchRules } from '../../engine/match/state-machine.ts';
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
  FieldGeometry,
  MatchSetup,
  RatingWeightTable,
  RoleTable,
  SportAiAdapter,
  SportHudSpec,
  SportModule,
  SportRenderer,
  SportState,
} from '../types.ts';

const FIELD: FieldGeometry = {
  width: 40,
  height: 24,
  goals: [
    { side: 0, x: 0.5, y: 12, radius: 2 },
    { side: 1, x: 39.5, y: 12, radius: 2 },
  ],
};

/** Entity kinds. The engine treats these as opaque integers; only this file assigns meaning. */
const Kind = { ATHLETE: 0, BALL: 1 } as const;

export interface TestSportState extends SportState {
  readonly ball: EntityId;
  readonly ballState: BallState;
  /** Per-entity movement profiles, indexed by entity id. */
  readonly profiles: Map<EntityId, MovementProfile>;
  /** Which side each athlete plays for. */
  readonly sides: Map<EntityId, 0 | 1>;
  readonly playerSide: 0 | 1 | -1;
  /** The athlete the local player controls. */
  controlled: EntityId;
  step: number;
  /** Scratch buffer for neighbour queries — allocated once, never per step. */
  readonly scratch: Int32Array;
}

const rules: MatchRules = { periods: 2, periodSteps: 60 * 60, overtimeSteps: 0 };

/** Even weights: this sport has no opinion about what makes an athlete good at it. */
const ratingWeights: RatingWeightTable = {
  general: {
    speed: 0.25,
    acceleration: 0.25,
    agility: 0.25,
    coordination: 0.25,
  },
};

const roles: RoleTable = {
  roles: [
    { id: 'chaser', name: 'Chaser', x: 0.35, y: 0.5 },
    { id: 'support', name: 'Support', x: 0.2, y: 0.3 },
    { id: 'back', name: 'Back', x: 0.1, y: 0.7 },
  ],
};

const ai: SportAiAdapter = {
  options(state, _world, actor, out) {
    const s = state as TestSportState;
    out.push({ kind: 'chase' });
    if (s.ballState.carrier === actor) out.push({ kind: 'carry' });
  },
  score(_state, _world, _actor, option) {
    // Carrying the ball beats chasing it, which is the entire strategy of this sport.
    return option.kind === 'carry' ? 1 : 0.5;
  },
};

const render: SportRenderer = {
  fieldKey: (field, view) =>
    `testsport:${field.width}x${field.height}:${view.width}x${view.height}`,
  drawField(ctx, field) {
    ctx.fillStyle = '#1c3d1c';
    ctx.fillRect(0, 0, field.width, field.height);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.1;
    ctx.strokeRect(0, 0, field.width, field.height);
  },
  drawOverlay(ctx, state, world) {
    const s = state as TestSportState;
    if (s.ballState.carrier === NO_ENTITY) return;
    ctx.beginPath();
    ctx.arc(
      world.x[s.ballState.carrier] as number,
      world.y[s.ballState.carrier] as number,
      0.8,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  },
};

const hud: SportHudSpec = {
  showShotClock: false,
  showPossession: true,
  buttonLabels: { default: ['Pass', 'Sprint'] },
};

/** Reach within which an athlete may pick the ball up, in metres. */
const CATCH_REACH = 1.1;

export const testSport: SportModule<TestSportState> = {
  id: 'testsport',
  meta: { displayName: 'Test Sport', squadSize: 3, periodName: 'Half' },
  rules,
  field: FIELD,
  ratingWeights,
  roles,
  ai,
  render,
  hud,

  createState(setup: MatchSetup, world: World, rng: Rng): TestSportState {
    const squadSize = setup.squadSize ?? this.meta.squadSize;
    const profiles = new Map<EntityId, MovementProfile>();
    const sides = new Map<EntityId, 0 | 1>();

    // Rosters are drawn from a fork, so adding a draw elsewhere cannot shift who is fast.
    const rosterRng = rng.fork('roster');

    for (const side of [0, 1] as const) {
      for (let index = 0; index < squadSize; index++) {
        const role = roles.roles[index % roles.roles.length] as (typeof roles.roles)[number];
        const fromLeft = side === 0;
        const x = fromLeft ? FIELD.width * role.x : FIELD.width * (1 - role.x);
        const y = FIELD.height * role.y;

        const id = world.spawn({
          x,
          y,
          facing: fromLeft ? 0 : Math.PI,
          radius: 0.45,
          mass: 80,
          team: side,
          kind: Kind.ATHLETE,
          tag: index,
        });

        const rating = rosterRng.int(35, 85);
        profiles.set(id, movementProfile({ speed: rating, acceleration: rating, agility: rating }));
        sides.set(id, side);
      }
    }

    const ballState = createBall(
      world,
      FIELD.width / 2,
      FIELD.height / 2,
      DEFAULT_BALL_PHYSICS,
      Kind.BALL,
    );

    const controlled =
      setup.playerSide === -1
        ? NO_ENTITY
        : ([...sides.entries()].find(([, side]) => side === setup.playerSide)?.[0] ?? NO_ENTITY);

    world.reindex();

    return {
      sport: 'testsport',
      ball: ballState.entity,
      ballState,
      profiles,
      sides,
      playerSide: setup.playerSide,
      controlled,
      step: 0,
      scratch: new Int32Array(64),
    };
  },

  step(
    state: TestSportState,
    world: World,
    inputs: ReadonlyMap<EntityId, InputFrame>,
    dt: number,
    rng: Rng,
  ): readonly SportEvent[] {
    const events: SportEvent[] = [];
    state.step++;

    const ball = state.ballState;
    const ballX = world.x[ball.entity] as number;
    const ballY = world.y[ball.entity] as number;

    // Movement. Entity order is ascending id, so the sweep is deterministic (INV-8).
    world.forEach((id) => {
      if ((world.kind[id] as number) !== Kind.ATHLETE) return;
      const profile = state.profiles.get(id);
      if (profile === undefined) return;

      const input = inputs.get(id);
      const desired = { x: 0, y: 0 };

      if (input !== undefined && (input.moveX !== 0 || input.moveY !== 0)) {
        const sprint = isHeld(input, Button.MODIFIER) ? 1 : 0.75;
        desired.x = input.moveX * profile.maxSpeed * sprint;
        desired.y = input.moveY * profile.maxSpeed * sprint;
      } else if (ball.carrier === id) {
        // Carrying: run at the opponent's goal.
        const goal = FIELD.goals[
          (state.sides.get(id) ?? 0) === 0 ? 1 : 0
        ] as (typeof FIELD.goals)[number];
        seek(
          world.x[id] as number,
          world.y[id] as number,
          goal.x,
          goal.y,
          profile.maxSpeed,
          desired,
        );
      } else {
        // Everyone else converges on the ball. Crude, and exactly enough to prove the seam.
        arrive(
          world.x[id] as number,
          world.y[id] as number,
          ballX,
          ballY,
          profile.maxSpeed,
          2,
          desired,
        );
      }

      integrate(world, id, profile, desired, dt);
      world.clampToBounds(id, 0.45);
    });

    world.reindex();
    resolveCollisions(world, state.scratch);
    world.reindex();

    // Possession. Lowest id wins a tie, which keeps a scramble deterministic.
    if (ball.carrier === NO_ENTITY) {
      let taker = NO_ENTITY;
      world.forEach((id) => {
        if (taker !== NO_ENTITY) return;
        if ((world.kind[id] as number) !== Kind.ATHLETE) return;
        if (canCatch(world, ball, id, CATCH_REACH, 2)) taker = id;
      });

      if (taker !== NO_ENTITY) {
        attach(world, ball, taker);
        events.push(
          event(EventKind.POSSESSION, state.step, state.sides.get(taker) ?? -1, { actor: taker }),
        );
      }
    }

    stepBall(world, ball, dt, DEFAULT_BALL_PHYSICS);

    // Scoring: carry the ball into the opponent's goal.
    if (ball.carrier !== NO_ENTITY) {
      const side = state.sides.get(ball.carrier) ?? 0;
      const target = FIELD.goals[side === 0 ? 1 : 0] as (typeof FIELD.goals)[number];
      const dx = (world.x[ball.carrier] as number) - target.x;
      const dy = (world.y[ball.carrier] as number) - target.y;

      if (Math.hypot(dx, dy) <= target.radius) {
        events.push(
          event(EventKind.SCORE, state.step, side, {
            value: 1,
            actor: ball.carrier,
            x: target.x,
            y: target.y,
          }),
        );
        resetToCentre(world, state, rng);
      }
    }

    return events;
  },

  resolveAction(
    state: TestSportState,
    world: World,
    actor: EntityId,
    action: ActionIntent,
    rng: Rng,
  ): readonly SportEvent[] {
    if (action.kind !== 'pass' || state.ballState.carrier !== actor) return [];

    const power = action.power ?? 8;
    const facing = world.facing[actor] as number;
    // A pass wobbles a little, seeded — the only randomness this sport has.
    const spread = rng.float(-0.08, 0.08);
    release(
      world,
      state.ballState,
      Math.cos(facing + spread) * power,
      Math.sin(facing + spread) * power,
      2,
    );

    return [event(EventKind.PASS, state.step, state.sides.get(actor) ?? -1, { actor })];
  },

  isFinished(): boolean {
    // The clock decides; this sport has no early finish.
    return false;
  },
};

/** After a score, put the ball back in the middle and let go of it. */
function resetToCentre(world: World, state: TestSportState, rng: Rng): void {
  const ball = state.ballState;
  ball.carrier = NO_ENTITY;
  ball.catchCooldown = 30;
  ball.spin = 0;

  world.x[ball.entity] = FIELD.width / 2;
  world.y[ball.entity] = FIELD.height / 2;
  world.z[ball.entity] = DEFAULT_BALL_PHYSICS.radius;
  world.vx[ball.entity] = rng.float(-1, 1);
  world.vy[ball.entity] = rng.float(-1, 1);
  world.vz[ball.entity] = 0;
  world.invalidateIndex();
}

/** Builds a match ready to step — used by the determinism tests and the perf harness. */
export function createTestMatch(world: World, seed: string, playerSide: 0 | 1 | -1 = -1) {
  const rng = createRng(seed);
  const state = testSport.createState({ seed, playerSide }, world, rng);
  return { state, rng: rng.fork('sim') };
}
