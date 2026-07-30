# 12 · 状态效果库扩充

## 现状

**只有 3 种状态**（`src/combat/types.ts:5`）：

```ts
export type StatusId = 'vulnerable' | 'weak' | 'strength';
```

对应 破绽（受伤 +50%）、怯战（造伤 -25%）、神力（每击 +N）
（`src/combat/cards.ts:4-23`）。

结算规则写在 `computeAttack`（`src/combat/engine.ts:280-286`）里，
是硬编码的三个 if。衰减规则写在 `tickStatuses`（`engine.ts:326-333`），
靠一个 `TICKING` 集合区分「每回合减 1」和「永久」（`engine.ts:30`）。

这个架构撑 3 个状态没问题，但扩到 20 个就会变成一坨 if。而状态效果
**是卡牌设计的原材料**——只有 3 种状态，能设计的卡就只有
「伤害/护甲/上破绽/上怯战/加神力/抽牌」六种。这是 [11 卡池扩容](11-card-rarity-and-rewards-done.md)
的硬约束。

## 原版行为

约 50 种 buff/debuff/power。分类：

**数值修饰类**（改伤害/护甲计算）
| 名 | 效果 |
|---|---|
| Strength | 攻击 +N |
| Dexterity | 获得护甲 +N |
| Vulnerable | 受攻击伤害 ×1.5 |
| Weak | 造成攻击伤害 ×0.75 |
| Frail | 获得护甲 ×0.75 |

**回合触发类**
| 名 | 效果 |
|---|---|
| Poison | 回合开始失去 N 生命，然后 N-1（无视护甲） |
| Regen | 回合结束回复 N 生命，然后 N-1 |
| Metallicize | 回合结束获得 N 护甲 |
| Thorns | 受到攻击时反弹 N 伤害 |
| Ritual | 回合结束获得 N 力量（敌人常见） |
| Burst / Double Tap | 下 N 张技能/攻击牌打两次 |

**规则改写类**
| 名 | 效果 |
|---|---|
| Artifact | 抵消下 N 次 debuff（**在施加时消耗，优先级最高**） |
| Barricade | 护甲不在回合开始清零 |
| Intangible | 所有受到的伤害降为 1（**在所有计算之后**） |
| Buffer | 抵消下 N 次生命损失 |
| Draw Reduction | 下回合少抽 N 张 |
| No Draw | 本回合不能抽牌 |
| Confusion | 手牌费用随机 |
| Entangled | 本回合不能打攻击牌 |

**敌人专属**
Curl Up（首次受击获得护甲）、Angry（受击 +力量）、Split（半血分裂）、
Enrage（每受一张技能牌 +力量）、Time Warp、Invincible（每回合受伤上限）。

关键的**结算顺序**（原版精确顺序，做错了数值会不对）：
```
基础伤害
 → + Strength
 → × Weak（攻击方）→ 向下取整
 → × Vulnerable（防御方）→ 向下取整
 → Intangible 钳到 1
 → 扣护甲
 → Buffer 抵消
 → 扣生命
 → Thorns 反弹
```

两处**修正**（初稿写错了，实现以此处为准）：

1. **Intangible 在扣护甲之前**。原版是先钳到 1 再进护甲，所以「金蝉脱壳 +
   5 护甲」挨一记 30 伤只掉 1 点护甲、0 点体力；放在护甲之后会让这堵墙被
   整个吃掉。
2. **两次乘法各自向下取整**，不能合并成一次。基础 5 同时吃怯战和破绽是
   `floor(floor(5×0.75)×1.5) = 4`，合并取整会得到 5。
   `tests/engine.test.ts` 已经把这个数钉死了。

## 设计方案

**重构成数据驱动**，而不是继续加 if。核心是：

1. `StatusDef` 声明衰减方式和触发时机
2 `computeAttack` 拆成一条**有序的修饰管线**，每个状态注册到管线的某一段
3. Artifact 的拦截逻辑放在 `addStatus` 入口

三国命名（保留现有三个）：

| id | 中文 | 效果 |
|---|---|---|
| vulnerable | 破绽 | 受攻击伤害 +50%（已有） |
| weak | 怯战 | 造成攻击伤害 -25%（已有） |
| strength | 神力 | 每次攻击 +N（已有） |
| dexterity | **身法** | 获得护甲 +N |
| frail | **力竭** | 获得护甲 -25% |
| poison | **中毒** | 回合开始失去 N 体力（无视护甲），然后 N-1 |
| regen | **调息** | 回合结束回复 N 体力，然后 N-1 |
| metallicize | **重甲** | 回合结束获得 N 护甲 |
| thorns | **反刺** | 受到攻击时反弹 N 伤害 |
| artifact | **护身符** | 抵消下 N 次负面状态 |
| barricade | **深沟高垒** | 护甲不在回合开始清零 |
| intangible | **金蝉脱壳** | 受到的伤害降为 1，持续 N 回合 |
| buffer | **天佑** | 抵消下 N 次生命损失 |
| ritual | **蓄势** | 回合结束获得 N 层神力（敌人用） |
| noDraw | **断粮** | 本回合不能抽牌 |
| entangled | **束缚** | 本回合不能打出攻击牌 |
| curlUp | **龟缩** | 首次受到攻击时获得 N 护甲（敌人用） |
| angry | **暴怒** | 每次受到攻击获得 N 层神力（敌人用） |

## 数据结构

```ts
// src/combat/types.ts

export type StatusId =
  | 'vulnerable' | 'weak' | 'strength' | 'dexterity' | 'frail'
  | 'poison' | 'regen' | 'metallicize' | 'thorns' | 'artifact'
  | 'barricade' | 'intangible' | 'buffer' | 'ritual'
  | 'noDraw' | 'entangled' | 'curlUp' | 'angry';

/** 衰减方式。 */
export type StatusDecay =
  | 'none'        // 永久（神力、重甲、反刺）
  | 'endOfTurn'   // 拥有者回合结束 -1（破绽、怯战、力竭、金蝉脱壳）
  | 'tickDown'    // 触发后自身 -1（中毒、调息）
  | 'consume'     // 触发时消耗一层（护身符、天佑、龟缩）
  | 'clearOnTurn';// 我方回合开始清零（断粮、束缚）

export interface StatusMeta {
  label: string;
  desc: string;
  kind: 'buff' | 'debuff';
  color: number;
  decay: StatusDecay;
  /** 是否被护身符拦截（只有 debuff 才拦）。 */
  blockable: boolean;
  /** 图标纹理 key。目前是纯文字方块，扩到 18 种必须上图标。 */
  icon?: string;
}
```

**修正**：初稿的 `endOfTurnAll` 没有调用点。`tickStatuses` 只会在某一方
**自己**的回合边界上被调用，所以金蝉脱壳用 `endOfTurn` 就够了——这也正是
原版的行为（N 层 = 我方 N 个回合）。规则本身（`modify` / `tick` /
`onAttacked`）最终落在 `src/combat/statuses.ts` 的 `StatusDef` 上，
`StatusMeta` 只留展示字段。

```ts
// src/combat/engine.ts —— 伤害管线

export interface DamageContext {
  attacker: Combatant | null;   // null = 无来源（中毒、事件伤害）
  defender: Combatant;
  base: number;
  /** 是否是「攻击」（中毒/losing HP 不吃神力和破绽）。 */
  isAttack: boolean;
  /** 是否无视护甲（中毒）。 */
  pierceBlock: boolean;
}
```

## 实现步骤

1. `src/combat/cards.ts` 的 `STATUS_META`（`cards.ts:4-23`）扩到 18 项，
   每项补 `decay` / `blockable` / `icon`。
2. `engine.ts` 重构 `computeAttack`（`engine.ts:280-286`）→ `resolveDamage(ctx)`，
   按上面的原版顺序实现。**这一步必须先有
   [25 无头模拟](25-headless-sim-and-tests-done.md) 做回归**，否则改完
   不知道数值有没有漂。现有行为（神力 → 怯战 → 破绽 → floor）必须逐位不变。
3. `applyDamage`（`engine.ts:297`）里加 `intangible` 钳制、`buffer` 抵消、
   `thorns` 反弹（注意反弹会致死攻击方，要递归处理死亡判定，
   小心无限递归——反弹伤害的 `isAttack: false`）。
4. `addStatus`（`engine.ts:316`）加护身符拦截：
   ```ts
   if (STATUS_META[status].blockable && target.statuses.artifact) {
     target.statuses.artifact -= 1;
     if (!target.statuses.artifact) delete target.statuses.artifact;
     state.events.push({ t: 'statusBlocked', targetId: target.id, status });
     return;
   }
   ```
5. `tickStatuses`（`engine.ts:326`）按 `decay` 分派，删掉 `TICKING` 集合
   （`engine.ts:30`）。
6. 回合触发点：
   - `startPlayerTurn`（`engine.ts:127`）：中毒结算（在清护甲**之后**、
     抽牌**之前**）、`barricade` 时跳过 `player.block = 0`、清 `noDraw`/`entangled`
   - `endPlayerTurn`（`engine.ts:152`）：调息回血、重甲加甲、蓄势加神力
   - `runEnemyTurn`（`engine.ts:164`）：敌人同样要走这三套，且
     `enemy.block = 0`（`engine.ts:169`）要尊重 `barricade`
7. 护甲获取要走 `gainBlock(state, target, amount, source)`，内部叠
   `dexterity` 加、`frail` 乘 0.75。

   **修正**：`gainBlock` 已经是唯一的 `block +=` 入口（`engine.ts:334`），
   不存在「三处直接 `+=`」。真正的缺口是另外三个：
   - `gainBlock` 内部没有身法/力竭；
   - `startCombat` 的字面量里 `block: mods.startingBlock`（`engine.ts:75`）
     绕过了它；
   - `engine.ts:140`（`state.player.block = 0`）和 `engine.ts:184`
     （`enemy.block = 0`）两处清零要变成尊重深沟高垒的 `clearBlock`。
8. `entangled` / `noDraw`：`canPlay`（`engine.ts:210`）加攻击牌检查，
   `drawCards`（`engine.ts:136`）开头 early-return。
9. 状态图标：18 种文字方块在敌人头上会挤爆。做 20×20 的图标
   （`genmedia` 生成，或者纯 Graphics 画符号），悬停出说明。
   参考原版：图标 + 右下角层数数字。

## 验收标准

- 重构后现有三个状态的数值**逐位不变**（无头回归：同 seed 同操作序列
  的伤害序列与重构前完全一致）
- 中毒 3 层：回合开始掉 3 血（护甲 10 也照掉）、层数变 2
- 反刺 3：敌人攻击我方时自己掉 3 血，多段攻击反弹多次
- 护身符 1 层：下一次破绽被完全抵消并消耗该层，神力（buff）不受影响
- 深沟高垒：回合开始护甲不清零
- 金蝉脱壳 2：一次 30 伤的巨斧只掉 1 血，两回合后失效
- 身法 3 + 铁壁：获得 8 护甲；再加力竭：获得 6 护甲（floor(8×0.75)）
- 束缚：攻击牌变灰不可打，技能牌正常
- 18 种状态图标在敌人和玩家头上都能排开、悬停有说明

## 依赖

- [25 无头模拟](25-headless-sim-and-tests-done.md)——**强依赖**。这是纯规则重构，
  没有回归测试会静默改坏数值
- **产出被复用**：[11 卡池扩容](11-card-rarity-and-rewards-done.md)、
  [13 关键词](13-card-keywords-done.md)、[15 敌人机制](15-enemy-mechanics.md)
  全都建立在状态库上

## 实现记录

和 [13 关键词](13-card-keywords-done.md) 一起落地——两者不可分：13 的
`loseHp` 要 12 的 `DamageContext`，12 的 `tick` 要 13 扩过的效果集合。

- `src/combat/statuses.ts`（新）——18 条 `StatusDef`、`STATUS_ORDER`。
  类型是 `Record<StatusId, StatusDef>`：第 19 个状态在补上这一行之前
  编译不过。`cards.ts` 原样 re-export `STATUS_META`，UI 的 import 路径没动。
- `engine.ts` 的 `computeAttack` / `resolveDamage` / `gainBlock` /
  `addStatus` / `tickStatuses` 全部改成遍历 `STATUS_ORDER` 读槽位，
  没有一个分支认得任何一个状态 id。
- **数值零漂移**：todos/25 的 20 份 golden 快照逐字节不变。
- `BlockSource`：身法/力竭只作用于「行动挣来的」护甲（`card` /
  `enemyMove`），重甲和宝物给的是原值——和原版一致。
- 反弹/中毒/自伤走 `isAttack: false`，这是两个反刺互相弹射不会无限递归的
  唯一原因。

**占位美术**：`src/ui/statusIcons.ts` 用 Canvas 程序化画了 18 个 20×20 的
`status-<id>` 白色线稿图标（按 `RENDER_SCALE` 栅格化，Retina 下不糊），由
pill 按状态色 tint。这不是最终美术，换成真图只需要替换纹理，键名不变。
