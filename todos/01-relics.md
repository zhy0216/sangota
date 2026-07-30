# 01 · 遗物系统（宝物）

## 现状

完全没有。`RunState`（`src/state/run.ts:5-18`）只有 `hero / hp / maxHp / gold / act /
map / deck / currentNodeId / path`，没有任何被动物品的容器；`CombatState`
（`src/combat/types.ts:118-134`）也没有任何「局外来源的修饰」入口。

战斗引擎里所有数值都是硬编码常量：`BASE_ENERGY = 3`、`HAND_SIZE = 5`、
`PASSIVE_ATTACK_BONUS = 3`（`src/combat/engine.ts:21-25`）。武将被动是写死的
`state.firstAttackUsed` 分支（`engine.ts:230-235`）。也就是说目前连「一个能改能量上限的
东西」都没有挂载点。

## 原版行为

约 180 件遗物，分 starter / common / uncommon / rare / boss / shop / event 七类。
关键设计点：

- **永久被动**，不占手牌不消耗，获得后整局生效
- 挂载在大量不同时机上：战斗开始、回合开始、回合结束、打出第 N 张牌、
  受到攻击、失去生命、拿到金币、进入房间、休息时、洗牌时、拾取药水时……
- 有**计数型**（如「每打出 3 张攻击牌触发一次」）和**一次性**（如「本场战斗首次…」）
- 有**负收益换正收益**的 boss 遗物（+1 能量但每回合少抽 1 张）
- 遗物条常驻在 HUD 顶部，鼠标悬停出说明，触发时图标会闪一下

遗物是原版最大的构筑变量：同样的牌组，配不同遗物玩法完全不同。

## 设计方案

三国题材下叫**宝物**，来源分四档：

| 档位 | 来源 | 数量目标 | 例子 |
|---|---|---|---|
| 初始 | 武将自带 1 件 | = 武将数 | 关羽「青龙偃月刀」：每回合首次攻击 +3（把现有硬编码被动搬进来） |
| 普通 | 精英战、宝箱、事件 | 20+ | 「束发金冠」：战斗开始获得 3 护甲 |
| 稀有 | 宝箱、事件 | 10+ | 「传国玉玺」：每场战斗第 3 回合起手牌 +1 |
| Boss | 击败幕 Boss，三选一 | 6+ | 「赤兔马」：+1 气，但每回合少抽 1 张 |
| 商店 | 商店专属 | 8+ | 「商队通牒」：进入商店时打八折 |

**核心是钩子（hook）机制**，不要给每件遗物写 if-else。定义一组明确的触发点，
遗物注册回调，引擎在对应时机遍历触发。这样新增遗物是纯数据工作。

关羽的被动必须借这次重构搬进遗物系统，否则会留下两套并行的被动逻辑。

## 数据结构

```ts
// src/combat/relics.ts (新增)

export type RelicTier = 'starter' | 'common' | 'uncommon' | 'rare' | 'boss' | 'shop';

/** 引擎会触发的时机。新增钩子必须同步在 engine 里埋点。 */
export type RelicHook =
  | 'combatStart'      // 战斗开始（抽首手前）
  | 'turnStart'        // 我方回合开始（回能量、清护甲之后，抽牌之前）
  | 'turnEnd'          // 我方回合结束（弃手牌之前）
  | 'enemyTurnEnd'     // 敌方回合结束
  | 'cardPlayed'       // 打出任意牌（结算完效果之后）
  | 'attackPlayed'     // 打出攻击牌
  | 'damageTaken'      // 我方掉血（穿透护甲之后）
  | 'blockGained'      // 我方获得护甲
  | 'enemyKilled'      // 任意敌人死亡
  | 'shuffle'          // 抽牌堆重洗
  | 'combatEnd';       // 战斗结束（结算奖励之前）

export interface RelicContext {
  state: CombatState;
  run: RunState;
  /** 触发源的附加信息，按钩子约定。cardPlayed 给 CardDef，damageTaken 给数值。 */
  payload?: unknown;
  /** 该遗物自己的持久计数器，跨回合但不跨战斗。 */
  counter: { value: number };
}

export interface RelicDef {
  id: string;
  name: string;
  tier: RelicTier;
  /** 图标纹理 key。 */
  art: string;
  /** 说明文本，支持 {N} 占位替换自身参数。 */
  text: string;
  /** 局外静态修饰：直接改跑团/战斗初始值，不需要钩子。 */
  modifiers?: {
    maxHp?: number;
    energy?: number;
    handSize?: number;
    startingBlock?: number;
    goldMultiplier?: number;
  };
  /** 动态钩子。同一遗物可挂多个。 */
  hooks?: Partial<Record<RelicHook, (ctx: RelicContext) => void>>;
}
```

```ts
// src/state/run.ts 增补
export interface RunState {
  // ...现有字段
  /** 遗物 id，按获得顺序（HUD 就按这个顺序排）。 */
  relics: string[];
  /** 跨战斗持久的遗物计数器，key 是 relic id。 */
  relicCounters: Record<string, number>;
}
```

```ts
// src/combat/types.ts 增补
export interface CombatState {
  // ...现有字段
  /** 本场战斗内的遗物计数器，战斗开始时重置。 */
  relicCounters: Record<string, number>;
  /** 遗物触发要发事件，让场景闪一下图标。 */
  // CombatEvent 增加：
  // | { t: 'relic'; relicId: string }
}
```

## 实现步骤

1. `src/combat/relics.ts`：写 `RELICS: Record<string, RelicDef>`，先只做 6 件覆盖全部
   钩子类型（静态修饰 1 件、turnStart 1 件、cardPlayed 计数型 1 件、damageTaken 1 件、
   combatStart 1 件、boss 正负收益 1 件）。
2. `src/combat/engine.ts`：
   - `StartCombatOptions` 增加 `relics: string[]`
   - 新增 `fireHook(state, hook, payload?)`，遍历 `state.relics` 查表调用
   - 在 `startCombat`（`engine.ts:43`）算 `maxEnergy` / `handSize` 时先叠加
     `modifiers`，不要继续读常量
   - 在 `startPlayerTurn`（`engine.ts:127`）、`endPlayerTurn`（`engine.ts:152`）、
     `runEnemyTurn`（`engine.ts:164`）、`playCard`（`engine.ts:217`）、
     `applyDamage`（`engine.ts:297`）、`drawCards` 的重洗分支（`engine.ts:141`）
     各埋一个 `fireHook`
   - **删掉** `engine.ts:230-235` 的 `firstAttackUsed` 硬编码分支，改成关羽初始遗物；
     `previewValues`（`engine.ts:357`）里的 `PASSIVE_ATTACK_BONUS` 同步改为查询遗物
3. `src/data/heroes.ts`：`HeroDef` 增加 `starterRelic: string`，关羽填
   `'qinglongdao'`，`passive` 字段可以保留做标题页展示但不再驱动规则。
4. `src/state/run.ts`：`startRun` 初始化 `relics: [hero.starterRelic]`、
   `relicCounters: {}`；新增 `addRelic(run, id)` / `hasRelic(run, id)`。
5. HUD：`MapScene` 和 `CombatScene` 顶部加遗物条（图标 26px，横排，超过 10 件换行）；
   悬停出 `inkPanel` 说明（复用 `src/ui/theme.ts` 的面板）。
6. `CombatScene` 事件排水处理 `{t:'relic'}`：图标放大到 1.25 再弹回 + 金色描边闪一下，
   复用 `src/ui/vfx.ts` 里的 pop 逻辑。
7. 遗物图标美术：走 `genmedia`，与现有卡牌同一风格提示词（水墨 + 暗色手绘卡牌），
   26×26 显示但导出 ≥128px（参考 README「Bitmaps 按 HiDPI 尺寸导出」那条）。

## 验收标准

- 关羽首攻 +3 的行为**由遗物驱动**，删掉引擎里的 `firstAttackUsed` 特判后行为不变，
  卡面预览数字也仍然正确
- 一件 `energy: +1` 的遗物能让战斗里气上限变成 4，且 HUD 气球数量跟着变
- 一件「每打出 3 张牌获得 2 护甲」的计数型遗物跨回合正确累计，战斗结束后计数器重置
- 一件「进入房间获得 5 金」的遗物在 `MapScene` 里生效（说明钩子不只在战斗里能用）
- 遗物条悬停有说明，触发时有可见反馈
- 引擎仍然零 Phaser 依赖（`relics.ts` 不许 import phaser）

## 依赖

无强依赖，但**必须先做**，因为 [02 药水](02-potions.md)、[10 遗物奖励](10-relic-rewards.md)、
[18 开局祝福](18-neow-blessing.md)、[05 商店](05-shop.md) 都挂在它上面。
钩子埋点也会被 [12 状态库](12-status-library.md) 复用。
