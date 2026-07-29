/**
 * @spec    001-initial-dev
 * @phase   6 — Soccer · all three modes
 * @task    T-6.4 — Fouls, advantage, cards, free kicks, penalties
 * @story   US-4.1 — Play an 11v11 soccer match
 * @story   US-4.3 — Defend and keep goal
 * @design  06-game-design.md §3.2
 *
 * Purpose: the two rules a soccer game gets wrong most often after offside — that it is the
 * *offender's own* box that makes a penalty, and that an advantage pulled back is taken from where
 * the foul happened rather than from wherever the ball ended up.
 */
import { describe, expect, it } from 'vitest';
import { EventKind } from '@/engine/match/events.ts';
import { CENTRE_X, CENTRE_Y, penaltySpot } from '@/sports/soccer/pitch.ts';
import {
  ADVANTAGE_REAL_SECONDS,
  cardFor,
  commitFoul,
  isPlayingAdvantage,
  restartForFoul,
  tickAdvantage,
  type FoulContext,
} from '@/sports/soccer/fouls.ts';
import {
  RestartKind,
  SoccerEvent,
  createRulesState,
  isSentOff,
  playersRemaining,
  yellowCards,
} from '@/sports/soccer/rules.ts';

function foul(overrides: Partial<FoulContext> = {}): FoulContext {
  return {
    offender: 10,
    offenderSide: 0,
    victim: 20,
    x: CENTRE_X,
    y: CENTRE_Y,
    kind: 'trip',
    severity: 'careless',
    ...overrides,
  };
}

function kinds(events: readonly { kind: string; sportKind?: string }[]): string[] {
  return events.map((e) => e.sportKind ?? e.kind);
}

describe('where the restart is', () => {
  it('is a direct free kick from the spot of the offence', () => {
    expect(restartForFoul(foul({ x: 60, y: 20 }))).toEqual({
      kind: RestartKind.FREE_KICK,
      side: 1,
      x: 60,
      y: 20,
      reason: 'trip',
    });
  });

  it('is a penalty inside the offender own box', () => {
    const restart = restartForFoul(foul({ offenderSide: 0, x: 10, y: 30 }));
    expect(restart.kind).toBe(RestartKind.PENALTY);
    expect(restart.side).toBe(1);
    expect(restart).toMatchObject(penaltySpot(0));
  });

  it('is only a free kick when the offender fouls in the *other* box', () => {
    // Side 0 fouling deep in side 1's box — an attacker fouling a defender.
    const restart = restartForFoul(foul({ offenderSide: 0, x: 100, y: 34 }));
    expect(restart.kind).toBe(RestartKind.FREE_KICK);
    expect(restart.x).toBe(100);
  });

  it('is the mirror of itself at the other end', () => {
    const restart = restartForFoul(foul({ offenderSide: 1, x: 100, y: 30 }));
    expect(restart.kind).toBe(RestartKind.PENALTY);
    expect(restart.side).toBe(0);
    expect(restart).toMatchObject(penaltySpot(1));
  });
});

describe('what card is shown', () => {
  it('shows nothing for a careless foul and a yellow for a reckless one', () => {
    expect(cardFor(foul({ severity: 'careless' }))).toBeNull();
    expect(cardFor(foul({ severity: 'reckless' }))).toBe('yellow');
  });

  it('shows a straight red for excessive force, wherever it happened', () => {
    expect(cardFor(foul({ severity: 'excessive' }))).toBe('red');
    expect(cardFor(foul({ severity: 'excessive', x: 10, y: 30 }))).toBe('red');
  });

  it('shows a red for denying a clear chance outside the box', () => {
    expect(cardFor(foul({ dogso: true, x: 40, y: 34 }))).toBe('red');
  });

  it('shows only a yellow for a genuine attempt at the ball inside your own box', () => {
    // The 2016 "double jeopardy" amendment: the penalty is punishment enough.
    expect(cardFor(foul({ dogso: true, x: 10, y: 30, kind: 'slideTackle' }))).toBe('yellow');
    expect(cardFor(foul({ dogso: true, x: 10, y: 30, kind: 'trip' }))).toBe('yellow');
  });

  it('still shows a red for a handball or a hold, which are not attempts at the ball', () => {
    expect(cardFor(foul({ dogso: true, x: 10, y: 30, kind: 'handball' }))).toBe('red');
    expect(cardFor(foul({ dogso: true, x: 10, y: 30, kind: 'holding' }))).toBe('red');
  });
});

describe('committing a foul', () => {
  it('awards the kick, counts the foul, and emits the stream', () => {
    const state = createRulesState();
    const outcome = commitFoul(state, foul({ x: 60, y: 20 }), 400);

    expect(outcome.restart?.kind).toBe(RestartKind.FREE_KICK);
    expect(outcome.card).toBeNull();
    expect(state.teamFouls).toEqual([1, 0]);
    expect(state.restart?.side).toBe(1);
    expect(kinds(outcome.events)).toEqual([EventKind.FOUL, SoccerEvent.RESTART]);
  });

  it('cautions, and sends off on the second caution', () => {
    const state = createRulesState();

    const first = commitFoul(state, foul({ severity: 'reckless' }), 100);
    expect(first.card).toBe('yellow');
    expect(first.sentOff).toBe(false);
    expect(yellowCards(state, 10)).toBe(1);

    const second = commitFoul(state, foul({ severity: 'reckless' }), 200);
    expect(second.card).toBe('red');
    expect(second.sentOff).toBe(true);
    expect(isSentOff(state, 10)).toBe(true);
    expect(kinds(second.events)).toContain(SoccerEvent.SENT_OFF);
  });

  it('leaves the side a player short', () => {
    const state = createRulesState();
    const squad = [10, 11, 12, 13];
    expect(playersRemaining(state, squad)).toBe(4);
    commitFoul(state, foul({ severity: 'excessive' }), 100);
    expect(playersRemaining(state, squad)).toBe(3);
  });

  it('does not send the same athlete off twice', () => {
    const state = createRulesState();
    commitFoul(state, foul({ severity: 'excessive' }), 100);
    const again = commitFoul(state, foul({ severity: 'excessive' }), 200);
    expect(again.sentOff).toBe(false);
    expect(state.sentOff).toEqual([10]);
  });

  it('buys added time back for a card and for a penalty', () => {
    const carded = createRulesState();
    commitFoul(carded, foul({ severity: 'reckless' }), 100);
    expect(carded.boardAddedMinutes).toBe(1);

    const penalised = createRulesState();
    commitFoul(penalised, foul({ x: 10, y: 30 }), 100);
    expect(penalised.boardAddedMinutes).toBe(1);
  });
});

describe('advantage', () => {
  it('lets play run and awards nothing yet', () => {
    const state = createRulesState();
    const outcome = commitFoul(state, foul({ x: 60, y: 20, advantage: true }), 100);

    expect(outcome.restart).toBeNull();
    expect(isPlayingAdvantage(state)).toBe(true);
    expect(state.restart).toBeNull();
    expect(kinds(outcome.events)).toEqual([EventKind.FOUL, SoccerEvent.ADVANTAGE]);
  });

  it('is never played on a penalty — nothing is better than a penalty', () => {
    const state = createRulesState();
    const outcome = commitFoul(state, foul({ x: 10, y: 30, advantage: true }), 100);
    expect(outcome.restart?.kind).toBe(RestartKind.PENALTY);
    expect(isPlayingAdvantage(state)).toBe(false);
  });

  it('still shows the card while play runs on', () => {
    const state = createRulesState();
    const outcome = commitFoul(state, foul({ severity: 'reckless', advantage: true }), 100);
    expect(outcome.card).toBe('yellow');
    expect(isPlayingAdvantage(state)).toBe(true);
  });

  it('is confirmed when the attack survives the window', () => {
    const state = createRulesState();
    commitFoul(state, foul({ x: 60, y: 20, advantage: true }), 100);

    const window = ADVANTAGE_REAL_SECONDS * 60;
    let last: readonly { kind: string; sportKind?: string }[] = [];
    for (let i = 0; i < window; i++) last = tickAdvantage(state, true, 100 + i);

    expect(kinds(last)).toEqual([SoccerEvent.ADVANTAGE_PLAYED]);
    expect(isPlayingAdvantage(state)).toBe(false);
    // The free kick is gone for good.
    expect(state.restart).toBeNull();
  });

  it('is pulled back from where the foul happened, not from where the ball ended up', () => {
    const state = createRulesState();
    commitFoul(state, foul({ x: 60, y: 20, advantage: true }), 100);

    // Play ran on for a second and the ball is now at the other end — irrelevant.
    for (let i = 0; i < 60; i++) tickAdvantage(state, true, 100 + i);
    const events = tickAdvantage(state, false, 200);

    expect(kinds(events)).toEqual([SoccerEvent.ADVANTAGE_PULLED_BACK, SoccerEvent.RESTART]);
    expect(state.restart).toMatchObject({ kind: RestartKind.FREE_KICK, side: 1, x: 60, y: 20 });
    expect(isPlayingAdvantage(state)).toBe(false);
  });

  it('does nothing when there is no advantage running', () => {
    const state = createRulesState();
    expect(tickAdvantage(state, true, 0)).toEqual([]);
    expect(tickAdvantage(state, false, 0)).toEqual([]);
  });
});
