/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.6 — Achievement engine: declarative defs, event-stream evaluation, progress,
 *          once-only grants (INV-7)
 * @story   US-8.1 — Unlock achievements as I play
 * @design  05-data-model.md §6
 * @invariant INV-7 (once only), INV-8 (same events, same unlocks), INV-9 (no mode branch)
 *
 * Purpose: the four things the tracker promises — an unlock fires once, match scope resets and
 * career scope does not, a broken def cannot take a match down, and the same stream always produces
 * the same result.
 *
 * The scope cases are the ones worth having. "Make 5 threes in one game" and "make 5 threes" are one
 * character apart in a def and completely different achievements, and the difference is invisible
 * until somebody unlocks the wrong one in their fifth match.
 */
import { describe, expect, it } from 'vitest';
import { AchievementTracker, progressFraction, progressText } from '@/achievements/tracker.ts';
import { def, onEvent, onMeta } from '@/achievements/conditions.ts';
import { MetaKind, type AchievementDef, type MatchContext } from '@/achievements/types.ts';
import { EventKind, event, type SportEvent } from '@/engine/match/events.ts';
import { NO_ASSISTS } from '@/modes/assists.ts';

const AT = 1_800_000_000_000;

function ctx(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    at: AT,
    sport: 'basketball',
    difficulty: 'pro',
    playerSide: 0,
    assists: NO_ASSISTS,
    athleteOf: () => undefined,
    ...overrides,
  };
}

/** "Make 3 threes in one match", the shape the scope distinction exists for. */
const threesInAMatch: AchievementDef = def({
  id: 'test.threes-in-a-match',
  category: 'basketball',
  title: 'Downtown',
  description: 'Make 3 threes in one match.',
  target: 3,
  scope: 'match',
  reward: { coins: 400 },
  evaluate: onEvent(EventKind.SCORE, (e) => e.value === 3),
});

/** The same condition, counted across every match. */
const threesEver: AchievementDef = def({
  id: 'test.threes-ever',
  category: 'basketball',
  title: 'Range',
  description: 'Make 3 threes.',
  target: 3,
  reward: { coins: 100 },
  evaluate: onEvent(EventKind.SCORE, (e) => e.value === 3),
});

const three = (side: 0 | 1 = 0, step = 1): SportEvent =>
  event(EventKind.SCORE, step, side, { actor: 1, value: 3 });

describe('AchievementTracker', () => {
  it('unlocks when progress reaches the target', () => {
    const tracker = new AchievementTracker([threesInAMatch]);
    tracker.beginMatch();

    expect(tracker.consume(three(), ctx())).toHaveLength(0);
    expect(tracker.consume(three(0, 2), ctx())).toHaveLength(0);
    const unlocked = tracker.consume(three(0, 3), ctx());

    expect(unlocked.map((entry) => entry.def.id)).toEqual(['test.threes-in-a-match']);
    expect(unlocked[0]?.record.unlockedAt).toBe(AT);
    // Unlocked, not yet paid. That distinction is INV-7's whole implementation.
    expect(unlocked[0]?.record.rewardedAt).toBeNull();
  });

  it('unlocks once, and never mentions it again', () => {
    const tracker = new AchievementTracker([threesEver]);
    tracker.beginMatch();
    for (let i = 0; i < 3; i += 1) tracker.consume(three(0, i), ctx());

    // Three more threes, in a second match. Nothing fires.
    tracker.beginMatch();
    const again = [0, 1, 2].flatMap((i) => tracker.consume(three(0, i), ctx()));
    expect(again).toHaveLength(0);
    expect(tracker.record(threesEver.id).unlockedAt).toBe(AT);
  });

  it('resets match scope between matches and keeps career scope', () => {
    const tracker = new AchievementTracker([threesInAMatch, threesEver]);

    tracker.beginMatch();
    tracker.consume(three(), ctx());
    tracker.consume(three(0, 2), ctx());

    tracker.beginMatch();
    const unlocked = [
      ...tracker.consume(three(), ctx()),
      ...tracker.consume(three(0, 2), ctx()),
    ].map((entry) => entry.def.id);

    // Four threes in total, never three in one match: the career one fires, the match one does not.
    expect(unlocked).toEqual(['test.threes-ever']);
    expect(tracker.record(threesInAMatch.id).unlockedAt).toBeNull();
    // …and its stored progress is the best single match, not the running total.
    expect(tracker.record(threesInAMatch.id).progress).toBe(2);
  });

  it('ignores the opponent’s events', () => {
    const tracker = new AchievementTracker([threesInAMatch]);
    tracker.beginMatch();
    for (let i = 0; i < 5; i += 1) tracker.consume(three(1, i), ctx());
    expect(tracker.record(threesInAMatch.id).progress).toBe(0);
  });

  it('counts nothing for a match nobody played', () => {
    const tracker = new AchievementTracker([threesInAMatch]);
    tracker.beginMatch();
    for (let i = 0; i < 5; i += 1) tracker.consume(three(0, i), ctx({ playerSide: -1 }));
    expect(tracker.record(threesInAMatch.id).progress).toBe(0);
  });

  it('keeps a running box score the defs can read', () => {
    const scorer = def({
      id: 'test.twenty',
      category: 'basketball',
      title: 'Twenty',
      description: 'Score 20 in a match with one athlete.',
      scope: 'match',
      reward: { coins: 100 },
      evaluate: (e, context) =>
        (context.box.lines.get(1)?.points ?? 0) >= 20 &&
        !('detail' in e && e.kind.startsWith('meta'))
          ? 1
          : null,
    });

    const tracker = new AchievementTracker([scorer]);
    tracker.beginMatch();
    for (let i = 0; i < 9; i += 1) {
      tracker.consume(event(EventKind.SCORE, i, 0, { actor: 1, value: 2 }), ctx());
    }
    expect(tracker.record(scorer.id).unlockedAt).toBeNull();

    // The twentieth point, on the event that scored it — not on the one after.
    tracker.consume(event(EventKind.SCORE, 10, 0, { actor: 1, value: 2 }), ctx());
    expect(tracker.record(scorer.id).unlockedAt).toBe(AT);
  });

  it('survives a def that throws', () => {
    const broken = def({
      id: 'test.broken',
      category: 'onboarding',
      title: 'Broken',
      description: 'Never.',
      reward: { coins: 1 },
      evaluate: () => {
        throw new Error('bad rule');
      },
    });

    const tracker = new AchievementTracker([broken, threesEver]);
    tracker.beginMatch();
    expect(() => tracker.consume(three(), ctx())).not.toThrow();
    expect(tracker.record(threesEver.id).progress).toBe(1);
  });

  it('is deterministic: the same stream gives the same unlocks (INV-8)', () => {
    const events = [three(), three(0, 2), three(0, 3)];
    const run = (): string[] => {
      const tracker = new AchievementTracker([threesInAMatch, threesEver]);
      tracker.beginMatch();
      return tracker.consumeAll(events, ctx()).map((entry) => entry.def.id);
    };
    expect(run()).toEqual(run());
  });

  it('reports only what changed, so a save is not 75 writes', () => {
    const tracker = new AchievementTracker([threesInAMatch, threesEver]);
    tracker.beginMatch();
    tracker.consume(three(), ctx());
    expect(
      tracker
        .changed()
        .map((record) => record.id)
        .sort(),
    ).toEqual(['test.threes-ever', 'test.threes-in-a-match']);

    const untouched = new AchievementTracker([threesInAMatch]);
    untouched.beginMatch();
    untouched.consume(event(EventKind.FOUL, 1, 0, { actor: 1 }), ctx());
    expect(untouched.changed()).toEqual([]);
  });

  it('does not let a meta event reach a match-shaped def', () => {
    const tracker = new AchievementTracker([threesInAMatch]);
    tracker.beginMatch();
    tracker.consume({ kind: MetaKind.MATCH_FINISHED, at: AT, detail: { result: 'win' } }, ctx());
    expect(tracker.record(threesInAMatch.id).progress).toBe(0);
  });

  it('counts a meta event once per occurrence', () => {
    const played = def({
      id: 'test.ten-matches',
      category: 'onboarding',
      title: 'Regular',
      description: 'Finish 10 matches.',
      target: 10,
      reward: { coins: 500 },
      evaluate: onMeta(MetaKind.MATCH_FINISHED),
    });

    const tracker = new AchievementTracker([played]);
    for (let i = 0; i < 9; i += 1) {
      tracker.beginMatch();
      tracker.consume({ kind: MetaKind.MATCH_FINISHED, at: AT, detail: {} }, ctx());
    }
    expect(tracker.record(played.id).progress).toBe(9);
    expect(tracker.record(played.id).unlockedAt).toBeNull();

    tracker.consume({ kind: MetaKind.MATCH_FINISHED, at: AT, detail: {} }, ctx());
    expect(tracker.record(played.id).unlockedAt).toBe(AT);
  });
});

describe('progress display', () => {
  it('is a fraction of the target, clamped, and 1 once unlocked', () => {
    expect(
      progressFraction(threesEver, { id: 'x', progress: 0, unlockedAt: null, rewardedAt: null }),
    ).toBe(0);
    expect(
      progressFraction(threesEver, { id: 'x', progress: 2, unlockedAt: null, rewardedAt: null }),
    ).toBeCloseTo(2 / 3);
    expect(
      progressFraction(threesEver, { id: 'x', progress: 0, unlockedAt: AT, rewardedAt: null }),
    ).toBe(1);
  });

  it('says nothing for a one-shot, where a bar would add nothing', () => {
    const oneShot = def({
      id: 'test.one',
      category: 'onboarding',
      title: 'One',
      description: 'Once.',
      reward: { coins: 1 },
      evaluate: () => null,
    });
    expect(
      progressText(oneShot, { id: 'x', progress: 0, unlockedAt: null, rewardedAt: null }),
    ).toBe('');
    expect(
      progressText(threesEver, { id: 'x', progress: 2, unlockedAt: null, rewardedAt: null }),
    ).toBe('2 / 3');
  });
});
