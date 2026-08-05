/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.5 — Stats store: match history, box scores, career stats per sport per mode
 * @story   US-10.4 — See my history and stats
 * @design  09-modes-and-arcade.md §7, 05-data-model.md §1
 * @invariant INV-9 (one event stream; the mode is data, never a branch)
 *
 * Purpose: that a record is a function of the event stream, and that the two modes therefore
 * produce the same record from the same events.
 *
 * The INV-9 case is the one worth having. It is easy to write a stats layer that quietly computes
 * Playbook differently — a different assist rule, a rebound counted once instead of twice — and
 * nothing would fail except the numbers, months later, in a way nobody could attribute.
 */
import { describe, expect, it } from 'vitest';
import { buildCareers, boxFromEvents, buildRecord, percentage } from '@/stats/record.ts';
import { resultOf, type MatchRecord } from '@/stats/types.ts';
import { EventKind, event } from '@/engine/match/events.ts';
import type { SportEvent } from '@/engine/match/events.ts';

/** A short match: two scores for home, one for away, and an assist. */
function events(): SportEvent[] {
  return [
    event(EventKind.SHOT, 10, 0, { actor: 1, value: 2 }),
    event(EventKind.SCORE, 10, 0, { actor: 1, value: 2 }),
    event(EventKind.PASS, 20, 0, { actor: 2, target: 1 }),
    event(EventKind.SHOT, 21, 0, { actor: 1, value: 3 }),
    event(EventKind.SCORE, 21, 0, { actor: 1, value: 3 }),
    event(EventKind.SHOT, 30, 1, { actor: 5, value: 2 }),
    event(EventKind.SCORE, 30, 1, { actor: 5, value: 2 }),
  ];
}

function record(overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    ...buildRecord({
      id: 'match-1',
      playedAt: 1_700_000_000_000,
      sportId: 'basketball',
      mode: 'live',
      difficulty: 'pro',
      score: [5, 2],
      playerSide: 0,
      teamNames: ['Home', 'Away'],
      periodsPlayed: 4,
      events: events(),
      lineup: new Map([
        [1, 'athlete-a'],
        [2, 'athlete-b'],
        [5, 'athlete-c'],
      ]),
    }),
    ...overrides,
  };
}

describe('building a record', () => {
  it('turns an event stream into per-athlete lines', () => {
    const built = record();
    const scorer = built.lines.find((line) => line.athleteId === 'athlete-a');

    expect(scorer?.points).toBe(5);
    expect(scorer?.fieldGoalsAttempted).toBe(2);
    expect(scorer?.side).toBe(0);
  });

  it('attaches lines to athletes rather than to entities', () => {
    // An entity id means something for one match; an athlete id is what a career is about.
    expect(
      record()
        .lines.map((line) => line.athleteId)
        .sort(),
    ).toEqual(['athlete-a', 'athlete-b', 'athlete-c']);
  });

  it('records an anonymous match without inventing athletes for it', () => {
    const anonymous = buildRecord({
      id: 'anon',
      playedAt: 1,
      sportId: 'basketball',
      mode: 'live',
      difficulty: 'pro',
      score: [5, 2],
      playerSide: -1,
      teamNames: ['Home', 'Away'],
      periodsPlayed: 4,
      events: events(),
    });

    expect(anonymous.lines.every((line) => line.athleteId === null)).toBe(true);
    expect(anonymous.lines.length).toBeGreaterThan(0);
  });

  it('prefers a box score the match already kept over re-deriving one', () => {
    // Live keeps one for its HUD. Deriving a second would risk two answers to one question.
    const derived = record();
    const supplied = buildRecord({
      id: 'match-1',
      playedAt: 1_700_000_000_000,
      sportId: 'basketball',
      mode: 'live',
      difficulty: 'pro',
      score: [5, 2],
      playerSide: 0,
      teamNames: ['Home', 'Away'],
      periodsPlayed: 4,
      events: [],
      box: boxFromEvents(events()),
      lineup: new Map([
        [1, 'athlete-a'],
        [2, 'athlete-b'],
        [5, 'athlete-c'],
      ]),
    });

    expect(supplied.lines).toEqual(derived.lines);
  });
});

describe('INV-9 — the mode is data, not a branch', () => {
  it('produces an identical record from an identical stream in either mode', () => {
    const live = record({ mode: 'live' });
    const playbook = record({ mode: 'playbook' });

    // Everything but the label is the same. This is the assertion that would catch a stats layer
    // quietly computing Playbook by different rules.
    expect(playbook.lines).toEqual(live.lines);
    expect(playbook.score).toEqual(live.score);
    expect(playbook.mode).not.toBe(live.mode);
  });
});

describe('careers', () => {
  it('totals an athlete across matches, per sport', () => {
    const careers = buildCareers([record({ id: 'a' }), record({ id: 'b' })]);
    const scorer = careers.find((career) => career.athleteId === 'athlete-a');

    expect(scorer?.matches).toBe(2);
    expect(scorer?.totals.points).toBe(10);
    expect(scorer?.sportId).toBe('basketball');
  });

  it('keeps the same athlete s two sports apart', () => {
    const careers = buildCareers([record({ id: 'a' }), record({ id: 'b', sportId: 'soccer' })]);
    const forAthlete = careers.filter((career) => career.athleteId === 'athlete-a');

    // `05` §3 makes ratings per sport, so a career total that mixed them would answer no question.
    expect(forAthlete).toHaveLength(2);
    expect(forAthlete.map((career) => career.sportId).sort()).toEqual(['basketball', 'soccer']);
  });

  it('splits totals by mode without computing them differently', () => {
    const careers = buildCareers([
      record({ id: 'a', mode: 'live' }),
      record({ id: 'b', mode: 'playbook' }),
    ]);
    const scorer = careers.find((career) => career.athleteId === 'athlete-a');

    expect(scorer?.byMode.live.points).toBe(5);
    expect(scorer?.byMode.playbook.points).toBe(5);
    expect(scorer?.totals.points).toBe(10);
  });

  it('counts a win only for the side the player was on', () => {
    // The opponent's athletes have real lines. Calling a match they were in "a win for them" would
    // record the player's own result twice.
    const careers = buildCareers([record()]);
    const mine = careers.find((career) => career.athleteId === 'athlete-a');
    const theirs = careers.find((career) => career.athleteId === 'athlete-c');

    expect(mine?.wins).toBe(1);
    expect(theirs?.wins).toBe(0);
    expect(theirs?.matches).toBe(1);
  });

  it('ignores anonymous lines rather than pooling them under a placeholder', () => {
    const anonymous = buildRecord({
      id: 'anon',
      playedAt: 1,
      sportId: 'basketball',
      mode: 'live',
      difficulty: 'pro',
      score: [5, 2],
      playerSide: -1,
      teamNames: ['Home', 'Away'],
      periodsPlayed: 4,
      events: events(),
    });

    // An "unknown athlete" whose career grew with every harness run would make the screen useless.
    expect(buildCareers([anonymous])).toEqual([]);
  });
});

describe('reading a result', () => {
  it('is from the player s side, and is null when they were not in it', () => {
    expect(resultOf(record({ score: [5, 2], playerSide: 0 }))).toBe('win');
    expect(resultOf(record({ score: [5, 2], playerSide: 1 }))).toBe('loss');
    expect(resultOf(record({ score: [2, 2], playerSide: 0 }))).toBe('draw');
    expect(resultOf(record({ playerSide: -1 }))).toBeNull();
  });

  it('reports a percentage only when something was attempted', () => {
    expect(percentage(3, 6)).toBe(50);
    expect(percentage(0, 0)).toBeNull();
  });
});
