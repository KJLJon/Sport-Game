/**
 * @spec    001-initial-dev
 * @phase   7 — CPU AI depth & difficulty ladder
 * @task    T-7.5 — Soccer Live AI depth: build-up phases, press lines, offside trap, counter-attacks
 * @story   US-4.3 — Face a CPU that plays soccer
 * @design  06-game-design.md §3.2, §5, §7
 * @invariant INV-1 (difficulty reaches this only as aggression), INV-8 (determinism)
 *
 * Purpose: the two situations soccer lays over the engine's plan, and the shape it hands the engine
 * in the first place. The tests that matter are the ones where the trap must *not* fire — a trap set
 * behind the ball is a gap, and a trap set close to it is a through-ball into an empty net.
 */
import { describe, expect, it } from 'vitest';
import { RoleJob } from '@/engine/ai/roles.ts';
import { TeamIntent, type Assignment } from '@/engine/ai/team.ts';
import { PITCH } from '@/sports/soccer/pitch.ts';
import { DEFAULT_FORMATION, FORMATIONS, formation } from '@/sports/soccer/formations.ts';
import { TACTICS, applyTactics, linesOf, soccerShape, trapLine } from '@/sports/soccer/tactics.ts';

const assignment = (over: Partial<Assignment> & { role: string }): Assignment => ({
  actor: 1,
  job: RoleJob.HOLD_SHAPE,
  intent: TeamIntent.SHAPE,
  target: { x: 20, y: 34 },
  mark: null,
  urgency: 0.5,
  ...over,
});

describe('soccerShape', () => {
  it('sends more, and higher, as aggression rises', () => {
    const passive = soccerShape(DEFAULT_FORMATION, 0.1);
    const relentless = soccerShape(DEFAULT_FORMATION, 1);

    expect(relentless.pressLine).toBeGreaterThan(passive.pressLine);
    expect(relentless.pressCount).toBeGreaterThanOrEqual(passive.pressCount);
  });

  it('keeps a cautious formation cautious at every level (the manager is not the difficulty)', () => {
    const shapes = FORMATIONS.map((shape) => ({
      id: shape.id,
      aggression: shape.aggression,
      line: soccerShape(shape.id, 0.55).pressLine,
    }));
    const keenest = shapes.reduce((a, b) => (a.aggression > b.aggression ? a : b));
    const meekest = shapes.reduce((a, b) => (a.aggression < b.aggression ? a : b));

    if (keenest.aggression > meekest.aggression) {
      expect(keenest.line).toBeGreaterThan(meekest.line);
    }
    // And no level ever pushes a press line past the pitch it is measured on.
    for (const shape of FORMATIONS) {
      expect(soccerShape(shape.id, 1).pressLine).toBeLessThanOrEqual(1);
      expect(soccerShape(shape.id, 0).pressLine).toBeGreaterThanOrEqual(0);
    }
  });

  it('never asks for a press of nobody, or a negative one', () => {
    for (const aggression of [0, 0.35, 0.55, 0.8, 1]) {
      expect(soccerShape(DEFAULT_FORMATION, aggression).pressCount).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('linesOf', () => {
  it('classifies a whole formation, keeper included', () => {
    const lines = linesOf(DEFAULT_FORMATION);
    const roles = formation(DEFAULT_FORMATION).roles;

    expect(lines.size).toBe(roles.length);
    expect(lines.get('gk')).toBe('keeper');
    expect([...lines.values()]).toContain('defence');
    expect([...lines.values()]).toContain('attack');
  });
});

describe('trapLine', () => {
  it('steps the line up in front of the deepest attacker when the ball is far away', () => {
    const line = trapLine({ ballX: 80, deepestAttackerX: 30, side: 0 });

    expect(line).not.toBeNull();
    expect(line as number).toBeGreaterThan(30);
    expect((line as number) - 30).toBeLessThan(4);
  });

  it('does not spring a trap on a ball that is behind the line — that is a gap', () => {
    expect(trapLine({ ballX: 10, deepestAttackerX: 40, side: 0 })).toBeNull();
  });

  it('does not spring one with the ball at the attacker feet', () => {
    // Close enough that stepping up is beaten by a simple pass into the space.
    expect(trapLine({ ballX: 42, deepestAttackerX: 30, side: 0 })).toBeNull();
  });

  it('never pushes a back line past its ceiling', () => {
    const line = trapLine({ ballX: 104, deepestAttackerX: 95, side: 0 });

    if (line !== null) expect(line).toBeLessThanOrEqual(TACTICS.trapCeiling * PITCH.length + 1e-9);
  });

  it('reads the pitch backwards for the other side', () => {
    const line = trapLine({ ballX: 25, deepestAttackerX: 75, side: 1 });

    expect(line).not.toBeNull();
    expect(line as number).toBeLessThan(75);
  });
});

describe('applyTactics', () => {
  const lines = linesOf(DEFAULT_FORMATION);
  const defender = formation(DEFAULT_FORMATION).roles.find(
    (role) => lines.get(role.id) === 'defence',
  );
  const forward = formation(DEFAULT_FORMATION).roles.find(
    (role) => lines.get(role.id) === 'attack',
  );

  it('raises the back line onto the trap and leaves everybody else alone', () => {
    const back = assignment({ role: defender?.id ?? 'lb', target: { x: 18, y: 20 } });
    const front = assignment({ role: forward?.id ?? 'st', target: { x: 60, y: 34 } });

    applyTactics([back, front], { side: 0, lines, trapX: 35, countering: false });

    expect(back.target.x).toBe(35);
    expect(front.target.x).toBe(60);
  });

  it('never drops a defender who is already ahead of the trap', () => {
    const back = assignment({ role: defender?.id ?? 'lb', target: { x: 44, y: 20 } });

    applyTactics([back], { side: 0, lines, trapX: 35, countering: false });

    expect(back.target.x).toBe(44);
  });

  it('pushes the forward line upfield on the break, and only on the break', () => {
    const held = assignment({ role: forward?.id ?? 'st', target: { x: 60, y: 34 } });
    const breaking = assignment({ role: forward?.id ?? 'st', target: { x: 60, y: 34 } });

    applyTactics([held], { side: 0, lines, trapX: null, countering: false });
    applyTactics([breaking], { side: 0, lines, trapX: null, countering: true });

    expect(held.target.x).toBe(60);
    expect(breaking.target.x).toBeGreaterThan(60);
    expect(breaking.target.x).toBeLessThanOrEqual(PITCH.length);
  });

  it('counters the other way for the other side', () => {
    const breaking = assignment({ role: forward?.id ?? 'st', target: { x: 45, y: 34 } });

    applyTactics([breaking], { side: 1, lines, trapX: null, countering: true });

    expect(breaking.target.x).toBeLessThan(45);
  });

  it('leaves the keeper out of both — that is keeper.ts job', () => {
    const keeper = assignment({ role: 'gk', target: { x: 3, y: 34 } });

    applyTactics([keeper], { side: 0, lines, trapX: 35, countering: true });

    expect(keeper.target.x).toBe(3);
  });

  it('ignores a role the formation has never heard of', () => {
    const stranger = assignment({ role: 'sweeper', target: { x: 10, y: 34 } });

    applyTactics([stranger], { side: 0, lines, trapX: 35, countering: true });

    expect(stranger.target.x).toBe(10);
  });
});
