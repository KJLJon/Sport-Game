/**
 * @spec    001-initial-dev
 * @phase   8 — Modes hub, progression, achievements, economy
 * @task    T-8.16 — Economy balance pass: pack EV vs sell value vs earn rate, simulated over
 *          200 matches
 * @story   US-9.3 — Sell athletes for coins
 * @design  05-data-model.md §5, 09-modes-and-arcade.md §7
 *
 * Purpose: prints the economy's numbers. `pnpm balance:economy`.
 *
 * The test asserts the properties; this prints the figures a human needs to *tune* them — what a
 * season of play earns, what it buys, and how far under water every farming cycle is.
 */
import { simulateEconomy, sampledPackValue } from '../src/economy/simulate.ts';
import { PACKS, PACK_ORDER } from '../src/economy/packs.ts';
import { DAILY_COIN_CAP } from '../src/modes/arcade/rewards.ts';
import { basketball } from '../src/sports/basketball/index.ts';
import { createRng } from '../src/engine/rng.ts';
import { DIFFICULTIES, DIFFICULTY_PROFILES } from '../src/modes/difficulty.ts';

const tables = {
  weights: basketball.ratingWeights,
  ...(basketball.positionWeights === undefined
    ? {}
    : { positionWeights: basketball.positionWeights }),
};

const MATCHES = 200;

console.log(`\n── Earning, over ${MATCHES} matches ──`);
for (const difficulty of DIFFICULTIES) {
  const run = simulateEconomy({
    seed: `econ-${difficulty}`,
    matches: MATCHES,
    difficulty,
    winRate: 0.5,
    days: 40,
    tables,
    sport: 'basketball',
  });
  console.log(
    `${difficulty.padEnd(8)} ${run.earned.toString().padStart(7)} coins  ` +
      `(${run.perMatch.toFixed(0)}/match, ×${DIFFICULTY_PROFILES[difficulty].rewardMultiplier})  ` +
      `bronze ${run.packsAfforded.bronze}  gold ${run.packsAfforded.gold}  elite ${run.packsAfforded.elite}`,
  );
}

console.log('\n── Packs: price vs what selling every card returns ──');
const rng = createRng('pack-ev');
for (const tier of PACK_ORDER) {
  const value = sampledPackValue(tier, rng.fork(tier), {
    tables,
    sport: 'basketball',
    samples: 400,
  });
  const ratio = value / PACKS[tier].price;
  console.log(
    `${tier.padEnd(8)} price ${PACKS[tier].price.toString().padStart(6)}  ` +
      `sell-back ${value.toFixed(0).padStart(6)}  (${(ratio * 100).toFixed(0)}% — must be under 100)`,
  );
}

console.log('\n── Farming cycles: every one must be negative ──');
const pro = simulateEconomy({
  seed: 'econ-cycles',
  matches: MATCHES,
  difficulty: 'pro',
  winRate: 0.5,
  days: 40,
  tables,
  sport: 'basketball',
});
for (const tier of PACK_ORDER) {
  console.log(`open-and-sell ${tier.padEnd(8)} ${pro.openAndSellNet[tier].toFixed(0).padStart(8)}`);
}
console.log(
  `arcade, per day, whatever is played  ${DAILY_COIN_CAP.toString().padStart(8)} (capped)`,
);

console.log('\n── Gate 8: zero coins to a meaningfully improved roster ──');
console.log(
  `A season at Pro earns ${pro.earned} coins: ${pro.packsAfforded.gold} Gold packs ` +
    `(${pro.packsAfforded.gold * PACKS.gold.cards} athletes), best pull seen ${pro.bestPull.toFixed(0)} overall.`,
);
console.log('');
