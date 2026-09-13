difficulty: hard
agent: inherit

# 11 · 恢复奖励、幕间和双首领交接

方案项：R05。优先级：P1。来源：[仓库改进方案](../plan.md)。

将领完奖励到下一幕的交接持久化，避免重复发奖或漏战。

## T1 · 恢复奖励、幕间和双首领交接

**要做什么**

- 扩展恢复位置覆盖 CombatScene.showVictory/showBossChest/showSpoils 的欠付奖励以及 nav.returnToMap 的幕间交接。
- 以 claimSpoils、takeCardReward、takePotionDrop、takeBossRelic 的现有账本作为幂等边界；恢复展示尚未回答的步骤，已经回答的步骤不再物化奖励。
- 让 InterludeScene 与 advanceAct 的提交顺序可恢复：跳过动画只加快展示，不能重复清账本、生成下一幕或重复开幕 HP 变化。
- 完整接入 nextDoubleBossNode/secondBossNodeId 的三幕双首领序列，保证第一战结束至第二战开始、第二战奖励至幕间的每个断点可继续。
- 保留最终胜利路由给 12 的待结算协议接入；本任务不重复设计跨局入账。

**预计修改的文件**

- `src/state/recovery.ts`（09 新增）
- `src/state/save.ts`
- `src/state/saveValidation.ts`（07 新增）
- `src/scenes/nav.ts`
- `src/scenes/CombatScene.ts`
- `src/scenes/InterludeScene.ts`
- `src/rooms/fight.ts`
- `src/rooms/types.ts`
- `src/data/acts.ts`
- `tests/save.test.ts`
- `tests/rooms.fight.test.ts`
- `tests/acts.test.ts`
- `tests/browser/act-recovery.test.mjs`（新增）

**验收条件**

- [ ] 普通/精英战奖励与首领宝物、卡牌、丹药选择前后重载，奖励内容稳定且每项最多领取一次。
- [ ] 领完首领奖励后、幕间开始前、advanceAct 提交后及跳过动画时重载，最终只进入同一个下一幕一次。
- [ ] 天命二十重三幕双首领两个遭遇都必须完成，#2 账本与奖励顺序正确；中断不漏掉第二战也不重复第一战。
- [ ] 已有黄金战斗、牌池顺序和正常幕间通过；旧档/新位置校验与 09/10 保持一致。

**前置依赖**：依赖 [10-room-step-recovery.md](10-room-step-recovery.md)。

## 独立验证

- bun run test -- tests/save.test.ts tests/saveValidation.test.ts tests/rooms.fight.test.ts tests/acts.test.ts tests/ascension.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

与 09/10 共用恢复格式，顺序集成；不使用 beforeunload 或延长淡出来代替持久化状态。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
