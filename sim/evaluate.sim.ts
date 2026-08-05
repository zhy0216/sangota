import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { COLORLESS_POOL, getCard, poolFor } from '../src/combat/cards';
import { ACT_TABLES } from '../src/combat/enemies';
import { RELICS } from '../src/combat/relics';
import { rollCardReward, rollRelicOfTier } from '../src/combat/rewards';
import { Rng } from '../src/core/rng';
import type { ActIndex } from '../src/data/acts';
import { modsFor } from '../src/data/ascension';
import { DEFAULT_HERO, HEROES_IN_ORDER, type HeroDef } from '../src/data/heroes';
import {
  addCard,
  MIN_DECK_SIZE,
  newDeckCard,
  startRun,
  upgradableCards,
  upgradeCard,
  type DeckCard,
} from '../src/state/run';
import { POLICIES, type Policy, type PolicyName } from './policy';
import { simulateCombat } from './runCombat';

/**
 * 平衡评估仪器 — `npm run eval`，不进 `npm test` 也不进 `npm run sim`。
 *
 * `balance.sim.ts` 是**验收闸门**：band 定好、seed 冻住、断言把关，改数的人跑它
 * 看有没有越线。这份文件是**调参罗盘**：它不断言任何平衡数值，只回答闸门答不了
 * 的三个问题——
 *
 * 1. **哪张卡在抬（或拖）胜率**：README 里 土山约三事/斩颜良 的超模是手工扫出来
 *    的（对照组 +2 张、打 500 场吕布），扫完就扔了。这里把那次手工实验固化成表：
 *    每武将每张可入池的卡 +2 张对基线的边际胜率，逐张量、逐池汇总。「稀有卡被
 *    greedy/threat 用不出来」（已知档案：张辽 16% vs 25%）在池均值一行直接可见。
 * 2. **哪件宝物值多少**：三十余件可掉落宝物从未被单独量过。二幕裸牌组 ±一件，
 *    看首领胜率与精英体力成本各动多少。
 * 3. **难度曲线长什么形**：连场表只给「过关率 + 最常阵亡处」，这里把四幕连走的
 *    每一步摊开——每步的进入人数、阵亡数、血线均值——难度尖峰落在哪一步、
 *    greedy 和 threat 死的位置差在哪，一张表读完。
 *
 * 读数的三条戒律，写在最前面因为每一条都被这个项目踩过：
 * - **Δ 是「政策能打出来的价值」，不是卡的上限。** X 费、需要长线运营的引擎牌，
 *   greedy 出不好量出来就是低——低 Δ 是「调数或调 AI」的起点，不是删卡的判决。
 * - **±10 个百分点以内当噪声读。** 300 场的 95% 置信区间约 ±8；旗标线取 10。
 * - **纯地图经济类宝物（资财、商店、掉率）量出来必然 ≈0**，那是仪器的盲区，
 *   不是宝物弱。
 *
 * 输出三份：控制台（人读）、`out/eval/report.md`（同文存档）、
 * `out/eval/report.json`（机器可 diff——调参前后各跑一次，diff 这个文件）。
 * `out/` 在 .gitignore 里，报告随跑随生成，不进版本库。
 */

// ------------------------------------------------------------- 共用

/** 每行场数。300 场胜率的 95% 置信区间约 ±8 个百分点，配对种子再窄一点。 */
const SWEEP_N = 300;
/** |Δ| 达到这条线才标旗——低于它的差异在 300 场下分不清是信号还是运气。 */
const FLAG = 0.1;

/**
 * 与 `balance.sim.ts` 的同名物完全一致，抄而不 import：那边是测试文件，import
 * 会把整套平衡闸门注册进本档一起跑。项目先例（walkAct/walkRun 亦为复制）；
 * 两边如有改动需同步，kit 的配方一变，这里量出的 Δ 就换了基线。
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

function buildKit(
  seed: string,
  p: ActProfile,
  hero: HeroDef = DEFAULT_HERO,
  ascension = 0,
): Kit {
  const run = startRun(hero, seed, ascension);
  const rng = new Rng(`${seed}:kit`);
  for (let i = 0; i < p.rewards; i++) {
    const picks = rollCardReward({ tier: i % 4 === 3 ? 'elite' : 'monster', run, rng });
    if (picks.length > 0) addCard(run, rng.pick(picks));
  }
  for (let i = 0; i < p.colorless; i++) addCard(run, COLORLESS_POOL[i % COLORLESS_POOL.length]);
  for (let i = 0; i < p.forge; i++) {
    const open = upgradableCards(run);
    if (open.length === 0) break;
    upgradeCard(run, rng.pick(open).uid);
  }
  const relics = [hero.starterRelic];
  for (let i = 0; i < p.relics; i++) {
    const id = rollRelicOfTier(rng, run, i % 4 === 3 ? 'uncommon' : 'common');
    if (id) {
      run.relics.push(id);
      relics.push(id);
    }
  }
  return { deck: run.deck, relics };
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
/** Δ 带符号打印，一眼分清抬和拖。 */
const spct = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}`;

/** 敌人 id → 名字，四幕的表拍平成一张查询。 */
const ENCOUNTER_NAME: Record<string, string> = {};
for (const t of ACT_TABLES) {
  for (const list of [t.weak, t.strong, t.elite, t.boss]) {
    for (const e of list) ENCOUNTER_NAME[e.id] = e.name;
  }
}

/** 报告正文：控制台打一份，`out/eval/report.md` 存同一份。 */
const MD: string[] = [];
/** 机器可 diff 的那份。结构只增不改，diff 才有连续性。 */
const REPORT: {
  cards: unknown[];
  relics: unknown[];
  curve: unknown[];
} = { cards: [], relics: [], curve: [] };

function emit(section: string): void {
  MD.push(section);
  console.log(section);
}

// ------------------------------------------------------- 卡牌边际价值

/**
 * 一幕装备 + 该卡两张，对一幕三首领轮换，与基线（同 seed、同 kit、只少这两张）
 * 比胜率。种子不含卡 id，是刻意的：基线与处理组抽到同一副 kit，Δ 里没有
 * 「这组运气好」的成分——README 那次手工扫描的配方，逐张自动化。
 *
 * +2 张而不是 +1：单张在 16 张牌组里抽到率太低，Δ 会淹在噪声里；两张是
 * 手工扫描用过并证明能把 +21…+42 的超模拉出水面的剂量。
 */
function measureCardRow(hero: HeroDef, cardId: string | null): { winRate: number; aborted: number } {
  const bosses = ACT_TABLES[0].boss.map((b) => b.id);
  let wins = 0;
  let aborted = 0;
  for (let i = 0; i < SWEEP_N; i++) {
    const seed = `evalcard-${hero.id}-${i}`;
    const kit = buildKit(seed, ACT_PROFILES[0], hero);
    const deck = cardId
      ? [...kit.deck, newDeckCard(cardId), newDeckCard(cardId)]
      : kit.deck;
    const r = simulateCombat({
      encounterId: bosses[i % bosses.length],
      deck,
      hero,
      hp: hero.maxHp,
      maxHp: hero.maxHp,
      relics: kit.relics,
      seed,
      policy: POLICIES.greedy,
    });
    if (r.won) wins += 1;
    if (r.aborted) aborted += 1;
  }
  return { winRate: wins / SWEEP_N, aborted };
}

test(`卡牌边际价值: 每卡 +2 对一幕首领, ${SWEEP_N} fights per row`, () => {
  const lines: string[] = [
    `\n### 卡牌边际价值 — 一幕装备 ± 该卡×2，一幕三首领轮换，greedy，${SWEEP_N} 场/行`,
    '',
    `Δ 为对同种子基线的胜率差（百分点）。⚠ = |Δ| ≥ ${FLAG * 100}。`,
    'Δ 量的是政策打得出的价值：X 费与长线引擎牌被 greedy 低估属于已知盲区。',
    '',
  ];

  for (const hero of HEROES_IN_ORDER) {
    const pools: { pool: string; ids: string[] }[] = [
      { pool: 'common', ids: [...poolFor(hero.id, 'common')] },
      { pool: 'uncommon', ids: [...poolFor(hero.id, 'uncommon')] },
      { pool: 'rare', ids: [...poolFor(hero.id, 'rare')] },
      { pool: 'legendary', ids: [...poolFor(hero.id, 'legendary')] },
      { pool: '无色', ids: [...COLORLESS_POOL] },
    ];
    const base = measureCardRow(hero, null);
    const rows: {
      id: string;
      name: string;
      pool: string;
      cost: number;
      winRate: number;
      dWin: number;
      aborted: number;
    }[] = [];
    for (const { pool, ids } of pools) {
      for (const id of ids) {
        const m = measureCardRow(hero, id);
        const def = getCard(id);
        rows.push({
          id,
          name: def.name,
          pool,
          cost: def.cost,
          winRate: m.winRate,
          dWin: m.winRate - base.winRate,
          aborted: m.aborted,
        });
      }
    }
    rows.sort((a, b) => b.dWin - a.dWin);
    REPORT.cards.push({ hero: hero.name, baseline: base.winRate, rows });

    lines.push(`**${hero.name}** — 基线胜率 ${pct(base.winRate)}`, '');
    lines.push('| 卡 | 池 | 费 | 胜率 | Δ | |', '|---|---|---|---|---|---|');
    for (const r of rows) {
      const flag = Math.abs(r.dWin) >= FLAG ? '⚠' : '';
      const abort = r.aborted > 0 ? ` ✕${r.aborted}` : '';
      lines.push(
        `| ${r.name} | ${r.pool} | ${r.cost < 0 ? 'X' : r.cost} | ${pct(r.winRate)} | ${spct(r.dWin)}${abort} | ${flag} |`,
      );
    }
    const byPool = pools
      .filter((p) => p.ids.length > 0)
      .map((p) => {
        const sub = rows.filter((r) => r.pool === p.pool);
        return `${p.pool} ${spct(mean(sub.map((r) => r.dWin)))}（${sub.length} 张）`;
      });
    lines.push('', `池均 Δ：${byPool.join('　·　')}`, '');
  }

  emit(lines.join('\n'));
  expect(REPORT.cards.length).toBe(HEROES_IN_ORDER.length);
});

// ------------------------------------------------------- 宝物边际价值

/**
 * 二幕裸牌组（宝物只有起手那件）± 被测宝物一件。首领量胜率，精英量体力成本
 * ——与闸门的 band 同一套度量，谁看着谁的表都不用换算。
 *
 * kit 的 relics 配额写 0 而不是沿用二幕的 4：被测宝物必须是场上唯一的变量。
 * 代价是量的是「裸配」下的边际——与其它宝物的协同（藤甲×虎符那类）这里看不见，
 * 那属于闸门的 kitted 档。
 */
function measureRelicRow(relicId: string | null): {
  bossWin: number;
  eliteCost: number;
  aborted: number;
} {
  const hero = DEFAULT_HERO;
  const bosses = ACT_TABLES[1].boss.map((b) => b.id);
  const elites = ACT_TABLES[1].elite.map((e) => e.id);
  const bare: ActProfile = { ...ACT_PROFILES[1], relics: 0 };
  let wins = 0;
  let aborted = 0;
  const costs: number[] = [];
  for (let i = 0; i < SWEEP_N; i++) {
    const seed = `evalrelic-${i}`;
    const kit = buildKit(seed, bare, hero);
    const relics = relicId ? [hero.starterRelic, relicId] : [hero.starterRelic];
    const boss = simulateCombat({
      encounterId: bosses[i % bosses.length],
      deck: kit.deck,
      hero,
      hp: hero.maxHp,
      maxHp: hero.maxHp,
      relics,
      seed,
      policy: POLICIES.greedy,
    });
    if (boss.won) wins += 1;
    if (boss.aborted) aborted += 1;
    const elite = simulateCombat({
      encounterId: elites[i % elites.length],
      deck: kit.deck,
      hero,
      hp: hero.maxHp,
      maxHp: hero.maxHp,
      relics,
      seed: `${seed}:elite`,
      policy: POLICIES.greedy,
    });
    costs.push((elite.hpMax - elite.hpLeft) / elite.hpMax);
    if (elite.aborted) aborted += 1;
  }
  return { bossWin: wins / SWEEP_N, eliteCost: mean(costs), aborted };
}

test(`宝物边际价值: 每件对二幕首领/精英, ${SWEEP_N} fights per row`, () => {
  const droppable = Object.values(RELICS)
    .filter((r) => r.tier !== 'starter')
    .filter((r) => !r.hero || r.hero === DEFAULT_HERO.id);

  const base = measureRelicRow(null);
  const rows: {
    id: string;
    name: string;
    tier: string;
    dBossWin: number;
    dEliteCost: number;
    aborted: number;
  }[] = [];
  for (const r of droppable) {
    const m = measureRelicRow(r.id);
    rows.push({
      id: r.id,
      name: r.name,
      tier: r.tier,
      dBossWin: m.bossWin - base.bossWin,
      dEliteCost: m.eliteCost - base.eliteCost,
      aborted: m.aborted,
    });
  }
  rows.sort((a, b) => b.dBossWin - a.dBossWin);
  REPORT.relics.push({ baseline: base, rows });

  const lines: string[] = [
    `\n### 宝物边际价值 — 二幕裸牌组 ± 一件，关羽，greedy，${SWEEP_N} 场/行`,
    '',
    `基线：二幕首领胜率 ${pct(base.bossWin)}，精英体力成本 ${pct(base.eliteCost)}。`,
    'Δ成本为负 = 精英打得更省。地图经济类宝物（资财/商店/掉率）本仪器量不到，≈0 属预期。',
    '',
    '| 宝物 | 阶 | Δ首领胜率 | Δ精英成本 | |',
    '|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const flag = Math.abs(r.dBossWin) >= FLAG || Math.abs(r.dEliteCost) >= FLAG ? '⚠' : '';
    const abort = r.aborted > 0 ? ` ✕${r.aborted}` : '';
    lines.push(
      `| ${r.name} | ${r.tier} | ${spct(r.dBossWin)} | ${spct(r.dEliteCost)}${abort} | ${flag} |`,
    );
  }
  emit(lines.join('\n'));
  expect(rows.length).toBeGreaterThan(20);
});

// ----------------------------------------------------------- 难度曲线

/**
 * `balance.sim.ts` 天命连场的同一条走法、同一批种子（`ascension-run-…`），
 * 多记一层每步流水。种子同源是刻意的：本表的过关率必须与闸门的天命连场表
 * 逐字对得上，对不上就是这份复制漂了——仪器自带的校验，不用断言也看得见。
 *
 * 每步记：进入数（= 活着走到这一步的局数）、阵亡数、进出场血线均值。
 * 曲线的「形」在进入数一列：斜率最陡的那一步就是难度尖峰。
 */
const CURVE_N = 500;
const CURVE_LEVELS = [0, 5, 10, 15, 20] as const;
const RUN_POTIONS = ['huoyouguan', 'zhuangxingjiu', 'xumintang'];

const runBelt = (name: PolicyName): Policy => ({
  ...POLICIES[name],
  name: `${name}+runbelt`,
  choosePotion: (state, belt) => {
    if (belt.includes('xumintang') && state.player.hp <= state.player.maxHp * 0.3) {
      return { id: 'xumintang' };
    }
    const bottle = belt.find((id) => id !== 'xumintang');
    return bottle && state.turn === 1
      ? { id: bottle, targetId: state.enemies.find((e) => e.alive)?.id }
      : null;
  },
});

/** 一步的累计流水。`kind` 是路径模板里的静态位（篝火/精英……）。 */
interface StepStat {
  label: string;
  kind: string;
  entered: number;
  deaths: number;
  hpInSum: number;
  hpOutSum: number;
}

const STEP_KINDS = [
  ['弱兵', '弱兵', '强兵', '强兵', '篝火', '精英', '强兵*', '强兵', '强兵', '篝火', '首领'],
  ['弱兵', '弱兵', '强兵', '强兵', '篝火', '精英', '强兵*', '强兵', '强兵', '篝火', '首领'],
  ['弱兵', '弱兵', '强兵', '强兵', '篝火', '精英', '强兵*', '强兵', '强兵', '篝火', '首领'],
  ['精英', '篝火', '首领'],
];

function walkRunRecorded(
  ascension: number,
  policy: PolicyName,
  seed: string,
  steps: Map<string, StepStat>,
  deathsBy: Record<string, number>,
): { cleared: boolean; hpLeft: number } {
  const mods = modsFor(ascension);
  const maxHp = Math.round(DEFAULT_HERO.maxHp * mods.maxHpMult);
  let hp = maxHp;

  for (const act of [1, 2, 3, 4] as const satisfies readonly ActIndex[]) {
    if (act > 1) {
      // 幕门上只剩六重的开幕失血；首领战打赢时已回满（healAfterBossVictory）。
      hp -= Math.floor((hp * mods.actStartHpLossPercent) / 100);
    }

    const t = ACT_TABLES[act - 1];
    const rng = new Rng(`${seed}:path:${act}`);
    const pick = (list: readonly { id: string }[]): string => rng.pick([...list]).id;
    let path: string[];
    if (act === 4) {
      path = [pick(t.elite), 'REST', pick(t.boss)];
    } else {
      const firstBoss = pick(t.boss);
      path = [
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
        firstBoss,
      ];
      if (act === 3 && mods.doubleBoss) {
        const otherBosses = t.boss.filter((boss) => boss.id !== firstBoss);
        path.push(pick(otherBosses));
      }
      if (mods.extraElites > 0 && rng.int(2) === 0) path[7] = pick(t.elite);
    }

    const kit = buildKit(`${seed}:${act}`, ACT_PROFILES[act - 1], DEFAULT_HERO, ascension);
    for (let i = 0; i < 5; i++) {
      if (kit.deck.length <= MIN_DECK_SIZE) break;
      const idx = kit.deck.findIndex((c) => c.defId === 'pikan' || c.defId === 'tiebi');
      if (idx < 0) break;
      kit.deck.splice(idx, 1);
    }
    for (let pos = 0; pos < path.length; pos++) {
      const step = path[pos];
      const key = `${act}幕#${String(pos + 1).padStart(2, '0')}`;
      const stat = steps.get(key) ?? {
        label: key,
        kind: STEP_KINDS[act - 1][pos] ?? '首领二战',
        entered: 0,
        deaths: 0,
        hpInSum: 0,
        hpOutSum: 0,
      };
      steps.set(key, stat);
      stat.entered += 1;
      stat.hpInSum += hp;

      if (step === 'REST') {
        hp = Math.min(maxHp, hp + Math.round((maxHp * mods.restHealPercent) / 100));
        stat.hpOutSum += hp;
        continue;
      }
      const r = simulateCombat({
        encounterId: step,
        deck: kit.deck,
        hero: DEFAULT_HERO,
        hp,
        maxHp,
        relics: kit.relics,
        potions: RUN_POTIONS,
        seed: `${seed}-${act}-${step}`,
        policy: runBelt(policy),
        ascension,
      });
      if (!r.won) {
        stat.deaths += 1;
        const who = `${act}幕 ${ENCOUNTER_NAME[step] ?? step}`;
        deathsBy[who] = (deathsBy[who] ?? 0) + 1;
        return { cleared: false, hpLeft: 0 };
      }
      hp = r.hpLeft;
      // 首领战后回满（healAfterBossVictory；终章除外，同天命连场的理由）。
      // 先回满再记 hpOut，下一步的 hpIn 才和这一栏接得上。
      if (act < 4 && t.boss.some((b) => b.id === step)) hp = maxHp;
      stat.hpOutSum += hp;
    }
  }
  return { cleared: true, hpLeft: hp };
}

test(`难度曲线: ${CURVE_N} full runs per level per policy`, () => {
  const lines: string[] = [
    `\n### 难度曲线 — 四幕连走每步流水，seed 与天命连场同源，${CURVE_N} 局/格`,
    '',
    '进入 = 活着走到这一步的局数；本表过关率应与 `npm run sim` 天命连场表逐字一致。',
  ];

  for (const level of CURVE_LEVELS) {
    for (const policy of ['greedy', 'threat'] as PolicyName[]) {
      const steps = new Map<string, StepStat>();
      const deathsBy: Record<string, number> = {};
      let cleared = 0;
      for (let i = 0; i < CURVE_N; i++) {
        const r = walkRunRecorded(level, policy, `ascension-run-${level}-${policy}-${i}`, steps, deathsBy);
        if (r.cleared) cleared += 1;
      }

      const ordered = [...steps.values()].sort((a, b) => a.label.localeCompare(b.label));
      REPORT.curve.push({
        level,
        policy,
        n: CURVE_N,
        clearRate: cleared / CURVE_N,
        steps: ordered.map((s) => ({
          label: s.label,
          kind: s.kind,
          entered: s.entered,
          deaths: s.deaths,
          hpIn: s.hpInSum / Math.max(1, s.entered),
        })),
        deathsBy,
      });

      lines.push('', `**天命${level} · ${policy}** — 通关率 ${pct(cleared / CURVE_N)}`, '');
      lines.push('| 步 | 房 | 进入 | 阵亡 | 死亡占比 | 均入血 |', '|---|---|---|---|---|---|');
      const totalDeaths = CURVE_N - cleared;
      for (const s of ordered) {
        const share = totalDeaths > 0 ? s.deaths / totalDeaths : 0;
        lines.push(
          `| ${s.label} | ${s.kind} | ${s.entered} | ${s.deaths > 0 ? s.deaths : ''} | ` +
            `${s.deaths > 0 ? pct(share) : ''} | ${(s.hpInSum / Math.max(1, s.entered)).toFixed(0)} |`,
        );
      }
      const top = Object.entries(deathsBy)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([who, n]) => `${who} ×${n}`);
      lines.push('', `最致命：${top.join('　·　')}`);
    }
  }

  emit(lines.join('\n'));
  expect(REPORT.curve.length).toBe(CURVE_LEVELS.length * 2);
});

// ------------------------------------------------------------- 落盘

test('评估报告落盘: out/eval/report.{md,json}', () => {
  mkdirSync('out/eval', { recursive: true });
  writeFileSync('out/eval/report.md', MD.join('\n') + '\n');
  writeFileSync('out/eval/report.json', JSON.stringify(REPORT, null, 2) + '\n');
  console.log('\n评估报告已写入 out/eval/report.md 与 out/eval/report.json。\n');
  expect(existsSync('out/eval/report.md')).toBe(true);
  expect(existsSync('out/eval/report.json')).toBe(true);
});
