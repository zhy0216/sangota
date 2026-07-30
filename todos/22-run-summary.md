# 22 · 结算界面与评分统计

## 现状

**死亡**：`CombatScene` 在 `phase === 'lost'` 分支（`CombatScene.ts:1140`）
最终 `this.scene.start('Title')`（`CombatScene.ts:1227`）——直接回标题页。
没有任何总结：不知道死在第几层、死于什么、牌组长什么样、拿了哪些遗物。

**胜利**：README 写了「Beating 吕布 ends the map with nothing after it」——
打完 Boss 回地图，Boss 节点没有 children（`availableNodes`，
`src/state/run.ts:49-52` 返回空数组），所以**卡在地图上无路可走**。
这是当前唯一的硬性流程断点。

`isRunOver`（`run.ts:83`）只是 `run.hp <= 0` 的判断，没有被用在任何
「跑团结束」的处理上。

没有任何跨局的统计或历史记录。

## 原版行为

**死亡/胜利界面**同一套布局：

- 顶部：胜利/失败标题 + 「死于 XXX（第 N 层）」
- **分数明细**逐行展开，每行一个来源和分值：
  | 项 | 分值 |
  |---|---|
  | Floors Climbed | 每层 1 分 |
  | Enemies Slain | 每个 2 分 |
  | Elites Slain | 每个 10 分（按幕加权） |
  | Bosses Slain | 每个 50 分 |
  | Champion（无伤精英） | 25 分 |
  | Perfect（无伤 Boss） | 50 分 |
  | Collector（同名牌 4 张） | 25 分 |
  | Deck Size（大/小牌组） | 各有奖励 |
  | Highlander（无重复牌） | 100 分 |
  | Speedster（快速通关） | 25 分 |
  | Pauper（0 遗物） / Curses（3+ 诅咒） | 各有奖励 |
  | Ascension 加成 | 按级数百分比 |
- 中部：**最终牌组**全部展开可看
- 右侧：**获得的所有遗物**
- 底部：本局用时、总分、是否新纪录

**历史记录**：每局存一条，可回看，含时间、角色、层数、分数、
死因、牌组、遗物、路线图。

**累计统计**：总游戏时长、总局数、各角色通关次数、
最爱的卡/遗物、最常死于哪个敌人、最高分。

原版这套东西的作用是**给失败一个交代**。roguelike 每局必输，
输了以后有一个「这局我做到了什么」的总结，是继续玩下一局的动力来源。

## 设计方案

三国题材：**「史笔」**——结算界面做成史书/战报的样式
（竖排标题 + 分行记事，很契合现有的水墨风）。

### 分数项（本项目版）

| 项 | 中文 | 分值 |
|---|---|---|
| 层数 | 登临 | 每层 1 |
| 击杀 | 斩获 | 每个 2 |
| 精英 | 破锐 | 每个 10 |
| Boss | 定鼎 | 每个 50 |
| 无伤精英 | 全甲 | 25 |
| 无伤 Boss | 秋毫无犯 | 50 |
| 同名牌 4 张 | 专精 | 25 |
| 无重复牌 | 博采 | 100 |
| 牌组 ≤ 15 张通关 | 精兵 | 30 |
| 牌组 ≥ 40 张通关 | 众志 | 30 |
| 0 宝物通关 | 布衣 | 60 |
| 3+ 诅咒通关 | 负重 | 40 |
| 天命加成 | 天命 | 总分 × (1 + 0.05 × 天命级数) |

### 需要在跑团中收集的统计

现在 `RunState` 里**什么统计都没有**，得先埋点。

## 数据结构

```ts
// src/state/run.ts 增补
export interface RunStats {
  startedAt: number;
  floorsClimbed: number;
  enemiesSlain: number;
  elitesSlain: number;
  bossesSlain: number;
  /** 无伤完成的精英/Boss 战次数。 */
  flawlessElites: number;
  flawlessBosses: number;
  goldEarned: number;
  goldSpent: number;
  damageTaken: number;
  damageDealt: number;
  cardsPlayed: number;
  potionsUsed: number;
  maxHpAtEnd: number;
  /** 每层进入的房间类型，用于结算界面画路线。 */
  route: { act: number; row: number; type: RoomType }[];
}

export interface RunState {
  // ...
  stats: RunStats;
}
```

```ts
// src/state/history.ts (新增)

export interface RunRecord {
  id: string;
  endedAt: number;
  durationMs: number;
  heroId: string;
  ascension: number;
  victory: boolean;
  /** 死因：敌人名，或 'event' / null（胜利）。 */
  killedBy: string | null;
  floor: number;
  act: number;
  score: number;
  scoreBreakdown: { label: string; value: number }[];
  deck: { defId: string; upgraded: number }[];
  relics: string[];
  stats: RunStats;
}

export interface Career {
  version: number;
  records: RunRecord[];        // 最近 50 局
  totals: {
    runs: number;
    victories: number;
    totalPlayMs: number;
    highScore: Record<string, number>;   // heroId → 最高分
    deathsBy: Record<string, number>;    // 敌人名 → 次数
    cardsTaken: Record<string, number>;  // 用于「最爱的卡」
    relicsTaken: Record<string, number>;
  };
}

export function recordRun(rec: RunRecord): void;
export function getCareer(): Career;
export function computeScore(run: RunState, victory: boolean): {
  total: number;
  breakdown: { label: string; value: number }[];
};
```

## 实现步骤

1. `RunStats` 埋点。散布在各处，一个都不能漏：
   - `travelTo`（`src/state/run.ts:54`）：`floorsClimbed`、`route`
   - `engine.ts` 的 `applyDamage`（`engine.ts:297`）：
     `damageTaken` / `damageDealt`（按 target 是不是 player 分）
   - `checkEnd`（`engine.ts:335`）敌人死亡时：`enemiesSlain`
   - `CombatScene` 结算：`elitesSlain` / `bossesSlain`、
     无伤判定（用「本场 `damageTaken` 增量是否为 0」）
   - `addGold`（`run.ts:70`）：正数累计 `goldEarned`，负数累计 `goldSpent`
   - `playCard`（`engine.ts:217`）：`cardsPlayed`
   - `usePotion`（[02 药水](02-potions.md)）：`potionsUsed`
   - 引擎里的统计要**通过 `CombatEvent` 回传**，不要让引擎直接写
     `RunState`（会破坏它的纯函数性质，也会破坏无头模拟）
2. **死亡流程**：`CombatScene.ts:1140` 的 `lost` 分支改成
   `scene.start('Summary', { victory: false, killedBy: <最后行动的敌人名> })`。
   死于事件（[06 事件](06-events.md)）也走这里，`killedBy: 'event'`。
3. **胜利流程**：打完最后一个 Boss（`act === 3` 无终章，或 `act === 4` 终章）
   → `scene.start('Summary', { victory: true })`。这修掉当前那个
   「打完吕布卡在地图上」的断点。
4. `src/scenes/SummaryScene.ts`：
   - 竖排毛笔大字「功成」/「殁」
   - 一行「第 N 层 · 殁于 华雄」
   - 分数明细**逐行淡入**（每行 120ms 错开，最后总分放大弹出）——
     这是原版的一个小仪式感，值得照做
   - 左侧最终牌组（[07 牌堆查看器](07-deck-viewer-done.md) 的网格，缩小内嵌）
   - 右侧宝物列表
   - 底部：本局用时、总分、「新纪录」标记（若破了 `highScore`）
   - 「重开」/「回标题」两个按钮
5. `computeScore`：按上表算。`Highlander`（无重复牌）判定要看
   `defId` 去重后长度 === 牌组长度。天命加成最后乘。
6. `src/state/history.ts`：`Career` 存 localStorage（键与
   [08 存档](08-save-resume.md) 和 [19 天命进度](19-ascension.md) 分开）。
   `records` 只留最近 50 条，避免 localStorage 撑爆
   （localStorage 通常 5MB，一条记录含牌组约 1-2KB，50 条很安全）。
7. `recordRun` 时同步：
   - `Career.totals` 累计
   - [19 天命](19-ascension.md) 的 `cleared[heroId]`（胜利时）
   - [23 解锁](23-compendium-and-unlocks.md) 的解锁检查
   - [08 存档](08-save-resume.md) 的 `clear()`
8. **历史记录界面**：标题页加「战史」入口，列出最近 50 局
   （时间/武将/天命/层数/分数/死因），点一条展开完整 `RunRecord`
   （牌组、遗物、路线）。放在 [23 图鉴](23-compendium-and-unlocks.md) 里一起做也行。

## 验收标准

- 死亡后进入结算界面，显示正确的层数和死因（敌人名）
- 打完最终 Boss 进入胜利结算，**不再卡在地图上**
- 分数明细每一项数值正确（手动构造一局验算：登临 15 层 = 15 分，
  斩 20 个 = 40 分，1 精英 = 10 分，1 Boss = 50 分，共 115 分）
- 天命五重下总分是基础分 × 1.25
- 无伤打完精英加 25 分（打的时候被打了 1 点血就不加）
- 「无重复牌」在牌组全不同名时加 100 分
- 最终牌组和遗物在结算界面完整可见，升级过的牌显示「·精」
- 破纪录时显示「新纪录」标记
- 战史里能看到最近的局，含牌组和路线
- 累计统计（总局数、通关数、总时长、最常死于谁）正确累加
- 跑团结束后 [08 存档](08-save-resume.md) 被清除，标题页不再有「继续」
- 事件致死也能正确进入结算界面

## 依赖

- [09 多幕](09-acts-and-progression.md)——胜利条件的定义（打完第三幕还是终章）
- [07 牌堆查看器](07-deck-viewer-done.md)——牌组展示
- [08 存档](08-save-resume.md)——结算时清档
- [19 天命](19-ascension.md)——分数加成和通关记录
- 埋点会碰到 02 / 06 的代码，建议在它们之后做
