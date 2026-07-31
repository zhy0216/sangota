# 24 · 战斗交互与关键词提示

## 现状

从 README 和 `CombatScene`（1245 行）看，现在的交互是：

- **点击**卡片打出（不是拖拽）
- 攻击卡进入选敌模式 → **点击敌人**，`Esc` 取消
- `E` 结束回合
- 地图：滚轮/拖拽平移、`Space` 归位、悬停节点出 tooltip、点击进入
- 头像抽屉：点 HUD 头像展开，`Esc` 关闭

做得好的部分：卡面数字**实时反映**当前状态
（`previewValues` / `describeCard`，`src/combat/engine.ts:357-380`），
选敌时会算上目标的破绽——这是很多同类项目会做错的地方。

缺的部分：

| 缺口 | 影响 |
|---|---|
| 没有拖拽出牌 | 点击→点击的两步操作在快速游戏时手感差 |
| 没有数字键快捷出牌 | 老玩家的效率手段 |
| 悬停不放大卡片 | 卡面缩小时规则文本难读 |
| **没有关键词 tooltip** | 状态只有 3 种时靠记，扩到 18 种后（[12](12-status-library-done.md)）必须有 |
| 没有目标高亮预览 | 选敌时看不出「这一下会打掉多少、会不会杀死」 |
| 没有 undo 保护 | 点错卡直接结算，没有确认（[21 设置](21-settings.md) 里有这项） |
| `Esc` 语义单一 | 加了 overlay 后要分优先级 |

## 原版行为

**出牌**：
- **拖拽**为主：按住卡片拖到目标上松手。拖动时卡片跟随、
  出现一条从卡到目标的曲线箭头
- 单体牌拖到敌人身上，敌人**高亮描边**
- 无目标牌拖到屏幕上半部分任意位置松手即可（有一条「打出线」）
- 拖到一半松手会**回弹**（不算打出）——这是重要的防误触
- 数字键 1-0 对应手牌，按下后若需目标则用方向键/鼠标选
- 空格结束回合（本项目用 `E`）

**信息展示**：
- 悬停卡片放大到全尺寸并抬到最上层
- **所有关键词都可悬停**：卡面上的「消耗」「虚无」，
  状态图标，意图图标 —— 悬停出说明面板
- 关键词在规则文本里**高亮显示**（原版用不同颜色）
- 选中攻击卡时，敌人 HP 条上**预览**这一击会打掉的部分
- 敌人 HP 条上显示「这一击会杀死」的标记

**其他**：
- 手牌超过 7 张时自动收窄扇形
- 手牌可以整体展开查看（原版按住 Alt）

## 设计方案

### 一、拖拽出牌（保留点击作为备选）

两种都支持——点击对触摸屏和休闲玩家友好，拖拽对老玩家友好。
拖拽时用现有的 `this.arrow`（`CombatScene.ts:1128` 附近已有箭头绘制逻辑，
现在用于选敌模式）改成跟随指针的贝塞尔曲线。

回弹判定：松手时若指针不在合法目标上 → tween 回原位，不消耗能量。

### 二、键位

沿用 [21 设置](21-settings.md) 定义的 `KeyAction`：

| 键 | 动作 |
|---|---|
| `1`-`0` | 打出手牌第 N 张 |
| `Q`/`W`/`R` | 用第 1/2/3 瓶丹药 |
| `E` | 结束回合（保持现有） |
| `D` | 看牌组 |
| `A` | 看抽牌堆 |
| `S` | 看弃牌堆 |
| `Esc` | 按优先级：关最上层 overlay → 取消选敌 → 打开设置 |
| `Tab` | 展开手牌（查看全部卡面） |
| `Space` | 地图归位（保持现有） |

### 三、关键词 tooltip 系统

这是本条目里**最有价值**的部分，且随 [12 状态库](12-status-library-done.md)
扩到 18 种状态后变成必需。

需要一个统一的 `KEYWORDS` 注册表 + 一个通用的悬停 tooltip 组件。
所有能悬停的地方（卡面关键词、状态图标、意图图标、遗物图标）
走同一套。

## 数据结构

```ts
// src/ui/keywords.ts (新增)

export interface KeywordDef {
  /** 在规则文本里匹配的词。 */
  term: string;
  title: string;
  body: string;
  /** 高亮颜色。状态用 STATUS_META.color，关键词用固定色。 */
  color: number;
}

/** 状态 + 卡牌关键词 + 通用术语（护甲/气/消耗堆…）统一注册。 */
export const KEYWORDS: Record<string, KeywordDef>;

/** 从规则文本里找出所有关键词及其位置，供 CardView 高亮。 */
export function findKeywords(text: string): { term: string; index: number }[];
```

```ts
// src/ui/Tooltip.ts (新增)

export interface TooltipTarget {
  /** 触发区域。 */
  zone: Phaser.GameObjects.GameObject;
  /** 内容。函数形式支持动态内容（当前层数）。 */
  content: () => { title: string; body: string; color?: number }[];
  /** 相对触发区的位置偏好。 */
  side?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
}

/** 场景级 tooltip 管理器：同一时刻只显示一个，自动避开屏幕边缘。 */
export class TooltipManager {
  constructor(scene: Phaser.Scene, depth: number);
  register(target: TooltipTarget): void;
  hide(): void;
  destroy(): void;
}
```

```ts
// src/ui/CardView.ts 增补
export interface CardViewOptions {
  // ...
  /** 悬停放大倍率，0 = 不放大。 */
  hoverScale?: number;
  /** 是否高亮规则文本里的关键词。 */
  highlightKeywords?: boolean;
  /** 拖拽出牌。 */
  draggable?: boolean;
}
```

## 实现步骤

1. `src/ui/keywords.ts`：注册全部关键词。
   状态部分从 `STATUS_META`（`src/combat/cards.ts:4-23`，
   [12](12-status-library-done.md) 扩到 18 项后）自动生成，
   避免两处维护。卡牌关键词从 [13](13-card-keywords-done.md) 的
   `CardKeyword` 生成。再手工加通用术语（护甲、气、消耗、抽牌堆）。
2. `src/ui/Tooltip.ts`：场景级管理器。要点：
   - 同一时刻只显示一个（防止多个 tooltip 叠在一起）
   - 自动翻转避开屏幕边缘（右侧的敌人 tooltip 要往左开）
   - 内容支持多段（一个状态图标可能要同时说明「破绽」和「层数」）
   - 悬停延迟 ~150ms 才出（防止扫过时闪一堆）
   - 样式复用 `inkPanel`（`src/ui/theme.ts`），和地图节点 tooltip 统一
3. `CardView`（`src/ui/CardView.ts`，144 行）：
   - `highlightKeywords`：用 `findKeywords` 找出关键词，
     Phaser 的 `Text` 不支持富文本，所以要么切 `BBCodeText`（要装插件），
     要么把规则文本**按关键词切段**用多个 `Text` 对象拼。
     后者不需要新依赖，但换行处理麻烦——建议先只做「关键词处放一个
     不可见的悬停热区」，颜色高亮作为第二步
   - `hoverScale`：悬停放大 + 抬深度。注意手牌是扇形排布的，
     放大时要**取消旋转**否则读不了
   - `draggable`：`setInteractive({ draggable: true })` + `dragstart`/`drag`/`dragend`
4. **拖拽出牌**（`CombatScene`）：
   - `dragstart`：卡片抬起、半透明化原位占位、开始画箭头
   - `drag`：卡片跟随、箭头从卡片底部到指针的贝塞尔曲线
     （复用现有 `this.arrow` 的绘制，`CombatScene.ts:1128`）
   - 悬停在合法目标上：敌人描边高亮 + **HP 条预览**（见第 6 步）
   - `dragend`：合法目标 → `playCard`；否则 tween 回弹
   - 无目标牌（`target: 'self'`）：拖到屏幕上半部松手即可，
     画一条水平「打出线」提示
5. **数字键**：`1`-`0` 映射手牌索引。按下后：
   - 无目标牌 → 直接打出
   - 单体牌 → 进入选敌模式，若**只有一个存活敌人则直接打**
     （原版行为，省一步）
6. **敌人 HP 条伤害预览**：选中/拖拽攻击卡时，在目标 HP 条上
   用半透明红色标出这一击会打掉的段（`CombatScene.ts:1038` 附近
   已有 HP 条绘制和「damage taken 拖尾段」的逻辑，在那基础上加一个
   预览层）。会致死时 HP 条闪烁 + 显示「必杀」。
7. **`Esc` 优先级**：维护一个 overlay 栈。`Esc` 依次弹出：
   最上层 overlay → 选敌/拖拽状态 → 打开设置。
8. **`Tab` 展开手牌**：按住时手牌展成一排全尺寸（取消扇形和重叠），
   松开恢复。手牌 10 张时特别有用。
9. **手牌扇形自适应**：手牌数量多时收窄间距。现在的布局逻辑要
   按 `hand.length` 动态算间距和旋转角。`MAX_HAND = 10`
   （`src/combat/engine.ts:22`），10 张要能排开不遮挡。
10. 状态图标/意图/遗物图标全部 `tooltipManager.register(...)`。

## 验收标准

- 拖拽劈砍到敌人身上松手能打出；拖到空白处松手回弹且不消耗气
- 拖拽时敌人高亮，HP 条显示这一击会打掉多少
- 会致死时有「必杀」提示
- 点击出牌仍然可用（两种方式并存）
- 按 `3` 打出手牌第三张；只有一个敌人时单体牌按数字键直接打出
- 悬停「破绽」图标出说明，含当前层数
- 悬停卡面上的「消耗」二字出说明
- 悬停意图出完整招式描述（[16 意图](16-intent-system-done.md)）
- 同一时刻只有一个 tooltip；靠右的元素 tooltip 向左展开不出屏
- 悬停卡片放大且旋转归零，规则文本可读
- 手牌 10 张时全部可见可点，不互相遮挡关键信息
- 按住 `Tab` 手牌展开成一排，松开恢复
- 战斗中打开牌堆 overlay 后按 `Esc` 只关 overlay，不打开设置

## 依赖

- [12 状态库](12-status-library-done.md)——18 种状态的说明是 tooltip 的主要内容
- [13 关键词](13-card-keywords-done.md)——卡牌关键词的说明
- [16 意图系统](16-intent-system-done.md)——意图 tooltip
- [21 设置](21-settings.md)——共用 `KeyAction` 定义和确认提示开关，
  建议一起做
- 弱依赖 [07 牌堆查看器](07-deck-viewer-done.md)（overlay 栈的管理）
