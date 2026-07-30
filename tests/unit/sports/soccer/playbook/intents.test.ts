/**
 * T-6.19 — the five intent controls of `09` §2.3.
 *
 * Three things are worth testing here and the rest is bookkeeping: that a match of balanced intents
 * is *exactly* the match T-6.14's turn budget was derived against (so the derivation still holds),
 * that each dimension moves the thing it claims to move in the direction it claims, and that an
 * intent set persists across a turn where the player changed one chip and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../../../src/engine/rng.ts';
import type { PlaybookCall } from '../../../../../src/modes/playbook/types.ts';
import {
  DEFAULT_INTENTS,
  INTENT_DIMENSIONS,
  INTENT_OPTIONS,
  callFrom,
  callOptionsFor,
  composeEffect,
  dimensionsFor,
  headlineDimension,
  intentsFrom,
  optionsFor,
  type SoccerIntents,
} from '../../../../../src/sports/soccer/playbook/intents.ts';
import {
  createSoccerPlaybook,
  soccerPlaybook,
} from '../../../../../src/sports/soccer/playbook/index.ts';
import {
  FOCUS_PULL,
  focusBias,
  primaryFor,
} from '../../../../../src/sports/soccer/playbook/resolution.ts';
import {
  channelOf,
  soccerSquad,
  soccerSquads,
} from '../../../../../src/sports/soccer/playbook/squad.ts';
import { athlete, attributes } from '../../../../helpers/athletes.ts';
import { newSportSkill } from '../../../../../src/athletes/types.ts';

function eleven(prefix: string, rating = 55): ReturnType<typeof athlete>[] {
  return Array.from({ length: 11 }, (_, index) =>
    athlete({
      id: `${prefix}-${index}`,
      displayName: `${prefix} ${index}`,
      primarySport: 'soccer',
      heightCm: 180,
      weightKg: 76,
      attributes: attributes(rating),
      sportSkills: { soccer: newSportSkill(70) },
    }),
  );
}

const squads = (): ReturnType<typeof soccerSquads> => soccerSquads(eleven('home'), eleven('away'));

describe('soccer intent controls', () => {
  it('offers the five dimensions `09` §2.3 names', () => {
    expect(INTENT_DIMENSIONS).toEqual(['tempo', 'width', 'risk', 'press', 'focus']);
    for (const dimension of INTENT_DIMENSIONS) {
      expect(optionsFor(dimension).length).toBeGreaterThanOrEqual(3);
      expect(optionsFor(dimension).every((option) => option.dimension === dimension)).toBe(true);
    }
  });

  it('gives every option a unique id, a name, a blurb, and ratings it keys off', () => {
    const ids = new Set(INTENT_OPTIONS.map((option) => option.id));
    expect(ids.size).toBe(INTENT_OPTIONS.length);
    for (const option of INTENT_OPTIONS) {
      expect(option.name.length).toBeGreaterThan(0);
      expect(option.blurb.length).toBeGreaterThan(10);
      expect(option.keys.length).toBeGreaterThan(0);
    }
  });

  it('defaults to a full set, all of which exist', () => {
    for (const dimension of INTENT_DIMENSIONS) {
      const id = DEFAULT_INTENTS[dimension];
      expect(optionsFor(dimension).map((option) => option.id)).toContain(id);
    }
  });

  it('asks a side only about the dimensions that say anything in its role', () => {
    // Tempo is meaningless without the ball; a press line is meaningless with it.
    expect(dimensionsFor('offence')).toContain('tempo');
    expect(dimensionsFor('offence')).not.toContain('press');
    expect(dimensionsFor('defence')).toContain('press');
    expect(dimensionsFor('defence')).not.toContain('tempo');
    for (const shared of ['width', 'risk', 'focus'] as const) {
      expect(dimensionsFor('offence')).toContain(shared);
      expect(dimensionsFor('defence')).toContain(shared);
    }
  });

  it('tags every call option with its dimension so the sheet can lay out rows', () => {
    for (const role of ['offence', 'defence'] as const) {
      for (const option of callOptionsFor(role)) {
        expect(option.dimension).toBeDefined();
        expect(option.side).toBe(role);
      }
    }
    expect(callOptionsFor('offence').some((option) => option.targeted === true)).toBe(true);
  });

  it('leaves a balanced set exactly neutral, which is what keeps T-6.14’s turn budget true', () => {
    for (const role of ['offence', 'defence'] as const) {
      const effect = composeEffect(DEFAULT_INTENTS, role);
      expect(effect.climb).toBeCloseTo(0, 10);
      expect(effect.create).toBeCloseTo(0, 10);
      expect(effect.setPiece).toBeCloseTo(0, 10);
      expect(effect.finish).toBeCloseTo(0, 10);
      expect(effect.duration).toBeCloseTo(1, 10);
      // Effort is the exception: standing still is not free.
      expect(effect.effort).toBeGreaterThan(0);
    }
  });

  it('moves each dimension in the direction it claims', () => {
    const withOne = (dimension: keyof SoccerIntents, id: string): SoccerIntents => ({
      ...DEFAULT_INTENTS,
      [dimension]: id,
    });
    const base = composeEffect(DEFAULT_INTENTS, 'offence');

    // Patient: gets out of the back more often, works fewer openings, takes longer.
    const patient = composeEffect(withOne('tempo', 'patient'), 'offence');
    expect(patient.climb).toBeGreaterThan(base.climb);
    expect(patient.create).toBeLessThan(base.create);
    expect(patient.duration).toBeGreaterThan(base.duration);

    // Direct: the same trade the other way round, and a shorter turn.
    const direct = composeEffect(withOne('tempo', 'direct'), 'offence');
    expect(direct.climb).toBeLessThan(base.climb);
    expect(direct.create).toBeGreaterThan(base.create);
    expect(direct.duration).toBeLessThan(base.duration);

    // Wide: crosses win corners, and cost clear openings.
    const wide = composeEffect(withOne('width', 'wide'), 'offence');
    expect(wide.setPiece).toBeGreaterThan(base.setPiece);
    expect(wide.create).toBeLessThan(base.create);
    expect(composeEffect(withOne('width', 'narrow'), 'offence').create).toBeGreaterThan(
      base.create,
    );

    // Ambitious: cuts them open, gives it away.
    const ambitious = composeEffect(withOne('risk', 'ambitious'), 'offence');
    expect(ambitious.create).toBeGreaterThan(base.create);
    expect(ambitious.climb).toBeLessThan(base.climb);
  });

  it('makes a defensive intent deny rather than help, because it is subtracted', () => {
    const defence = composeEffect(DEFAULT_INTENTS, 'defence');
    const high = composeEffect({ ...DEFAULT_INTENTS, press: 'high' }, 'defence');
    const deep = composeEffect({ ...DEFAULT_INTENTS, press: 'deep' }, 'defence');

    // A high press raises what gets subtracted from `climb` — the ball is harder to move.
    expect(high.climb).toBeGreaterThan(defence.climb);
    // …and lowers what gets subtracted from `create`, which is the space it leaves behind.
    expect(high.create).toBeLessThan(defence.create);

    // A deep block is the trade in reverse, and makes the box harder to score in.
    expect(deep.climb).toBeLessThan(defence.climb);
    expect(deep.create).toBeGreaterThan(defence.create);
    expect(deep.finish).toBeGreaterThan(defence.finish);

    // Working harder costs more.
    expect(high.effort).toBeGreaterThan(deep.effort);
  });

  it('gives the tempo and press dimensions nothing to say in the wrong role', () => {
    for (const id of ['patient', 'direct'] as const) {
      const effect = composeEffect({ ...DEFAULT_INTENTS, tempo: id }, 'defence');
      expect(effect).toEqual(composeEffect(DEFAULT_INTENTS, 'defence'));
    }
    for (const id of ['deep', 'high'] as const) {
      const effect = composeEffect({ ...DEFAULT_INTENTS, press: id }, 'offence');
      expect(effect).toEqual(composeEffect(DEFAULT_INTENTS, 'offence'));
    }
  });

  it('merges previous, explicit, and headline — narrowest last', () => {
    const previous: SoccerIntents = { ...DEFAULT_INTENTS, width: 'wide', risk: 'safe' };

    // A bare call changing one chip keeps the other four (`09` §2.3's "persist until you change").
    const oneChip: PlaybookCall = { side: 0, call: 'direct' };
    expect(intentsFrom(previous, oneChip)).toEqual({ ...previous, tempo: 'direct' });

    // An explicit map wins over what was remembered.
    const explicit: PlaybookCall = { side: 0, call: 'patient', intents: { width: 'narrow' } };
    expect(intentsFrom(previous, explicit)).toEqual({
      ...previous,
      tempo: 'patient',
      width: 'narrow',
    });

    // The headline wins over the map, because it is what the player last touched.
    const conflicting: PlaybookCall = {
      side: 0,
      call: 'direct',
      intents: { tempo: 'patient', risk: 'ambitious' },
    };
    expect(intentsFrom(previous, conflicting).tempo).toBe('direct');
    expect(intentsFrom(previous, conflicting).risk).toBe('ambitious');
  });

  it('ignores an id that does not exist, or one filed under the wrong dimension', () => {
    const nonsense: PlaybookCall = {
      side: 0,
      call: 'not-a-call',
      intents: { width: 'high', risk: 'also-not-a-call' },
    };
    expect(intentsFrom(DEFAULT_INTENTS, nonsense)).toEqual(DEFAULT_INTENTS);
  });

  it('puts the role’s headline dimension on `call`, so anything reading `call` alone still works', () => {
    expect(headlineDimension('offence')).toBe('tempo');
    expect(headlineDimension('defence')).toBe('press');

    const intents: SoccerIntents = { ...DEFAULT_INTENTS, tempo: 'direct', press: 'high' };
    expect(callFrom(0, 'offence', intents).call).toBe('direct');
    expect(callFrom(1, 'defence', intents).call).toBe('high');
    expect(callFrom(0, 'offence', intents).intents).toEqual(intents);
    expect(callFrom(0, 'offence', intents, 7).target).toBe(7);
  });

  it('persists a set across turns the player did not touch', () => {
    const match = createSoccerPlaybook({ seed: 'persist', squads: squads(), playerSide: -1 });
    const attacking = match.state.possession === 1 ? 1 : 0;
    const defending = attacking === 1 ? 0 : 1;

    match.submit({
      side: attacking,
      call: 'direct',
      intents: { width: 'wide', risk: 'ambitious' },
    });
    match.submit({ side: defending, call: 'high', intents: { width: 'narrow' } });
    match.resolve();
    match.advance();

    expect(match.state.detail.intent[attacking]).toMatchObject({
      tempo: 'direct',
      width: 'wide',
      risk: 'ambitious',
    });
    expect(match.state.detail.intent[defending]).toMatchObject({
      press: 'high',
      width: 'narrow',
    });

    // Next turn, both sides change one chip and keep everything else.
    const nextAttacking = match.state.possession === 1 ? 1 : 0;
    const nextDefending = nextAttacking === 1 ? 0 : 1;
    match.submit({ side: nextAttacking, call: 'patient' });
    match.submit({ side: nextDefending, call: 'deep' });
    match.resolve();
    match.advance();

    expect(match.state.detail.intent[attacking].width).toBe('wide');
    expect(match.state.detail.intent[defending].width).toBe('narrow');
  });
});

describe('focus — the intent that moves who rather than how likely', () => {
  it('reads a channel off a formation role, and puts a left-sided centre back in the middle', () => {
    expect(channelOf('lb')).toBe('left');
    expect(channelOf('lm')).toBe('left');
    expect(channelOf('lw')).toBe('left');
    expect(channelOf('lwb')).toBe('left');
    expect(channelOf('rb')).toBe('right');
    expect(channelOf('rm')).toBe('right');
    expect(channelOf('rw')).toBe('right');
    expect(channelOf('rwb')).toBe('right');
    // A *left*-sided centre back is a centre back, and both strikers are central.
    expect(channelOf('lcb')).toBe('centre');
    expect(channelOf('rcb')).toBe('centre');
    expect(channelOf('lcm')).toBe('centre');
    expect(channelOf('ls')).toBe('centre');
    expect(channelOf('rs')).toBe('centre');
    // An id no formation names falls back to the middle rather than throwing.
    expect(channelOf('nonexistent')).toBe('centre');
  });

  it('resolves each focus id to what it points at', () => {
    expect(focusBias({ ...DEFAULT_INTENTS, focus: 'focus-left' })).toEqual({
      channel: 'left',
      athlete: null,
    });
    expect(focusBias({ ...DEFAULT_INTENTS, focus: 'focus-right' }).channel).toBe('right');
    expect(focusBias({ ...DEFAULT_INTENTS, focus: 'focus-centre' }).channel).toBe('centre');
    expect(focusBias({ ...DEFAULT_INTENTS, focus: 'focus-player' }, 4)).toEqual({
      channel: null,
      athlete: 4,
    });
    // Naming an athlete without naming one points at nobody rather than at athlete zero.
    expect(focusBias({ ...DEFAULT_INTENTS, focus: 'focus-player' }).athlete).toBeNull();
    expect(focusBias({ ...DEFAULT_INTENTS, focus: 'nonsense' })).toEqual({
      channel: null,
      athlete: null,
    });
  });

  it('gives the focused flank more of the ball without taking it off everyone else', () => {
    const squad = soccerSquad(eleven('home'), 0);
    const keys = ['crossing', 'offBall', 'dribbling'];

    const count = (channel: 'left' | 'centre' | 'right' | null): number => {
      let left = 0;
      for (let seed = 0; seed < 300; seed += 1) {
        const rng = createRng(`focus-${seed}`);
        const chosen = primaryFor(
          squad,
          keys,
          rng,
          channel === null ? undefined : { channel, athlete: null },
        );
        if (channelOf(chosen.role) === 'left') left += 1;
      }
      return left;
    };

    const unfocused = count(null);
    const focused = count('left');
    expect(focused).toBeGreaterThan(unfocused);
    // …and not to the exclusion of everybody else: ratings still beat instructions (`09` §2.2).
    expect(focused).toBeLessThan(300);
  });

  it('marks a named athlete out of the game more often than not', () => {
    const squad = soccerSquad(eleven('home'), 0);
    const marked = squad.players[9]?.id ?? 9;
    const keys = ['finishing', 'offBall'];

    const picks = (opposing: { channel: null; athlete: number | null }): number => {
      let hits = 0;
      for (let seed = 0; seed < 300; seed += 1) {
        const chosen = primaryFor(
          squad,
          keys,
          createRng(`mark-${seed}`),
          { channel: null, athlete: null },
          opposing,
        );
        if (chosen.id === marked) hits += 1;
      }
      return hits;
    };

    expect(picks({ channel: null, athlete: marked })).toBeLessThan(
      picks({ channel: null, athlete: null }),
    );
  });

  it('costs a marked athlete something on the ball as well, which is the one odds effect focus has', () => {
    expect(FOCUS_PULL.createPenalty).toBeGreaterThan(0);
    expect(FOCUS_PULL.finishPenalty).toBeGreaterThan(0);
    // The pull on selection is about the size of a real rating gap, not larger.
    expect(FOCUS_PULL.channel).toBeLessThan(20);
    expect(FOCUS_PULL.marked).toBeLessThan(20);
  });
});

describe('intents change what a match looks like', () => {
  /** Plays a whole match with one side pinned to a fixed set and the other on the baseline CPU. */
  function pinned(
    seed: string,
    intents: Partial<SoccerIntents>,
  ): { corners: number; goals: number } {
    const match = createSoccerPlaybook({ seed, squads: squads(), playerSide: -1 });
    let corners = 0;

    while (!match.finished) {
      for (const side of [0, 1] as const) {
        if (side === 0) {
          const role = match.state.possession === 0 ? 'offence' : 'defence';
          match.submit(callFrom(0, role, { ...DEFAULT_INTENTS, ...intents }));
        } else {
          const call = match.autoCall(side);
          if (call === null) throw new Error('expected an autoCall');
          match.submit(call);
        }
      }
      const turn = match.resolve();
      match.advance();
      if (turn.attacking === 0 && turn.outcome === 'corner') corners += 1;
    }

    return { corners, goals: match.state.score[0] };
  }

  it('wins more corners playing wide than playing narrow', () => {
    let wide = 0;
    let narrow = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      wide += pinned(`width-${seed}`, { width: 'wide' }).corners;
      narrow += pinned(`width-${seed}`, { width: 'narrow' }).corners;
    }
    expect(wide).toBeGreaterThan(narrow);
  });

  it('is deterministic for a fixed set of intents (INV-8)', () => {
    const a = pinned('determinism', { tempo: 'direct', risk: 'ambitious' });
    const b = pinned('determinism', { tempo: 'direct', risk: 'ambitious' });
    expect(b).toEqual(a);
  });

  it('reports the intents it played on the turn’s own event, for the box score and the screen', () => {
    const match = createSoccerPlaybook({ seed: 'events', squads: squads(), playerSide: -1 });
    const attacking = match.state.possession === 1 ? 1 : 0;
    const defending = attacking === 1 ? 0 : 1;

    match.submit(callFrom(attacking, 'offence', { ...DEFAULT_INTENTS, tempo: 'direct' }));
    match.submit(callFrom(defending, 'defence', { ...DEFAULT_INTENTS, press: 'high' }));
    const turn = match.resolve();

    const possession = turn.events.find((one) => one.kind === 'possession');
    expect(possession?.detail).toMatchObject({ tempo: 'direct', press: 'high' });
  });

  it('still runs a match in the turn budget with every dimension in play', () => {
    // The five intents are allowed to make a match longer or shorter; they are not allowed to make
    // it a different mode. Anything outside this band means an effect table has gone runaway.
    const counts: number[] = [];
    for (let seed = 0; seed < 12; seed += 1) {
      const match = createSoccerPlaybook({
        seed: `budget-${seed}`,
        squads: squads(),
        playerSide: -1,
      });
      while (!match.finished) {
        for (const side of [0, 1] as const) {
          const call = match.autoCall(side);
          if (call === null) throw new Error('expected an autoCall');
          match.submit(call);
        }
        match.resolve();
        match.advance();
      }
      if (match.state.period <= 2) counts.push(match.turns.length);
    }

    const mean = counts.reduce((total, count) => total + count, 0) / counts.length;
    expect(mean).toBeGreaterThanOrEqual(18);
    expect(mean).toBeLessThanOrEqual(24);
  });

  it('exposes the whole catalogue through the adapter’s own call sheet', () => {
    const match = createSoccerPlaybook({ seed: 'sheet', squads: squads() });
    const attacking = match.state.possession === 1 ? 1 : 0;
    expect(soccerPlaybook.calls(match.state, attacking)).toEqual(callOptionsFor('offence'));
  });
});
