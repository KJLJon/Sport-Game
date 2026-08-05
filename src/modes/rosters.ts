/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.2 — Match setup screens for Live and Playbook: sport, teams, difficulty, length,
 *          rules toggles
 * @story   US-10.2 — Set up an exhibition
 * @story   US-7.1 — Play with the athletes I own
 * @design  09-modes-and-arcade.md §1, 05-data-model.md §1 (stores), 03 T-7.9 (CPU teams)
 * @invariant INV-5 (no sport-specific branching outside the sport), INV-8 (an opponent is a pure
 *            function of its seed)
 *
 * Purpose: turns "this team, against that opponent, at this sport" into the two rosters a match
 * takes. One place, so Live and Playbook field the same eleven.
 *
 * **This closes a real gap rather than adding a feature.** Until T-8.2, `liveScreen` had no way to
 * be given athletes at all: `MatchOptions.rosters` existed and the Live screen never passed it, so
 * *every Live match was played by anonymous athletes rolled from the seed* while the player's squad
 * sat in the database. Playbook used the real roster, which is why nothing looked broken from the
 * outside — the two modes were simply playing different games, and INV-11's parity harness passes
 * rosters explicitly so it could not see the difference either.
 *
 * **And it gives T-7.9 its first caller.** `generateCpuTeam` — a named opponent with a kit and a
 * playing style — had been written, tested, and never invoked by anything a player could reach.
 *
 * **Ordering is the squad's, not the database's.** A lineup is a mapping from the sport's role ids
 * to athlete ids, and the sport fills its positions from the array in order, so the array has to be
 * built by walking `roles.roles` — not by taking whatever order the store hands back.
 */
import type { Athlete } from '../athletes/types.ts';
import type { AppDatabase } from '../storage/app-db.ts';
import { generateCpuTeam, type CpuTeam } from '../teams/cpu-team.ts';
import type { Squad, Team } from '../teams/types.ts';
import type { Difficulty } from './difficulty.ts';
import type { SportModule } from '../sports/types.ts';

export interface ResolveRostersOptions {
  readonly db: AppDatabase;
  readonly sport: SportModule;
  /** The player's team, or `null` to field whatever athletes they have. */
  readonly teamId: string | null;
  readonly opponentSeed: string;
  readonly difficulty: Difficulty;
}

export interface ResolvedRosters {
  /** Indexed by side: `[0]` is the player's, `[1]` the opponent's. */
  readonly rosters: readonly [readonly Athlete[], readonly Athlete[]];
  /** The player's team, when they picked one. `null` means "my athletes", with no team identity. */
  readonly team: Team | null;
  readonly opponent: CpuTeam;
}

/** Why a match cannot be set up. Each is a sentence a player can act on, not an error code. */
export interface RosterProblem {
  readonly heading: string;
  readonly body: string;
}

/**
 * The two rosters, or the reason there are none.
 *
 * The opponent is always generated rather than drawn from the player's own athletes. Playbook used
 * to play the second half of your squad against the first, which is a fine way to test a simulation
 * and a strange way to play a game: nobody's *team* is the other team.
 */
export async function resolveRosters(
  options: ResolveRostersOptions,
): Promise<ResolvedRosters | RosterProblem> {
  const size = options.sport.meta.squadSize;
  const all = await options.db.athletes.getAll();

  const team =
    options.teamId === null ? null : ((await options.db.teams.get(options.teamId)) ?? null);
  const squad = team === null ? undefined : await options.db.teams.squad(team.id, options.sport.id);

  const home =
    squad === undefined ? firstFit(all, size) : fromSquad(squad, all, options.sport, size);

  if (home === null) {
    return {
      heading: 'Not enough athletes yet',
      body:
        squad === undefined
          ? `${options.sport.meta.displayName} needs ${size} athletes to field a side. Create a few, or restore a backup.`
          : `${team?.name ?? 'That team'} has ${size - countPlaced(squad, options.sport)} empty slots in its ${options.sport.meta.displayName} lineup.`,
    };
  }

  const opponent = generateCpuTeam({
    seed: `${options.opponentSeed}:${options.sport.id}`,
    sportId: options.sport.id,
    size,
    difficulty: options.difficulty,
  });

  return {
    rosters: [home, opponent.athletes.slice(0, size)],
    team,
    opponent,
  };
}

/**
 * A squad's starters, in the sport's own role order.
 *
 * Returns `null` for a lineup with a hole in it. A half-filled lineup could be padded from the
 * bench, and that would silently field somebody the player did not pick — worse than saying so.
 */
function fromSquad(
  squad: Squad,
  all: readonly Athlete[],
  sport: SportModule,
  size: number,
): readonly Athlete[] | null {
  const byId = new Map(all.map((athlete) => [athlete.id, athlete]));
  const out: Athlete[] = [];

  for (const role of sport.roles.roles.slice(0, size)) {
    const id = squad.starters[role.id];
    const athlete = id === undefined ? undefined : byId.get(id);
    if (athlete === undefined) return null;
    out.push(athlete);
  }
  return out;
}

function countPlaced(squad: Squad, sport: SportModule): number {
  return sport.roles.roles.filter((role) => {
    const id = squad.starters[role.id];
    return id !== undefined && id !== '';
  }).length;
}

/**
 * The first `size` athletes, for a player who has never made a lineup.
 *
 * `09` §2 does not promise a managed squad before a first match, and "build a lineup first" is a
 * worse opening than a match with the athletes you happen to own.
 */
function firstFit(all: readonly Athlete[], size: number): readonly Athlete[] | null {
  return all.length < size ? null : all.slice(0, size);
}

export function isRosterProblem(value: ResolvedRosters | RosterProblem): value is RosterProblem {
  return 'heading' in value;
}
