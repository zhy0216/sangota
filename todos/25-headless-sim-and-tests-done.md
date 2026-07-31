# 25 · 无头模拟与自动化测试

## 现状

**仓库里没有任何测试文件**（`find . -name "*test*"` 在 `src/` 下零结果），
`package.json` 也没有 test 脚本——只有 `dev` / `build` / `preview` / `typecheck`。

但 README 里有这样一段：

> **Balance** — 150 simulated fights per tier, two AI policies:
> | | greedy AI | threat-aware AI |
> | trash | 100% win · 6.1 turns | 100% win · 4.2 turns |
> | elite 华雄 | 85% · 23 hp left | 94% · 29 hp left |
> | boss 吕布 | 41% · 17 hp left | 71% · 17 hp left |

也就是说**这些模拟确实跑过，但代码没有留下来**。这是最可惜的一处：
架构已经为无头模拟做好了准备——README 说
「The rules live in `combat/engine.ts` as pure functions with no Phaser import,
so the whole system is testable headlessly」，而且确实如此
（`src/combat/engine.ts` 397 行零 Phaser import，`src/core/rng.ts` 是
确定性的 mulberry32）。

现在的问题是：**没有回归网**。而 todos 里排的工作有一半是纯规则重构：

- [12 状态库](12-status-library-done.md) 要重写 `computeAttack` 的伤害管线
- [13 关键词](13-card-keywords-done.md) 要改牌的整个生命周期
- [15 敌人机制](15-enemy-mechanics-done.md) 要改意图选择和 move 执行
- [19 天命](19-ascension.md) 要在十几个点插入倍率
- [11 卡池扩容](11-card-rarity-and-rewards-done.md) 要标定 24 张牌的平衡

这些改动**不可能靠手玩验证**。手玩一场战斗 90 秒，验证一次伤害管线
重构要跑几十场。而且数值漂移是静默的——改错了游戏照样能玩，
只是难度悄悄变了。

**这一条应该第一个做。**

## 原版做了什么

《杀戮尖塔》的开发者公开谈过他们的平衡流程：靠**大量自动模拟**
（内部有 AI 跑数万局）+ Beta 玩家数据。原版的 mod 社区也有成熟的
模拟器（用于计算最优出牌）。

关键点不是「测试覆盖率」，而是**用模拟代替直觉来定数值**。

## 设计方案

三层，从便宜到贵：

### 一层 · 单元测试（快，每次改动都跑）

针对纯函数的精确断言：

| 目标 | 断言例子 |
|---|---|
| `computeAttack` | 基础 6 + 神力 2 = 8；再上怯战 = floor(8×0.75) = 6；再上破绽 = floor(6×1.5) = 9 |
| `applyDamage` | 护甲 5 挨 8 伤 → 护甲 0、掉 3 血、事件 `blocked: 5` |
| 状态衰减 | 破绽 2 层在回合结束变 1 层；神力不衰减 |
| `drawCards` | 抽牌堆空时洗弃牌堆；两堆都空时不崩、不发事件 |
| `MAX_HAND` | 手牌 10 张时抽牌无效果 |
| `pickIntent` | `maxRepeat: 2` 的招式不会连续出现第三次 |
| `previewValues` | 卡面数字 === 实际结算伤害（**这条最重要**，卡面说谎是最糟的 bug） |
| `generateMap` | 400 个 seed 全部：每个节点可达、无交叉边、房间规则不违反（README 说验证过，把它变成测试） |
| 存档往返 | `fromSaved(toSaved(run))` 深度相等（[08](08-save-resume-done.md)） |

### 二层 · 黄金回归（防静默漂移）

**这是重构规则时的安全网。** 做法：

1. 固定一组 seed（比如 20 个）
2. 用固定的 AI 策略跑完整战斗，把**每一个 `CombatEvent`** 序列化成快照
3. 存成 `__snapshots__/combat-<seed>.json`
4. 重构后重跑，逐字节对比

伤害管线重构（[12](12-status-library-done.md)）后如果快照完全一致，
就证明没有数值漂移。如果预期会变（比如故意改了数值），
就有意识地更新快照——关键是**变化必须是显式的**。

### 三层 · 平衡模拟（慢，改数值时跑）

复现 README 里那张表并扩展：

- 两个 AI 策略（贪心 / 威胁感知）+ 建议再加一个「随机」做下界
- 每档 500+ 场（150 场的置信区间太宽——41% 胜率在 n=150 时
  95% CI 约 ±8%，看不出 5% 的改动）
- 输出：胜率、平均回合数、平均剩余 HP、HP 分布直方图
- **跨幕全程模拟**（[09 多幕](09-acts-and-progression-done.md) 之后）：
  从开局跑到 Boss，包括选卡（用一个简单的选卡启发式）、
  营帐决策、升级——这才能标定整体难度曲线

## 数据结构

```ts
// sim/policy.ts

export interface Policy {
  name: string;
  /** 返回要打的牌和目标，null 表示结束回合。 */
  chooseAction(state: CombatState): { uid: string; targetId?: string } | null;
  /** [13] 的 pendingChoice 需要策略来消费。 */
  resolveChoice?(state: CombatState, choice: PendingChoice): string[];
  /** [02] 药水的使用决策。 */
  choosePotion?(state: CombatState, potions: string[]): { id: string; targetId?: string } | null;
}

export const POLICIES: Record<'random' | 'greedy' | 'threat', Policy>;
```

```ts
// sim/runCombat.ts

export interface SimResult {
  won: boolean;
  turns: number;
  hpLeft: number;
  hpMax: number;
  /** 完整事件序列，供黄金快照用。 */
  events: CombatEvent[];
  /** 是否触发了保护性中断（说明有 bug）。 */
  aborted: 'turnLimit' | 'noProgress' | null;
}

export function simulateCombat(opts: {
  encounterId: string;
  deck: DeckCard[];
  relics: string[];
  hero: HeroDef;
  hp: number; maxHp: number;
  seed: string;
  policy: Policy;
  ascension?: number;
  maxTurns?: number;      // 默认 60，超了算 aborted
}): SimResult;

export interface TierStats {
  tier: string;
  policy: string;
  n: number;
  winRate: number;
  avgTurns: number;
  avgHpLeft: number;
  /** HP 剩余的十分位，看长尾。 */
  hpPercentiles: number[];
  aborted: number;
}
```

## 实现步骤

1. **测试框架**：用 **Vitest**（和 Vite 同生态，零额外配置，
   `package.json` 已有 vite 6）。加：
   ```json
   "test": "vitest run",
   "test:watch": "vitest",
   "sim": "vitest run sim/balance.sim.ts --reporter=verbose"
   ```
   平衡模拟标成长时用例或独立脚本（`tsx`/`vite-node`），
   **不要**混进常规 `test` —— 500×3×3 场跑几十秒，不适合每次保存都跑。
2. `src/core/rng.ts`：确认所有随机都从这里走。顺便加
   `getState()` / `fromState()`（[08 存档](08-save-resume-done.md) 也需要）。
   **审一遍全项目有没有裸 `Math.random()`**——有一处就会破坏可复现性，
   模拟和快照都会失效。
3. `sim/policy.ts`：
   - `random`：从可打的牌里随机
   - `greedy`：优先打伤害最高的攻击牌，气不够打防御
   - `threat`：算 `totalIncomingDamage`（[16 意图](16-intent-system-done.md)
     会提供），入伤 > 当前 HP 时优先叠护甲，否则打伤害；
     有斩杀机会时优先斩杀
   README 那张表的两个策略就是后两个，实现要能大致复现那些数字
   （trash 100%、华雄 85/94、吕布 41/71）——**如果复现不出来，
   说明现在的引擎行为和当时跑模拟时不同，值得查一查**
4. `sim/runCombat.ts`：驱动循环
   ```
   startCombat → while phase === 'player':
     action = policy.chooseAction(state)
     action ? playCard(...) : endPlayerTurn(state) → runEnemyTurn(state)
   ```
   保护措施：`maxTurns` 上限、以及「连续 N 回合状态哈希不变」的
   无进展检测（防止某个 bug 造成死循环挂住 CI）。
5. **一层单元测试**：按上表写。优先级：
   `computeAttack` / `applyDamage` / 状态衰减 / `previewValues` 一致性 /
   `generateMap` 的 400-seed 属性测试。
6. **二层黄金快照**：
   ```
   sim/__snapshots__/combat-<encounterId>-<seed>-<policy>.json
   ```
   用 Vitest 的 `toMatchSnapshot()` 或手写文件对比。
   **现在就生成一批**——趁引擎还没被 12/13/15 改动，
   这批快照就是「重构前的正确行为」的唯一记录。
7. **三层平衡模拟**：`sim/balance.sim.ts` 输出 markdown 表格，
   直接贴进 README（README 里已有那张表，让它变成生成的而非手写的）。
   加 HP 分布的十分位——平均剩余 17 HP 可能是「大部分 30 血、
   少数 0 血」也可能是「全都 17 血左右」，这两种手感完全不同。
8. **CI**：加一个 GitHub Actions（或至少一个 `npm run check` 脚本）
   跑 `typecheck` + `test`。平衡模拟单独手动触发。
9. **[13 关键词](13-card-keywords-done.md) 的 `pendingChoice` 会破坏模拟的
   同步驱动假设**——`Policy.resolveChoice` 必须在做 13 之前就设计好，
   否则模拟器会在「弃 2 张牌」那里卡死。

## 验收标准

- `npm test` 在几秒内跑完，全绿
- `computeAttack` 的组合断言全部通过（神力/怯战/破绽的乘法顺序和取整位置）
- `previewValues` 与实际结算的一致性测试覆盖全部 11 张牌 ×
  有/无破绽 × 有/无神力 × 有/无怯战
- `generateMap` 的 400-seed 属性测试通过（可达性、无交叉、房间规则）
- 黄金快照生成成功，重跑两次结果逐字节一致
- **故意**把 `VULNERABLE_MULT`（`src/combat/engine.ts:27`）改成 1.4，
  快照测试必须失败（证明网是有效的，不是空转）
- 平衡模拟能复现 README 那张表的量级（±5%）
- 平衡模拟输出含 HP 分布十分位
- 全项目零裸 `Math.random()`（音频除外，见 [20 音频](20-audio.md)）
- 无进展检测能在人为制造死循环时中断并报告

## 依赖

**无依赖，应当第一个做。**

被以下条目依赖（它们都是规则重构，没有回归网会静默改坏数值）：
[11 卡池](11-card-rarity-and-rewards-done.md)、[12 状态库](12-status-library-done.md)、
[13 关键词](13-card-keywords-done.md)、[15 敌人机制](15-enemy-mechanics-done.md)、
[19 天命](19-ascension.md)、[09 多幕](09-acts-and-progression-done.md)
