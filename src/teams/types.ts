/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.11 — Teams: create/edit, name, colours, generic crests
 * @task    T-3.12 — Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best
 * @story   US-6.1 — Build a team
 * @story   US-6.2 — Set a lineup
 * @design  05-data-model.md §1 (storage overview), 10-ui-ux.md §11 (accessibility)
 * @invariant INV-3 (all storage through src/storage/)
 *
 * Purpose: what a team is, and what a squad is. `05` §1 gives the two stores and one line each —
 * "team identity, colours, crest" and "lineup, formation, bench" — so the shape below is this
 * task's to define, written against US-6.1 and US-6.2 rather than quoted.
 *
 * Two decisions are baked in and are worth stating plainly.
 *
 * **A squad is keyed by team *and* sport.** US-6.1: "a team holds a squad per sport, drawn from my
 * one shared roster of athletes." One roster, many squads — an athlete can be in a team's
 * basketball five and its soccer eleven at once, and neither knows about the other.
 *
 * **Colours are never the only difference between two teams.** `10` §11 and CLAUDE.md §8.11 both
 * forbid it, so a team also carries a short name and a crest shape. A colourblind player tells two
 * teams apart by the letters on the scoreboard and the silhouette on the crest, not by the hue.
 */
import type { SportId } from '../sports/types.ts';

/**
 * Generic built-in crests (US-6.1 — "a crest picked from generic built-ins"). Shapes, not badges:
 * the app ships no club iconography and links to none.
 */
export const CREST_IDS = [
  'shield',
  'circle',
  'diamond',
  'chevron',
  'star',
  'stripes',
  'halves',
  'quarters',
] as const;
export type CrestId = (typeof CREST_IDS)[number];

export interface TeamColours {
  /** Kit primary, as a hex string. */
  readonly primary: string;
  readonly secondary: string;
}

export interface Team {
  id: string;
  schemaVersion: number;
  name: string;
  /** Two to four characters for scoreboards and compact rows — the non-colour identity channel. */
  shortName: string;
  colours: TeamColours;
  crestId: CrestId;
  createdAt: number;
  /** False for CPU teams the game generates, so a user edit cannot silently rebalance a ladder. */
  editable: boolean;
}

/**
 * One team's lineup in one sport. Keyed `teamId:sportId` (`05` §1), and that key is built in
 * exactly one place so a caller can never construct half of it.
 */
export interface Squad {
  id: string;
  teamId: string;
  sportId: SportId;
  /** Position id from the sport's `RoleTable` → athlete id. Missing means an empty slot. */
  starters: Record<string, string>;
  /** Ordered: the first name here is the first substitution offered. */
  bench: string[];
  /** Sport-specific formation identifier, once formations exist (T-3.12, Phase 6). */
  formationId?: string;
  updatedAt: number;
}

export const TEAM_BOUNDS = {
  maxNameLength: 32,
  shortName: { min: 2, max: 4 },
  /** A squad may not name the same athlete twice, in any slot (`squadIsValid`). */
  maxBench: 7,
} as const;

export function squadKey(teamId: string, sportId: SportId): string {
  return `${teamId}:${sportId}`;
}

export function isCrestId(value: string): value is CrestId {
  return (CREST_IDS as readonly string[]).includes(value);
}

/**
 * Colourblind-safe team palettes (`10` §11, US-13.2). Each pair is distinguishable under
 * protanopia, deuteranopia, and tritanopia, and each carries a name so the picker never asks
 * someone to choose "the green one".
 */
export const TEAM_PALETTES: readonly {
  readonly id: string;
  readonly name: string;
  readonly colours: TeamColours;
}[] = [
  { id: 'slate', name: 'Slate & bone', colours: { primary: '#2f4858', secondary: '#f2ede4' } },
  { id: 'amber', name: 'Amber & ink', colours: { primary: '#d98324', secondary: '#1b1b1e' } },
  { id: 'teal', name: 'Teal & sand', colours: { primary: '#127475', secondary: '#e9d8a6' } },
  { id: 'plum', name: 'Plum & chalk', colours: { primary: '#5b2a86', secondary: '#f5f5f5' } },
  { id: 'rust', name: 'Rust & sky', colours: { primary: '#9e2a2b', secondary: '#a8dadc' } },
  { id: 'moss', name: 'Moss & cream', colours: { primary: '#31572c', secondary: '#ecf39e' } },
  { id: 'cobalt', name: 'Cobalt & citrus', colours: { primary: '#14213d', secondary: '#fca311' } },
  { id: 'clay', name: 'Clay & slate', colours: { primary: '#bc6c25', secondary: '#283618' } },
];

/**
 * Every athlete named in a squad, starters then bench, without duplicates. The one place squad
 * membership is read, so "is this athlete in a lineup?" has a single answer (T-3.13, US-9.3).
 */
export function squadMembers(squad: Squad): string[] {
  const seen = new Set<string>();
  const members: string[] = [];

  for (const id of Object.values(squad.starters)) {
    if (id !== '' && !seen.has(id)) {
      seen.add(id);
      members.push(id);
    }
  }
  for (const id of squad.bench) {
    if (id !== '' && !seen.has(id)) {
      seen.add(id);
      members.push(id);
    }
  }

  return members;
}

/** How many starting slots are filled — what the lineup editor's "ready" state reads. */
export function filledSlots(squad: Squad): number {
  return Object.values(squad.starters).filter((id) => id !== '').length;
}

/**
 * Whether a squad is fieldable: every slot filled, and nobody named twice. Duplicates are the
 * failure that matters — the same athlete in two slots would spawn twice in the sim.
 */
export function squadIsValid(squad: Squad, squadSize: number): boolean {
  if (filledSlots(squad) !== squadSize) return false;

  const named = [...Object.values(squad.starters), ...squad.bench].filter((id) => id !== '');
  return new Set(named).size === named.length;
}

export function newSquad(teamId: string, sportId: SportId, now = Date.now()): Squad {
  return {
    id: squadKey(teamId, sportId),
    teamId,
    sportId,
    starters: {},
    bench: [],
    updatedAt: now,
  };
}
