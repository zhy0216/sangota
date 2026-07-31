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
  [01 遗物](01-relics-done.md)、[02 药水](02-potions-done.md)、[06 事件](06-events-done.md)
  ——它们都往 `RunState` 加字段。**建议在这些做完后再做存档**，
  否则字段每加一次就要动一次 `SavedRun` 和版本号。
- [22 结算界面](22-run-summary.md)——存档清除的时机

---

## 阶段六归档 · 全部验收达成，两处与草案有意分歧

七条验收逐条核实：

1. **走五步刷新后「继续」回到第 5 步，四类资产全对** —— `tests/save.test.ts`
   「round trip」用 `toEqual` 整轮对比（`playedRun` 正是走五步 + 触碰每一组字段），
   浏览器端到端也走过：祝福 → 地图 → 战斗 → 战罢 → 领奖 → 回地图，每一站刷新过。
2. **地图布局与原来完全一致、路径高亮正确** —— 地图不整存，只存 `mapSeed`，
   读档按 `run.act` 重新生成（S1）；`path` 回放即是重画 `visited`。
   「regrows the map from the seed rather than storing it」逐节点坐标比对。
3. **读档后进战斗，敌人 HP 与意图序列一致** —— 战斗 seed 是
   `streamSeed(run, nodeId, 'combat')`，encounter 冻结在节点台账上（R5）。
4. **阶段二：战斗第 N 回合刷新精确恢复** —— `snapshotCombat` / `restoreCombat`，
   RNG 游标一个 32 位字（`rngState`）。单测「comes back identical at turn 3」逐字段比对，
   「resolves the *same* future」再往后打四回合验证未来也一致；
   浏览器实测第 2 回合快照与活状态逐字节相同（含手牌顺序与 `rngState`）。
5. **跑团结束存档清除** —— 兵败在 `showDefeat` 里清（关标签页也算输），
   凯旋在 `InterludeScene` 判 `victory` 的同一拍清。
6. **localStorage 禁用不崩** —— `store()` 每次现取现包 try/catch；
   单测覆盖「不存在」与「每次调用都抛」两种敌意环境。
7. **手改版本号给明确提示** —— 标题页「存档版本不符（v99 → v1），无法继续」
   + 「清除存档」按钮，浏览器验证过；解析失败/缺版本号走「已损坏」同款布局。

**与草案的分歧，都记在 `src/state/save.ts` 门口的四条规则里：**

- **`savedAt` 没有做。** 约定 2 全项目禁 `Date.now()`（`tests/integrity.test.ts`
  「keeps the clock out of every file」），带时间戳的存档字段无法实现（S3）。
  节流改为按 payload 去重（`lastWritten`），比按时间更准。
- **战斗中「每次出牌都存」升级为「每次静止点都存」**，且静止的定义收过一次：
  开场五张 `draw` 事件还没播完时快照**必须**能打（否则战斗开场态永远存不下来，
  读档会落回已 visited 的节点、整场仗被跳过），唯一的例外是 `steal` ——
  约定 8 下引擎不碰 `RunState`，没播完的夺财钱还在钱袋里，快照过去等于退款。
  见 `RUN_SIDE_EVENTS` 与「is quiescent with a presentation backlog」。

**防 save-scum 落在设计方案预判的那条线上**：读档回到同一 `rngState`，
洗牌、意图、掉落全是玩家已经承诺过的那一串；胜利屏若在领奖前刷新，
战利品从冻结流重放出同一份（R5），既不重付也不丢失。

**`SavedRun` 由 `Omit<RunState, …>` 推导**——给 `RunState` 加字段而忘了存，
是 `toSaved` 里的编译错误，不是三周后的坏档。派生字段（`potionSlots` /
`cardRewardCount`）不存、重算（S2）；`nextUid` 游标随档存取
（`uidCursor` / `adoptRun`），否则读档后新铸的 `d0` 会和牌组里那张撞 uid。
