/**
 * T-6.22 — soccer's key moments: detection, the run, and the fold-back.
 *
 * The claim this suite protects is the one basketball's equivalent protects: a key moment changes
 * *what happened*, not how much the turn is worth twice over. What is new here is the defending
 * moment being a **keeper's** moment, where `made` means the opposite of a goal — an inversion that
 * would silently break half the mode and that nothing else in the project would notice.
 */
import { describe, expect, it } from 'vitest';
import { EventKind } from '../../../../../src/engine/match/events.ts';
import { simulatePlaybookMatch } from '../../../../../src/modes/playbook/match.ts';
import { SOCCER_RULES } from '../../../../../src/sports/soccer/rules.ts';
import { keyMomentConfig, startKeyMoment } from '../../../../../src/modes/playbook/key-moment.ts';
import type {
  ArcadeInvocation,
  CallPair,
  KeyMomentOutcome,
  PlaybookState,
  TurnResolution,
} from '../../../../../src/modes/playbook/types.ts';
import { SOCCER_ARCADE } from '../../../../../src/sports/soccer/arcade/index.ts';
import {
  createSoccerPlaybook,
  soccerPlaybook,
} from '../../../../../src/sports/soccer/playbook/index.ts';
import {
  MOMENT_GAMES,
  applyKeyMomentOutcome,
  detectKeyMoment,
  leverageFor,
} from '../../../../../src/sports/soccer/playbook/key-moments.ts';
import { soccerSquads } from '../../../../../src/sports/soccer/playbook/squad.ts';
import type { SoccerPlaybookState } from '../../../../../src/sports/soccer/playbook/resolution.ts';
import { athlete, attributes } from '../../../../helpers/athletes.ts';
import { newSportSkill } from '../../../../../src/athletes/types.ts';

type State = PlaybookState<SoccerPlaybookState>;

function eleven(prefix: string): ReturnType<typeof athlete>[] {
  return Array.from({ length: 11 }, (_, index) =>
    athlete({
      id: `${prefix}-${index}`,
      displayName: `${prefix} ${index}`,
      primarySport: 'soccer',
      attributes: attributes(60),
      sportSkills: { soccer: newSportSkill(70) },
    }),
  );
}

function stateFor(overrides: Partial<State> = {}): State {
  const match = createSoccerPlaybook({
    seed: 'km',
    squads: soccerSquads(eleven('home'), eleven('away')),
    playerSide: 0,
  });
  Object.assign(match.state, overrides);
  return match.state;
}

/** A call pair, with the attacking side's width intent set to whatever the test needs. */
function pair(width: string): CallPair {
  return { offence: { side: 0, call: width }, defence: { side: 1, call: 'mid' } };
}

function shot(phase: string, chance: number, made: boolean) {
  return {
    kind: EventKind.SHOT,
    step: 0,
    side: 0 as const,
    actor: 7,
    target: 100,
    value: 1,
    detail: { phase, made, onTarget: true, distance: 12, chance },
  };
}

function turn(overrides: Partial<TurnResolution> = {}): TurnResolution {
  return {
    turn: 0,
    calls: pair('balanced-width'),
    attacking: 0,
    outcome: 'saved',
    actor: 7,
    target: 100,
    points: 0,
    seconds: 90,
    retainsPossession: false,
    events: [shot('chance', 0.45, false)],
    expectation: { successChance: 0.45, expectedPoints: 0.45, because: 'A clear look.' },
    ...overrides,
  };
}

function invocation(game: string, actor = 7): ArcadeInvocation {
  return { game, actor, leverage: 0.5, prompt: 'x' };
}

function outcome(game: string, made: boolean, actor = 7): KeyMomentOutcome {
  return {
    invocation: invocation(game, actor),
    made,
    quality: made ? 0.9 : 0.1,
    simWouldHave: !made,
    simPoints: made ? 0 : 1,
  };
}

describe('detection (`09` §2.4)', () => {
  it('maps every moment it offers onto a game that exists (`09` §3.2)', () => {
    const ids = new Set(SOCCER_ARCADE.map((game) => game.id));
    for (const game of Object.values(MOMENT_GAMES)) expect(ids, game).toContain(game);
  });

  it('leaves the penalty unwired, because the model has no fouls to award one', () => {
    // Deliberate and recorded rather than forgotten: soccer's Playbook resolves a phase into
    // outcomes that never include a foul, so nothing can trigger a spot kick. The Penalty Shootout
    // belongs to the shootout that decides a drawn match, which is match-level work.
    expect(Object.values(MOMENT_GAMES)).not.toContain('soccer.penalty-shootout');
  });

  it('offers nothing when nobody is at the controls', () => {
    expect(detectKeyMoment(stateFor({ playerSide: -1 }), turn())).toBeNull();
  });

  it('offers nothing on a turn with no shot in it', () => {
    expect(detectKeyMoment(stateFor(), turn({ outcome: 'advance', events: [] }))).toBeNull();
  });

  it('offers the one-on-one on a clear chance, and not on a half one', () => {
    const clear = detectKeyMoment(stateFor(), turn({ events: [shot('chance', 0.45, false)] }));
    expect(clear?.game).toBe(MOMENT_GAMES.oneOnOne);

    const half = detectKeyMoment(stateFor(), turn({ events: [shot('chance', 0.08, false)] }));
    expect(half).toBeNull();
  });

  it('offers the free kick on a dead ball played without width', () => {
    const moment = detectKeyMoment(stateFor(), turn({ events: [shot('setPiece', 0.2, false)] }));
    expect(moment?.game).toBe(MOMENT_GAMES.freeKick);
  });

  it('lets a call for width outrank the phase — a cross swung in is a header', () => {
    // The ordering that matters, and the reason it is this way round: the player asked for crosses,
    // so the ball came in from the flank, whether the phase was a set piece or open play.
    const state = stateFor();
    const setPiece = detectKeyMoment(
      state,
      turn({ calls: pair('wide'), events: [shot('setPiece', 0.2, false)] }),
    );
    expect(setPiece?.game).toBe(MOMENT_GAMES.header);

    const openPlay = detectKeyMoment(
      state,
      turn({ calls: pair('wide'), events: [shot('chance', 0.45, false)] }),
    );
    expect(openPlay?.game).toBe(MOMENT_GAMES.header);
  });

  it('offers the goal-line save to the defending player, and only on target', () => {
    const state = stateFor({ playerSide: 1 });
    const onTarget = detectKeyMoment(state, turn({ outcome: 'saved' }));
    expect(onTarget?.game).toBe(MOMENT_GAMES.goalLineSave);
    // The keeper is the one who plays it, not the shooter.
    expect(onTarget?.actor).toBe(100);

    expect(detectKeyMoment(state, turn({ outcome: 'off-target' }))).toBeNull();
    expect(detectKeyMoment(state, turn({ outcome: 'blocked' }))).toBeNull();
  });

  it('names the athlete whose moment it is, and offers nothing when it cannot', () => {
    const mine = detectKeyMoment(stateFor(), turn());
    expect(mine?.actor).toBe(7);
    expect(mine?.prompt.length).toBeGreaterThan(5);

    // `exactOptionalPropertyTypes` means an absent actor is a *missing* key, not an explicit
    // `undefined` — which is also what a resolution with nobody named actually looks like.
    const { actor: _actor, ...anonymous } = turn();
    expect(detectKeyMoment(stateFor(), anonymous)).toBeNull();
  });
});

describe('leverage', () => {
  it('is the base early in a comfortable lead', () => {
    const early = stateFor({ period: 1, clock: 2000, score: [3, 0] });
    expect(leverageFor(early, 0.4)).toBeCloseTo(0.4, 5);
  });

  it('climbs towards one as the match gets late and close', () => {
    const late = stateFor({ period: 2, clock: 0, score: [1, 1] });
    expect(leverageFor(late, 0.4)).toBeGreaterThan(0.9);
  });

  it('stays at the base late in a rout — a consolation chance is not clutch', () => {
    const rout = stateFor({ period: 2, clock: 0, score: [5, 0] });
    expect(leverageFor(rout, 0.4)).toBeCloseTo(0.4, 5);
  });

  it('never leaves the unit range, at any score or clock', () => {
    for (const period of [1, 2, 3]) {
      for (const clock of [0, 600, 2700]) {
        for (const score of [
          [0, 0],
          [4, 0],
          [2, 3],
        ] as [number, number][]) {
          const value = leverageFor(stateFor({ period, clock, score }), 0.55);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('the arcade run', () => {
  it('is calibrated for the athlete whose moment it is, and is one unrewarded attempt', () => {
    const state = stateFor();
    const config = keyMomentConfig(state, invocation(MOMENT_GAMES.oneOnOne), 'seed');
    expect(config?.athlete.id).toBe('home-7');
    expect(config?.mode).toBe('practice');

    const run = startKeyMoment(SOCCER_ARCADE, state, invocation(MOMENT_GAMES.oneOnOne), 'seed');
    expect(run).not.toBeNull();
  });

  it('starts the keeper’s own game for a goal-line save', () => {
    const state = stateFor({ playerSide: 1 });
    const run = startKeyMoment(
      SOCCER_ARCADE,
      state,
      invocation(MOMENT_GAMES.goalLineSave, 100),
      'seed',
    );
    expect(run).not.toBeNull();
  });
});

describe('folding the result back in (INV-9)', () => {
  it('turns a made attacking moment into a goal, worth exactly one', () => {
    const state = stateFor();
    const folded = applyKeyMomentOutcome(state, turn(), outcome(MOMENT_GAMES.oneOnOne, true));

    expect(folded.outcome).toBe('goal');
    expect(folded.points).toBe(1);
    expect(folded.scores).toEqual([{ points: 1, actor: 7 }]);
    expect(folded.retainsPossession).toBe(false);
    expect(folded.fromKeyMoment?.made).toBe(true);

    const shots = folded.events.filter((entry) => entry.kind === EventKind.SHOT);
    expect(shots).toHaveLength(1);
    expect(shots[0]?.detail?.['made']).toBe(true);
    expect(shots[0]?.detail?.['keyMoment']).toBe(true);
    expect(folded.events.some((entry) => entry.kind === EventKind.SAVE)).toBe(false);
  });

  it('turns a missed attacking moment into a save credited to the other side', () => {
    const state = stateFor();
    const folded = applyKeyMomentOutcome(state, turn(), outcome(MOMENT_GAMES.oneOnOne, false));

    expect(folded.outcome).toBe('saved');
    expect(folded.points).toBe(0);
    expect(folded.scores).toEqual([]);

    const save = folded.events.find((entry) => entry.kind === EventKind.SAVE);
    expect(save).toBeDefined();
    expect(save?.side).toBe(1);
    // The keeper made it; the shooter is who they made it against.
    expect(save?.actor).toBe(100);
    expect(save?.target).toBe(7);
  });

  it('inverts `made` for the keeper’s moment, which is the whole of the defending half', () => {
    // The single most breakable claim in the file. `made` always means "the player did their job",
    // so in goal a made moment is a shot *kept out* and a missed one is a goal conceded. Getting
    // this backwards would score the mode's defending half exactly wrong and nothing else in the
    // project would notice.
    const state = stateFor({ playerSide: 1 });

    const saved = applyKeyMomentOutcome(
      state,
      turn(),
      outcome(MOMENT_GAMES.goalLineSave, true, 100),
    );
    expect(saved.outcome).toBe('saved');
    expect(saved.points).toBe(0);
    expect(saved.events.some((entry) => entry.kind === EventKind.SAVE)).toBe(true);

    const beaten = applyKeyMomentOutcome(
      state,
      turn(),
      outcome(MOMENT_GAMES.goalLineSave, false, 100),
    );
    expect(beaten.outcome).toBe('goal');
    expect(beaten.points).toBe(1);
    // The goal belongs to the side that was attacking, and to the athlete who took the shot — never
    // to the keeper the moment was offered to.
    expect(beaten.scores).toEqual([{ points: 1, actor: 7 }]);
  });

  it('gives a missed dead ball its restart back, so the phase graph still has one', () => {
    const state = stateFor();
    const folded = applyKeyMomentOutcome(
      state,
      turn({ events: [shot('setPiece', 0.2, false)] }),
      outcome(MOMENT_GAMES.freeKick, false),
    );
    const restart = folded.events.find((entry) => entry.kind === EventKind.SPORT);
    expect(restart?.detail?.['kind']).toBe('goalKick');
  });

  it('keeps the possession event and replaces everything else', () => {
    const state = stateFor();
    const possession = {
      kind: EventKind.POSSESSION,
      step: 0,
      side: 0 as const,
      actor: 7,
    };
    const folded = applyKeyMomentOutcome(
      state,
      turn({ events: [possession, shot('chance', 0.45, false)] }),
      outcome(MOMENT_GAMES.oneOnOne, true),
    );

    expect(folded.events.filter((entry) => entry.kind === EventKind.POSSESSION)).toHaveLength(1);
    expect(folded.events).not.toContainEqual(shot('chance', 0.45, false));
    // No `mode` field ever reaches the stream, whichever mode built the event (INV-9).
    for (const entry of folded.events) expect(Object.keys(entry)).not.toContain('mode');
  });
});

describe('the adapter exposes both halves', () => {
  it('answers `keyMoment` and `applyKeyMoment` now that the games exist', () => {
    const state = stateFor();
    expect(soccerPlaybook.keyMoment(state, turn())?.game).toBe(MOMENT_GAMES.oneOnOne);
    expect(soccerPlaybook.applyKeyMoment).toBeDefined();
    expect(
      soccerPlaybook.applyKeyMoment?.(state, turn(), outcome(MOMENT_GAMES.oneOnOne, true)).outcome,
    ).toBe('goal');
  });
});

describe('against matches the sim actually plays', () => {
  it('offers all four moments at a rate a player would notice', () => {
    // The test the synthetic resolutions above cannot be: detection reads `detail.phase` and
    // `detail.chance` off events `resolution.ts` builds, and a rename on either side would zero a
    // moment out silently — every unit test here would still pass, and the moment would simply never
    // appear in a real match again.
    const counts = new Map<string, number>();
    let turns = 0;

    for (let seed = 0; seed < 12; seed += 1) {
      const match = simulatePlaybookMatch<SoccerPlaybookState>({
        seed: `moments-${seed}`,
        adapter: soccerPlaybook,
        sport: 'soccer',
        rules: SOCCER_RULES,
        squads: soccerSquads(eleven('home'), eleven('away')),
        playerSide: 0,
      });
      for (const resolution of match.turns) {
        turns += 1;
        const moment = detectKeyMoment(match.state, resolution);
        if (moment !== null) counts.set(moment.game, (counts.get(moment.game) ?? 0) + 1);
      }
    }

    for (const game of Object.values(MOMENT_GAMES)) {
      expect(counts.get(game) ?? 0, game).toBeGreaterThan(0);
    }

    // Roughly one moment every few turns. Loose bounds on purpose — this is a guard against a
    // moment vanishing or firing on every turn, not a pin on the balance, which is T-6.18's.
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    expect(total / turns).toBeGreaterThan(0.05);
    expect(total / turns).toBeLessThan(0.5);
  });
});
