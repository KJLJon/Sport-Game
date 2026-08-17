/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.2 — Asset pipeline: authored source → packed atlas → typed accessors
 * @story   US-1.3 — Keep everything inside the repository path
 * @design  13-visual-overhaul.md §3.1 (athlete sheet), §2.1 (buildAtlas)
 *
 * Purpose: gathers every authored pose into the two layer sheets an athlete atlas is built from,
 * and builds it.
 *
 * **Why the merge lives here rather than in each pose file.** Art is delegated one file per pose
 * (`CLAUDE.md` §7.3.3) and two agents writing the same file lose each other's work. A pose file
 * exports its own sheets and nothing else; this module — main-session owned — is the only place
 * that knows the full set, so adding a pose is one import and one array entry.
 */
import {
  buildAtlas,
  type SpriteAtlas,
  type SpriteGrid,
  type SpriteSheet,
} from '../../engine/render/atlas.ts';
import type { OffscreenFactory } from '../../engine/render/renderer.ts';
import { IDLE_BODY, IDLE_KIT } from './idle.ts';
import { ATHLETE_BODY_PALETTE, kitPalette } from './palette.ts';

/** Later poses (run, kick, throw, …) land beside `idle` here as T-13.3 and T-13.7 author them. */
const BODY_SHEETS: readonly SpriteSheet[] = [IDLE_BODY];
const KIT_SHEETS: readonly SpriteSheet[] = [IDLE_KIT];

/** Merges pose sheets into one. A key authored twice is an authoring bug, so it throws. */
export function mergeSheets(sheets: readonly SpriteSheet[]): SpriteSheet {
  const merged: Record<string, readonly SpriteGrid[]> = {};
  for (const sheet of sheets) {
    for (const [key, frames] of Object.entries(sheet)) {
      if (key in merged) throw new Error(`athlete art: '${key}' is authored in two pose files`);
      merged[key] = frames;
    }
  }
  return merged;
}

export const ATHLETE_BODY: SpriteSheet = mergeSheets(BODY_SHEETS);
export const ATHLETE_KIT: SpriteSheet = mergeSheets(KIT_SHEETS);

export interface AthleteKit {
  readonly fill: string;
  readonly onFill: string;
}

/**
 * One team's fully baked athlete atlas. Built once per (kit × theme) at match load — never per
 * frame, and never per athlete (`13` §2.2).
 */
export function buildAthleteAtlas(kit: AthleteKit, createOffscreen: OffscreenFactory): SpriteAtlas {
  return buildAtlas(
    { body: ATHLETE_BODY, kit: ATHLETE_KIT },
    { body: ATHLETE_BODY_PALETTE, kit: kitPalette(kit.fill, kit.onFill) },
    createOffscreen,
  );
}
