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

---

## 实现记录

`REWARD_POOL` 已删除，换成 `cards.ts` 的 `CARD_POOL_BY_RARITY`（10/8/3）与新的
`src/combat/rewards.ts`（`rollCardReward` + 权重表 + `rareBump` 递增）。
13 张新卡落在 `cards.ts` 的 HERO_CARDS 里，跑池由稀有度键结构性排除 basic。

规格外的几个决定：

- **降档兜底先向下再向上**。某档抽干时先往低稀有度找，找不到才往高处找——
  反过来会让「普通牌抽光」变成「开始发稀有牌」，那是奖励变好而不是兜底。
- **递增按「次奖励」而不是「张」**。三张全 common 记 1 次干旱，不是 3 次，
  否则 `rareBump` 会在一幕之内跑赢权重表本身。
- **新增 `slayer`（斩将）状态**，挂在 `StatusDef.onEnemyKilled` 上，由
  `resolveDamage` 里既有的击杀点触发（和 `enemyKilled` 遗物钩子同一时刻）。
  玩家侧作用域：击杀是「战场发生的事」，不是某个单位的事。
- **`previewValues` 修了一个真 bug**。`playCard` 先把牌移出手牌再结算，所以
  `handEmpty` 的含义是「打完这张后手牌是否为空」；预览却按打出前的手牌算，
  单刀赴会因此卡面写 6、实际打 12。现在 `conditionMet` 收一个 `handSize`
  参数，`applyEffect` 用默认值（结算时的手牌），`previewValues` 传少一张。
  `tests/cardFaces.test.ts` 就是抓到这个的地方。
- **`tests/cardFaces.test.ts` 的两个 helper 之前只看顶层 effects**，
  嵌在 `conditional` / `scaleWithEnergy` 里的伤害一律当成 0，等于不检查；
  且没有乘 `T`。两处都已修正，敌人血量在测试台上拉满以免中途死亡干扰。
- **三件遗物验证通路**：求贤令 +1 张、独断 -2 张（boss 档）、歌钵让「不取」
  给 +2 最大体力。`cardRewardCount` 钳在 1，永远留得下一张可选。
- **奖励行按自身宽度居中**，1 / 3 / 4 张都不偏。

## 平衡结论（**未达标，未私自调数值**）

`npm run sim` 新增第三个牌组档位 `act-1 rolled`——用 `rollCardReward` 真发六次
奖励随机选一张，而不是写死卡表。写死的 `act-1` 保留为对照组。

| 牌组 | random | greedy | threat |
|---|---|---|---|
| act-1（对照，扩池前后逐位相同） | 49% | 53% | 62% |
| act-1 rolled（新池） | 49% | 71% | **78%** |

**78% 超出本文件自己定的 40-75% 区间 3 个点。** 对照组一位不差，说明漂移来自
新卡而不是规则改动。逐卡扫描（对照牌组 + 2 张，吕布 500 场）定位到两张：

| 卡 | greedy | Δ | threat | Δ |
|---|---|---|---|---|
| 土山约三事 | 95% | +42 | 95% | +27 |
| 斩颜良 | 90% | +38 | 90% | +21 |
| 其余 11 张 | ≤59% | ≤+6 | ≤67% | ≤−1 |

两张都是「把气还回来」的牌：土山约三事 0 气换 +2 气 +2 张，同时正卡差正节奏、
还能抽到自己；斩颜良对带破绽的目标退费，而这套牌破绽几乎常驻。
**数值一律未动**，按要求把结论和数字留在这里。真要修的话，最小改动是
土山约三事改为 +1 气、斩颜良的退费加一个「本回合仅一次」的限制。

## 仍未做

- **商店库存**（步骤 5）：`rollCardReward` 已经可以带 `tier: 'monster'` +
  `count: 5` 复用，但 `COLORLESS_POOL` 目前是空的，等 [05 商店](05-shop.md)。
- **无色牌本身**：池子留了口子，一张都还没写。
- **Boss 奖励「一定给 rare 的机会」**：现在只是权重更高（40/40/20），
  没有做保底。
- **发放这三件新遗物的渠道**：属 [10 遗物奖励](10-relic-rewards.md) / [05](05-shop.md)。
