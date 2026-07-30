import { expect, test } from 'vitest';
import { DEFAULT_HERO } from '../src/data/heroes';
import { addCard, startRun, upgradeCard, type DeckCard } from '../src/state/run';
import { POLICIES, type PolicyName } from './policy';
import { simulateCombat, type SimResult } from './runCombat';

/**
 * Balance simulation. Opt-in — `npm run sim`, not `npm test`.
 *
 * The point is to replace intuition with numbers when tuning. n defaults to 500
 * because at the 150 the README's original table was built on, a 41% win rate
 * carries a ±8% confidence interval — wide enough to hide a 5% balance change.
 */

/** Raise this when a change looks marginal — the run is ~1s per 4500 fights. */
const N = 500;
const POLICY_NAMES: PolicyName[] = ['random', 'greedy', 'threat'];

/** Trash rotates the four monster tables so no single table dominates the tier. */
const TIERS: { tier: string; encounters: string[] }[] = [
  { tier: 'trash', encounters: ['m1', 'm2', 'm3', 'm4'] },
  { tier: 'elite 华雄', encounters: ['e1'] },
  { tier: 'boss 吕布', encounters: ['b1'] },
];

/**
 * Which deck the fight is fought with. This turned out to matter more than the
 * policy: 吕布 sits on floor 15 and is close to unloseable-for-him against the
 * bare 10-card starting deck, so quoting one number per tier without saying
 * which deck it assumes is meaningless.
 */
const DECKS: { profile: string; build: (seed: string) => DeckCard[] }[] = [
  { profile: 'starting', build: (seed) => startRun(DEFAULT_HERO, seed).deck },
  { profile: 'act-1', build: act1Deck },
];

/** A plausible floor-15 deck: the 10 starters, one card per reward, three forged. */
function act1Deck(seed: string): DeckCard[] {
  const run = startRun(DEFAULT_HERO, seed);
  for (const id of ['wenjiu', 'wanren', 'quedi', 'jieying', 'yiyong', 'xuzhao']) addCard(run, id);
  for (const defId of ['pikan', 'tuodao', 'tiebi']) {
    upgradeCard(run, run.deck.find((c) => c.defId === defId)!.uid);
  }
  return run.deck;
}

export interface TierStats {
  tier: string;
  profile: string;
  policy: string;
  n: number;
  winRate: number;
  avgTurns: number;
  avgHpLeft: number;
  /** Averaged over wins only — the README's "hp left" numbers read like this. */
  avgHpLeftOnWin: number;
  /** p10 … p90 of HP left. A mean of 17 hides whether it is flat or bimodal. */
  hpPercentiles: number[];
  aborted: number;
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

/** Nearest-rank percentile over an already-sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function runTier(
  tier: string,
  encounters: string[],
  deck: (typeof DECKS)[number],
  policy: PolicyName,
  n: number,
): TierStats {
  const results: SimResult[] = [];
  for (let i = 0; i < n; i++) {
    const seed = `${tier}-${deck.profile}-${policy}-${i}`;
    results.push(
      simulateCombat({
        encounterId: encounters[i % encounters.length],
        deck: deck.build(seed),
        hero: DEFAULT_HERO,
        hp: DEFAULT_HERO.maxHp,
        maxHp: DEFAULT_HERO.maxHp,
        seed,
        policy: POLICIES[policy],
      }),
    );
  }

  const wins = results.filter((r) => r.won);
  const hp = results.map((r) => r.hpLeft).sort((a, b) => a - b);

  return {
    tier,
    profile: deck.profile,
    policy,
    n,
    winRate: wins.length / n,
    avgTurns: mean(results.map((r) => r.turns)),
    avgHpLeft: mean(results.map((r) => r.hpLeft)),
    avgHpLeftOnWin: mean(wins.map((r) => r.hpLeft)),
    hpPercentiles: [10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) => percentile(hp, p)),
    aborted: results.filter((r) => r.aborted !== null).length,
  };
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

/** README-shaped: tiers down the side, policies across the top. */
function summaryTable(rows: TierStats[], profile: string): string {
  const out = [
    `| | ${POLICY_NAMES.map((p) => `${p} AI`).join(' | ')} |`,
    `|---|${POLICY_NAMES.map(() => '---').join('|')}|`,
  ];
  for (const { tier } of TIERS) {
    const cells = POLICY_NAMES.map((policy) => {
      const r = rows.find((x) => x.tier === tier && x.profile === profile && x.policy === policy)!;
      return `${pct(r.winRate)} win · ${r.avgTurns.toFixed(1)} turns · ${r.avgHpLeftOnWin.toFixed(0)} hp left`;
    });
    out.push(`| ${tier} | ${cells.join(' | ')} |`);
  }
  return out.join('\n');
}

/** Wide table, with the HP long tail spelled out. */
function detailTable(rows: TierStats[]): string {
  const out = [
    '| tier | deck | policy | n | win rate | avg turns | avg hp left | avg hp left (wins) | hp deciles p10…p90 | aborted |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    out.push(
      `| ${r.tier} | ${r.profile} | ${r.policy} | ${r.n} | ${pct(r.winRate)} | ` +
        `${r.avgTurns.toFixed(1)} | ${r.avgHpLeft.toFixed(1)} | ${r.avgHpLeftOnWin.toFixed(1)} | ` +
        `${r.hpPercentiles.join(' · ')} | ${r.aborted} |`,
    );
  }
  return out.join('\n');
}

test(`balance: ${N} fights per tier per deck per policy`, () => {
  const rows: TierStats[] = [];
  for (const { tier, encounters } of TIERS) {
    for (const deck of DECKS) {
      for (const policy of POLICY_NAMES) rows.push(runTier(tier, encounters, deck, policy, N));
    }
  }

  console.log(`\n### Balance — ${N} fights per cell, 关羽 at full HP\n`);
  for (const { profile } of DECKS) {
    console.log(`**${profile} deck**\n`);
    console.log(summaryTable(rows, profile) + '\n');
  }
  console.log(detailTable(rows));
  console.log('\nhp deciles are HP remaining over all fights, losses (0) included.\n');

  // A bail-out here means a bug in the engine or a policy, not a balance result.
  for (const r of rows) expect(r.aborted, `${r.tier}/${r.profile}/${r.policy}`).toBe(0);
});
