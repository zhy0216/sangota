# 19 · 进阶难度（天命）

## 现状

完全没有难度分层。所有数值是单一常量：

- `BASE_ENERGY = 3`、`HAND_SIZE = 5`（`src/combat/engine.ts:21-23`）
- 敌人 HP 区间写死在 `ENEMIES`（`src/combat/enemies.ts`）
- 营帐固定回 30%（`src/scenes/MapScene.ts:330`）
- 精英/Boss 各一个（`enemies.ts:104-105`）

README 记录的 Boss 胜率：贪心 AI 41% / 威胁感知 AI 71%。也就是说
对熟练玩家来说，**通关之后就没有目标了**——这是 roguelike 最典型的
「玩三局就腻」失效模式。

## 原版行为

20 级 Ascension，每级叠加一条修改（**累积不替换**），逐级解锁
（通关 A(n) 才能玩 A(n+1)）：

| 级 | 修改 |
|---|---|
| 1 | 精英更多（地图上精英房增加） |
| 2 | 普通敌人更强 |
| 3 | 精英更强 |
| 4 | Boss 更强 |
| 5 | 篝火回血从 30% 降到 **25%** |
| 6 | 每幕开始时少 **10%** 当前生命 |
| 7 | 普通敌人更强（第二次） |
| 8 | 精英更强（第二次） |
| 9 | Boss 更强（第二次） |
| 10 | 开局获得诅咒牌 **Ascender's Bane**（虚无、不可移除） |
| 11 | 药水槽从 3 减到 **2** |
| 12 | 所有卡牌奖励里**罕见/稀有出现率降低** |
| 13 | 精英/Boss 的**金币奖励减少** |
| 14 | 最大生命 **-5%** |
| 15 | 敌人**伤害提高**（不是 HP） |
| 16 | 商店**价格提高 10%** |
| 17 | 敌人获得**额外机制**（更强的招式变体） |
| 18 | 精英**必定**出现更强变体 |
| 19 | Boss 的**额外机制** |
| 20 | **每幕的 Boss 战变两场**（打完一个 Boss 立刻打第二个） |

设计要点：**修改是累积的**，A20 是全部 20 条同时生效。
每级有独立的通关记录和排行。

## 设计方案

三国题材叫**天命**（天命一重 … 天命二十重）。

不必一次做 20 级。**先做 10 级**，覆盖全部修改类型（敌人强化、
资源削减、规则追加），后 10 级留给内容更全的时候。

关键架构决策：**所有难度修改必须走一个集中的修饰器**，
不能散落在各处 if。

```
（2/3/4/7/8/9 的数值为 a6 标定后的终值；设计初稿照抄原版的
 +10%/+25%/+20% 会把十重通关率砍到 0%——过程见文末「标定记录」）

天命一重  精英房数量 +1（地图生成时）
天命二重  普通敌人 HP +5%
天命三重  精英 HP +5%，伤害 +5%
天命四重  Boss HP +5%
天命五重  营帐回血 30% → 25%
天命六重  每幕开始失去 10% 当前体力
天命七重  普通敌人伤害 +5%
天命八重  精英 HP 再 +2%
天命九重  Boss HP 再 +2%
天命十重  开局获得诅咒「宿业」（虚无、不可移除、不可打出）
—— 以下留待后续 ——
天命十一重 丹药槽 3 → 2
天命十二重 奖励卡稀有度权重降低
天命十三重 精英/Boss 资财奖励 -25%
天命十四重 最大体力 -5%
天命十五重 全体敌人伤害 +10%
天命十六重 商店价格 +10%
天命十七重 敌人解锁强化招式
天命十八重 精英必为强化变体
天命十九重 Boss 解锁额外机制
天命二十重 每幕两场 Boss
```

## 数据结构

```ts
// src/data/ascension.ts (新增)

export interface AscensionMods {
  /** 地图：额外精英房数量。 */
  extraElites: number;
  /** 敌人 HP 倍率，按档位。 */
  hpMult: { monster: number; elite: number; boss: number };
  /** 敌人伤害倍率，按档位。 */
  damageMult: { monster: number; elite: number; boss: number };
  /** 营帐回血比例。 */
  restHealPercent: number;
  /** 每幕开始失去的当前体力比例。 */
  actStartHpLossPercent: number;
  /** 最大体力倍率。 */
  maxHpMult: number;
  /** 丹药槽位。 */
  potionSlots: number;
  /** 奖励卡稀有度权重倍率。 */
  rarityWeightMult: { uncommon: number; rare: number };
  /** 金币奖励倍率（精英/Boss）。 */
  eliteGoldMult: number;
  /** 商店价格倍率。 */
  shopPriceMult: number;
  /** 开局附加的诅咒 id 列表。 */
  startingCurses: string[];
  /** 敌人使用强化招式。 */
  enhancedMoves: boolean;
  /** 每幕双 Boss。 */
  doubleBoss: boolean;
}

/** 把 1..level 的所有修改叠加成一个 mods 对象。 */
export function modsFor(level: number): AscensionMods;

/** 各武将各自的最高通关天命，存 localStorage。 */
export interface AscensionProgress {
  /** heroId → 已通关的最高天命（0 = 只通过普通难度）。 */
  cleared: Record<string, number>;
}
```

```ts
// src/state/run.ts 增补
export interface RunState {
  // ...
  ascension: number;          // 0 = 无天命
  mods: AscensionMods;        // 开局算好，全程只读
}
```

## 实现步骤

1. `src/data/ascension.ts`：写 `ASCENSION_STEPS: Record<number, Partial<AscensionMods>>`
   和 `modsFor(level)`（从 `DEFAULT_MODS` 起，逐级 merge，
   倍率类字段**相乘**而不是覆盖——这是最容易写错的地方）。
2. **修饰点接线**（每处都要，漏一处就是难度不生效）：
   - `generateMap`：`extraElites`（房间类型分配时给 elite 加权重。
     注意 `src/map/generateMap.ts` 现有的规则约束——同边不重复、
     `minAdvancedRow` 限制——加精英时不能破坏这些规则）
   - `engine.ts` 的 `makeEnemy`（`engine.ts:86-104`）：`hpMult`
     （按遭遇档位，所以 `StartCombatOptions` 要带 `tier`）
   - `engine.ts` 的 `executeMove`（`engine.ts:190`）：`damageMult`
     （**在 `computeAttack` 之前**乘基础伤害，否则和怯战/破绽的乘法顺序不对）
   - `intentOf`（[16 意图](16-intent-system-done.md)）也要乘，否则意图数字和实际不符
   - `MapScene.ts:330` 的营帐：`restHealPercent`（→ [04 营帐](04-campfire-done.md)）
   - `advanceAct`（[09 多幕](09-acts-and-progression-done.md)）：`actStartHpLossPercent`
   - `startRun`（`src/state/run.ts:22`）：`maxHpMult`、`potionSlots`、
     `startingCurses`
   - `rollCardReward`（[11](11-card-rarity-and-rewards-done.md)）：`rarityWeightMult`
   - `priceOf`（[05 商店](05-shop-done.md)）：`shopPriceMult`
3. `AscensionProgress` 持久化（localStorage，和 [08 存档](08-save-resume-done.md)
   分开存——难度进度不该被跑团存档清除影响）。
4. 选将界面（[17](17-multiple-heroes-done.md)）加天命选择器：
   左右箭头调级，只能选到 `cleared[heroId] + 1`。
   显示该级的**新增**修改（高亮）和全部累积修改（列表）。
5. 通关（[22 结算](22-run-summary.md) 胜利分支）时更新
   `cleared[heroId] = max(cleared, run.ascension)`。
6. HUD 显示当前天命等级（地图右上角小字「天命五重」）。
7. **诅咒「宿业」**：虚无 + 不可打出 + **不可移除**——
   [05 商店](05-shop-done.md) 的弃卡和 [04 营帐](04-campfire-done.md) 的弃甲
   都要把它标为不可选。`CardDef` 加 `removable?: false`。
8. 平衡标定：**每一级都要跑
   [25 无头模拟](25-headless-sim-and-tests-done.md)**，目标是天命十重时
   威胁感知 AI 的通关率落在 15-25%。手调是不可能调对的。

## 验收标准

- 天命三重下华雄 HP 是基础的 1.05 倍、伤害 1.05 倍（a6 标定值），意图数字正确反映
- 天命修改**累积**：天命九重同时有 2/3/4/7/8/9 的全部效果
- 倍率相乘正确：天命七重 + 十五重（若都做）的普通敌人伤害是 1.05×1.10
- 天命五重营帐回 25% 而不是 30%
- 天命六重进第二幕时掉 10% 当前体力
- 天命十重开局牌组里有「宿业」，且商店弃卡/营帐弃甲都不能移除它
- 只通关过普通难度时，选将界面最高只能选天命一重
- 通关天命三重后能选天命四重
- 难度进度不会被跑团存档的清除影响
- 天命十重下威胁感知 AI 通关率在 15-25%（模拟验证）

## 依赖

- [09 多幕](09-acts-and-progression-done.md)——`actStartHpLossPercent` 和双 Boss 需要多幕
- [22 结算界面](22-run-summary.md)——通关记录的写入点
- [17 多武将](17-multiple-heroes-done.md)——难度进度是按武将分的
- [25 无头模拟](25-headless-sim-and-tests-done.md)——**强依赖**，20 级难度不可能手调
- 各修饰点分别依赖 04 / 05 / 11 / 14 / 16

## 标定记录（a6，2026-08）

仪器：`sim/balance.sim.ts` 的「天命连场」——四幕连走、体力跨幕、每幕
按 gauntlet 的「裁五张 + 每战两瓶」打法另带一瓶见底才喝的续命汤
（`usableOutOfCombat: true`，真人本来就这么用），幕间规则照抄
`advanceAct`，天命 0/3/5/10 各 500 局。断言（`npm run sim`）：十重
threat 通关率钉在 15-25%。

过程（只调 19 的增量，不动基础敌人数值——37 个黄金快照锁着零重）：

1. 设计初稿照抄原版增量（HP +10%/+25%/+20%、伤害 +15%/+20%/+20%）：
   十重通关率 **0%**（零重基线 41%）。原版的百分比是给原版的血量余裕
   设计的；这个游戏的精英 HP 成本带本来就是上限体力的 40-55%。
2. 只留 1/5/6/10 四条规则行、倍率全 1：十重 28%。规则行已吃掉基线的
   三成，六条倍率行合计只有 ~10 个通关点的预算。
3. 伤害倍率远比体力倍率贵：仅「首领伤害 +5%」一行就砍 ~10 个点
   （败点全堆在一幕首领）。所以 4/8/9 三行改成动 HP 不动伤害。
4. 终值：二重杂兵 HP+5%；三重精英 HP+5%/伤+5%；四重首领 HP+5%；
   七重杂兵伤+5%；八重精英 HP 再+2%；九重首领 HP 再+2%；
   1/5/6/10 保持设计原值（规则不是数字，砍它们等于砍设计）。

终值量得（threat AI）：**0 重 41% → 3 重 33% → 5 重 23% → 10 重 18%**
（greedy：41/31/25/16）——逐级单调下行，十重在 15-25% 带内。✔
