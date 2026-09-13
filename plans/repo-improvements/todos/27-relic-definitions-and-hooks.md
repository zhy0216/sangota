difficulty: hard
agent: inherit

# 27 · 分离宝物定义与钩子执行

方案项：R22。优先级：P2。来源：[仓库改进方案](../plan.md)。

整理宝物 registry 和运行期入口，保持掉落及触发顺序。

## T1 · 分离宝物定义与钩子执行

**要做什么**

- 把 combat/relics.ts 中的大型 RELICS 内容定义按现有分组拆出，与 fireHook/fireRunHook、modifier 查询和掉落工具分开；先明确类型和运行期依赖，避免内容模块回读未初始化 registry。
- 保留 relics.ts 的公开导出与查找入口，维持 RELICS 枚举顺序、RELIC_DROP_WEIGHTS、RELIC_LADDER 和钩子执行顺序。
- 针对英雄宝物、同事件多个钩子、夺财/房间进入、伤害修正和存档计数器建立等价验证；承接 15 的 HP 损失元数据语义，不改变伤害钩子的输入。
- 更新依赖方向断言及架构文档，保留无 Phaser、无规则时钟和延迟读取循环表的边界。

**预计修改的文件**

- `src/combat/relics.ts`
- `src/combat/relicTypes.ts`（新增）
- `src/combat/relicHooks.ts`（新增）
- `src/data/relics/definitions.ts`（新增；可按既有武将组继续拆分）
- `tests/relics.test.ts`
- `tests/relicExpansion.test.ts`
- `tests/relicRewards.test.ts`
- `tests/relicRegistry.test.ts`（新增）
- `tests/integrity.test.ts`（确需定位新模块时）
- `tests/imports.test.ts`
- `docs/architecture.md`（24 新增）

**验收条件**

- [ ] 宝物 ID、字段、registry/掉落池顺序、modifiers 与钩子顺序不变；相同种子抽到同一宝物。
- [ ] 多个宝物连锁、房间进入、计数器与恢复后的钩子不重复、不漏掉，实际伤害统计仍符合 15。
- [ ] 从原 relics.ts 导入兼容，首导入顺序测试与循环初始化约束通过。
- [ ] 现有黄金快照、规则不变量和存档往返通过，数值表及快照内容未重写。

**前置依赖**：依赖 [26-ordered-card-registries.md](26-ordered-card-registries.md)。

## 独立验证

- bun run test -- tests/relics.test.ts tests/relicExpansion.test.ts tests/relicRewards.test.ts tests/relicRegistry.test.ts tests/imports.test.ts tests/save.test.ts sim/golden.test.ts
- bun run check
- bun run build
- bun run test:browser

## 集成边界

本任务不同时拆 engine.ts；28 在宝物运行期接口稳定后提取敌人/规则职责。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
