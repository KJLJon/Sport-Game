/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.9 — Input layer: floating joystick, context buttons, handedness mirror, keyboard, gamepad
 * @story   US-2.1 — Control my athlete with a virtual joystick; US-2.6 — Alternative input on desktop
 * @design  06-game-design.md §2 (controls), 04-architecture.md §6
 * @invariant INV-8 (a match is reconstructible from seed, setup, and inputs)
 *
 * Purpose: the one shape the simulation consumes. Touch, keyboard, and gamepad all reduce to an
 * `InputFrame`, and nothing downstream can tell which device produced it — which is what makes
 * US-2.6 free rather than a second control path to maintain, and what makes T-1.12's input
 * recording a recording of the *game* rather than of a thumb.
 */

/** The action buttons. What each one means is state-dependent (`06` §2). */
export const Button = {
  /** Shoot, steal, tackle — the primary verb for the current state. */
  A: 1 << 0,
  /** Pass, screen, pressure — the secondary verb. */
  B: 1 << 1,
  /** Sprint / intense-D. Held, not tapped. */
  MODIFIER: 1 << 2,
  /** Switch controlled athlete (US-2.2). */
  SWITCH: 1 << 3,
} as const;
export type ButtonMask = number;

/**
 * One step's worth of intent. Deliberately small and flat: it is recorded for every step of every
 * match (T-1.12), sent over the wire in P2P lockstep (T-10.7), and compared byte-for-byte in the
 * determinism tests.
 */
export interface InputFrame {
  /** Stick direction, each axis in `-1 … 1`. Already deadzoned and clamped to the unit circle. */
  readonly moveX: number;
  readonly moveY: number;
  /** Buttons held this step. */
  readonly held: ButtonMask;
  /** Buttons that went down *this* step — the edge, for taps. */
  readonly pressed: ButtonMask;
  /** Buttons released this step. Hold-and-release shooting (`06` §2) needs the edge. */
  readonly released: ButtonMask;
}

export const EMPTY_FRAME: InputFrame = {
  moveX: 0,
  moveY: 0,
  held: 0,
  pressed: 0,
  released: 0,
};

export function isHeld(frame: InputFrame, button: number): boolean {
  return (frame.held & button) !== 0;
}

export function wasPressed(frame: InputFrame, button: number): boolean {
  return (frame.pressed & button) !== 0;
}

export function wasReleased(frame: InputFrame, button: number): boolean {
  return (frame.released & button) !== 0;
}

/** Stick magnitude, `0–1`. Analog movement (US-2.1) means walking is a real option. */
export function magnitude(frame: InputFrame): number {
  return Math.hypot(frame.moveX, frame.moveY);
}

/** Builds the frame that follows `previous`, deriving the press and release edges from it. */
export function makeFrame(
  moveX: number,
  moveY: number,
  held: ButtonMask,
  previous: InputFrame = EMPTY_FRAME,
): InputFrame {
  return {
    moveX,
    moveY,
    held,
    pressed: held & ~previous.held,
    released: ~held & previous.held & 0xffff,
  };
}

/** Two frames are equal when the simulation cannot tell them apart. */
export function framesEqual(a: InputFrame, b: InputFrame): boolean {
  return (
    a.moveX === b.moveX &&
    a.moveY === b.moveY &&
    a.held === b.held &&
    a.pressed === b.pressed &&
    a.released === b.released
  );
}
