/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.7 — Auto-call assistant coach, fast-forward, turn-speed control
 * @story   US-15.6 — Keep a long match from becoming a chore
 * @design  09-modes-and-arcade.md §2.1 ("hold to fast-forward", the Auto-call toggle),
 *          10-ui-ux.md §6 (reduced motion), §8.4
 * @invariant INV-5 (nothing sport-specific here)
 *
 * Purpose: how fast a turn plays, and who is calling it. `09` §2.1 asks for both in one sentence —
 * "you can hold to fast-forward, and an Auto-call toggle hands play-calling to your assistant coach
 * for stretches, so a match never becomes a chore" — and both are the same problem: a basketball
 * Playbook match is about 210 turns (T-5.2), and 210 of anything needs a way to go faster.
 *
 * **Speed is a multiplier on the diagram's own clock, not a second timeline.** T-5.3 made the
 * diagram's beats fractions of its duration precisely so this could be one number. Nothing here
 * touches the resolution: fast-forwarding changes how long you watch a possession, never what
 * happened in it.
 *
 * **Reduced motion is `instant`, not `fast`.** `10` §6 is about people motion makes ill; a
 * quadruple-speed animation is still animation. Asked for it, playback jumps to the final frame.
 *
 * **Auto-call always hands back for a key moment.** "For stretches" is the whole point — the coach
 * covers the possessions you do not care about, and the ones you do are still yours. A toggle that
 * also played your buzzer-beaters would be a toggle that plays the game for you.
 */
import { diagramAt, finalFrame, type DiagramFrame, type TurnDiagram } from './diagram.ts';

export const TURN_SPEEDS = ['slow', 'normal', 'fast', 'instant'] as const;
export type TurnSpeed = (typeof TURN_SPEEDS)[number];

/**
 * `09` §2.1 puts a turn at 4–8 seconds of resolution, so `normal` is that and the others bracket
 * it. `instant` is not a multiplier — it is "do not animate" — and is represented as such.
 */
export const SPEED_MULTIPLIERS: Readonly<Record<TurnSpeed, number>> = {
  slow: 0.7,
  normal: 1,
  fast: 2,
  instant: Infinity,
};

/** What holding the screen is worth, on top of the chosen speed. */
export const FAST_FORWARD = 4;

export function isTurnSpeed(value: string): value is TurnSpeed {
  return (TURN_SPEEDS as readonly string[]).includes(value);
}

/**
 * The multiplier in force this frame. Reduced motion outranks everything, because the setting is a
 * statement about what the player's body can take rather than a preference about pacing.
 */
export function paceFor(speed: TurnSpeed, holding: boolean, reducedMotion: boolean): number {
  if (reducedMotion) return Infinity;
  const base = SPEED_MULTIPLIERS[speed];
  return holding ? base * FAST_FORWARD : base;
}

/** Whether play-calling is being handled for you (`09` §2.1). */
export const AUTO_CALL_MODES = ['off', 'on'] as const;
export type AutoCallMode = (typeof AUTO_CALL_MODES)[number];

export interface PacePrefs {
  readonly speed: TurnSpeed;
  readonly autoCall: AutoCallMode;
}

export const DEFAULT_PACE: PacePrefs = { speed: 'normal', autoCall: 'off' };

/**
 * Whether the coach takes this turn. Auto-call covers the ordinary possessions and hands back the
 * moment there is something to play — which is what "for stretches" means in practice.
 */
export function coachTakesTurn(prefs: PacePrefs, hasKeyMoment: boolean): boolean {
  return prefs.autoCall === 'on' && !hasKeyMoment;
}

/**
 * Plays one turn's diagram at a chosen pace. Deliberately not a component: the screen owns the
 * frame loop, and this owns exactly the arithmetic of how much of the diagram has been seen — which
 * is the part worth testing without a browser.
 */
export class TurnPlayback {
  private seconds = 0;
  private readonly diagram: TurnDiagram;

  constructor(diagram: TurnDiagram) {
    this.diagram = diagram;
  }

  get elapsed(): number {
    return this.seconds;
  }

  get finished(): boolean {
    return this.seconds >= this.diagram.seconds;
  }

  /** `0–1` through the turn, for a progress affordance. */
  get progress(): number {
    return this.diagram.seconds <= 0 ? 1 : Math.min(1, this.seconds / this.diagram.seconds);
  }

  /**
   * Advances by real time at the pace in force. An infinite pace lands on the final frame in one
   * call rather than looping forever towards it.
   */
  advance(dt: number, speed: TurnSpeed, holding = false, reducedMotion = false): void {
    const pace = paceFor(speed, holding, reducedMotion);
    if (!Number.isFinite(pace)) {
      this.skip();
      return;
    }
    this.seconds = Math.min(this.diagram.seconds, this.seconds + Math.max(0, dt) * pace);
  }

  /** Straight to the end — a tap-to-skip, or the last turn of a fast-forwarded stretch. */
  skip(): void {
    this.seconds = this.diagram.seconds;
  }

  frame(): DiagramFrame {
    return this.finished ? finalFrame(this.diagram) : diagramAt(this.diagram, this.seconds);
  }
}
