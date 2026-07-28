/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.11 — Teams: create/edit, name, colours, generic crests
 * @story   US-6.1 — Build a team
 * @design  10-ui-ux.md §7 (screen map), §10 (states that are usually forgotten), §11 (accessibility)
 *
 * Purpose: the team list behind `#/squad/teams`. Each row shows what US-6.1 asks a team to carry —
 * name, crest, and a per-sport squad status — and the screen owns the states `10` §10 calls out:
 * loading, empty, and a database this build cannot read.
 *
 * Deletion takes every squad the team owns with it (`TeamRepository.delete`), which is exactly the
 * kind of change a tap can't easily undo by re-doing it — so this is one of the few places in the
 * app that offers a real undo, wired straight to `TeamRepository.restore`.
 */
import { RATEABLE_SPORTS } from '../../sports/catalogue.ts';
import type { SportId } from '../../sports/types.ts';
import { appDatabase, type AppDatabase } from '../../storage/app-db.ts';
import { filledSlots, squadIsValid, type Squad, type Team } from '../../teams/types.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { el } from '../dom.ts';
import { crest } from '../components/crest.ts';
import { button } from '../components/button.ts';
import { emptyState, errorState, skeleton } from '../components/states.ts';
import { dialog, toast } from '../components/feedback.ts';
import './teams.css';

// Authentic squad sizes (`07-decisions.md` §D-03 — 5v5 basketball, 11v11 soccer). Kept as a small
// local table rather than reading `SportMeta.squadSize` off each sport's full `SportModule`: that
// interface also drags in the sim's engine and renderer types (`04` §5), which this list screen has
// no business importing just to print a fraction. A sport with no entry here shows a plain count
// instead of a "x of y" — honest about not knowing the target rather than guessing one.
const SQUAD_SIZE: Readonly<Partial<Record<SportId, number>>> = {
  basketball: 5,
  soccer: 11,
};

// How long an "undo" toast stays up before the delete becomes final in the UI. The record itself
// isn't purged after this — the user can still get it back via Data & Backup — but the on-screen
// offer has to end sometime or it would sit there forever.
const UNDO_TOAST_MS = 8000;

interface SquadStatus {
  readonly sportName: string;
  readonly text: string;
  readonly ready: boolean;
}

function squadStatus(sportName: string, squad: Squad | undefined, squadSize?: number): SquadStatus {
  const filled = squad === undefined ? 0 : filledSlots(squad);

  if (filled === 0) {
    return { sportName, text: 'No lineup yet', ready: false };
  }
  if (squadSize === undefined) {
    return { sportName, text: `${filled} named`, ready: false };
  }

  const ready = squad !== undefined && squadIsValid(squad, squadSize);
  return { sportName, text: `${filled} of ${squadSize}${ready ? ' — ready' : ''}`, ready };
}

function openDialog(node: HTMLDialogElement): void {
  node.setAttribute('open', '');
  if (typeof node.showModal === 'function') {
    try {
      node.showModal();
    } catch {
      // Already open, or this environment's <dialog> is a stub — the `open` attribute above is
      // what actually makes it visible either way.
    }
  }
}

function closeDialog(node: HTMLDialogElement, host: HTMLElement): void {
  if (typeof node.close === 'function') {
    try {
      node.close();
    } catch {
      // Not open — nothing to do.
    }
  }
  host.replaceChildren();
}

export function teamsScreen(): Screen {
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      context.host.replaceChildren(skeleton(doc, { lines: 4, label: 'Loading your teams' }));

      let db: AppDatabase;
      try {
        db = await appDatabase();
      } catch (error) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'Your teams could not be opened',
            body: 'This build cannot read what is saved. Nothing has been changed or lost.',
            ...(error instanceof Error ? { detail: error.message } : {}),
          }),
        );
        return;
      }

      const toastHost = el(doc, 'div', {
        class: 'teams-screen__toast-host',
        attrs: { 'aria-live': 'polite' },
      });
      const dialogHost = el(doc, 'div', { class: 'teams-screen__dialog-host' });

      function showUndoToast(message: string, onUndo: () => void): void {
        if (toastTimer !== null) clearTimeout(toastTimer);
        toastHost.replaceChildren(
          toast(doc, { message, tone: 'warning', action: { label: 'Undo', onSelect: onUndo } }),
        );
        toastTimer = setTimeout(() => toastHost.replaceChildren(), UNDO_TOAST_MS);
      }

      async function performDelete(team: Team): Promise<void> {
        const deleted = await db.teams.delete(team.id);
        if (deleted === undefined) return;
        await render();
        showUndoToast(
          `${team.name} deleted, and its lineups with it.`,
          () => void undoDelete(deleted),
        );
      }

      async function undoDelete(deleted: { team: Team; squads: readonly Squad[] }): Promise<void> {
        await db.teams.restore(deleted);
        if (toastTimer !== null) clearTimeout(toastTimer);
        toastHost.replaceChildren();
        await render();
      }

      function confirmDelete(team: Team): void {
        const node = dialog(doc, {
          title: `Delete ${team.name}?`,
          body: 'This removes the team and every lineup it holds for every sport. You can undo right after.',
          actions: [
            {
              label: 'Cancel',
              variant: 'secondary',
              onSelect: () => closeDialog(node, dialogHost),
            },
            {
              label: 'Delete',
              variant: 'destructive',
              onSelect: () => {
                closeDialog(node, dialogHost);
                void performDelete(team);
              },
            },
          ],
          onDismiss: () => closeDialog(node, dialogHost),
        });
        dialogHost.replaceChildren(node);
        openDialog(node);
      }

      function teamRow(team: Team, statuses: readonly SquadStatus[]): HTMLElement {
        return el(doc, 'li', {
          class: 'teams-list__item',
          children: [
            el(doc, 'div', {
              class: 'teams-list__identity',
              children: [
                crest(doc, {
                  crestId: team.crestId,
                  colours: team.colours,
                  size: 56,
                  label: `${team.name} crest, ${team.crestId}`,
                }),
                el(doc, 'div', {
                  class: 'teams-list__names',
                  children: [
                    el(doc, 'h2', { class: 'teams-list__name', text: team.name }),
                    el(doc, 'span', { class: 'teams-list__short', text: team.shortName }),
                    team.editable
                      ? null
                      : el(doc, 'span', { class: 'teams-list__badge', text: 'CPU team' }),
                  ],
                }),
              ],
            }),
            el(doc, 'ul', {
              class: 'teams-list__statuses',
              children: statuses.map((status) =>
                el(doc, 'li', {
                  class: 'teams-list__status',
                  dataset: { ready: String(status.ready) },
                  text: `${status.sportName}: ${status.text}`,
                }),
              ),
            }),
            el(doc, 'div', {
              class: 'teams-list__actions',
              children: [
                button(doc, {
                  label: `Edit ${team.name}`,
                  variant: 'secondary',
                  onClick: () => context.navigate(`/squad/teams/${team.id}`),
                }),
                button(doc, {
                  label: `Delete ${team.name}`,
                  variant: 'destructive',
                  onClick: () => confirmDelete(team),
                }),
              ],
            }),
          ],
        });
      }

      async function render(): Promise<void> {
        let teams: Team[];
        try {
          teams = await db.teams.getAll();
        } catch (error) {
          context.host.replaceChildren(
            errorState(doc, {
              heading: 'Your teams could not be opened',
              body: 'This build cannot read what is saved. Nothing has been changed or lost.',
              ...(error instanceof Error ? { detail: error.message } : {}),
            }),
          );
          return;
        }

        const header = el(doc, 'header', {
          class: 'teams-screen__header',
          children: [
            el(doc, 'h1', { class: 'teams-screen__title', text: 'Teams' }),
            teams.length > 0
              ? button(doc, {
                  label: 'New team',
                  variant: 'primary',
                  onClick: () => context.navigate('/squad/teams/new'),
                })
              : null,
          ],
        });

        const body =
          teams.length === 0
            ? emptyState(doc, {
                heading: 'No teams yet',
                body: 'Build a team with a name, colours, and a crest, then set a lineup for each sport.',
                action: {
                  label: 'Create your first team',
                  onSelect: () => context.navigate('/squad/teams/new'),
                },
              })
            : el(doc, 'ul', {
                class: 'teams-list',
                children: await Promise.all(
                  teams.map(async (team) => {
                    const statuses = await Promise.all(
                      RATEABLE_SPORTS.map(async (sport) => {
                        const squad = await db.teams.squad(team.id, sport.id);
                        return squadStatus(sport.displayName, squad, SQUAD_SIZE[sport.id]);
                      }),
                    );
                    return teamRow(team, statuses);
                  }),
                ),
              });

        context.host.replaceChildren(
          el(doc, 'div', {
            class: 'teams-screen stack',
            children: [header, body, toastHost, dialogHost],
          }),
        );
      }

      await render();
    },

    unmount(): void {
      if (toastTimer !== null) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
    },
  };
}
