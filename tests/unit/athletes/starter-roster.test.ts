import { describe, it, expect } from 'vitest';
import { RATEABLE_SPORTS } from '../../../src/sports/catalogue.ts';
import { ATHLETE_BOUNDS, RARITIES } from '../../../src/athletes/types.ts';
import {
  generateStarterRoster,
  STARTER_ROSTER_SIZE,
} from '../../../src/athletes/starter-roster.ts';

describe('generateStarterRoster', () => {
  it('generates the correct total roster size', () => {
    const roster = generateStarterRoster();
    expect(roster).toHaveLength(STARTER_ROSTER_SIZE);
    expect(STARTER_ROSTER_SIZE).toBe(38);
  });

  it('generates deterministic rosters from the same seed', () => {
    const roster1 = generateStarterRoster('test-seed-1');
    const roster2 = generateStarterRoster('test-seed-1');

    expect(roster1).toHaveLength(roster2.length);
    for (let i = 0; i < roster1.length; i++) {
      const a1 = roster1[i]!;
      const a2 = roster2[i]!;
      expect(a1.displayName).toBe(a2.displayName);
      expect(a1.heightCm).toBe(a2.heightCm);
      expect(a1.weightKg).toBe(a2.weightKg);
      expect(a1.age).toBe(a2.age);
      expect(a1.rarity).toBe(a2.rarity);
      expect(a1.primarySport).toBe(a2.primarySport);
      expect(a1.id).toBe(a2.id);
      expect(a1.custodyId).toBe(a2.custodyId);
    }
  });

  it('generates different rosters from different seeds', () => {
    const roster1 = generateStarterRoster('seed-1');
    const roster2 = generateStarterRoster('seed-2');

    // Names should differ (with extremely high probability)
    const names1 = new Set(roster1.map((a) => a.displayName));
    const names2 = new Set(roster2.map((a) => a.displayName));
    expect(names1).not.toEqual(names2);
  });

  it('defaults to a consistent roster when no seed is provided', () => {
    const roster1 = generateStarterRoster();
    const roster2 = generateStarterRoster();

    expect(roster1).toHaveLength(roster2.length);
    for (let i = 0; i < roster1.length; i++) {
      expect(roster1[i]!.displayName).toBe(roster2[i]!.displayName);
    }
  });

  it('ensures all athletes have source: "starter"', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      expect(athlete.source).toBe('starter');
    }
  });

  it('ensures all names are unique within the roster', () => {
    const roster = generateStarterRoster();
    const names = roster.map((a) => a.displayName);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(roster.length);
  });

  it('generates enough basketball athletes for two teams', () => {
    const roster = generateStarterRoster();
    const basketballAthletes = roster.filter((a) => a.primarySport === 'basketball');
    // Need 5 × 2 = 10 for two teams, plus may be in spares
    expect(basketballAthletes.length).toBeGreaterThanOrEqual(10);
  });

  it('generates enough soccer athletes for two teams', () => {
    const roster = generateStarterRoster();
    const soccerAthletes = roster.filter((a) => a.primarySport === 'soccer');
    // Need 11 × 2 = 22 for two teams, plus may be in spares
    expect(soccerAthletes.length).toBeGreaterThanOrEqual(22);
  });

  it('has no legendary athletes', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      expect(athlete.rarity).not.toBe('legendary');
    }
  });

  it('has mostly common and uncommon athletes', () => {
    const roster = generateStarterRoster();
    const commonUncommon = roster.filter(
      (a) => a.rarity === 'common' || a.rarity === 'uncommon',
    ).length;
    // Should be at least 75% common+uncommon
    expect(commonUncommon / roster.length).toBeGreaterThan(0.75);
  });

  it('has few epic athletes (at most 2)', () => {
    const roster = generateStarterRoster();
    const epics = roster.filter((a) => a.rarity === 'epic');
    expect(epics.length).toBeLessThanOrEqual(2);
  });

  it('distributes rarities across the roster', () => {
    const roster = generateStarterRoster();
    const rarityCount: Record<string, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };

    for (const athlete of roster) {
      (rarityCount[athlete.rarity] as number)++;
    }

    // Verify we have a reasonable distribution
    expect((rarityCount['common'] as number) ?? 0).toBeGreaterThan(0);
    expect((rarityCount['uncommon'] as number) ?? 0).toBeGreaterThan(0);
    expect((rarityCount['rare'] as number) ?? 0).toBeGreaterThanOrEqual(0);
    expect((rarityCount['legendary'] as number) ?? 0).toBe(0);
  });

  it('generates all athletes within height bounds', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      expect(athlete.heightCm).toBeGreaterThanOrEqual(ATHLETE_BOUNDS.heightCm.min);
      expect(athlete.heightCm).toBeLessThanOrEqual(ATHLETE_BOUNDS.heightCm.max);
    }
  });

  it('generates all athletes within weight bounds', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      expect(athlete.weightKg).toBeGreaterThanOrEqual(ATHLETE_BOUNDS.weightKg.min);
      expect(athlete.weightKg).toBeLessThanOrEqual(ATHLETE_BOUNDS.weightKg.max);
    }
  });

  it('generates all athletes within age bounds', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      expect(athlete.age).toBeGreaterThanOrEqual(ATHLETE_BOUNDS.age.min);
      expect(athlete.age).toBeLessThanOrEqual(ATHLETE_BOUNDS.age.max);
    }
  });

  it('generates all athletes within attribute bounds', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      for (const value of Object.values(athlete.attributes)) {
        expect(value).toBeGreaterThanOrEqual(ATHLETE_BOUNDS.attribute.min);
        expect(value).toBeLessThanOrEqual(ATHLETE_BOUNDS.attribute.max);
      }
    }
  });

  it('ensures all athletes have all eleven attributes', () => {
    const roster = generateStarterRoster();
    const expectedAttributes = [
      'speed',
      'acceleration',
      'agility',
      'strength',
      'vertical',
      'stamina',
      'coordination',
      'accuracy',
      'awareness',
      'composure',
      'discipline',
    ];

    for (const athlete of roster) {
      for (const attr of expectedAttributes) {
        expect(athlete.attributes).toHaveProperty(attr);
        expect(typeof athlete.attributes[attr as never]).toBe('number');
      }
    }
  });

  it('generates athletes with valid primary sports', () => {
    const roster = generateStarterRoster();
    const validSports = new Set(RATEABLE_SPORTS.map((s) => s.id));

    for (const athlete of roster) {
      expect(validSports.has(athlete.primarySport)).toBe(true);
    }
  });

  it('ensures basketball athletes are taller on average', () => {
    const roster = generateStarterRoster();
    const basketballHeights = roster
      .filter((a) => a.primarySport === 'basketball')
      .map((a) => a.heightCm);
    const soccerHeights = roster.filter((a) => a.primarySport === 'soccer').map((a) => a.heightCm);

    const avgBasketball = basketballHeights.reduce((a, b) => a + b, 0) / basketballHeights.length;
    const avgSoccer = soccerHeights.reduce((a, b) => a + b, 0) / soccerHeights.length;

    // Basketball players should generally be taller
    expect(avgBasketball).toBeGreaterThan(avgSoccer);
  });

  it('ensures each athlete has a unique ID', () => {
    const roster = generateStarterRoster();
    const ids = roster.map((a) => a.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(roster.length);
  });

  it('ensures each athlete has valid sportSkills', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      expect(athlete.sportSkills).toHaveProperty(athlete.primarySport);
      const skill = athlete.sportSkills[athlete.primarySport]!;
      expect(skill.familiarity).toBe(85); // Primary sport starts at 85
      expect(skill.level).toBe(1);
      expect(skill.minutesPlayed).toBe(0);
    }
  });

  it('ensures all athletes are editable', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      expect(athlete.editable).toBe(true);
    }
  });

  it('ensures no athlete is in sandbox mode', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      expect(athlete.sandbox).toBe(false);
    }
  });

  it('ensures athletes have max stamina at creation', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      expect(athlete.condition.stamina).toBe(ATHLETE_BOUNDS.stamina.max);
    }
  });

  it('ensures no athlete is injured or suspended at creation', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      expect(athlete.condition.injuredUntil).toBeUndefined();
      expect(athlete.condition.suspendedGames).toBeUndefined();
    }
  });

  it('generates basketball centres taller than point guards on average', () => {
    const roster = generateStarterRoster();
    const basketballAthletes = roster.filter((a) => a.primarySport === 'basketball');

    // Split into two teams
    const team1 = basketballAthletes.slice(0, 5);
    const team2 = basketballAthletes.slice(5, 10);

    // Point guards are at index 0 (PG), centres at index 4 (C)
    if (team1.length === 5) {
      const pg1 = team1[0]!.heightCm;
      const c1 = team1[4]!.heightCm;
      expect(c1).toBeGreaterThanOrEqual(pg1);
    }

    if (team2.length === 5) {
      const pg2 = team2[0]!.heightCm;
      const c2 = team2[4]!.heightCm;
      expect(c2).toBeGreaterThanOrEqual(pg2);
    }
  });

  it('generates soccer goalkeepers taller than average', () => {
    const roster = generateStarterRoster();
    const soccerAthletes = roster.filter((a) => a.primarySport === 'soccer');

    // Split into two teams
    const team1 = soccerAthletes.slice(0, 11);
    const team2 = soccerAthletes.slice(11, 22);

    // Goalkeepers are at index 0 (GK)
    if (team1.length === 11) {
      const gk1 = team1[0]!.heightCm;
      const avgTeam1 = team1.reduce((sum, a) => sum + a.heightCm, 0) / team1.length;
      expect(gk1).toBeGreaterThanOrEqual(avgTeam1);
    }

    if (team2.length === 11) {
      const gk2 = team2[0]!.heightCm;
      const avgTeam2 = team2.reduce((sum, a) => sum + a.heightCm, 0) / team2.length;
      expect(gk2).toBeGreaterThanOrEqual(avgTeam2);
    }
  });

  it('is deterministic across multiple calls with the same seed', () => {
    const seed = 'determinism-test';
    const rosters = [
      generateStarterRoster(seed),
      generateStarterRoster(seed),
      generateStarterRoster(seed),
    ];

    // All rosters should be identical
    for (let i = 1; i < rosters.length; i++) {
      expect(rosters[i]).toEqual(rosters[0]);
    }
  });

  it('has all athletes pass through rollAthlete bounds checking', () => {
    const roster = generateStarterRoster();
    for (const athlete of roster) {
      // Verify all athletes respect the bounds that rollAthlete enforces
      expect(athlete.heightCm).toBeGreaterThanOrEqual(ATHLETE_BOUNDS.heightCm.min);
      expect(athlete.weightKg).toBeGreaterThanOrEqual(ATHLETE_BOUNDS.weightKg.min);
      expect(athlete.age).toBeGreaterThanOrEqual(ATHLETE_BOUNDS.age.min);

      // Verify rarity is valid
      expect(RARITIES).toContain(athlete.rarity);

      // Verify traits count does not exceed bounds
      expect(athlete.traits.length).toBeLessThanOrEqual(ATHLETE_BOUNDS.maxTraits);
    }
  });

  it('generates athletes with realistic rarity distribution over multiple seeds', () => {
    const totalRarities: Record<string, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
    };

    // Test multiple seeds to verify the distribution is reasonable
    for (let i = 0; i < 5; i++) {
      const roster = generateStarterRoster(`distribution-test-${i}`);
      for (const athlete of roster) {
        (totalRarities[athlete.rarity] as number)++;
      }
    }

    const totalAthletes = 5 * STARTER_ROSTER_SIZE;

    // Over 5 rosters worth of data, verify distribution trends
    expect(((totalRarities['common'] as number) ?? 0) / totalAthletes).toBeGreaterThan(0.4); // At least 40% common
    expect(((totalRarities['uncommon'] as number) ?? 0) / totalAthletes).toBeGreaterThan(0.1); // At least 10% uncommon
    expect(((totalRarities['rare'] as number) ?? 0) / totalAthletes).toBeGreaterThan(0.01); // At least 1% rare
    expect((totalRarities['legendary'] as number) ?? 0).toBe(0); // Zero legendary across all
  });

  it('generates athletes with all valid rarity values', () => {
    const roster = generateStarterRoster();
    const rarities = new Set(roster.map((a) => a.rarity));
    for (const rarity of rarities) {
      expect(RARITIES).toContain(rarity);
    }
  });
});
