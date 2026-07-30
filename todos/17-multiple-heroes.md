# 17 · 多武将与专属卡池

## 现状

**一个武将**。`HEROES`（`src/data/heroes.ts:20-41`）只有关羽，
`DEFAULT_HERO = HEROES.guanyu`（`heroes.ts:43`）。

`TitleScene`（`src/scenes/TitleScene.ts:163`）直接 `startRun(DEFAULT_HERO)`，
没有选将界面——标题页有关羽的立绘卡，但那是展示，不是选择。

卡池是**全局共享**的（`REWARD_POOL`，`src/combat/cards.ts:171-180`），
没有「某张牌属于某个武将」的概念。

武将被动是引擎里的硬编码分支（`src/combat/engine.ts:230-235`），
换第二个武将就得再加一个 if。

README：「One act, one hero.」

## 原版行为

四个角色，每个都是**完整独立的一套内容**：

| 角色 | HP | 初始遗物 | 核心机制 | 独有资源 |
|---|---|---|---|---|
| Ironclad | 80 | Burning Blood（战后回 6 血） | 力量叠加、自伤换收益 | — |
| Silent | 70 | Ring of the Snake（首回合多抽 2 张） | 中毒、飞刀、过牌 | Shivs |
| Defect | 75 | Cracked Core（战斗开始 1 个闪电球） | 元素球编排 | **Orbs**（独立资源系统） |
| Watcher | 72 | Pure Water（起手 1 张奇迹） | 姿态切换（Calm/Wrath/Divinity） | **Stance**（独立资源系统） |

关键点：

- 每个角色 **75 张专属牌**，完全不共享（除 colorless）
- 每个角色的**遗物池**部分独立（角色专属遗物）
- **Defect 和 Watcher 引入了全新的资源系统**（球位、姿态），
  这不是数值差异，是规则差异——这才是原版四角色重玩价值的来源
- 每个角色独立的解锁进度、独立的分数记录、独立的 Ascension 进度

## 设计方案

三国题材的四将，按势力分，每个给一套**独有资源机制**（不能只是数值不同）：

| 武将 | 势力 | HP | 初始宝物 | 核心机制 | 独有资源 |
|---|---|---|---|---|---|
| **关羽** ✅ | 蜀 | 82 | 青龙偃月刀（首攻 +3） | 神力叠加、单体爆发 | — |
| **赵云** | 蜀 | 74 | 涯角枪（首回合多抽 2 张） | 连击、过牌、多段 | **连击数**（本回合已打出的攻击牌数，部分牌按它 scale） |
| **诸葛亮** | 蜀 | 68 | 羽扇（起手 1 张「锦囊」） | 计谋、控制、消耗流 | **锦囊**（战斗中生成的一次性强力牌，类似 Shivs） |
| **周瑜** | 吴 | 72 | 火攻图（战斗开始给全体上 1 层灼烧） | 灼烧 DOT、群体 | **灼烧层数**（叠加型 DOT，回合结束按层数掉血且不衰减） |

第一步只做**赵云**——连击机制最简单（一个 `attacksThisTurn` 计数器），
能验证「多武将」的全部架构改动，成本远低于诸葛亮/周瑜。

### 必须做的架构改动

1. **卡牌归属**：`CardDef` 加 `hero: string | 'colorless'`，
   卡池按武将过滤
2. **武将被动搬进遗物**：这是 [01 遗物](01-relics.md) 里已经列的工作，
   多武将会让它变成硬要求（4 个 if 分支不可接受）
3. **独有资源的挂载点**：`CombatState` 需要一个武将专属的状态槽，
   不能给每个武将往 `CombatState` 加字段
4. **选将界面**

## 数据结构

```ts
// src/data/heroes.ts
export interface HeroDef {
  // ...现有字段
  /** 初始宝物 id，替代硬编码 passive。 */
  starterRelic: string;
  /** 该武将的专属卡池（不含 colorless）。 */
  cardPool: string[];
  /** 该武将专属遗物（会加入普通/罕见/稀有池）。 */
  exclusiveRelics: string[];
  /** 独有资源的声明。没有就不填。 */
  resource?: HeroResourceDef;
  /** 解锁状态。见 [23]。 */
  unlockedBy?: string;
}

export interface HeroResourceDef {
  id: string;                 // 'combo' | 'stance' | 'burn'
  label: string;              // '连击'
  /** 战斗开始的初值。 */
  initial: number;
  /** 什么时候重置。 */
  resetOn: 'turn' | 'combat' | 'never';
  /** HUD 显示位置和样式提示。 */
  display: 'counter' | 'badge';
}
```

```ts
// src/combat/types.ts
export interface CombatState {
  // ...
  /** 武将独有资源。key = HeroResourceDef.id。 */
  heroResource: Record<string, number>;
  /** 本回合已打出的攻击牌数（赵云连击用，也可给遗物用）。 */
  attacksThisTurn: number;
  cardsPlayedThisTurn: number;
}
```

```ts
// src/combat/cards.ts
export interface CardDef {
  // ...
  /** 归属武将，或 'colorless'（通用）。 */
  hero: string | 'colorless';
}

/** 按武将 + 稀有度取池。 */
export function poolFor(heroId: string, rarity: CardRarity): string[];
```

## 实现步骤

1. **先完成 [01 遗物](01-relics.md) 的被动搬迁**。关羽的
   `firstAttackUsed`（`engine.ts:230-235`）必须先变成遗物，
   否则第二个武将没法接。
2. `cards.ts`：给 11 张现有牌加 `hero: 'guanyu'`（其中通用性强的
   如「观阵」「铁壁」可以标 `'colorless'`）。
   `CARD_POOL_BY_RARITY`（见 [11](11-card-rarity-and-rewards.md)）
   改成按武将建索引。
3. `heroes.ts`：加赵云的 `HeroDef`，`cardPool` 列 20+ 张新牌，
   `resource: { id: 'combo', label: '连击', initial: 0, resetOn: 'turn', display: 'counter' }`。
4. `engine.ts`：
   - `startCombat`（`engine.ts:43`）初始化 `heroResource` 按
     `hero.resource.initial`
   - `playCard`（`engine.ts:217`）里递增 `attacksThisTurn` / `cardsPlayedThisTurn`
   - `startPlayerTurn`（`engine.ts:127`）按 `resetOn` 重置
   - `StartCombatOptions` 加 `hero: HeroDef`
5. 赵云的连击卡：用 [13 关键词](13-card-keywords.md) 的 `conditional`
   加一个新 condition `{ c: 'comboAtLeast'; n: number }`，
   以及一个新 effect `{ kind: 'scaleWithResource'; resource: string; per: Effect[] }`。
   典型卡：「七探盘蛇」造成 4 伤，本回合每张已打出的攻击牌额外 +3。
6. **选将界面**：`TitleScene` 的「出征」→ 新场景 `HeroSelectScene`
   （或 TitleScene 的一个模式）：
   - 武将立绘横排（现有 `hero-guanyu` 那种全身图）
   - 选中后右侧显示：HP、初始宝物、机制说明、初始牌组预览（复用
     [07 牌堆查看器](07-deck-viewer-done.md) 的网格）
   - 未解锁的武将压暗 + 显示解锁条件（见 [23 解锁](23-compendium-and-unlocks.md)）
   - 下方「种子」输入框（见 [23](23-compendium-and-unlocks.md) 里的自定义模式）
7. `startRun(hero, seed)`（`src/state/run.ts:22`）已经接受 hero 参数，
   只需要 `relics: [hero.starterRelic]` 和把 `cardPool` 存进 run
   （或每次从 `hero.id` 查，后者更省存档空间）。
8. HUD 显示独有资源：赵云的连击数放在气球旁边，
   数值变化时弹一下。`display: 'badge'` 的（周瑜的姿态类）用另一种样式。
9. 美术：赵云的立绘 + 头像 + 20 张卡面。这是**最大的工作量**，
   走 `genmedia`，风格提示词沿用 README 里那一行（水墨 × 暗色手绘卡牌）。

## 验收标准

- 标题页能选将，选关羽和赵云开出的跑团初始牌组/HP/宝物都不同
- 关羽的首攻 +3 由遗物驱动，赵云没有这个效果
- 赵云的战斗 HUD 显示连击数，打一张攻击牌 +1，回合开始归零
- 「七探盘蛇」的卡面数字随连击数实时变化（打了 2 张攻击后显示 10）
- 战斗奖励**只出关羽的牌**（玩关羽时），加上 colorless
- 商店库存同样按武将过滤
- 赵云专属遗物只在玩赵云时出现
- 选将界面能预览初始牌组
- [08 存档](08-save-resume.md) 能正确恢复武将和独有资源

## 依赖

- [01 遗物](01-relics.md)——**强依赖**，被动必须先搬进遗物系统
- [11 稀有度](11-card-rarity-and-rewards.md)——卡池要先按稀有度分组才好按武将分
- [13 关键词](13-card-keywords.md)——独有资源的 scaling 需要条件/缩放效果
- [07 牌堆查看器](07-deck-viewer-done.md)——选将界面的牌组预览
- 弱依赖 [23 解锁](23-compendium-and-unlocks.md)（武将解锁条件）
