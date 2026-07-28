/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.16 — Roster and full-backup export/import with version checks and change preview
 * @story   US-5.8 — Export and import my roster
 * @story   US-12.1 — Back up and restore everything
 * @design  05-data-model.md §1 (storage overview), §9 (migrations), 04-architecture.md §7
 * @invariant INV-3 (all storage through src/storage/)
 *
 * Purpose: one file that contains everything, and the rules for putting it back.
 *
 * US-12.1 asks for three things, and each one is a rule here rather than a suggestion in the UI:
 * a backup carries its schema version; an import *previews what will change* and requires
 * confirmation; and a backup from a newer build is rejected with a clear message rather than
 * partially applied. That last one is `05` §9 rule 4, and it is the reason `restore` computes the
 * whole change set before it writes a single record — a half-applied backup is worse than a
 * refused one, and the only way to be sure is to decide everything first.
 *
 * The preview is deliberately computed from the same function the restore uses. A preview that
 * said one thing and a restore that did another would be the worst possible bug in a data-safety
 * feature, so there is only one code path and the preview is the dry run of it.
 */
import { STORES, type Database, type StoreName } from './idb.ts';
import { CURRENT_SCHEMA_VERSION } from './migrations.ts';

/** Bumped when the *envelope* changes, independently of the data schema inside it. */
export const BACKUP_FORMAT_VERSION = 1;

export interface Backup {
  readonly formatVersion: number;
  /** The data schema version, so the migration chain can be run on import (`05` §9 rule 4). */
  readonly schemaVersion: number;
  readonly createdAt: number;
  readonly app: string;
  /** Store name → its records. Keyless singleton stores hold exactly one. */
  readonly stores: Readonly<Record<string, readonly unknown[]>>;
}

/** Stores keyed by an explicit key rather than a keyPath (`05` §1). */
const KEYLESS: ReadonlySet<string> = new Set(
  STORES.filter((store) => store.keyPath === null).map((store) => store.name),
);

/** Everything, in one object. Sized for a personal roster, not a warehouse. */
export async function exportBackup(
  db: Database,
  options: { readonly now?: number; readonly app?: string } = {},
): Promise<Backup> {
  const stores: Record<string, unknown[]> = {};

  for (const spec of STORES) {
    const name = spec.name as StoreName;
    if (KEYLESS.has(name)) {
      const value = await db.get<unknown>(name, name);
      stores[name] = value === undefined ? [] : [value];
    } else {
      stores[name] = await db.getAll<unknown>(name);
    }
  }

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    createdAt: options.now ?? Date.now(),
    app: options.app ?? 'sport-game',
    stores,
  };
}

/** Just the roster and the teams that hold it — US-5.8's narrower export. */
export async function exportRoster(
  db: Database,
  options: { readonly now?: number } = {},
): Promise<Backup> {
  const full = await exportBackup(db, options);
  const kept = new Set(['athletes', 'teams', 'squads']);

  return {
    ...full,
    stores: Object.fromEntries(Object.entries(full.stores).filter(([name]) => kept.has(name))),
  };
}

export type BackupProblem =
  | { readonly kind: 'not-json'; readonly message: string }
  | { readonly kind: 'not-a-backup'; readonly message: string }
  | {
      readonly kind: 'too-new';
      readonly message: string;
      readonly found: number;
      readonly supported: number;
    };

export interface StoreChange {
  readonly store: string;
  /** Records in the backup that this database does not have. */
  readonly added: number;
  /** Records the backup would overwrite with different content. */
  readonly replaced: number;
  /** Records present and identical — nothing to do. */
  readonly unchanged: number;
  /** Records here that the backup does not mention. Restore leaves them alone; see `mode`. */
  readonly notInBackup: number;
}

export interface BackupPreview {
  readonly backup: Backup;
  readonly changes: readonly StoreChange[];
  readonly totalAdded: number;
  readonly totalReplaced: number;
  readonly totalUnchanged: number;
  /** True when applying this backup would change nothing at all. */
  readonly noOp: boolean;
}

/**
 * Reads a backup file. Every failure is a value, not an exception — this is the one screen in the
 * app where an unhandled throw would leave someone staring at a broken page holding the only copy
 * of their data.
 */
export function parseBackup(text: string): { backup: Backup } | { problem: BackupProblem } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      problem: {
        kind: 'not-json',
        message: 'That file is not readable as JSON. It may be damaged or may not be a backup.',
      },
    };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { problem: { kind: 'not-a-backup', message: 'That file is not a Sport-Game backup.' } };
  }

  const candidate = raw as Partial<Backup>;
  if (
    typeof candidate.formatVersion !== 'number' ||
    typeof candidate.schemaVersion !== 'number' ||
    typeof candidate.stores !== 'object' ||
    candidate.stores === null
  ) {
    return { problem: { kind: 'not-a-backup', message: 'That file is not a Sport-Game backup.' } };
  }

  // `05` §9 rule 4: reject clearly rather than partially apply. A forward-only chain cannot undo
  // what it has never heard of, so a newer backup is refused whole.
  if (candidate.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      problem: {
        kind: 'too-new',
        message:
          'That backup was made by a newer version of the app. Update first, then import it — ' +
          'nothing has been changed.',
        found: candidate.schemaVersion,
        supported: CURRENT_SCHEMA_VERSION,
      },
    };
  }

  if (candidate.formatVersion > BACKUP_FORMAT_VERSION) {
    return {
      problem: {
        kind: 'too-new',
        message:
          'That backup file is in a newer format than this build understands. Update first — ' +
          'nothing has been changed.',
        found: candidate.formatVersion,
        supported: BACKUP_FORMAT_VERSION,
      },
    };
  }

  return {
    backup: {
      formatVersion: candidate.formatVersion,
      schemaVersion: candidate.schemaVersion,
      createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : 0,
      app: typeof candidate.app === 'string' ? candidate.app : 'sport-game',
      stores: candidate.stores as Readonly<Record<string, readonly unknown[]>>,
    },
  };
}

function keyOf(store: string, record: unknown): string | null {
  if (KEYLESS.has(store)) return store;
  if (typeof record !== 'object' || record === null) return null;

  const spec = STORES.find((entry) => entry.name === store);
  const keyPath = spec?.keyPath;
  if (typeof keyPath !== 'string') return null;

  const value = (record as Record<string, unknown>)[keyPath];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

/**
 * What restoring this backup would do, per store. Computed from the live database, so the numbers
 * a person confirms are the numbers they will get (US-12.1 — "a preview of what will change").
 */
export async function previewBackup(db: Database, backup: Backup): Promise<BackupPreview> {
  const changes: StoreChange[] = [];

  for (const spec of STORES) {
    const name = spec.name as StoreName;
    const incoming = backup.stores[name] ?? [];

    const existing = new Map<string, unknown>();
    if (KEYLESS.has(name)) {
      const value = await db.get<unknown>(name, name);
      if (value !== undefined) existing.set(name, value);
    } else {
      for (const record of await db.getAll<unknown>(name)) {
        const key = keyOf(name, record);
        if (key !== null) existing.set(key, record);
      }
    }

    let added = 0;
    let replaced = 0;
    let unchanged = 0;
    const seen = new Set<string>();

    for (const record of incoming) {
      const key = keyOf(name, record);
      if (key === null) continue;
      seen.add(key);

      const current = existing.get(key);
      if (current === undefined) added++;
      else if (JSON.stringify(current) === JSON.stringify(record)) unchanged++;
      else replaced++;
    }

    const notInBackup = [...existing.keys()].filter((key) => !seen.has(key)).length;
    if (added + replaced + unchanged + notInBackup === 0) continue;

    changes.push({ store: name, added, replaced, unchanged, notInBackup });
  }

  const totalAdded = changes.reduce((sum, c) => sum + c.added, 0);
  const totalReplaced = changes.reduce((sum, c) => sum + c.replaced, 0);
  const totalUnchanged = changes.reduce((sum, c) => sum + c.unchanged, 0);

  return {
    backup,
    changes,
    totalAdded,
    totalReplaced,
    totalUnchanged,
    noOp: totalAdded === 0 && totalReplaced === 0,
  };
}

/**
 * `merge` leaves records the backup does not mention alone; `replace` clears each store the backup
 * covers first. Merge is the default because it is the recoverable one — a merge that was meant to
 * be a replace leaves extra athletes, and a replace that was meant to be a merge loses them.
 */
export type RestoreMode = 'merge' | 'replace';

export async function restoreBackup(
  db: Database,
  backup: Backup,
  mode: RestoreMode = 'merge',
): Promise<BackupPreview> {
  // Decided in full before anything is written: `05` §9 rule 4's principle, applied to backups.
  const preview = await previewBackup(db, backup);

  for (const spec of STORES) {
    const name = spec.name as StoreName;
    const incoming = backup.stores[name];
    if (incoming === undefined) continue;

    if (mode === 'replace') await db.clear(name);

    if (KEYLESS.has(name)) {
      const value = incoming[0];
      if (value !== undefined) await db.put(name, value, name);
      continue;
    }

    const entries = incoming
      .filter((record) => keyOf(name, record) !== null)
      .map((record) => ({ value: record }));
    if (entries.length > 0) await db.putMany(name, entries);
  }

  return preview;
}

/** A filename that sorts chronologically and says what it is. */
export function backupFilename(now: number): string {
  const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `sport-game-backup-${stamp}.json`;
}

export function serialiseBackup(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}
