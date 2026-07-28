/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.8 — Athlete card component: compact + full, sport switcher, familiarity ring, "why this rating"
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @design  05-data-model.md §3 (derivation), 10-ui-ux.md §6 (the athlete card), §11 (accessibility)
 *
 * Purpose: turns the derivation's arithmetic into the sentences `10` §6 asks the card to say —
 * "the top three contributing attributes in plain language", and "playing at 58% of their athletic
 * ceiling".
 *
 * It lives beside the arithmetic rather than in the component for two reasons. The card is not the
 * only thing that has to explain a rating — the compare view (T-3.9) and the lineup editor's fit
 * warnings (T-3.12) say the same things — and a sentence built in a component is a sentence with no
 * test. `10` §11 forbids conveying anything by colour alone, which in practice means every bar on
 * the card needs one of these strings next to it.
 *
 * Names are humanised generically with a small override table, so a sport that adds a rating gets
 * a readable label without editing this file. Only genuinely unguessable ones are listed.
 */
import type { RatingExplanation } from './derivation.ts';
import { ATTRIBUTE_IDS, type AttributeId } from './types.ts';

/** Labels the generic humaniser gets wrong. Everything else is derived from the identifier. */
const LABELS: Readonly<Record<string, string>> = {
  threePoint: 'Three-point',
  midRange: 'Mid-range',
  freeThrow: 'Free throw',
  ballHandling: 'Ball handling',
  perimeterD: 'Perimeter defence',
  interiorD: 'Interior defence',
  courtSpeed: 'Court speed',
  shotPower: 'Shot power',
  shortPass: 'Short passing',
  longPass: 'Long passing',
  offBall: 'Off-ball movement',
  goalkeeping: 'Goalkeeping',
  vertical: 'Vertical leap',
};

/** `ballHandling` → `Ball handling`. Acronym-free by design; the overrides cover the rest. */
export function humanise(id: string): string {
  const override = LABELS[id];
  if (override !== undefined) return override;

  const spaced = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function attributeLabel(id: AttributeId): string {
  return humanise(id);
}

export function ratingLabel(id: string): string {
  return humanise(id);
}

/** All eleven, labelled, in `05` §2.1's order — the radar's axes and the editor's sliders. */
export function attributeLabels(): readonly { id: AttributeId; label: string }[] {
  return ATTRIBUTE_IDS.map((id) => ({ id, label: attributeLabel(id) }));
}

export interface ContributionLine {
  readonly attribute: AttributeId;
  readonly label: string;
  readonly value: number;
  /** This attribute's share of the weighted sum, 0–1. */
  readonly share: number;
  /** "Accuracy 88 — 45% of this rating". */
  readonly text: string;
}

/**
 * The top contributors to a rating, largest first. Shares are of the *attribute* sum rather than
 * of the final rating, so they add to 100% and a physical modifier does not make them look wrong.
 */
export function contributionLines(
  explanation: RatingExplanation,
  limit = 3,
): readonly ContributionLine[] {
  const total = explanation.contributions.reduce((sum, c) => sum + c.points, 0);

  return explanation.contributions.slice(0, Math.max(0, limit)).map((contribution) => {
    const share = total <= 0 ? 0 : contribution.points / total;
    const label = attributeLabel(contribution.attribute);
    return {
      attribute: contribution.attribute,
      label,
      value: contribution.value,
      share,
      text: `${label} ${contribution.value} — ${Math.round(share * 100)}% of this rating`,
    };
  });
}

/** `1 point`, `2 points`. Small, but a card that says "1 points" reads as unfinished. */
export function points(value: number): string {
  return `${value} ${Math.abs(value) === 1 ? 'point' : 'points'}`;
}

/** "Height adds 7 points" / "Height costs 3 points" — the card's physical line (`05` §3.1). */
export function physicalLine(explanation: RatingExplanation): string | null {
  const value = Math.round(explanation.physical);
  if (value === 0) return null;
  return value > 0 ? `Height adds ${points(value)}` : `Height costs ${points(-value)}`;
}

/**
 * `10` §6, near enough word for word: "playing at 58% of their athletic ceiling". An athlete at
 * home in their sport is not playing at a *penalty*, so they get a sentence that says so rather
 * than "playing at 100%", which reads like a warning.
 */
export function ceilingSentence(multiplier: number): string {
  const percent = Math.round(multiplier * 100);
  if (percent >= 100) return 'Playing at their full athletic ceiling';
  return `Playing at ${percent}% of their athletic ceiling`;
}

/** What the familiarity badge says, in words rather than in colour (`10` §11). */
export function familiarityLine(sportLabel: string, familiarity: number, rank: string): string {
  return `${sportLabel} familiarity: ${rank}, ${Math.round(familiarity)} of 100`;
}

/** "Created 12 March 2026" — the provenance line `10` §6 asks for. */
export function provenanceLine(source: string, createdAt: number, locale?: string): string {
  const verb: Readonly<Record<string, string>> = {
    starter: 'Starter athlete, added',
    created: 'Created',
    pack: 'Pulled from a pack',
    market: 'Bought on the market',
    peer: 'Traded from a friend',
    import: 'Imported',
  };

  const date = new Date(createdAt).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `${verb[source] ?? 'Added'} ${date}`;
}
