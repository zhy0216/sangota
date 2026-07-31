# 10 · 精英 · 宝箱 · Boss 遗物奖励

## 现状

奖励只有两种东西：**金币和卡**。

`CombatScene` 结算屏（`src/scenes/CombatScene.ts:1149-1198`）：
抽金币 → 显示「获得资财 N」→ 三张卡选一 → 「不取」跳过。
精英战和普通战**结算完全一样**，只有金币区间不同
（`src/combat/enemies.ts:104` 精英 28-42 vs 普通 10-22）。

宝箱房间（`src/scenes/MapScene.ts:336-341`）：

```ts
case 'treasure': {
  const gold = new Rng(`${this.run.map.seed}:${node.id}:loot`).range(25, 45);
  addGold(this.run, gold);
  ...
}
```

只给 25-45 金币。`MAP.treasureRow = 8`（`src/config.ts`）把第 9 层锁成
宝箱——那是原版专门用来给一件保底遗物的位置，现在给了一笔小钱，
浪费了一个结构性的奖励点。

## 原版行为

遗物的主要来源分布：

| 来源 | 内容 | 概率 |
|---|---|---|
| **精英战** | 必掉 1 件遗物（common 50% / uncommon 33% / rare 17%）+ 金币 + 选卡 | 100% |
| **宝箱房** | 必掉 1 件遗物（common 75% / uncommon 25% / rare 5%），另有 金币 50% / 药水 40% | 100% |
| **Boss 宝箱** | 3 件 boss 档遗物选 1（可跳过换 Sapphire 钥匙） | 100% |
| 事件 | 各种 | 视事件 |
| 商店 | 3 件（1 common / 1 uncommon / 1 shop 专属） | 购买 |

细节：

- 宝箱有三种尺寸（小/中/大），尺寸决定遗物稀有度权重和附赠内容概率
- 遗物**不重复**：已持有的从池子里排除；池子抽空了给金币兜底
- `Nloth's Gift` 类遗物会改变遗物掉落稀有度权重
- 精英战的选卡奖励**稀有度权重更高**（罕见/稀有出现率提升）
- Boss 遗物是**正负收益**设计（+1 能量但少抽一张），选择本身就是构筑决策

## 设计方案

三国题材宝箱叫**宝藏**，Boss 宝箱叫**战利品**。

按上表实现，权重按本项目的遗物池规模调整（初期遗物少，稀有档要留够）：

| 来源 | common | uncommon | rare | 附赠 |
|---|---|---|---|---|
| 精英战 | 50% | 33% | 17% | 金币 + 选卡（稀有度加权） |
| 宝藏（小 50%） | 75% | 25% | — | 金币 50%（15-25） |
| 宝藏（中 33%） | 60% | 35% | 5% | 金币 50%（25-45）+ 丹药 40% |
| 宝藏（大 17%） | 40% | 45% | 15% | 金币 50%（40-70）+ 丹药 60% |
| Boss | — | — | boss 档 ×3 选 1 | — |

**去重必须做**：`RELIC_POOL_BY_TIER` 抽取时过滤 `run.relics`。
池子空了退化为金币（原版就是这么兜的）。

## 数据结构

```ts
// src/combat/relics.ts 增补

export type RelicSource = 'elite' | 'chest' | 'boss' | 'shop' | 'event';

/** 各来源的稀有度权重。 */
export const RELIC_DROP_WEIGHTS: Record<string, Partial<Record<RelicTier, number>>>;

/** 从指定档位抽一件未持有的遗物。池子空返回 null。 */
export function rollRelic(
  rng: Rng,
  run: RunState,
  source: RelicSource,
  chestSize?: ChestSize,
): string | null;
```

```ts
// src/rooms/treasure.ts (新增)
export type ChestSize = 'small' | 'medium' | 'large';

export interface ChestLoot {
  size: ChestSize;
  relicId: string | null;
  gold: number;          // 0 表示没有
  potionId: string | null;
}

export function rollChest(run: RunState, nodeId: string): ChestLoot;
```

## 实现步骤

1. `rollRelic`：按 `RELIC_DROP_WEIGHTS[source]` 选档 → 该档池子过滤已持有
   → seeded 抽一件。所有随机走传入的 `Rng`，**不要在函数里 new**，
   否则调用点无法保证复现。
2. **宝藏房间**改成真界面：
   - `MapScene.enterRoom` 的 `case 'treasure'`（`MapScene.ts:336-341`）
     改成 `this.scene.start('Room', { node })`
   - 复用 [04](04-campfire-done.md) 的 `RoomScene`，画一个箱子（尺寸随
     `ChestSize` 变），点击 → 开箱动画（金光 + 尘埃，`src/ui/vfx.ts` 已有素材）
     → 逐项展示遗物/金币/丹药
   - 丹药槽满时给替换/放弃弹窗（同 [02](02-potions-done.md)）
3. **精英战结算**：`CombatScene` 结算屏在金币行下面插一行遗物展示。
   `nodeType === 'elite'` 时调 `rollRelic(rng, run, 'elite')`。
   遗物图标从中心放大出现 + 名字 + 说明，然后才展开选卡区。
4. **精英选卡加权**：`CombatScene.ts:1175` 附近生成三张奖励卡的地方，
   按 `nodeType` 用不同的稀有度权重表（见
   [11 稀有度](11-card-rarity-and-rewards-done.md)）。
5. **Boss 宝箱**：新场景或 `RoomScene` 的一个模式。
   - 三件 boss 遗物横排，各自图标 + 名字 + 完整说明（Boss 遗物有负收益，
     说明必须写全，别让玩家瞎选）
   - 「不取（换取宝钥）」选项 → `run.keys.sapphire = true`，见
     [09 多幕](09-acts-and-progression-done.md)
   - 选完 → 幕间过场
6. **Boss 档遗物内容**（至少 6 件，正负收益）：
   - 「赤兔马」+1 气，每回合少抽 1 张
   - 「方天画戟」每回合首张攻击伤害 ×2，最大体力 -10
   - 「传国玉玺」每场战斗第 3 回合起手牌 +2，起手时受 5 点伤害
   - 「督军令」全体伤害牌伤害 +4，护甲获取 -25%
   - 「铜雀台」每场战斗开始获得 2 层神力，抽牌堆混入 1 张「奢靡」诅咒
   - 「虎符」精英与 Boss 战伤害 +15%，普通战伤害 -15%
7. 所有遗物获得统一走 `addRelic(run, id)`，并在 HUD 遗物条上播「新增」动画。

## 验收标准

- 打精英战必掉一件遗物，稀有度分布大致符合 50/33/17（跑 200 次统计）
- 第 9 层宝藏必掉一件遗物，且有几率附赠金币/丹药
- 已持有的遗物不会再次掉落
- 遗物池抽空时退化为金币，不崩、不给 null
- 击败幕 Boss 出现三件 boss 遗物选一，说明文本完整含负收益
- 选「不取」拿到宝钥，且终章入口据此判定
- 同一 seed 下所有遗物掉落完全可复现（含宝箱尺寸和附赠内容）
- 精英战的三张奖励卡稀有度明显高于普通战（统计验证）

## 依赖

- [01 遗物](01-relics-done.md)——遗物系统本体
- [02 药水](02-potions-done.md)——宝箱附赠
- [04 营帐](04-campfire-done.md)——`RoomScene` 壳
- [11 稀有度](11-card-rarity-and-rewards-done.md)——精英选卡加权
- [09 多幕](09-acts-and-progression-done.md)——Boss 宝箱和宝钥的意义
