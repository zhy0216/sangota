# 18 · 开局祝福

## 现状

完全没有。`TitleScene`（`src/scenes/TitleScene.ts:163`）点「出征」直接
`startRun(DEFAULT_HERO)` 然后进地图。

每一局的起点**完全一样**：关羽、82 HP、99 金、固定的 10 张初始牌
（`src/data/heroes.ts:35-39`：5 张劈砍、4 张铁壁、1 张拖刀计）。

后果是前 3 层的决策空间极小——同一个武将玩 10 局，开局体验一模一样。

## 原版行为

Neow（鲸鱼）在跑团开始时给**四选一**，是原版每局最早的构筑分歧点。

选项池分四类，每类抽一个：

**第一类 · 小收益**
- +8 最大生命
- 获得 100 金
- 移除一张牌
- 转化一张牌（换成同稀有度的随机牌）
- 获得 3 瓶随机药水

**第二类 · 中收益**
- 移除两张牌
- 获得一张随机稀有牌
- 获得一件随机普通遗物
- 转化两张牌
- 升级一张牌

**第三类 · 有代价的大收益**（代价随机配）
- 获得一件随机罕见遗物，代价：失去 10% 最大生命
- 获得三张随机稀有牌，代价：拿一张诅咒
- 获得一件 boss 遗物，代价：金币归零
- 获得 250 金，代价：失去 10% 最大生命

**第四类 · 特殊**
- 「无所求」→ 获得一件独特遗物（Boss 级）
- 前一局的表现会影响某些选项（连败后给补偿）

设计意图明确：**在第一场战斗之前就让玩家做一个有分量的构筑决策**，
每局的走向从第 0 层就开始分叉。

## 设计方案

三国题材：**「拜别 · 出征前夜」**——一位云游道人（或司马徽/左慈）在
出征前给一个选择。视觉上一个静态场景，人物立绘 + 四个选项。

四类各抽一个（和原版一样，保证四选一里有低风险和高风险的组合）：

**第一类 · 薄礼**
| 选项 | 效果 |
|---|---|
| 「养精」 | +8 最大体力 |
| 「资粮」 | +100 资财 |
| 「弃芜」 | 从初始牌组移除一张牌 |
| 「易牌」 | 转化一张牌（换成同稀有度随机牌） |
| 「携药」 | 获得 3 瓶随机丹药 |

**第二类 · 厚赠**
| 选项 | 效果 |
|---|---|
| 「精简」 | 移除两张牌 |
| 「秘传」 | 获得一张随机稀有牌 |
| 「赠宝」 | 获得一件随机普通宝物 |
| 「锻炼」 | 精进一张牌 |
| 「换血」 | 转化两张牌 |

**第三类 · 交易**（收益 + 代价随机配对）
| 收益 | 可能的代价 |
|---|---|
| 一件罕见宝物 | 失去 10% 最大体力 |
| 三张随机稀有牌 | 获得一张诅咒 |
| 一件 Boss 宝物 | 资财归零 |
| +250 资财 | 失去 10% 最大体力 |
| +20 最大体力 | 获得一张诅咒 |

**第四类 · 无所求**
| 选项 | 效果 |
|---|---|
| 「不受」 | 获得独特宝物「布衣」：本局所有战斗资财 +25%，但不能购买宝物 |

## 数据结构

复用 [06 事件](06-events-done.md) 的 `EventOutcome`——开局祝福**本质上就是一个
特殊事件**，不该再造一套结果系统。

```ts
// src/rooms/blessing.ts (新增)

export type BlessingCategory = 'minor' | 'major' | 'trade' | 'refuse';

export interface BlessingOption {
  id: string;
  category: BlessingCategory;
  label: string;
  /** 收益描述。 */
  desc: string;
  /** 代价描述，null 表示无代价。显示为红色小字。 */
  cost: string | null;
  /** 复用事件的结果系统。 */
  outcome: EventOutcome;
}

/** 四类各抽一个，trade 类的收益和代价随机配。 */
export function rollBlessings(rng: Rng): BlessingOption[];
```

需要给 `EventOutcome`（[06](06-events-done.md)）补两个字段：

```ts
export interface EventOutcome {
  // ...
  /** 转化牌：移除 N 张并换成同稀有度随机牌。 */
  transformCards?: number;
  /** 资财归零。 */
  goldToZero?: boolean;
}
```

## 实现步骤

1. `src/rooms/blessing.ts`：写选项池 + `rollBlessings(rng)`。
   - `rng` 用 `new Rng(\`${runSeed}:blessing\`)`，保证同 seed 同选项
   - trade 类的配对也走同一个 rng
2. 场景 `src/scenes/BlessingScene.ts`（或复用 [04](04-campfire-done.md) 的 `RoomScene`
   加一个 `blessing` 模式）：
   - 背景：夜色下的营地/山道（`genmedia` 生成一张）
   - 左侧道人立绘 + 一句台词（「将军此去，可有所求？」）
   - 右侧四个选项竖排，每个：标题 + 收益描述 + 红色代价描述
   - 选中 → 二次确认（这是不可逆的重要决策，原版也有确认）
   - 执行 → 展示实际结果 → 进地图
3. 需要选牌的选项（弃芜/精简/锻炼/易牌）跳
   [07 牌堆查看器](07-deck-viewer-done.md) 的 pick 模式，作用于 `run.deck`
   （此时是初始 10 张）。
4. `transformCards` 实现：移除选中的牌 → 从**同稀有度**池
   （[11](11-card-rarity-and-rewards-done.md) 的 `CARD_POOL_BY_RARITY`）
   抽一张不同的牌加入。原版转化会跳过同名牌，照做。
5. 流程接线：`TitleScene`「出征」（`TitleScene.ts:130`）→
   `HeroSelectScene`（若 [17](17-multiple-heroes.md) 已做）→
   `BlessingScene` → `MapScene`。
6. **祝福必须在存档之前完成**：[08 存档](08-save-resume-done.md) 的第一次
   autosave 应该在祝福选完之后，否则读档会重新弹祝福（或者要在
   `SavedRun` 里记 `blessingTaken: boolean`）。
7. 「布衣」这件独特宝物需要遗物系统支持「禁止购买宝物」——
   商店（[05](05-shop-done.md)）要检查这个标志并把遗物区整体灰掉。

## 验收标准

- 开新局时出现四选一，四个选项分别来自四个类别
- 同一 seed 下四个选项和 trade 类的配对完全一致
- 「+8 最大体力」选完后 HP 变 90/90（不只是上限变、当前也满）
- 「移除两张牌」能从初始 10 张里移除指定的两张，牌组变 8 张
- 「精进一张牌」的选牌界面显示升级前后数值
- 「易牌」转化出的牌与被转化的牌不同名，且稀有度相同
- 「一件 Boss 宝物 + 资财归零」执行后金币是 0 且拿到 boss 档遗物
- 「不受」选项拿到「布衣」，之后商店的宝物区不可购买且有原因提示
- 二次确认可以取消并重选
- 选完后不能返回重选
- 读档后不会重复弹祝福

## 依赖

- [06 事件](06-events-done.md)——**强依赖**，复用 `EventOutcome` 和 `applyOutcome`
- [07 牌堆查看器](07-deck-viewer-done.md)——选牌类选项
- [01 遗物](01-relics-done.md) / [02 药水](02-potions-done.md) / [03 升级](03-card-upgrades-done.md)
  / [11 稀有度](11-card-rarity-and-rewards-done.md) / [14 诅咒](14-curses-and-status-cards-done.md)
  ——各类选项的内容来源
- 顺序上应在 [08 存档](08-save-resume-done.md) 之前，或同时处理 `blessingTaken` 标志

---

## 阶段五归档 · 一条验收被 08 卡住

十一条验收里十条已核实通过，`tests/blessing.test.ts` 逐条覆盖。
第十一条「读档后不会重复弹祝福」无从验证——[08 存档](08-save-resume-done.md)
不存在。`run.blessing.takenId` 就是那个标志（`blessingTaken(run)` 读它，
`blessingSettled(run)` 是「已选完且没有欠着的选牌」那道门），
存档层**不需要新增任何字段**，只要把 `run.blessing` 一并存下来。
08 落地时回来补这一条。

> **08 已回来补掉（阶段六）。** 预判成立：`SavedRun` 由
> `Omit<RunState, …>` 推导，`blessing` 整个随存随取，没有新增字段。
> 「读档后不重复弹祝福」由两半保证：第一次 `writeSave` 就在
> `BlessingScene.leave()` 里、门是 `blessingSettled`（没选完根本没有档可读），
> 而 `TitleScene.continueRun` 直接进 `Map` 或 `Combat`、永不进 `Blessing`。
> 两半都有源码文本测试：`tests/save.test.ts` 的「writes the run for the
> first time only once 拜别 is settled」与「offers 继续 from the title」。
