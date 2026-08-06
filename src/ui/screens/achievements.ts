/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.9 — Achievement UI: gallery, filters, progress bars, in-match toast, post-match
 *          summary
 * @story   US-8.2 — Browse my achievements
 * @design  10-ui-ux.md §7 (Progress → Achievements), §10 (states), §11 (accessibility),
 *          05-data-model.md §6
 * @invariant INV-11 (locked and unlocked are words, and every control has a real label)
 *
 * Purpose: the gallery. Every achievement in the build, what it is worth, and how far along it is.
 *
 * **Locked achievements are shown, not hidden.** A gallery that only listed what you had already
 * done would be a trophy cabinet; this is also the list of things worth trying, which is where the
 * cross-sport ones earn their place. Hidden ones appear as "???" — present, so the count is honest,
 * and undescribed, so the surprise survives.
 *
 * **The filters are `<select>`s.** Three of them, each with a real `<label>`: category, sport, and
 * completion. A row of toggle chips would look better and would be worse — a select is one tap, is
 * announced properly, and does not wrap into four lines on a 360 px screen (`10` §11).
 *
 * **The counter is the point of the screen.** "23 of 79 — 4 500 coins earned" is what a player comes
 * here for, and it is above the filters so that narrowing the list never hides the total.
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { ACHIEVEMENTS } from '../../achievements/registry.ts';
import {
  lockedRecord,
  type AchievementDef,
  type AchievementRecord,
} from '../../achievements/types.ts';
import { achievementRow } from '../components/achievement.ts';
import { emptyState, errorState } from '../components/states.ts';
import { el } from '../dom.ts';
import './achievements.css';

/** Category ids to the words the filter shows. `05` §6's list, in the order it reads best. */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  onboarding: 'Getting started',
  basketball: 'Basketball',
  soccer: 'Soccer',
  hockey: 'Hockey',
  football: 'Football',
  crossSport: 'Cross-sport',
  difficulty: 'Difficulty',
  collection: 'Collection',
  economy: 'Economy',
  p2p: 'Peer-to-peer',
};

/** Which sport a category belongs to, for the sport filter. */
const CATEGORY_SPORT: Readonly<Record<string, string>> = {
  basketball: 'basketball',
  soccer: 'soccer',
  hockey: 'hockey',
  football: 'football',
};

export type CompletionFilter = 'all' | 'unlocked' | 'locked';

export interface GalleryFilters {
  readonly category: string;
  readonly sport: string;
  readonly completion: CompletionFilter;
}

export const ALL_FILTERS: GalleryFilters = { category: 'all', sport: 'all', completion: 'all' };

/** The rows a set of filters selects, in registry order so the gallery never reshuffles. */
export function filterAchievements(
  defs: readonly AchievementDef[],
  records: ReadonlyMap<string, AchievementRecord>,
  filters: GalleryFilters,
): AchievementDef[] {
  return defs.filter((def) => {
    if (filters.category !== 'all' && def.category !== filters.category) return false;
    if (filters.sport !== 'all' && CATEGORY_SPORT[def.category] !== filters.sport) return false;
    if (filters.completion === 'all') return true;

    const unlocked = (records.get(def.id) ?? lockedRecord(def.id)).unlockedAt !== null;
    return filters.completion === 'unlocked' ? unlocked : !unlocked;
  });
}

/** "23 of 79 unlocked · 4 500 coins earned". The line the screen exists to show. */
export function summaryLine(
  defs: readonly AchievementDef[],
  records: ReadonlyMap<string, AchievementRecord>,
): string {
  let unlocked = 0;
  let coins = 0;
  for (const def of defs) {
    const record = records.get(def.id);
    if (record?.unlockedAt === undefined || record.unlockedAt === null) continue;
    unlocked += 1;
    coins += def.reward.coins ?? 0;
  }
  return `${unlocked} of ${defs.length} unlocked · ${coins.toLocaleString('en-US')} coins earned`;
}

function select(
  doc: Document,
  id: string,
  label: string,
  options: readonly (readonly [string, string])[],
  value: string,
  onChange: (next: string) => void,
): HTMLElement {
  const field = el(doc, 'select', {
    class: 'achievements__select',
    attrs: { id },
    on: {
      change: (event) => onChange((event.target as HTMLSelectElement).value),
    },
    children: options.map(([optionValue, text]) =>
      el(doc, 'option', { text, attrs: { value: optionValue, selected: optionValue === value } }),
    ),
  });

  return el(doc, 'div', {
    class: 'achievements__filter',
    children: [el(doc, 'label', { text: label, attrs: { for: id } }), field],
  });
}

export function achievementsScreen(): Screen {
  return {
    async mount({ host }: ScreenContext): Promise<void> {
      const doc = host.ownerDocument;

      let records: Map<string, AchievementRecord>;
      try {
        records = await (await appDatabase()).achievements.byId();
      } catch {
        host.replaceChildren(
          errorState(doc, {
            heading: 'Your achievements could not be read',
            body: 'Try again, or repair the app from Settings. Nothing you have unlocked is lost.',
            action: { label: 'Back to Progress', href: '#/progress' },
          }),
        );
        return;
      }

      let filters: GalleryFilters = ALL_FILTERS;

      // Only the categories this build actually has content for, so the filter never offers a
      // choice that selects nothing.
      const categories = [...new Set(ACHIEVEMENTS.map((def) => def.category))];
      const sports = [...new Set(Object.values(CATEGORY_SPORT))].filter((sport) =>
        ACHIEVEMENTS.some((def) => CATEGORY_SPORT[def.category] === sport),
      );

      const list = el(doc, 'ul', { class: 'achievement-list' });
      const summary = el(doc, 'p', { class: 'achievements__summary' });

      const render = (): void => {
        summary.textContent = summaryLine(ACHIEVEMENTS, records);

        const shown = filterAchievements(ACHIEVEMENTS, records, filters);
        if (shown.length === 0) {
          list.replaceChildren(
            el(doc, 'li', {
              class: 'achievements__none',
              text: 'Nothing matches those filters yet.',
            }),
          );
          return;
        }

        list.replaceChildren(
          ...shown.map((def) =>
            achievementRow(doc, { def, record: records.get(def.id) ?? lockedRecord(def.id) }),
          ),
        );
      };

      const update = (patch: Partial<GalleryFilters>): void => {
        filters = { ...filters, ...patch };
        render();
      };

      const controls = el(doc, 'div', {
        class: 'achievements__filters',
        children: [
          select(
            doc,
            'achievements-category',
            'Category',
            [
              ['all', 'Every category'],
              ...categories.map(
                (category) => [category, CATEGORY_LABELS[category] ?? category] as const,
              ),
            ],
            filters.category,
            (category) => update({ category }),
          ),
          select(
            doc,
            'achievements-sport',
            'Sport',
            [
              ['all', 'Every sport'],
              ...sports.map((sport) => [sport, CATEGORY_LABELS[sport] ?? sport] as const),
            ],
            filters.sport,
            (sport) => update({ sport }),
          ),
          select(
            doc,
            'achievements-completion',
            'Show',
            [
              ['all', 'All'],
              ['unlocked', 'Unlocked'],
              ['locked', 'Still to do'],
            ],
            filters.completion,
            (completion) => update({ completion: completion as CompletionFilter }),
          ),
        ],
      });

      if (ACHIEVEMENTS.length === 0) {
        host.replaceChildren(
          emptyState(doc, {
            heading: 'No achievements in this build',
            body: 'That is a bug rather than a state — please report it.',
          }),
        );
        return;
      }

      render();
      host.replaceChildren(
        el(doc, 'section', {
          class: 'achievements',
          children: [
            el(doc, 'h1', { class: 'achievements__title', text: 'Achievements' }),
            summary,
            controls,
            list,
          ],
        }),
      );
    },
  };
}
