/**
 * @spec    001-initial-dev
 * @phase   4 — Arcade framework + basketball arcade set
 * @task    T-4.1 — Arcade framework: `ArcadeGameDef`, host, session lifecycle, scoring, star ratings
 * @story   US-16.1 — Play a quick skill game
 * @design  09-modes-and-arcade.md §3.3 (score, stars, personal bests)
 *
 * Purpose: the star rating and the small vocabulary around it. Separate from the run so that a hub
 * tile, a party-round table, and a post-run screen can all compute stars from a stored score without
 * mounting anything.
 *
 * Thresholds are per game and ascending; a score at a threshold earns that star, which is the
 * reading a player expects when the screen said "1,200 for three stars" and they finished on 1,200.
 */
import type { ArcadeGameDef, StarCount } from './types.ts';

/** Stars for a score against ascending thresholds. */
export function starsFor(score: number, thresholds: readonly [number, number, number]): StarCount {
  if (score >= thresholds[2]) return 3;
  if (score >= thresholds[1]) return 2;
  if (score >= thresholds[0]) return 1;
  return 0;
}

/** Points still needed for the next star, or `null` once all three are earned. */
export function toNextStar(
  score: number,
  thresholds: readonly [number, number, number],
): number | null {
  for (const threshold of thresholds) {
    if (score < threshold) return threshold - score;
  }
  return null;
}

/** The score the next star needs, or `null` at three stars. Used by the "target" caption. */
export function nextStarTarget(
  score: number,
  thresholds: readonly [number, number, number],
): number | null {
  for (const threshold of thresholds) {
    if (score < threshold) return threshold;
  }
  return null;
}

/** Progress towards the next star, `0–1`. Full at three stars, so a meter reads as complete. */
export function starProgress(score: number, thresholds: readonly [number, number, number]): number {
  const stars = starsFor(score, thresholds);
  if (stars === 3) return 1;
  // `starsFor` returning `stars` means `thresholds[stars - 1] <= score < thresholds[stars]`, so the
  // band is always non-empty and there is no divide-by-zero to guard against.
  const from = stars === 0 ? 0 : (thresholds[stars - 1] ?? 0);
  const to = thresholds[stars] ?? 1;
  return Math.min(1, Math.max(0, (score - from) / (to - from)));
}

/**
 * Accuracy as a percentage, `0–100`. Zero attempts reads as zero rather than as a divide-by-zero or
 * a misleading 100%.
 */
export function accuracy(made: number, attempts: number): number {
  return attempts <= 0 ? 0 : (made / attempts) * 100;
}

/**
 * The wording for an attempt's quality, `0–1`. Text rather than colour, so the feedback survives
 * a colour-blind player and a greyscale screenshot alike (T-4.12, `10` §6).
 */
export function qualityLabel(quality: number): string {
  if (quality >= 0.92) return 'Perfect';
  if (quality >= 0.72) return 'Great';
  if (quality >= 0.45) return 'Good';
  if (quality > 0) return 'Off';
  return 'Missed';
}

/** A game's star line for a tile: "800 · 1,400 · 2,000". */
export function starLine(game: ArcadeGameDef): string {
  return game.stars.map((value) => value.toLocaleString('en-GB')).join(' · ');
}
