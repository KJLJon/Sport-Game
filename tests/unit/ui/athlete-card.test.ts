/**
 * @vitest-environment jsdom
 *
 * @spec    001-initial-dev
 * @phase   3 — Athletes, cross-sport ratings, roster
 * @task    T-3.8 — Athlete card component: compact + full, sport switcher, familiarity ring, "why this rating"
 * @story   US-5.4 — Understand why an athlete is good or bad at a sport
 * @story   US-5.2 — Play any athlete in any sport
 * @design  10-ui-ux.md §6 (the athlete card), §11 (accessibility)
 *
 * Purpose: the card is the piece of UI `10` §6 calls the hero, so what is asserted here is what it
 * *says*, not how it is laid out — the sport switcher actually reshaping the numbers, every meter
 * carrying words as well as a fill, and the "why" being reachable rather than a hover affordance.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  athleteCardCompact,
  athleteCardFull,
  cardOverall,
  compareRow,
  initials,
  physicalDescription,
  type CardSport,
} from '../../../src/ui/components/athlete-card.ts';
import { RATEABLE_SPORTS, rateableSport, sportsForAthlete } from '../../../src/sports/catalogue.ts';
import { BASKETBALL_WEIGHTS } from '../../../src/sports/basketball/weights.ts';
import { athlete, attributes } from '../../helpers/athletes.ts';

const doc = document;
const sports = [...RATEABLE_SPORTS];
const basketball = rateableSport('basketball') as CardSport;
const soccer = rateableSport('soccer') as CardSport;

function text(node: HTMLElement): string {
  return node.textContent ?? '';
}

describe('the catalogue', () => {
  it('rates both sports but marks only basketball playable', () => {
    expect(RATEABLE_SPORTS.map((s) => s.id)).toEqual(['basketball', 'soccer']);
    expect(basketball.playable).toBe(true);
    expect(soccer.playable).toBe(false);
  });

  it("puts an athlete's own sport first, whatever order the catalogue is in", () => {
    expect(sportsForAthlete('soccer').map((s) => s.id)).toEqual(['soccer', 'basketball']);
    expect(sportsForAthlete('basketball').map((s) => s.id)).toEqual(['basketball', 'soccer']);
  });

  it('returns nothing for a sport it does not rate', () => {
    expect(rateableSport('quidditch')).toBeUndefined();
    expect(sportsForAthlete('quidditch').map((s) => s.id)).toEqual(['basketball', 'soccer']);
  });
});

describe('cardOverall', () => {
  it('rates an athlete at their best position, not an arbitrary one', () => {
    const big = athlete({
      attributes: attributes(45, { strength: 92, vertical: 90 }),
      heightCm: 214,
    });
    expect(cardOverall(big, basketball).position).toBe('C');
  });

  it('falls back to the mean where a sport declares no positions', () => {
    const { overall, position } = cardOverall(athlete(), soccer);
    expect(position).toBeNull();
    expect(overall).toBeGreaterThan(0);
  });

  it('is zero rather than NaN for a sport with no ratings at all', () => {
    expect(
      cardOverall(athlete(), { id: 'void', displayName: 'Void', tables: { weights: {} } }),
    ).toEqual({ overall: 0, position: null });
  });
});

describe('the compact card', () => {
  it('carries name, rarity, overall, and position in its accessible name', () => {
    const card = athleteCardCompact(doc, {
      athlete: athlete({ displayName: 'R. Example', rarity: 'epic' }),
      sports,
    });
    const label = card.getAttribute('aria-label') ?? '';
    expect(label).toContain('R. Example');
    expect(label).toContain('epic');
    expect(label).toContain('Basketball overall');
  });

  it('names the rarity in text as well as in the frame (`10` §11)', () => {
    const card = athleteCardCompact(doc, { athlete: athlete({ rarity: 'legendary' }), sports });
    expect(card.dataset.rarity).toBe('legendary');
    expect(text(card)).toContain('legendary');
  });

  it('shows the familiarity band as a word, not only as a ring', () => {
    const card = athleteCardCompact(doc, {
      athlete: athlete({ primarySport: 'basketball', sportSkills: {} }),
      sports,
      sportId: 'soccer',
    });
    expect(text(card)).toContain('Novice');
    expect(text(card)).toMatch(/Playing at \d+% of their athletic ceiling/);
  });

  it('renders an empty card rather than throwing when handed no sports', () => {
    const card = athleteCardCompact(doc, { athlete: athlete(), sports: [] });
    expect(card.className).toContain('athlete-card--empty');
  });
});

describe('the full card', () => {
  const subject = athlete({
    displayName: 'Marta Vieira',
    primarySport: 'soccer',
    heightCm: 162,
    weightKg: 57,
    age: 30,
    handedness: 'left',
    rarity: 'legendary',
    traits: ['clutch'],
    source: 'created',
    createdAt: Date.UTC(2026, 2, 12),
    attributes: attributes(60, { coordination: 95, accuracy: 92, awareness: 94 }),
  });

  it('shows the physical line `10` §6 asks for', () => {
    expect(physicalDescription(subject)).toBe('162 cm · 57 kg · 30 · Left-handed');
    expect(text(athleteCardFull(doc, { athlete: subject, sports }))).toContain('162 cm');
  });

  it("offers every sport as a radio group, with the athlete's own marked primary", () => {
    const card = athleteCardFull(doc, { athlete: subject, sports: sportsForAthlete('soccer') });
    const group = card.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();

    const inputs = [...card.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(['soccer', 'basketball']);
    expect(inputs[0]?.checked).toBe(true);
    expect(text(card)).toContain('Soccer (primary)');
  });

  it('reshapes the whole card when the sport changes — the feature in one gesture', () => {
    const onSportChange = vi.fn();
    const card = athleteCardFull(doc, {
      athlete: subject,
      sports: sportsForAthlete('soccer'),
      onSportChange,
    });

    // Radios need to be in the document for jsdom to treat them as a group.
    doc.body.replaceChildren(card);
    const basketballInput = card.querySelector('input[value="basketball"]') as HTMLInputElement;
    basketballInput.click();
    expect(onSportChange).toHaveBeenCalledWith('basketball');

    // And the card really does show different ratings for the other sport.
    const asSoccer = text(athleteCardFull(doc, { athlete: subject, sports, sportId: 'soccer' }));
    const asBasketball = text(
      athleteCardFull(doc, { athlete: subject, sports, sportId: 'basketball' }),
    );
    expect(asSoccer).toContain('Goalkeeping');
    expect(asBasketball).toContain('Three-point');
    expect(asSoccer).not.toBe(asBasketball);
  });

  it('says in words how much of their ceiling they are playing at (`10` §6)', () => {
    const away = text(athleteCardFull(doc, { athlete: subject, sports, sportId: 'basketball' }));
    expect(away).toMatch(/Playing at \d+% of their athletic ceiling/);

    // An athlete's own sport starts at 85 familiarity, not 100 (`05` §3.3) — so even at home they
    // are not at their ceiling until they have played. That is the spec, and the card says so.
    const home = text(athleteCardFull(doc, { athlete: subject, sports, sportId: 'soccer' }));
    expect(home).toContain('Playing at 95% of their athletic ceiling');

    const veteran = athlete({
      primarySport: 'basketball',
      sportSkills: {
        basketball: { familiarity: 100, level: 8, xp: 0, subSkills: {}, minutesPlayed: 900 },
      },
    });
    expect(text(athleteCardFull(doc, { athlete: veteran, sports }))).toContain(
      'their full athletic ceiling',
    );
  });

  it('warns that an unplayable sport is a projection rather than pretending otherwise', () => {
    const card = athleteCardFull(doc, {
      athlete: athlete({ primarySport: 'basketball' }),
      sports,
      sportId: 'soccer',
    });
    expect(text(card)).toContain('not playable yet');
  });

  it('gives every rating a bar and a reachable "why"', () => {
    const card = athleteCardFull(doc, { athlete: subject, sports, sportId: 'basketball' });
    const rows = card.querySelectorAll('.athlete-card__rating');
    expect(rows).toHaveLength(Object.keys(BASKETBALL_WEIGHTS).length);

    // `<details>`, so it is keyboard-operable and announced without any JavaScript of ours.
    for (const row of rows) expect(row.tagName).toBe('DETAILS');
    expect(text(card)).toMatch(/% of this rating/);
  });

  it('explains the familiarity penalty in points on the rating it costs', () => {
    const card = athleteCardFull(doc, {
      athlete: athlete({ primarySport: 'soccer', sportSkills: {} }),
      sports,
      sportId: 'basketball',
    });
    expect(text(card)).toMatch(/Unfamiliarity costs \d+ points/);
  });

  it('shows level, XP, and minutes, and says plainly when nothing is learned yet', () => {
    const card = athleteCardFull(doc, { athlete: subject, sports, sportId: 'soccer' });
    expect(text(card)).toContain('Level 1');
    expect(text(card)).toContain('minutes played');
    expect(text(card)).toContain('No sub-skills learned yet');
  });

  it('lists learned sub-skills once there are some', () => {
    const developed = athlete({
      primarySport: 'basketball',
      sportSkills: {
        basketball: {
          familiarity: 90,
          level: 6,
          xp: 40,
          subSkills: { threePoint: 8, passing: 2 },
          minutesPlayed: 420,
        },
      },
    });
    const card = athleteCardFull(doc, { athlete: developed, sports });
    expect(text(card)).toContain('Three-point +8');
    expect(text(card)).not.toContain('No sub-skills learned yet');
  });

  it('shows position fit with the warning as words and shape, not colour (`10` §11)', () => {
    const guard = athlete({
      attributes: attributes(45, { coordination: 92, accuracy: 88, awareness: 88, agility: 90 }),
      heightCm: 180,
    });
    const card = athleteCardFull(doc, { athlete: guard, sports, sportId: 'basketball' });
    const warned = [...card.querySelectorAll('.athlete-card__position[data-warn="true"]')];
    expect(warned.length).toBeGreaterThan(0);
    expect(warned.map((n) => n.textContent ?? '').join(' ')).toContain('out of position');
    expect(text(card)).toContain('never a block');
  });

  it('names the provenance and flags a sandbox athlete', () => {
    const card = athleteCardFull(doc, { athlete: subject, sports });
    expect(text(card)).toContain('Created');
    expect(text(card)).not.toContain('Sandbox athlete');

    const sandboxed = athleteCardFull(doc, {
      athlete: athlete({ sandbox: true }),
      sports,
    });
    expect(text(sandboxed)).toContain('Sandbox athlete');
  });

  it('omits the traits section entirely rather than showing an empty one', () => {
    const plain = athleteCardFull(doc, { athlete: athlete({ traits: [] }), sports });
    expect(plain.querySelector('.athlete-card__traits')).toBeNull();

    const trait = athleteCardFull(doc, { athlete: athlete({ traits: ['motor'] }), sports });
    expect(text(trait)).toContain('Motor');
  });

  it('renders an empty card rather than throwing when handed no sports', () => {
    expect(athleteCardFull(doc, { athlete: athlete(), sports: [] }).className).toContain(
      'athlete-card--empty',
    );
  });

  it('falls back to the first sport when asked for one it does not have', () => {
    const card = athleteCardFull(doc, { athlete: athlete(), sports, sportId: 'quidditch' });
    expect(card.dataset.sport).toBe('basketball');
  });
});

describe('compareRow', () => {
  it('shows the overall and whether the athlete is at home there', () => {
    const row = compareRow(doc, athlete({ primarySport: 'basketball' }), basketball);
    expect(text(row)).toContain('Basketball');
    expect(row.dataset.sport).toBe('basketball');

    const away = compareRow(doc, athlete({ primarySport: 'basketball', sportSkills: {} }), soccer);
    expect(text(away)).toContain('Novice');
  });
});

describe('initials', () => {
  it('takes the first and last words', () => {
    expect(initials('Marta Vieira')).toBe('MV');
    expect(initials('Pelé')).toBe('P');
    expect(initials('  A.   B.   C. ')).toBe('AC');
  });

  it('never renders an empty badge', () => {
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
  });
});
