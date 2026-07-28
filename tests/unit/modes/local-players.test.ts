/**
 * @vitest-environment jsdom
 *
 * T-4.11 — local player names: remembered on the device, editable, never transmitted (US-17.3).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_NAME_LENGTH,
  PARTY_LIMITS,
  cleanName,
  forgetPlayers,
  loadPlayers,
  renamePlayer,
  savePlayers,
  seatPlayers,
} from '../../../src/modes/local-players.ts';
import { lsKey } from '../../../src/storage/scope.ts';

beforeEach(() => {
  forgetPlayers();
});

afterEach(() => {
  forgetPlayers();
});

describe('cleanName', () => {
  it('numbers a blank seat rather than refusing to start', () => {
    expect(cleanName('', 3)).toBe('Player 3');
    expect(cleanName('   ', 2)).toBe('Player 2');
  });

  it('collapses whitespace and caps the length', () => {
    expect(cleanName('  Ana   Maria ', 1)).toBe('Ana Maria');
    expect(cleanName('x'.repeat(40), 1)).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe('remembering names', () => {
  it('round-trips through preferences', () => {
    expect(loadPlayers()).toEqual([]);
    savePlayers([{ id: 'a', name: 'Ana' }]);
    expect(loadPlayers()).toEqual([{ id: 'a', name: 'Ana' }]);
  });

  it('never stores more than a device can seat', () => {
    savePlayers(Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })));
    expect(loadPlayers()).toHaveLength(PARTY_LIMITS.max);
  });

  it('ignores a stored value of the wrong shape rather than crashing a party', () => {
    localStorage.setItem(lsKey('party.players'), '"not a list"');
    expect(loadPlayers()).toEqual([]);

    localStorage.setItem(lsKey('party.players'), '[{"id":1}]');
    expect(loadPlayers()).toEqual([]);
  });

  it('forgets them on request (US-17.3 — removable at any time)', () => {
    savePlayers([{ id: 'a', name: 'Ana' }]);
    forgetPlayers();
    expect(loadPlayers()).toEqual([]);
  });
});

describe('seatPlayers', () => {
  it('reuses remembered names and numbers the rest', () => {
    savePlayers([{ id: 'a', name: 'Ana' }]);
    const seats = seatPlayers(3);
    expect(seats.map((seat) => seat.name)).toEqual(['Ana', 'Player 2', 'Player 3']);
  });

  it('clamps to the two-to-four the device can actually seat', () => {
    expect(seatPlayers(1)).toHaveLength(PARTY_LIMITS.min);
    expect(seatPlayers(9)).toHaveLength(PARTY_LIMITS.max);
  });
});

describe('renamePlayer', () => {
  it('renames one seat and leaves the others alone', () => {
    const seats = seatPlayers(3);
    const renamed = renamePlayer(seats, seats[1]!.id, 'Dad');
    expect(renamed.map((seat) => seat.name)).toEqual(['Player 1', 'Dad', 'Player 3']);
  });

  it('falls back to the seat number when the new name is blank', () => {
    const seats = renamePlayer(seatPlayers(2), 'seat-1', '   ');
    expect(seats[0]?.name).toBe('Player 1');
  });
});
