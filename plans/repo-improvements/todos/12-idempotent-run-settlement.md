difficulty: hard
agent: inherit

# 12 · 实现可恢复且只入账一次的结算

方案项：R06。优先级：P1。来源：[仓库改进方案](../plan.md)。

用稳定 runId 和待提交结果保护多本账写入与征程清理。

## T1 · 实现可恢复且只入账一次的结算

**要做什么**

- 为每次新征程生成并持久化稳定 runId，与可重复 seed 分离；随机身份由平台/展示边界注入，不消耗玩法 RNG。更新保存校验和旧档兼容规则；当前 integrity 测试的熵源约束需要精确覆盖元数据例外，不能放开规则层。
- 在战斗死亡、奇遇死亡和最终胜利的淡出/清档之前持久化待结算结果，包含足够重建结算屏及重试的状态。
- 将 history.settleRun/recordRun、unlocks.applyRunUnlocks 与 ascension.recordAscensionClear 组织为可恢复幂等协议。明确写入顺序、各账去重记录和完成状态；去重不能只检查最近 50 条战史。
- Title/Summary 支持发现并重试待结算结果；只有需要的账都成功持久化后才清除对应征程。每次重试保留相同记录与新纪录判断，不再重新计算随机选择。
- 自定义局仍只显示结算，不写战史/解锁/天命；测试战场保持完全隔离。

**预计修改的文件**

- `src/state/run.ts`
- `src/state/save.ts`
- `src/state/saveValidation.ts`（07 新增）
- `src/state/recovery.ts`（09 新增）
- `src/state/settlement.ts`（新增）
- `src/state/history.ts`
- `src/state/unlocks.ts`
- `src/state/ascension.ts`
- `src/scenes/TitleScene.ts`
- `src/scenes/SummaryScene.ts`
- `src/scenes/CombatScene.ts`
- `src/scenes/RoomScene.ts`
- `src/scenes/InterludeScene.ts`
- `tests/save.test.ts`
- `tests/history.test.ts`
- `tests/unlocks.test.ts`
- `tests/ascension.test.ts`
- `tests/summaryFlow.test.ts`
- `tests/integrity.test.ts`
- `tests/settlement.test.ts`（新增）
- `tests/browser/settlement.test.mjs`（新增）

**验收条件**

- [ ] 对同一 run 连续 settleRun、重启 Summary、重试未完成提交，最终 runs/victories/score/解锁/天命各入账恰好一次。
- [ ] 每个账写入前后以及最终清档前后注入失败并重启，原始待提交结果仍可恢复；存储恢复后能完成提交。
- [ ] 超过 50 局后重试旧 run 不重复入账；同种子新开的两局拥有不同 runId，各自正常计数。
- [ ] 死亡淡出和胜利交接期间关闭页面后仍能结算；自定义/测试战场不污染正式进度。
- [ ] 玩法结果、地图、奖励与 RNG 状态不受 runId 生成影响，规则层仍不能读取墙钟或平台熵源。

**前置依赖**：依赖 [08-progress-ledger-validation.md](08-progress-ledger-validation.md)；依赖 [11-rewards-and-act-recovery.md](11-rewards-and-act-recovery.md)。

## 独立验证

- bun run test -- tests/settlement.test.ts tests/save.test.ts tests/history.test.ts tests/unlocks.test.ts tests/ascension.test.ts tests/summaryFlow.test.ts tests/integrity.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

一个协议需要同时覆盖多本账与全部结束入口，作为一个 hard 任务提交；不扩成云同步、数据库或多存档槽。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
