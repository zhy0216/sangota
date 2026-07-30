# 02 · 药水系统（丹药）

## 现状

完全没有。`RunState`（`src/state/run.ts:5-18`）没有消耗品容器，战斗
HUD（`src/scenes/CombatScene.ts`）也没有药水槽。

目前玩家在战斗中的全部可用资源就是手牌和 3 点气。一旦手牌卡住（比如连续摸到 4 张
铁壁面对吕布的破军），没有任何翻盘手段——这是当前难度曲线陡峭的主因之一。
README 里记的 boss 胜率（贪心 AI 41%）就是在没有任何应急资源的前提下测的。

## 原版行为

约 50 种药水，3 个槽位（可被遗物扩到 4-5）。

- 战斗内**随时可用、不消耗能量、不占出牌次数**，用完即弃
- 稀有度三档：common / uncommon / rare，掉率随稀有度递减
- 掉落来源：普通战斗 40% 概率、精英战必掉、事件、商店购买
- 槽位满了再掉落时，会问「丢弃一瓶还是放弃新的」
- 效果覆盖面极广：直接伤害、群体伤害、加护甲、抽牌、加能量、上 buff、
  解除 debuff、回血、复制手牌、把敌人打成 Weak、下回合翻倍伤害……
- 部分药水在地图上（非战斗）也能用（回血类）
- Boss 战前的休息点会提醒你「药水没用完」

药水的设计作用是**降低方差惩罚**：抽牌运气差的那一场，用药水兜住。

## 设计方案

三国题材叫**丹药 / 酒囊**，3 槽起步，做 12-16 种，覆盖四类用途：

| 类型 | 例子 | 数值 |
|---|---|---|
| 伤害 | 「火油罐」 | 对单体造成 20 伤害 |
| 防御 | 「金疮药」 | 获得 12 护甲 |
| 资源 | 「壮行酒」 | 本回合 +2 气 |
| 抽牌 | 「军情密报」 | 抽 3 张牌 |
| 增益 | 「虎狼之药」 | 获得 2 层神力 |
| 解控 | 「清心散」 | 移除自身所有负面状态 |
| 回复 | 「续命汤」 | 回复 20% 最大体力（地图上也能用） |
| 稀有 | 「回天丹」 | 本场战斗死亡时改为回复 30% 体力（一次） |

掉落规则照搬原版结构：普通战斗 40%、精英战 100%、Boss 不掉（Boss 给遗物）。
连续没掉时提升概率（原版是掉了 -10%、没掉 +10%，钳在 0-100%），避免长时间干旱。

## 数据结构

```ts
// src/combat/potions.ts (新增)

export type PotionRarity = 'common' | 'uncommon' | 'rare';

export interface PotionDef {
  id: string;
  name: string;
  rarity: PotionRarity;
  art: string;
  text: string;
  /** 需要点敌人吗。 */
  target: 'enemy' | 'self' | 'none';
  /** 战斗外（地图上）能不能用。 */
  usableOutOfCombat: boolean;
  /** 复用卡牌的 Effect 联合类型，避免第二套效果系统。 */
  effects: Effect[];
  /** 少数药水的行为无法用 Effect 表达（比如「本场死亡时复活」），走这里。 */
  special?: 'reviveOnce' | 'cleanseDebuffs' | 'duplicateHand';
}
```

```ts
// src/state/run.ts 增补
export interface RunState {
  // ...
  /** 长度固定 = potionSlots，空槽为 null。 */
  potions: (string | null)[];
  potionSlots: number;
  /** 掉率浮动，见「设计方案」。初始 40。 */
  potionChance: number;
}
```

## 实现步骤

1. `src/combat/potions.ts`：写 `POTIONS` 表 + `POTION_POOL_BY_RARITY`。
   效果直接复用 `Effect`（`src/combat/types.ts:21-26`）——如果 [13 关键词](13-card-keywords.md)
   已经扩过 `Effect`，这里能白嫖大部分效果。
2. `engine.ts` 新增 `usePotion(state, potionId, targetId?)`：
   - 不检查也不扣 `state.energy`
   - 复用 `applyEffect`（`engine.ts:247`）走同一套结算，保证药水和卡牌的
     神力/怯战/破绽交互一致
   - 打完 `checkEnd(state)`
   - push 一个 `{ t: 'potion'; potionId: string }` 事件给场景做动画
3. `special` 三种走独立分支：
   - `cleanseDebuffs`：清 `player.statuses` 里 `kind === 'debuff'` 的项
   - `reviveOnce`：在 `CombatState` 挂 `pendingRevive: boolean`，
     `applyDamage`（`engine.ts:297`）判定致死时先消费它
   - `duplicateHand`：手牌每张复制一份进手（注意 `MAX_HAND` 上限，`engine.ts:22`）
4. `CombatScene` HUD：左下（气球对侧）画 3 个瓶槽。点击 → 有 target 的进入
   选敌模式（复用现有攻击卡的 `this.arrow` 指示逻辑，`CombatScene.ts:1128` 附近）；
   右键或长按 → 「丢弃」确认。
5. `MapScene` HUD 同样画瓶槽，只有 `usableOutOfCombat` 的能点。
6. 掉落：`CombatScene` 结算屏（`CombatScene.ts:1149-1198`）在金币和选卡之间插一行
   药水掉落。用 `new Rng(seed:node:potion)` 保持可复现（和现有
   `${seed}:${nodeId}:reward` 一个套路）。槽位满时给「替换哪一瓶 / 放弃」弹窗。
7. `run.ts`：`addPotion(run, id): boolean`（满了返回 false）、`removePotion(run, slot)`、
   `hasPotionSpace(run)`。
8. 遗物联动：`RelicDef.modifiers` 增加 `potionSlots`，做一件「+2 槽位」的遗物验证联通。

## 验收标准

- 战斗中用「火油罐」对吕布造成 20 伤害，且**吃破绽加成**（说明走的是同一套结算）
- 用「壮行酒」后当回合气变成 5，回合结束正常回到 3
- 槽位满时掉落会弹替换/放弃，选任一都不会卡住流程
- 地图上能用续命汤、不能用火油罐
- 同一 seed 同一路线，药水掉落完全可复现
- 「回天丹」在吕布致死那一击上确实触发一次，且第二次致死会正常死亡

## 依赖

- [01 遗物](01-relics.md)——槽位修饰、掉率修饰的遗物挂在那套 `modifiers` 上
- 建议在 [13 卡牌关键词](13-card-keywords.md) 之后做，`Effect` 扩完了药水能直接复用
