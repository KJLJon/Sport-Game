/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.9 — Input layer
 * @story   US-2.1, US-2.6
 * @design  06-game-design.md §2, 10-ui-ux.md §11
 *
 * Purpose: the stick's feel rules (floating origin, deadzone rescale, origin drag), handedness
 * mirroring, the keyboard and gamepad mappings, and the router's last-used-device precedence.
 */
import { describe, expect, it } from 'vitest';
import {
  Button,
  EMPTY_FRAME,
  framesEqual,
  isHeld,
  magnitude,
  makeFrame,
  wasPressed,
  wasReleased,
} from '@/engine/input/types.ts';
import {
  DEFAULT_LAYOUT,
  buttonAt,
  createStick,
  defaultButtons,
  meetsTouchTargets,
  stickDown,
  stickMove,
  stickUp,
  stickVisual,
  zoneFor,
  type ControlLayout,
} from '@/engine/input/joystick.ts';
import {
  GamepadInput,
  InputRouter,
  KeyboardInput,
  TouchInput,
  type GamepadSnapshot,
} from '@/engine/input/sources.ts';

function layout(overrides: Partial<ControlLayout> = {}): ControlLayout {
  return { width: 800, height: 400, ...DEFAULT_LAYOUT, ...overrides };
}

describe('InputFrame', () => {
  it('derives press and release edges from the previous frame', () => {
    const first = makeFrame(0, 0, Button.A);
    expect(wasPressed(first, Button.A)).toBe(true);
    expect(isHeld(first, Button.A)).toBe(true);

    const second = makeFrame(0, 0, Button.A, first);
    expect(wasPressed(second, Button.A)).toBe(false);
    expect(isHeld(second, Button.A)).toBe(true);

    const third = makeFrame(0, 0, 0, second);
    expect(wasReleased(third, Button.A)).toBe(true);
    expect(isHeld(third, Button.A)).toBe(false);
  });

  it('tracks several buttons independently', () => {
    const held = makeFrame(0, 0, Button.A | Button.MODIFIER);
    const next = makeFrame(0, 0, Button.B | Button.MODIFIER, held);

    expect(wasReleased(next, Button.A)).toBe(true);
    expect(wasPressed(next, Button.B)).toBe(true);
    expect(isHeld(next, Button.MODIFIER)).toBe(true);
    expect(wasPressed(next, Button.MODIFIER)).toBe(false);
  });

  it('reports stick magnitude', () => {
    expect(magnitude(makeFrame(0.6, 0.8, 0))).toBeCloseTo(1, 6);
    expect(magnitude(EMPTY_FRAME)).toBe(0);
  });

  it('compares frames by what the simulation can see', () => {
    expect(framesEqual(makeFrame(0.5, 0, Button.A), makeFrame(0.5, 0, Button.A))).toBe(true);
    expect(framesEqual(makeFrame(0.5, 0, Button.A), makeFrame(0.5, 0, Button.B))).toBe(false);
  });
});

describe('floating joystick', () => {
  it('originates wherever the thumb lands', () => {
    const stick = createStick();
    expect(stickDown(stick, layout(), 1, 120, 300)).toBe(true);

    expect(stick.originX).toBe(120);
    expect(stick.originY).toBe(300);
    expect(stick.x).toBe(0);
  });

  it('ignores a touch in the button half', () => {
    const stick = createStick();
    expect(stickDown(stick, layout(), 1, 700, 300)).toBe(false);
    expect(stick.pointerId).toBeNull();
  });

  it('ignores a second thumb once it has one', () => {
    const stick = createStick();
    stickDown(stick, layout(), 1, 100, 300);
    expect(stickDown(stick, layout(), 2, 200, 300)).toBe(false);
    expect(stick.pointerId).toBe(1);
  });

  it('produces a direction with analog magnitude', () => {
    const stick = createStick();
    const l = layout();
    stickDown(stick, l, 1, 100, 300);
    stickMove(stick, l, 1, 100 + l.radius, 300);

    expect(stick.x).toBeCloseTo(1, 6);
    expect(stick.y).toBeCloseTo(0, 6);

    stickMove(stick, l, 1, 100 + l.radius / 2, 300);
    expect(stick.x).toBeGreaterThan(0.2);
    expect(stick.x).toBeLessThan(1);
  });

  it('supports 360° movement', () => {
    const l = layout();
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const stick = createStick();
      stickDown(stick, l, 1, 200, 200);
      stickMove(stick, l, 1, 200 + Math.cos(angle) * l.radius, 200 + Math.sin(angle) * l.radius);

      expect(Math.atan2(stick.y, stick.x)).toBeCloseTo(
        Math.atan2(Math.sin(angle), Math.cos(angle)),
        5,
      );
      expect(Math.hypot(stick.x, stick.y)).toBeCloseTo(1, 5);
    }
  });

  it('never exceeds full deflection', () => {
    const stick = createStick();
    const l = layout();
    stickDown(stick, l, 1, 100, 300);
    stickMove(stick, l, 1, 100 + l.radius * 10, 300);

    expect(Math.hypot(stick.x, stick.y)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('ignores a resting thumb inside the deadzone', () => {
    const stick = createStick();
    const l = layout();
    stickDown(stick, l, 1, 100, 300);
    stickMove(stick, l, 1, 100 + l.radius * l.deadzone * 0.9, 300);

    expect(stick.x).toBe(0);
    expect(stick.y).toBe(0);
  });

  it('rescales past the deadzone instead of stepping to it', () => {
    const stick = createStick();
    const l = layout();
    stickDown(stick, l, 1, 100, 300);
    stickMove(stick, l, 1, 100 + l.radius * (l.deadzone + 0.01), 300);

    expect(stick.x).toBeGreaterThan(0);
    expect(stick.x).toBeLessThan(0.05);
  });

  it('drags its origin along past full deflection, so a wandering thumb keeps control', () => {
    const stick = createStick();
    const l = layout();
    stickDown(stick, l, 1, 100, 300);
    stickMove(stick, l, 1, 300, 300);

    expect(stick.originX).toBeCloseTo(300 - l.radius, 6);
    expect(stick.x).toBeCloseTo(1, 6);

    // Coming back a little now reduces the deflection, rather than doing nothing.
    stickMove(stick, l, 1, 300 - l.radius / 2, 300);
    expect(stick.x).toBeLessThan(1);
    expect(stick.x).toBeGreaterThan(0);
  });

  it('centres and releases on lift', () => {
    const stick = createStick();
    const l = layout();
    stickDown(stick, l, 1, 100, 300);
    stickMove(stick, l, 1, 160, 300);
    stickUp(stick, 1);

    expect(stick.pointerId).toBeNull();
    expect(stick.x).toBe(0);
  });

  it('ignores moves and lifts from other pointers', () => {
    const stick = createStick();
    const l = layout();
    stickDown(stick, l, 1, 100, 300);
    stickMove(stick, l, 2, 400, 300);
    expect(stick.x).toBe(0);

    stickUp(stick, 2);
    expect(stick.pointerId).toBe(1);
  });

  it('reports where to draw itself', () => {
    const stick = createStick();
    const l = layout();
    expect(stickVisual(stick, l).visible).toBe(false);

    stickDown(stick, l, 1, 100, 300);
    stickMove(stick, l, 1, 100 + l.radius, 300);
    const visual = stickVisual(stick, l);

    expect(visual.visible).toBe(true);
    expect(visual.originX).toBe(100);
    expect(visual.thumbX).toBeCloseTo(100 + l.radius, 6);
  });
});

describe('handedness', () => {
  it('mirrors which half drives the stick', () => {
    expect(zoneFor(layout(), 100)).toBe('stick');
    expect(zoneFor(layout(), 700)).toBe('buttons');

    expect(zoneFor(layout({ leftHanded: true }), 100)).toBe('buttons');
    expect(zoneFor(layout({ leftHanded: true }), 700)).toBe('stick');
  });

  it('mirrors the button cluster to the other edge', () => {
    const right = defaultButtons(layout());
    const left = defaultButtons(layout({ leftHanded: true }));

    for (const [index, button] of right.entries()) {
      const mirrored = left[index] as (typeof left)[number];
      expect(mirrored.x).toBeCloseTo(800 - button.x, 6);
      expect(mirrored.y).toBe(button.y);
      expect(mirrored.radius).toBe(button.radius);
    }
  });

  it('keeps every touch target at or above 44 px', () => {
    expect(meetsTouchTargets(defaultButtons(layout()))).toBe(true);
    expect(meetsTouchTargets(defaultButtons(layout({ leftHanded: true })))).toBe(true);
  });

  it('finds the button under a touch, nearest first', () => {
    const buttons = defaultButtons(layout());
    const primary = buttons[0] as (typeof buttons)[number];

    expect(buttonAt(buttons, primary.x, primary.y)?.id).toBe(primary.id);
    expect(buttonAt(buttons, 400, 200)).toBeNull();
  });
});

describe('TouchInput', () => {
  function touch(leftHanded = false) {
    const l = layout({ leftHanded });
    return new TouchInput(l, defaultButtons(l));
  }

  it('drives stick and buttons at the same time', () => {
    const input = touch();
    const buttons = defaultButtons(layout());
    const primary = buttons[0] as (typeof buttons)[number];

    input.pointerDown(1, 100, 300);
    input.pointerMove(1, 156, 300);
    input.pointerDown(2, primary.x, primary.y);

    expect(input.stick.x).toBeCloseTo(1, 6);
    expect(input.held & Button.A).toBe(Button.A);
  });

  it('holds several buttons at once and releases them independently', () => {
    const input = touch();
    const buttons = defaultButtons(layout());
    const a = buttons[0] as (typeof buttons)[number];
    const modifier = buttons[2] as (typeof buttons)[number];

    input.pointerDown(1, a.x, a.y);
    input.pointerDown(2, modifier.x, modifier.y);
    expect(input.held).toBe(Button.A | Button.MODIFIER);

    input.pointerUp(1);
    expect(input.held).toBe(Button.MODIFIER);
  });

  it('ignores a touch on empty space in the button half', () => {
    const input = touch();
    input.pointerDown(1, 500, 60);
    expect(input.held).toBe(0);
  });

  it('drops everything on a cancelled gesture', () => {
    const input = touch();
    const primary = defaultButtons(layout())[0] as ReturnType<typeof defaultButtons>[number];

    input.pointerDown(1, 100, 300);
    input.pointerDown(2, primary.x, primary.y);
    input.cancelAll();

    expect(input.held).toBe(0);
    expect(input.active).toBe(false);
  });

  it('drops in-flight touches when handedness flips mid-match', () => {
    const input = touch();
    input.pointerDown(1, 100, 300);

    const mirrored = layout({ leftHanded: true });
    input.setLayout(mirrored, defaultButtons(mirrored));

    expect(input.active).toBe(false);
    input.pointerDown(2, 700, 300);
    expect(input.stick.pointerId).toBe(2);
  });
});

describe('KeyboardInput', () => {
  it('maps WASD and the arrows to the same directions', () => {
    const wasd = new KeyboardInput();
    wasd.keyDown('KeyD');
    const arrows = new KeyboardInput();
    arrows.keyDown('ArrowRight');

    expect(wasd.direction()).toEqual(arrows.direction());
    expect(wasd.direction().x).toBe(1);
  });

  it('normalises diagonals, so two keys are not faster than one', () => {
    const keyboard = new KeyboardInput();
    keyboard.keyDown('KeyW');
    keyboard.keyDown('KeyD');

    const direction = keyboard.direction();
    expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1, 6);
  });

  it('cancels opposite keys', () => {
    const keyboard = new KeyboardInput();
    keyboard.keyDown('KeyA');
    keyboard.keyDown('KeyD');
    expect(keyboard.direction()).toEqual({ x: 0, y: 0 });
  });

  it('maps the action keys', () => {
    const keyboard = new KeyboardInput();
    keyboard.keyDown('Space');
    keyboard.keyDown('ShiftLeft');

    expect(keyboard.held).toBe(Button.A | Button.MODIFIER);
    keyboard.keyUp('Space');
    expect(keyboard.held).toBe(Button.MODIFIER);
  });

  it('ignores unmapped keys', () => {
    const keyboard = new KeyboardInput();
    keyboard.keyDown('KeyZ');
    expect(keyboard.held).toBe(0);
    expect(keyboard.direction()).toEqual({ x: 0, y: 0 });
  });

  it('releases everything when the window loses focus', () => {
    const keyboard = new KeyboardInput();
    keyboard.keyDown('KeyW');
    keyboard.keyDown('Space');
    keyboard.releaseAll();

    expect(keyboard.held).toBe(0);
    expect(keyboard.direction()).toEqual({ x: 0, y: 0 });
  });
});

describe('GamepadInput', () => {
  const pad = (axes: number[], pressed: number[] = []): GamepadSnapshot => ({
    axes,
    buttons: Array.from({ length: 8 }, (_, i) => ({ pressed: pressed.includes(i) })),
  });

  it('reports nothing when none is connected', () => {
    const gamepad = new GamepadInput();
    expect(gamepad.connected).toBe(false);
    expect(gamepad.direction()).toEqual({ x: 0, y: 0 });
    expect(gamepad.held).toBe(0);
  });

  it('reads the left stick past its deadzone', () => {
    const gamepad = new GamepadInput(0.2);
    gamepad.update(pad([1, 0]));

    expect(gamepad.direction().x).toBeCloseTo(1, 6);
    gamepad.update(pad([0.1, 0]));
    expect(gamepad.direction()).toEqual({ x: 0, y: 0 });
  });

  it('maps face and shoulder buttons', () => {
    const gamepad = new GamepadInput();
    gamepad.update(pad([0, 0], [0, 5]));
    expect(gamepad.held).toBe(Button.A | Button.MODIFIER);
  });

  it('is inactive while resting, active on any input', () => {
    const gamepad = new GamepadInput();
    gamepad.update(pad([0, 0]));
    expect(gamepad.active).toBe(false);

    gamepad.update(pad([0.9, 0]));
    expect(gamepad.active).toBe(true);
  });
});

describe('InputRouter', () => {
  function router(leftHanded = false) {
    const l = layout({ leftHanded });
    return new InputRouter(new TouchInput(l, defaultButtons(l)));
  }

  it('produces an empty frame when nothing is happening', () => {
    expect(framesEqual(router().sample(), EMPTY_FRAME)).toBe(true);
  });

  it('routes touch input through to the frame', () => {
    const r = router();
    r.touch.pointerDown(1, 100, 300);
    r.touch.pointerMove(1, 156, 300);

    const frame = r.sample();
    expect(frame.moveX).toBeCloseTo(1, 6);
    expect(r.activeDevice).toBe('touch');
  });

  it('switches to the keyboard and hides the touch controls', () => {
    const r = router();
    r.keyboard.keyDown('KeyD');

    const frame = r.sample();
    expect(frame.moveX).toBe(1);
    expect(r.activeDevice).toBe('keyboard');
    expect(r.showTouchControls).toBe(false);
  });

  it('hands straight back to touch on the next tap', () => {
    const r = router();
    r.keyboard.keyDown('KeyD');
    r.sample();

    r.keyboard.keyUp('KeyD');
    r.touch.pointerDown(1, 100, 300);
    r.sample();

    expect(r.activeDevice).toBe('touch');
    expect(r.showTouchControls).toBe(true);
  });

  it('prefers the gamepad over an idle keyboard', () => {
    const r = router();
    r.gamepad.update({ axes: [0, -1], buttons: [{ pressed: false }] });

    const frame = r.sample();
    expect(r.activeDevice).toBe('gamepad');
    expect(frame.moveY).toBeCloseTo(-1, 6);
  });

  it('carries press and release edges across samples', () => {
    const r = router();
    r.keyboard.keyDown('Space');
    expect(wasPressed(r.sample(), Button.A)).toBe(true);
    expect(wasPressed(r.sample(), Button.A)).toBe(false);

    r.keyboard.keyUp('Space');
    expect(wasReleased(r.sample(), Button.A)).toBe(true);
  });

  it('releases everything on demand', () => {
    const r = router();
    r.keyboard.keyDown('Space');
    r.touch.pointerDown(1, 100, 300);
    r.releaseAll();

    expect(framesEqual(r.sample(), EMPTY_FRAME)).toBe(true);
  });
});
