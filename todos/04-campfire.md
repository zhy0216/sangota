# 04 · 营帐（篝火）选项

## 现状

`MapScene.enterRoom`（`src/scenes/MapScene.ts:329-334`）：

```ts
case 'rest': {
  const healed = heal(this.run, Math.round(this.run.maxHp * 0.3));
  this.refreshHud();
  this.showToast(node, `休整完毕，回复 ${healed} 点体力。`);
  break;
}
```

点上去自动回 30% 血，弹个 toast，没有任何选择。地图上 12% 的房间是营帐
（README 记录的房间分布），也就是说一局大约 2 次纯粹的「自动结算」。

`MAP.restRow = 14`（`src/config.ts`）把第 15 层锁成营帐，这是对的——原版
Boss 前必有休息点。但既然没有选项，这个设计意图就没兑现。

## 原版行为

篝火菜单固定两项，遗物/事件可以解锁更多：

| 选项 | 效果 |
|---|---|
| **Rest** | 回复 30% 最大生命 |
| **Smith** | 升级一张牌 |
| Lift（Girya 遗物） | 永久 +1 力量（限 3 次） |
| Toke（Peace Pipe 遗物） | 从牌组移除一张牌 |
| Dig（Shovel 遗物） | 获得一件随机遗物 |
| Recall（第三幕剧情） | 拿到 Ruby Key |

设计核心是**「回血 vs 变强」的二选一张力**：血量安全时该升级，
血线危险时该回血，Boss 前的那个营帐尤其纠结。原版还有 Ascension 高层把
Rest 削到 25%——因为 Rest 太安全会削弱这个决策。

## 设计方案

三国题材叫**营帐**，菜单三项起步（第三项靠遗物解锁）：

| 选项 | 中文名 | 效果 | 解锁条件 |
|---|---|---|---|
| Rest | **休整** | 回复 30% 最大体力 | 常驻 |
| Smith | **锻造** | 精进一张牌 | 常驻（牌组有可升级卡时才亮） |
| Dig | **掘藏** | 获得一件随机普通遗物 | 持有「工兵铲」 |
| Toke | **弃甲** | 从牌组移除一张牌 | 持有「静心香」 |
| Lift | **举鼎** | 永久 +1 神力上限（整局限 3 次） | 持有「石鼎」 |
| Recall | **忆往** | 拿到第四幕钥匙之一 | 见 [09 多幕](09-acts-and-progression.md) |

**这需要一个真正的场景，不是 toast。** 现在所有非战斗房间都靠
`showToast`（`MapScene.ts:651-697`）打发，营帐、商店、事件三个都需要独立
的全屏界面。建议先在这里立好**房间场景的通用壳**（背景 + 标题 + 面板 + 「继续」
按钮 + 淡入淡出回地图），后面 05 和 06 直接复用。

营帐场景视觉参考已有的 `out/gen/cut-rest.png` / `icon-rest.png`（美术已生成）。

## 数据结构

```ts
// src/rooms/campfire.ts (新增)

export type CampfireOptionId = 'rest' | 'smith' | 'dig' | 'toke' | 'lift' | 'recall';

export interface CampfireOption {
  id: CampfireOptionId;
  label: string;      // '休 整'
  desc: string;       // '回复 30% 最大体力（约 24 点）'
  /** 是否可选。不可选时显示为灰、并给出原因。 */
  available: (run: RunState) => boolean;
  unavailableReason?: string;
  /** 是否需要二级界面（锻造/弃甲要选牌）。 */
  needsCardPick?: boolean;
}
```

```ts
// src/state/run.ts 增补
export interface RunState {
  // ...
  /** 举鼎已用次数，用于限 3。 */
  liftCount: number;
}
```

## 实现步骤

1. **先做房间场景通用壳** `src/scenes/RoomScene.ts`：
   - `init({ node })` 拿到 `MapNode`，用 `ROOM_META`（`src/map/roomMeta.ts:5`）
     取标题/配色/图标
   - 背景用房间的 cut 图（`cut-rest.png` 等），加暗角和噪点保持和战斗背景一致的质感
   - 提供 `showOptions(options, onPick)` 和 `close()`（淡出 → `scene.start('Map')`）
   - 复用 `src/ui/theme.ts` 的 `inkPanel` / `inkButton`
2. `MapScene.enterRoom`（`MapScene.ts:316-347`）：`case 'rest'` 改成
   `this.scene.start('Room', { node })`，删掉自动 `heal`。
3. `src/rooms/campfire.ts`：定义 `CAMPFIRE_OPTIONS`，实现每个选项的
   `apply(run)`（rest 调 `heal`，smith 跳二级选牌，dig 调 `addRelic` 等）。
4. 锻造/弃甲的**选牌二级界面**：复用 [07 牌堆查看器](07-deck-viewer.md) 的网格，
   加 `mode: 'pick'`，点一张后出「精进这张？」确认（防误点，原版也有确认）。
   锻造时卡面要**实时预览升级后的数值**——玩家得看到 6→9 才好决策。
5. 选完执行、播效果（回血：金光 + HP 条爬升 + 数字；锻造：卡片金光炸开），
   然后**禁掉全部选项**（一个营帐只能选一次），显示「离营」按钮回地图。
6. `run.ts` 记 `node.visited`（已有）之外，还要防「回地图再点进来」——
   现在 `availableNodes`（`run.ts:49-52`）只给 children，已经天然防住了，
   但存档恢复时要确认营帐是否已消费，见 [08 存档](08-save-resume.md)。

## 验收标准

- 点营帐进入独立场景，不是 toast
- 休整回 30% 血（满血时该选项灰掉并提示「体力已满」）
- 锻造能升一张牌，选牌界面显示升级前后数值对比
- 牌组里没有可升级的牌时锻造灰掉
- 选完一项后不能再选第二项，只能离营
- 第 15 层营帐 → Boss 的流程顺畅，Boss 前提示「丹药未用完」（若 02 已做）
- `Esc` 不能跳过选择直接回地图（会白拿一个营帐）

## 依赖

- [03 卡牌升级](03-card-upgrades-done.md)——锻造的实际内容
- [07 牌堆查看器](07-deck-viewer.md)——选牌 UI
- 弱依赖 [01 遗物](01-relics.md)（掘藏/弃甲/举鼎的解锁条件）
- **产出被复用**：`RoomScene` 壳是 [05 商店](05-shop.md) 和
  [06 事件](06-events.md) 的基础
