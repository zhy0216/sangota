# 03 · 卡牌升级

## 现状

完全没有。牌组是 `deck: string[]`（`src/state/run.ts:12-13`），一个字符串就是一张牌，
**没有实例级别的状态**，所以无处记录「这张劈砍升过级」。

`CardDef`（`src/combat/types.ts:28-44`）里 `cost / text / effects` 都是常量，
`CardInstance`（`types.ts:46-49`）只有 `{ uid, defId }`。

`REWARD_POOL`（`src/combat/cards.ts:171-180`）只有 8 张牌。加上初始 3 种共 11 种，
这是当前构筑深度最紧的瓶颈——升级能立刻把有效卡池翻倍，成本远低于画 20 张新卡。

## 原版行为

- 每张牌有一个「+」版本，名字后加 `+`，卡框描边变金
- 升级效果各不相同，不是统一 +N：打击 6→9 伤害、防御 5→8 护甲、
  有的降费（2→1）、有的加抽牌数、有的去掉「消耗」、有的加「保留」
- 升级来源：**营帐铁匠**（每次一张）、部分事件、部分遗物（如「打铁石」开局升一张）、
  Boss 遗物（升级全部打击/防御）
- **升级不可叠加**，一张牌只能升一次（少数例外如 Searing Blow 可无限升）
- 升级是永久的，跟着那一张物理卡走：牌组里有 5 张劈砍，升的是其中特定一张
- 战斗中卡面直接显示升级后的数值

## 设计方案

三国题材叫**锻造 / 精进**，卡名加「·精」后缀（如「劈砍·精」），卡框由金变亮金。

关键决策：**升级信息挂在物理卡上，不是卡 ID 上**。所以 `deck` 必须从
`string[]` 升级为对象数组。这是一次会波及不少地方的重构，越早做越好——
[05 商店](05-shop.md)（移除卡）、[07 牌堆查看器](07-deck-viewer-done.md)、
[14 诅咒](14-curses-and-status-cards.md) 都需要同样的实例化牌组。

升级方式采用 **`upgrade` 字段声明差异**，不写第二份卡定义：

```ts
pikan: {
  id: 'pikan', name: '劈砍', cost: 1,
  text: '造成 {D} 点伤害。',
  effects: [{ kind: 'damage', amount: 6 }],
  upgrade: { effects: [{ kind: 'damage', amount: 9 }] },   // 只覆盖变化的字段
},
quedi: {
  // 8 护甲抽 1 → 11 护甲抽 1
  upgrade: { effects: [{ kind: 'block', amount: 11 }, { kind: 'draw', amount: 1 }] },
},
jieying: {
  // 14 护甲 2 费 → 14 护甲 1 费（降费型升级）
  upgrade: { cost: 1 },
},
```

11 张现有卡的升级方案（先定死，避免以后反复调）：

| 卡 | 原始 | 升级后 |
|---|---|---|
| 劈砍 | 6 伤 | 9 伤 |
| 铁壁 | 5 甲 | 8 甲 |
| 拖刀计 | 8 伤 + 2 破绽 | 10 伤 + 3 破绽 |
| 温酒斩 | 7 伤 + 1 破绽 | 10 伤 + 2 破绽 |
| 万人敌 | 全体 8 伤 | 全体 12 伤 |
| 却敌 | 8 甲 + 抽 1 | 11 甲 + 抽 1 |
| 义勇 | 2 层神力 | 3 层神力 |
| 白马义从 | 0 费 4 伤 | 0 费 7 伤 |
| 结营 | 2 费 14 甲 | 1 费 14 甲（降费） |
| 观阵 | 0 费抽 2 | 0 费抽 3 |
| 虚招 | 2 层怯战 + 4 甲 | 3 层怯战 + 6 甲 |

## 数据结构

```ts
// src/combat/types.ts
export interface CardDef {
  // ...现有字段
  /** 升级后覆盖的字段。缺省表示这张牌不可升级（诅咒牌就该缺省）。 */
  upgrade?: Partial<Pick<CardDef, 'cost' | 'text' | 'effects' | 'target' | 'keywords'>>;
}

export interface CardInstance {
  uid: string;
  defId: string;
  /** 升级次数。目前只支持 0 / 1。 */
  upgraded: number;
}
```

```ts
// src/state/run.ts —— 破坏性改动
/** 牌组里的一张物理卡。 */
export interface DeckCard {
  /** 稳定的实例 id，用于「升级第 3 张劈砍」和 UI 定位。 */
  uid: string;
  defId: string;
  upgraded: number;
}

export interface RunState {
  // ...
  deck: DeckCard[];   // 原来是 string[]
}
```

## 实现步骤

1. `src/combat/cards.ts`：给 11 张牌全部补 `upgrade` 字段（按上表）。
2. 新增 `resolveCard(defId, upgraded): CardDef`：返回 `{...base, ...base.upgrade}`
   并把 `name` 补上「·精」。**所有读卡定义的地方都要改走这个函数**，
   别再直连 `getCard`（`cards.ts:182`）。
   - `engine.ts:349` 的 `defOf`
   - `engine.ts:357` 的 `previewValues`
   - `engine.ts:377` 的 `describeCard`
   - `src/ui/CardView.ts` 全部
3. `deck: string[]` → `DeckCard[]` 的重构，涉及：
   - `run.ts:22-35` `startRun`（`hero.startingDeck` 要生成 uid）
   - `run.ts:74-76` `addCard`
   - `heroes.ts:35-39` `startingDeck` 保持 `string[]`，在 `startRun` 里实例化
   - `CombatScene.ts:137` 把 deck 传进 `startCombat`
   - `engine.ts:46-53` `startCombat` 建 `cards` 表时带上 `upgraded`
   - 建议加一个 `newDeckCard(defId, upgraded = 0): DeckCard`，uid 用
     单调计数器而非随机数（要可复现，见 `src/core/rng.ts`）
4. `CardView`（`src/ui/CardView.ts`）：升级卡的描边用 `C.goldBright`、
   数值文字也换亮金、名字加后缀。别只改颜色——原版靠「+」这个明确记号，
   纯颜色差异在缩略图里看不出来。
5. `run.ts` 新增 `upgradeCard(run, uid): boolean`（已满级或不可升级返回 false）、
   `upgradableCards(run): DeckCard[]`。
6. 升级入口先只接 [04 营帐](04-campfire.md) 的铁匠。选卡界面复用
   [07 牌堆查看器](07-deck-viewer-done.md) 的网格布局，加「点一张确认」的模式。

## 验收标准

- 营帐里升一张劈砍后，牌组里**只有那一张**变成「劈砍·精」，其余 4 张不变
- 战斗中「劈砍·精」卡面显示 9（叠上关羽首攻 +3 时显示 12）
- 「结营·精」在 HUD 上是 1 费，且 1 气时可以打出
- 升过的牌在牌堆查看器、结算屏、商店里都显示升级态
- 同一 seed + 同一升级操作序列 → 战斗表现完全一致
- `npm run typecheck` 通过（`deck` 类型改动会暴露所有遗漏点，这是好事）

## 依赖

无。但它引入的 `DeckCard` 是 [05 商店](05-shop.md)、[07 牌堆查看器](07-deck-viewer-done.md)、
[14 诅咒与状态牌](14-curses-and-status-cards.md)、[22 结算界面](22-run-summary.md)
的共同前提，**应当尽早做**，越晚重构面越大。
