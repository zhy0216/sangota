# 11 · 卡牌稀有度与奖励规则

## 现状

`CardRarity` 类型已定义（`src/combat/types.ts:17`）：
`'basic' | 'common' | 'uncommon' | 'rare'`，11 张牌也都标了稀有度
（`src/combat/cards.ts`）。**但稀有度目前完全不影响任何行为。**

`REWARD_POOL`（`cards.ts:171-180`）是一个扁平数组：

```ts
export const REWARD_POOL: string[] = [
  'wenjiu', 'wanren', 'quedi', 'yiyong', 'baima', 'jieying', 'guanzhen', 'xuzhao',
];
```

`CombatScene.ts:1175` 附近从这里等概率抽三张。结果是：

- 罕见的「万人敌」（全体 8 伤）和常见的「白马义从」（0 费 4 伤）**出现率一样**
- 精英战和普通战的奖励质量**没有区别**
- 池子里只有 8 张，一局能刷 16 次战斗，重复度极高
- 没有稀有牌（`rare` 档一张都没有）

## 原版行为

**稀有度权重**（普通战）：

| 稀有度 | 基础权重 |
|---|---|
| common | 60% |
| uncommon | 37% |
| rare | 3% |

关键机制：

- **稀有度递增（rarity bump）**：每次拿到奖励后没出 rare，下次 rare 权重 +1%；
  出了 rare 则重置。精英战直接 +10%
- **三张不重复**：一次奖励里不会出现两张同名牌
- **类型平衡**：不做强制，但卡池本身的攻/技/能力比例决定了体感
- **Boss 战** 的奖励是「稀有度提升的 3 张 + 一定给 rare 的机会」
- **无色牌（colorless）** 独立池子，只从商店/事件出
- `Prayer Wheel` 遗物 → 普通战多给一张卡奖励
- `Question Card` 遗物 → 奖励从 3 张变 4 张
- `Busted Crown` 遗物 → 奖励从 3 张变 1 张（但拿 boss 遗物）
- **「不取」永远可选**，且原版有 `Singing Bowl` 遗物把「不取」换成 +2 最大生命

## 设计方案

### 卡池扩容

11 张牌撑不起来。目标：**每个武将 30-35 张专属牌 + 15 张通用牌**。
第一步先把关羽的卡池补到 24 张（现有 11 + 新增 13），分布：

| 稀有度 | 数量 | 说明 |
|---|---|---|
| basic | 3 | 初始牌，不进奖励池（劈砍/铁壁/拖刀计） |
| common | 10 | 主力，数值朴素 |
| uncommon | 8 | 有机制（条件触发、消耗、多段） |
| rare | 3 | 构筑核心（如「五关六将」：本场每杀死一个敌人永久 +2 神力） |

新卡建议靠 [13 关键词](13-card-keywords-done.md) 和 [12 状态库](12-status-library-done.md)
先落地，否则新卡只能是「数值不同的劈砍」。

### 权重与递增

```
普通战：common 60 / uncommon 37 / rare 3
精英战：common 50 / uncommon 37 / rare 13
Boss 战：common 40 / uncommon 40 / rare 20
未出 rare 时 rare 权重 +1（累积，出了就归零）
```

## 数据结构

```ts
// src/combat/cards.ts 增补

/** 按稀有度分组的可奖励卡池。basic 不进池。 */
export const CARD_POOL_BY_RARITY: Record<Exclude<CardRarity, 'basic'>, string[]>;

/** 无色/通用牌，只从商店和事件出。 */
export const COLORLESS_POOL: string[];
```

```ts
// src/combat/rewards.ts (新增)

export type RewardTier = 'monster' | 'elite' | 'boss';

export interface CardRewardOptions {
  tier: RewardTier;
  run: RunState;
  rng: Rng;
  /** 遗物可以改这个，默认 3。 */
  count?: number;
}

/** 抽 N 张互不相同的奖励卡（返回 defId）。 */
export function rollCardReward(opts: CardRewardOptions): string[];
```

```ts
// src/state/run.ts 增补
export interface RunState {
  // ...
  /** 稀有度递增计数，见「设计方案」。 */
  rareBump: number;
  /** 奖励卡数量修饰（遗物用）。默认 3。 */
  cardRewardCount: number;
}
```

## 实现步骤

1. `cards.ts`：删掉 `REWARD_POOL`，改成 `CARD_POOL_BY_RARITY`。
   同时给现有 8 张牌复核稀有度标注——「结营」（2 费 14 甲）标成 common
   偏强，「白马义从」（0 费 4 伤）标 common 合理。
2. `src/combat/rewards.ts`：`rollCardReward`：
   - 按 tier 取权重表，rare 权重加上 `run.rareBump`
   - 逐张抽（每张独立 roll 稀有度 → 再从该档抽 defId），
     已抽到的 defId 从候选剔除保证不重复
   - 若本次没出 rare → `run.rareBump += 1`；出了 → `= 0`
   - **该档池子被排干**（比如 rare 只有 3 张且都抽了）时降档兜底
3. `CombatScene.ts:1149-1198` 的结算屏改用 `rollCardReward`，
   卡片数量按 `run.cardRewardCount` 动态布局（1/3/4 张的横排间距不同）。
4. 新卡内容：13 张，落在 uncommon/rare 为主。写完后**必须**跑
   [25 无头模拟](25-headless-sim-and-tests-done.md) 看新卡有没有把 Boss 胜率
   拉过头（README 记录的基线是贪心 41% / 威胁感知 71%）。
5. 商店卡牌库存（[05 商店](05-shop.md)）走同一套 `rollCardReward`
   但 `tier: 'monster'` 且加入 `COLORLESS_POOL`，`count: 5`。
6. 遗物联动：做两件验证 `cardRewardCount` 通路的遗物
   （「求贤令」+1 张 / 「独断」-2 张但换 boss 遗物）。
7. **「不取」保留**（`CombatScene.ts:1191` 已有），另做一件遗物
   把「不取」变成 +2 最大体力。

## 验收标准

- 跑 1000 次普通战奖励，稀有度分布落在 60/37/3 附近（±3%）
- 精英战的 rare 出现率显著高于普通战
- 连续 20 次没出 rare 后，rare 权重明显上升（打印 `rareBump` 验证）
- 一次奖励里三张牌**永不重复**
- rare 池子被抽空时降档兜底，不返回 undefined、不崩
- 「求贤令」遗物下奖励变 4 张且布局不错位
- 同一 seed 下奖励卡完全可复现
- 卡池扩到 24 张后，Boss 胜率仍在 40-75% 区间（模拟验证）

## 依赖

- [01 遗物](01-relics-done.md)——`cardRewardCount` 的修饰来源
- [12 状态库](12-status-library-done.md) / [13 关键词](13-card-keywords-done.md)
  ——新卡的机制基础。**不做这两个的话，13 张新卡只能是数值变体，没意义**
- [25 无头模拟](25-headless-sim-and-tests-done.md)——扩池后的平衡验证
