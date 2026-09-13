difficulty: hard
agent: inherit

# 25 · 拆出战斗回合与奖励编排

方案项：R22、R14。优先级：P2。来源：[仓库改进方案](../plan.md)。

分离回合推进和奖励展示，保留恢复及一次性提交边界。

## T1 · 拆出战斗回合与奖励编排

**要做什么**

- 在 24 的窄接口基础上，从 CombatScene 提取回合/事件驱动以及胜负/奖励编排模块；先画清 init、卡牌选择、敌方回合、autosave、奖励、returnToMap/settlement 的职责。
- 保留 combatIsQuiescent 与待处理事件的保存条件；R05 的欠付奖励、双首领交接和 R06 的待结算提交仍由稳定规则/状态入口负责。
- 奖励模块只组织显示和用户回答，不绕过 rooms/fight.ts 的 commit；回合模块不重新定义引擎规则或持有独立 RNG。
- 扩展真实出牌→胜利→卡牌/丹药/首领宝物选择→地图/幕间，以及失败→结算的浏览器路径；验证恢复这些阶段后仍能继续。更新架构文档。

**预计修改的文件**

- `src/scenes/CombatScene.ts`
- `src/scenes/combat/turnFlow.ts`（新增）
- `src/scenes/combat/rewards.ts`（新增）
- `src/scenes/combat/input.ts`（24 新增，仅接口适配）
- `src/scenes/combat/visuals.ts`（24 新增，仅接口适配）
- `tests/combatScene.test.ts`
- `tests/summaryFlow.test.ts`
- `tests/save.test.ts`
- `tests/browser/combat-flow.test.mjs`（新增）
- `docs/architecture.md`（24 新增）

**验收条件**

- [ ] 完整正常战斗、奖励、双首领、幕间及失败结算均可通过真实输入完成，各次支付/奖励仍恰好一次。
- [ ] 战斗中待选择、事件待消费、已胜待领奖励的保存门与拆分前一致，重载不丢失欠付资源。
- [ ] 37 个黄金战斗、战斗快照往返、房间账本及结算故障注入回归全部通过。
- [ ] CombatScene 成为可理解的组合入口，输入/视觉/回合/奖励各有明确生命周期与依赖，而不是把原大类搬到另一个大类。

**前置依赖**：依赖 [24-combat-input-and-visuals.md](24-combat-input-and-visuals.md)。

## 独立验证

- bun run test -- tests/combatScene.test.ts tests/summaryFlow.test.ts tests/save.test.ts tests/rooms.fight.test.ts tests/settlement.test.ts sim/golden.test.ts
- bun run test:browser
- bun run check
- bun run build
- bun run desktop:test

## 集成边界

只整理场景编排；26–28 再分内容与规则实现，不能同时改动引擎行为和场景结构。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
