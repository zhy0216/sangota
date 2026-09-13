difficulty: hard
agent: inherit

# 15 · 修正跨会话用时、实际伤害和死因统计

方案项：R10、R11。优先级：P2。来源：[仓库改进方案](../plan.md)。

保存累计活动用时，分清结算伤害、HP 损失和致死来源。

## T1 · 修正跨会话用时、实际伤害和死因统计

**要做什么**

- 在 RunState/SavedRun 中持久化累计活动时长，替换续档仅 markRunStart 的现状；由场景传入游戏时钟，明确暂停、后台、标题与结算阶段的计时口径，在已有稳定保存点累加。
- 兼容旧档的累计时长缺值，单调处理时钟回退；Summary 与 Career.totalPlayMs 消费同一最终值，并把 12 的待提交结果冻结到该值。
- 审计 CombatEvent 的 damage/death 与 applyDamage 等产生路径，明确 amount 的现有展示/钩子含义、实际 HP 损失以及伤害来源；必要时新增独立元数据，不能直接改 amount 让钩子或敌人行为变动。
- recordCombatEvents/fightDamageTaken 使用真实 HP 损失，死亡信息取导致死亡的事件；覆盖敌人攻击、自伤/诅咒、毒、反刺和复活，Summary 与战史读取一致的死因。
- 添加有区分度的时钟注入和伤害回归；若统计元数据改变序列化/哈希，证明规则投影和 RNG 仍一致，不能重置黄金快照掩盖差异。

**预计修改的文件**

- `src/state/run.ts`
- `src/state/save.ts`
- `src/state/saveValidation.ts`（07 新增）
- `src/state/history.ts`
- `src/state/settlement.ts`（12 新增）
- `src/combat/types.ts`
- `src/combat/engine.ts`
- `src/scenes/TitleScene.ts`
- `src/scenes/CustomScene.ts`
- `src/scenes/CombatScene.ts`
- `src/scenes/RoomScene.ts`
- `src/scenes/SummaryScene.ts`
- `tests/runStats.test.ts`
- `tests/history.test.ts`
- `tests/engine.test.ts`
- `tests/save.test.ts`
- `tests/settlement.test.ts`（12 新增）
- `tests/integrity.test.ts`
- `tests/browser/run-statistics.test.mjs`（新增）

**验收条件**

- [ ] 注入第一会话 30 分钟、恢复后 15 分钟，结算和总账为 45 分钟；时钟回退、后台/暂停及重复提交不会出现负值或重复累计。
- [ ] 1 HP 敌人遭受 999 结算伤害只计 1 实际伤害；原展示和需要完整伤害的钩子行为保持既有语义。
- [ ] 自伤、毒、反刺、诅咒与复活后的最终死亡来源正确，fightDamageTaken/无伤统计与真实损失一致。
- [ ] 37 个黄金战斗及存档往返通过，玩法最终状态和 RNG 不因时间/统计修正改变。
- [ ] 失败结算重试不继续增长已冻结的 durationMs，也不重新计分。

**前置依赖**：依赖 [13-browser-write-ownership.md](13-browser-write-ownership.md)。

## 独立验证

- bun run test -- tests/runStats.test.ts tests/history.test.ts tests/engine.test.ts tests/save.test.ts tests/settlement.test.ts tests/integrity.test.ts sim/golden.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

R10/R11 共改 run/history/Combat/Summary 与保存统计，合为一个提交；跨模块事件及结算语义按 hard 分发。时长格式化去重留给 23。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
