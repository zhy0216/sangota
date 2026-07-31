import { expect, test } from 'vitest';
import { COLORLESS_POOL } from '../src/combat/cards';
import { rollCardReward } from '../src/combat/rewards';
import { Rng } from '../src/core/rng';
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

/**
 * Every fight in the game, one row per thing a balance decision is made about.
 *
 * The two trash rows are the act's own split (`ACT1.weak` / `ACT1.strong`),
 * because that is the split the map draws against — averaging all eight into
 * one "trash" number hides whichever half is wrong. Elites and bosses get one
 * row each: they are 1-2 fights per act, so a tier average is not a number
 * anyone can act on.
 *
 * `m9`-`m11`, `e3` and `b3` are in `PENDING_ENCOUNTERS` and the map cannot open
 * them yet, but they are finished as *rules* and their numbers are what todos/
 * 09 and 16 will ship. Leaving them out is how eleven fights were added to the
 * game without a single one being simulated.
 */
const TIERS: { tier: string; encounters: string[] }[] = [
  { tier: 'trash 弱', encounters: ['m1', 'm3', 'm5'] },
  { tier: 'trash 强', encounters: ['m2', 'm4', 'm6', 'm7', 'm8'] },
  { tier: 'trash 未启用', encounters: ['m9', 'm10', 'm11'] },
  { tier: 'elite 华雄', encounters: ['e1'] },
  { tier: 'elite 管亥', encounters: ['e2'] },
  { tier: 'elite 张曼成', encounters: ['e3'] },
  { tier: 'boss 吕布', encounters: ['b1'] },
  { tier: 'boss 张梁', encounters: ['b2'] },
  { tier: 'boss 张宝', encounters: ['b3'] },
];

/**
 * The bands todos/15 signs the content up to. Printed beside each row rather
 * than asserted: a balance number outside its band is a tuning decision, and
 * tuning 张梁 down would rewrite a golden snapshot (约定 3). The table is what
 * makes the decision visible; the assertion at the bottom is only for crashes.
 */
const BANDS: { tier: string; lo: number; hi: number }[] = [
  { tier: 'trash', lo: 0.95, hi: 1 },
  { tier: 'elite', lo: 0.85, hi: 0.95 },
  { tier: 'boss', lo: 0.45, hi: 0.7 },
];

const bandFor = (tier: string): { lo: number; hi: number } | undefined =>
  BANDS.find((b) => tier.startsWith(b.tier));

/**
 * Which deck the fight is fought with. This turned out to matter more than the
 * policy: 吕布 sits on floor 15 and is close to unloseable-for-him against the
 * bare 10-card starting deck, so quoting one number per tier without saying
 * which deck it assumes is meaningless.
 */
interface DeckProfile {
  profile: string;
  build: (seed: string) => DeckCard[];
  /** Defaults to the hero's starter relic alone — i.e. what a real run carries. */
  relics?: string[];
}

/**
 * The two relics whose whole point is that they reshape the damage pipeline,
 * on top of the starter: 藤甲 lays block from a `'relic'` source and 虎符 taxes
 * block through 力竭. `relics.ts` states in a comment that 虎符 deliberately
 * does *not* scale 藤甲's armour, and until now nothing had ever put the two in
 * one fight — every profile carried the starter and nothing else.
 */
const KIT_RELICS = [DEFAULT_HERO.starterRelic, 'tengjia', 'hufu'];

const DECKS: DeckProfile[] = [
  { profile: 'starting', build: (seed) => startRun(DEFAULT_HERO, seed).deck },
  { profile: 'act-1', build: act1Deck },
  { profile: 'act-1 rolled', build: act1RolledDeck },
  { profile: 'act-1 kitted', build: act1KittedDeck, relics: KIT_RELICS },
];

/**
 * `act-1 rolled` plus the 无色 cards, which only 坊市 sells and which therefore
 * appear in no other profile. 青囊书 / 鹿角 / 离间计 / 毒矢 / 八阵图 are five of
 * the strongest effects in the pool and had never been swung in a simulated
 * fight — three of the statuses they drive (反刺 / 中毒 / 重甲) had no coverage
 * at all outside their own unit tests.
 */
function act1KittedDeck(seed: string): DeckCard[] {
  const run = startRun(DEFAULT_HERO, seed);
  const rng = new Rng(`${seed}:kit`);
  for (let i = 0; i < 4; i++) {
    const picks = rollCardReward({ tier: 'monster', run, rng });
    if (picks.length > 0) addCard(run, rng.pick(picks));
  }
  for (const id of COLORLESS_POOL) addCard(run, id);
  for (const defId of ['pikan', 'tuodao', 'tiebi']) {
    upgradeCard(run, run.deck.find((c) => c.defId === defId)!.uid);
  }
  return run.deck;
}

/**
 * A plausible floor-15 deck: the 10 starters, one card per reward, three forged.
 *
 * The card list is hard-coded and predates todos/11 on purpose — it is the
 * control. Holding it fixed is what lets the table below prove that a change in
 * the numbers came from the rules and not from the deck being rebuilt.
 */
function act1Deck(seed: string): DeckCard[] {
  const run = startRun(DEFAULT_HERO, seed);
  for (const id of ['wenjiu', 'wanren', 'quedi', 'jieying', 'yiyong', 'xuzhao']) addCard(run, id);
  for (const defId of ['pikan', 'tuodao', 'tiebi']) {
    upgradeCard(run, run.deck.find((c) => c.defId === defId)!.uid);
  }
  return run.deck;
}

/**
 * The same shape, drafted out of the real reward system instead: six rewards
 * (the last one an elite's), one card taken from each. This is the profile that
 * actually measures todos/11 — the control above can never draw a card the pool
 * expansion added.
 *
 * The pick is uniform among the three on offer rather than "best", which
 * deliberately under-states a real player. A greedy picker would measure the
 * ceiling of the new pool; this measures its average, and the average is what a
 * win-rate band is about.
 */
function act1RolledDeck(seed: string): DeckCard[] {
  const run = startRun(DEFAULT_HERO, seed);
  const rng = new Rng(`${seed}:rewards`);
  for (let i = 0; i < 6; i++) {
    const picks = rollCardReward({ tier: i === 5 ? 'elite' : 'monster', run, rng });
    if (picks.length > 0) addCard(run, rng.pick(picks));
  }
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
  deck: DeckProfile,
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
        relics: deck.relics,
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
  console.log(bandTable(rows) + '\n');

  // A bail-out here means a bug in the engine or a policy, not a balance result.
  for (const r of rows) expect(r.aborted, `${r.tier}/${r.profile}/${r.policy}`).toBe(0);
});

/**
 * Every row that sits outside the band todos/15 signed it up to, measured on
 * the two decks a floor-15 player plausibly holds.
 *
 * Printed, not asserted. A number outside its band is a *tuning* decision and
 * tuning any of these means moving a fight's damage numbers, which rewrites the
 * golden snapshot that fight is frozen in (约定 3). The point of this table is
 * that the decision is now visible at all — 张梁 shipped at 84% against a 45-70%
 * boss band and the harness this file used to be could not see the fight.
 */
function bandTable(rows: TierStats[]): string {
  // The calibrated profiles only. `act-1 kitted` exists for *coverage* — it
  // deliberately over-equips so that 无色 cards and the relic hooks are swung
  // in a real fight — so it is not a number to tune against.
  const MEASURED = new Set(['act-1', 'act-1 rolled']);
  const out = ['**Outside band** (act-1 decks, greedy/threat AI)\n', '| tier | deck | policy | win rate | band |', '|---|---|---|---|---|'];
  let any = false;
  for (const r of rows) {
    const band = bandFor(r.tier);
    if (!band || !MEASURED.has(r.profile) || r.policy === 'random') continue;
    if (r.winRate >= band.lo && r.winRate <= band.hi) continue;
    any = true;
    out.push(`| ${r.tier} | ${r.profile} | ${r.policy} | ${pct(r.winRate)} | ${pct(band.lo)}–${pct(band.hi)} |`);
  }
  return any ? out.join('\n') : '**Outside band**: none.';
}
