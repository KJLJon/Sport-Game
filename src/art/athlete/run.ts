/**
 * @spec    001-initial-dev
 * @phase   13 — Visual overhaul: sprites and pseudo-3D
 * @task    T-13.3 — Athlete rendering: facings, run cycle, kit tint, and pattern
 * @story   US-2.3 — See the whole field on a small screen
 * @design  13-visual-overhaul.md §3.1 (athlete sheet), src/art/README.md (authoring format)
 * @invariant INV-4 (art is in-repo data, never a fetch)
 *
 * Purpose: the `run` pose, all five authored facings (0/1/2/6/7), six frames each — a full,
 * seamlessly-looping run cycle. Every frame shares `idle.ts`'s `ATHLETE_FRAME` grid and its head
 * and torso silhouette language (hair dome, `2`-under-`P` torso, `5` outline around the union
 * silhouette), so the running athlete reads as the same body as the idle one, just moving.
 *
 * **How this file is built.** Hand-placing 60 individual 32x48 grids by literal row strings is
 * where transcription errors live, so instead this module authors three keyframes per facing —
 * contact, passing, extension — from small composable shape functions (a hair cap, a face band
 * with a facing-specific skin window, a torso core, a leg bar with an optional forward jog), all
 * routed through one `row(indent, content)` helper that always returns exactly 32 characters. Frames
 * 3-5 are then produced by mirroring frames 0-2's lower body (`mirrorLower`, from the neck down) —
 * a literal reading of "frames 3-5 are frames 0-2 with the legs and arms swapped" from the task
 * brief. This is a stylised simplification, not a biomechanical simulation: mirroring swaps which
 * side carries the planted/reaching leg and the forward-swung arm without tracking which physical
 * leg is which, which is indistinguishable at this resolution anyway. See the report for the one
 * honest caveat this produces.
 *
 * Kit sleeves are kept short (arm mostly bare, matching `idle.ts`), so the jersey silhouette itself
 * does not need to change between poses — only its vertical bob offset does — while the whole
 * torso and sleeve region is still authored as `P` per `src/art/README.md` §3, so every pattern can
 * paint it.
 */
import {
  poseKey,
  type Facing,
  type SpriteGrid,
  type SpriteSheet,
} from '../../engine/render/atlas.ts';
import { ATHLETE_FRAME } from './idle.ts';

// ---------------------------------------------------------------------------------------------
// Low-level row helpers. `row` always returns exactly 32 characters — the one guarantee every
// shape function below leans on instead of hand-counting dots.
// ---------------------------------------------------------------------------------------------

const WIDTH = 32;
const HEIGHT = 48;
const EMPTY_ROW = '.'.repeat(WIDTH);

/** Builds one 32-char row: `indent` dots, then `content`, padded with dots to width. Clamps
 *  rather than throws, so a stray off-by-one during authoring clips instead of crashing — the
 *  verification script (see the task brief) is the real backstop for width/palette errors. */
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

/** Stamps a small rectangular blob (e.g. a swinging forearm) onto `rows` at `(rowStart, col)`. */
function overlayBlob(
  rows: readonly string[],
  rowStart: number,
  col: number,
  blob: readonly string[],
): string[] {
  const out = rows.slice();
  blob.forEach((content, i) => {
    const y = rowStart + i;
    const line = out[y];
    if (line === undefined) return;
    out[y] = line.slice(0, col) + content + line.slice(col + content.length);
  });
  return out;
}

/** Mirrors one row's columns around `axis` (`mx = 2*axis - x`) rather than around the sprite's
 *  raw centre — reflecting around the facing's own leaned centreline instead of the unleaned one,
 *  so a forward lean stays a forward lean in the mirrored frames instead of flipping to a lean
 *  the wrong way. Columns whose mirror falls outside the grid are simply dropped (transparent). */
function mirrorRowAroundAxis(r: string, axis: number): string {
  const out = new Array<string>(WIDTH).fill('.');
  for (let x = 0; x < WIDTH; x++) {
    const mx = 2 * axis - x;
    if (mx >= 0 && mx < WIDTH) out[mx] = r[x] as string;
  }
  return out.join('');
}

/** Mirrors every row from `from` to the bottom, left-right around `axis` — the mechanism behind
 *  "frames 3-5 are frames 0-2 with the legs and arms swapped" (see the module Purpose). Rows above
 *  `from` (hair, face) are left untouched so the head keeps facing the same way in every frame. */
function mirrorLower(rows: readonly string[], from: number, axis: number): string[] {
  return rows.map((r, y) => (y < from ? r : mirrorRowAroundAxis(r, axis)));
}

// ---------------------------------------------------------------------------------------------
// Head: a hair cap (always hair, every facing) and a face band whose skin/hair split is a
// per-facing column window — narrow and eastward for a profile, empty for the back of the head.
// Lifted verbatim from `idle.ts`'s south-facing head so the running athlete has the same head.
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

const NECK_ROW = '..........555332235555..........';

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
// Leg bar: thigh/shin, sock, then shoe — a straight (optionally forward-jogging) column that
// either plants on the ground row or stops short of it, which is what "lifted" means here.
// ---------------------------------------------------------------------------------------------

const LEG_SEG = '51115'; // width 5: outline, skin x3, outline
const SOCK_SEG = '56665'; // width 5: outline, sock x3, outline
const SHOE_SEG = '5444445'; // width 7: outline, shoe x5, outline
const SOLE_SEG = '5555555'; // width 7: flat sole/ground-contact line

const LIFT = 4; // px a simple lifted foot clears the ground by (13 §3.1 guidance: 2-5px)
const HIGH_LIFT = 5; // the passing pose's high knee-drive — the top of that range

function legBar(
  len: number,
  col: number,
  jog: number,
  jogEvery: number,
  touchesGround: boolean,
): string[] {
  const out: string[] = [];
  let c = col;
  for (let i = 0; i < len; i++) {
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
    if (jog !== 0 && i > 0 && i % jogEvery === 0) c += jog;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Per-facing shape parameters and the row-band layout shared by every pose.
// ---------------------------------------------------------------------------------------------

interface FacingParams {
  /** Shoulder/torso width in px — narrower for the profile facings (`13` guidance: E ~12-16px). */
  readonly width: number;
  /** Face-band skin window: `[skinFrom, skinTo)` in grid columns. Empty range = all hair (N). */
  readonly skinFrom: number;
  readonly skinTo: number;
  /** Per-row column drift applied to the planted/reaching leg — the profile facings' forward lean. */
  readonly jog: number;
  readonly jogEvery: number;
  /** 1-2px forward torso/leg offset versus the idle pose's centred column. */
  readonly lean: number;
  /** Column distance from centre for the front/back leg pair. */
  readonly legOffset: number;
}

const FACINGS: ReadonlyArray<readonly [Facing, FacingParams]> = (
  [
    {
      facing: 0,
      p: { width: 13, skinFrom: 16, skinTo: 22, jog: 1, jogEvery: 2, lean: 2, legOffset: 4 },
    }, // E
    {
      facing: 1,
      p: { width: 16, skinFrom: 19, skinTo: 22, jog: 1, jogEvery: 3, lean: 1, legOffset: 4 },
    }, // NE
    {
      facing: 2,
      p: { width: 19, skinFrom: 22, skinTo: 22, jog: 0, jogEvery: 1, lean: 0, legOffset: 3 },
    }, // N
    {
      facing: 6,
      p: { width: 19, skinFrom: 10, skinTo: 22, jog: 0, jogEvery: 1, lean: 0, legOffset: 3 },
    }, // S
    {
      facing: 7,
      p: { width: 16, skinFrom: 12, skinTo: 22, jog: 1, jogEvery: 3, lean: 1, legOffset: 4 },
    }, // SE
  ] satisfies ReadonlyArray<{ facing: Facing; p: FacingParams }>
).map(({ facing, p }) => [facing, p] as const);

type Pose = 'contact' | 'passing' | 'extension';

/** Row budget per pose: fewer empty rows at top = a lower (lower-y) torso = the "contact" bob
 *  low point; more empty rows = the "passing" high point. Head/torso/hip row counts (5/8/1/12/3
 *  = 29) never change — only how many rows sit above them and how many the legs get below. */
const LAYOUT: Record<Pose, { readonly emptyN: number; readonly legfeetN: number }> = {
  extension: { emptyN: 5, legfeetN: 14 },
  contact: { emptyN: 6, legfeetN: 13 },
  passing: { emptyN: 4, legfeetN: 15 },
};

/** Row from which `mirrorLower` swaps left/right when deriving frames 3-5. Chosen to sit at or
 *  above every pose's torso start (17/18/19), so the head is never touched by the mirror. */
const SWAP_FROM = 17;

const ARM_BLOB_EAST: readonly string[] = ['115', '115', '.5.'];
const ARM_BLOB_WEST: readonly string[] = ['511', '511', '.5.'];

function legsFor(pose: Pose, p: FacingParams, legfeetN: number): string[] {
  const front = 16 + p.legOffset + p.lean;
  const back = 16 - p.legOffset + p.lean;
  const centre = 16 + p.lean;
  if (pose === 'contact') {
    const frontLeg = legBar(legfeetN, front, p.jog, p.jogEvery, true);
    const backLeg = legBar(Math.max(1, legfeetN - LIFT), back, 0, 1, false);
    return mergeRows(backLeg, frontLeg);
  }
  if (pose === 'passing') {
    const supportLeg = legBar(legfeetN, centre + 1, 0, 1, true);
    const swingLeg = legBar(Math.max(1, legfeetN - HIGH_LIFT), centre - 1, 0, 1, false);
    return mergeRows(supportLeg, swingLeg);
  }
  const driveLeg = legBar(Math.max(1, legfeetN - LIFT), back, 0, 1, false);
  const reachLeg = legBar(Math.max(1, legfeetN - 1), front, p.jog, p.jogEvery, false);
  return mergeRows(driveLeg, reachLeg);
}

/** Builds one facing's one pose: head, torso (kit `P` for the whole jersey per `src/art/README.md`
 *  §3), hip/shorts, and legs, plus a small swinging-forearm overlay on whichever side is forward
 *  for this pose. Returns full 48-row `body` and `kit` arrays. */
function assembleFrame(pose: Pose, p: FacingParams): { body: string[]; kit: string[] } {
  const layout = LAYOUT[pose];
  const mainIndent = 16 - Math.floor(p.width / 2) + p.lean;
  const shoulderWidth = Math.max(1, p.width - 4);
  const shoulderIndent = mainIndent + 2;

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
  body.push(NECK_ROW);
  kit.push(EMPTY_ROW);

  const torsoStart = body.length;
  body.push(row(shoulderIndent, '5' + '2'.repeat(Math.max(0, shoulderWidth - 2)) + '5'));
  kit.push(row(shoulderIndent, 'k' + 'P'.repeat(Math.max(0, shoulderWidth - 2)) + 'k'));
  const coreRow = '51115' + '2'.repeat(Math.max(0, p.width - 10)) + '51115';
  for (let i = 0; i < 10; i++) {
    body.push(row(mainIndent, coreRow));
    kit.push(row(mainIndent, 'P'.repeat(p.width)));
  }
  body.push(row(mainIndent, coreRow));
  kit.push(row(mainIndent, 'k'.repeat(p.width)));

  const hipBody = row(mainIndent, '5' + '1'.repeat(Math.max(0, p.width - 2)) + '5');
  const hipKitFill = row(mainIndent, 'K'.repeat(p.width));
  const hipKitHem = row(mainIndent, 'k' + 'K'.repeat(Math.max(0, p.width - 2)) + 'k');
  body.push(hipBody, hipBody, hipBody);
  kit.push(hipKitFill, hipKitFill, hipKitHem);

  const legfeetN = layout.legfeetN;
  for (const l of padTo(legsFor(pose, p, legfeetN), legfeetN)) {
    body.push(l);
    kit.push(EMPTY_ROW);
  }

  const armRow = torsoStart + 4;
  const eastCol = mainIndent + p.width;
  const westCol = mainIndent - 3;
  const armedBody =
    pose === 'contact'
      ? overlayBlob(body, armRow, eastCol, ARM_BLOB_EAST)
      : pose === 'extension'
        ? overlayBlob(body, armRow, westCol, ARM_BLOB_WEST)
        : body;

  return { body: armedBody, kit };
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
  const axis = 16 + p.lean;

  const bodySix = [...bodyHalf, ...bodyHalf.map((r) => mirrorLower(r, SWAP_FROM, axis))];
  const kitSix = [...kitHalf, ...kitHalf.map((r) => mirrorLower(r, SWAP_FROM, axis))];

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
