# 06 · 奇遇事件

## 现状

和商店一样走 `default` 分支弹 toast（`src/scenes/MapScene.ts:344-346`）。

事件房间是地图上**占比第二高**的房间类型——README 记录的分布是
monster 49% / **event 21%** / camp 12% / elite 7% / shop 3%。也就是说
一局 15 层里大约 3-4 个房间点进去什么都不会发生。这是当前最明显的空洞。

`ROOM_META`（`src/map/roomMeta.ts:5`）里 event 的 flavour 文本已经写好了，
图标和 cut 图也生成了（`out/gen/icon-event.png`、`cut-event.png`），只差内容和界面。

## 原版行为

约 50 个事件，每幕一套独立池子。结构：

- 一段场景描述文本 + 2-4 个选项，选项有明确的**风险/收益**
- 收益维度极广：金币、回血、最大生命、遗物、药水、卡牌、升级、移除卡
- 代价维度同样广：掉血、掉最大生命、拿诅咒牌、失去金币、失去遗物、直接进入战斗
- 相当多事件是**赌博型**（Golden Idol：拿遗物但触发陷阱；Big Fish：三选一）
- 部分选项**有条件**（金币够 / 持有某遗物 / 血量够），不满足就灰掉并显示原因
- 部分事件是**一次性**（整局只出现一次，出过就从池子里删）
- 少数事件会直接转成战斗（Dead Adventurer 的 25% 概率）

事件的作用是**打破节奏**：连续 3 场战斗后来一个「掉 10 血换一件稀有遗物」，
这是原版整体节奏感的重要来源。

## 设计方案

三国题材叫**奇遇**。第一批做 12 个，用真实三国典故，覆盖全部收益/代价维度：

| 事件 | 选项 |
|---|---|
| **桃园结义** | A：加入（+8 最大体力）／B：观望（+50 资财） |
| **草船借箭** | A：夜取（获得随机丹药 ×2，但掉 8 体力）／B：不去（无事发生） |
| **官渡焚粮** | A：焚粮（弃一张牌，获得一件普通宝物）／B：撤走 |
| **卧龙岗** | A：三顾（精进两张牌，掉 12 体力）／B：留书（精进一张牌） |
| **单刀赴会** | A：赴会（进入一场精英战，胜则得稀有宝物）／B：谢绝 |
| **华佗行医** | A：诊治（回满体力）／B：开颅（+15 最大体力，但 30% 概率掉 20 体力）／C：谢绝 |
| **黄金台** | A：取金（+120 资财，获得诅咒「贪念」）／B：不取 |
| **传国玉玺** | A：私藏（获得稀有宝物，掉 20% 当前体力）／B：上交（+80 资财） |
| **醉酒张飞** | A：陪饮（+2 层永久神力起手，但每场战斗起手多一张「醉」状态牌）／B：劝阻 |
| **降将来投** | A：收编（牌组加入 2 张随机常见牌）／B：遣散（+40 资财） |
| **五丈原** | A：祈祷（消耗所有资财，回满体力并精进一张）／B：离开 |
| **山中残兵** | A：搜寻（每次 25% 触发战斗，否则 +30 资财，可重复搜）／B：离开 |

一次性事件（桃园结义、传国玉玺、卧龙岗）出过就从池子删。

## 数据结构

```ts
// src/rooms/events.ts (新增)

export interface EventOutcome {
  /** 结果文本，选完后替换掉选项区显示。 */
  text: string;
  /** 声明式结果，尽量用这些而不是任意回调，便于测试和存档。 */
  gold?: number;              // 可负
  hp?: number;                // 可负，负值走 damage 逻辑（可能致死）
  maxHp?: number;
  healToFull?: boolean;
  gainRelic?: 'common' | 'uncommon' | 'rare' | string;   // 档位或具体 id
  gainPotion?: number;        // 瓶数
  gainCards?: string[] | { count: number; rarity?: CardRarity };
  gainCurse?: string;
  removeCards?: number;       // 触发选牌界面
  upgradeCards?: number;      // 触发选牌界面
  /** 转入战斗。'elite' 用精英表，'monster' 用普通表。 */
  fight?: { tier: 'monster' | 'elite'; rewardRelic?: string };
  /** 概率分支：按 weight 抽一个子结果。 */
  branches?: { weight: number; outcome: EventOutcome }[];
}

export interface EventOption {
  label: string;
  /** 选项下方的灰色小字，明确写出代价，别让玩家瞎猜。 */
  hint: string;
  requires?: (run: RunState) => boolean;
  requiresText?: string;      // '需要 120 资财'
  outcome: EventOutcome;
  /** 可重复选（山中残兵）。 */
  repeatable?: boolean;
}

export interface EventDef {
  id: string;
  name: string;
  art: string;
  body: string;              // 场景描述，2-4 行
  options: EventOption[];
  /** 整局只出现一次。 */
  once?: boolean;
  /** 出现的最低层数（0-indexed），避免开局就遇到高风险事件。 */
  minRow?: number;
}
```

```ts
// src/state/run.ts 增补
export interface RunState {
  // ...
  /** 已见过的事件 id，用于 once 和去重。 */
  seenEvents: string[];
  /** 已分配给各节点的事件，key = nodeId。保证读档/返回时一致。 */
  eventAssignments: Record<string, string>;
}
```

## 实现步骤

1. `src/rooms/events.ts`：写 `EVENTS` 表（先 12 个）+ `pickEvent(run, node)`：
   - 用 `new Rng(\`${map.seed}:${nodeId}:event\`)` 抽
   - 过滤掉 `seenEvents` 里的 `once` 事件和 `minRow` 不满足的
   - 池子空了兜底给一个「无事发生 +25 资财」的默认事件
2. `applyOutcome(run, outcome): OutcomeReport`——纯函数，返回「实际发生了什么」
   （实际回了多少血、实际拿到哪件遗物），供界面显示。`branches` 用 seeded Rng 抽。
3. 事件场景：基于 [04](04-campfire-done.md) 的 `RoomScene` 壳。
   - 上半屏事件插画（`genmedia` 生成，12 张，和卡牌同风格）
   - 中间 `body` 文本（`bodyStyle`，`src/ui/theme.ts`）
   - 下方选项按钮竖排，每个下面一行灰字 `hint`
   - 不满足 `requires` 的选项压暗 + 显示 `requiresText`
   - 选完 → 选项区淡出，换成 `outcome.text` + 实际数值 → 「继续」按钮
4. 选牌类结果（`removeCards` / `upgradeCards`）跳 [07](07-deck-viewer-done.md) 的 pick 模式。
5. `fight` 结果：`scene.start('Combat', { nodeType: outcome.fight.tier, fromEvent: eventId,
   rewardRelic })`。`CombatScene` 结算时若有 `rewardRelic` 就额外给。
6. `MapScene.enterRoom`：`case 'event': this.scene.start('Room', { node })`。
7. **HP 变化必须走真实结算**：掉血可能致死（原版事件确实能杀人），
   走 `run.hp` 修改后调 `isRunOver`（`src/state/run.ts:83`），
   死了跳 [22 结算界面](22-run-summary.md)。

## 验收标准

- 同一 seed 下同一节点的事件、以及概率分支的结果完全可复现
- 「桃园结义」整局只出现一次
- 「华佗行医」的 30% 分支确实会触发，且两种结果文本都正确
- 「单刀赴会」能进入精英战、胜利后额外拿到稀有宝物、失败则跑团结束
- 金币不足时「五丈原」的祈祷选项灰掉并显示原因
- 事件掉血致死会正确进入结算界面而不是卡住
- 选完一个选项后不能再选（除 `repeatable`）

## 依赖

- [04 营帐](04-campfire-done.md)——`RoomScene` 壳
- [01 遗物](01-relics-done.md) / [02 药水](02-potions-done.md) / [03 升级](03-card-upgrades-done.md)
  ——`EventOutcome` 的几个字段需要它们存在（可以先做没有这些字段的事件）
- [14 诅咒](14-curses-and-status-cards-done.md)——黄金台/醉酒张飞的代价
- [07 牌堆查看器](07-deck-viewer-done.md)——选牌类结果
