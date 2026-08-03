/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.1 — Follow camera: track the active athlete with lookahead, deadzone, and
 *          speed-scaled framing
 * @task    T-12.2 — Dynamic zoom by phase of play
 * @task    T-12.6 — Per-sport camera profiles through the seam
 * @story   US-2.3 — See what is happening on a small screen
 * @design  04-architecture.md §6 (rendering), 10-ui-ux.md §6 (reduced motion), 01-plan.md R2
 * @invariant INV-5 (no sport-specific branching in engine core), INV-8 (the camera never feeds
 *            the sim)
 *
 * Purpose: decides *what should be in frame*, as pure functions of a signal any sport can produce.
 * `Camera` is the mechanism — smoothing, clamping, shake; this is the policy — where to look and
 * how much to show. Keeping them apart is what lets the policy be unit-tested with numbers instead
 * of pixels, and what lets a sport replace the policy's constants without touching the mechanism.
 *
 * **Why the signal is shaped the way it is.** Every field here is something the engine can compute
 * from a `World` and a `SportStatus` without knowing which sport it is looking at: where the ball
 * is, how fast, who has it, how close the nearest opponent is, how spread out the players near the
 * ball are, and whether play is stopped. A "phase of play" is then a classification of those
 * numbers rather than a thing a sport reports — because the moment the engine asks a sport "are we
 * on a counter-attack", the engine has a sport-shaped hole in it (INV-5).
 */
import type { FollowTarget } from './camera.ts';

/**
 * What the camera thinks is happening. Not a rules concept — the rules have no idea what a "duel"
 * is — but a framing concept, and the four cases genuinely want different amounts of the field.
 */
export const PLAY_PHASES = ['setPiece', 'duel', 'openPlay', 'counter'] as const;
export type PlayPhase = (typeof PLAY_PHASES)[number];

/** Spans, in world units of the viewport's long axis, one per phase. */
export type PhaseSpans = Readonly<Record<PlayPhase, number>>;

/**
 * A sport's opinion about framing. Supplied through the `SportModule` seam, which is what makes
 * per-sport framing possible without a sport id appearing in engine or mode code (T-12.6).
 *
 * Every field has a default, so a sport that has no opinion — a test fixture, a sport still being
 * built — supplies nothing and gets framing that works.
 */
export interface CameraProfile {
  /**
   * Metres of the viewport's width to show in each phase.
   *
   * These are *requests*. A span wider than the field is clamped to the field, which is what makes
   * one set of numbers safe across a 105 m pitch and a 28 m court: basketball's phases all clamp to
   * the court and its framing barely moves, while soccer's use the full range.
   */
  readonly spans: PhaseSpans;
  /**
   * How much of the framing follows the ball rather than the athlete the player controls, `0–1`.
   *
   * Not 1: a camera locked to the ball is a camera that leaves your own athlete off-screen the
   * moment the ball is cleared, and then you are steering something you cannot see. Not 0 either,
   * for the obvious reason. The default leans to the ball because the ball is what the player is
   * actually tracking, and pulls back towards the athlete as the two separate.
   */
  readonly ballWeight: number;
  /**
   * World units past which the framing stops trying to hold both the ball and the athlete in one
   * shot and commits to the ball.
   *
   * Below it the midpoint is a useful compromise; above it the midpoint is a place where nothing is
   * happening, which is the worst frame of the three.
   */
  readonly splitDistance: number;
  /** Seconds of velocity the camera looks ahead by. */
  readonly lookahead: number;
  /** Cap on the lookahead offset, in world units. */
  readonly maxLead: number;
  /** Deadzone as a fraction of the visible half-extent, per phase. */
  readonly deadzone: number;
  /**
   * Extra span, in world units, per world-unit-per-second of focus speed.
   *
   * This is the "speed-scaled" half of T-12.1: the camera shows more of the field when play is
   * moving fast, because at speed the player needs to see where they are going more than they need
   * to see detail. Bounded by `maxSpeedSpan` so a struck shot does not zoom the match out to nothing.
   */
  readonly speedSpan: number;
  readonly maxSpeedSpan: number;
  /**
   * How large an athlete is, in world units, for the purpose of deciding whether they are legible.
   * Roughly a top-down athlete's drawn diameter — not a physics radius.
   */
  readonly athleteSize: number;
  /**
   * The fewest screen pixels an athlete may be drawn across before the framing refuses to widen
   * further. This is `01` R2 as an equation rather than a magic number.
   *
   * T-6.12 solved the same problem with a fixed 45 m span, which was right for the phone it was
   * measured on and wrong everywhere else: on a tablet it wasted a legible screen, and it made
   * every span wider than 45 m unreachable — so a set piece could never actually be framed wide.
   * Deriving the widest span from the viewport instead means the framing adapts to the device, and
   * a 360 px phone and a 1200 px tablet each get the widest shot that is still readable on them.
   */
  readonly minAthletePixels: number;
  /** Ball speed, in world units per second, at which open play is read as a counter. */
  readonly counterSpeed: number;
  /** Distance from the ball to the nearest opponent, in world units, at which it is read as a duel. */
  readonly duelRadius: number;
  /** Seconds a phase must hold before another may replace it. Stops the zoom flickering. */
  readonly phaseDwell: number;
}

/**
 * How much the camera may move (T-12.7). Lives here rather than with the preference that stores it,
 * because it is a fact about the camera; `app/motion.ts` decides which of these a player has asked
 * for and re-exports the type.
 *
 * - `full` — everything: lookahead, dynamic zoom by phase, handoff pans, shake.
 * - `reduced` — still follows, at one fixed zoom, with a wide deadzone. No lookahead, no zoom
 *   changes, no shake.
 * - `fixed` — does not move at all. The whole field, always, athletes as dots.
 *
 * `fixed` is worse to play, and it is nobody's business but the player's whether they want it: an
 * accessibility setting that stops short of the option somebody actually needs is not one.
 */
export const CAMERA_MOTIONS = ['full', 'reduced', 'fixed'] as const;
export type CameraMotion = (typeof CAMERA_MOTIONS)[number];

/**
 * The framing a sport gets when it says nothing.
 *
 * The spans are the reasoning from T-6.12 continued: 45 m was chosen there as "a phase of play"
 * and is still the open-play number. A duel wants less — 28 m is about a penalty area's width, and
 * close enough to see a shoulder drop. A counter wants more, because the whole point of a counter
 * is the space ahead. A set piece wants the most: it is the one moment where nothing is moving and
 * the player is choosing, so it is the one moment they can be given the whole shape of the game.
 */
export const DEFAULT_CAMERA_PROFILE: CameraProfile = {
  spans: { duel: 28, openPlay: 45, counter: 58, setPiece: 70 },
  ballWeight: 0.7,
  splitDistance: 30,
  lookahead: 0.35,
  maxLead: 6,
  deadzone: 0.18,
  speedSpan: 0.55,
  maxSpeedSpan: 12,
  athleteSize: 1.4,
  minAthletePixels: 18,
  counterSpeed: 11,
  duelRadius: 4.5,
  phaseDwell: 0.7,
};

/**
 * What a sport may supply: any subset of the profile, including a subset of the span table. A sport
 * that only wants a tighter duel says so and inherits everything else.
 */
export type PartialCameraProfile = Omit<Partial<CameraProfile>, 'spans'> & {
  readonly spans?: Partial<PhaseSpans>;
};

/** Fills a partial profile from the defaults, so a sport overrides only what it cares about. */
export function cameraProfile(partial?: PartialCameraProfile): CameraProfile {
  if (partial === undefined) return DEFAULT_CAMERA_PROFILE;
  return {
    ...DEFAULT_CAMERA_PROFILE,
    ...partial,
    spans: { ...DEFAULT_CAMERA_PROFILE.spans, ...partial.spans },
  };
}

/**
 * Everything the framing policy needs, and nothing that names a sport.
 *
 * Assembled once a frame by whoever owns the match — see `modes/live/framing.ts`, which is the only
 * place that knows how to read these out of a `World`.
 */
export interface FramingSignal {
  /** The ball, or whatever the sport considers the object of play. */
  readonly ball: FollowTarget;
  /** The athlete the local player is controlling. `null` for a spectated or headless match. */
  readonly controlled: FollowTarget | null;
  /**
   * Distance from the ball to the nearest opponent of the side holding it, in world units.
   * `Infinity` when nobody holds it — a loose ball is not a duel.
   */
  readonly pressure: number;
  /** Which side has the ball, or `-1`. A change of this is a handoff (T-12.5). */
  readonly possession: 0 | 1 | -1;
  /** Why play is stopped, or `null` when it is live. */
  readonly stoppage: string | null;
}

/**
 * Which phase this signal reads as, ignoring history. `phaseFor` is the judgement; `PhaseTracker`
 * adds the hysteresis that stops it changing its mind every frame.
 *
 * Order matters. A stoppage outranks everything, because a stopped ball moving at speed is a ball
 * being placed, not a counter-attack. A duel outranks a counter for the opposite reason: a player
 * sprinting away from a defender who is still on their shoulder is a duel that happens to be fast,
 * and zooming out at exactly that moment loses the only detail that matters.
 */
export function phaseFor(signal: FramingSignal, profile: CameraProfile): PlayPhase {
  if (signal.stoppage !== null) return 'setPiece';
  if (signal.pressure <= profile.duelRadius) return 'duel';

  const speed = Math.hypot(signal.ball.vx ?? 0, signal.ball.vy ?? 0);
  if (speed >= profile.counterSpeed) return 'counter';
  return 'openPlay';
}

/**
 * Phase with hysteresis: a new phase has to survive `phaseDwell` seconds of the old one before it
 * takes over.
 *
 * Without this the zoom hunts. Pressure crosses the duel radius several times a second when two
 * players run together, and a camera that re-frames on each crossing is a camera nobody can watch.
 * A set piece is the one exception — it starts and ends on a rules event, not on a threshold, so it
 * takes effect immediately in both directions.
 */
export class PhaseTracker {
  private current: PlayPhase = 'openPlay';
  private candidate: PlayPhase = 'openPlay';
  private held = 0;

  constructor(private readonly profile: CameraProfile) {}

  get phase(): PlayPhase {
    return this.current;
  }

  update(dt: number, signal: FramingSignal): PlayPhase {
    const next = phaseFor(signal, this.profile);

    // A stoppage is a fact, not a threshold reading. Entering and leaving it are both immediate:
    // waiting out a dwell before widening for a free kick shows the player the wrong thing at the
    // one moment they have time to look.
    if (next === 'setPiece' || this.current === 'setPiece') {
      this.current = next;
      this.candidate = next;
      this.held = 0;
      return this.current;
    }

    if (next === this.current) {
      this.candidate = next;
      this.held = 0;
      return this.current;
    }

    if (next !== this.candidate) {
      this.candidate = next;
      this.held = 0;
    }

    this.held += dt;
    if (this.held >= this.profile.phaseDwell) {
      this.current = this.candidate;
      this.held = 0;
    }
    return this.current;
  }

  /** A period start, a mount — forget the history rather than easing out of a stale phase. */
  reset(phase: PlayPhase = 'openPlay'): void {
    this.current = phase;
    this.candidate = phase;
    this.held = 0;
  }
}

/**
 * Where to point the camera: the ball and the controlled athlete, blended.
 *
 * The blend is not fixed. While the two are close the frame holds both, weighted towards the ball;
 * as they separate past `splitDistance` the weight moves to the ball, because past that distance no
 * single frame holds both and a compromise frame holds neither. The athlete is then found by the
 * edge indicators (T-12.3), which is what they are for.
 */
export function focusPoint(signal: FramingSignal, profile: CameraProfile): FollowTarget {
  const { ball, controlled } = signal;
  if (controlled === null) return ball;

  const separation = Math.hypot(ball.x - controlled.x, ball.y - controlled.y);
  const commit = clamp01(separation / Math.max(profile.splitDistance, 0.001));
  const weight = profile.ballWeight + (1 - profile.ballWeight) * commit;

  return {
    x: lerp(controlled.x, ball.x, weight),
    y: lerp(controlled.y, ball.y, weight),
    vx: lerp(controlled.vx ?? 0, ball.vx ?? 0, weight),
    vy: lerp(controlled.vy ?? 0, ball.vy ?? 0, weight),
  };
}

/**
 * The widest span this viewport can show and still draw an athlete large enough to see — T-6.12's
 * 45 m rule, generalised from one phone to every screen.
 *
 * This is the floor beneath every framing decision. Nothing may zoom out past it, including a set
 * piece, including a sport that asks for more: the whole phase exists because an athlete three
 * pixels across is not information.
 */
export function legibleSpan(viewWidth: number, profile: CameraProfile): number {
  return (profile.athleteSize * viewWidth) / Math.max(profile.minAthletePixels, 1);
}

/**
 * The span to frame, in world units of the viewport's width: the phase's span, widened by how fast
 * the focus is moving, and never asking for more than the field has or more than the screen can
 * legibly show.
 */
export function spanFor(
  phase: PlayPhase,
  focus: FollowTarget,
  profile: CameraProfile,
  fieldWidth: number,
  viewWidth?: number,
): number {
  const speed = Math.hypot(focus.vx ?? 0, focus.vy ?? 0);
  const extra = Math.min(speed * profile.speedSpan, profile.maxSpeedSpan);
  const wanted = Math.min(profile.spans[phase] + extra, fieldWidth);
  if (viewWidth === undefined) return wanted;
  return Math.min(wanted, legibleSpan(viewWidth, profile));
}

/** Screen pixels per world unit that shows `span` world units across `viewWidth` pixels. */
export function scaleForSpan(viewWidth: number, span: number): number {
  return viewWidth / Math.max(span, 0.001);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
