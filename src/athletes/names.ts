/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.11 — Procedural athlete generator: rarity-coherent attribute spreads, fictional names
 * @story   US-9.2 — Open packs to earn new athletes
 * @design  05-data-model.md §2 (athlete records), 07-decisions.md (no real-world likenesses)
 * @invariant INV-8 (a name is a pure function of the seed it was drawn from)
 *
 * Purpose: fictional names for generated athletes.
 *
 * **Every name here is invented and none is a person.** `US-9.2` asks for fictional names and the
 * reason is not squeamishness: a game that ships real players' names has shipped somebody's
 * likeness without asking, and a roster that reads like a licensed one invites exactly that
 * comparison. Common given names and common surnames combined at random produce people who plainly
 * do not exist.
 *
 * **The pools were already here, twice.** `starter-roster.ts` had one set private to itself and
 * `teams/cpu-team.ts` had place-and-nickname lists for teams. This is the athlete half, extracted so
 * packs, the starter roster, and CPU squads draw from one place — three name generators would drift
 * into three different-sounding worlds.
 *
 * **Breadth is deliberate.** The pools span a wide range of linguistic origins because a roster that
 * is all one tradition reads as a statement about who plays sport. Combining freely across pools is
 * the point rather than an accident of implementation.
 */
import type { Rng } from '../engine/rng.ts';

export const FIRST_NAMES = [
  'Marcus',
  'David',
  'James',
  'Robert',
  'Michael',
  'Daniel',
  'Christopher',
  'Anthony',
  'Andre',
  'Terrell',
  'Jamal',
  'Darius',
  'Malik',
  'Xavier',
  'Isaiah',
  'Elijah',
  'Diego',
  'Mateo',
  'Santiago',
  'Sebastián',
  'Luca',
  'Matteo',
  'Alessandro',
  'Lorenzo',
  'Kwame',
  'Kofi',
  'Sekou',
  'Amara',
  'Tunde',
  'Chidi',
  'Obi',
  'Femi',
  'Hiroshi',
  'Kenji',
  'Takumi',
  'Haruto',
  'Minjun',
  'Jihoon',
  'Seojun',
  'Doyun',
  'Rasmus',
  'Mikkel',
  'Anders',
  'Jonas',
  'Kasper',
  'Lars',
  'Stig',
  'Nils',
  'Aleksander',
  'Dmitri',
  'Nikola',
  'Luka',
  'Marko',
  'Stefan',
  'Ivan',
  'Milos',
  'Omar',
  'Yusuf',
  'Karim',
  'Tariq',
  'Rami',
  'Zaid',
  'Bilal',
  'Idris',
  'Arjun',
  'Rohan',
  'Kiran',
  'Vikram',
  'Aditya',
  'Nikhil',
  'Ravi',
  'Sanjay',
  'Ana',
  'Sofia',
  'Mia',
  'Nina',
  'Leila',
  'Amina',
  'Yuki',
  'Hana',
  'Zara',
  'Imani',
  'Nadia',
  'Freya',
  'Elena',
  'Camila',
  'Aisha',
  'Noor',
] as const;

export const SURNAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Miller',
  'Davis',
  'Wilson',
  'García',
  'Rodríguez',
  'Martínez',
  'López',
  'Hernández',
  'Torres',
  'Ramírez',
  'Flores',
  'Silva',
  'Santos',
  'Oliveira',
  'Costa',
  'Pereira',
  'Almeida',
  'Barbosa',
  'Cardoso',
  'Rossi',
  'Ferrari',
  'Esposito',
  'Romano',
  'Greco',
  'Marino',
  'Conti',
  'Gallo',
  'Okafor',
  'Adeyemi',
  'Mensah',
  'Diallo',
  'Traoré',
  'Nkemelu',
  'Balogun',
  'Osei',
  'Tanaka',
  'Yamamoto',
  'Nakamura',
  'Kobayashi',
  'Kim',
  'Park',
  'Choi',
  'Jeong',
  'Nguyen',
  'Tran',
  'Pham',
  'Vu',
  'Bui',
  'Duong',
  'Ly',
  'Ngo',
  'Andersen',
  'Nielsen',
  'Larsen',
  'Berg',
  'Lindqvist',
  'Virtanen',
  'Halvorsen',
  'Dahl',
  'Novak',
  'Petrović',
  'Kovač',
  'Horvat',
  'Ivanov',
  'Sokolov',
  'Kuznetsov',
  'Volkov',
  'Haddad',
  'Nasser',
  'Farouk',
  'Aziz',
  'Rahman',
  'Siddiqui',
  'Chaudhry',
  'Bashir',
  'Sharma',
  'Patel',
  'Reddy',
  'Iyer',
  'Chatterjee',
  'Kapoor',
  'Menon',
  'Bose',
  'Whitlock',
  'Ashworth',
  'Fairbanks',
  'Holloway',
  'Sinclair',
  'Beaumont',
  'Kestrel',
  'Vance',
] as const;

/**
 * How many distinct full names the pools can produce.
 *
 * Exported because it is the number that decides whether `uniqueName`'s fallback is reachable in
 * practice, and a test asserts it stays large enough that it is not.
 */
export const NAME_COMBINATIONS = FIRST_NAMES.length * SURNAMES.length;

export function pick<T>(rng: Rng, pool: readonly T[]): T {
  return pool[rng.int(0, pool.length)] as T;
}

/** One fictional name. Deterministic in `rng`, like everything else a pack rolls (INV-8). */
export function rollName(rng: Rng): string {
  return `${pick(rng, FIRST_NAMES)} ${pick(rng, SURNAMES)}`;
}

/**
 * A name not already in `used`, adding it.
 *
 * Collisions are rare — the pools cross to thousands of combinations — but a squad of eleven drawn
 * independently hits one often enough to matter, and two athletes with the same name on one team
 * sheet is the kind of small wrongness that makes a generated roster feel generated.
 *
 * The fallback appends a number rather than looping forever. It is reachable only by a caller that
 * has already drawn most of the pool, and a numbered name is better than a hang.
 */
export function uniqueName(rng: Rng, used: Set<string>, attempts = 24): string {
  for (let index = 0; index < attempts; index++) {
    const name = rollName(rng);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }

  let suffix = 2;
  let name = `${rollName(rng)} ${suffix}`;
  while (used.has(name)) {
    suffix += 1;
    name = `${rollName(rng)} ${suffix}`;
  }
  used.add(name);
  return name;
}
