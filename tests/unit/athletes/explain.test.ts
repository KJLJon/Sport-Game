/**
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.8 — Athlete card component: "why this rating"
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @design  10-ui-ux.md §6, §11
 *
 * Purpose: the sentences the card says. They are tested here rather than through the DOM because
 * a string built inside a component is a string with no test, and `10` §11 makes these the
 * non-colour channel for every meter on the card — they are load-bearing, not decoration.
 */
import { describe, expect, it } from 'vitest';
import {
  attributeLabel,
  attributeLabels,
  ceilingSentence,
  contributionLines,
  familiarityLine,
  humanise,
  physicalLine,
  provenanceLine,
  ratingLabel,
} from '../../../src/athletes/explain.ts';
import { explainRating } from '../../../src/athletes/derivation.ts';
import { ATTRIBUTE_IDS } from '../../../src/athletes/types.ts';
import { BASKETBALL_PHYSICAL, BASKETBALL_WEIGHTS } from '../../../src/sports/basketball/weights.ts';
import { athlete, attributes } from '../../helpers/athletes.ts';

const tables = { weights: BASKETBALL_WEIGHTS, physicalModifiers: BASKETBALL_PHYSICAL };

describe('humanise', () => {
  it('splits camel case into a sentence', () => {
    expect(humanise('someRating')).toBe('Some rating');
    expect(humanise('speed')).toBe('Speed');
  });

  it('uses the override where the generic rule reads badly', () => {
    expect(ratingLabel('threePoint')).toBe('Three-point');
    expect(ratingLabel('perimeterD')).toBe('Perimeter defence');
    expect(ratingLabel('offBall')).toBe('Off-ball movement');
  });

  it('gives every one of the eleven attributes a readable label', () => {
    const labels = attributeLabels();
    expect(labels).toHaveLength(ATTRIBUTE_IDS.length);
    for (const { id, label } of labels) {
      expect(label.length).toBeGreaterThan(2);
      expect(label[0]).toBe(label[0]?.toUpperCase());
      expect(attributeLabel(id)).toBe(label);
    }
  });

  it('produces something readable for a rating it has never seen', () => {
    expect(ratingLabel('nutmegsPerGame')).toBe('Nutmegs per game');
  });
});

describe('contributionLines', () => {
  const shooter = athlete({
    attributes: attributes(50, { accuracy: 90, coordination: 70, composure: 40 }),
    heightCm: 195,
  });

  it('names the top three contributors, largest first (`10` §6)', () => {
    const lines = contributionLines(explainRating(shooter, 'basketball', 'threePoint', tables));
    expect(lines).toHaveLength(3);
    expect(lines[0]?.attribute).toBe('accuracy');
    expect(lines.map((l) => l.share)).toEqual([...lines.map((l) => l.share)].sort((a, b) => b - a));
  });

  it('reads as a sentence a person could say out loud', () => {
    const [top] = contributionLines(explainRating(shooter, 'basketball', 'threePoint', tables));
    // 0.45 × 90 = 40.5 of a 71-point weighted sum.
    expect(top?.text).toBe('Accuracy 90 — 57% of this rating');
  });

  it('honours a different limit, and copes with zero', () => {
    const explanation = explainRating(shooter, 'basketball', 'threePoint', tables);
    expect(contributionLines(explanation, 1)).toHaveLength(1);
    expect(contributionLines(explanation, 0)).toHaveLength(0);
    expect(contributionLines(explanation, -4)).toHaveLength(0);
  });

  it('has nothing to say about a rating the sport does not define', () => {
    expect(contributionLines(explainRating(shooter, 'basketball', 'nope', tables))).toEqual([]);
  });

  it('does not divide by zero for an athlete with nothing at all', () => {
    const empty = athlete({ attributes: attributes(0) });
    const lines = contributionLines(explainRating(empty, 'basketball', 'threePoint', tables));
    expect(lines.every((line) => line.share === 0)).toBe(true);
  });
});

describe('physicalLine', () => {
  it('says what height adds, and what it costs', () => {
    const tall = athlete({ heightCm: 215 });
    expect(physicalLine(explainRating(tall, 'basketball', 'rebounding', tables))).toBe(
      'Height adds 7 points',
    );
    expect(physicalLine(explainRating(tall, 'basketball', 'ballHandling', tables))).toBe(
      'Height costs 3 points',
    );
  });

  it('says nothing where height does not matter', () => {
    const average = athlete({ heightCm: 195 });
    expect(physicalLine(explainRating(average, 'basketball', 'threePoint', tables))).toBeNull();
    expect(physicalLine(explainRating(average, 'basketball', 'rebounding', tables))).toBeNull();
  });
});

describe('ceilingSentence', () => {
  it("is `10` §6's sentence", () => {
    expect(ceilingSentence(0.58)).toBe('Playing at 58% of their athletic ceiling');
  });

  it('does not word a full-familiarity athlete as though something were wrong', () => {
    expect(ceilingSentence(1)).toBe('Playing at their full athletic ceiling');
  });
});

describe('familiarityLine', () => {
  it('carries the rank in words as well as the number (`10` §11)', () => {
    expect(familiarityLine('Soccer', 12.4, 'Novice')).toBe('Soccer familiarity: Novice, 12 of 100');
  });
});

describe('provenanceLine', () => {
  const when = Date.UTC(2026, 2, 12);

  it("names every source in the player's words", () => {
    expect(provenanceLine('created', when, 'en-GB')).toBe('Created 12 March 2026');
    expect(provenanceLine('pack', when, 'en-GB')).toBe('Pulled from a pack 12 March 2026');
    expect(provenanceLine('peer', when, 'en-GB')).toBe('Traded from a friend 12 March 2026');
    expect(provenanceLine('import', when, 'en-GB')).toBe('Imported 12 March 2026');
    expect(provenanceLine('market', when, 'en-GB')).toBe('Bought on the market 12 March 2026');
    expect(provenanceLine('starter', when, 'en-GB')).toBe('Starter athlete, added 12 March 2026');
  });

  it('falls back rather than showing a blank line for a source it has not met', () => {
    expect(provenanceLine('mystery', when, 'en-GB')).toBe('Added 12 March 2026');
  });
});
