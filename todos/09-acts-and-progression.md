# 09 · 多幕结构与推进

## 现状

只有一幕。`RunState.act`（`src/state/run.ts:8`）字段存在但**永远是 1**——
`startRun` 硬写 `act: 1`（`run.ts:28`），没有任何地方递增它。

`generateMap(seed)`（`src/map/generateMap.ts`）不接受幕参数，
`MAP` 常量（`src/config.ts`）里 `rows: 15` / `treasureRow: 8` / `restRow: 14`
对所有幕都一样。

`ENCOUNTERS`（`src/combat/enemies.ts:97-106`）只有一套表：4 个普通遭遇、
**1 个精英（华雄）、1 个 Boss（吕布）**。

README 明确写了：「One act, one hero. Beating 吕布 ends the map with nothing after it.」
打完吕布之后什么都没有——这是当前**跑团没有终点**的问题。

## 原版行为

四幕结构：

| 幕 | 层数 | Boss | 特点 |
|---|---|---|---|
| 1 Exordium | 15 | 三选一（Guardian / Hexaghost / Slime Boss） | 教学幕，敌人弱 |
| 2 City | 15 | 三选一（Champion / Automaton / Collector） | 精英显著变强 |
| 3 Beyond | 15 | 三选一（Awakened One / Time Eater / Donu&Deca） | 敌人有质变机制 |
| 4 Ending | 3 房间 | Corrupt Heart | 固定：精英 → 休息 → Boss，需要两把钥匙 |

推进细节：

- 幕 Boss **在地图顶部就显示是谁**，让玩家提前针对性构筑
- 击败幕 Boss → **Boss 宝箱：三件遗物选一**（Boss 档遗物，正负收益型）
- 幕间过场：显示「Act 2」标题卡 + 回复少量血 + 新地图
- 每幕的敌人/精英/事件/商店库存**各自独立的池子**
- 每幕的敌人 HP 和伤害整体上调，玩家构筑成长曲线要跟上
- 第四幕需要三把钥匙（Ruby 来自篝火 Recall、Emerald 来自击败超级精英、
  Sapphire 来自跳过一次 Boss 宝箱）——这是 Ascension 20 后的真终点

## 设计方案

三国叙事天然适合分幕。三幕 + 终章：

| 幕 | 名称 | 层数 | Boss 候选（三选一） | 敌人主题 |
|---|---|---|---|---|
| 一 | **讨黄巾** | 15 | 张梁 / 张宝 / 管亥 | 黄巾力士、山贼、乱民 |
| 二 | **战虎牢** | 15 | 吕布 / 华雄（升级版）/ 李儒 | 西凉铁骑、董卓亲兵、羌兵 |
| 三 | **征汉中** | 15 | 曹操 / 夏侯渊 / 张辽 | 虎豹骑、连弩兵、军师 |
| 终 | **五丈原** | 3 | 天命（真结局） | 固定精英 → 营帐 → Boss |

**注意这需要重新分配现有内容**：吕布现在是第一幕 Boss，按上表应该
下移到第二幕；华雄作为第一幕精英偏强（88-96 HP，15 伤巨斧），
考虑降到 70 HP 左右，或者把第一幕精英换成新做的敌人。
README 记的平衡数据（贪心 41% / 威胁感知 71% 打吕布）是拿**第一幕
末期的牌组**测的，如果吕布挪到第二幕，胜率会显著上升——需要重新跑
[25 无头模拟](25-headless-sim-and-tests-done.md)。

## 数据结构

```ts
// src/data/acts.ts (新增)

export interface ActDef {
  index: 1 | 2 | 3 | 4;
  name: string;             // '讨黄巾'
  subtitle: string;         // '中平元年 · 颍川'
  rows: number;             // 15，终章 3
  /** 固定房间层（0-indexed）。 */
  treasureRow: number | null;
  restRow: number | null;
  minAdvancedRow: number;
  /** 该幕的遭遇池。 */
  encounters: {
    /** 前 N 场用「弱」表，之后用「强」表——原版就是这么做的，避免开局挨打。 */
    weak: Encounter[];
    weakCount: number;
    strong: Encounter[];
    elite: Encounter[];
  };
  /** Boss 候选，进幕时随机三选一（玩家不选，是随机指定一个，但地图上提前显示）。 */
  bossPool: string[];
  /** 该幕的事件池 id。 */
  eventPool: string[];
  /** 幕间恢复。原版 Act1→2 不回血，Boss 宝箱前不回血。 */
  interActHeal: number;
  bgKey: string;            // 地图背景纹理
}

export const ACTS: Record<number, ActDef>;
```

```ts
// src/state/run.ts 增补
export interface RunState {
  // ...
  act: number;              // 已有，现在真的会变
  /** 本幕地图。换幕时整体替换。 */
  map: GameMap;
  /** 本幕的 Boss id，进幕时定下并在地图顶部显示。 */
  actBoss: string;
  /** 本幕已打过的普通战次数，用于 weak/strong 表切换。 */
  actCombatCount: number;
  /** 终章钥匙。 */
  keys: { ruby: boolean; emerald: boolean; sapphire: boolean };
}
```

## 实现步骤

1. `generateMap` 签名改成 `generateMap(seed: string, act: ActDef)`，
   把 `src/config.ts` 里 `MAP` 的 `rows / treasureRow / restRow / minAdvancedRow`
   改成从 `ActDef` 读。`MAP` 保留纯布局项（`colSpacing / jitterX / nodeRadius` 等）。
   - 每幕的 seed 要不同：`\`${runSeed}:act${n}\`` —— 否则三幕地图长得一样
   - 终章 3 房间是**固定结构**，不走随机生成，单独一个 `generateFinalAct()`
2. `src/data/acts.ts`：写三幕 + 终章的 `ActDef`。遭遇表从
   `src/combat/enemies.ts:97-106` 搬进来并按幕拆分。
   `ENCOUNTERS` 那个全局常量应当删除，避免两处真源。
3. **新敌人**：第二、三幕各需要 4-5 个普通敌人 + 2-3 个精英 + 3 个 Boss。
   这是本条目里最大的工作量，见 [15 敌人机制](15-enemy-mechanics-done.md)——
   建议先把机制做全，再批量填数据和美术。
4. Boss 预告：`MapScene` 顶部 Boss 节点旁显示 Boss 名字 + 立绘缩略
   （现在 `MapScene.ts:144` 已经识别 `isBoss` 做了特殊尺寸，在那里加）。
5. `CombatScene` 打完 Boss：
   - 不走普通结算屏（`CombatScene.ts:1149-1198`）
   - 走 **Boss 宝箱**：三件 boss 档遗物选一（见 [10 遗物奖励](10-relic-rewards-done.md)），
     另有「跳过换 Sapphire 钥匙」选项（终章需要）
   - 然后 `advanceAct(run)`
6. `advanceAct(run)`：`act += 1`、生成新地图、`actCombatCount = 0`、
   抽新 Boss、`heal(run, actDef.interActHeal)`、`currentNodeId = null`、
   `path = []`（新地图从头走）。
7. **幕间过场场景** `src/scenes/InterludeScene.ts`：黑底 + 竖排幕名 +
   副标题（「建安五年 · 官渡」），2.5 秒后淡入新地图。可点击跳过。
8. 终章：`act === 4` 时地图只有 3 个节点竖排，第一个精英战、
   第二个营帐、第三个真 Boss。缺钥匙时终章入口不可进（打完第三幕 Boss
   直接进胜利结算）。
9. 打完终章 Boss → [22 结算界面](22-run-summary.md) 的胜利分支。

## 验收标准

- 打完第一幕 Boss 后拿到 Boss 遗物三选一，然后进入第二幕过场和新地图
- 三幕地图布局互不相同（同一 runSeed 下也是），且各自可复现
- 第二幕的敌人明显比第一幕强（HP 和伤害），普通战前 2 场用 weak 表
- 地图顶部提前显示本幕 Boss 是谁
- 第三幕打完、钥匙齐 → 能进终章；钥匙不齐 → 直接胜利结算
- 终章是固定 3 房间，不是随机地图
- 跨幕后遗物/丹药/牌组/金币全部保留，体力按 `interActHeal` 变化
- `RunState.act` 真的会变，且 [08 存档](08-save-resume.md) 能跨幕恢复

## 依赖

- [15 敌人机制与敌人库](15-enemy-mechanics-done.md)——第二三幕的内容主体
- [10 遗物奖励](10-relic-rewards-done.md)——Boss 宝箱
- [22 结算界面](22-run-summary.md)——真结局
- [25 无头模拟](25-headless-sim-and-tests-done.md)——三幕难度曲线必须靠模拟标定，
  手调三幕的数值不可能对
