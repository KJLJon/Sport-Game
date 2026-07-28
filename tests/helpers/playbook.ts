/**
 * Playbook fixtures. A deliberately dull adapter: it exercises the turn engine's contract without
 * being any sport, so a failure here is a failure of the engine and not of basketball's model.
 */
import type { Rng } from '../../src/engine/rng.ts';
import type { Side } from '../../src/engine/match/events.ts';
import { EventKind, event } from '../../src/engine/match/events.ts';
import type { MatchRules } from '../../src/engine/match/state-machine.ts';
import type {
  ArcadeInvocation,
  CallOption,
  CallPair,
  KeyMomentOutcome,
  NarrationLine,
  PlaybookAdapter,
  PlaybookAthlete,
  PlaybookSquad,
  PlaybookState,
  TurnResolution,
} from '../../src/modes/playbook/types.ts';
import { athlete } from './athletes.ts';

export interface FakeDetail {
  resolutions: number;
  lastCall: string;
}

export const FAKE_RULES: MatchRules = {
  periods: 2,
  // Twelve turns of six seconds each, at one second per step.
  periodSteps: 72,
  overtimeSteps: 36,
};

export const FAKE_CALLS: readonly CallOption[] = [
  { id: 'attack', name: 'Attack', side: 'offence', blurb: 'Go at them.', keys: ['finishing'] },
  { id: 'settle', name: 'Settle', side: 'offence', blurb: 'Take the good one.', keys: ['passing'] },
  { id: 'press', name: 'Press', side: 'defence', blurb: 'Squeeze them.', keys: ['perimeterD'] },
  { id: 'drop', name: 'Drop', side: 'defence', blurb: 'Protect the rim.', keys: ['interiorD'] },
];

export function playbookAthlete(
  id: number,
  overrides: Partial<PlaybookAthlete> = {},
): PlaybookAthlete {
  return {
    id,
    athlete: athlete({ id: `a${id}` }),
    ratings: { finishing: 60, passing: 60, perimeterD: 60, interiorD: 60 },
    role: 'PG',
    stamina: 1,
    ...overrides,
  };
}

export function squad(side: Side, size = 3): PlaybookSquad {
  const base = side === 1 ? 100 : 0;
  return {
    side,
    players: Array.from({ length: size }, (_, i) => playbookAthlete(base + i)),
  };
}

export function squads(size = 3): readonly [PlaybookSquad, PlaybookSquad] {
  return [squad(0, size), squad(1, size)];
}

export interface FakeAdapterOptions {
  /** Leverage every proposed key moment carries. Above 1 means "never proposed". */
  readonly leverage?: number;
  /** Whether a key moment is proposed at all. */
  readonly keyMoments?: boolean;
  /** Whether the adapter implements `applyKeyMoment`. */
  readonly appliesKeyMoment?: boolean;
  /** Game seconds each turn consumes. */
  readonly seconds?: number;
  /** Turns after which `isFinished` returns true, or `null` for never. */
  readonly finishAfter?: number | null;
}

/**
 * An adapter whose outcome is one seeded coin flip, so the engine's plumbing is what is under test.
 * `Attack` scores three when it lands, `Settle` two, and the defensive call shifts the odds a
 * little — enough that a test can tell the calls apart, not enough to be a model.
 */
export function fakeAdapter(options: FakeAdapterOptions = {}): PlaybookAdapter<FakeDetail> {
  const leverage = options.leverage ?? 0.9;
  const proposes = options.keyMoments ?? false;
  const seconds = options.seconds ?? 6;
  const finishAfter = options.finishAfter ?? null;

  const adapter: PlaybookAdapter<FakeDetail> = {
    turnKind: 'possession',

    createState(): FakeDetail {
      return { resolutions: 0, lastCall: '' };
    },

    calls(_state: PlaybookState<FakeDetail>, side: Side): readonly CallOption[] {
      const wanted = side === _state.possession ? 'offence' : 'defence';
      return FAKE_CALLS.filter((call) => call.side === wanted);
    },

    resolve(state: PlaybookState<FakeDetail>, calls: CallPair, rng: Rng): TurnResolution {
      const bold = calls.offence.call === 'attack';
      const pressed = calls.defence.call === 'press';
      const chance = (bold ? 0.4 : 0.55) + (pressed ? -0.05 : 0.05);
      const made = rng.bool(chance);
      const points = made ? (bold ? 3 : 2) : 0;
      const actor = state.squads[state.possession === 1 ? 1 : 0].players[0]?.id ?? 0;

      return {
        turn: state.turn,
        calls,
        attacking: state.possession,
        outcome: made ? 'made' : 'missed',
        actor,
        points,
        seconds,
        retainsPossession: false,
        events: [
          event(EventKind.SHOT, 0, state.possession, { actor, value: points, detail: { made } }),
        ],
        expectation: {
          successChance: chance,
          expectedPoints: chance * (bold ? 3 : 2),
          because: bold ? 'Went at them.' : 'Took the good one.',
        },
      };
    },

    keyMoment(resolution: TurnResolution): ArcadeInvocation | null {
      if (!proposes) return null;
      return {
        game: 'fake-game',
        actor: resolution.actor ?? 0,
        leverage,
        prompt: 'Take it.',
      };
    },

    narrate(resolution: TurnResolution): NarrationLine {
      return {
        text: resolution.points > 0 ? 'It drops.' : 'Off the rim.',
        tone: resolution.points > 0 ? 'good' : 'bad',
      };
    },

    apply(state: PlaybookState<FakeDetail>, resolution: TurnResolution): void {
      state.detail.resolutions += 1;
      state.detail.lastCall = resolution.calls.offence.call;
    },

    autoCall(state: PlaybookState<FakeDetail>, side: Side, rng: Rng) {
      const options_ = adapter.calls(state, side);
      const chosen = rng.pick(options_) ?? options_[0];
      return { side, call: chosen?.id ?? 'settle' };
    },
  };

  if (options.appliesKeyMoment === true) {
    adapter.applyKeyMoment = (
      _state: PlaybookState<FakeDetail>,
      resolution: TurnResolution,
      outcome: KeyMomentOutcome,
    ): TurnResolution => ({
      ...resolution,
      outcome: outcome.made ? 'made' : 'missed',
      points: outcome.made ? 3 : 0,
      events: [
        event(EventKind.SHOT, 0, resolution.attacking, {
          actor: resolution.actor ?? 0,
          value: outcome.made ? 3 : 0,
          detail: { made: outcome.made, arcade: true },
        }),
      ],
      fromKeyMoment: outcome,
    });
  }

  if (finishAfter !== null) {
    adapter.isFinished = (state: PlaybookState<FakeDetail>): boolean => state.turn >= finishAfter;
  }

  return adapter;
}
