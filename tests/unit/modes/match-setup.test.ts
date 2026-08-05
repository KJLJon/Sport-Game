/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.2 — Match setup screens for Live and Playbook
 * @story   US-10.2 — Set up an exhibition
 * @design  09-modes-and-arcade.md §1, 10-ui-ux.md §8.1
 * @invariant INV-8 (an opponent is a pure function of its seed)
 *
 * Purpose: the round trip. A setup that cannot survive being written to a link and read back is a
 * setup that silently changes when a player uses the back button.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_SETUP,
  LENGTH_SCALE,
  decodeSetup,
  encodeSetup,
  liveMatchHref,
  scalePeriodSteps,
  withQuery,
  type MatchSetupChoice,
} from '@/modes/match-setup.ts';

const CUSTOM: MatchSetupChoice = {
  sport: 'soccer',
  teamId: 'team-7',
  opponentSeed: 'opponent-abc',
  difficulty: 'legend',
  length: 'quick',
  rules: { fouls: false, offside: false },
};

describe('encoding', () => {
  it('writes nothing for a choice that is entirely default', () => {
    // A plain link stays plain: a parameter nobody set is a parameter nobody has to understand.
    expect(encodeSetup(DEFAULT_MATCH_SETUP)).toEqual({});
  });

  it('writes only what differs', () => {
    expect(encodeSetup({ ...DEFAULT_MATCH_SETUP, length: 'short' })).toEqual({ length: 'short' });
  });

  it('round-trips a fully custom choice', () => {
    const decoded = decodeSetup(encodeSetup(CUSTOM), 'soccer');
    expect(decoded).toEqual(CUSTOM);
  });

  it('sorts query keys, so the same choice is always the same link', () => {
    const href = liveMatchHref(CUSTOM);
    expect(href).toBe(liveMatchHref(CUSTOM));
    expect(href.startsWith('#/play/live/soccer?')).toBe(true);
    // Sorted: difficulty before fouls before length before offside before team before vs.
    expect(href.indexOf('difficulty=')).toBeLessThan(href.indexOf('team='));
  });

  it('escapes a value that would otherwise break the query', () => {
    const href = liveMatchHref({ ...DEFAULT_MATCH_SETUP, teamId: 'a&b=c' });
    expect(href).toContain('team=a%26b%3Dc');
  });

  it('leaves a base alone when there is nothing to add', () => {
    expect(withQuery('#/play/live/soccer', {})).toBe('#/play/live/soccer');
  });
});

describe('decoding', () => {
  it('falls back rather than throwing on a hand-edited link', () => {
    // `?difficulty=impossible` deserves a match at Pro, not an error screen.
    const decoded = decodeSetup({ difficulty: 'impossible', length: 'epic' }, 'soccer');
    expect(decoded.difficulty).toBe(DEFAULT_MATCH_SETUP.difficulty);
    expect(decoded.length).toBe(DEFAULT_MATCH_SETUP.length);
  });

  it('falls back to a playable sport when the link names one that is not', () => {
    expect(decodeSetup({}, 'underwater-hockey').sport).toBe(DEFAULT_MATCH_SETUP.sport);
  });

  it('treats an empty team as no team rather than as a team called ""', () => {
    expect(decodeSetup({ team: '' }, 'soccer').teamId).toBeNull();
  });

  it('reads rules as on unless a link says otherwise', () => {
    expect(decodeSetup({}, 'soccer').rules).toEqual({ fouls: true, offside: true });
    expect(decodeSetup({ fouls: 'off' }, 'soccer').rules.fouls).toBe(false);
    // Anything that is not the literal `off` leaves the rule on: a truncated link plays properly.
    expect(decodeSetup({ fouls: 'maybe' }, 'soccer').rules.fouls).toBe(true);
  });
});

describe('match length', () => {
  it('scales the sport s own period rather than naming minutes', () => {
    expect(scalePeriodSteps(1000, 'full')).toBe(1000);
    expect(scalePeriodSteps(1000, 'short')).toBe(500);
    expect(scalePeriodSteps(1000, 'quick')).toBe(250);
  });

  it('never produces a period of zero steps', () => {
    // A match that ends before it starts. Reachable on `quick` if a sport had a very short period.
    expect(scalePeriodSteps(2, 'quick')).toBeGreaterThanOrEqual(1);
    expect(scalePeriodSteps(1, 'quick')).toBe(1);
  });

  it('orders the lengths the way the labels claim', () => {
    expect(LENGTH_SCALE.quick).toBeLessThan(LENGTH_SCALE.short);
    expect(LENGTH_SCALE.short).toBeLessThan(LENGTH_SCALE.full);
    expect(LENGTH_SCALE.full).toBe(1);
  });
});
