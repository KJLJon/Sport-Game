/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.2 — Dynamic zoom by phase of play
 * @task    T-12.5 — Camera handoff on possession change, restarts, and goals — never a cut
 *          mid-action
 * @task    T-12.7 — Reduced-motion and accessibility: no camera motion a player cannot turn off
 * @story   US-2.3 — See what is happening on a small screen
 * @design  04-architecture.md §6 (rendering), 10-ui-ux.md §6 (reduced motion)
 * @invariant INV-5 (no sport-specific branching in engine core), INV-8 (the camera never feeds
 *            the sim)
 *
 * Purpose: drives one `Camera` from one `FramingSignal` a frame. It is the only thing that decides
 * *when* the framing changes — the phase it holds, the handoffs it eases, and what a player who has
 * turned camera motion off gets instead.
 *
 * **Why a director rather than more methods on `Camera`.** The camera's job is mechanical and has
 * no memory: given a target and a zoom, approach them. Everything in this file is memory —
 * which phase we were in, who had the ball last frame, how long we have been panning. Putting that
 * in `Camera` would make every existing camera test depend on a match's history.
 *
 * **What "never a cut mid-action" means here (T-12.5).** The ball teleports several times a match:
 * a throw-in, a kickoff after a goal, a jump ball. The sim is right to teleport it; the camera must
 * not. So a jump in the focus point is never followed instantly — it is *panned*, at a raised but
 * finite rate, and the pan is only allowed to be quick when play is stopped. The single place a cut
 * is correct is a period boundary, and that is `snap()`, which a caller asks for explicitly.
 */
import { type Camera, type FollowTarget } from './camera.ts';
import {
  DEFAULT_CAMERA_PROFILE,
  PhaseTracker,
  focusPoint,
  legibleSpan,
  scaleForSpan,
  spanFor,
  type CameraMotion,
  type CameraProfile,
  type FramingSignal,
  type PlayPhase,
} from './framing.ts';
import type { Rng } from '../rng.ts';

export interface DirectorOptions {
  readonly camera: Camera;
  readonly profile?: CameraProfile;
  /** The field's long axis, so a span is never asked to exceed it. */
  readonly fieldWidth: number;
  /** How much the camera may move (T-12.7). Defaults to `full`. */
  readonly motion?: CameraMotion;
  /**
   * World units of focus movement in one frame past which the camera treats it as a jump to be
   * panned rather than a movement to be followed.
   *
   * 12 m is comfortably more than anything that can move under its own power in a frame and
   * comfortably less than any restart.
   */
  readonly jumpDistance?: number;
  /** Seconds a handoff pan lasts before normal following resumes. */
  readonly handoffSeconds?: number;
}

/**
 * What the director did this frame. Read by the tests, and the shape `drawDebugOverlay` wants
 * whenever something wires that overlay up — nothing has since T-1.7 built it.
 */
export interface DirectorState {
  readonly phase: PlayPhase;
  readonly span: number;
  /** Seconds left of a handoff pan, or `0`. */
  readonly handoff: number;
  readonly motion: CameraMotion;
}

/**
 * How the camera behaves for a player who has turned camera motion off.
 *
 * It does *not* mean "no camera": a fixed camera on a 105 m pitch is the three-pixel athlete this
 * phase exists to fix, so the choice is not between motion and legibility. It means no motion the
 * player did not cause — no lookahead, no zoom changes with the phase of play, no shake, and a wide
 * deadzone so the world holds still while play moves inside it. The camera still follows, at one
 * fixed zoom, because losing the ball is worse than a camera that moves (`10` §6).
 */
const REDUCED_MOTION_DEADZONE = 0.45;

export class CameraDirector {
  private readonly camera: Camera;
  private readonly profile: CameraProfile;
  private readonly tracker: PhaseTracker;
  private readonly fieldWidth: number;
  private readonly jumpDistance: number;
  private readonly handoffSeconds: number;

  private motion: CameraMotion;
  private lastFocus: { x: number; y: number } | null = null;
  private lastPossession: 0 | 1 | -1 = -1;
  private handoffLeft = 0;
  private peekLeft = 0;
  private peekAt: { x: number; y: number } | null = null;
  private currentPhase: PlayPhase = 'openPlay';
  private currentSpan = 0;

  constructor(options: DirectorOptions) {
    this.camera = options.camera;
    this.profile = options.profile ?? DEFAULT_CAMERA_PROFILE;
    this.tracker = new PhaseTracker(this.profile);
    this.fieldWidth = options.fieldWidth;
    this.jumpDistance = options.jumpDistance ?? 12;
    this.handoffSeconds = options.handoffSeconds ?? 0.6;
    this.motion = options.motion ?? 'full';

    this.camera.setDeadzone(this.deadzone());
    this.currentSpan = this.profile.spans.openPlay;
  }

  get state(): DirectorState {
    return {
      phase: this.currentPhase,
      span: this.currentSpan,
      handoff: this.handoffLeft,
      motion: this.motion,
    };
  }

  /**
   * Changes how much the camera may move. Takes effect on the next frame rather than immediately,
   * because a setting changed mid-match should not itself be a camera movement.
   */
  setMotion(motion: CameraMotion): void {
    if (this.motion === motion) return;
    this.motion = motion;
    this.camera.setReducedMotion(motion !== 'full');
    this.camera.setDeadzone(this.deadzone());
    if (motion === 'fixed') this.endPeek();
  }

  /**
   * The one legitimate cut: a period start, a mount, a replay seek. Everything else goes through
   * `update`, which pans.
   */
  snap(signal: FramingSignal): void {
    const focus = this.focus(signal);
    this.tracker.reset(this.reduced() ? 'openPlay' : this.tracker.phase);
    this.currentPhase = this.tracker.phase;
    this.currentSpan = this.span(this.currentPhase, focus);
    this.camera.snapTo(focus.x, focus.y, scaleForSpan(this.viewWidth(), this.currentSpan));
    this.lastFocus = { x: focus.x, y: focus.y };
    this.lastPossession = signal.possession;
    this.handoffLeft = 0;
    this.camera.resetFollowRate();
  }

  /**
   * Looks somewhere the play is not, for a few seconds, and then goes back on its own (T-12.4).
   *
   * This is the minimap's tap-to-look, and it is the one camera movement the player asks for
   * directly — so it is *not* suppressed under reduced motion. A setting that exists to stop the
   * camera moving on its own should not also disable the control that moves it deliberately.
   */
  peek(x: number, y: number, seconds = 1.6): void {
    // A fixed camera already shows the whole field, so there is nowhere to look that is not
    // already on screen.
    if (this.motion === 'fixed') return;
    this.peekAt = { x, y };
    this.peekLeft = Math.max(seconds, 0);
  }

  /** Abandons a peek early — the player has touched the stick, so play is what they want to see. */
  endPeek(): void {
    this.peekLeft = 0;
    this.peekAt = null;
  }

  get peeking(): boolean {
    return this.peekLeft > 0;
  }

  /** One frame. `rng` is only used for shake, and only when motion is on (INV-2). */
  update(dt: number, signal: FramingSignal, rng?: Rng): void {
    // `fixed` is the player having asked for no camera movement at all. The camera was built
    // fitting the whole field and is simply left where it is.
    if (this.motion === 'fixed') return;

    if (this.peekLeft > 0) {
      this.updatePeek(dt, rng);
      this.lastPossession = signal.possession;
      return;
    }

    const focus = this.focus(signal);

    this.currentPhase = this.reduced() ? 'openPlay' : this.tracker.update(dt, signal);
    this.currentSpan = this.span(this.currentPhase, focus);
    this.camera.requestScale(scaleForSpan(this.viewWidth(), this.currentSpan));

    this.updateHandoff(dt, signal, focus);

    this.camera.update(dt, focus, rng);
    this.lastFocus = { x: focus.x, y: focus.y };
    this.lastPossession = signal.possession;
  }

  /**
   * A frame spent looking where the player pointed.
   *
   * The deadzone is dropped so the peek actually centres on the requested point, and the span is
   * whatever open play would have used — a peek is for orientation, and a tight frame at the far
   * end of the pitch orientates nobody.
   */
  private updatePeek(dt: number, rng?: Rng): void {
    this.peekLeft = Math.max(0, this.peekLeft - dt);

    const target = this.peekAt;
    if (target === null) return;

    this.currentSpan = this.span('openPlay', { x: target.x, y: target.y, vx: 0, vy: 0 });
    this.camera.requestScale(scaleForSpan(this.viewWidth(), this.currentSpan));
    this.camera.setDeadzone(0);
    this.camera.update(dt, { x: target.x, y: target.y, vx: 0, vy: 0 }, rng);

    if (this.peekLeft > 0) return;

    // Coming back is a handoff like any other: the play has moved on while the player was looking
    // elsewhere, so returning to it must pan rather than cut.
    this.peekAt = null;
    this.handoffLeft = this.handoffSeconds;
    this.lastFocus = { x: this.camera.x, y: this.camera.y };
  }

  /**
   * Starts, sustains, or ends a handoff pan.
   *
   * Two things start one: the focus jumping further than anything could have travelled (a restart,
   * a goal, a turnover that moves the ball across the pitch), and possession changing hands. The
   * second matters even without a jump — the frame's *meaning* changes when the ball changes side,
   * and a camera that keeps drifting as if nothing happened makes the player work out for
   * themselves that they are now defending.
   */
  private updateHandoff(dt: number, signal: FramingSignal, focus: FollowTarget): void {
    const jumped =
      this.lastFocus !== null &&
      Math.hypot(focus.x - this.lastFocus.x, focus.y - this.lastFocus.y) > this.jumpDistance;
    const turnover = signal.possession !== this.lastPossession && signal.possession !== -1;

    if (jumped || turnover) this.handoffLeft = this.handoffSeconds;

    if (this.handoffLeft <= 0) {
      this.camera.resetFollowRate();
      this.camera.setDeadzone(this.deadzone());
      return;
    }

    this.handoffLeft = Math.max(0, this.handoffLeft - dt);

    // The deadzone collapses for the duration: a handoff is precisely the moment the camera should
    // re-centre rather than hold, and a deadzone during a pan leaves the new subject pinned to the
    // edge of the frame it just panned to.
    this.camera.setDeadzone(0);

    // A stopped ball may be reached briskly — nobody is watching the pitch during a throw-in, they
    // are waiting for it. A live ball may not: mid-action, the pan *is* the information, and
    // arriving instantly is the cut this task exists to prevent.
    this.camera.setFollowRate(signal.stoppage !== null ? 9 : 4.5);
  }

  private focus(signal: FramingSignal): FollowTarget {
    const point = focusPoint(signal, this.profile);
    if (!this.reduced()) return point;
    // No lookahead under reduced motion — `Camera` already drops it, but the focus blend's own
    // velocity would otherwise still be handed on to anything reading the target.
    return { x: point.x, y: point.y, vx: 0, vy: 0 };
  }

  private span(phase: PlayPhase, focus: FollowTarget): number {
    if (this.reduced()) {
      // One fixed span, whatever is happening. Open play's is the honest middle: tight enough to
      // read an athlete, wide enough that a counter does not leave the frame behind.
      return Math.min(
        this.profile.spans.openPlay,
        this.fieldWidth,
        legibleSpan(this.viewWidth(), this.profile),
      );
    }
    return spanFor(phase, focus, this.profile, this.fieldWidth, this.viewWidth());
  }

  /** True for anything but `full` — `fixed` never reaches the code that asks. */
  private reduced(): boolean {
    return this.motion !== 'full';
  }

  private deadzone(): number {
    return this.reduced() ? REDUCED_MOTION_DEADZONE : this.profile.deadzone;
  }

  private viewWidth(): number {
    return this.camera.view().width;
  }
}
