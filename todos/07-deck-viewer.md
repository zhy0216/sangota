# 07 · 牌堆查看器（牌组 / 抽牌堆 / 弃牌堆 / 消耗堆）

## 现状

完全没有。`CombatState` 里四个堆都在（`src/combat/types.ts:126-129`）：
`drawPile / hand / discardPile / exhaustPile`，但界面上一张都看不到。

地图上也看不到牌组——`MapScene` 的 HUD 只有头像、体力、资财、层数。
README「Known gaps」写了「no deck viewer」。

这是**功能性缺失，不是体验问题**。杀戮尖塔是一个计算游戏：
「我抽牌堆里还剩几张劈砍」直接决定这回合该不该打观阵。看不到牌堆，
玩家只能凭记忆，实际效果是把策略游戏降级成了运气游戏。

## 原版行为

四个入口：

| 入口 | 位置 | 内容 | 排序 |
|---|---|---|---|
| 牌组 | 战斗内左上 / 地图右上 | 整副牌 | 按类型→费用→名称 |
| 抽牌堆 | 战斗内左下角计数 | 剩余待抽 | **随机打乱显示**（防止推算顺序） |
| 弃牌堆 | 战斗内右下角计数 | 已用 | 按弃入顺序 |
| 消耗堆 | 战斗内（有内容时才出现） | 本场消耗 | 按消耗顺序 |

细节：

- 三个堆的**计数常驻**在角上，不用点开就能看到数量
- 抽牌堆内容故意乱序，因为原版允许你知道「有什么」但不允许知道「什么时候来」
- 卡片网格可滚动，鼠标悬停放大并显示完整规则文本
- 战斗中可随时打开，不消耗回合，`Esc` 关闭
- 地图上的牌组查看还带「按类型/费用/稀有度排序」的切换

## 设计方案

一个共用的**卡片网格组件**，四种数据源 + 三种模式：

```
模式 view  —— 只看，Esc 关
模式 pick  —— 选一张，返回 uid（营帐锻造、商店弃卡、事件效果）
模式 pickN —— 选 N 张
```

这个组件是 [04 营帐](04-campfire.md)、[05 商店](05-shop.md)、
[06 事件](06-events.md)、[22 结算](22-run-summary.md) 的共同依赖，
所以**接口要先定稳**。

布局：5 列 × N 行，卡片缩到现有 `CardView` 的 0.62 倍（原版也是缩略），
超出屏幕滚轮滚动。复用 `MapScene` 已有的滚轮/拖拽 pan 逻辑思路
（`MapScene.ts` 里的 camera 平移），但这里是一个独立 overlay 而非场景。

## 数据结构

```ts
// src/ui/CardGrid.ts (新增)

export type CardGridMode = 'view' | 'pick';

export interface CardGridEntry {
  uid: string;
  defId: string;
  upgraded: number;
  /** 不可选时压暗 + 显示原因（比如锻造时已满级的牌）。 */
  disabled?: boolean;
  disabledReason?: string;
  /** 覆盖卡面数值的预览（锻造时显示升级后）。 */
  previewUpgraded?: boolean;
}

export interface CardGridOptions {
  title: string;
  subtitle?: string;
  entries: CardGridEntry[];
  mode: CardGridMode;
  /** pick 模式要选几张。 */
  pickCount?: number;
  /** 是否打乱显示顺序（抽牌堆用）。 */
  shuffleDisplay?: boolean;
  /** pick 模式的二次确认文案，null 表示不确认。 */
  confirmText?: string | null;
  onPick?: (uids: string[]) => void;
  onClose?: () => void;
}

/** 挂在任意 Scene 上的 overlay，自己管深度和输入拦截。 */
export function openCardGrid(scene: Phaser.Scene, opts: CardGridOptions): void;
```

## 实现步骤

1. `src/ui/CardGrid.ts`：
   - 全屏半透明黑底（拦截下层点击，别让玩家透过 overlay 点到敌人）
   - `inkPanel` 大面板 + 标题 + 计数副标题（「共 13 张」）
   - 网格布局 + 滚轮滚动（内容不足一屏时禁用滚动）
   - 悬停：卡片抬到 1.0 缩放、提到最高深度、显示完整规则文本
   - `pick` 模式：点选后描金边，达到 `pickCount` 时出确认按钮
   - `Esc` / 点空白关闭（`pick` 模式下若是强制选择则不允许关）
2. 卡面渲染直接用现有 `CardView`（`src/ui/CardView.ts`）的 `display` 模式，
   数值预览要走 [03](03-card-upgrades.md) 的 `resolveCard`。
   注意 `CardView` 目前需要 `CombatState` 来算 `describeCard`
   （`src/combat/engine.ts:377`）——地图上没有 `CombatState`，所以要么
   给 `describeCard` 加一个「静态预览」重载（`state` 可选，缺省用空状态），
   要么造一个 dummy state。**推荐前者**，让 `previewValues`
   （`engine.ts:357`）接受 `state?: CombatState`。
3. `CombatScene` 增加三个角标：
   - 左下：抽牌堆数量（`state.drawPile.length`），点开 → `shuffleDisplay: true`
   - 右下：弃牌堆数量，点开 → 按弃入顺序
   - 弃牌堆旁：消耗堆数量，`exhaustPile.length > 0` 时才显示
   - 左上：整副牌组，点开 → 按类型/费用排序
   - 数量变化时数字弹一下（复用 `src/ui/vfx.ts` 的 popText 思路）
4. `MapScene` HUD 加「牌组」按钮（头像旁边），点开看 `run.deck`。
5. 排序函数：`sortForDisplay(entries)` —— 攻 → 谋 → 势 → 诅咒/状态，
   同类内按费用升序，同费按 defId。放在 `CardGrid.ts` 里导出，供各处一致使用。

## 验收标准

- 战斗中能打开四个堆，数量和引擎状态一致（打一张牌后弃牌堆 +1）
- 抽牌堆的显示顺序每次打开都不同，但**内容**正确
- 消耗堆在打出「势」牌（`engine.ts:240` 走 exhaust）后出现并含那张牌
- 地图上能看牌组，升级过的牌显示为「·精」
- overlay 打开时点击穿透不到下层（战斗中打开牌堆不会误选敌人）
- `pick` 模式返回的 uid 能正确定位到 `run.deck` 里那一张物理卡
- 卡片超过一屏时能滚动，不足一屏时不会出现空滚动区

## 依赖

- [03 卡牌升级](03-card-upgrades.md)——`DeckCard` / `upgraded` 字段和 `resolveCard`
- **产出被复用**：04 / 05 / 06 / 22 都要它的 `pick` 模式
