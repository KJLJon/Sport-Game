/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §3.1 (athlete sheet), src/art/README.md (authoring format)
 * @invariant INV-4 (art is in-repo data, never a fetch)
 *
 * Purpose: the `run` pose, all five authored facings (0/1/2/6/7), six frames each — a full,
 * seamlessly-looping run cycle, sharing `idle.ts`'s head *and* torso so the running athlete is
 * visibly the same body as the standing one, not a second character.
 *
 * **How this file is built.** The head is composed from a shared hair cap and a per-facing
 * skin-window recolour of `idle.ts`'s face (unchanged from the first version of this file). The
 * torso is not generated at all: each facing's own idle torso — shoulders, sleeve stubs, collar,
 * waistband, all 15 rows of it, body layer *and* kit layer — is copied verbatim from `idle.ts`
 * into a constant below and reused for every frame, because a generated rectangle cannot fake the
 * shape a hand-authored one already has. The only things that change between poses are (1) a 1px
 * vertical bob (the whole head+torso+hip block moves one row for `passing`, one row the other way
 * for `contact`) and (2) the arm rows — on the profile facings (E/NE/SE), idle already fuses a
 * forearm into the torso's own fill on one side (see `idle.ts`'s own header); that authored bump
 * *is* the `contact` pose's forward-swung arm, its own mirror image (`mirrorRowAroundAxis`) is
 * `extension`'s back-swung arm, and a neighbouring bump-free row stands in for `passing`'s neutral
 * mid-swing. S and N have no such fused arm in `idle.ts` (their arms are the symmetric hanging
 * flanks already part of the torso fill), so their torso is fully static across all three poses —
 * an honest limitation, not an oversight; see the report.
 *
 * Legs are untouched by any of this: the same two-segment, knee-offset leg bar as before, planted
 * or lifted, still the moving part of the picture. Frames 3-5 are still produced by mirroring
 * frames 0-2 from the neck down (`mirrorLower`) around the sprite's anchor column (`AXIS = 16`,
 * matching `ATHLETE_FRAME.ax`) — a literal reading of "frames 3-5 are frames 0-2 with the legs and
 * arms swapped" from the task brief, and, because the torso is copied rather than leaned, also the
 * only thing that mirrors the arm.
 */
import {
  poseKey,
  type Facing,
  type SpriteGrid,
  type SpriteSheet,
} from '../../engine/render/atlas.ts';
import { ATHLETE_FRAME } from './idle.ts';

// ---------------------------------------------------------------------------------------------
// Low-level row helpers.
// ---------------------------------------------------------------------------------------------

const WIDTH = 32;
const HEIGHT = 48;
const EMPTY_ROW = '.'.repeat(WIDTH);

/** Builds one 32-char row: `indent` dots, then `content`, padded with dots to width. Only used
 *  for the legs now — the torso is copied, not built. */
function row(indent: number, content: string): string {
  const i = Math.max(0, Math.min(WIDTH, indent));
  const c = content.slice(0, Math.max(0, WIDTH - i));
  return ('.'.repeat(i) + c).padEnd(WIDTH, '.');
}

/** Overlays each non-transparent character of `layers`, in order, onto a blank row set. Later
 *  layers draw on top. Shorter layers simply stop contributing past their own length. */
function mergeRows(...layers: readonly string[][]): string[] {
  const len = Math.max(0, ...layers.map((l) => l.length));
  const out: string[] = [];
  for (let y = 0; y < len; y++) {
    const acc = EMPTY_ROW.split('');
    for (const layer of layers) {
      const lr = layer[y];
      if (lr === undefined) continue;
      for (let x = 0; x < WIDTH; x++) if (lr[x] !== '.') acc[x] = lr[x] as string;
    }
    out.push(acc.join(''));
  }
  return out;
}

/** Pads a row array to exactly `n` rows with transparent rows — a lifted foot's leg bar is
 *  shorter than the band it sits in by design (that shortfall *is* the lift). */
function padTo(rows: readonly string[], n: number): string[] {
  const out = rows.slice();
  while (out.length < n) out.push(EMPTY_ROW);
  return out;
}

/** The sprite's own anchor column (`ATHLETE_FRAME.ax`) — used both as the axis `mirrorLower`
 *  swaps the lower body around for frames 3-5, and as the axis an authored arm bump is mirrored
 *  around to build its opposite-swing counterpart. One constant, two uses, so the two mirrors
 *  agree with each other and with the frame's own anchor. */
const AXIS = 16;

/** Mirrors one row's columns around `axis` (`mx = 2*axis - x`). Columns whose mirror falls
 *  outside the grid are simply dropped (transparent). */
function mirrorRowAroundAxis(r: string, axis: number): string {
  const out = new Array<string>(WIDTH).fill('.');
  for (let x = 0; x < WIDTH; x++) {
    const mx = 2 * axis - x;
    if (mx >= 0 && mx < WIDTH) out[mx] = r[x] as string;
  }
  return out.join('');
}

/** Mirrors every row from `from` to the bottom, left-right around `AXIS` — the mechanism behind
 *  "frames 3-5 are frames 0-2 with the legs and arms swapped" (see the module Purpose). Rows above
 *  `from` (hair, face) are left untouched so the head keeps facing the same way in every frame. */
function mirrorLower(rows: readonly string[], from: number): string[] {
  return rows.map((r, y) => (y < from ? r : mirrorRowAroundAxis(r, AXIS)));
}

// ---------------------------------------------------------------------------------------------
// Head: a hair cap (always hair, every facing) and a face band whose skin/hair split is a
// per-facing column window — narrow and eastward for a profile, empty for the back of the head.
// Lifted verbatim from `idle.ts`'s face so the running athlete has the same head.
// ---------------------------------------------------------------------------------------------

const HAIR_CAP: readonly string[] = [
  '.............55555..............',
  '............5333335.............',
  '...........533333335............',
  '..........53333333335...........',
  '..........53333333335...........',
];

const FACE_TEMPLATE: readonly string[] = [
  '.........5333331333335..........',
  '.........5333111113335..........',
  '.........5331111111335..........',
  '.........5311111111135..........',
  '.........5311111111135..........',
  '..........51111111115...........',
  '..........53122112235...........',
  '...........531111135............',
];

/** Recolours a face-template row's fill characters (anything but `.`/`5`) to skin (`1`) inside
 *  `[skinFrom, skinTo)` and to hair (`3`) outside it — the whole facing-to-facing head variation. */
function faceRow(template: string, skinFrom: number, skinTo: number): string {
  return template
    .split('')
    .map((ch, col) => {
      if (ch === '.' || ch === '5') return ch;
      return col >= skinFrom && col < skinTo ? '1' : '3';
    })
    .join('');
}

// ---------------------------------------------------------------------------------------------
// Torso: copied verbatim from `idle.ts`, per facing — not generated. Each is the 15 rows idle
// authors as its torso (shoulders through waistband), body layer and kit layer, plus idle's own
// neck row. `arm` names the row range (indices into `body`, inclusive) where idle fuses a forearm
// into the torso fill for the profile facings, and which row stands in for it when the pose calls
// for no arm at all (`passing`). S/N have no fused arm in `idle.ts`, hence `arm: null`.
// ---------------------------------------------------------------------------------------------

interface TorsoData {
  readonly neck: string;
  readonly body: readonly string[]; // 15 rows — idle rows 19-33
  readonly kit: readonly string[]; // 15 rows — idle rows 19-33, constant across every pose
  readonly arm: { readonly from: number; readonly to: number; readonly neutralAt: number } | null;
}

const TORSO_EAST: TorsoData = {
  neck: '..........555333235555..........',
  body: [
    '........5222222222222225........',
    '........5222222222222225........',
    '........5222222222222225........',
    '........5222222222222225........',
    '........5222222222222225........',
    '.........52222222222221115......',
    '.........52222222222221115......',
    '.........52222222222221115......',
    '.........52222222222221115......',
    '.........52222222222221115......',
    '..........522222222225..........',
    '..........522222222225..........',
    '..........522222222225..........',
    '..........522222222225..........',
    '..........522222222225..........',
  ],
  kit: [
    '.........PPPPPPkkPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
  ],
  arm: { from: 5, to: 9, neutralAt: 4 },
};

const TORSO_NORTHEAST: TorsoData = {
  neck: '..........555333335555..........',
  body: [
    '.......522222222222222225.......',
    '.......522222222222222225.......',
    '.......522222222222222225.......',
    '.......522222222222222225.......',
    '.......522222222222222225.......',
    '........5222222222222225........',
    '........522222222222222115......',
    '........522222222222222115......',
    '........522222222222222115......',
    '........5222222222222225........',
    '.........52222222222225.........',
    '.........52222222222225.........',
    '.........52222222222225.........',
    '.........52222222222225.........',
    '.........52222222222225.........',
  ],
  kit: [
    '........PPPPPPPkkPPPPPPP........',
    '........PPPPPPPPPPPPPPPP........',
    '........PPPPPPPPPPPPPPPP........',
    '........PPPPPPPPPPPPPPPP........',
    '........PPPPPPPPPPPPPPPP........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
  ],
  arm: { from: 6, to: 8, neutralAt: 5 },
};

const TORSO_NORTH: TorsoData = {
  neck: '..........555333335555..........',
  body: [
    '.......555222222222222555.......',
    '......52222222222222222225......',
    '......52222222222222222225......',
    '......52222222222222222225......',
    '......52222222222222222225......',
    '......52222222222222222225......',
    '......52222222222222222225......',
    '......51115222222222221115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
  ],
  kit: [
    '..........PPPkkkkkkPPP..........',
    '.......PPPPPPPPPPPPPPPPPP.......',
    '.......PPPPPPPPPPPPPPPPPP.......',
    '.......PPPPPPPPPPPPPPPPPP.......',
    '.......PPPPPPPPPPPPPPPPPP.......',
    '.......PPPPPPPPkkPPPPPPPP.......',
    '.......kkkPPPPPkkPPPPPkkk.......',
    '...........PPPPkkPPPPP..........',
    '...........PPPPkkPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
  ],
  arm: null, // idle draws both arms as symmetric hanging flanks here, not a fused swing-able one
};

const TORSO_SOUTH: TorsoData = {
  neck: '..........555332235555..........',
  body: [
    '.......555222222222222555.......',
    '......52222222222222222225......',
    '......52222222222222222225......',
    '......52222222222222222225......',
    '......52222222222222222225......',
    '......52222222222222222225......',
    '......52222222222222222225......',
    '......51115222222222221115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
    '......51115222222222251115......',
  ],
  kit: [
    '..........PPPkkkkkkPPP..........',
    '.......PPPPPPPPPPPPPPPPPP.......',
    '.......PPPPPPPPPPPPPPPPPP.......',
    '.......PPPPPPPPPPPPPPPPPP.......',
    '.......PPPPPPPPPPPPPPPPPP.......',
    '.......PPPPPPPPkkPPPPPPPP.......',
    '.......kkkPPPPPkkPPPPPkkk.......',
    '...........PPPPkkPPPPP..........',
    '...........PPPPkkPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
    '...........PPPPPPPPPP...........',
  ],
  arm: null,
};

const TORSO_SOUTHEAST: TorsoData = {
  neck: '..........555332235555..........',
  body: [
    '.......522222222222222225.......',
    '.......522222222222222225.......',
    '.......522222222222222225.......',
    '.......522222222222222225.......',
    '.......522222222222222225.......',
    '........5222222222222225........',
    '........522222222222222115......',
    '........522222222222222115......',
    '........522222222222222115......',
    '........5222222222222225........',
    '.........52222222222225.........',
    '.........52222222222225.........',
    '.........52222222222225.........',
    '.........52222222222225.........',
    '.........52222222222225.........',
  ],
  kit: [
    '........PPPPPPPkkPPPPPPP........',
    '........PPPPPPPPPPPPPPPP........',
    '........PPPPPPPPPPPPPPPP........',
    '........PPPPPPPPPPPPPPPP........',
    '........PPPPPPPPPPPPPPPP........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '.........PPPPPPPPPPPPPP.........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
    '..........PPPPPPPPPPPP..........',
  ],
  arm: { from: 6, to: 8, neutralAt: 5 },
};

/** `contact` is idle's own authored torso, unmodified — its fused forearm (where one exists) is
 *  already a forward reach. `extension` mirrors just the arm rows around `AXIS`, so the same
 *  authored bump becomes a back-swung arm on the opposite side. `passing` replaces the arm rows
 *  with a neighbouring bump-free row — the neutral, mid-swing torso. S/N (`arm: null`) return the
 *  same static torso for all three; see the module Purpose. */
function torsoBodyFor(pose: Pose, t: TorsoData): readonly string[] {
  if (!t.arm || pose === 'contact') return t.body;
  const { from, to, neutralAt } = t.arm;
  const out = t.body.slice();
  for (let i = from; i <= to; i++) {
    out[i] = pose === 'passing' ? t.body[neutralAt]! : mirrorRowAroundAxis(t.body[i]!, AXIS);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Leg bar: thigh, then a knee, then shin/sock/shoe — two straight segments offset from each
// other at the knee, rather than one constant-width column, so the leg reads as jointed instead
// of a stick. `touchesGround` decides whether the last row is a flat sole (planted) or a raised
// shoe (lifted) — the leg band always ends at the ground row (46); the caller reserves row 47.
// ---------------------------------------------------------------------------------------------

const LEG_SEG = '51115'; // width 5: outline, skin x3, outline
const SOCK_SEG = '56665'; // width 5: outline, sock x3, outline
const SHOE_SEG = '5444445'; // width 7: outline, shoe x5, outline
const SOLE_SEG = '5555555'; // width 7: flat sole/ground-contact line

const LIFT = 4; // px a simple lifted foot clears the ground by (13 §3.1 guidance: 2-5px)
const HIGH_LIFT = 5; // the passing pose's high knee-drive — the top of that range

/** `hipLean`: one-time column shift applied right at the hip (row 1) — the profile facings'
 *  forward thigh angle. `knee`: one-time column shift applied partway down (~45%) — the shin
 *  offsetting from the thigh is what makes this a leg instead of a bar; its sign and size vary
 *  by pose and by which leg (planted/lifted, support/swing, drive/reach) is being drawn. */
function legBar(
  len: number,
  col: number,
  hipLean: number,
  knee: number,
  touchesGround: boolean,
): string[] {
  const out: string[] = [];
  let c = col;
  const kneeAt = Math.max(2, Math.min(len - 2, Math.round(len * 0.45)));
  for (let i = 0; i < len; i++) {
    if (i === 1) c += hipLean;
    if (i === kneeAt) c += knee;
    const fromEnd = len - i;
    let content: string;
    let w: number;
    if (fromEnd === 1) {
      content = touchesGround ? SOLE_SEG : SHOE_SEG;
      w = 7;
    } else if (fromEnd === 2 && touchesGround) {
      content = SHOE_SEG;
      w = 7;
    } else if (fromEnd <= 3) {
      content = SOCK_SEG;
      w = 5;
    } else {
      content = LEG_SEG;
      w = 5;
    }
    out.push(row(w === 7 ? c - 3 : c - 2, content));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Per-facing parameters (legs only now — the torso above needs none) and the row-band layout
// shared by every pose.
// ---------------------------------------------------------------------------------------------

interface FacingParams {
  /** Face-band skin window: `[skinFrom, skinTo)` in grid columns. Empty range = all hair (N). */
  readonly skinFrom: number;
  readonly skinTo: number;
  /** One-time hip-to-thigh column shift for the planted/reaching leg — the profile facings' own
   *  forward lean, passed to `legBar` as `hipLean`. */
  readonly thighLean: number;
  /** Column distance from centre (`AXIS`) for the front/back leg pair. */
  readonly legOffset: number;
  readonly torso: TorsoData;
}

const FACINGS: ReadonlyArray<readonly [Facing, FacingParams]> = (
  [
    { facing: 0, p: { skinFrom: 16, skinTo: 22, thighLean: 2, legOffset: 4, torso: TORSO_EAST } },
    {
      facing: 1,
      p: { skinFrom: 19, skinTo: 22, thighLean: 1, legOffset: 4, torso: TORSO_NORTHEAST },
    },
    { facing: 2, p: { skinFrom: 22, skinTo: 22, thighLean: 0, legOffset: 3, torso: TORSO_NORTH } },
    { facing: 6, p: { skinFrom: 10, skinTo: 22, thighLean: 0, legOffset: 3, torso: TORSO_SOUTH } },
    {
      facing: 7,
      p: { skinFrom: 12, skinTo: 22, thighLean: 1, legOffset: 4, torso: TORSO_SOUTHEAST },
    },
  ] satisfies ReadonlyArray<{ facing: Facing; p: FacingParams }>
).map(({ facing, p }) => [facing, p] as const);

type Pose = 'contact' | 'passing' | 'extension';

/** Row budget per pose: fewer empty rows at top = a lower (lower-y) torso = the "contact" bob
 *  low point; more empty rows = the "passing" high point. Head/torso row counts (5 hair + 8 face
 *  + 1 neck + 15 torso = 29) never change — only how many rows sit above them and how many the
 *  legs get below. `legfeetN` is the leg *band*, which always ends at grid row 46 (`ay`) —
 *  `assembleFrame` adds one further, always-empty row after it so nothing is ever drawn on row 47,
 *  the row below the anchor. `emptyN + legfeetN` is 18 for every pose (29 + 18 + 1 = 48). */
const LAYOUT: Record<Pose, { readonly emptyN: number; readonly legfeetN: number }> = {
  extension: { emptyN: 5, legfeetN: 13 },
  contact: { emptyN: 6, legfeetN: 12 },
  passing: { emptyN: 4, legfeetN: 14 },
};

/** Row from which `mirrorLower` swaps left/right when deriving frames 3-5. Chosen to sit at or
 *  above every pose's torso start (17/18/19), so the head is never touched by the mirror. */
const SWAP_FROM = 17;

/** Knee offsets (px, applied ~45% down the leg bar) per pose and role — this is what turns each
 *  leg into two jointed segments instead of a constant-width stick, and it changes shape between
 *  contact, passing and extension the way the brief asks for. Positive = shin drifts toward the
 *  direction of travel (east) relative to the thigh; negative = shin folds back behind it. */
function legsFor(pose: Pose, p: FacingParams, legfeetN: number): string[] {
  const front = AXIS + p.legOffset;
  const back = AXIS - p.legOffset;
  const centre = AXIS;
  if (pose === 'contact') {
    // Planted leg: shin lands slightly ahead of the thigh (heel-first contact).
    const frontLeg = legBar(legfeetN, front, p.thighLean, 1, true);
    // Trailing leg: knee bent, shin folded back sharply toward the hip.
    const backLeg = legBar(Math.max(1, legfeetN - LIFT), back, 0, -2, false);
    return mergeRows(backLeg, frontLeg);
  }
  if (pose === 'passing') {
    // Support leg: close to vertical, minimal knee offset.
    const supportLeg = legBar(legfeetN, centre + 1, 0, 0, true);
    // Swing leg: knee driving forward and up, shin tucked well ahead of the thigh.
    const swingLeg = legBar(Math.max(1, legfeetN - HIGH_LIFT), centre - 1, 0, 3, false);
    return mergeRows(supportLeg, swingLeg);
  }
  // Drive leg: pushing off behind, shin trailing further back than the thigh.
  const driveLeg = legBar(Math.max(1, legfeetN - LIFT), back, 0, -1, false);
  // Reaching leg: extending forward for the next contact, shin just ahead of the thigh.
  const reachLeg = legBar(Math.max(1, legfeetN - 1), front, p.thighLean, 1, false);
  return mergeRows(driveLeg, reachLeg);
}

/** Builds one facing's one pose: head, idle's own copied torso (arm rows swapped for the pose —
 *  see `torsoBodyFor`), and legs. Returns full 48-row `body` and `kit` arrays. */
function assembleFrame(pose: Pose, p: FacingParams): { body: string[]; kit: string[] } {
  const layout = LAYOUT[pose];
  const body: string[] = [];
  const kit: string[] = [];

  for (let i = 0; i < layout.emptyN; i++) {
    body.push(EMPTY_ROW);
    kit.push(EMPTY_ROW);
  }
  for (const r of HAIR_CAP) {
    body.push(r);
    kit.push(EMPTY_ROW);
  }
  for (const t of FACE_TEMPLATE) {
    body.push(faceRow(t, p.skinFrom, p.skinTo));
    kit.push(EMPTY_ROW);
  }
  body.push(p.torso.neck);
  kit.push(EMPTY_ROW);

  // Torso: idle's own 15 rows, verbatim, arm rows only swapped per pose. Kit never changes.
  for (const r of torsoBodyFor(pose, p.torso)) body.push(r);
  for (const r of p.torso.kit) kit.push(r);

  // Legs and feet: bare (no kit), and the band always ends at the ground row (46, `ay`) — the
  // always-empty row pushed after it guarantees nothing, planted or lifted, ever draws on row 47.
  const legfeetN = layout.legfeetN;
  for (const l of padTo(legsFor(pose, p, legfeetN), legfeetN)) {
    body.push(l);
    kit.push(EMPTY_ROW);
  }
  body.push(EMPTY_ROW);
  kit.push(EMPTY_ROW);

  return { body, kit };
}

// ---------------------------------------------------------------------------------------------
// Assembly: three authored poses per facing, mirrored for the other three — six frames, five
// facings, both layers.
// ---------------------------------------------------------------------------------------------

function toGrid(rows: readonly string[]): SpriteGrid {
  return { ...ATHLETE_FRAME, rows };
}

const bodySheet: Record<string, SpriteGrid[]> = {};
const kitSheet: Record<string, SpriteGrid[]> = {};

for (const [facing, p] of FACINGS) {
  const contact = assembleFrame('contact', p);
  const passing = assembleFrame('passing', p);
  const extension = assembleFrame('extension', p);

  const bodyHalf = [contact.body, passing.body, extension.body];
  const kitHalf = [contact.kit, passing.kit, extension.kit];

  const bodySix = [...bodyHalf, ...bodyHalf.map((r) => mirrorLower(r, SWAP_FROM))];
  const kitSix = [...kitHalf, ...kitHalf.map((r) => mirrorLower(r, SWAP_FROM))];

  bodySheet[poseKey('run', facing)] = bodySix.map(toGrid);
  kitSheet[poseKey('run', facing)] = kitSix.map(toGrid);
}

// Sanity-check the constants above actually produced HEIGHT-row grids at module load, in dev only
// — a cheap first line of defence before the property test in `tests/unit/engine/atlas.test.ts`
// (and the task's own verification script) run the real width/palette check.
if (import.meta.env?.DEV) {
  for (const frames of Object.values(bodySheet)) {
    for (const g of frames)
      if (g.rows.length !== HEIGHT) throw new Error('run.ts: malformed frame');
  }
}

export const RUN_BODY: SpriteSheet = bodySheet;
export const RUN_KIT: SpriteSheet = kitSheet;
