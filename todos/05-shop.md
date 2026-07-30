# 05 · 商店（商旅）

## 现状

`MapScene.enterRoom`（`src/scenes/MapScene.ts:344-346`）走 `default` 分支，
只弹一个 `showToast(node)`——就是房间的 flavour 文本，什么都不发生。
README「Known gaps」也明确写了「奇遇与商旅仍是占位 toast」。

后果是**金币是死资源**。关羽起手 99 金（`src/data/heroes.ts:28`），战斗给
10-22 金、精英 28-42、Boss 80-110、宝箱 25-45。一局能攒 400+ 金，
一分钱花不出去。整条金币经济线目前是断的。

## 原版行为

商店固定库存结构：

| 品类 | 数量 | 价格 |
|---|---|---|
| 卡牌 | 5 张（按角色卡池抽，含 1 张 colorless） | 常见 45-55 / 罕见 68-82 / 稀有 135-165 |
| 遗物 | 3 件（1 普通 1 罕见 1 商店专属） | 143-157 / 250-300 / 300-360 |
| 药水 | 3 瓶 | 48-52 / 72-78 / 95-105 |
| **移除卡牌** | 1 次 | 75 金，**每次用过后本局 +25** |

细节：

- 价格有 ±10% 随机浮动，且**同一商店的价格进出保持不变**（不能刷）
- 有 1 件商品随机打 50% 折扣（卡或遗物）
- `Membership Card` 遗物打 5 折、`The Courier` 遗物刷新库存
- 移除卡牌是原版最重要的商店功能——它是唯一稳定的「减牌」手段，
  用来清初始的打击/防御和诅咒牌
- 买完就走，商店不可重复进入

## 设计方案

三国题材叫**商旅**（行商车队）。库存照搬原版结构，价格按本项目的金币产出重新标：

本项目一局金币总量约 **99（起手）+ 12×16（普通）+ 42（精英）+ 35（宝箱）≈ 370**，
比原版单幕的产出低一些，所以价格整体下调约 30%：

| 品类 | 数量 | 价格区间 |
|---|---|---|
| 卡牌 | 5 张 | 常见 32-38 / 罕见 48-58 / 稀有 95-115 |
| 遗物 | 3 件 | 100-110 / 175-210 / 210-250 |
| 丹药 | 3 瓶 | 34-38 / 50-56 / 66-74 |
| **弃卡** | 1 次 | 52 金，用后本局 +18 |

一件商品随机 5 折，用金色「减」印章标出来。

**库存必须由 seed 决定**：`new Rng(\`${map.seed}:${nodeId}:shop\`)`，
和现有的奖励/宝箱一个套路（`MapScene.ts:337`、`CombatScene.ts:1149`）。
这样离开再回来（或读档）库存不变，也不给刷新留口子。

## 数据结构

```ts
// src/rooms/shop.ts (新增)

export interface ShopItem<T extends 'card' | 'relic' | 'potion'> {
  kind: T;
  id: string;
  price: number;
  /** 打折商品。 */
  discounted: boolean;
  /** 已购买（灰掉但保留位置，别让布局跳动）。 */
  sold: boolean;
}

export interface ShopStock {
  cards: ShopItem<'card'>[];
  relics: ShopItem<'relic'>[];
  potions: ShopItem<'potion'>[];
  /** 弃卡服务当前价，null 表示本店已用过。 */
  removalPrice: number | null;
}
```

```ts
// src/state/run.ts 增补
export interface RunState {
  // ...
  /** 弃卡服务的累计涨价，跨商店持续。初始 0。 */
  cardRemovalSurcharge: number;
  /** 已生成的商店库存，key = nodeId。读档要恢复，所以存在 run 里而非场景里。 */
  shopStock: Record<string, ShopStock>;
}
```

## 实现步骤

1. `src/rooms/shop.ts`：
   - `generateStock(run, nodeId): ShopStock`——用 seeded Rng 抽卡/遗物/药水，
     排除玩家已持有的遗物、遵守卡牌稀有度权重（见
     [11 稀有度](11-card-rarity-and-rewards.md)）
   - `priceOf(kind, rarity, rng)`——按上表 ±10%
   - `buy(run, stock, item): boolean`——查金币、扣钱、进牌组/遗物/药水槽
   - `removeCard(run, stock, uid)`——扣钱、从 `run.deck` 删、
     `run.cardRemovalSurcharge += 18`
2. 商店场景：基于 [04 营帐](04-campfire.md) 立的 `RoomScene` 壳，
   布局三行——卡（5 张 `CardView`，`display` 模式）、遗物（3 图标）、丹药（3 瓶），
   右侧一列放「弃卡」按钮和金币数。
3. 价格标签：卡片下方金色小牌；买不起的商品**卡面压暗 + 价格标红**，
   点击时给「资财不足」的轻微抖动而不是无反应。
4. 购买后：金币数字滚动到新值、商品原地变成「已售」印章、
   卡牌飞向 HUD 牌组图标（复用 `src/ui/vfx.ts` 里现成的飞行/pop 逻辑）。
5. 弃卡：点按钮 → 牌堆网格（[07](07-deck-viewer.md) 的 `mode:'pick'`）→
   二次确认 → 扣钱、移除、按钮变灰并显示下次价格。
6. `MapScene.enterRoom`：`case 'shop': this.scene.start('Room', { node })`。
   `MAP.minAdvancedRow = 5`（`src/config.ts`）已经把商店锁在第 6 层以上，
   符合原版（避免开局就能买 boss 级遗物）。
7. 遗物联动：`hasRelic(run, 'shangduitongdie')` → 全场 8 折，验证遗物钩子
   在战斗外也能生效。

## 验收标准

- 同一 seed 进商店两次（离开再回来 / 读档后）库存和价格完全一致
- 买卡后牌组真的多一张，金币正确扣除，商品变「已售」且不能再买
- 金币不足时不能购买，且有明确反馈
- 弃卡能从 `run.deck` 移除指定的那一张物理卡（升级过的和没升的要能分开选）
- 第二家商店的弃卡价格是 52 + 18 = 70
- 买满 3 瓶丹药时槽位满了要拒绝购买并提示（不能白花钱）
- 折扣商品价格显示为「原价划掉 + 折后价」

## 依赖

- [04 营帐](04-campfire.md)——`RoomScene` 壳
- [03 卡牌升级](03-card-upgrades.md)——`DeckCard` 实例化（弃卡要定位到具体一张）
- [01 遗物](01-relics.md) / [02 药水](02-potions.md)——库存的两个品类
- [07 牌堆查看器](07-deck-viewer.md)——弃卡的选牌 UI
- [11 稀有度](11-card-rarity-and-rewards.md)——卡牌库存的抽取权重
