difficulty: hard
agent: inherit

# 09 · 建立恢复位置并修复入战中断

方案项：R05、R14。优先级：P1。来源：[仓库改进方案](../plan.md)。

保存待入战意图，使淡出期间重载仍进入欠下的战斗。

## T1 · 建立恢复位置并修复入战中断

**要做什么**

- 基于 SavedRun / RunState 新增可验证的恢复位置判别联合与统一恢复路由，明确定义 map、待开始战斗、活动战斗的字段/账本关系，并为房间、奖励与幕间扩展留出明确边界。
- 调整 nav.enterRoom，在地图提交进入节点、执行 roomEnter 和视觉淡出之间持久化待入战状态；TitleScene 继续时先校验，再通过统一入口恢复。
- CombatScene 建立遭遇和首个可保存快照后提交活动战斗位置；保留 combatIsQuiescent、snapshotCombat 与 roomCommit 一次性规则。不能简单把 visited=true 当作战斗完成。
- 为恢复格式明确 SAVE_VERSION 与旧档处理策略；无法无歧义恢复的旧数据保留原始值并说明 stale 原因。未完成拜别沿用完成离开时才首次写档的策略，不虚构可恢复的拜别旧档。
- 增加真实节点点击、入战淡出中重载、战斗稳定点重载回归，并通过实际点击/拖动出牌确认恢复后的战斗可继续操作。

**预计修改的文件**

- `src/state/recovery.ts`（新增）
- `src/state/run.ts`
- `src/state/save.ts`
- `src/state/saveValidation.ts`（07 新增）
- `src/scenes/nav.ts`
- `src/scenes/TitleScene.ts`
- `src/scenes/MapScene.ts`
- `src/scenes/CombatScene.ts`
- `src/rooms/fight.ts`
- `tests/save.test.ts`
- `tests/rooms.fight.test.ts`
- `tests/browser/combat-recovery.test.mjs`（新增）

**验收条件**

- [ ] 普通战、精英、首领在 enter 提交后、淡出前/中重载均进入同一遭遇，不能在地图直接选择下一节点。
- [ ] 重载不会重复 roomEnter 金钱、重掷遭遇或消耗不同 RNG；活动战斗的牌堆/意图/HP 与保存快照一致。
- [ ] 合法地图稳定点仍恢复 Map；非法恢复位置/账本组合在标题被拒读，失败不安装半成品 run。
- [ ] 真实点击与拖牌都能推动规则状态；结构静态测试继续保留，不用源码包含字符串替代行为验证。

**前置依赖**：依赖 [07-saved-run-validation.md](07-saved-run-validation.md)。

## 独立验证

- bun run test -- tests/save.test.ts tests/saveValidation.test.ts tests/rooms.fight.test.ts tests/generateMap.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

R05 拆为 09 入战、10 非战斗房、11 奖励/幕间三个可独立通过校验的提交；它们共享 save/nav/CombatScene，必须串行。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
