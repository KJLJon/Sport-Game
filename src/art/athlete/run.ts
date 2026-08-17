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
 * with a facing-specific skin window, a torso core, a two-segment leg bar with an offset knee),
 * all routed through one `row(indent, content)` helper that always returns exactly 32 characters,
 * and every kit row placed one pixel inside its matching body row (`inset`) so the `5` outline
 * always shows around the union silhouette rather than being painted over — `src/art/README.md`
 * §2. Frames 3-5 are then produced by mirroring frames 0-2's lower body (`mirrorLower`, from the
 * neck down) — a literal reading of "frames 3-5 are frames 0-2 with the legs and arms swapped"
 * from the task brief. This is a stylised simplification, not a biomechanical simulation: mirroring
 * swaps which side carries the planted/reaching leg and the forward-swung arm without tracking
 * which physical leg is which, which is indistinguishable at this resolution anyway.
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

/** `src/art/README.md` §2: the body layer's `5` outline runs around the whole silhouette, and the
 *  kit composites *inside* it — so every kit row this file writes is one pixel narrower than its
 *  matching body row on each side, never flush with it. Applied to a body `(indent, width)` pair,
 *  this returns the kit's own, inset by one column all around. */
function inset(indent: number, width: number): { readonly indent: number; readonly width: number } {
  return { indent: indent + 1, width: Math.max(0, width - 2) };
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
// Leg bar: thigh, then a knee, then shin/sock/shoe — two straight segments offset from each
// other at the knee, rather than one constant-width column, so the leg reads as jointed instead
// of a stick. `touchesGround` decides whether the last row is a flat sole (planted, row 46 of
// the *band* — never below it, the caller reserves the true ground-row-47 gap) or a raised shoe.
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
// Per-facing shape parameters and the row-band layout shared by every pose.
// ---------------------------------------------------------------------------------------------

interface FacingParams {
  /** Shoulder/torso width in px — narrower for the profile facings (`13` guidance: E ~12-16px). */
  readonly width: number;
  /** Face-band skin window: `[skinFrom, skinTo)` in grid columns. Empty range = all hair (N). */
  readonly skinFrom: number;
  readonly skinTo: number;
  /** One-time hip-to-thigh column shift for the planted/reaching leg — the profile facings' own
   *  forward lean, passed to `legBar` as `hipLean`. */
  readonly thighLean: number;
  /** 1-2px forward torso/leg offset versus the idle pose's centred column. */
  readonly lean: number;
  /** Column distance from centre for the front/back leg pair. */
  readonly legOffset: number;
}

// `idle/6` frame 0 (`idle.ts`) is the ground truth for S: its torso outline spans x=6-25 (20px)
// and its legs sit within x=11-20 when both feet are under the body. `width: 20, lean: 0` here
// reproduces that exactly (mainIndent 16 - 10 + 0 = 6); N shares it since both are the wide,
// front/back-on facings. E/NE/SE are narrowed and leaned by the same proportions idle's own
// silhouette implies, there being no idle reference for a turned athlete to match against.
const FACINGS: ReadonlyArray<readonly [Facing, FacingParams]> = (
  [
    { facing: 0, p: { width: 14, skinFrom: 16, skinTo: 22, thighLean: 2, lean: 2, legOffset: 4 } }, // E
    { facing: 1, p: { width: 17, skinFrom: 19, skinTo: 22, thighLean: 1, lean: 1, legOffset: 4 } }, // NE
    { facing: 2, p: { width: 20, skinFrom: 22, skinTo: 22, thighLean: 0, lean: 0, legOffset: 3 } }, // N
    { facing: 6, p: { width: 20, skinFrom: 10, skinTo: 22, thighLean: 0, lean: 0, legOffset: 3 } }, // S
    { facing: 7, p: { width: 17, skinFrom: 12, skinTo: 22, thighLean: 1, lean: 1, legOffset: 4 } }, // SE
  ] satisfies ReadonlyArray<{ facing: Facing; p: FacingParams }>
).map(({ facing, p }) => [facing, p] as const);

type Pose = 'contact' | 'passing' | 'extension';

/** Row budget per pose: fewer empty rows at top = a lower (lower-y) torso = the "contact" bob
 *  low point; more empty rows = the "passing" high point. Head/torso/hip row counts (5/8/1/12/3
 *  = 29) never change — only how many rows sit above them and how many the legs get below.
 *  `legfeetN` is the leg *band*, which always ends at grid row 46 (`ay`) — `assembleFrame` adds
 *  one further, always-empty row after it so nothing is ever drawn on row 47, the row below the
 *  anchor. `emptyN + legfeetN` is 18 for every pose by construction (29 + 18 + 1 = 48). */
const LAYOUT: Record<Pose, { readonly emptyN: number; readonly legfeetN: number }> = {
  extension: { emptyN: 5, legfeetN: 13 },
  contact: { emptyN: 6, legfeetN: 12 },
  passing: { emptyN: 4, legfeetN: 14 },
};

/** Row from which `mirrorLower` swaps left/right when deriving frames 3-5. Chosen to sit at or
 *  above every pose's torso start (17/18/19), so the head is never touched by the mirror. */
const SWAP_FROM = 17;

const ARM_BLOB_EAST: readonly string[] = ['115', '115', '.5.'];
const ARM_BLOB_WEST: readonly string[] = ['511', '511', '.5.'];

/** Knee offsets (px, applied ~45% down the leg bar) per pose and role — this is what turns each
 *  leg into two jointed segments instead of a constant-width stick, and it changes shape between
 *  contact, passing and extension the way the brief asks for. Positive = shin drifts toward the
 *  direction of travel (east) relative to the thigh; negative = shin folds back behind it. */
function legsFor(pose: Pose, p: FacingParams, legfeetN: number): string[] {
  const front = 16 + p.legOffset + p.lean;
  const back = 16 - p.legOffset + p.lean;
  const centre = 16 + p.lean;
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

  // Shoulder cap: body draws the full-width outline; kit's collar sits one px inside it.
  const torsoStart = body.length;
  const shoulderKit = inset(shoulderIndent, shoulderWidth);
  body.push(row(shoulderIndent, '5' + '2'.repeat(Math.max(0, shoulderWidth - 2)) + '5'));
  kit.push(row(shoulderKit.indent, 'k' + 'P'.repeat(Math.max(0, shoulderKit.width - 2)) + 'k'));

  // Torso core: body's outer `5`s are the true silhouette edge; the whole jersey (torso *and*
  // sleeve) is `P` per `src/art/README.md` §3, inset one px inside that outline on every row.
  const torsoKit = inset(mainIndent, p.width);
  const coreRow = '51115' + '2'.repeat(Math.max(0, p.width - 10)) + '51115';
  for (let i = 0; i < 10; i++) {
    body.push(row(mainIndent, coreRow));
    kit.push(row(torsoKit.indent, 'P'.repeat(torsoKit.width)));
  }
  body.push(row(mainIndent, coreRow));
  kit.push(row(torsoKit.indent, 'k'.repeat(torsoKit.width)));

  // Hip/shorts: same inset-inside-the-outline rule.
  const hipKit = inset(mainIndent, p.width);
  const hipBody = row(mainIndent, '5' + '1'.repeat(Math.max(0, p.width - 2)) + '5');
  const hipKitFill = row(hipKit.indent, 'K'.repeat(hipKit.width));
  const hipKitHem = row(hipKit.indent, 'k' + 'K'.repeat(Math.max(0, hipKit.width - 2)) + 'k');
  body.push(hipBody, hipBody, hipBody);
  kit.push(hipKitFill, hipKitFill, hipKitHem);

  // Legs and feet: bare (no kit), and the band always ends at the ground row (46, `ay`) — the
  // always-empty row pushed after it guarantees nothing, planted or lifted, ever draws on row 47.
  const legfeetN = layout.legfeetN;
  for (const l of padTo(legsFor(pose, p, legfeetN), legfeetN)) {
    body.push(l);
    kit.push(EMPTY_ROW);
  }
  body.push(EMPTY_ROW);
  kit.push(EMPTY_ROW);

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
