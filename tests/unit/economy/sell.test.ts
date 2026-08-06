/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.13 — Sell-back: valuation, squad-lock guard, confirmation, anti-farm invariants
 * @story   US-9.3 — Sell athletes for coins
 * @design  05-data-model.md §5.1, 10-ui-ux.md §10 (confirmation)
 *
 * Purpose: the three things that can stop a sale, and the sentence the player is asked to agree to.
 *
 * The squad guard is a *warning*, not a prohibition — US-9.3 says "unless I confirm" — and the
 * last-athlete guard is the opposite. Getting those two the wrong way round would either strand a
 * player with an unsellable squad or let them empty their save in two taps, and the difference is
 * one boolean.
 */
import { describe, expect, it } from 'vitest';
import { quoteSale, quoteFor, sellDetail, squadHolds, valueFor } from '@/economy/sell.ts';
import { sellPrice } from '@/economy/valuation.ts';
import { athlete } from '../../helpers/athletes.ts';
import type { Squad } from '@/teams/types.ts';

function squad(overrides: Partial<Squad> = {}): Squad {
  return {
    id: 'team-1:basketball',
    teamId: 'team-1',
    sportId: 'basketball',
    starters: { PG: 'a1' },
    bench: [],
    updatedAt: 0,
    ...overrides,
  };
}

const SUBJECT = athlete({ id: 'a1', displayName: 'Ada Quill', rarity: 'rare' });

describe('quoteFor', () => {
  it('is `05` §5.1’s sell price at the athlete’s primary sport', () => {
    expect(quoteFor(SUBJECT, 70)).toBe(
      sellPrice({ rarity: 'rare', overall: 70, level: SUBJECT.sportSkills['basketball']!.level }),
    );
  });

  it('shows the full value alongside, so the third is visible rather than felt', () => {
    expect(valueFor(SUBJECT, 70)).toBeGreaterThan(quoteFor(SUBJECT, 70));
  });
});

describe('quoteSale', () => {
  it('allows a plain sale, with nothing in the way', () => {
    const quote = quoteSale({ athlete: SUBJECT, overall: 70, squads: [], rosterSize: 12 });
    expect(quote.block).toBeNull();
    expect(quote.hard).toBe(false);
    expect(quote.confirmation).toContain('Ada Quill');
    expect(quote.confirmation).toContain('cannot be undone');
  });

  it('warns about a squad without forbidding it (US-9.3)', () => {
    const quote = quoteSale({
      athlete: SUBJECT,
      overall: 70,
      squads: [squad()],
      rosterSize: 12,
    });

    expect(quote.block?.kind).toBe('in-squad');
    // Overridable: the player is told, and then allowed.
    expect(quote.hard).toBe(false);
    expect(quote.block?.message).toContain('a player short');
  });

  it('counts a bench place as being in the squad', () => {
    const quote = quoteSale({
      athlete: SUBJECT,
      overall: 70,
      squads: [squad({ starters: {}, bench: ['a1'] })],
      rosterSize: 12,
    });
    expect(quote.block?.kind).toBe('in-squad');
  });

  it('names how many squads, when there is more than one', () => {
    const quote = quoteSale({
      athlete: SUBJECT,
      overall: 70,
      squads: [squad(), squad({ id: 'team-2:soccer', teamId: 'team-2', sportId: 'soccer' })],
      rosterSize: 12,
    });
    expect(quote.block?.message).toContain('2 squads');
  });

  it('refuses the last athlete in the save, and cannot be talked round', () => {
    const quote = quoteSale({ athlete: SUBJECT, overall: 70, squads: [], rosterSize: 1 });
    expect(quote.block?.kind).toBe('last-athlete');
    expect(quote.hard).toBe(true);
  });

  it('puts the exact payout in the sentence the player agrees to', () => {
    const quote = quoteSale({ athlete: SUBJECT, overall: 82, squads: [], rosterSize: 12 });
    expect(quote.confirmation).toContain(quote.coins.toLocaleString('en-US'));
  });
});

describe('squadHolds', () => {
  it('finds a starter and a bench place, and nothing else', () => {
    expect(squadHolds(squad(), 'a1')).toBe(true);
    expect(squadHolds(squad({ starters: {}, bench: ['a1'] }), 'a1')).toBe(true);
    expect(squadHolds(squad({ starters: { PG: 'other' } }), 'a1')).toBe(false);
  });
});

describe('sellDetail', () => {
  it('names who was sold, so a ledger reads a month later', () => {
    expect(sellDetail(SUBJECT)).toBe('Sold Ada Quill');
  });
});
