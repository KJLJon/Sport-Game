/**
 * @spec    001-initial-dev
 * @phase   12 — Camera, framing, and readability
 * @task    T-12.7 — Reduced-motion and accessibility pass: no camera motion a player cannot turn off
 * @task    T-4.12 — Arcade accessibility: reduced motion (the resolution rule this file inherited)
 * @story   US-13.4 — Turn off motion that makes me unwell
 * @design  10-ui-ux.md §6 (reduced motion), §11 (accessibility), 12-quality-and-testing.md §3
 *
 * Purpose: resolves the motion preferences, for everything that moves. One rule, one place — the
 * arcade asked the same question from `modes/arcade/accessibility.ts` since T-4.12, and once the
 * camera needed the answer too, two implementations of "does this player want motion" would have
 * been two chances to disagree.
 *
 * **Why the camera gets its own setting.** Global reduced motion is a blunt yes/no, and the camera
 * is the one thing in the app where "no motion" has a real cost: with the camera fixed, a 105 × 68
 * pitch puts an athlete at about three pixels (`01` R2), which is the problem Phase 12 exists to
 * solve. So there are three levels rather than two, and the honest, uncomfortable one is available:
 *
 * - `full` — everything: lookahead, dynamic zoom by phase, handoff pans, shake.
 * - `reduced` — the camera still follows, at one fixed zoom, with a wide deadzone. No lookahead, no
 *   zoom changes, no shake. This is what global reduced motion selects.
 * - `fixed` — the camera does not move at all. The whole field, all the time, athletes as dots.
 *
 * `fixed` is worse to play and it is nobody's business but the player's whether they want it. An
 * accessibility setting that stops short of the option the player actually needs is not one.
 */
import { CAMERA_MOTIONS, type CameraMotion } from '../engine/render/framing.ts';
import { prefs } from '../storage/prefs.ts';

export { CAMERA_MOTIONS, type CameraMotion };

/** Preference keys, shared with Settings. */
export const REDUCED_MOTION_KEY = 'display.reducedMotion';
export const CAMERA_MOTION_KEY = 'display.cameraMotion';

function isCameraMotion(value: unknown): value is CameraMotion {
  return CAMERA_MOTIONS.includes(value as CameraMotion);
}

/**
 * Whether motion should be reduced: the app's own setting, or the operating system's, whichever
 * asks for it. The OS is honoured without the player having to find a setting, and the app's
 * setting can turn it on where the OS has not.
 */
export function reducedMotion(view: Window | null | undefined): boolean {
  if (prefs.get<boolean>(REDUCED_MOTION_KEY, false)) return true;
  try {
    return view?.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    // `matchMedia` is missing in jsdom and in a few embedded webviews. Not a reason to fail a run.
    return false;
  }
}

/**
 * How much the camera may move. An explicit choice wins; otherwise it follows the global reduced
 * motion answer, so a player who set the OS preference gets a calm camera without ever opening
 * Settings.
 */
export function cameraMotion(view: Window | null | undefined): CameraMotion {
  const stored = prefs.get<CameraMotion | null>(CAMERA_MOTION_KEY, null, isCameraMotionOrNull);
  if (stored !== null) return stored;
  return reducedMotion(view) ? 'reduced' : 'full';
}

function isCameraMotionOrNull(value: unknown): value is CameraMotion | null {
  return value === null || isCameraMotion(value);
}

/**
 * Puts the motion preference on the document root, so `tokens.css`'s `[data-motion='reduced']`
 * switch stops being inert and every transition in the app respects it.
 */
export function applyMotionPreference(doc: Document, view: Window | null | undefined): void {
  const root = doc.documentElement;
  if (reducedMotion(view)) root.setAttribute('data-motion', 'reduced');
  else root.removeAttribute('data-motion');
}
