/**
 * 天命 — 进阶难度 (todos/19)。
 *
 * 关键架构决策：所有难度修改都从这里的一个集中修饰器出去，
 * 各接线点（地图生成、引擎、营帐、商店……）只读 `run.mods`，
 * 不许自己按 `run.ascension` 写 if——散落的 if 就是难度不生效的温床。
 *
 * 二十重全部从这张表接线：前十重抬战斗基线，后十重压资源并分档强化招式，
 * 最后一重把第三幕首领改成连续两战。
 */

/** 一局生效的全部难度修改，开局由 `modsFor` 算好，全程只读。 */
export interface AscensionMods {
  /** 地图：额外精英房数量。 */
  extraElites: number;
  /** 敌人 HP 倍率，按档位。 */
  hpMult: { monster: number; elite: number; boss: number };
  /** 敌人伤害倍率，按档位。 */
  damageMult: { monster: number; elite: number; boss: number };
  /** 营帐回血比例，百分数（30 = 回 30% 体力上限）。接线在 `restAmount`（`src/rooms/campfire.ts`）。 */
  restHealPercent: number;
  /** 每幕开始失去的当前体力比例，百分数（10 = 失去 10%）。 */
  actStartHpLossPercent: number;
  /** 最大体力倍率。 */
  maxHpMult: number;
  /** 丹药槽位。基础值与 `BASE_POTION_SLOTS` 同为 3——那边不能 import 过来：会成环。 */
  potionSlots: number;
  /** 奖励卡稀有度权重倍率。 */
  rarityWeightMult: { uncommon: number; rare: number };
  /** 金币奖励倍率（精英/Boss）。 */
  eliteGoldMult: number;
  /** 商店价格倍率。 */
  shopPriceMult: number;
  /** 开局附加的诅咒 id 列表。 */
  startingCurses: string[];
  /** 敌人使用强化招式，按遭遇档位逐重开启。 */
  enhancedMoves: { monster: boolean; elite: boolean; boss: boolean };
  /** 第三幕连续两位不同首领。 */
  doubleBoss: boolean;
}

/**
 * 天命零重 = 现状原样。冻结的：`modsFor(0)` 直接把它交出去，每一局天命零重
 * 的 `run.mods` 都是同一个对象，谁往里写一笔就是改了全局。
 */
export const DEFAULT_MODS: AscensionMods = deepFreeze({
  extraElites: 0,
  hpMult: { monster: 1, elite: 1, boss: 1 },
  damageMult: { monster: 1, elite: 1, boss: 1 },
  restHealPercent: 30,
  actStartHpLossPercent: 0,
  maxHpMult: 1,
  potionSlots: 3,
  rarityWeightMult: { uncommon: 1, rare: 1 },
  eliteGoldMult: 1,
  shopPriceMult: 1,
  startingCurses: [],
  enhancedMoves: { monster: false, elite: false, boss: false },
  doubleBoss: false,
});

/**
 * 十重开局诅咒「宿业」的卡 id。卡面（虚无、不可打出、不可移除）由 19 的
 * a4 落地；接线点（`startRun` 只按 `mods.startingCurses` 找卡）和 a4 的卡表
 * 都引用这个常量，id 在这里占住，两边永远对得上。
 */
export const SUYE_ID = 'suye';

/**
 * 已落地的最高天命重数。选将界面与自定义局都以此封顶。
 */
export const MAX_ASCENSION = 20;

const CN_NUM = [
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
] as const;

/** 「天命五重」。零重没有名号，交给界面自己决定印「无天命」还是不印。 */
export function ascensionLabel(level: number): string {
  return level > 0 ? `天命${CN_NUM[level - 1] ?? level}重` : '';
}

/**
 * 每一重新增修改的人话，选将界面逐行印它。与 `ASCENSION_STEPS` 同表同序——
 * 那张表动一行，这里跟一行。
 */
export const ASCENSION_STEP_DESC: Record<number, string> = {
  1: '精英房 +1',
  2: '杂兵体力 +5%',
  3: '精英体力 +5%、伤害 +5%',
  4: '首领体力 +5%',
  5: '营帐回血 30% → 25%',
  6: '每幕开始失去 10% 当前体力',
  7: '杂兵伤害 +5%',
  8: '精英体力再 +2%',
  9: '首领体力再 +2%、伤害 +4%',
  10: '开局携带诅咒「宿业」、体力上限 −3%',
  11: '丹药槽位 3 → 2',
  12: '奖励中罕见牌与稀有牌更少',
  13: '精英与首领资财奖励 −15%',
  14: '体力上限再 −5%',
  15: '营帐回血 25% → 20%',
  16: '商店价格 +10%',
  17: '杂兵使用强化招式',
  18: '精英使用强化招式',
  19: '首领使用强化招式',
  20: '第三幕连续迎战两位不同首领',
};

/**
 * 每一重**新增**的修改。倍率档位写全三格，`1` 表示这一重不动那一档——
 * `modsFor` 对倍率一律相乘，乘 1 即原样，这样每行和描述表逐字对得上。
 *
 * 数值是 a6 标定过的，不是设计稿的原版增量：原版的 +10%/+25%/+20% 把
 * 十重通关率直接砍到 0%。标定过程和预算记在 `sim/balance.sim.ts` 的
 * 「天命连场」一节；结论是四条规则行（1/5/6/10）保持设计原值，六条
 * 倍率行合计只有 ~10 个通关点的预算，且**伤害倍率比体力倍率贵得多**
 * ——所以 4/8/9 初版动的是体力。改这里任何一个数，先跑 `npm run sim`：
 * 「天命连场」的断言把十重 threat 通关率钉在 15-25%。
 *
 * 2026-08 复标定：关羽扩到 48 张、宝物池扩到 53 件后，固定种子的整局
 * threat 曲线量得零重 43%、十重 14%、二十重 1%。九重首领伤害收在 +4%，
 * 十重上限收在 −3%；一至八重不动，前段爬梯坡度保持原样。
 */
export const ASCENSION_STEPS: Record<number, Partial<AscensionMods>> = {
  1: { extraElites: 1 },
  2: { hpMult: { monster: 1.05, elite: 1, boss: 1 } },
  3: {
    hpMult: { monster: 1, elite: 1.05, boss: 1 },
    damageMult: { monster: 1, elite: 1.05, boss: 1 },
  },
  4: {
    hpMult: { monster: 1, elite: 1, boss: 1.05 },
    damageMult: { monster: 1, elite: 1, boss: 1 },
  },
  5: { restHealPercent: 25 },
  6: { actStartHpLossPercent: 10 },
  7: { damageMult: { monster: 1.05, elite: 1, boss: 1 } },
  8: { hpMult: { monster: 1, elite: 1.02, boss: 1 } },
  9: {
    hpMult: { monster: 1, elite: 1, boss: 1.02 },
    damageMult: { monster: 1, elite: 1, boss: 1.04 },
  },
  10: { startingCurses: [SUYE_ID], maxHpMult: 0.97 },
  11: { potionSlots: 2 },
  12: { rarityWeightMult: { uncommon: 0.9, rare: 0.75 } },
  13: { eliteGoldMult: 0.85 },
  14: { maxHpMult: 0.95 },
  15: { restHealPercent: 20 },
  16: { shopPriceMult: 1.1 },
  17: { enhancedMoves: { monster: true, elite: false, boss: false } },
  18: { enhancedMoves: { monster: false, elite: true, boss: false } },
  19: { enhancedMoves: { monster: false, elite: false, boss: true } },
  20: { doubleBoss: true },
};

/**
 * 把 1..level 的所有修改叠加成一个 mods 对象。**累积不替换**：天命九重
 * 同时带着 2/3/4/7/8/9 的全部效果。
 *
 * 逐字段分四类合并——这是最容易写错的地方，所以宁可写死也不用泛型循环：
 * - **倍率相乘**（hpMult / damageMult / maxHpMult / rarityWeightMult /
 *   eliteGoldMult / shopPriceMult）：两重各 +15% / +10% 得 1.265，不是 1.10；
 * - **计数相加**（extraElites）；
 * - **取值覆盖**（restHealPercent / actStartHpLossPercent / potionSlots）；
 * - **拼接 / 一开不关**（startingCurses；enhancedMoves 各档 / doubleBoss）。
 *
 * 返回值冻结，和 `DEFAULT_MODS` 一个待遇：`run.mods` 是只读的，接线点谁都
 * 不许往里写。
 */
export function modsFor(level: number): AscensionMods {
  if (level <= 0) return DEFAULT_MODS;

  const out: AscensionMods = {
    ...DEFAULT_MODS,
    hpMult: { ...DEFAULT_MODS.hpMult },
    damageMult: { ...DEFAULT_MODS.damageMult },
    rarityWeightMult: { ...DEFAULT_MODS.rarityWeightMult },
    enhancedMoves: { ...DEFAULT_MODS.enhancedMoves },
    startingCurses: [...DEFAULT_MODS.startingCurses],
  };

  for (let step = 1; step <= level; step++) {
    const mod = ASCENSION_STEPS[step];
    if (!mod) continue;

    if (mod.extraElites !== undefined) out.extraElites += mod.extraElites;

    if (mod.hpMult) {
      out.hpMult.monster *= mod.hpMult.monster;
      out.hpMult.elite *= mod.hpMult.elite;
      out.hpMult.boss *= mod.hpMult.boss;
    }
    if (mod.damageMult) {
      out.damageMult.monster *= mod.damageMult.monster;
      out.damageMult.elite *= mod.damageMult.elite;
      out.damageMult.boss *= mod.damageMult.boss;
    }
    if (mod.maxHpMult !== undefined) out.maxHpMult *= mod.maxHpMult;
    if (mod.rarityWeightMult) {
      out.rarityWeightMult.uncommon *= mod.rarityWeightMult.uncommon;
      out.rarityWeightMult.rare *= mod.rarityWeightMult.rare;
    }
    if (mod.eliteGoldMult !== undefined) out.eliteGoldMult *= mod.eliteGoldMult;
    if (mod.shopPriceMult !== undefined) out.shopPriceMult *= mod.shopPriceMult;

    if (mod.restHealPercent !== undefined) out.restHealPercent = mod.restHealPercent;
    if (mod.actStartHpLossPercent !== undefined) {
      out.actStartHpLossPercent = mod.actStartHpLossPercent;
    }
    if (mod.potionSlots !== undefined) out.potionSlots = mod.potionSlots;

    if (mod.startingCurses) out.startingCurses.push(...mod.startingCurses);
    if (mod.enhancedMoves) {
      out.enhancedMoves.monster ||= mod.enhancedMoves.monster;
      out.enhancedMoves.elite ||= mod.enhancedMoves.elite;
      out.enhancedMoves.boss ||= mod.enhancedMoves.boss;
    }
    if (mod.doubleBoss) out.doubleBoss = true;
  }

  return deepFreeze(out);
}

/** 各武将各自的最高通关天命。持久化在 `src/state/ascension.ts`（a5）。 */
export interface AscensionProgress {
  /** heroId → 已通关的最高天命（0 = 只通过普通难度）。 */
  cleared: Record<string, number>;
}

/** 递归冻结。mods 就两层深、没有环，够用了。 */
function deepFreeze<T extends object>(obj: T): T {
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}
