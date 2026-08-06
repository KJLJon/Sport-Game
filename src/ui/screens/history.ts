/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.5 — Stats store: match history, box scores, career stats per sport per mode
 * @story   US-10.4 — See my history and stats
 * @design  10-ui-ux.md §7 (screen map), §10 (the forgotten states), §11 (tables and headers)
 * @invariant INV-9 (the mode is shown, never branched on), INV-11 (no information by colour alone)
 *
 * Purpose: the Progress tab. Every match you have played, and what your athletes have done across
 * all of them.
 *
 * **This is the first screen behind that tab**; it was a "arrives in Phase 8" placeholder until now.
 *
 * **Everything is a real table.** A box score is tabular data and a screen reader should be able to
 * navigate it as one (`10` §11) — row and column headers, a caption naming the match. The result of
 * a match is the *word* "Won"/"Lost"/"Drew", never a green or red row: colour is decoration on top
 * of a sentence that already said it.
 *
 * **The mode is a column, not a filter that changes the maths.** A Playbook match and a Live match
 * are the same record computed the same way, and showing which is which is the only difference the
 * screen is allowed to make (INV-9).
 */
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { emptyState, errorState } from '../components/states.ts';
import { button } from '../components/button.ts';
import { el } from '../dom.ts';
import { buildCareers, percentage } from '../../stats/record.ts';
import { resultOf, type CareerLine, type MatchRecord } from '../../stats/types.ts';
import { playableSport } from '../../sports/playable.ts';
import './history.css';

const RESULT_WORDS: Readonly<Record<string, string>> = {
  win: 'Won',
  loss: 'Lost',
  draw: 'Drew',
};

/** A date a person can read, in their own locale, without a formatting library. */
function playedOn(playedAt: number): string {
  return new Date(playedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function sportName(sportId: string): string {
  try {
    return playableSport(sportId).displayName;
  } catch {
    // A record from a sport this build no longer has. Shown by its id rather than dropped: it is
    // still a match the player played.
    return sportId;
  }
}

function matchRow(doc: Document, record: MatchRecord): HTMLElement {
  const result = resultOf(record);
  return el(doc, 'tr', {
    children: [
      el(doc, 'th', {
        attrs: { scope: 'row' },
        text: `${sportName(record.sportId)} · ${record.mode === 'live' ? 'Live' : 'Playbook'}`,
      }),
      el(doc, 'td', { text: `${record.score[0]}–${record.score[1]}` }),
      // The word, not a colour (INV-11). A spectated match has no result and says so with a dash.
      el(doc, 'td', { text: result === null ? '—' : (RESULT_WORDS[result] ?? '—') }),
      el(doc, 'td', { text: playedOn(record.playedAt) }),
    ],
  });
}

function careerRow(doc: Document, career: CareerLine, name: string): HTMLElement {
  const shooting = percentage(career.totals.fieldGoalsMade, career.totals.fieldGoalsAttempted);
  return el(doc, 'tr', {
    children: [
      el(doc, 'th', { attrs: { scope: 'row' }, text: name }),
      el(doc, 'td', { text: sportName(career.sportId) }),
      el(doc, 'td', { text: String(career.matches) }),
      el(doc, 'td', {
        text: `${career.wins}–${career.losses}${career.draws > 0 ? `–${career.draws}` : ''}`,
      }),
      el(doc, 'td', { text: String(career.totals.points) }),
      el(doc, 'td', { text: shooting === null ? '—' : `${shooting}%` }),
      el(doc, 'td', { text: String(career.totals.assists) }),
      el(doc, 'td', { text: String(career.totals.rebounds) }),
    ],
  });
}

function table(
  doc: Document,
  caption: string,
  headers: readonly string[],
  rows: readonly HTMLElement[],
): HTMLElement {
  return el(doc, 'div', {
    class: 'history-table',
    children: [
      el(doc, 'table', {
        children: [
          el(doc, 'caption', { text: caption }),
          el(doc, 'thead', {
            children: [
              el(doc, 'tr', {
                children: headers.map((label) =>
                  el(doc, 'th', { attrs: { scope: 'col' }, text: label }),
                ),
              }),
            ],
          }),
          el(doc, 'tbody', { children: [...rows] }),
        ],
      }),
    ],
  });
}

export function historyScreen(): Screen {
  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;

      let records: MatchRecord[];
      let names = new Map<string, string>();
      try {
        const db = await appDatabase();
        records = await db.matches.recent(50);
        names = new Map((await db.athletes.getAll()).map((a) => [a.id, a.displayName]));
      } catch {
        context.host.replaceChildren(
          errorState(doc, {
            heading: 'Your history could not be read',
            body: 'Try again, or repair the app from Settings.',
          }),
        );
        return;
      }

      if (records.length === 0) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: 'No matches yet',
            body: 'Play one and it will be here — the score, the box score, and what it did for your athletes.',
            action: { label: 'Play', href: '#/play' },
          }),
        );
        return;
      }

      // Careers come from every stored match, not only the fifty on screen: the list is a view and
      // the totals are the record.
      const all = await (await appDatabase()).matches.all();
      const careers = buildCareers(all)
        .filter((career) => names.has(career.athleteId))
        .sort((a, b) => b.totals.points - a.totals.points)
        .slice(0, 25);

      context.host.replaceChildren(
        el(doc, 'section', {
          class: 'history',
          children: [
            el(doc, 'h1', { class: 'history__title', text: 'Progress' }),
            // The other half of this tab (`10` §7). A link rather than a second list, because the
            // gallery is seventy-nine rows and this screen is already two tables.
            el(doc, 'nav', {
              class: 'history__links',
              attrs: { 'aria-label': 'More progress' },
              children: [
                button(doc, {
                  label: 'Achievements',
                  variant: 'secondary',
                  href: '#/progress/achievements',
                }),
                button(doc, {
                  label: 'Tournament',
                  variant: 'secondary',
                  href: '#/progress/tournament',
                }),
              ],
            }),
            table(
              doc,
              `Recent matches (${records.length})`,
              ['Match', 'Score', 'Result', 'Played'],
              records.map((record) => matchRow(doc, record)),
            ),
            careers.length === 0
              ? el(doc, 'p', {
                  class: 'history__note',
                  text: 'Career stats appear once your own athletes have played. Matches played by rolled athletes belong to nobody.',
                })
              : table(
                  doc,
                  'Career, per athlete per sport',
                  ['Athlete', 'Sport', 'Matches', 'W–L', 'Points', 'FG%', 'Assists', 'Rebounds'],
                  careers.map((career) =>
                    careerRow(doc, career, names.get(career.athleteId) ?? career.athleteId),
                  ),
                ),
          ],
        }),
      );
    },
  };
}
