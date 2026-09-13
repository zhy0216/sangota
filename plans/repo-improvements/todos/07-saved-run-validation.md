difficulty: hard
agent: inherit

# 07 · 完整校验征程与战斗存档

方案项：R03。优先级：P1。来源：[仓库改进方案](../plan.md)。

在标题摘要和安装 active run 之前完成结构及关系校验。

## T1 · 完整校验征程与战斗存档

**要做什么**

- 为 readSlot 建立从 unknown 到 SavedRun 的结构校验；同版本缺字段、类型错误、非有限数字、非法整数/范围、未知内容 ID 必须在 summarise 前拒读。
- 将 fromSaved 的重建与 adoptRun 安装分离或加等价预检，完整恢复 combat 后才能安装 active run。校验牌组/战斗牌堆的 uid、uidCursor、敌人阶段/intentId、RNG 状态、英雄、丹药、宝物及各种计数。
- 验证重建地图上的合法连续路径、currentNodeId 与 path 一致性，以及 room ledger 的 kind、payload 和 commit 关系。eventFightNodeId 的 #fight、secondBossNodeId 的 #2 是真实合法账本键，不能一概当成未知地图节点拒绝。
- 版本不符维持 stale，坏输入维持 broken，I/O 不可用沿用 06 的 unavailable。保留原始数据及可诊断原因，不在读取/展示错误时清档。
- 扩展 save 单元测试和真实标题读档回归，并保留现有正常存档往返、确定性和测试战场守卫。

**预计修改的文件**

- `src/state/save.ts`
- `src/state/saveValidation.ts`（新增）
- `src/state/run.ts`（仅重建/安装边界确有需要时）
- `src/scenes/TitleScene.ts`
- `tests/save.test.ts`
- `tests/saveValidation.test.ts`（新增）
- `tests/browser/save-validation.test.mjs`（新增）

**验收条件**

- [ ] 仅含 { version: SAVE_VERSION } 的数据、null/数组/畸形 JSON、错类型/越界数值均不会让标题抛错，继续以外的操作可用。
- [ ] 未知/重复 uid、坏 intentId、不相连路径、账本错型等被拒绝；拒绝前后 active run 与 uidCursor 不变，原存储值不变。
- [ ] 正常战斗、奇遇战和双首领快照均能往返，牌堆、敌人意图、房间账本及 RNG 状态一致。
- [ ] 兼容字段归一化有明确依据；不得为通过坏档测试放松规则或偷偷重置玩法进度。

**前置依赖**：依赖 [06-storage-io-and-feedback.md](06-storage-io-and-feedback.md)。

## 独立验证

- bun run test -- tests/save.test.ts tests/saveValidation.test.ts tests/rooms.fight.test.ts tests/acts.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

此任务先校验现有 v7 语义；09–13 添加恢复/结算元数据时必须同步扩展校验与明确 SAVE_VERSION 兼容策略。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
