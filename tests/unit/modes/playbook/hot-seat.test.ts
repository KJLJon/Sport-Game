/**
 * @spec    001-initial-dev
 * @phase   5 — Playbook (turn-based) + basketball Playbook
 * @task    T-5.9 — Playbook hot-seat: pass-the-device screens, hidden calls, local player names
 * @story   US-17.1 — Play against someone else on one device
 * @design  09-modes-and-arcade.md §4
 *
 * The claim this suite protects: the second player's sheet cannot be reached without passing
 * through the curtain, because a call the other player saw is not a call.
 */
import { describe, expect, it } from 'vitest';
import { HotSeat, promptFor, seatsFor } from '../../../../src/modes/playbook/hot-seat.ts';
import type { LocalPlayer } from '../../../../src/modes/local-players.ts';

const PLAYERS: readonly LocalPlayer[] = [
  { id: 'p1', name: 'Ana' },
  { id: 'p2', name: 'Dad' },
];

function seat(curtain = true, firstSide: 0 | 1 = 0): HotSeat {
  const seats = seatsFor(PLAYERS);
  expect(seats).not.toBeNull();
  return new HotSeat({ seats: seats as never, curtain, firstSide });
}

describe('seats', () => {
  it('puts the first two local players on the two sides', () => {
    expect(seatsFor(PLAYERS)).toEqual([
      { side: 0, player: PLAYERS[0] },
      { side: 1, player: PLAYERS[1] },
    ]);
  });

  it('refuses to seat a match with only one person', () => {
    expect(seatsFor([PLAYERS[0] as LocalPlayer])).toBeNull();
    expect(seatsFor([])).toBeNull();
  });
});

describe('the hand-over', () => {
  it('opens behind the curtain, naming who the phone goes to', () => {
    const hot = seat();
    expect(hot.view()).toMatchObject({
      phase: 'handover',
      side: 0,
      name: 'Ana',
      prompt: 'Pass the phone to Ana.',
      concealing: true,
      called: 0,
    });
  });

  it('only opens the sheet on a deliberate tap', () => {
    const hot = seat();
    expect(hot.phase).toBe('handover');
    hot.submitted();
    // Nothing can be submitted from behind the curtain — the sheet is not on screen yet.
    expect(hot.phase).toBe('handover');
    hot.ready();
    expect(hot.phase).toBe('calling');
  });

  it('puts the curtain back between the two calls', () => {
    const hot = seat();
    hot.ready();
    hot.submitted();
    expect(hot.view()).toMatchObject({
      phase: 'handover',
      side: 1,
      name: 'Dad',
      prompt: 'Pass the phone to Dad.',
      concealing: true,
      called: 1,
    });
  });

  it('is ready to resolve once both have called, and names nobody', () => {
    const hot = seat();
    hot.ready();
    hot.submitted();
    hot.ready();
    hot.submitted();
    expect(hot.view()).toMatchObject({
      phase: 'ready',
      side: null,
      concealing: false,
      called: 2,
      prompt: 'Both calls are in.',
    });
  });

  it('ignores a second ready, so a double tap cannot skip a player', () => {
    const hot = seat();
    hot.ready();
    hot.ready();
    expect(hot.side).toBe(0);
    expect(hot.called).toBe(0);
  });

  it('ignores a submit once both are in', () => {
    const hot = seat();
    hot.ready();
    hot.submitted();
    hot.ready();
    hot.submitted();
    hot.submitted();
    expect(hot.called).toBe(2);
  });

  it('starts the next turn with whoever has the ball', () => {
    const hot = seat();
    hot.ready();
    hot.submitted();
    hot.ready();
    hot.submitted();

    hot.nextTurn(1);
    expect(hot.view()).toMatchObject({ phase: 'handover', side: 1, name: 'Dad', called: 0 });
    hot.ready();
    hot.submitted();
    expect(hot.side).toBe(0);
  });
});

describe('with the curtain off', () => {
  it('goes straight to the sheet rather than taxing a tap a possession', () => {
    const hot = seat(false);
    expect(hot.phase).toBe('calling');
    expect(hot.concealing).toBe(false);
  });

  it('still hands over between the two players', () => {
    const hot = seat(false);
    expect(hot.side).toBe(0);
    hot.submitted();
    expect(hot.side).toBe(1);
    expect(hot.phase).toBe('calling');
    hot.submitted();
    expect(hot.phase).toBe('ready');
  });

  it('never conceals anything', () => {
    const hot = seat(false);
    hot.submitted();
    expect(hot.concealing).toBe(false);
  });
});

describe('who calls first', () => {
  it('can be the away side', () => {
    const hot = seat(true, 1);
    expect(hot.view()).toMatchObject({ side: 1, name: 'Dad' });
    hot.ready();
    hot.submitted();
    expect(hot.side).toBe(0);
  });
});

describe('the words', () => {
  it('says names, never seat numbers (`09` §4)', () => {
    expect(promptFor('handover', 'Ana')).toBe('Pass the phone to Ana.');
    expect(promptFor('calling', 'Dad')).toBe('Dad, make your call.');
    expect(promptFor('ready', 'Ana')).toBe('Both calls are in.');
  });

  it('still reads sensibly for someone who never entered a name', () => {
    expect(promptFor('handover', '')).toBe('Pass the phone.');
    expect(promptFor('calling', '')).toBe('Make your call.');
  });
});
