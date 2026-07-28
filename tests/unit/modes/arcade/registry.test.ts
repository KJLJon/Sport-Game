/**
 * T-4.1 — the arcade catalogue is assembled from sports, and knows nothing about any of them.
 */
import { describe, expect, it } from 'vitest';
import {
  arcadeCatalogue,
  catalogueFrom,
  duplicateIds,
  findGame,
  gamesForSport,
} from '../../../../src/modes/arcade/registry.ts';
import { SportRegistry, type SportModule } from '../../../../src/sports/types.ts';
import { testSport } from '../../../../src/sports/testsport/index.ts';
import { fakeGame } from '../../../helpers/arcade.ts';

function sportWith(id: string, games: SportModule['arcade']): SportModule {
  return { ...testSport, id, arcade: games } as SportModule;
}

describe('arcadeCatalogue', () => {
  it('collects every sport’s games, in sport order', () => {
    const a = fakeGame({ id: 'a.one' });
    const b = fakeGame({ id: 'b.one' });
    const games = arcadeCatalogue([sportWith('alpha', [a]), sportWith('beta', [b])]);
    expect(games.map((game) => game.id)).toEqual(['a.one', 'b.one']);
  });

  it('a sport with no arcade set contributes nothing rather than failing', () => {
    expect(arcadeCatalogue([testSport])).toEqual([]);
  });

  it('reads a registry in stable id order', () => {
    const registry = new SportRegistry();
    registry.register(sportWith('zeta', [fakeGame({ id: 'z.one' })]));
    registry.register(sportWith('alpha', [fakeGame({ id: 'a.one' })]));
    expect(catalogueFrom(registry).map((game) => game.id)).toEqual(['a.one', 'z.one']);
  });
});

describe('lookups', () => {
  const games = [
    { ...fakeGame({ id: 'bball.free-throw' }), sport: 'basketball' },
    { ...fakeGame({ id: 'bball.three-point' }), sport: 'basketball' },
    { ...fakeGame({ id: 'soccer.penalty' }), sport: 'soccer' },
  ];

  it('finds a game by id', () => {
    expect(findGame(games, 'bball.three-point')?.name).toBe('Test Game');
    expect(findGame(games, 'nope')).toBeUndefined();
  });

  it('filters by sport', () => {
    expect(gamesForSport(games, 'basketball')).toHaveLength(2);
    expect(gamesForSport(games, 'hockey')).toHaveLength(0);
  });
});

describe('duplicateIds', () => {
  it('reports collisions, which would silently merge two games’ personal bests', () => {
    expect(
      duplicateIds([fakeGame({ id: 'x' }), fakeGame({ id: 'x' }), fakeGame({ id: 'y' })]),
    ).toEqual(['x']);
    expect(duplicateIds([fakeGame({ id: 'x' }), fakeGame({ id: 'y' })])).toEqual([]);
  });
});
