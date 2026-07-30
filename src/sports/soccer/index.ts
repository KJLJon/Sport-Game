/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.10 — Formations 4-4-2 / 4-3-3 / 3-5-2, data-driven roles, shape by phase
 * @task    T-6.11 — 22-entity performance work: zero-allocation hot path
 * @task    T-6.13 — Soccer derivation weights, sub-skills, familiarity tuning
 * @story   US-4.1 — Play an 11v11 soccer match
 * @story   US-14.4 — Add a sport without touching the engine
 * @design  04-architecture.md §5 (the sport module seam), 06-game-design.md §3.2
 * @invariant INV-2 (seeded PRNG only), INV-5 (no sport logic in the engine), INV-8 (determinism),
 *            INV-9 (one event stream)
 *
 * Purpose: the soccer `SportModule` — the one object that makes the other ten files a playable
 * sport, and the file that answers Gate 6's question.
 *
 * **Why this is folded into T-6.10.** Phase 6's eighteen rows have no assembly task: they cover
 * geometry, rules, five skill models, formations, performance, camera, weights, Playbook, arcade,
 * art, refactor, and balance, and none of them says "register the sport". T-6.11's 22-entity
 * performance work needs 22 entities actually moving, so the assembly has to exist by then. It went
 * here because T-6.10 already owns `RoleTable` and where everybody stands. Recorded in
 * `PROGRESS.md` and raised with the user rather than done silently.
 *
 * **The seam held.** Everything below is `SportModule`'s own members, filled in. One engine change
 * in the whole phase (`MatchStateMachine.extendPeriod`, T-6.2), and nothing in `engine/` knows this
 * file exists.
 *
 * **What `step()` is and is not.** It is a real simulation: athletes hold a formation that shifts
 * with the phase, chase and contest the ball, carry it, pass, shoot, tackle, and a keeper saves —
 * with every outcome coming from the T-6.1…T-6.9 models and a seeded RNG. It is *not* the finished
 * CPU: shape is positional rather than tactical, and there is no off-ball intelligence beyond
 * holding a role and pressing the ball. That is Phase 7's whole job (T-7.x), and T-6.18's balance
 * pass will move the numbers once there is a real opponent to balance against.
 */
import { EventKind, event, type SportEvent } from '../../engine/match/events.ts';
import type { InputFrame } from '../../engine/input/types.ts';
import {
  attach,
  canCatch,
  createBall,
  isAtRest,
  release,
  stepBall,
  type BallState,
} from '../../engine/physics/ball.ts';
import { integrateAll, type MovementProfile, type Vec2 } from '../../engine/physics/movement.ts';
import { arrive, seek } from '../../engine/physics/steering.ts';
import type { Rng } from '../../engine/rng.ts';
import { NO_ENTITY, type EntityId, type World } from '../../engine/world.ts';
import type {
  ActionIntent,
  MatchSetup,
  SportAiAdapter,
  SportHudSpec,
  SportModule,
  SportRenderer,
  SportState,
  SportStatus,
} from '../types.ts';
import { SOCCER_BALL_PHYSICS } from './ball.ts';
import { pressureOn, resolveTackle, tackleReach, tackleTiming } from './defending.ts';
import { commitFoul, isPlayingAdvantage, tickAdvantage } from './fouls.ts';
import {
  DEFAULT_FORMATION,
  cachedShape,
  formation,
  phaseFor,
  soccerRoles,
  type PlayPhase,
} from './formations.ts';
import { KEEPER, distributionChoice, keeperSpot, saveOutcome } from './keeper.ts';
import { judgeOffside, offsideOffence, type PlayerPosition } from './offside.ts';
import {
  leadTarget,
  selectPassTarget,
  throwPass,
  type PassInFlight,
  type PassKind,
} from './passing.ts';
import {
  CENTRE_Y,
  PITCH,
  attackedGoal,
  crossedBoundary,
  isGoal,
  isInAttackingPenaltyArea,
  soccerPitch,
  shotDistance,
  type Side as PitchSide,
} from './pitch.ts';
import { drawPitch, pitchKey } from './pitch-render.ts';
import {
  RestartKind,
  SOCCER_RULES,
  SoccerEvent,
  awardRestart,
  completeRestart,
  createRulesState,
  grantPossession,
  isBallDead,
  isSentOff,
  onGoalScored,
  opponent,
  readyRestart,
  registerTouch,
  remainingGameSeconds,
  restartFor,
  startHalf,
  tickRestart,
  type RulesState,
} from './rules.ts';
import { rollRatings, rosterEntry, type SoccerRatings } from './roster.ts';
import { SOCCER_PHYSICAL, SOCCER_POSITION_WEIGHTS, SOCCER_WEIGHTS } from './weights.ts';
import { SOCCER_XP_AWARDS } from './xp.ts';
import { SHOOTING, takeShot, type ShotInFlight } from './shooting.ts';
import {
  createStamina,
  dribbleProfile,
  tickStamina,
  touchDistance,
  type StaminaState,
} from './dribbling.ts';

const Kind = { ATHLETE: 0, BALL: 1 } as const;
const SQUAD = 11;

/** How close a taker must be to a restart spot before it counts as ready. */
const RESTART_READY_RANGE = 1.2;
/** Distance from goal inside which the CPU will have a go. */
const SHOOTING_RANGE = 30;

export interface SoccerState extends SportState {
  readonly sport: 'soccer';
  readonly ballState: BallState;
  readonly rules: RulesState;
  readonly stamina: StaminaState;
  readonly sides: Map<EntityId, PitchSide>;
  readonly roleIndex: Map<EntityId, number>;
  readonly ratings: Map<EntityId, SoccerRatings>;
  readonly athleteIds: Map<EntityId, string>;
  readonly keepers: [EntityId, EntityId];
  readonly formations: [string, string];
  readonly squads: [EntityId[], EntityId[]];
  controlled: EntityId;
  pass: PassInFlight | null;
  shot: ShotInFlight | null;
  /** Steps since kick-off. The module's own clock, for event stamping. */
  elapsed: number;
  finished: boolean;
}

const roles = soccerRoles();

const render: SportRenderer = {
  fieldKey: pitchKey,
  drawField(ctx, field) {
    drawPitch(ctx, field);
  },
  drawOverlay() {
    // Possession arrows, offside line, and zone highlights land with the art pass (T-6.16).
  },
};

const hud: SportHudSpec = {
  // Soccer has no action clock, and `SportStatus.actionClock` returning null is how the HUD learns
  // that. The first sport to prove that member is genuinely optional.
  showShotClock: false,
  showPossession: true,
  // @spec-ref 06-game-design.md §2 — context-sensitive button labels
  buttonLabels: {
    onBall: ['Shoot', 'Pass'],
    offBall: ['Call', 'Run'],
    defence: ['Tackle', 'Slide'],
  },
};

/**
 * Candidate actions and their scores. Enough for the framework to pick sensibly; the real thing is
 * Phase 7 (T-7.x), which is why the scores here are geometric rather than tactical.
 */
const ai: SportAiAdapter = {
  options(state, world, actor, out) {
    const s = state as SoccerState;
    if (s.ballState.carrier === actor) {
      out.push({ kind: 'shoot' });
      out.push({ kind: 'pass' });
      out.push({ kind: 'dribble' });
      return;
    }
    if (
      s.ballState.carrier !== NO_ENTITY &&
      s.sides.get(s.ballState.carrier) !== s.sides.get(actor)
    ) {
      out.push({ kind: 'tackle' });
    }
    out.push({ kind: 'position' });
    void world;
  },

  score(state, world, actor, option) {
    const s = state as SoccerState;
    const side = s.sides.get(actor);
    if (side === undefined) return 0;

    switch (option.kind) {
      case 'shoot': {
        const distance = shotDistance(world.x[actor] as number, world.y[actor] as number, side);
        return distance > SHOOTING_RANGE ? 0.05 : 1 - distance / SHOOTING_RANGE;
      }
      case 'pass':
        return 0.5;
      case 'dribble':
        return 0.45;
      case 'tackle':
        return 0.7;
      default:
        return 0.2;
    }
  },
};

/**
 * `stepRestart` is an extra member, not part of `SportModule`. The seam ignores what it does not
 * know about, and keeping it on the module lets `step()` read as a sequence rather than a wall.
 */
interface SoccerModule extends SportModule<SoccerState> {
  stepRestart(
    state: SoccerState,
    world: World,
    step: number,
    dt: number,
    rng: Rng,
  ): readonly SportEvent[];
}

export const soccer: SoccerModule = {
  id: 'soccer',
  meta: { displayName: 'Soccer', squadSize: SQUAD, periodName: 'Half' },
  rules: SOCCER_RULES,
  field: soccerPitch,
  ratingWeights: SOCCER_WEIGHTS,
  physicalModifiers: SOCCER_PHYSICAL,
  positionWeights: SOCCER_POSITION_WEIGHTS,
  xpAwards: SOCCER_XP_AWARDS,
  roles,
  ai,
  render,
  hud,

  createState(setup: MatchSetup, world: World, rng: Rng): SoccerState {
    const squadSize = Math.min(setup.squadSize ?? SQUAD, roles.roles.length);
    const sides = new Map<EntityId, PitchSide>();
    const roleIndex = new Map<EntityId, number>();
    const ratings = new Map<EntityId, SoccerRatings>();
    const athleteIds = new Map<EntityId, string>();
    const squads: [EntityId[], EntityId[]] = [[], []];
    const keepers: [EntityId, EntityId] = [NO_ENTITY, NO_ENTITY];

    const rosterRng = rng.fork('roster');
    const shapes: [string, string] = [DEFAULT_FORMATION, DEFAULT_FORMATION];

    for (const side of [0, 1] as const) {
      const shape = cachedShape(shapes[side], 'building', side);
      for (let index = 0; index < squadSize; index++) {
        const spot = shape[index] as { x: number; y: number };
        const id = world.spawn({
          x: spot.x,
          y: spot.y,
          facing: side === 0 ? 0 : Math.PI,
          radius: 0.4,
          mass: 78,
          team: side,
          kind: Kind.ATHLETE,
          tag: index,
        });

        sides.set(id, side);
        roleIndex.set(id, index);
        squads[side].push(id);
        if (index === 0) keepers[side] = id;

        const athlete = setup.rosters?.[side]?.[index];
        if (athlete === undefined) {
          ratings.set(id, rollRatings(rosterRng, index));
        } else {
          const entry = rosterEntry(athlete);
          ratings.set(id, entry.ratings);
          athleteIds.set(id, entry.athleteId);
        }
      }
    }

    const ballState = createBall(world, PITCH.length / 2, CENTRE_Y, SOCCER_BALL_PHYSICS, Kind.BALL);

    const controlled =
      setup.playerSide === -1
        ? NO_ENTITY
        : (squads[setup.playerSide][9] ?? squads[setup.playerSide][0] ?? NO_ENTITY);

    world.reindex();

    // The coin toss is the only draw the setup makes beyond the roster, and it comes from its own
    // fork so adding one elsewhere cannot change who kicks off.
    const kickOffSide: PitchSide = rng.fork('toss').next() < 0.5 ? 0 : 1;
    const rules = createRulesState(kickOffSide);

    const state: SoccerState = {
      sport: 'soccer',
      ball: ballState.entity,
      ballState,
      rules,
      stamina: createStamina(),
      sides,
      roleIndex,
      ratings,
      athleteIds,
      keepers,
      formations: shapes,
      squads,
      controlled,
      pass: null,
      shot: null,
      elapsed: 0,
      finished: false,
    };

    startHalf(rules, 1, 0);
    return state;
  },

  step(
    state: SoccerState,
    world: World,
    inputs: ReadonlyMap<EntityId, InputFrame>,
    dt: number,
    rng: Rng,
  ): readonly SportEvent[] {
    const events: SportEvent[] = [];
    state.elapsed++;
    const step = state.elapsed;

    const ball = state.ballState;
    const carrier = ball.carrier;
    const possession = carrier === NO_ENTITY ? -1 : (state.sides.get(carrier) ?? -1);
    state.rules.possession = possession;

    const ballX = world.x[ball.entity] as number;
    const ballY = world.y[ball.entity] as number;

    // Advantage, then restarts. Both are clock work and neither depends on where anyone is.
    if (isPlayingAdvantage(state.rules)) {
      events.push(...tickAdvantage(state.rules, possession === state.rules.advantage?.side, step));
    }

    if (isBallDead(state.rules)) {
      events.push(...this.stepRestart(state, world, step, dt, rng));
      return events;
    }

    // Everyone moves.
    moveEveryone(state, world, inputs, dt, possession, ballX, ballY);

    // The ball, then what it ran into.
    if (carrier === NO_ENTITY) {
      stepBall(world, ball, dt, SOCCER_BALL_PHYSICS);
      events.push(...settleLooseBall(state, world, step, rng));
    } else {
      carry(state, world, carrier, ballX, ballY);
      events.push(...contestCarrier(state, world, carrier, step, rng));
    }

    events.push(...checkGoalAndBounds(state, world, step));
    if (!isBallDead(state.rules)) {
      events.push(...decide(state, world, step, rng));
    }
    return events;
  },

  resolveAction(
    state: SoccerState,
    world: World,
    actor: EntityId,
    action: ActionIntent,
    rng: Rng,
  ): readonly SportEvent[] {
    const side = state.sides.get(actor);
    if (side === undefined) return [];
    const step = state.elapsed;

    switch (action.kind) {
      case 'shoot':
        return shoot(state, world, actor, side, action, step, rng);
      case 'pass':
        return pass(state, world, actor, side, action, step, rng);
      default:
        return [];
    }
  },

  isFinished(state: SoccerState): boolean {
    return state.finished;
  },

  status(state: SoccerState): SportStatus {
    const period = 1;
    return {
      // Soccer has no action clock. The first sport to exercise that `null`.
      actionClock: null,
      teamFouls: [state.rules.teamFouls[0], state.rules.teamFouls[1]],
      bonus: null,
      possession: state.rules.possession,
      controlled: state.controlled,
      stoppage: state.rules.restart === null ? null : state.rules.restart.reason,
      meter: null,
      periodClock: remainingGameSeconds(state.rules, state.elapsed, period),
    };
  },

  startPeriod(state: SoccerState, period: number): void {
    startHalf(state.rules, period, state.elapsed);
    resetShape(state, 0);
    resetShape(state, 1);
  },

  /**
   * Restart handling, exposed on the module so `step()` reads as a sequence rather than a wall.
   * Not part of `SportModule` — an extra member is allowed, and the seam ignores what it does not
   * know about.
   */
  stepRestart(
    state: SoccerState,
    world: World,
    step: number,
    dt: number,
    rng: Rng,
  ): readonly SportEvent[] {
    const events: SportEvent[] = [...tickRestart(state.rules, step)];
    const restart = state.rules.restart;
    if (restart === null) return events;

    const taker = nearestOf(state, world, restart.side as PitchSide, restart.x, restart.y);
    if (taker === NO_ENTITY) return events;

    // The taker walks to the ball; everyone else takes up the shape for the phase.
    moveEveryone(state, world, new Map(), dt, restart.side, restart.x, restart.y);
    world.x[state.ball.valueOf()] = restart.x;
    world.y[state.ball.valueOf()] = restart.y;
    world.z[state.ball.valueOf()] = SOCCER_BALL_PHYSICS.radius;

    const distance = Math.hypot(
      (world.x[taker] as number) - restart.x,
      (world.y[taker] as number) - restart.y,
    );
    if (distance > RESTART_READY_RANGE) return events;

    if (!state.rules.restartReady) {
      events.push(...readyRestart(state.rules, step));
      return events;
    }
    if (state.rules.restartDelay > 0) return events;

    events.push(...completeRestart(state.rules, step));
    attach(world, state.ballState, taker);
    registerTouch(state.rules, restart.side);
    void rng;
    return events;
  },
};

/* ------------------------------------------------------------------ movement */

const desired: Vec2 = { x: 0, y: 0 };

function moveEveryone(
  state: SoccerState,
  world: World,
  inputs: ReadonlyMap<EntityId, InputFrame>,
  dt: number,
  possession: 0 | 1 | -1,
  ballX: number,
  ballY: number,
): void {
  const phases: Record<0 | 1, PlayPhase> = {
    0: phaseFor(0, possession, ballX),
    1: phaseFor(1, possession, ballX),
  };
  const shapes: Record<0 | 1, readonly { x: number; y: number }[]> = {
    0: cachedShape(state.formations[0], phases[0], 0),
    1: cachedShape(state.formations[1], phases[1], 1),
  };

  // Profiles are built once, up front, rather than inside `profileOf`. Two reasons, and the first
  // is a real bug avoided: `integrateAll` asks for a profile and a desired velocity separately, so
  // ticking stamina inside the profile lookup would drain a sprinting athlete twice a step. The
  // second is that `desiredOf` needs the profile too and the engine's signature does not pass it.
  const profiles = new Map<EntityId, MovementProfile>();
  for (const side of [0, 1] as const) {
    for (const id of state.squads[side]) {
      const r = state.ratings.get(id);
      const carrying = state.ballState.carrier === id;
      const sprinting = !carrying && chasing(state, world, id, ballX, ballY);
      tickStamina(state.stamina, id, sprinting ? 0.9 : 0.3);
      profiles.set(
        id,
        dribbleProfile(
          { dribbling: r?.dribbling ?? 50, pace: r?.pace ?? 50 },
          state.stamina[id] ?? 1,
          {
            carrying,
            sprinting,
          },
        ),
      );
    }
  }

  const fallback = dribbleProfile({ dribbling: 50, pace: 50 }, 1);
  const profileOf = (id: EntityId): MovementProfile => profiles.get(id) ?? fallback;

  const desiredOf = (id: EntityId): Vec2 => {
    const profile = profileOf(id);
    const side = state.sides.get(id);
    const index = state.roleIndex.get(id);
    if (side === undefined || index === undefined) return zero();

    const input = inputs.get(id);
    if (input !== undefined && (input.moveX !== 0 || input.moveY !== 0)) {
      desired.x = input.moveX * profile.maxSpeed;
      desired.y = input.moveY * profile.maxSpeed;
      return desired;
    }

    const x = world.x[id] as number;
    const y = world.y[id] as number;

    // The keeper keeps goal and does not join in.
    if (id === state.keepers[side]) {
      const spot = keeperSpot(ballX, ballY, side, formation(state.formations[side]).aggression);
      return arrive(x, y, spot.x, spot.y, profile.maxSpeed, 3, desired);
    }

    if (state.ballState.carrier === id) {
      const goal = attackedGoal(side);
      return seek(x, y, goal.x, goal.y, profile.maxSpeed, desired);
    }

    if (chasing(state, world, id, ballX, ballY)) {
      return seek(x, y, ballX, ballY, profile.maxSpeed, desired);
    }

    const spot = shapes[side][index] as { x: number; y: number };
    // Drift towards the ball's channel so a shape does not look painted on.
    const pull = 0.18;
    return arrive(
      x,
      y,
      spot.x + (ballX - spot.x) * pull,
      spot.y + (ballY - spot.y) * pull,
      profile.maxSpeed,
      2.5,
      desired,
    );
  };

  integrateAll(world, dt, profileOf, desiredOf);
}

/** Whether this athlete is the one going after the ball: closest of their side, keeper aside. */
function chasing(
  state: SoccerState,
  world: World,
  id: EntityId,
  ballX: number,
  ballY: number,
): boolean {
  const side = state.sides.get(id);
  if (side === undefined || id === state.keepers[side]) return false;
  return nearestOf(state, world, side, ballX, ballY) === id;
}

function nearestOf(
  state: SoccerState,
  world: World,
  side: PitchSide,
  x: number,
  y: number,
): EntityId {
  let best = NO_ENTITY;
  let bestDistance = Infinity;
  for (const id of state.squads[side]) {
    if (id === state.keepers[side]) continue;
    if (isSentOff(state.rules, id)) continue;
    const distance = Math.hypot((world.x[id] as number) - x, (world.y[id] as number) - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }
  return best;
}

/** Keeps the ball the touch-distance ahead of the carrier, which is where dribbling lives. */
function carry(
  state: SoccerState,
  world: World,
  carrier: EntityId,
  ballX: number,
  ballY: number,
): void {
  void ballX;
  void ballY;
  const r = state.ratings.get(carrier);
  if (r === undefined) return;
  const lead = touchDistance({ dribbling: r.dribbling, pace: r.pace }, false);
  const facing = world.facing[carrier] as number;
  world.x[state.ball.valueOf()] = (world.x[carrier] as number) + Math.cos(facing) * lead;
  world.y[state.ball.valueOf()] = (world.y[carrier] as number) + Math.sin(facing) * lead;
  world.z[state.ball.valueOf()] = SOCCER_BALL_PHYSICS.radius;
}

/* ------------------------------------------------------------------ contests */

/** A loose ball: whoever can take it, does — and a pass that arrives is judged for offside. */
function settleLooseBall(
  state: SoccerState,
  world: World,
  step: number,
  rng: Rng,
): readonly SportEvent[] {
  const events: SportEvent[] = [];
  const ball = state.ballState;

  for (const side of [0, 1] as const) {
    for (const id of state.squads[side]) {
      if (isSentOff(state.rules, id)) continue;
      const keeper = id === state.keepers[side];
      if (!canCatch(world, ball, id, keeper ? KEEPER.reach : 0.9, keeper ? 2.6 : 2.2)) continue;

      // A shot arriving at the keeper is a save, not a catch.
      if (keeper && state.shot !== null && state.shot.side !== side) {
        const r = state.ratings.get(id);
        const outcome = saveOutcome(
          { goalkeeping: r?.goalkeeping ?? 50 },
          { y: world.y[id] as number },
          state.shot.aim,
          0.3,
          Math.hypot(world.vx[ball.entity] as number, world.vy[ball.entity] as number),
          rng,
        );
        state.shot = null;
        if (outcome === 'beaten') continue;
        events.push(event(EventKind.SAVE, step, side, { actor: id }));
        if (outcome === 'parried') {
          release(world, ball, rng.float(-6, 6), rng.float(-6, 6), 2, 0);
          registerTouch(state.rules, side);
          return events;
        }
      }

      // Offside is judged the moment the ball is touched, off the frozen snapshot (T-6.3).
      const inFlight = state.pass;
      if (inFlight !== null && inFlight.offside !== null && judgeOffside(inFlight.offside, id)) {
        const offence = offsideOffence(inFlight.offside, id, step);
        state.pass = null;
        if (offence !== null) {
          events.push(...offence.events);
          events.push(...awardRestart(state.rules, offence.restart, step));
          return events;
        }
      }

      attach(world, ball, id);
      state.pass = null;
      state.shot = null;
      events.push(...grantPossession(state.rules, side, step, id));
      return events;
    }
  }

  // A ball that has stopped with nobody near it is a drop ball rather than a stalemate.
  if (isAtRest(world, ball, SOCCER_BALL_PHYSICS) && state.rules.lastTouch !== -1) {
    const to = opponent(state.rules.lastTouch as PitchSide);
    events.push(
      ...awardRestart(
        state.rules,
        {
          kind: RestartKind.DROP_BALL,
          side: to,
          x: world.x[ball.entity] as number,
          y: world.y[ball.entity] as number,
          reason: 'dead ball',
        },
        step,
      ),
    );
  }
  return events;
}

/** Defenders who are close enough have a go, once each. */
function contestCarrier(
  state: SoccerState,
  world: World,
  carrier: EntityId,
  step: number,
  rng: Rng,
): readonly SportEvent[] {
  const carrierSide = state.sides.get(carrier);
  if (carrierSide === undefined) return [];
  const defendingSide = opponent(carrierSide);

  const ballX = world.x[state.ball.valueOf()] as number;
  const ballY = world.y[state.ball.valueOf()] as number;

  for (const id of state.squads[defendingSide]) {
    if (isSentOff(state.rules, id)) continue;
    const distance = Math.hypot((world.x[id] as number) - ballX, (world.y[id] as number) - ballY);
    if (distance > tackleReach('standing')) continue;

    const d = state.ratings.get(id);
    const c = state.ratings.get(carrier);
    if (d === undefined || c === undefined) continue;

    const closing = Math.hypot(world.vx[id] as number, world.vy[id] as number);
    const outcome = resolveTackle(
      { id, ratings: { tackling: d.tackling, marking: d.marking } },
      { id: carrier, ratings: { dribbling: c.dribbling, pace: c.pace } },
      tackleTiming(distance, 'standing'),
      'standing',
      closing,
      rng,
    );

    if (outcome.won) {
      attach(world, state.ballState, id);
      return [
        event(EventKind.TURNOVER, step, carrierSide, { actor: id, target: carrier }),
        ...grantPossession(state.rules, defendingSide, step, id),
      ];
    }

    if (outcome.foul !== null) {
      return commitFoul(
        state.rules,
        {
          offender: id,
          offenderSide: defendingSide,
          victim: carrier,
          x: ballX,
          y: ballY,
          kind: outcome.foul.kind,
          severity: outcome.foul.severity,
          advantage: false,
        },
        step,
      ).events;
    }
  }
  return [];
}

/* ------------------------------------------------------------------ outcomes */

function checkGoalAndBounds(state: SoccerState, world: World, step: number): readonly SportEvent[] {
  const ball = state.ballState;
  const x = world.x[ball.entity] as number;
  const y = world.y[ball.entity] as number;
  const z = world.z[ball.entity] as number;

  for (const side of [0, 1] as const) {
    if (!isGoal(x, y, z, side)) continue;
    const scorer = opponent(side);
    const shooter = state.shot?.shooter;
    state.shot = null;
    state.pass = null;
    return [
      shooter === undefined
        ? event(EventKind.SCORE, step, scorer, { value: 1 })
        : event(EventKind.SCORE, step, scorer, { value: 1, actor: shooter }),
      ...onGoalScored(state.rules, scorer, step),
    ];
  }

  if (crossedBoundary(x, y) === null) return [];

  const restart = restartFor(x, y, state.rules.lastTouch);
  if (restart === null) return [];

  state.shot = null;
  state.pass = null;
  return [
    event(EventKind.SPORT, step, state.rules.lastTouch, {
      sportKind: SoccerEvent.OUT_OF_PLAY,
      detail: { restart: restart.kind },
    }),
    ...awardRestart(state.rules, restart, step),
  ];
}

/** The carrier's decision: shoot if it is on, pass if pressed, otherwise keep going. */
function decide(state: SoccerState, world: World, step: number, rng: Rng): readonly SportEvent[] {
  const carrier = state.ballState.carrier;
  if (carrier === NO_ENTITY) return [];
  const side = state.sides.get(carrier);
  if (side === undefined) return [];

  const x = world.x[carrier] as number;
  const y = world.y[carrier] as number;

  if (carrier === state.keepers[side]) {
    const kind = distributionChoice(pressureFor(state, world, carrier, side), true);
    return pass(state, world, carrier, side, { kind: 'pass', power: 1 }, step, rng, kind);
  }

  const distance = shotDistance(x, y, side);
  const pressure = pressureFor(state, world, carrier, side);

  if (distance < SHOOTING_RANGE && (isInAttackingPenaltyArea(x, y, side) || pressure < 0.4)) {
    return shoot(state, world, carrier, side, { kind: 'shoot', power: 1 }, step, rng);
  }

  if (pressure > 0.55) {
    return pass(state, world, carrier, side, { kind: 'pass' }, step, rng);
  }
  return [];
}

/**
 * Scratch buffers for the hot path (T-6.11).
 *
 * `pressureFor` runs on every carrier decision and `positionsOf` twice on every pass, and both used
 * to `filter().map()` eleven fresh objects each time. Reusing one array of eleven records removes
 * that garbage entirely. Safe because both are consumed synchronously and never retained —
 * `pressureOn` reads them and returns a number, and `captureOffside` copies what it keeps into its
 * own snapshot.
 *
 * Module-level rather than per-state: a step is single-threaded and never re-entrant, and one match
 * at a time is the only thing that runs. Two concurrent matches would need these on the state, and
 * the day that happens this comment is the warning.
 */
const pressureScratch: { x: number; y: number; marking: number }[] = [];
const positionScratch: [PlayerPosition[], PlayerPosition[]] = [[], []];

function pressureFor(state: SoccerState, world: World, carrier: EntityId, side: PitchSide): number {
  pressureScratch.length = 0;
  for (const id of state.squads[opponent(side)]) {
    if (isSentOff(state.rules, id)) continue;
    pressureScratch.push({
      x: world.x[id] as number,
      y: world.y[id] as number,
      marking: state.ratings.get(id)?.marking ?? 50,
    });
  }
  return pressureOn(
    { x: world.x[carrier] as number, y: world.y[carrier] as number },
    pressureScratch,
  );
}

function shoot(
  state: SoccerState,
  world: World,
  actor: EntityId,
  side: PitchSide,
  action: ActionIntent,
  step: number,
  rng: Rng,
): readonly SportEvent[] {
  const r = state.ratings.get(actor);
  if (r === undefined || state.ballState.carrier !== actor) return [];

  const shotRng = rng.fork('shooting');
  const shot = takeShot(
    world,
    state.ballState,
    {
      shooter: actor,
      side,
      ratings: { finishing: r.finishing, shotPower: r.shotPower, coordination: r.coordination },
      power: clamp01(action.power ?? SHOOTING.tapPower + 0.4),
      placeAcross: shotRng.float(-0.85, 0.85),
      placeUp: shotRng.float(0.1, 0.7),
      pressure: pressureFor(state, world, actor, side),
      approachAngle: 0,
    },
    step,
    shotRng,
  );

  state.shot = shot;
  state.pass = null;
  registerTouch(state.rules, side);
  state.rules.possession = -1;

  return [
    event(EventKind.SHOT, step, side, {
      actor,
      value: shot.distance,
      x: world.x[actor] as number,
      y: world.y[actor] as number,
      detail: { openness: Number(shot.openness.toFixed(3)) },
    }),
  ];
}

function pass(
  state: SoccerState,
  world: World,
  actor: EntityId,
  side: PitchSide,
  action: ActionIntent,
  step: number,
  rng: Rng,
  forceKind?: PassKind,
): readonly SportEvent[] {
  const r = state.ratings.get(actor);
  if (r === undefined || state.ballState.carrier !== actor) return [];

  const mates = state.squads[side].filter(
    (id) => id !== actor && id !== state.keepers[side] && !isSentOff(state.rules, id),
  );
  const goal = attackedGoal(side);
  const from = { x: world.x[actor] as number, y: world.y[actor] as number };
  const aimX = goal.x - from.x;
  const aimY = goal.y - from.y;

  const target = selectPassTarget(world, from, aimX, aimY, mates);
  if (target === NO_ENTITY) return [];

  const kind: PassKind = forceKind ?? choosePassKind(from, world, target);
  const lead = leadTarget(world, from, target, kind, kind === 'through' ? 6 : 0);

  const passRng = rng.fork('passing');
  const inFlight = throwPass(
    world,
    state.ballState,
    {
      kind,
      passer: actor,
      side,
      target,
      toX: lead.x,
      toY: lead.y,
      ratings: { shortPass: r.shortPass, longPass: r.longPass, crossing: r.crossing },
      pressure: pressureFor(state, world, actor, side),
      power: action.power ?? 1,
    },
    step,
    passRng,
    {
      attackers: positionsOf(state, world, side),
      defenders: positionsOf(state, world, opponent(side)),
    },
  );

  state.pass = inFlight;
  state.shot = null;
  registerTouch(state.rules, side);
  state.rules.possession = -1;

  return [event(EventKind.PASS, step, side, { actor, target, detail: { kind } })];
}

function choosePassKind(from: { x: number; y: number }, world: World, target: EntityId): PassKind {
  const distance = Math.hypot(
    (world.x[target] as number) - from.x,
    (world.y[target] as number) - from.y,
  );
  if (distance > 32) return 'lofted';
  return distance > 18 ? 'through' : 'short';
}

function positionsOf(state: SoccerState, world: World, side: PitchSide): PlayerPosition[] {
  const out = positionScratch[side];
  out.length = 0;
  for (const id of state.squads[side]) {
    if (isSentOff(state.rules, id)) continue;
    out.push({ id, x: world.x[id] as number, y: world.y[id] as number });
  }
  return out;
}

function resetShape(state: SoccerState, side: PitchSide): void {
  void state;
  void side;
  // Positions are re-derived every step from the formation, so a period start needs nothing here
  // beyond what `startHalf` already did. Kept as a named seam for T-6.16's kick-off animation.
}

function zero(): Vec2 {
  desired.x = 0;
  desired.y = 0;
  return desired;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
