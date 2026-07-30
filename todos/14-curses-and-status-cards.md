# 14 · 诅咒与状态牌

## 现状

完全没有。`CardType`（`src/combat/types.ts:16`）只有三种：

```ts
export type CardType = 'attack' | 'skill' | 'power';
```

`CARD_TYPE_META`（`src/combat/cards.ts:25-29`）对应 攻/谋/势。

牌组只会**变大变强**，从来不会变差。结果是：

- 事件设计的代价维度缺一整块（只能扣血扣钱）
- 「减牌」没有价值，因为牌组里没有真正的废牌（初始的 5 张劈砍 4 张铁壁
  勉强算，但它们至少能用）
- 敌人无法通过「往你牌组塞垃圾」来施压——这是原版中后期敌人的主要手段之一

## 原版行为

两种「负面牌」，机制上不同：

### Curse（诅咒牌）

- **永久进牌组**，跟着跑团走，只能靠商店移除/特定事件/特定遗物清掉
- 大多 `unplayable`（占手牌位置但不能打），少数有代价可打出
- 来源：事件代价、特定遗物（Necronomicon 系）、特定敌人
- 例子：
  - Injury / Doubt / Shame / Regret / Writhe（纯占位或回合结束惩罚）
  - Normality（本回合最多打 3 张牌）
  - Necronomicurse（消耗后立刻回到手上，无法摆脱）
  - Pain（还在手上时每打一张牌失去 1 生命）
  - Ascender's Bane（虚无 + 不可移除，Ascension 10+ 开局送）

### Status（状态牌）

- **只在本场战斗存在**，战斗结束消失，不进牌组
- 由敌人/卡牌效果生成，塞进抽牌堆或弃牌堆
- 例子：
  - Burn（回合结束受 2 伤，然后消耗）
  - Wound（纯占位，unplayable）
  - Dazed（虚无 + unplayable）
  - Slimed（1 费打出并消耗，纯浪费能量）
  - Void（抽到时失去 1 能量）

## 设计方案

三国题材：

```ts
export type CardType = 'attack' | 'skill' | 'power' | 'curse' | 'status';
```

`CARD_TYPE_META` 加两项：诅咒用 `C.blood`（0x8b2020）配黑框，
状态牌用 `C.paperFaint`（0x7a6f5a）配暗灰框——视觉上必须一眼区分于可用牌。

### 诅咒牌（6 张起步）

| 牌 | 效果 | 关键词 |
|---|---|---|
| **贪念** | 不可打出。战斗结束时失去 15 资财。 | unplayable |
| **旧伤** | 不可打出。 | unplayable |
| **疑心** | 不可打出。回合结束时获得 1 层怯战。 | unplayable |
| **奢靡** | 不可打出。虚无。 | unplayable, ethereal |
| **反噬** | 不可打出。还在手上时，每打出一张牌失去 1 体力。 | unplayable |
| **宿命** | 不可打出。本回合最多打出 3 张牌。 | unplayable |

### 状态牌（5 张起步）

| 牌 | 效果 | 关键词 |
|---|---|---|
| **焚营** | 不可打出。回合结束受 2 点伤害，然后消耗。 | unplayable, exhaust |
| **创伤** | 不可打出。 | unplayable |
| **眩晕** | 不可打出。虚无。 | unplayable, ethereal |
| **泥泞** | 1 费打出并消耗（纯浪费一点气）。 | exhaust |
| **醉** | 不可打出。抽到时失去 1 气。 | unplayable |

「醉」用于 [06 事件](06-events.md) 的「醉酒张飞」。

### 两个必须处理的边界

1. **状态牌不能进 `run.deck`**。战斗结束时 `applyCombatResult`
   （`src/state/run.ts:79-81`）只回写 HP，牌组本来就不受战斗影响——
   所以只要保证「战斗内生成的牌不写回 `run.deck`」就自动成立。
   但 [08 存档](08-save-resume.md) 的战斗内存档要能序列化这些临时牌。
2. **诅咒牌不可升级**。`CardDef.upgrade` 缺省即不可升级
   （见 [03 升级](03-card-upgrades-done.md)），刚好对上。营帐锻造的选牌
   界面要把诅咒牌标为 `disabled`。

## 数据结构

```ts
// src/combat/types.ts
export type CardType = 'attack' | 'skill' | 'power' | 'curse' | 'status';

export interface CardDef {
  // ...
  /** 诅咒/状态牌的特殊行为，无法用 Effect 表达的走这里。 */
  hooks?: {
    /** 回合结束时还在手上。 */
    onEndTurnInHand?: (state: CombatState, uid: string) => void;
    /** 被抽到时。 */
    onDrawn?: (state: CombatState, uid: string) => void;
    /** 本场战斗结束时还在牌组/任意堆里。 */
    onCombatEnd?: (state: CombatState, run: RunState) => void;
    /** 在手上时限制其他牌。 */
    restrictPlay?: (state: CombatState) => boolean;
  };
}
```

```ts
// src/combat/cards.ts
export const CURSES: Record<string, CardDef>;
export const STATUS_CARDS: Record<string, CardDef>;
/** 事件可以抽的诅咒池。 */
export const CURSE_POOL: string[];
```

## 实现步骤

1. `cards.ts`：加 `CURSES` / `STATUS_CARDS` 表（11 张），
   并入 `CARDS` 总表（`getCard` 要能查到）但**不进 `CARD_POOL_BY_RARITY`**
   （见 [11](11-card-rarity-and-rewards.md)）——否则会作为奖励出现。
2. `CARD_TYPE_META` 加两项，`CardView`（`src/ui/CardView.ts`）
   按类型换框色。诅咒牌卡框建议加一层暗红噪点或裂纹，视觉上「不祥」。
3. `engine.ts`：
   - `drawCards`（`engine.ts:136`）抽到牌后调 `hooks.onDrawn`
     （「醉」在这里扣气）
   - `endPlayerTurn`（`engine.ts:152`）弃手牌前遍历手牌调
     `hooks.onEndTurnInHand`（「焚营」在这里打 2 伤然后自我消耗、
     「疑心」上怯战）
   - `playCard`（`engine.ts:217`）打牌成功后，遍历手牌里有
     `restrictPlay` 的牌（「反噬」扣血、「宿命」计数）
   - `canPlay`（`engine.ts:210`）检查手上是否有 `restrictPlay` 返回 false 的牌
   - 战斗结束（`checkEnd`，`engine.ts:335`）时遍历所有堆调 `hooks.onCombatEnd`
     （「贪念」扣钱）——注意这需要 `RunState`，`checkEnd` 是纯的，
     所以这一步应当由 `CombatScene` 在结算前调一个
     `resolveCombatEndHooks(state, run)`
4. `addCurse(run, defId)`：往 `run.deck` push 一张 `DeckCard`。
   事件（[06](06-events.md)）和遗物调它。
5. 状态牌生成走 [13 关键词](13-card-keywords-done.md) 的
   `{ kind: 'addCard', defId: 'fenying', count: 2, to: 'discard' }`。
6. **敌人生成状态牌**：`EnemyMove` 需要能塞牌。见
   [15 敌人机制](15-enemy-mechanics.md)——`EnemyMove` 加
   `addCards?: { defId: string; count: number; to: 'draw'|'discard'|'hand' }`。
   典型用法：西凉铁骑的「扬尘」往抽牌堆塞 2 张「创伤」。
7. **移除手段**：[05 商店](05-shop.md) 的弃卡服务是主渠道；
   再做一件「静心香」遗物解锁营帐弃甲（[04](04-campfire.md)）；
   一个「五丈原」事件能清一张诅咒。**必须有足够的移除渠道**，
   否则诅咒只是纯粹的挫败感。
8. 牌堆查看器（[07](07-deck-viewer-done.md)）的排序把诅咒/状态牌排在最后。

## 验收标准

- 「焚营」在抽牌堆里，抽到后回合结束扣 2 血并消耗（不回弃牌堆）
- 「眩晕」回合结束进消耗堆（虚无生效）
- 「醉」被抽到时立刻扣 1 气，且如果当回合气已用完不会变成负数
- 「反噬」在手上时每打一张牌扣 1 血，打出去了就不再扣
- 「宿命」在手上时打满 3 张牌后其余牌变灰
- 「贪念」在牌组里，战斗结束扣 15 资财，且资财不会变负
- 状态牌**战斗结束后不出现在 `run.deck`** 里（打完仗回地图看牌组验证）
- 诅咒牌**战斗后仍在 `run.deck`** 里
- 营帐锻造的选牌界面里诅咒牌是灰的且有原因提示
- 商店弃卡能移除诅咒牌
- 诅咒/状态牌不会作为战斗奖励或商店库存出现

## 依赖

- [13 卡牌关键词](13-card-keywords-done.md)——`unplayable` / `ethereal` / `exhaust`
  是这些牌的基础，`addCard` 是生成手段
- [03 卡牌升级](03-card-upgrades-done.md)——`DeckCard` 实例化
- [11 稀有度](11-card-rarity-and-rewards.md)——确保不进奖励池
- 移除渠道依赖 [05 商店](05-shop.md) / [04 营帐](04-campfire.md)
  ——**不要在移除渠道就绪前上线诅咒**
