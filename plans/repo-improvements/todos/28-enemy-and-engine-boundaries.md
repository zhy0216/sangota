difficulty: hard
agent: inherit

# 28 · 整理敌人定义与引擎内部职责

方案项：R22。优先级：P2。来源：[仓库改进方案](../plan.md)。

分离敌人表和伤害等内聚能力，保持协议、意图与确定性。

## T1 · 整理敌人定义与引擎内部职责

**要做什么**

- 把 combat/enemies.ts 的 ENEMIES 和 ACT1/ACT2/ACT3/FINAL 遭遇定义按章节等已有边界拆出，保留 getEnemy/getEncounter/pickEncounter/moveById 与原聚合导出。
- 针对 combat/engine.ts 选择已清晰的伤害结算/预览能力边界作渐进提取，维持 resolveDamage/applyDamage/previewValues/describeCard 等公开入口；引擎仍统一拥有事件队列、回合与 RNG，不能新建第二份战斗状态。
- 冻结敌人/遭遇枚举顺序、phase/move/intentId、增强招式补丁和新旧统计事件语义；任何内部接口改变都需要同一提交适配调用方。
- 若某段递归/钩子耦合无法在不改变行为的单轮任务中安全分开，先记录精确边界并仅提取可验证部分，不把它扩成整个引擎重写。验收以职责清晰和等价为准。
- 更新架构文档与实际模块的导入约束，逐项验证保存重建和黄金结果。

**预计修改的文件**

- `src/combat/enemies.ts`
- `src/combat/engine.ts`
- `src/data/enemies/definitions.ts`（新增；可按章节拆分）
- `src/data/enemies/encounters.ts`（新增）
- `src/combat/damage.ts`（新增，保持单一状态与事件入口）
- `src/combat/cardPreview.ts`（新增）
- `tests/enemies.test.ts`
- `tests/engine.test.ts`
- `tests/intent.test.ts`
- `tests/save.test.ts`
- `tests/imports.test.ts`
- `tests/integrity.test.ts`（确需定位新模块时）
- `docs/architecture.md`（24 新增）

**验收条件**

- [ ] 敌人/遭遇及招式 ID 和顺序完整保留，存档 intentId 在相同 phase 中解析一致，固定种子遭遇不变。
- [ ] 伤害、多段/反刺/复活、预览与实际出牌一致，15 的实际 HP 损失及死亡归因不退化。
- [ ] 全部 37 个黄金战斗、规则/内容不变量、首导入顺序与战斗保存恢复通过；不修改黄金 JSON。
- [ ] 新模块有单一职责与清晰依赖，外部使用 engine/enemies 原入口兼容；未同时改玩法数值或规则。

**前置依赖**：依赖 [27-relic-definitions-and-hooks.md](27-relic-definitions-and-hooks.md)。

## 独立验证

- bun run test -- tests/enemies.test.ts tests/engine.test.ts tests/intent.test.ts tests/save.test.ts tests/imports.test.ts tests/integrity.test.ts sim/golden.test.ts
- bun run check
- bun run build
- bun run test:browser
- bun run desktop:test

## 集成边界

R22 最后一段渐进整理，不是仓库级架构重写。04/09–15/21 的所有实际修复与资源加载必须已集成。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
