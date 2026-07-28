/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.8 — Athlete card component: compact + full, sport switcher, familiarity ring, "why this rating"
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @story   US-5.2 — Play any athlete in any sport
 * @design  10-ui-ux.md §6 (the athlete card), §11 (accessibility), 05-data-model.md §3
 *
 * Purpose: `10` §6 calls this "the single most important piece of UI… it has to make you want to
 * show it to someone", and the sport switcher is the feature in one gesture — tap a sport and a
 * soccer star's numbers reshape into a basketball card.
 *
 * Two things shape the implementation. The card never computes a rating: it is handed the
 * derivation's output and the explanation beside it, so what it shows and what the sim uses cannot
 * drift. And every meter carries words as well as a fill (`10` §11 — nothing by colour alone), so
 * the "why" is not a hover affordance that a screen reader or a thumb can never reach.
 *
 * Not built here: recent form and career stats per sport, which `10` §6 also lists. They need match
 * history, which does not exist until Phase 8. The card leaves no gap where they will go — it
 * simply omits the section rather than showing an empty one.
 */
import {
  bestPosition,
  deriveRatings,
  explainRating,
  familiarityMultiplier,
  positionFits,
  type SportRatingTables,
} from '../../athletes/derivation.ts';
import {
  ceilingSentence,
  contributionLines,
  familiarityLine,
  humanise,
  physicalLine,
  points,
  provenanceLine,
  ratingLabel,
} from '../../athletes/explain.ts';
import { familiarityBand } from '../../athletes/familiarity.ts';
import { levelProgress } from '../../athletes/xp.ts';
import { learnedSubSkills } from '../../athletes/progression.ts';
import { sportSkillFor, type Athlete } from '../../athletes/types.ts';
import { DERIVATION } from '../../athletes/tuning.ts';
import { el } from '../dom.ts';
import { familiarityRing, progressBar, ratingBar } from './meters.ts';

/** One entry in the sport switcher. The screen supplies these; the card knows no sport ids. */
export interface CardSport {
  readonly id: string;
  readonly displayName: string;
  readonly tables: SportRatingTables;
  /** False for a sport that can be rated but not yet played — the card says so rather than lying. */
  readonly playable?: boolean;
}

export interface AthleteCardOptions {
  readonly athlete: Athlete;
  readonly sports: readonly CardSport[];
  /** Which sport is shown. Defaults to the athlete's own. */
  readonly sportId?: string;
  /** Called when the switcher changes sport, so the screen owns the selection. */
  readonly onSportChange?: (sportId: string) => void;
  readonly locale?: string;
}

const OVERALL_MAX = 99;

function sportFor(options: AthleteCardOptions): CardSport | undefined {
  const wanted = options.sportId ?? options.athlete.primarySport;
  return options.sports.find((sport) => sport.id === wanted) ?? options.sports[0];
}

/**
 * The number on the compact card: the athlete's overall at their *best* position in this sport,
 * not at their current one. A card is an identity, and asking "how good is this athlete" should
 * not depend on where a lineup happens to have put them.
 */
export function cardOverall(
  athlete: Athlete,
  sport: CardSport,
): { readonly overall: number; readonly position: string | null } {
  const ratings = deriveRatings(athlete, sport.id, sport.tables);
  const best = bestPosition(ratings, sport.tables.positionWeights);
  if (best !== null) return { overall: Math.round(best.overall), position: best.position };

  // A sport with no positions still has an overall: the mean of its ratings.
  const values = Object.values(ratings);
  const mean = values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
  return { overall: Math.round(mean), position: null };
}

/** Portrait, name, rarity frame, overall, familiarity ring, position chip (`10` §6). */
export function athleteCardCompact(doc: Document, options: AthleteCardOptions): HTMLElement {
  const { athlete } = options;
  const sport = sportFor(options);
  if (sport === undefined) return el(doc, 'article', { class: 'athlete-card athlete-card--empty' });

  const skill = sportSkillFor(athlete, sport.id);
  const { overall, position } = cardOverall(athlete, sport);
  const band = familiarityBand(skill.familiarity);

  return el(doc, 'article', {
    class: 'athlete-card athlete-card--compact',
    dataset: { rarity: athlete.rarity, sport: sport.id },
    attrs: {
      'aria-label': `${athlete.displayName}, ${athlete.rarity}, ${sport.displayName} overall ${overall}`,
    },
    children: [
      portrait(doc, athlete),
      el(doc, 'div', {
        class: 'athlete-card__identity',
        children: [
          el(doc, 'h3', { class: 'athlete-card__name', text: athlete.displayName }),
          el(doc, 'p', {
            class: 'athlete-card__meta',
            text: `${sport.displayName} · ${athlete.rarity}`,
          }),
          position === null
            ? null
            : el(doc, 'span', { class: 'athlete-card__chip', text: position }),
        ],
      }),
      el(doc, 'div', {
        class: 'athlete-card__overall',
        children: [
          el(doc, 'span', { class: 'athlete-card__overall-value', text: String(overall) }),
          el(doc, 'span', { class: 'athlete-card__overall-label', text: 'OVR' }),
        ],
      }),
      familiarityRing(doc, {
        value: skill.familiarity / 100,
        sport: sport.displayName,
        size: 44,
        rank: humanise(band),
      }),
      // The ring names the band; this is the text channel for the ceiling itself, which the ring
      // does not carry (`10` §11).
      el(doc, 'span', {
        class: 'athlete-card__band',
        text: ceilingSentence(familiarityMultiplier(skill.familiarity)),
      }),
    ],
  });
}

/** The full card `10` §6 describes, sport switcher and all. */
export function athleteCardFull(doc: Document, options: AthleteCardOptions): HTMLElement {
  const { athlete } = options;
  const sport = sportFor(options);
  if (sport === undefined) return el(doc, 'article', { class: 'athlete-card athlete-card--empty' });

  const skill = sportSkillFor(athlete, sport.id);
  const ratings = deriveRatings(athlete, sport.id, sport.tables);
  const multiplier = familiarityMultiplier(skill.familiarity);
  const { overall, position } = cardOverall(athlete, sport);
  const progress = levelProgress(skill);
  const learned = learnedSubSkills(athlete, sport.id);

  return el(doc, 'article', {
    class: 'athlete-card athlete-card--full',
    dataset: { rarity: athlete.rarity, sport: sport.id },
    children: [
      el(doc, 'header', {
        class: 'athlete-card__header',
        children: [
          portrait(doc, athlete),
          el(doc, 'div', {
            class: 'athlete-card__identity',
            children: [
              el(doc, 'h2', { class: 'athlete-card__name', text: athlete.displayName }),
              el(doc, 'p', { class: 'athlete-card__physical', text: physicalDescription(athlete) }),
              el(doc, 'p', {
                class: 'athlete-card__provenance',
                text: provenanceLine(athlete.source, athlete.createdAt, options.locale),
              }),
              athlete.sandbox
                ? el(doc, 'p', {
                    class: 'athlete-card__sandbox',
                    text: 'Sandbox athlete — excluded from tournaments and fair-play achievements.',
                  })
                : null,
            ],
          }),
          el(doc, 'div', {
            class: 'athlete-card__overall',
            children: [
              el(doc, 'span', { class: 'athlete-card__overall-value', text: String(overall) }),
              el(doc, 'span', {
                class: 'athlete-card__overall-label',
                text: position === null ? 'OVR' : `OVR · ${position}`,
              }),
            ],
          }),
        ],
      }),

      sportSwitcher(doc, options, sport),

      el(doc, 'section', {
        class: 'athlete-card__familiarity',
        children: [
          familiarityRing(doc, {
            value: skill.familiarity / 100,
            sport: sport.displayName,
            rank: humanise(familiarityBand(skill.familiarity)),
          }),
          el(doc, 'div', {
            children: [
              el(doc, 'p', {
                class: 'athlete-card__familiarity-line',
                text: familiarityLine(
                  sport.displayName,
                  skill.familiarity,
                  humanise(familiarityBand(skill.familiarity)),
                ),
              }),
              el(doc, 'p', {
                class: 'athlete-card__ceiling',
                text: ceilingSentence(multiplier),
              }),
              sport.playable === false
                ? el(doc, 'p', {
                    class: 'athlete-card__unplayable',
                    text: `${sport.displayName} is not playable yet — this is a projection.`,
                  })
                : null,
            ],
          }),
        ],
      }),

      el(doc, 'section', {
        class: 'athlete-card__ratings',
        children: [
          el(doc, 'h3', { text: `${sport.displayName} ratings` }),
          ...Object.keys(sport.tables.weights).map((rating) =>
            ratingRow(doc, options, sport, rating, ratings[rating] ?? 0),
          ),
        ],
      }),

      el(doc, 'section', {
        class: 'athlete-card__development',
        children: [
          el(doc, 'h3', { text: 'Development' }),
          progressBar(doc, {
            label: `Level ${progress.level}`,
            value: progress.fraction,
            valueText: progress.atCap
              ? 'Maximum level'
              : `${Math.round(progress.intoLevel)} / ${Math.round(progress.levelCost)} XP`,
          }),
          el(doc, 'p', {
            class: 'athlete-card__minutes',
            text: `${Math.round(skill.minutesPlayed)} minutes played`,
          }),
          learned.length === 0
            ? el(doc, 'p', {
                class: 'athlete-card__empty-note',
                text: 'No sub-skills learned yet — they develop from what this athlete actually does.',
              })
            : el(doc, 'ul', {
                class: 'athlete-card__subskills',
                children: learned.map((entry) =>
                  el(doc, 'li', {
                    text: `${ratingLabel(entry.rating)} +${entry.points}`,
                  }),
                ),
              }),
        ],
      }),

      positionSection(doc, athlete, sport),

      athlete.traits.length === 0
        ? null
        : el(doc, 'section', {
            class: 'athlete-card__traits',
            children: [
              el(doc, 'h3', { text: 'Traits' }),
              el(doc, 'ul', {
                children: athlete.traits.map((trait) =>
                  el(doc, 'li', { class: 'athlete-card__trait', text: ratingLabel(trait) }),
                ),
              }),
            ],
          }),
    ],
  });
}

/**
 * One rating bar with its "why" behind a disclosure. `<details>` rather than a custom widget: it is
 * keyboard-operable, screen-reader-announced, and survives having no JavaScript attached, which no
 * hand-rolled expander does for free.
 */
function ratingRow(
  doc: Document,
  options: AthleteCardOptions,
  sport: CardSport,
  rating: string,
  value: number,
): HTMLElement {
  const explanation = explainRating(options.athlete, sport.id, rating, sport.tables);
  const lines = contributionLines(explanation);
  const physical = physicalLine(explanation);
  const penalty = Math.round(explanation.familiarityPenalty);

  return el(doc, 'details', {
    class: 'athlete-card__rating',
    children: [
      el(doc, 'summary', {
        class: 'athlete-card__rating-summary',
        children: [
          ratingBar(doc, {
            label: ratingLabel(rating),
            value,
            tone: penalty >= 5 ? 'weak' : 'neutral',
          }),
        ],
      }),
      el(doc, 'ul', {
        class: 'athlete-card__why',
        children: [
          ...lines.map((line) => el(doc, 'li', { text: line.text })),
          physical === null ? null : el(doc, 'li', { text: physical }),
          penalty <= 0
            ? null
            : el(doc, 'li', {
                class: 'athlete-card__why-penalty',
                text: `Unfamiliarity costs ${points(penalty)}`,
              }),
          explanation.skillBonus <= 0
            ? null
            : el(doc, 'li', {
                text: `Practice adds ${points(Math.round(explanation.skillBonus))}`,
              }),
        ],
      }),
    ],
  });
}

/**
 * Position fit (`05` §3.4). Under the threshold it warns rather than blocks, and it says so in
 * words — the lineup editor (T-3.12) enforces nothing the card has not already explained.
 */
function positionSection(doc: Document, athlete: Athlete, sport: CardSport): HTMLElement | null {
  const fits = positionFits(
    deriveRatings(athlete, sport.id, sport.tables),
    sport.tables.positionWeights,
  );
  if (fits.length === 0) return null;

  return el(doc, 'section', {
    class: 'athlete-card__positions',
    children: [
      el(doc, 'h3', { text: 'Position fit' }),
      el(doc, 'ul', {
        children: fits.map((fit) =>
          el(doc, 'li', {
            class: 'athlete-card__position',
            dataset: { warn: String(fit.warn) },
            text: `${fit.position} — ${Math.round(fit.fit * 100)}%${fit.warn ? ' (out of position)' : ''}`,
          }),
        ),
      }),
      el(doc, 'p', {
        class: 'athlete-card__empty-note',
        text: `Under ${Math.round(DERIVATION.positionFitWarning * 100)}% is a warning, never a block.`,
      }),
    ],
  });
}

/**
 * The sport switcher. Radio inputs rather than buttons, because "which one of these is selected"
 * is exactly what a radio group means, and arrow-key navigation then comes free.
 */
function sportSwitcher(
  doc: Document,
  options: AthleteCardOptions,
  current: CardSport,
): HTMLElement {
  const name = `sport-${options.athlete.id}`;

  return el(doc, 'div', {
    class: 'athlete-card__switcher',
    attrs: { role: 'radiogroup', 'aria-label': 'Show ratings for' },
    children: options.sports.map((sport) => {
      const input = el(doc, 'input', {
        class: 'athlete-card__switcher-input',
        attrs: {
          type: 'radio',
          name,
          value: sport.id,
          id: `${name}-${sport.id}`,
          checked: sport.id === current.id,
        },
        on: {
          change: () => options.onSportChange?.(sport.id),
        },
      });

      return el(doc, 'label', {
        class: 'athlete-card__switcher-option',
        attrs: { for: `${name}-${sport.id}` },
        children: [
          input,
          el(doc, 'span', {
            text:
              sport.id === options.athlete.primarySport
                ? `${sport.displayName} (primary)`
                : sport.displayName,
          }),
        ],
      });
    }),
  });
}

function portrait(doc: Document, athlete: Athlete): HTMLElement {
  // Portraits are local blobs and are wired up with the editor (T-3.7); until one is attached the
  // card shows initials rather than a grey box, which reads as designed rather than as missing.
  return el(doc, 'div', {
    class: 'athlete-card__portrait',
    attrs: { 'aria-hidden': 'true' },
    children: [el(doc, 'span', { text: initials(athlete.displayName) })],
  });
}

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  const first = (parts[0] as string).charAt(0);
  const last = parts.length > 1 ? (parts[parts.length - 1] as string).charAt(0) : '';
  return (first + last).toUpperCase();
}

export function physicalDescription(athlete: Athlete): string {
  const hand = { left: 'Left-handed', right: 'Right-handed', both: 'Ambidextrous' }[
    athlete.handedness
  ];
  return `${athlete.heightCm} cm · ${athlete.weightKg} kg · ${athlete.age} · ${hand}`;
}

/** The compare view's row: this athlete's overall in one sport (`10` §6, T-3.9 builds on it). */
export function compareRow(doc: Document, athlete: Athlete, sport: CardSport): HTMLElement {
  const { overall } = cardOverall(athlete, sport);
  const skill = sportSkillFor(athlete, sport.id);
  const projected = skill.familiarity < 100;

  return el(doc, 'li', {
    class: 'compare-row',
    dataset: { sport: sport.id },
    children: [
      el(doc, 'span', { class: 'compare-row__sport', text: sport.displayName }),
      ratingBar(doc, {
        label: sport.displayName,
        value: Math.min(OVERALL_MAX, overall),
        hideValue: true,
      }),
      el(doc, 'span', { class: 'compare-row__value', text: String(overall) }),
      el(doc, 'span', {
        class: 'compare-row__note',
        text: projected ? humanise(familiarityBand(skill.familiarity)) : 'At home',
      }),
    ],
  });
}
