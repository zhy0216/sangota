import { expect, test } from 'vitest';
import { COLORLESS_POOL } from '../src/combat/cards';
import { ACT_TABLES } from '../src/combat/enemies';
import { rollCardReward, rollRelicOfTier } from '../src/combat/rewards';
import { Rng } from '../src/core/rng';
import { DEFAULT_HERO } from '../src/data/heroes';
import { addCard, MIN_DECK_SIZE, startRun, upgradeCard, type DeckCard } from '../src/state/run';
import { POLICIES, type Policy, type PolicyName } from './policy';
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
 * `PENDING_ENCOUNTERS` is empty as of todos/15 — `m9`, `e3` and `b3` are in
 * `ACT1` and `m10`/`m11` moved to `ACT2` — so the old `trash 未启用` row is gone
 * and `m9` is measured where the map actually draws it. Acts two to four are
 * measured further down, against the deck a run holds by the time it gets
 * there; measuring them here would ask an act-1 deck to fight 天命.
 */
const TIERS: { tier: string; encounters: string[] }[] = [
  { tier: 'trash 弱', encounters: ['m1', 'm3', 'm5'] },
  { tier: 'trash 强', encounters: ['m2', 'm4', 'm6', 'm7', 'm8', 'm9'] },
  { tier: 'elite 华雄', encounters: ['e1'] },
  { tier: 'elite 管亥', encounters: ['e2'] },
  { tier: 'elite 张曼成', encounters: ['e3'] },
  { tier: 'boss 吕布', encounters: ['b1'] },
  { tier: 'boss 张梁', encounters: ['b2'] },
  { tier: 'boss 张宝', encounters: ['b3'] },
];

/**
 * What each tier is held to, and — the part that took a rewrite to get right —
 * *which number* it is held to.
 *
 * **Win rate is the wrong metric for a normal room or an 精英.** The sim fights
 * at full HP, alone, with no 丹药, so a fight the player is meant to win costs
 * them resources rather than the run: every 精英 in the game has measured
 * 99-100% since phase one, and the 85-95% band todos/15 signed up to was never
 * once satisfied — not because 阶段三 regressed it, but because a band on a
 * number that is pinned at 100% cannot be satisfied by any amount of tuning.
 * The README's own phase-two table records 华雄 at 100%/100%.
 *
 * What an 精英 actually costs is **体力**, and that number is both live and
 * actionable: 张曼成 cost 28 HP where 华雄 cost 48, which is the real bug the
 * win-rate column could not see. So trash and 精英 are banded on HP cost and
 * 首领 — where dying is genuinely on the table — stay on win rate.
 *
 * The trash band is split the way the map's own draw is split: `weak` rows open
 * an act and `strong` rows close it, and holding both to one number hides
 * whichever half is wrong.
 */
type Metric = 'cost' | 'win';

interface Band {
  tier: string;
  metric: Metric;
  lo: number;
  hi: number;
}

const BANDS: Band[] = [
  { tier: 'trash 弱', metric: 'cost', lo: 0.05, hi: 0.2 },
  { tier: 'trash 强', metric: 'cost', lo: 0.15, hi: 0.35 },
  { tier: 'elite', metric: 'cost', lo: 0.4, hi: 0.55 },
  { tier: 'boss', metric: 'win', lo: 0.45, hi: 0.7 },
];

const bandFor = (tier: string): Band | undefined => BANDS.find((b) => tier.startsWith(b.tier));

/** The banded number for a row — HP cost as a share of max HP, or win rate. */
const metricOf = (r: TierStats, metric: Metric): number =>
  metric === 'win' ? r.winRate : r.avgHpCost / r.hpMax;

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
  /** HP the fight took off the bar, losses counted at the full starting HP. */
  avgHpCost: number;
  /** Max HP the row was fought at, so `avgHpCost` can be read as a share. */
  hpMax: number;
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
    avgHpCost: mean(results.map((r) => r.hpMax - r.hpLeft)),
    hpMax: DEFAULT_HERO.maxHp,
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
  console.log(bandTable(rows, new Set(['act-1', 'act-1 rolled']), 'act-1 decks, greedy/threat AI') + '\n');

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
function bandTable(rows: TierStats[], measured: Set<string>, label: string): string {
  const out = [
    `**Outside band** (${label})\n`,
    '| tier | deck | policy | metric | measured | band |',
    '|---|---|---|---|---|---|',
  ];
  let any = false;
  for (const r of rows) {
    const band = bandFor(r.tier);
    if (!band || !measured.has(r.profile) || r.policy === 'random') continue;
    const value = metricOf(r, band.metric);
    if (value >= band.lo && value <= band.hi) continue;
    any = true;
    const name = band.metric === 'win' ? 'win rate' : 'hp cost';
    out.push(
      `| ${r.tier} | ${r.profile} | ${r.policy} | ${name} | ${pct(value)} | ${pct(band.lo)}–${pct(band.hi)} |`,
    );
  }
  return any ? out.join('\n') : `**Outside band** (${label}): none.`;
}

// =====================================================================
// 第二幕以降 — the fights todos/09 added, measured against the deck a run
// actually holds when it meets them.
// =====================================================================

/**
 * Acts two to four could not be measured by the table above, and the reason is
 * not that nobody got round to it: every profile there is an *act-1* deck, and
 * asking ten starter cards plus six rewards to fight 天命 measures the profile,
 * not the fight. Nineteen enemies shipped in todos/09 with no simulated fight
 * behind any of them.
 *
 * So each act gets the kit a run plausibly holds by the time it arrives:
 * rewards drafted through the real reward door, upgrades spread over the whole
 * deck, relics rolled out of the real pool, 无色 bought from 坊市. The draft
 * picks uniformly among the three on offer rather than picking well — the same
 * deliberate under-statement `act-1 rolled` makes, for the same reason: a band
 * is about the average run, not the ceiling.
 *
 * **What these numbers are not.** No 丹药 and no card removal, both of which a
 * real run has in quantity. `gauntletTable` below measures exactly how much
 * that is worth, and the answer is "most of the difference" — so read the rows
 * here as a *relative* ranking of fights, not as an absolute difficulty.
 */
interface ActProfile {
  act: 1 | 2 | 3 | 4;
  profile: string;
  rewards: number;
  forge: number;
  relics: number;
  colorless: number;
}

const ACT_PROFILES: ActProfile[] = [
  { act: 1, profile: '一幕装备', rewards: 6, forge: 3, relics: 1, colorless: 0 },
  { act: 2, profile: '二幕装备', rewards: 12, forge: 7, relics: 4, colorless: 2 },
  { act: 3, profile: '三幕装备', rewards: 18, forge: 12, relics: 7, colorless: 4 },
  { act: 4, profile: '终章装备', rewards: 22, forge: 16, relics: 10, colorless: 5 },
];

interface Kit {
  deck: DeckCard[];
  relics: string[];
}

function buildKit(seed: string, p: ActProfile): Kit {
  const run = startRun(DEFAULT_HERO, seed);
  const rng = new Rng(`${seed}:kit`);
  for (let i = 0; i < p.rewards; i++) {
    // Every fourth reward is an 精英's, which is roughly the real ratio.
    const picks = rollCardReward({ tier: i % 4 === 3 ? 'elite' : 'monster', run, rng });
    if (picks.length > 0) addCard(run, rng.pick(picks));
  }
  for (let i = 0; i < p.colorless; i++) addCard(run, COLORLESS_POOL[i % COLORLESS_POOL.length]);
  for (let i = 0; i < p.forge; i++) {
    const open = run.deck.filter((c) => !c.upgraded);
    if (open.length === 0) break;
    upgradeCard(run, rng.pick(open).uid);
  }
  const relics = [DEFAULT_HERO.starterRelic];
  for (let i = 0; i < p.relics; i++) {
    const id = rollRelicOfTier(rng, run, i % 4 === 3 ? 'uncommon' : 'common');
    if (id) {
      run.relics.push(id);
      relics.push(id);
    }
  }
  return { deck: run.deck, relics };
}

/** Every fight in one act, tiered the way the map draws them. */
function actTiers(act: 1 | 2 | 3 | 4): { tier: string; encounters: string[] }[] {
  const t = ACT_TABLES[act - 1];
  const ids = (list: readonly { id: string }[]): string[] => list.map((e) => e.id);
  const rows: { tier: string; encounters: string[] }[] = [];
  if (t.weak.length > 0) rows.push({ tier: `trash 弱 · ${act}`, encounters: ids(t.weak) });
  if (t.strong.length > 0) rows.push({ tier: `trash 强 · ${act}`, encounters: ids(t.strong) });
  for (const e of t.elite) rows.push({ tier: `elite ${e.name.split(' · ').pop()}`, encounters: [e.id] });
  for (const e of t.boss) rows.push({ tier: `boss ${e.name.split(' · ').pop()}`, encounters: [e.id] });
  return rows;
}

function runActTier(
  tier: string,
  encounters: string[],
  p: ActProfile,
  policy: PolicyName,
  n: number,
): TierStats {
  const results: SimResult[] = [];
  for (let i = 0; i < n; i++) {
    const seed = `${tier}-${p.profile}-${policy}-${i}`;
    const kit = buildKit(seed, p);
    results.push(
      simulateCombat({
        encounterId: encounters[i % encounters.length],
        deck: kit.deck,
        hero: DEFAULT_HERO,
        hp: DEFAULT_HERO.maxHp,
        maxHp: DEFAULT_HERO.maxHp,
        relics: kit.relics,
        seed,
        policy: POLICIES[policy],
      }),
    );
  }
  const wins = results.filter((r) => r.won);
  const hp = results.map((r) => r.hpLeft).sort((a, b) => a - b);
  return {
    tier,
    profile: p.profile,
    policy,
    n,
    winRate: wins.length / n,
    avgTurns: mean(results.map((r) => r.turns)),
    avgHpCost: mean(results.map((r) => r.hpMax - r.hpLeft)),
    hpMax: DEFAULT_HERO.maxHp,
    avgHpLeft: mean(results.map((r) => r.hpLeft)),
    avgHpLeftOnWin: mean(wins.map((r) => r.hpLeft)),
    hpPercentiles: [10, 20, 30, 40, 50, 60, 70, 80, 90].map((q) => percentile(hp, q)),
    aborted: results.filter((r) => r.aborted !== null).length,
  };
}

function actTable(rows: TierStats[]): string {
  const out = [
    '| tier | deck | policy | win | turns | hp cost | cost % | band |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const band = bandFor(r.tier);
    const cell = band
      ? `${pct(band.lo)}–${pct(band.hi)} ${band.metric === 'win' ? 'win' : 'cost'}`
      : '—';
    out.push(
      `| ${r.tier} | ${r.profile} | ${r.policy} | ${pct(r.winRate)} | ${r.avgTurns.toFixed(1)} | ` +
        `${r.avgHpCost.toFixed(1)} | ${pct(r.avgHpCost / r.hpMax)} | ${cell} |`,
    );
  }
  return out.join('\n');
}

/** 500 is overkill per row here — there are 40 of them and the signal is coarse. */
const ACT_N = 250;

test(`per-act balance: ${ACT_N} fights per row`, () => {
  const rows: TierStats[] = [];
  for (const p of ACT_PROFILES) {
    for (const { tier, encounters } of actTiers(p.act)) {
      for (const policy of ['greedy', 'threat'] as PolicyName[]) {
        rows.push(runActTier(tier, encounters, p, policy, ACT_N));
      }
    }
  }

  console.log(`\n### 四幕逐场 — ${ACT_N} fights per row, 关羽 at full HP, act-appropriate kit\n`);
  console.log(actTable(rows) + '\n');
  console.log(bandTable(rows, new Set(ACT_PROFILES.map((p) => p.profile)), 'per-act kits') + '\n');

  for (const r of rows) expect(r.aborted, `${r.tier}/${r.profile}/${r.policy}`).toBe(0);
});

// ------------------------------------------------------------- 连场

/**
 * One act played end to end, HP carrying across fights — the only instrument
 * that can answer "is an act survivable", which is a different question from
 * "is any one fight winnable" and the one todos/09 needs to place its curve.
 *
 * The path is the one `generateMap` actually produces, measured rather than
 * assumed: ~7.4 monster rooms, ~1.2 精英, ~1.9 篝火 and the 首领, so the walk
 * below is 7 normals (the first two out of `weak`), one 精英, two rests at 30%
 * of max HP, and the crown.
 *
 * The three variants exist because the first one alone is misleading. A sim
 * player who drafts uniformly, never removes a card and never drinks clears an
 * act about 2% of the time; give it the card removal and the 丹药 that every
 * real run carries and the same content clears around half the time. The gap is
 * the sim's handicap, not the content's difficulty — which is precisely why the
 * per-fight tables above are a *ranking* and this one is the altitude check.
 */
interface GauntletVariant {
  label: string;
  cull: number;
  potions: string[];
}

/**
 * ⚠️ **A `cull` variant is missing here on purpose, and it is not a preference.**
 *
 * Card removal is the single biggest thing separating this sim's player from a
 * real one — measured while tuning 第二/三幕, removing five basic cards took the
 * act-2 clear rate from 5% to 25% — so a `{ cull: 5 }` row belongs in this
 * table. It is left out because it trips an **engine hang**:
 *
 *   seed `gauntlet-裁牌 5-1-greedy-5`, encounter `m3`, policy `greedy`,
 *   relics `qinglongdao` + `lianhuanjia`, deck (11 cards, legal — well above
 *   `MIN_DECK_SIZE`) `tiebi ×3, tiebi+, tuodao+, wanren ×2, guanzhen ×2,
 *   guanzhen+, quedi`
 *
 * `playCard` → `pumpEffects` (engine.ts:608) → `applyEffect` (:656) →
 * `drawCards` (:275) re-enters without bound and only stops when `state.events`
 * overflows a JS array, about 200 seconds later. Two guards both miss it: the
 * `maxTurns` check in `simulateCombat` only runs between actions, and
 * `hashState` counts `state.events.length` as progress — so an infinite loop
 * that appends events reads as forward motion to the no-progress detector
 * forever. Three 观阵 (0 气, draw 2) in one deck is the trigger shape.
 *
 * Restore the row once that is fixed; until then the numbers below understate a
 * real run's survival by roughly a factor of five, which is why the per-fight
 * tables above are the ranking and this one is only the altitude check.
 */
const GAUNTLETS: GauntletVariant[] = [
  { label: '素手（不用丹药）', cull: 0, potions: [] },
  { label: '每战两瓶', cull: 0, potions: ['huoyouguan', 'zhuangxingjiu'] },
];

/** Rest sites in `generateMap` are worth 30% of max HP. */
const REST_HEAL = 0.3;

const drinkOnTurnOne = (name: PolicyName): Policy => ({
  ...POLICIES[name],
  name: `${name}+belt`,
  choosePotion: (state, belt) =>
    belt.length > 0 && state.turn === 1
      ? { id: belt[0], targetId: state.enemies.find((e) => e.alive)?.id }
      : null,
});

function walkAct(
  act: 1 | 2 | 3 | 4,
  v: GauntletVariant,
  policy: PolicyName,
  seed: string,
): { cleared: boolean; hpLeft: number; diedAt: string | null } {
  const t = ACT_TABLES[act - 1];
  const rng = new Rng(`${seed}:path`);
  const pick = (list: readonly { id: string }[]): string => rng.pick([...list]).id;
  const path =
    act === 4
      ? [pick(t.elite), 'REST', pick(t.boss)]
      : [
          pick(t.weak),
          pick(t.weak),
          pick(t.strong),
          pick(t.strong),
          'REST',
          pick(t.elite),
          pick(t.strong),
          pick(t.strong),
          pick(t.strong),
          'REST',
          pick(t.boss),
        ];

  const p = ACT_PROFILES[act - 1];
  const kit = buildKit(seed, p);
  for (let i = 0; i < v.cull; i++) {
    // Junk first, the way a real run spends a 商队 removal. Never below
    // `MIN_DECK_SIZE` — the sim must not build a deck the game would refuse.
    if (kit.deck.length <= MIN_DECK_SIZE) break;
    const idx = kit.deck.findIndex((c) => c.defId === 'pikan' || c.defId === 'tiebi');
    if (idx < 0) break;
    kit.deck.splice(idx, 1);
  }

  let hp = DEFAULT_HERO.maxHp;
  for (const step of path) {
    if (step === 'REST') {
      hp = Math.min(DEFAULT_HERO.maxHp, hp + Math.round(DEFAULT_HERO.maxHp * REST_HEAL));
      continue;
    }
    const r = simulateCombat({
      encounterId: step,
      deck: kit.deck,
      hero: DEFAULT_HERO,
      hp,
      maxHp: DEFAULT_HERO.maxHp,
      relics: kit.relics,
      potions: v.potions,
      seed: `${seed}-${step}`,
      policy: v.potions.length > 0 ? drinkOnTurnOne(policy) : POLICIES[policy],
    });
    if (!r.won) return { cleared: false, hpLeft: 0, diedAt: step };
    hp = r.hpLeft;
  }
  return { cleared: true, hpLeft: hp, diedAt: null };
}

const GAUNTLET_N = 200;

test(`gauntlet: ${GAUNTLET_N} acts walked end to end per row`, () => {
  const out = [
    '| variant | act | policy | 过关率 | median hp at act end | 最常阵亡处 |',
    '|---|---|---|---|---|---|',
  ];
  for (const v of GAUNTLETS) {
    for (const act of [1, 2, 3, 4] as const) {
      for (const policy of ['greedy', 'threat'] as PolicyName[]) {
        const survivors: number[] = [];
        const deaths: Record<string, number> = {};
        for (let i = 0; i < GAUNTLET_N; i++) {
          const r = walkAct(act, v, policy, `gauntlet-${v.label}-${act}-${policy}-${i}`);
          if (r.cleared) survivors.push(r.hpLeft);
          else deaths[r.diedAt!] = (deaths[r.diedAt!] ?? 0) + 1;
        }
        survivors.sort((a, b) => a - b);
        const worst = Object.entries(deaths).sort((a, b) => b[1] - a[1])[0];
        out.push(
          `| ${v.label} | ${act} | ${policy} | ${pct(survivors.length / GAUNTLET_N)} | ` +
            `${survivors.length > 0 ? survivors[Math.floor(survivors.length / 2)] : 0} | ` +
            `${worst ? `${worst[0]} ×${worst[1]}` : '—'} |`,
        );
      }
    }
  }
  console.log('\n### 连场 — one act, HP carried across, two 篝火 at 30%\n');
  console.log(out.join('\n') + '\n');
});
