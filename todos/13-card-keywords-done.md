# 13 · 卡牌关键词机制

## 现状

`Effect` 联合只有 5 种（`src/combat/types.ts:21-26`）：

```ts
export type Effect =
  | { kind: 'damage'; amount: number }
  | { kind: 'damageAll'; amount: number }
  | { kind: 'block'; amount: number }
  | { kind: 'status'; status: StatusId; amount: number; to: 'target' | 'self' }
  | { kind: 'draw'; amount: number };
```

`CardDef` 没有任何关键词字段。唯一的「特殊行为」是硬编码的
「势（power）牌打完进消耗堆」（`src/combat/engine.ts:239-240`）：

```ts
if (def.type === 'power') state.exhaustPile.push(uid);
else state.discardPile.push(uid);
```

`exhaustPile` 存在（`types.ts:129`）但只有这一个入口。

结果：**每张牌都是「消耗 N 气，产生固定效果，进弃牌堆」**。
没有消耗牌、没有多段攻击、没有 X 费、没有条件效果、没有牌生成。
这直接限制了 [11 卡池扩容](11-card-rarity-and-rewards.md) —— 新卡只能是
现有 11 张的数值变体。

## 原版行为

**卡牌关键词**：

| 关键词 | 效果 |
|---|---|
| Exhaust（消耗） | 打出后离场，本场不再回到牌组 |
| Ethereal（虚无） | 回合结束时若还在手牌则被消耗 |
| Innate（固有） | 战斗开始必在起手 |
| Retain（保留） | 回合结束不弃掉 |
| Unplayable（不可打出） | 只能被别的效果处理（状态牌/诅咒牌） |
| X-cost（X 费） | 消耗全部能量，效果按消耗量 scale |

**效果类型**（原版实际用到的）：

- 多段攻击（`3 damage 4 times`）
- 条件效果（`若敌人有破绽则额外 +N`、`若本回合已打出攻击牌`）
- 自伤（`造成 N 伤害，自身失去 M 生命`）
- 生成牌（把 X 张 Y 牌放入手/弃牌堆/抽牌堆）
- 牌堆操作（弃 N 张、消耗 N 张、把弃牌堆洗回抽牌堆、检视抽牌堆顶）
- 能量操作（+N 能量、本回合能量不清空）
- scaling（`本场每打出一张攻击牌，此牌 +2 伤害`——需要卡实例状态）
- 加倍（下一张攻击牌结算两次）
- 复制（复制手牌里的一张）

## 设计方案

分两块：**关键词**（改牌的生命周期）和**效果扩容**（改结算内容）。

### 关键词

```ts
export type CardKeyword = 'exhaust' | 'ethereal' | 'innate' | 'retain' | 'unplayable';
```

「势」牌打完消耗的硬编码要改成 `keywords: ['exhaust']` 显式声明，
和其他关键词走同一套逻辑——否则会有两套并行的离场规则。

### 效果扩容

保守地扩，每个新 `kind` 都要能被 [02 药水](02-potions-done.md) 和
[15 敌人](15-enemy-mechanics.md) 复用：

```ts
export type Effect =
  // 现有
  | { kind: 'damage'; amount: number; times?: number }        // times 支持多段
  | { kind: 'damageAll'; amount: number; times?: number }
  | { kind: 'block'; amount: number }
  | { kind: 'status'; status: StatusId; amount: number; to: 'target' | 'self' | 'allEnemies' }
  | { kind: 'draw'; amount: number }
  // 新增
  | { kind: 'loseHp'; amount: number }                        // 自伤，无视护甲
  | { kind: 'heal'; amount: number }
  | { kind: 'energy'; amount: number }
  | { kind: 'discard'; amount: number; random?: boolean }      // 非 random 要玩家选
  | { kind: 'exhaustCards'; amount: number }                  // 玩家从手牌选
  | { kind: 'addCard'; defId: string; count: number;
      to: 'hand' | 'draw' | 'discard'; upgraded?: boolean }
  | { kind: 'shuffleDiscardIn' }                              // 弃牌堆洗回抽牌堆
  | { kind: 'doubleNextAttack'; amount: number }              // 加倍层数
  // 条件包装：满足 when 才执行 then，否则执行 otherwise
  | { kind: 'conditional'; when: EffectCondition;
      then: Effect[]; otherwise?: Effect[] }
  // X 费：按实际消耗的能量重复 per 次
  | { kind: 'scaleWithEnergy'; per: Effect[] };

export type EffectCondition =
  | { c: 'targetHasStatus'; status: StatusId; min?: number }
  | { c: 'selfHasStatus'; status: StatusId; min?: number }
  | { c: 'handEmpty' }
  | { c: 'attackPlayedThisTurn' }
  | { c: 'hpBelow'; percent: number }
  | { c: 'enemyCountAtLeast'; n: number };
```

**卡实例 scaling**（「本场每打出攻击牌 +2 伤害」）需要 `CardInstance`
带可变状态：

```ts
export interface CardInstance {
  uid: string;
  defId: string;
  upgraded: number;
  /** 本场战斗内的临时加成，战斗结束丢弃。 */
  bonusDamage?: number;
  bonusBlock?: number;
  /** 本场临时降费。 */
  costOverride?: number;
}
```

## 实现步骤

1. `types.ts`：加 `CardKeyword`、扩 `Effect`、扩 `CardInstance`。
   `CardDef` 加 `keywords?: CardKeyword[]`。
2. `engine.ts`：
   - `startCombat`（`engine.ts:43`）建抽牌堆后，把 `innate` 牌**移到堆顶**
     再抽起手（顺序：洗牌 → 提固有牌 → 抽 5）
   - `playCard`（`engine.ts:217`）离场逻辑改成
     `keywords.includes('exhaust') ? exhaustPile : discardPile`，
     删掉 `def.type === 'power'` 特判，并给所有「势」牌显式加
     `keywords: ['exhaust']`
   - `canPlay`（`engine.ts:210`）：`unplayable` 直接 false
   - `endPlayerTurn`（`engine.ts:152`）：`retain` 牌留在手上、
     `ethereal` 牌进消耗堆而非弃牌堆、其余照旧
   - X 费：`playCard` 里 `cost === -1` 视为 X，扣光 `state.energy`
     并把消耗量传给 `scaleWithEnergy`
3. `applyEffect`（`engine.ts:247`）逐个实现新 `kind`。注意几点：
   - `loseHp` 走 `applyDamage` 的 `pierceBlock` 路径（见
     [12 状态库](12-status-library-done.md) 的 `DamageContext`），且不吃神力/破绽
   - `addCard` 要在 `state.cards` 注册新实例，uid 用递增计数器
     （`state.nextUid`），**不能用随机数**（要可复现）
   - `discard` / `exhaustCards` 非随机版需要**玩家交互**，引擎不能同步完成 →
     引入 `state.pendingChoice`（见下）
   - `conditional` 递归调 `applyEffect`
4. **待玩家选择的效果**是这次最麻烦的部分。引擎是同步纯函数，
   但「从手牌选 2 张消耗」需要等玩家。方案：
   ```ts
   export interface PendingChoice {
     kind: 'discard' | 'exhaust' | 'putOnDraw';
     count: number;
     /** 可选的 uid 范围。 */
     from: string[];
     /** 能不能选少于 count（手牌不足时）。 */
     optional: boolean;
   }
   // CombatState 增加 pendingChoice: PendingChoice | null
   // 场景发现非 null 时弹选牌界面，选完调 engine.resolveChoice(state, uids)
   ```
   `pendingChoice` 非 null 期间 `canPlay` 全部返回 false（锁住操作）。
5. `CardView`（`src/ui/CardView.ts`）：关键词要显示在卡面底部
   （「消耗」「虚无」「固有」「保留」），原版是灰色小字。
   `unplayable` 的卡整体压暗。
6. `describeCard` / `previewValues`（`engine.ts:357-380`）要处理新效果：
   - 多段显示成 `{D}×{T}`
   - 条件效果显示成完整句子，且**满足条件时高亮**（原版会把生效的部分变亮）
   - X 费显示当前能量下的实际值
7. 关键词图标/文字的美术：先用文字，够用。

## 验收标准

- 「势」牌仍然打完就消耗，但走的是 `keywords` 而非类型特判
- 一张 `innate` 牌在 100 次战斗里 100% 出现在起手 5 张里
- 一张 `ethereal` 牌留在手上到回合结束会进**消耗堆**（不是弃牌堆）
- 一张 `retain` 牌回合结束留在手上，且下回合抽牌不会超过 `MAX_HAND`
- 一张 X 费牌在 3 气时打出，效果是 1 气版的 3 倍，且气清零
- 多段攻击「4 伤 ×3」对有破绽的敌人打出 3 次 6 伤（每段独立计算破绽）
- 条件卡「若敌人有破绽则 +5 伤」在有/无破绽两种情况下卡面数字都正确
- 「弃 2 张牌」会弹选牌界面，选完继续结算；手牌只剩 1 张时能选 1 张
- `pendingChoice` 期间不能打其他牌、不能结束回合
- 生成的牌（如塞入弃牌堆的「醉」）在牌堆查看器里能看到，且战斗结束不进 `run.deck`
- 同 seed 同操作序列完全可复现（重点验证 `addCard` 的 uid 分配）

## 依赖

- [12 状态库](12-status-library-done.md)——`loseHp` 需要那边的 `DamageContext`；
  条件效果大量引用状态
- [07 牌堆查看器](07-deck-viewer-done.md)——`pendingChoice` 的选牌 UI 复用它的 pick 模式
- [25 无头模拟](25-headless-sim-and-tests-done.md)——`pendingChoice` 会破坏
  无头模拟的同步假设，模拟器需要一个自动决策策略来消费它
- **产出被复用**：[11 卡池扩容](11-card-rarity-and-rewards.md)、
  [14 诅咒与状态牌](14-curses-and-status-cards-done.md)（`unplayable` 是状态牌的基础）、
  [02 药水](02-potions-done.md)

## 实现记录

和 [12 状态库](12-status-library-done.md) 一起落地，见那边的记录。

- `CardKeyword` 五个全部生效：`exhaust`（「势」牌的类型特判已删除，
  义勇 显式带 `keywords: ['exhaust']`）、`ethereal`、`innate`（洗牌后提到
  牌堆顶，`liftInnate`）、`retain`、`unplayable`。
- `Effect` 扩到 15 种。`cost: -1`（`X_COST`）配 `scaleWithEnergy` 就是 X 费。
  `addCard.upgraded` 是 `number` 不是 `boolean`（跟 `CardInstance.upgraded`
  对齐）；`PendingChoice` 的字段是 `{ kind, options, min, max }` 而不是初稿的
  `{ count, from, optional }`——`sim/policy.ts` 早就按前者做了前向声明，
  照着它做，模拟器不用改接口就能答题。
- `pendingChoice`：效果走 `state.effectQueue`，遇到要玩家选牌就地停住，
  `resolveChoice` 接上继续跑——引擎依然是同步纯函数。
  战斗场景用 [07](07-deck-viewer-done.md) 的 pick 模式弹选牌界面；
  `sim/policy.ts` 三个策略都实现了 `resolveChoice`，`sim/runCombat.ts`
  兜底取前 `min` 张，无头模拟不会死锁。
- 生成的牌用 `state.nextUid` 计数（`g0`、`g1`……），不碰 rng，同 seed 逐字节
  可复现；它们只活在 `state.cards` 里，进不了 `run.deck`。

**故意没做**（各自有独立的爆炸半径，留给后续 todo）：

- `CardInstance.bonusDamage / bonusBlock / costOverride` 这类卡实例状态。
  要让卡面不说谎就得改 `previewValues(state, def, against)` 的签名，而它
  被六个文件调用。
- `doubleNextAttack`：需要 `playCard` 里的重放机制。
