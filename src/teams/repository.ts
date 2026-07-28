/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.11 — Teams: create/edit, name, colours, generic crests
 * @task    T-3.12 — Lineup editor: formation diagram, drag-to-slot, position-fit warnings, auto-fill best
 * @story   US-6.1 — Build a team
 * @story   US-6.2 — Set a lineup
 * @design  05-data-model.md §1 (storage overview)
 * @invariant INV-3 (all storage through src/storage/)
 *
 * Purpose: the only way the app reads or writes teams and squads.
 *
 * Deleting a team deletes its squads in the *same transaction*. A team whose squads outlived it
 * would leave rows keyed to nothing, and the next lineup editor to open that sport would resurrect
 * a deleted team's lineup — the kind of orphan that is invisible until it is a bug report.
 */
import type { Database } from '../storage/idb.ts';
import type { SportId } from '../sports/types.ts';
import { squadKey, type Squad, type Team } from './types.ts';

export class TeamRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  get(id: string): Promise<Team | undefined> {
    return this.#db.get<Team>('teams', id);
  }

  getAll(): Promise<Team[]> {
    return this.#db.getAll<Team>('teams');
  }

  count(): Promise<number> {
    return this.#db.count('teams');
  }

  put(team: Team): Promise<void> {
    return this.#db.put('teams', team);
  }

  putMany(teams: readonly Team[]): Promise<void> {
    return this.#db.putMany(
      'teams',
      teams.map((team) => ({ value: team })),
    );
  }

  /** The team's squad in one sport, or `undefined` if it has never had a lineup there. */
  squad(teamId: string, sportId: SportId): Promise<Squad | undefined> {
    return this.#db.get<Squad>('squads', squadKey(teamId, sportId));
  }

  /** Every squad a team has, across sports. */
  squads(teamId: string): Promise<Squad[]> {
    return this.#db.getAllByIndex<Squad>('squads', 'byTeam', IDBKeyRange.only(teamId));
  }

  putSquad(squad: Squad): Promise<void> {
    return this.#db.put('squads', { ...squad, id: squadKey(squad.teamId, squad.sportId) });
  }

  /**
   * Deletes a team and every squad it owns, atomically. Returns what was removed so the caller can
   * offer undo, the same way deleting an athlete does.
   */
  async delete(id: string): Promise<{ team: Team; squads: Squad[] } | undefined> {
    const team = await this.get(id);
    if (team === undefined) return undefined;

    const squads = await this.squads(id);
    await this.#db.transaction(['teams', 'squads'], (tx) => {
      tx.objectStore('teams').delete(id);
      const store = tx.objectStore('squads');
      for (const squad of squads) store.delete(squad.id);
    });

    return { team, squads };
  }

  /** Restores a deleted team and its squads together. */
  async restore(deleted: { team: Team; squads: readonly Squad[] }): Promise<void> {
    await this.#db.transaction(['teams', 'squads'], (tx) => {
      tx.objectStore('teams').put(deleted.team);
      const store = tx.objectStore('squads');
      for (const squad of deleted.squads) store.put(squad);
    });
  }

  /**
   * Every squad naming this athlete. Selling or deleting an athlete has to know (US-9.3 —
   * "except ones locked in a squad, unless I confirm"), and asking each squad is correct at a
   * personal roster's size where an index on a nested array would not be.
   */
  async squadsContaining(athleteId: string): Promise<Squad[]> {
    const all = await this.#db.getAll<Squad>('squads');
    return all.filter(
      (squad) =>
        Object.values(squad.starters).includes(athleteId) || squad.bench.includes(athleteId),
    );
  }

  /**
   * Removes an athlete from every squad that names them. Called when an athlete is deleted, so a
   * lineup never points at a record that is gone.
   */
  async removeAthlete(athleteId: string, now = Date.now()): Promise<Squad[]> {
    const affected = await this.squadsContaining(athleteId);
    if (affected.length === 0) return [];

    const updated = affected.map((squad) => ({
      ...squad,
      starters: Object.fromEntries(
        Object.entries(squad.starters).filter(([, id]) => id !== athleteId),
      ),
      bench: squad.bench.filter((id) => id !== athleteId),
      updatedAt: now,
    }));

    await this.#db.putMany(
      'squads',
      updated.map((squad) => ({ value: squad })),
    );
    return updated;
  }

  clear(): Promise<void> {
    return this.#db.transaction(['teams', 'squads'], (tx) => {
      tx.objectStore('teams').clear();
      tx.objectStore('squads').clear();
    });
  }
}
