# 08 · 存档与继续

## 现状

完全没有持久化。跑团状态是模块级单例（`src/state/run.ts:20`）：

```ts
let active: RunState | null = null;
```

刷新页面 → `active` 变 null → `getRun()`（`run.ts:37-40`）直接
`startRun()` 开新局。`RunState.map` 里的 `nodes` 是一个
`Map<string, MapNode>`（`src/map/types.ts:40`），**不能直接 `JSON.stringify`**，
这是做存档时第一个会撞上的坑。

`TitleScene`（`src/scenes/TitleScene.ts:130,163`）只有「出征」一个按钮，
没有「继续」。

一局 15 层大约 40-60 分钟。没有存档意味着中途关标签页 = 白玩，
浏览器意外刷新 = 白玩。这是当前**最容易让人放弃**的缺口。

## 原版行为

- **每一步都自动存档**，粒度极细：进入房间、打出一张牌、敌人行动完、
  拿到奖励——全部即时落盘
- 战斗中途退出再进入，会**精确恢复到那一刻**：手牌、抽牌堆顺序、
  敌人 HP 和意图、护甲、状态层数、能量、已打出的牌
- 只允许**一个存档槽**，且不允许「读档重试」（存档在读取后立即推进），
  这是 roguelike 的核心约束：不能 save-scumming
- 跑团结束（胜/败）后存档删除，写入历史记录
- 存档内含种子，所以整局可复现

## 设计方案

**分两阶段做**，因为「战斗中存档」的成本远高于「房间边界存档」：

### 阶段一：房间边界存档（先做，价值 80%）

在每次「地图上移动到新节点前 / 房间结算后」存一次。战斗中途刷新
则回退到进入该战斗之前的地图状态。战斗本身是可重来的——这有轻微
save-scum 风险（战斗打崩了刷新重来），但成本极低、收益极大。

要防 save-scum 的话：进入战斗时就把「已进入节点」写进存档，
刷新后恢复到「战斗即将开始」并且**用同一个战斗 seed**
（`CombatScene` 现在的 seed 已经是 `${map.seed}:${nodeId}` 系的，
所以敌人 HP 和意图序列本来就固定），只有玩家的出牌决策能重来。

### 阶段二：战斗内存档（后做）

`CombatState` 里唯一不可序列化的是 `rng`（`src/combat/types.ts:132`）。
看 `src/core/rng.ts` —— mulberry32 的状态就是一个 32 位整数，
只要把它暴露出来（`rng.getState()` / `Rng.fromState(n)`）就能完整存取。
`events` 数组存档时应清空（已消费完）。

序列化格式必须**带版本号**，且加载时做迁移或拒绝：改了卡牌数值
之后旧存档会读出错误的游戏状态，静默继续比直接丢弃更糟。

## 数据结构

```ts
// src/state/save.ts (新增)

export const SAVE_VERSION = 1;
const SAVE_KEY = 'sangota.save.v1';

/** RunState 的可序列化镜像。Map 拍平成数组。 */
export interface SavedRun {
  version: number;
  savedAt: number;
  heroId: string;
  hp: number;
  maxHp: number;
  gold: number;
  act: number;
  /** 只存种子和「哪些节点访问过」——地图本身可以从种子重新生成。 */
  mapSeed: string;
  visitedNodeIds: string[];
  currentNodeId: string | null;
  path: string[];
  deck: { uid: string; defId: string; upgraded: number }[];
  relics: string[];
  relicCounters: Record<string, number>;
  potions: (string | null)[];
  potionSlots: number;
  potionChance: number;
  seenEvents: string[];
  eventAssignments: Record<string, string>;
  shopStock: Record<string, unknown>;
  cardRemovalSurcharge: number;
  liftCount: number;
  ascension: number;
  /** 阶段二：战斗中断点。null 表示当前在地图上。 */
  combat: SavedCombat | null;
}

export interface SavedCombat {
  encounterId: string;
  nodeType: 'monster' | 'elite' | 'boss';
  turn: number;
  energy: number;
  maxEnergy: number;
  rngState: number;
  player: Combatant;
  enemies: EnemyState[];      // intent 存 move id 即可
  cards: Record<string, { defId: string; upgraded: number }>;
  drawPile: string[];
  hand: string[];
  discardPile: string[];
  exhaustPile: string[];
}

export function save(run: RunState, combat?: CombatState): void;
export function load(): SavedRun | null;
export function clear(): void;
export function hasSave(): boolean;
```

**关键设计：地图不整存**。`generateMap(seed)`（`src/map/generateMap.ts`）
是确定性的，所以只存 `mapSeed` + `visitedNodeIds`，读档时重新生成再打
visited 标记。这样存档体积小、且天然不会因为 `MapNode` 加字段而失效。
前提是 `generateMap` **必须**对同一 seed 输出完全一致的结构——
README 说已经在 400 个 seed 上验证过，正好。

## 实现步骤

1. `src/core/rng.ts`：暴露内部状态。看现有实现（68 行）加两个方法：
   ```ts
   getState(): number
   static fromState(state: number): Rng
   ```
   顺便确认 `shuffle` / `weighted` / `range` 都只依赖那一个状态字。
2. `src/state/save.ts`：`toSaved(run, combat?)` / `fromSaved(saved)` 双向映射
   + `localStorage` 读写 + `try/catch`（隐私模式下 localStorage 会抛）。
3. `run.ts` 增加 `restoreRun(saved: SavedRun): RunState`，
   内部调 `generateMap(saved.mapSeed)` 再回填 visited。
4. **存档触发点**：
   - `MapScene.onNodeClick`（`MapScene.ts:305`）—— `travelTo` 之后
   - `RoomScene` 每个选项执行完
   - `CombatScene` 结算屏领完奖励、点「继续」回地图时
   - 阶段二：`CombatScene` 每次 `playCard` / `endTurn` / 敌人回合结束之后
   - 统一走一个 `autosave()`，内部做节流（同一帧多次调用只写一次）
5. `TitleScene`：`hasSave()` 时把「出征」上方插一个「继 续」按钮
   （更醒目，因为它是默认动作），下面小字显示「第 N 层 · 关羽 · HP 42/82」。
   点「出征」时若有存档，弹「放弃当前征程？」确认。
6. 跑团结束（[22 结算](22-run-summary.md)）时 `clear()`。
7. 版本不匹配时：不静默丢弃也不静默加载，在标题页显示
   「存档版本过旧（v1 → v2），无法继续」+ 一个「清除」按钮。

## 验收标准

- 地图上走 5 步后刷新页面，标题页出现「继续」，点进去回到第 5 步、
  HP/金币/牌组/遗物/丹药全对
- 读档后的地图**布局和原来完全一致**，走过的路径高亮正确
- 读档后进入战斗，敌人 HP 和意图序列与存档前一致（seed 复现）
- 阶段二：战斗第 3 回合刷新，恢复后手牌、抽牌堆顺序、敌人状态、
  能量、护甲、状态层数全部一致
- 跑团结束后存档被清除，标题页不再显示「继续」
- localStorage 被禁用时游戏仍能正常玩（只是没存档），不崩
- 手改存档版本号后，标题页给出明确提示而不是崩溃或静默开新局

## 依赖

- 结构上依赖 [03 升级](03-card-upgrades-done.md)（`DeckCard`）、
  [01 遗物](01-relics-done.md)、[02 药水](02-potions.md)、[06 事件](06-events.md)
  ——它们都往 `RunState` 加字段。**建议在这些做完后再做存档**，
  否则字段每加一次就要动一次 `SavedRun` 和版本号。
- [22 结算界面](22-run-summary.md)——存档清除的时机
