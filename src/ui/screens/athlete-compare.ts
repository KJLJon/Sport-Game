/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.9 — Cross-sport compare view with projections for unplayed sports
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @story   US-5.2 — Play any athlete in any sport
 * @design  10-ui-ux.md §6 (the athlete card — cross-sport compare), §10, §11
 *
 * Purpose: `10` §6's secondary view — "the same athlete's overall in every sport side by side, with
 * a projection for sports they've never played". It is the argument for the whole cross-sport
 * system in one screen: this athlete is a 78 at what they do, and here is what they would be
 * somewhere else.
 *
 * The honesty problem is the whole design. Two of the three numbers on each row mean different
 * things — what the athlete rates *today*, and what they would rate once they knew the sport — and
 * a view that showed only one of them would either flatter every athlete or bury the feature. So
 * each row shows both, labels which is which in words, and marks a sport this build cannot actually
 * play as a projection rather than an invitation.
 *
 * Both numbers come from `derivation.ts`. A projection is the same arithmetic with familiarity
 * pinned at the cap, not a separate estimate — if those two ever disagreed, the compare view would
 * be lying about a number the sim is about to use.
 */
import { projectRatings } from '../../athletes/derivation.ts';
import { familiarityBand, familiarityCap, matchesToReach } from '../../athletes/familiarity.ts';
import { humanise, ratingLabel } from '../../athletes/explain.ts';
import { sportSkillFor, type Athlete } from '../../athletes/types.ts';
import { cardOverall, type CardSport } from '../components/athlete-card.ts';
import { RATEABLE_SPORTS, sportsForAthlete } from '../../sports/catalogue.ts';
import { appDatabase } from '../../storage/app-db.ts';
import { emptyState, errorState, skeleton } from '../components/states.ts';
import { ratingBar } from '../components/meters.ts';
import type { Screen, ScreenContext } from '../../app/screen.ts';
import { el } from '../dom.ts';
import '../components/athlete-card.css';
import './athlete-compare.css';

/** Real minutes a starter plays in one match — the unit `05` §3.3's growth takes (T-3.4). */
const MATCH_MINUTES = 8;

/** What a sport looks like for one athlete, ready to render. */
export interface SportComparison {
  readonly sport: CardSport;
  /** Overall at their best position today, with the familiarity penalty applied. */
  readonly current: number;
  /** Overall with familiarity at this sport's cap and nothing learned — their ceiling. */
  readonly potential: number;
  readonly position: string | null;
  readonly familiarity: number;
  readonly band: string;
  /** True where the athlete has never played this sport, so `current` is mostly penalty. */
  readonly unplayed: boolean;
  /** Matches of real play to reach the cap, or `null` when already there or unreachable. */
  readonly matchesToCap: number | null;
}

/**
 * Every sport, best *potential* first after the athlete's own.
 *
 * Ranking on potential rather than on current is the deliberate choice: current ranking would sort
 * every athlete by which sport they happen to have played, which is a fact about the save file
 * rather than about the athlete. Potential answers the question the screen exists to ask.
 */
export function compareSports(athlete: Athlete, sports: readonly CardSport[]): SportComparison[] {
  const rows = sports.map((sport): SportComparison => {
    const skill = sportSkillFor(athlete, sport.id);
    const current = cardOverall(athlete, sport);
    const potential = cardOverall(
      {
        ...athlete,
        sportSkills: {
          ...athlete.sportSkills,
          [sport.id]: { ...skill, familiarity: 100, subSkills: {} },
        },
      },
      sport,
    );

    return {
      sport,
      current: current.overall,
      potential: potential.overall,
      position: current.position,
      familiarity: skill.familiarity,
      band: familiarityBand(skill.familiarity),
      unplayed: skill.minutesPlayed === 0,
      matchesToCap: matchesToReach({
        familiarity: skill.familiarity,
        minutesPerMatch: MATCH_MINUTES,
        age: athlete.age,
        sport: sport.id,
        cap: familiarityCap(athlete, sport.id),
        target: familiarityCap(athlete, sport.id),
      }),
    };
  });

  const own = rows.filter((row) => row.sport.id === athlete.primarySport);
  const rest = rows
    .filter((row) => row.sport.id !== athlete.primarySport)
    .sort((a, b) => b.potential - a.potential || a.sport.id.localeCompare(b.sport.id));

  return [...own, ...rest];
}

/** The two or three ratings this athlete is best at in a sport — why they suit it (US-5.4). */
export function standoutRatings(athlete: Athlete, sport: CardSport, limit = 3): string[] {
  return Object.entries(projectRatings(athlete, sport.id, sport.tables))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([rating, value]) => `${ratingLabel(rating)} ${value}`);
}

const OVERALL_MAX = 99;

export function comparisonRow(
  doc: Document,
  athlete: Athlete,
  comparison: SportComparison,
): HTMLElement {
  const { sport } = comparison;
  const isOwn = sport.id === athlete.primarySport;
  const gap = comparison.potential - comparison.current;

  return el(doc, 'li', {
    class: 'compare-card',
    dataset: { sport: sport.id, own: String(isOwn) },
    children: [
      el(doc, 'div', {
        class: 'compare-card__head',
        children: [
          el(doc, 'h3', {
            class: 'compare-card__sport',
            text: isOwn ? `${sport.displayName} (primary)` : sport.displayName,
          }),
          el(doc, 'span', {
            class: 'compare-card__position',
            text: comparison.position === null ? '' : `Best at ${comparison.position}`,
          }),
        ],
      }),

      // Today. The bar is the number; the words beside it are the non-colour channel (`10` §11).
      ratingBar(doc, {
        label: 'Today',
        value: Math.min(OVERALL_MAX, comparison.current),
        tone: gap >= 5 ? 'weak' : 'neutral',
      }),
      // And the ceiling, run through the same arithmetic with familiarity pinned at the cap.
      ratingBar(doc, {
        label: 'If they learned it',
        value: Math.min(OVERALL_MAX, comparison.potential),
        tone: 'strong',
      }),

      el(doc, 'p', {
        class: 'compare-card__note',
        text: describeGap(comparison, gap),
      }),

      el(doc, 'ul', {
        class: 'compare-card__standouts',
        children: standoutRatings(athlete, sport).map((line) =>
          el(doc, 'li', { class: 'compare-card__standout', text: line }),
        ),
      }),

      sport.playable === false
        ? el(doc, 'p', {
            class: 'compare-card__unplayable',
            text: `${sport.displayName} is not playable yet — this row is a projection.`,
          })
        : null,
    ],
  });
}

/** The sentence under the bars. Says which number is real and what it would take to close the gap. */
export function describeGap(comparison: SportComparison, gap: number): string {
  if (gap <= 0) {
    return `At their ceiling in ${comparison.sport.displayName.toLowerCase()}.`;
  }

  const band = humanise(comparison.band).toLowerCase();
  const start = comparison.unplayed
    ? `Never played — ${band} familiarity, so today's number is mostly the penalty.`
    : `${humanise(comparison.band)} familiarity, ${gap} points below their ceiling.`;

  if (comparison.matchesToCap === null) return start;
  return `${start} About ${comparison.matchesToCap} matches of play to close it.`;
}

export function athleteCompareScreen(): Screen {
  return {
    async mount(context: ScreenContext): Promise<void> {
      const doc = context.host.ownerDocument;
      const id = context.params.id ?? '';

      context.host.replaceChildren(skeleton(doc, { lines: 5 }));

      let athlete: Athlete | undefined;
      try {
        athlete = await (await appDatabase()).athletes.get(id);
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

      if (athlete === undefined) {
        context.host.replaceChildren(
          emptyState(doc, {
            heading: 'No such athlete',
            body: 'They may have been deleted, or the link may be out of date.',
            action: { label: 'Back to your squad', onSelect: () => context.navigate('/squad') },
          }),
        );
        return;
      }

      const sports = sportsForAthlete(athlete.primarySport);
      const rows = compareSports(athlete, sports.length === 0 ? RATEABLE_SPORTS : sports);
      const subject = athlete;

      context.host.replaceChildren(
        el(doc, 'div', {
          class: 'compare-screen',
          children: [
            el(doc, 'header', {
              class: 'compare-screen__head',
              children: [
                el(doc, 'h2', { text: `${subject.displayName} across every sport` }),
                el(doc, 'p', {
                  class: 'compare-screen__lede',
                  text: 'Two numbers per sport: what they rate today, and what they would rate once they knew it.',
                }),
              ],
            }),
            el(doc, 'ul', {
              class: 'compare-screen__list',
              children: rows.map((row) => comparisonRow(doc, subject, row)),
            }),
            el(doc, 'a', {
              class: 'compare-screen__back',
              attrs: { href: `#/squad/athlete/${subject.id}` },
              text: 'Back to the card',
            }),
          ],
        }),
      );
    },
  };
}
