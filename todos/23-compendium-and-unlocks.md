# 23 · 图鉴与解锁进度

## 现状

完全没有。`TitleScene`（`src/scenes/TitleScene.ts`，169 行）只有：
关羽的立绘卡、一个「出征」按钮（`TitleScene.ts:130`）。

没有卡牌图鉴、没有敌人图鉴、没有遗物图鉴（遗物本身也还没有，
见 [01](01-relics-done.md)）、没有解锁系统、没有种子输入。

内容全部在第一局就完全暴露：11 张牌里 8 张会作为奖励刷出来，
4 个敌人第一局全见过。这意味着**没有「发现新东西」的驱动力**——
而原版靠解锁把 350 张牌分批放出，前 15 局每局都有新卡。

## 原版行为

### 解锁（Unlocks）

- 每个角色独立的解锁轨道：**累积「解锁进度」**（按局末分数换算），
  达到阈值解锁一批内容
- 解锁分三类：卡牌（每批 3 张，可从中三选一优先解锁）、遗物、
  **新角色**（Silent 需通关 Act 3，Defect 需再通关一次，Watcher 再一次）
- 高层 Ascension 也是逐级解锁的（见 [19 天命](19-ascension.md)）
- Beta 艺术、替换配色等装饰性解锁

### 图鉴（Compendium）

三个库，只显示**已解锁/已见过**的内容：

| 库 | 内容 | 可做的事 |
|---|---|---|
| 卡牌库 | 按角色分类，可看升级态 | 按类型/费用/稀有度筛选排序 |
| 遗物库 | 按档位分类 | 看完整说明和获取来源 |
| 敌人图鉴 | 按幕分类 | **看敌人的完整招式表和 HP 区间**——这是原版给硬核玩家的信息层，看了才能精确算 |

### 其他标题页功能

- **自定义模式**：手动指定种子 + 开关任意 modifier（原版叫 Custom Mode，
  不计分不解锁）
- **每日挑战**：固定种子 + 随机 modifier 组合，全球排行
- 统计页（见 [22 结算与统计](22-run-summary.md)）

## 设计方案

三国题材：图鉴叫**「典籍」**，分三卷：**牌卷 / 宝卷 / 敌卷**。

### 解锁轨道（本项目版）

规模比原版小，所以阈值也要小。用**累积分数**做进度：

| 累积分数 | 解锁 |
|---|---|
| 200 | 关羽卡组第一批（3 张三选一） |
| 500 | 关羽卡组第二批 + 2 件普通宝物 |
| 900 | 关羽卡组第三批 + 1 件稀有宝物 |
| 通关一次 | **赵云** |
| 通关两次（任意武将） | **诸葛亮** |
| 通关三次 | **周瑜** |

「三选一优先解锁」的机制值得照做——让玩家对下一局有期待。

### 敌卷的信息层

敌卷显示**已遭遇过**的敌人的完整数据：HP 区间、全部招式
（伤害/段数/护甲/状态/权重/最大连续次数）。这些数据本来就在
`ENEMIES`（`src/combat/enemies.ts:3-94`）里，只是玩家看不到。
公开它不会降低难度——原版的判断是「让玩家能精算是好事」，
本项目应该照做。

### 自定义模式

种子输入 + 几个开关。**必须标记为不计分不解锁**，
否则解锁系统会被 seed-scumming 绕过。

## 数据结构

```ts
// src/state/unlocks.ts (新增)

export interface UnlockState {
  version: number;
  /** 每个武将的累积解锁分数。 */
  progress: Record<string, number>;
  /** 已解锁的卡牌 id。 */
  cards: string[];
  /** 已解锁的宝物 id。 */
  relics: string[];
  /** 已解锁的武将 id。 */
  heroes: string[];
  /** 已见过的敌人 id（用于敌卷）。 */
  seenEnemies: string[];
  /** 已见过的事件 id（用于典籍第四卷，可选）。 */
  seenEvents: string[];
  /** 待玩家三选一的解锁批次。 */
  pendingChoice: { heroId: string; options: string[] } | null;
}

export function getUnlocks(): UnlockState;
/** 局末调用：累加分数并返回本次新解锁的内容（用于结算界面展示）。 */
export function applyRunUnlocks(rec: RunRecord): {
  newCards: string[]; newRelics: string[]; newHeroes: string[];
  pendingChoice: UnlockState['pendingChoice'];
};
/** 内容是否已解锁——所有随机池抽取都要过这个过滤。 */
export function isUnlocked(kind: 'card' | 'relic' | 'hero', id: string): boolean;
```

```ts
// src/data/unlockTracks.ts (新增)
export interface UnlockBatch {
  heroId: string;
  atScore: number;
  /** 三选一的卡（玩家选一个优先解锁，其余下一批自动解锁）。 */
  cardChoice?: string[];
  relics?: string[];
}
export const UNLOCK_TRACKS: UnlockBatch[];
```

```ts
// src/state/customRun.ts (新增)
export interface CustomRunConfig {
  seed: string | null;        // null = 随机
  ascension: number;
  /** 不计分不解锁。 */
  scored: false;
  modifiers: {
    startWithAllCards?: boolean;
    infiniteEnergy?: boolean;
    noRelics?: boolean;
    allCurses?: boolean;
  };
}
```

## 实现步骤

1. `src/state/unlocks.ts` + `src/data/unlockTracks.ts`：
   解锁状态 localStorage 持久化（**独立于跑团存档**，见
   [08 存档](08-save-resume.md)）。初始解锁集合要够大：
   关羽 + 现有 11 张牌的一部分，保证第一局能玩。
2. **所有随机池抽取加解锁过滤**（漏一处解锁就形同虚设）：
   - `rollCardReward`（[11](11-card-rarity-and-rewards-done.md)）
   - `rollRelic`（[10](10-relic-rewards-done.md)）
   - 商店库存（[05](05-shop-done.md)）
   - 事件的 `gainCards` / `gainRelic`（[06](06-events-done.md)）
   - 开局祝福（[18](18-neow-blessing.md)）
3. `seenEnemies` 埋点：`startCombat`（`src/combat/engine.ts:43`）
   建敌人时记录。同样通过事件或由 `CombatScene` 写，不要让引擎碰持久化。
4. **解锁触发**：[22 结算](22-run-summary.md) 的 `recordRun` 之后调
   `applyRunUnlocks(rec)`，把新解锁的内容在结算界面**逐个展示**
   （卡牌翻转出现、宝物金光）——这是给失败局的正向反馈，很重要。
5. **三选一界面**：`pendingChoice` 非 null 时，标题页显示一个
   「有新卷可阅」提示，点进去三张牌横排选一。
6. **典籍界面** `src/scenes/CompendiumScene.ts`：
   - 三个 tab：牌卷 / 宝卷 / 敌卷
   - 牌卷：复用 [07 牌堆查看器](07-deck-viewer-done.md) 的网格，
     加筛选栏（武将 / 类型 / 费用 / 稀有度）和「显示升级态」开关。
     未解锁的显示为剪影 + 「未获」
   - 宝卷：图标网格 + 说明 + 档位
   - 敌卷：左侧敌人列表（按幕），右侧立绘 + HP 区间 + **完整招式表**
     （招式名、意图、伤害×段数、护甲、状态、权重）。
     未遭遇的显示为剪影
7. **自定义模式**：标题页「自定义」入口 →
   种子输入框（文本，直接喂给 `startRun(hero, seed)`，
   `src/state/run.ts:22` 已支持）+ 天命选择 + modifier 开关。
   开始后 HUD 常驻显示「自定义 · 不计分」。
8. **种子显示**：地图左下已经在显示 seed（README 提到），
   结算界面也要显示，方便玩家分享和复现。加一个「复制种子」按钮。
9. `TitleScene` 重构：现在 169 行只有一个按钮，要加
   「继续」（[08](08-save-resume.md)）/「出征」/「典籍」/「战史」
   （[22](22-run-summary.md)）/「自定义」/「设置」（[21](21-settings.md)）。
   竖排在关羽立绘右侧，保持现有的水墨版式。

## 验收标准

- 新装的游戏只解锁了初始内容，奖励池里不会出现未解锁的牌
- 一局结束后累积分数增加，达到阈值时结算界面展示新解锁内容
- 三选一界面能选一张优先解锁，选完 `pendingChoice` 清空
- 通关一次后赵云可选（选将界面不再压暗）
- 牌卷能按武将/类型/费用筛选，未解锁的显示剪影
- 敌卷显示已遭遇敌人的完整招式表，数值与 `enemies.ts` 一致
- 未遭遇过的敌人在敌卷里是剪影
- 自定义模式指定种子后，两局的地图/奖励/敌人完全一致
- 自定义模式**不增加解锁进度、不写通关记录、不更新天命进度**
- 解锁进度独立于跑团存档：清除跑团存档不影响解锁
- 结算界面能复制种子

## 依赖

- [22 结算与统计](22-run-summary.md)——**强依赖**，解锁进度来自局末分数
- [07 牌堆查看器](07-deck-viewer-done.md)——牌卷的网格
- [17 多武将](17-multiple-heroes.md)——武将解锁的对象
- [19 天命](19-ascension.md)——难度进度与解锁并列显示
- 过滤点分别依赖 05 / 06 / 10 / 11 / 18
