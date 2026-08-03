/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.9 — CPU team generation: coherent opponents and identities scaled to difficulty
 * @story   US-7.1 — Play against the computer
 * @design  05-data-model.md §1 (teams), 06-game-design.md §7 (difficulty), 02 US-7.1
 * @invariant INV-1 (difficulty never changes an attribute or a derived rating), INV-2 (seeded only),
 *            INV-8 (determinism)
 *
 * Purpose: an opponent with a name, a kit, and a squad that looks like somebody built it on purpose.
 *
 * ## What "scaled to difficulty" means here, and why it is not what it sounds like
 *
 * `03`'s row for this task says *coherent opponents and identities scaled to difficulty*, and read
 * carelessly that says a Legend opponent fields better athletes. It cannot mean that. US-7.2 is
 * explicit — *"difficulty never alters any athlete's attributes or ratings on either team, and this
 * is verified by a test"* — and `06` §7 gives the reason: stat-cheating difficulty makes wins feel
 * unearned. Generating a stronger roster at a higher level is stat-cheating with an extra step.
 *
 * US-7.1 says what actually scales: *"the CPU fields a **coherent** lineup and plays to a
 * **recognisable style**."* So what a level changes is how well the team is *built*, not how good
 * its athletes are:
 *
 * - **Every level draws from the same budget.** The squad's total attribute points are the same at
 *   Rookie and at Legend, seed for seed. There is a test asserting exactly that, and it is the
 *   INV-1 guarantee in the form this module can break it.
 * - **What rises is coherence.** A Legend opponent's athletes are *shaped* for the style the team
 *   plays — the points sit where that style needs them. A Rookie opponent has the same points
 *   spread anywhere, so it fields a collection rather than a team.
 *
 * That is a real difficulty difference a player can see and beat, and it costs nobody a rating.
 * `06` §7's `tactics` row — *uses advanced tactics: rarely → consistently* — is the dial, because
 * "was this side assembled by somebody who knows what they are doing" is the same question one turn
 * earlier.
 */
import { createRng, type Rng } from '../engine/rng.ts';
import { rollAthlete, seededId } from '../athletes/create.ts';
import {
  ATHLETE_BOUNDS,
  ATTRIBUTE_IDS,
  attributeTotal,
  clamp,
  type AttributeId,
  type Athlete,
  type Attributes,
} from '../athletes/types.ts';
import type { SportId } from '../sports/types.ts';
import { difficultyProfile, type Difficulty } from '../modes/difficulty.ts';
import { CREST_IDS, TEAM_PALETTES, type CrestId, type Team } from './types.ts';

/** The schema version a generated team is written at. Matches the editor's. */
const TEAM_SCHEMA_VERSION = 1;

/**
 * A way of playing, expressed as the attributes it wants. Recognisable is the requirement — a
 * player should be able to say "this lot are quick" after a match, not read it off a screen.
 */
export interface CpuStyle {
  readonly id: string;
  readonly label: string;
  /** What a scout would say about them, for the pre-match screen when there is one. */
  readonly blurb: string;
  /** The attributes this style spends its points on. */
  readonly wants: readonly AttributeId[];
}

/**
 * Five styles, chosen so that no two want the same three attributes and every attribute is wanted
 * by somebody. A sixth that overlapped an existing one would make two opponents indistinguishable,
 * which is the failure mode this list exists to avoid.
 */
export const CPU_STYLES: readonly CpuStyle[] = [
  {
    id: 'runners',
    label: 'Runners',
    blurb: 'They will go past you. Get back or get beaten.',
    wants: ['speed', 'acceleration', 'stamina'],
  },
  {
    id: 'physical',
    label: 'Physical',
    blurb: 'Nothing comes easy against them. Expect contact.',
    wants: ['strength', 'vertical', 'discipline'],
  },
  {
    id: 'technical',
    label: 'Technical',
    blurb: 'They keep it, move it, and wait for you to open up.',
    wants: ['coordination', 'accuracy', 'awareness'],
  },
  {
    id: 'nervy',
    label: 'Streaky',
    blurb: 'Dangerous when it is going well. Fragile when it is not.',
    wants: ['accuracy', 'speed', 'agility'],
  },
  {
    id: 'composed',
    label: 'Composed',
    blurb: 'They will not beat themselves. You will have to do it.',
    wants: ['composure', 'discipline', 'awareness'],
  },
];

/** Place names and nicknames, crossed for the team name. Bland on purpose — no real club is here. */
const PLACES = [
  'Northgate',
  'Riverton',
  'Ashford',
  'Kestrel Bay',
  'Elmhurst',
  'Fairhaven',
  'Stonebridge',
  'Westmoor',
  'Harborview',
  'Redcliff',
  'Silverdale',
  'Oakfield',
] as const;

const NICKNAMES = [
  'Foxes',
  'Anchors',
  'Comets',
  'Wolves',
  'Rovers',
  'Falcons',
  'Miners',
  'Tide',
  'Pioneers',
  'Lancers',
  'Ravens',
  'Vaqueros',
] as const;

export interface CpuTeam {
  readonly team: Team;
  readonly athletes: readonly Athlete[];
  readonly style: CpuStyle;
}

export interface CpuTeamOptions {
  /** Everything about this team is derived from it (INV-8). */
  readonly seed: string;
  readonly sportId: SportId;
  /** How many athletes to field. */
  readonly size: number;
  /** The level this opponent is being generated for. Changes coherence and nothing else. */
  readonly difficulty: Difficulty;
  readonly createdAt?: number;
}

/**
 * A whole opponent: identity, style, and a squad built to it.
 *
 * Forked by label rather than drawn in order, so adding a field later cannot shift the athletes
 * (INV-8, `engine/rng.ts`'s rule).
 */
export function generateCpuTeam(options: CpuTeamOptions): CpuTeam {
  const root = createRng(options.seed);
  const identityRng = root.fork('identity');
  const style = pick(CPU_STYLES, root.fork('style'));
  const createdAt = options.createdAt ?? 0;

  const place = pick(PLACES, identityRng);
  const nickname = pick(NICKNAMES, identityRng);
  const palette = pick(TEAM_PALETTES, identityRng);
  const crestId = pick(CREST_IDS, identityRng) as CrestId;

  const team: Team = {
    id: seededId(identityRng),
    schemaVersion: TEAM_SCHEMA_VERSION,
    name: `${place} ${nickname}`,
    shortName: shortNameFor(place, nickname),
    colours: palette.colours,
    crestId,
    createdAt,
    // Generated teams are not the player's to edit: a user edit would silently rebalance a ladder.
    editable: false,
  };

  const coherence = difficultyProfile(options.difficulty).tactics;
  const squadRng = root.fork('squad');
  const athletes: Athlete[] = [];

  for (let index = 0; index < options.size; index += 1) {
    const athlete = rollAthlete(squadRng, {
      displayName: `${nickname.slice(0, -1)} ${index + 1}`,
      primarySport: options.sportId,
      rarity: 'common',
      source: 'created',
      createdAt,
    });

    athletes.push({
      ...athlete,
      attributes: shapeToward(athlete.attributes, style.wants, coherence),
    });
  }

  return { team, athletes, style };
}

/**
 * Moves an athlete's points towards what the style wants, **without changing how many there are**.
 *
 * This is the whole of the INV-1 argument in one function: `coherence` decides the *shape* of a
 * spread and can never decide its *size*. A Legend opponent's centre-back is not a better athlete
 * than a Rookie opponent's, they are a better centre-back — which is a thing a player can see, and
 * a thing they can beat.
 *
 * Points are taken proportionally from what the style does not want and given proportionally to
 * what it does, which keeps the whole spread inside the attribute bounds without special cases and
 * leaves an athlete who is already shaped that way untouched.
 */
export function shapeToward(
  attributes: Attributes,
  wants: readonly AttributeId[],
  coherence: number,
): Attributes {
  const pull = clamp(coherence, 0, 1);
  if (pull === 0 || wants.length === 0 || wants.length === ATTRIBUTE_IDS.length) return attributes;

  const wanted = new Set<AttributeId>(wants);
  const rest = ATTRIBUTE_IDS.filter((id) => !wanted.has(id));

  // What the unwanted attributes can spare, and what the wanted ones can hold. The move is bounded
  // by *both*: taking more than the style can absorb would pile every spare point onto whichever
  // attribute had room, which is a caricature rather than a team — a style should be recognisable,
  // not a spike.
  const room = rest.reduce(
    (total, id) => total + (attributes[id] - ATHLETE_BOUNDS.attribute.min),
    0,
  );
  const headroom = wants.reduce(
    (total, id) => total + (ATHLETE_BOUNDS.attribute.max - attributes[id]),
    0,
  );
  const moved = Math.min(room, headroom) * pull * MAX_RESHAPE;
  if (moved <= 0) return attributes;

  const result = { ...attributes } as Record<AttributeId, number>;

  for (const id of rest) {
    const share = (attributes[id] - ATHLETE_BOUNDS.attribute.min) / room;
    result[id] = attributes[id] - moved * share;
  }
  for (const id of wants) {
    const share = (ATHLETE_BOUNDS.attribute.max - attributes[id]) / headroom;
    result[id] = attributes[id] + moved * share;
  }

  return settle(result, attributeTotal(attributes));
}

/**
 * How much of the available room a fully coherent team may move. Well under half, deliberately: an
 * opponent whose every athlete is a spike is not a coherent team, it is a gimmick, and it would
 * also make the style unbeatable rather than recognisable.
 */
const MAX_RESHAPE = 0.45;

/**
 * Rounds to whole attributes and puts back whatever rounding cost, so the total is *exactly* what
 * it was. Without this the invariant test would pass on average and fail on a seed.
 */
function settle(draft: Record<AttributeId, number>, target: number): Attributes {
  const rounded = {} as Record<AttributeId, number>;
  for (const id of ATTRIBUTE_IDS) {
    rounded[id] = Math.round(
      clamp(draft[id], ATHLETE_BOUNDS.attribute.min, ATHLETE_BOUNDS.attribute.max),
    );
  }

  let drift = target - attributeTotal(rounded as Attributes);
  // Spread the rounding residue one point at a time over the attributes that have room for it, so
  // no single attribute absorbs a correction big enough to change the shape.
  for (let guard = 0; drift !== 0 && guard < ATTRIBUTE_IDS.length * 4; guard += 1) {
    for (const id of ATTRIBUTE_IDS) {
      if (drift === 0) break;
      const next = rounded[id] + Math.sign(drift);
      if (next < ATHLETE_BOUNDS.attribute.min || next > ATHLETE_BOUNDS.attribute.max) continue;
      rounded[id] = next;
      drift -= Math.sign(drift);
    }
  }

  return rounded as Attributes;
}

/** Two to four characters, from the place and the nickname — the non-colour identity channel. */
export function shortNameFor(place: string, nickname: string): string {
  const initials = place
    .split(' ')
    .map((word) => word[0] ?? '')
    .join('');
  return `${initials}${nickname[0] ?? ''}`.toUpperCase().slice(0, 4);
}

function pick<T>(list: readonly T[], rng: Rng): T {
  return list[rng.int(0, list.length)] as T;
}
