/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.12 — Arcade accessibility: left-hand mirroring, colour-independent meters, reduced motion
 * @story   US-13.2 — Play comfortably regardless of ability
 * @design  10-ui-ux.md §11 (accessibility), §3.3 (motion tokens), 09-modes-and-arcade.md §3.1
 *
 * Purpose: the three accessibility settings an arcade run actually reads, resolved in one place —
 * which hand the layout is built for, whether motion should be reduced, and the outcome feedback
 * that replaces a flash when it should.
 *
 * **Reduced motion is not "slow the game down".** The marker's movement *is* the game; removing it
 * would remove the thing being played. What reduced motion removes is everything that moves and is
 * not the mechanic — here, the outcome banner's slide and fade, which becomes a static panel saying
 * exactly the same words. Same information, no motion, no loss.
 *
 * **Mirroring is presentation only.** It flips where things are drawn and nothing about when they
 * may be pressed, so a left-handed run and a right-handed one are the same run. The whole stage is
 * the button anyway (T-4.3), so there is no target that moves out from under a thumb.
 */
import type { Canvas2D } from '../../engine/render/renderer.ts';
import { prefs } from '../../storage/prefs.ts';
import type { ArcadeLayout, ArcadeOutcome } from './types.ts';

/**
 * The motion preference moved to `app/motion.ts` in T-12.7, when the camera needed the same answer
 * and two copies of the resolution rule would have been two chances to disagree. Re-exported rather
 * than moved outright: every arcade game imports it from here.
 */
export { REDUCED_MOTION_KEY, applyMotionPreference, reducedMotion } from '../../app/motion.ts';
import { reducedMotion } from '../../app/motion.ts';

/** Preference keys, shared with Settings. Read here, never written. */
export const LEFT_HANDED_KEY = 'controls.leftHanded';

/** How long an outcome banner stays up, in seconds. */
export const FEEDBACK_SECONDS = 0.9;

export function leftHanded(): boolean {
  return prefs.get<boolean>(LEFT_HANDED_KEY, false);
}

/** The layout an arcade run draws into, before the canvas has been measured. */
export function arcadeLayout(view: Window | null | undefined): ArcadeLayout {
  return { width: 1, height: 1, mirror: leftHanded(), reducedMotion: reducedMotion(view) };
}

export interface FeedbackState {
  readonly outcome: ArcadeOutcome;
  /** Seconds since the outcome landed. */
  readonly age: number;
}

/**
 * The outcome banner. Text always, in a panel that is outlined as well as filled and marked with a
 * check or a cross, so it reads with no colour at all (`CLAUDE.md` §8.11). Under reduced motion it simply
 * appears and disappears; otherwise it rises and fades.
 */
export function drawOutcomeFeedback(
  ctx: Canvas2D,
  layout: ArcadeLayout,
  state: FeedbackState | null,
): void {
  if (state === null || state.age > FEEDBACK_SECONDS) return;

  const progress = state.age / FEEDBACK_SECONDS;
  const rise = layout.reducedMotion ? 0 : progress * layout.height * 0.05;
  const alpha = layout.reducedMotion ? 1 : Math.max(0, 1 - progress);

  const width = Math.min(layout.width * 0.8, 320);
  const height = 44;
  const x = (layout.width - width) / 2;
  const y = layout.height * 0.32 - rise;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.fillStyle = '#141a21';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = state.outcome.made ? '#7fd4a4' : '#e08a76';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);

  // The mark is the non-colour channel: a tick or a cross, drawn as strokes.
  const markX = x + 22;
  const markY = y + height / 2;
  ctx.beginPath();
  if (state.outcome.made) {
    ctx.moveTo(markX - 8, markY);
    ctx.lineTo(markX - 2, markY + 6);
    ctx.lineTo(markX + 8, markY - 7);
  } else {
    ctx.moveTo(markX - 7, markY - 7);
    ctx.lineTo(markX + 7, markY + 7);
    ctx.moveTo(markX + 7, markY - 7);
    ctx.lineTo(markX - 7, markY + 7);
  }
  ctx.stroke();

  ctx.fillStyle = '#f4f1ea';
  ctx.font = '18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(state.outcome.label, x + width / 2 + 12, markY + 6);

  ctx.restore();
}
