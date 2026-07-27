/**
 * @spec    001-initial-dev
 * @phase   1 — Engine core
 * @task    T-1.9 — Input layer: floating joystick, context buttons, handedness mirror
 * @story   US-2.1 — Control my athlete with a virtual joystick
 * @design  06-game-design.md §2 (controls), 10-ui-ux.md §7 (touch targets)
 *
 * Purpose: the left thumb. The stick originates wherever the thumb lands rather than at a fixed
 * spot, because a fixed stick means the player must find it without looking — and on a phone held
 * in landscape, "without looking" is the only mode there is.
 *
 * Pure geometry over pointer events, with no DOM: the layout knows about a screen rectangle and
 * pointer ids, and produces a direction. That keeps every rule here testable without a browser and
 * lets the same code drive an arcade mini-game (`09` §2) with no changes.
 */

export interface ControlLayout {
  /** Viewport size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Left-handed players get the whole layout mirrored (US-2.1, `10` §11). */
  readonly leftHanded: boolean;
  /** Stick travel from origin to full deflection, in CSS pixels. */
  readonly radius: number;
  /** Fraction of the radius treated as zero, so resting thumbs do not drift. */
  readonly deadzone: number;
}

export const DEFAULT_LAYOUT: Omit<ControlLayout, 'width' | 'height'> = {
  leftHanded: false,
  radius: 56,
  deadzone: 0.18,
};

/** Which half of the screen a pointer belongs to, after handedness is applied. */
export type ControlZone = 'stick' | 'buttons';

export function zoneFor(layout: ControlLayout, screenX: number): ControlZone {
  const onLeft = screenX < layout.width / 2;
  return onLeft !== layout.leftHanded ? 'stick' : 'buttons';
}

export interface StickState {
  /** The pointer currently driving the stick, or `null`. */
  pointerId: number | null;
  /** Where the thumb landed — the stick's origin this touch. */
  originX: number;
  originY: number;
  /** Current thumb position. */
  currentX: number;
  currentY: number;
  /** Output direction, deadzoned and clamped to the unit circle. */
  x: number;
  y: number;
}

export function createStick(): StickState {
  return { pointerId: null, originX: 0, originY: 0, currentX: 0, currentY: 0, x: 0, y: 0 };
}

/**
 * A thumb landed. Claims the stick if the touch is in the stick half and nothing else holds it.
 * Returns whether the stick took this pointer, so the caller can offer it to the buttons instead.
 */
export function stickDown(
  stick: StickState,
  layout: ControlLayout,
  pointerId: number,
  x: number,
  y: number,
): boolean {
  if (stick.pointerId !== null) return false;
  if (zoneFor(layout, x) !== 'stick') return false;

  stick.pointerId = pointerId;
  stick.originX = x;
  stick.originY = y;
  stick.currentX = x;
  stick.currentY = y;
  stick.x = 0;
  stick.y = 0;
  return true;
}

/**
 * The thumb moved. Beyond full deflection the origin is dragged along, so a thumb that wanders
 * during a long sprint keeps full control instead of pinning against an invisible wall — the
 * single most-noticed difference between a virtual stick that feels good and one that does not.
 */
export function stickMove(
  stick: StickState,
  layout: ControlLayout,
  pointerId: number,
  x: number,
  y: number,
): void {
  if (stick.pointerId !== pointerId) return;

  stick.currentX = x;
  stick.currentY = y;

  let dx = x - stick.originX;
  let dy = y - stick.originY;
  const distance = Math.hypot(dx, dy);

  if (distance > layout.radius && distance > 0) {
    const pull = distance - layout.radius;
    stick.originX += (dx / distance) * pull;
    stick.originY += (dy / distance) * pull;
    dx = (dx / distance) * layout.radius;
    dy = (dy / distance) * layout.radius;
  }

  applyDeflection(stick, layout, dx, dy);
}

/** The thumb lifted. Releases the stick and centres it. */
export function stickUp(stick: StickState, pointerId: number): void {
  if (stick.pointerId !== pointerId) return;
  stick.pointerId = null;
  stick.x = 0;
  stick.y = 0;
}

function applyDeflection(stick: StickState, layout: ControlLayout, dx: number, dy: number): void {
  const distance = Math.hypot(dx, dy);
  const normalised = distance / layout.radius;

  if (normalised <= layout.deadzone || distance === 0) {
    stick.x = 0;
    stick.y = 0;
    return;
  }

  // Rescale past the deadzone so the first responsive pixel means "barely moving" rather than
  // jumping straight to 18% speed. Without this, analog control has a visible step at the edge.
  const scaled = Math.min(1, (normalised - layout.deadzone) / (1 - layout.deadzone));
  stick.x = (dx / distance) * scaled;
  stick.y = (dy / distance) * scaled;
}

/** Where the on-screen stick should be drawn: origin, thumb position, and deflection. */
export interface StickVisual {
  readonly visible: boolean;
  readonly originX: number;
  readonly originY: number;
  readonly thumbX: number;
  readonly thumbY: number;
}

export function stickVisual(stick: StickState, layout: ControlLayout): StickVisual {
  const dx = stick.x * layout.radius;
  const dy = stick.y * layout.radius;
  return {
    visible: stick.pointerId !== null,
    originX: stick.originX,
    originY: stick.originY,
    thumbX: stick.originX + dx,
    thumbY: stick.originY + dy,
  };
}

/** A round on-screen button. Positions are computed, so handedness mirrors them for free. */
export interface ButtonSpec {
  readonly id: number;
  /** Centre, in CSS pixels, before mirroring. */
  readonly x: number;
  readonly y: number;
  /** Radius in CSS pixels. `10` §11 requires a ≥44 px touch target, so ≥22 here. */
  readonly radius: number;
}

/**
 * Default right-thumb cluster: two primary buttons and the modifier (`06` §2). Laid out relative
 * to the viewport, then mirrored for left-handed players — one code path, not two layouts.
 */
export function defaultButtons(layout: ControlLayout): ButtonSpec[] {
  const edge = layout.leftHanded ? 0 : layout.width;
  const sign = layout.leftHanded ? 1 : -1;
  const bottom = layout.height;

  const at = (dx: number, dy: number, radius: number, id: number): ButtonSpec => ({
    id,
    x: edge + sign * dx,
    y: bottom - dy,
    radius,
  });

  return [
    at(90, 90, 38, 1), // A — primary
    at(170, 150, 34, 2), // B — secondary
    at(70, 190, 30, 3), // modifier
  ];
}

/** The button under a point, or `null`. Nearest wins where targets overlap. */
export function buttonAt(buttons: readonly ButtonSpec[], x: number, y: number): ButtonSpec | null {
  let best: ButtonSpec | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const button of buttons) {
    const distance = Math.hypot(button.x - x, button.y - y);
    if (distance <= button.radius && distance < bestDistance) {
      best = button;
      bestDistance = distance;
    }
  }

  return best;
}

/** Verifies every button meets the 44 px minimum touch target from `10` §11 / INV-11. */
export function meetsTouchTargets(buttons: readonly ButtonSpec[]): boolean {
  return buttons.every((button) => button.radius * 2 >= 44);
}
