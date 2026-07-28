/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.10 — Roster browser: search, sort, filter, bulk select
 * @story   US-5.5 — Edit and delete profiles
 * @design  10-ui-ux.md §7 (screen map), §10 (states that are usually forgotten), §11 (accessibility)
 * @invariant INV-3 (all storage through src/storage/)
 *
 * Purpose: the screen behind `#/squad` — `10` §7's "Roster (browse/search/filter)". It owns the
 * search box, the sort and filter controls, and a selection mode for bulk delete, but computes
 * none of the filtering or sorting itself: that is `roster-query.ts`, tested on its own so this
 * file only has to wire state to it and to the DOM.
 *
 * Bulk delete is the one destructive action here, so it gets the two things US-5.5 asks for that
 * are easy to skip under time pressure: a confirmation dialog naming what will happen, and an
 * undo offered immediately after — wired to `AthleteRepository.restore`, which is why `deleteMany`
 * returns what it removed rather than just how many.
 */
import {
  filterRoster,
  rosterCounts,
  sortRoster,
  type RosterFilter,
  type SortDirection,
  type SortKey,
} from '../../athletes/roster-query.ts';
import type { DeletedAthlete } from '../../athletes/repository.ts';
import { humanise } from '../../athletes/explain.ts';
import { RARITIES, type Athlete, type Rarity } from '../../athletes/types.ts';
import { RATEABLE_SPORTS, sportsForAthlete } from '../../sports/catalogue.ts';
import type { SportId } from '../../sports/types.ts';
import { appDatabase, type AppDatabase } from '../../storage/app-db.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { athleteCardCompact } from '../components/athlete-card.ts';
import { button } from '../components/button.ts';
import { segmented, switchControl } from '../components/controls.ts';
import { dialog, toast } from '../components/feedback.ts';
import { emptyState, errorState, skeleton } from '../components/states.ts';
import { el } from '../dom.ts';
import '../components/athlete-card.css';
import './roster.css';

const SORT_OPTIONS: ReadonlyArray<{ readonly value: SortKey; readonly label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'rating', label: 'Rating' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'recent', label: 'Recently added' },
  { value: 'familiarity', label: 'Familiarity' },
];

const SANDBOX_OPTIONS: ReadonlyArray<{
  readonly value: RosterFilter['sandbox'] & string;
  readonly label: string;
}> = [
  { value: 'include', label: 'All' },
  { value: 'exclude', label: 'Fair only' },
  { value: 'only', label: 'Sandbox only' },
];

/** Shows `dialog()` on a real browser; jsdom has no `showModal`, so this degrades to `open`. */
function openDialog(node: HTMLDialogElement): void {
  if (typeof node.showModal === 'function') node.showModal();
  else node.setAttribute('open', '');
}

function closeDialog(node: HTMLDialogElement): void {
  if (typeof node.close === 'function') node.close();
  else node.remove();
}

export function rosterScreen(): Screen {
  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      context.host.replaceChildren(skeleton(doc, { lines: 6, label: 'Loading your roster' }));

      let db: AppDatabase;
      let allAthletes: Athlete[];
      try {
        db = await appDatabase();
        allAthletes = await db.athletes.getAll();
      } catch (error) {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'That roster could not be opened',
            body: 'This build cannot read what is saved. Nothing has been changed or lost.',
            ...(error instanceof Error ? { detail: error.message } : {}),
          }),
        );
        return;
      }

      // ── Filter / sort / selection state ─────────────────────────────────
      let query = '';
      let sortKey: SortKey = 'name';
      let sortDirection: SortDirection = 'asc';
      const selectedSports = new Set<SportId>();
      const selectedRarities = new Set<Rarity>();
      let availableOnly = false;
      let sandboxMode: NonNullable<RosterFilter['sandbox']> = 'include';
      let selectionMode = false;
      const selectedIds = new Set<string>();

      function currentFilter(): RosterFilter {
        return {
          query,
          sports: [...selectedSports],
          rarities: [...selectedRarities],
          availableOnly,
          sandbox: sandboxMode,
        };
      }

      function hasActiveFilters(): boolean {
        return (
          query.trim() !== '' ||
          selectedSports.size > 0 ||
          selectedRarities.size > 0 ||
          availableOnly ||
          sandboxMode !== 'include'
        );
      }

      function visibleAthletes(): Athlete[] {
        const filtered = filterRoster(allAthletes, currentFilter(), Date.now());
        const sortSport = selectedSports.size === 1 ? [...selectedSports][0] : undefined;
        return sortRoster(filtered, sortKey, sortDirection, sortSport);
      }

      // ── Toolbar: search ──────────────────────────────────────────────────
      const searchInput = el(doc, 'input', {
        class: 'text-input roster__search',
        attrs: {
          type: 'search',
          id: 'roster-search',
          placeholder: 'Search by name',
          autocomplete: 'off',
        },
      }) as HTMLInputElement;
      searchInput.addEventListener('input', () => {
        query = searchInput.value;
        renderResults();
      });

      const searchField = el(doc, 'div', {
        class: 'field roster__search-field',
        children: [
          el(doc, 'label', {
            class: 'sr-only',
            text: 'Search roster by name',
            attrs: { for: 'roster-search' },
          }),
          searchInput,
        ],
      });

      // ── Toolbar: sort ────────────────────────────────────────────────────
      const sortSelect = el(doc, 'select', {
        class: 'roster__sort-select',
        attrs: { id: 'roster-sort' },
        children: SORT_OPTIONS.map((option) =>
          el(doc, 'option', {
            text: option.label,
            attrs: { value: option.value, selected: option.value === sortKey },
          }),
        ),
      }) as HTMLSelectElement;
      sortSelect.addEventListener('change', () => {
        sortKey = sortSelect.value as SortKey;
        renderResults();
      });

      function sortDirectionLabel(): string {
        return sortDirection === 'asc' ? 'Sort ascending' : 'Sort descending';
      }

      const directionButton = button(doc, {
        label: sortDirectionLabel(),
        variant: 'secondary',
        onClick: () => {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
          const labelNode = directionButton.querySelector('.button__label');
          if (labelNode !== null) labelNode.textContent = sortDirectionLabel();
          renderResults();
        },
      });

      const sortField = el(doc, 'div', {
        class: 'field roster__sort-field',
        children: [
          el(doc, 'label', { text: 'Sort by', attrs: { for: 'roster-sort' } }),
          sortSelect,
          directionButton,
        ],
      });

      // ── Filters: sport, rarity, availability, sandbox ───────────────────
      const sportInputs = new Map<SportId, HTMLInputElement>();
      const sportFilterOptions = RATEABLE_SPORTS.map((sport) => {
        const id = `roster-filter-sport-${sport.id}`;
        const input = el(doc, 'input', {
          class: 'roster__filter-input',
          attrs: { type: 'checkbox', id },
        }) as HTMLInputElement;
        input.addEventListener('change', () => {
          if (input.checked) selectedSports.add(sport.id);
          else selectedSports.delete(sport.id);
          renderResults();
        });
        sportInputs.set(sport.id, input);
        return el(doc, 'label', {
          class: 'roster__filter-option',
          attrs: { for: id },
          children: [input, el(doc, 'span', { text: sport.displayName })],
        });
      });

      const rarityInputs = new Map<Rarity, HTMLInputElement>();
      const rarityFilterOptions = RARITIES.map((rarity) => {
        const id = `roster-filter-rarity-${rarity}`;
        const input = el(doc, 'input', {
          class: 'roster__filter-input',
          attrs: { type: 'checkbox', id },
        }) as HTMLInputElement;
        input.addEventListener('change', () => {
          if (input.checked) selectedRarities.add(rarity);
          else selectedRarities.delete(rarity);
          renderResults();
        });
        rarityInputs.set(rarity, input);
        return el(doc, 'label', {
          class: 'roster__filter-option',
          attrs: { for: id },
          children: [input, el(doc, 'span', { text: humanise(rarity) })],
        });
      });

      const availableSwitch = switchControl(doc, {
        label: 'Available only',
        description: 'Hide athletes who are injured or suspended right now.',
        checked: false,
        onChange: (checked) => {
          availableOnly = checked;
          renderResults();
        },
      });

      const sandboxSegmented = segmented(doc, {
        legend: 'Sandbox athletes',
        name: 'roster-sandbox',
        options: SANDBOX_OPTIONS,
        value: sandboxMode,
        onChange: (value) => {
          sandboxMode = value;
          renderResults();
        },
      });

      const clearFiltersButton = button(doc, {
        label: 'Clear search and filters',
        variant: 'ghost',
        onClick: () => clearFilters(),
      });

      function clearFilters(): void {
        query = '';
        searchInput.value = '';
        selectedSports.clear();
        selectedRarities.clear();
        availableOnly = false;
        sandboxMode = 'include';

        for (const input of sportInputs.values()) input.checked = false;
        for (const input of rarityInputs.values()) input.checked = false;
        const availableInput = availableSwitch.querySelector(
          '.switch__input',
        ) as HTMLInputElement | null;
        if (availableInput !== null) {
          availableInput.checked = false;
          availableInput.setAttribute('aria-checked', 'false');
        }
        sandboxSegmented
          .querySelectorAll<HTMLInputElement>('input[type="radio"]')
          .forEach((radio) => (radio.checked = radio.value === 'include'));

        renderResults();
      }

      const filterPanel = el(doc, 'section', {
        class: 'panel roster__filters',
        children: [
          el(doc, 'h2', { class: 'panel__title', text: 'Filter' }),
          el(doc, 'fieldset', {
            class: 'roster__filter-group',
            children: [el(doc, 'legend', { text: 'Primary sport' }), ...sportFilterOptions],
          }),
          el(doc, 'fieldset', {
            class: 'roster__filter-group',
            children: [el(doc, 'legend', { text: 'Rarity' }), ...rarityFilterOptions],
          }),
          availableSwitch,
          sandboxSegmented,
          clearFiltersButton,
        ],
      });

      // ── Selection mode ───────────────────────────────────────────────────
      function updateSelectModeButton(): void {
        const labelNode = selectModeButton.querySelector('.button__label');
        if (labelNode !== null)
          labelNode.textContent = selectionMode ? 'Cancel selection' : 'Select';
      }

      const selectModeButton = button(doc, {
        label: 'Select',
        variant: 'secondary',
        onClick: () => {
          selectionMode = !selectionMode;
          if (!selectionMode) selectedIds.clear();
          updateSelectModeButton();
          renderResults();
        },
      });

      const selectionBar = el(doc, 'div', { class: 'roster__selection-bar' });
      const toastHost = el(doc, 'div', { class: 'roster__toast-host' });

      function updateSelectionBar(visible: readonly Athlete[]): void {
        if (!selectionMode) {
          selectionBar.replaceChildren();
          selectionBar.hidden = true;
          return;
        }
        selectionBar.hidden = false;

        const visibleIds = new Set(visible.map((athlete) => athlete.id));
        const allVisibleSelected =
          visible.length > 0 && visible.every((a) => selectedIds.has(a.id));

        const selectAllInput = el(doc, 'input', {
          attrs: { type: 'checkbox', id: 'roster-select-all', checked: allVisibleSelected },
        }) as HTMLInputElement;
        selectAllInput.addEventListener('change', () => {
          if (selectAllInput.checked) for (const athlete of visible) selectedIds.add(athlete.id);
          else for (const id of visibleIds) selectedIds.delete(id);
          renderResults();
        });

        const count = selectedIds.size;

        selectionBar.replaceChildren(
          el(doc, 'label', {
            class: 'roster__select-all',
            attrs: { for: 'roster-select-all' },
            children: [selectAllInput, el(doc, 'span', { text: 'Select all shown' })],
          }),
          // The live selection count — screen readers hear it change without a page announcement.
          el(doc, 'span', {
            class: 'roster__selection-count',
            attrs: { role: 'status', 'aria-live': 'polite' },
            text: count === 0 ? 'No athletes selected' : `${count} selected`,
          }),
          button(doc, {
            label: count === 1 ? 'Delete selected' : `Delete ${count} selected`,
            variant: 'destructive',
            disabled: count === 0,
            onClick: () => confirmBulkDelete(),
          }),
        );
      }

      function confirmBulkDelete(): void {
        const ids = [...selectedIds];
        if (ids.length === 0) return;

        const dialogNode = dialog(doc, {
          title: ids.length === 1 ? 'Delete this athlete?' : `Delete ${ids.length} athletes?`,
          body: 'You can undo this right after deleting, but not once you leave this screen.',
          actions: [
            { label: 'Cancel', variant: 'secondary', onSelect: () => closeDialog(dialogNode) },
            {
              label: 'Delete',
              variant: 'destructive',
              onSelect: () => {
                closeDialog(dialogNode);
                void performBulkDelete(ids);
              },
            },
          ],
          onDismiss: () => closeDialog(dialogNode),
        });
        dialogNode.addEventListener('close', () => dialogNode.remove());
        doc.body.appendChild(dialogNode);
        openDialog(dialogNode);
      }

      async function performBulkDelete(ids: readonly string[]): Promise<void> {
        let deleted: DeletedAthlete[];
        try {
          deleted = await db.athletes.deleteMany(ids);
        } catch {
          toastHost.replaceChildren(
            toast(doc, {
              message: 'Could not delete — this build cannot write to storage right now.',
              tone: 'danger',
            }),
          );
          return;
        }

        const removedIds = new Set(deleted.map((entry) => entry.athlete.id));
        allAthletes = allAthletes.filter((athlete) => !removedIds.has(athlete.id));
        for (const id of removedIds) selectedIds.delete(id);
        selectionMode = false;
        updateSelectModeButton();
        renderResults();

        const count = deleted.length;
        if (count === 0) return;
        toastHost.replaceChildren(
          toast(doc, {
            message:
              count === 1
                ? `${deleted[0]!.athlete.displayName} deleted.`
                : `${count} athletes deleted.`,
            action: { label: 'Undo', onSelect: () => void undoDelete(deleted) },
          }),
        );
      }

      async function undoDelete(deleted: readonly DeletedAthlete[]): Promise<void> {
        try {
          for (const record of deleted) await db.athletes.restore(record);
        } catch {
          toastHost.replaceChildren(
            toast(doc, {
              message: 'Could not undo — this build cannot write to storage right now.',
              tone: 'danger',
            }),
          );
          return;
        }
        for (const record of deleted) allAthletes.push(record.athlete);
        toastHost.replaceChildren(
          toast(doc, {
            message:
              deleted.length === 1 ? 'Athlete restored.' : `${deleted.length} athletes restored.`,
            tone: 'success',
          }),
        );
        renderResults();
      }

      // ── Rows and results ─────────────────────────────────────────────────
      function rosterRow(athlete: Athlete): HTMLElement {
        const sports = sportsForAthlete(athlete.primarySport);
        const available = sports.length === 0 ? RATEABLE_SPORTS : sports;
        const card = athleteCardCompact(doc, { athlete, sports: available });
        const link = el(doc, 'a', {
          class: 'roster__card-link',
          attrs: { href: `#/squad/athlete/${athlete.id}` },
          children: [card],
        });

        const children: HTMLElement[] = [];
        if (selectionMode) {
          const checkboxId = `roster-select-${athlete.id}`;
          const checkbox = el(doc, 'input', {
            attrs: {
              type: 'checkbox',
              id: checkboxId,
              checked: selectedIds.has(athlete.id),
              'aria-label': `Select ${athlete.displayName}`,
            },
          }) as HTMLInputElement;
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) selectedIds.add(athlete.id);
            else selectedIds.delete(athlete.id);
            updateSelectionBar(visibleAthletes());
          });
          children.push(
            el(doc, 'label', {
              class: 'roster__select',
              attrs: { for: checkboxId },
              children: [checkbox],
            }),
          );
        }
        children.push(link);

        return el(doc, 'li', {
          class: 'roster__row',
          dataset: { selected: String(selectedIds.has(athlete.id)) },
          children,
        });
      }

      const resultsHost = el(doc, 'div', { class: 'roster__results' });

      function renderResults(): void {
        if (allAthletes.length === 0) {
          selectionMode = false;
          resultsHost.replaceChildren(
            emptyState(doc, {
              heading: 'No athletes yet',
              body: 'Create your first athlete to start building a roster.',
              action: {
                label: 'Create athlete',
                onSelect: () => context.navigate('/squad/athlete/new'),
              },
            }),
          );
          updateSelectionBar([]);
          return;
        }

        const visible = visibleAthletes();
        if (visible.length === 0) {
          resultsHost.replaceChildren(
            emptyState(doc, {
              heading: 'No matches',
              body: 'Nothing in your roster matches this search and these filters.',
              action: { label: 'Clear search and filters', onSelect: () => clearFilters() },
            }),
          );
          updateSelectionBar([]);
          return;
        }

        const counts = rosterCounts(allAthletes, Date.now());
        const summary = el(doc, 'p', {
          class: 'roster__summary',
          text: hasActiveFilters()
            ? `Showing ${visible.length} of ${counts.total} athletes.`
            : `${counts.total} athlete${counts.total === 1 ? '' : 's'}.`,
        });

        const list = el(doc, 'ul', {
          class: 'roster__list',
          children: visible.map((athlete) => rosterRow(athlete)),
        });

        resultsHost.replaceChildren(summary, list);
        updateSelectionBar(visible);
      }

      // ── Layout ───────────────────────────────────────────────────────────
      selectionBar.hidden = true;

      context.host.replaceChildren(
        el(doc, 'div', {
          class: 'roster',
          children: [
            el(doc, 'header', {
              class: 'roster__header',
              children: [
                el(doc, 'h1', { class: 'roster__title', text: 'Your squad' }),
                button(doc, {
                  label: 'Create athlete',
                  variant: 'primary',
                  href: '#/squad/athlete/new',
                }),
              ],
            }),
            el(doc, 'div', {
              class: 'roster__toolbar',
              children: [searchField, sortField, selectModeButton],
            }),
            filterPanel,
            selectionBar,
            toastHost,
            resultsHost,
          ],
        }),
      );

      renderResults();
    },
  };
}
