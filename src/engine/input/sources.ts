/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.9 — Input layer: keyboard, gamepad, and the router that unifies them
 * @story   US-2.1, US-2.6 — Alternative input on desktop
 * @design  06-game-design.md §2, 04-architecture.md §6
 * @invariant INV-8
 *
 * Purpose: three devices, one `InputFrame`. Each source is fed plain data — key names, pointer
 * coordinates, a gamepad snapshot — rather than DOM events, so the mapping rules are unit-tested
 * with no browser and the app layer owns the listeners.
 *
 * The router also answers "which device is the player using right now", which is what hides the
 * touch controls when a keyboard is in use and brings them straight back on the next touch
 * (US-2.6). That is a display question only; the simulation never learns the answer.
 */
import { Button, EMPTY_FRAME, makeFrame, type ButtonMask, type InputFrame } from './types.ts';
import {
  buttonAt,
  createStick,
  stickDown,
  stickMove,
  stickUp,
  zoneFor,
  type ButtonSpec,
  type ControlLayout,
  type StickState,
} from './joystick.ts';

export type InputDevice = 'touch' | 'keyboard' | 'gamepad';

/** Touch: a floating stick in one half and a button cluster in the other. */
export class TouchInput {
  readonly stick: StickState = createStick();
  private buttons: ButtonSpec[];
  private layout: ControlLayout;
  /** pointerId → the button it is holding. Multi-touch means several at once. */
  private readonly heldButtons = new Map<number, number>();

  constructor(layout: ControlLayout, buttons: ButtonSpec[]) {
    this.layout = layout;
    this.buttons = buttons;
  }

  /** Handedness or a rotation changed. Any in-flight touches are dropped rather than mismapped. */
  setLayout(layout: ControlLayout, buttons: ButtonSpec[]): void {
    this.layout = layout;
    this.buttons = buttons;
    this.heldButtons.clear();
    stickUp(this.stick, this.stick.pointerId ?? -1);
  }

  pointerDown(pointerId: number, x: number, y: number): void {
    if (stickDown(this.stick, this.layout, pointerId, x, y)) return;
    if (zoneFor(this.layout, x) === 'stick') return;

    const button = buttonAt(this.buttons, x, y);
    if (button !== null) this.heldButtons.set(pointerId, button.id);
  }

  pointerMove(pointerId: number, x: number, y: number): void {
    stickMove(this.stick, this.layout, pointerId, x, y);
  }

  pointerUp(pointerId: number): void {
    stickUp(this.stick, pointerId);
    this.heldButtons.delete(pointerId);
  }

  /** A cancelled gesture — a system swipe, a call arriving. Everything lets go. */
  cancelAll(): void {
    this.heldButtons.clear();
    stickUp(this.stick, this.stick.pointerId ?? -1);
  }

  get held(): ButtonMask {
    let mask = 0;
    for (const id of this.heldButtons.values()) mask |= buttonMaskFor(id);
    return mask;
  }

  get active(): boolean {
    return this.stick.pointerId !== null || this.heldButtons.size > 0;
  }

  /**
   * Whether one specific button is down, by its `ButtonSpec.id`.
   *
   * `held` answers the same question as a mask, which is what the input router wants; the renderer
   * wants it per button, and mapping an id back through `buttonMaskFor` at the call site would put
   * the id→mask table in two places (T-6.29).
   */
  isHeld(id: number): boolean {
    for (const held of this.heldButtons.values()) if (held === id) return true;
    return false;
  }
}

/** Button ids in `defaultButtons()` order map onto the abstract buttons. */
function buttonMaskFor(id: number): ButtonMask {
  switch (id) {
    case 1:
      return Button.A;
    case 2:
      return Button.B;
    case 3:
      return Button.MODIFIER;
    default:
      return 0;
  }
}

/**
 * Keyboard mapping (US-2.6). WASD and the arrows both move; the action keys sit under the right
 * hand so a two-handed desktop grip mirrors the phone layout.
 */
export const DEFAULT_KEYMAP: Readonly<Record<string, string>> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'a',
  KeyJ: 'a',
  KeyK: 'b',
  Enter: 'b',
  ShiftLeft: 'modifier',
  ShiftRight: 'modifier',
  KeyE: 'switch',
  Tab: 'switch',
};

export class KeyboardInput {
  private readonly down = new Set<string>();
  private touched = false;

  constructor(private readonly keymap: Readonly<Record<string, string>> = DEFAULT_KEYMAP) {}

  keyDown(code: string): void {
    const action = this.keymap[code];
    if (action === undefined) return;
    this.down.add(action);
    this.touched = true;
  }

  keyUp(code: string): void {
    const action = this.keymap[code];
    if (action === undefined) return;
    this.down.delete(action);
  }

  /** The window lost focus. Held keys never send their keyup, so everything is released. */
  releaseAll(): void {
    this.down.clear();
  }

  /**
   * Digital keys become an analog stick. Diagonals are normalised, so holding two keys is not
   * 41% faster than holding one — a bug old enough to have a name.
   */
  direction(): { x: number; y: number } {
    const x = (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0);
    const y = (this.down.has('down') ? 1 : 0) - (this.down.has('up') ? 1 : 0);
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
  }

  get held(): ButtonMask {
    let mask = 0;
    if (this.down.has('a')) mask |= Button.A;
    if (this.down.has('b')) mask |= Button.B;
    if (this.down.has('modifier')) mask |= Button.MODIFIER;
    if (this.down.has('switch')) mask |= Button.SWITCH;
    return mask;
  }

  get active(): boolean {
    return this.down.size > 0 || this.touched;
  }

  /** Clears the "has been used" flag, so device detection can hand back to touch. */
  clearActivity(): void {
    this.touched = false;
  }
}

/** The subset of the Gamepad API this engine reads. Passed in, never fetched here. */
export interface GamepadSnapshot {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

/** Standard-mapping indices. */
const PAD = { A: 0, B: 1, LB: 4, RB: 5, Y: 3 } as const;

export class GamepadInput {
  private snapshot: GamepadSnapshot | null = null;

  constructor(private readonly deadzone = 0.2) {}

  /** Called once per frame with `navigator.getGamepads()[n]`, or `null` if none is connected. */
  update(snapshot: GamepadSnapshot | null): void {
    this.snapshot = snapshot;
  }

  direction(): { x: number; y: number } {
    const axes = this.snapshot?.axes;
    if (axes === undefined) return { x: 0, y: 0 };

    const rawX = axes[0] ?? 0;
    const rawY = axes[1] ?? 0;
    const magnitude = Math.hypot(rawX, rawY);
    if (magnitude <= this.deadzone) return { x: 0, y: 0 };

    // Same rescale as the touch stick, so the two devices feel the same past the deadzone.
    const scaled = Math.min(1, (magnitude - this.deadzone) / (1 - this.deadzone));
    return { x: (rawX / magnitude) * scaled, y: (rawY / magnitude) * scaled };
  }

  get held(): ButtonMask {
    const buttons = this.snapshot?.buttons;
    if (buttons === undefined) return 0;

    let mask = 0;
    if (buttons[PAD.A]?.pressed === true) mask |= Button.A;
    if (buttons[PAD.B]?.pressed === true) mask |= Button.B;
    if (buttons[PAD.RB]?.pressed === true || buttons[PAD.LB]?.pressed === true)
      mask |= Button.MODIFIER;
    if (buttons[PAD.Y]?.pressed === true) mask |= Button.SWITCH;
    return mask;
  }

  get connected(): boolean {
    return this.snapshot !== null;
  }

  get active(): boolean {
    if (!this.connected) return false;
    const direction = this.direction();
    return this.held !== 0 || direction.x !== 0 || direction.y !== 0;
  }
}

/**
 * Combines the three sources into the one frame the simulation reads, and tracks which device is
 * in use so the touch controls can hide themselves on a desktop (US-2.6).
 *
 * Precedence is last-used-wins rather than a fixed order: a player with a gamepad plugged in who
 * reaches for the screen should get the screen, immediately, with no setting to find.
 */
export class InputRouter {
  private device: InputDevice = 'touch';
  private previous: InputFrame = EMPTY_FRAME;

  constructor(
    readonly touch: TouchInput,
    readonly keyboard: KeyboardInput = new KeyboardInput(),
    readonly gamepad: GamepadInput = new GamepadInput(),
  ) {}

  /** The device that most recently produced input. Display-only. */
  get activeDevice(): InputDevice {
    return this.device;
  }

  /** Whether the on-screen controls should be drawn. */
  get showTouchControls(): boolean {
    return this.device === 'touch';
  }

  /** Produces this step's frame and advances the press/release edges. */
  sample(): InputFrame {
    if (this.touch.active) this.device = 'touch';
    else if (this.gamepad.active) this.device = 'gamepad';
    else if (this.keyboard.active) this.device = 'keyboard';

    let x = 0;
    let y = 0;
    let held = 0;

    switch (this.device) {
      case 'touch':
        x = this.touch.stick.x;
        y = this.touch.stick.y;
        held = this.touch.held;
        break;
      case 'keyboard': {
        const direction = this.keyboard.direction();
        x = direction.x;
        y = direction.y;
        held = this.keyboard.held;
        break;
      }
      case 'gamepad': {
        const direction = this.gamepad.direction();
        x = direction.x;
        y = direction.y;
        held = this.gamepad.held;
        break;
      }
    }

    const frame = makeFrame(x, y, held, this.previous);
    this.previous = frame;
    this.keyboard.clearActivity();
    return frame;
  }

  /** Drops all held state — used when the app backgrounds or a match pauses. */
  releaseAll(): void {
    this.touch.cancelAll();
    this.keyboard.releaseAll();
    this.gamepad.update(null);
    this.previous = EMPTY_FRAME;
  }
}
