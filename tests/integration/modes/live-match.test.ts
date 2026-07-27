/**
 * @spec    001-initial-dev
 * @phase   2 — Basketball · Live
 * @task    T-2.10 — Match HUD: score, clocks, fouls, live box score, minimap, off-screen indicators
 * @story   US-3.1 — Play a 5v5 basketball match
 * @story   US-2.4 — See the state of the match at a glance
 * @design  04-architecture.md §5, §7
 * @invariant INV-5 (no sport-specific branching outside the sport), INV-8 (determinism)
 *
 * Purpose: a whole match through the mode host — four quarters, a real scoreline, and a box score
 * that agrees with it. The agreement is the assertion that matters: the scoreboard and the box score
 * are built by two different paths from the same events, and a game where they disagree is a game
 * whose summary screen lies.
 */
import { describe, expect, it } from 'vitest';
import { LiveMatch, simulateMatch } from '@/modes/live/match.ts';
import { teamLine } from '@/modes/live/box-score.ts';
import { basketball } from '@/sports/basketball/index.ts';
import { testSport } from '@/sports/testsport/index.ts';
import { EventKind } from '@/engine/match/events.ts';

describe('a match through the mode host', () => {
  it('plays four quarters and finishes', () => {
    const match = simulateMatch({ seed: 'full', sport: basketball });
    const view = match.view();

    expect(view.finished).toBe(true);
    expect(view.phase).toBe('final');
    expect(view.period).toBe(basketball.rules.periods);
    expect(view.periodName).toBe('Quarter');
    expect(view.steps).toBe(basketball.rules.periodSteps * basketball.rules.periods);
  });

  it('scores enough that it reads as basketball', () => {
    const view = simulateMatch({ seed: 'full', sport: basketball }).view();
    const total = view.score[0] + view.score[1];
    expect(total).toBeGreaterThan(40);
    expect(view.score[0]).toBeGreaterThan(5);
    expect(view.score[1]).toBeGreaterThan(5);
  });

  it('agrees with its own box score', () => {
    const match = simulateMatch({ seed: 'agree', sport: basketball });
    const view = match.view();

    expect(teamLine(match.box, 0).points).toBe(view.score[0]);
    expect(teamLine(match.box, 1).points).toBe(view.score[1]);
  });

  it('counts every basket exactly once', () => {
    const match = simulateMatch({ seed: 'once', sport: basketball });
    const scores = match.bus.filter(EventKind.SCORE);
    const fromEvents = scores.reduce((sum, e) => sum + (e.side === 0 ? (e.value ?? 0) : 0), 0);
    expect(fromEvents).toBe(match.view().score[0]);
  });

  it('fills a box score with the whole stat sheet', () => {
    const match = simulateMatch({ seed: 'sheet', sport: basketball });
    const home = teamLine(match.box, 0);

    expect(home.players.length).toBe(5);
    expect(home.fieldGoalsAttempted).toBeGreaterThan(home.fieldGoalsMade);
    expect(home.rebounds).toBeGreaterThan(0);
    expect(home.turnovers).toBeGreaterThan(0);
    expect(home.fouls + teamLine(match.box, 1).fouls).toBeGreaterThan(0);
  });

  it('replays identically from the same seed (INV-8)', () => {
    const a = simulateMatch({ seed: 'golden', sport: basketball }).view();
    const b = simulateMatch({ seed: 'golden', sport: basketball }).view();
    const c = simulateMatch({ seed: 'different', sport: basketball }).view();

    expect(b.score).toEqual(a.score);
    expect(c.score).not.toEqual(a.score);
  });

  it('publishes a status a HUD can draw without knowing the sport (INV-5)', () => {
    const match = new LiveMatch({ seed: 'status', sport: basketball, playerSide: 0 });
    for (let i = 0; i < 600; i++) match.step();

    const status = match.view().status;
    expect(status.actionClock).not.toBeNull();
    expect(status.teamFouls).toHaveLength(2);
    expect(status.bonus).toHaveLength(2);
    expect([0, 1, -1]).toContain(status.possession);
    expect(status.controlled).toBeGreaterThanOrEqual(0);
    expect(status.periodClock).toBeGreaterThan(0);
    expect(status.periodClock).toBeLessThanOrEqual(720);
  });

  it('runs a sport that publishes no status at all', () => {
    // The Phase-1 fixture has no `status()`; the host must still run it and still report a score.
    const match = new LiveMatch({ seed: 'plain', sport: testSport });
    for (let i = 0; i < 500; i++) match.step();

    const view = match.view();
    expect(view.status.actionClock).toBeNull();
    expect(view.status.teamFouls).toBeNull();
    expect(view.periodName).toBe('Half');
  });

  it('takes a short break between periods and can be skipped through it', () => {
    const match = new LiveMatch({ seed: 'break', sport: basketball });
    while (match.view().phase !== 'periodBreak') match.step();

    expect(match.view().period).toBe(1);
    match.skipBreak();
    expect(match.view().period).toBe(2);
    expect(match.view().phase).toBe('live');
    // The new quarter starts with a full clock and clean team fouls.
    expect(match.view().status.periodClock).toBeGreaterThan(700);
    expect(match.view().status.teamFouls).toEqual([0, 0]);
  });
});
