# 16 · 意图显示系统

## 现状

意图是**一行中文短字符串**，由 `intentLabel`（`src/combat/engine.ts:383-397`）拼出来：

```ts
if (move.damage) {
  const perHit = computeAttack(move.damage, enemy, state.player);
  const hits = move.hits ?? 1;
  const dmg = hits > 1 ? `${perHit}×${hits}` : `${perHit}`;
  if (move.block) return `攻 ${dmg} · 守`;
  if (move.status) return `攻 ${dmg} · 弱`;
  return `攻 ${dmg}`;
}
if (move.intent === 'buff') return move.block ? '强化 · 守' : '强化';
if (move.intent === 'defend') return '守';
return move.label;
```

做对了的地方：**伤害数字已经算过怯战/神力/破绽**（调了 `computeAttack`），
这是关键的正确性，很多同类项目会显示基础值导致玩家算错。

问题：

- `IntentKind`（`src/combat/types.ts:62`）只有 5 种，覆盖不了 [15 敌人机制](15-enemy-mechanics-done.md)
  要加的召唤/逃跑/塞牌/未知/睡眠
- `攻 5 · 弱` 这种拼接**丢信息**：上的是怯战还是破绽？几层？
- 纯文字在 3 个敌人同屏时可读性差（`CombatScene.ts:1079` 附近按意图配色，
  只有三档颜色）
- 没有「未知」意图，所以 `hiddenFirstIntent` 无处显示
- 悬停没有详细说明（原版悬停意图会显示完整招式描述）

## 原版行为

意图是**图标 + 数字**，不是文字：

| 图标 | 含义 |
|---|---|
| 剑（大小三档） | 攻击，数字 = 实际伤害，`N×M` 表示多段 |
| 盾 | 防御 |
| 剑+盾 | 攻击并防御 |
| 上箭头 | Buff 自己 |
| 下箭头（紫） | Debuff 玩家 |
| 下箭头（灰） | 强力 debuff |
| 齿轮/漩涡 | 特殊行为（召唤、变形） |
| `?` | 未知 |
| Zzz | 睡眠 |
| 跑步小人 | 即将逃跑 |

细节：

- **剑的图标大小随伤害档位变化**（<5 / 5-15 / 15-25 / >25），
  让玩家一眼看出「这下要死」
- 伤害数字是**最终值**（吃了所有 buff/debuff）
- 悬停意图 → 显示招式名 + 完整描述
- 意图在敌人回合**执行前**高亮，执行后清空

## 设计方案

### 扩展意图类型

```ts
export type IntentKind =
  | 'attack'          // 攻
  | 'attack-defend'   // 攻 + 守
  | 'attack-debuff'   // 攻 + 施加负面
  | 'defend'          // 守
  | 'defend-buff'     // 守 + 强化
  | 'buff'            // 强化自身
  | 'debuff'          // 施加负面
  | 'strong-debuff'   // 强力负面（塞诅咒/状态牌）
  | 'special'         // 召唤、分裂、变形
  | 'escape'          // 即将逃跑
  | 'sleep'           // 睡眠
  | 'unknown';        // ？
```

`IntentKind` 应当**由引擎从 move 推导**，而不是让每个 `EnemyMove` 手填
（现在 `enemies.ts` 里手填的 `intent` 和实际效果已经有不一致的地方：
`bandit` 的 `ambush` 标了 `'debuff'` 但其实有 4 点伤害，
`huaxiong` 的 `fury` 标 `'buff'` 但有 8 护甲）。改成推导能消除这类错位。

### 结构化意图数据

`intentLabel` 返回字符串是错的抽象层级——视图需要的是结构化数据：

```ts
export interface IntentDisplay {
  kind: IntentKind;
  /** 单段最终伤害。null 表示无攻击。 */
  damage: number | null;
  hits: number;
  /** 伤害档位，决定图标大小。 */
  tier: 'none' | 'light' | 'medium' | 'heavy' | 'lethal';
  /** 附加标记，各自一个小图标。 */
  marks: ('block' | 'buff' | 'debuff' | 'cards' | 'summon')[];
  /** 悬停详情：招式名 + 完整效果描述。 */
  tooltip: { title: string; body: string };
}

export function intentOf(state: CombatState, enemy: EnemyState): IntentDisplay | null;
```

`tier` 用**占玩家当前 HP 的比例**判档更合理（原版用绝对值，
但本项目玩家 82 血 vs 吕布 16 伤的关系和原版不同）：

```
none    无攻击
light   总伤害 < 当前 HP 的 10%
medium  < 25%
heavy   < 50%
lethal  ≥ 当前 HP（含护甲折算后仍致死）→ 红色脉动警示
```

`lethal` 档要**明显警示**——这是原版没有但很值得加的：
玩家最常见的死法是没算清这回合会不会被打死。

## 实现步骤

1. `types.ts`：扩 `IntentKind`，加 `IntentDisplay`。
   `EnemyMove.intent` 字段**删除**（改为推导），或保留为可选覆盖。
2. `engine.ts`：`intentLabel`（`engine.ts:383`）→ `intentOf`：
   - 从 move 的字段推导 `kind`（有 damage + block → `attack-defend`，
     有 damage + status.to==='player' → `attack-debuff`，等等）
   - `damage` 走 `computeAttack`（保持现有正确行为）
   - `tier` 按 `damage × hits` 对比 `state.player.hp + state.player.block`
   - `tooltip.body` 从 move 字段生成完整句子
     （「造成 5 点伤害两次，并施加 1 层怯战」）
   - 多敌人时 `lethal` 要看**全场总伤害**，不是单个敌人——
     加一个 `totalIncomingDamage(state)` 供 HUD 用
3. `enemies.ts`：删掉手填的 `intent` 字段（4 个敌人共 12 个 move），
   顺便修掉上面提到的两处标注错位。
4. 意图图标美术：**建议用 Graphics 画而非位图**——图标是纯几何形状
   （剑、盾、箭头），Graphics 在 HiDPI 下天然锐利，也不用管
   README 里那套导出倍率的讲究。剑的四个档位用同一路径不同 scale。
5. `CombatScene` 意图徽章重做（现在在 `CombatScene.ts:1079` 附近）：
   - 图标 + 数字（`N` 或 `N×M`）横排
   - 附加 marks 排在右下角，小一号
   - `lethal` 档：徽章描边变 `C.cinnabarBright` 并做 0.9↔1.1 的脉动 tween
   - `unknown`：显示一个毛笔「？」
   - 悬停 → `inkPanel` tooltip（复用 `src/ui/theme.ts`，和地图节点 tooltip
     一个样式，`MapScene.ts` 里有现成的）
6. HUD 加一个**本回合总入伤**提示：玩家护甲数字旁显示
   「← 12」（即将受到 12 伤），护甲不足时标红。这比让玩家自己加三个敌人的
   数字要友好得多，且不降低难度（信息本来就是公开的）。
7. 意图在敌人回合执行前放大高亮、执行后淡出（现在有
   「intent-badge reveals」的动画，README 提到了，在那基础上加执行时的高亮）。

## 验收标准

- 4 个现有敌人的意图显示与重构前**信息等价或更多**，伤害数字仍然是最终值
- 敌人有神力时意图数字实时变大；玩家有破绽时也变大
- 多段攻击显示 `5×2`，档位按总伤害 10 判定而不是单段 5
- 即将致死时徽章红色脉动（三个敌人合计致死也要触发）
- `hiddenFirstIntent` 敌人首回合显示「？」，悬停显示「意图不明」
- 召唤/逃跑/塞牌各有独立图标，不再退化成 `move.label` 文字
- 悬停任意意图显示完整招式描述
- HUD 的「本回合总入伤」数字与实际结算结果一致（含怯战/破绽）
- 图标在 HiDPI 下锐利（Graphics 绘制，不是位图缩放）

## 依赖

- [15 敌人机制](15-enemy-mechanics-done.md)——新意图类型的来源
- [12 状态库](12-status-library-done.md)——tooltip 要描述新状态；
  金蝉脱壳会让「即将致死」判定失效，`tier` 计算要考虑
