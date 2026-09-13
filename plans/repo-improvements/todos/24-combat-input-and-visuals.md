difficulty: hard
agent: inherit

# 24 · 拆出战斗输入与视觉职责

方案项：R22、R14。优先级：P2。来源：[仓库改进方案](../plan.md)。

用行为保护把键盘、拖牌与视觉生命周期从 CombatScene 移出。

## T1 · 拆出战斗输入与视觉职责

**要做什么**

- 先用已有浏览器夹具补齐真实点击出牌、拖牌选敌/取消、键盘结束回合、嵌套覆盖层和场景 shutdown 的行为保护，再做结构移动。
- 从 CombatScene 提取输入绑定/解绑和视觉编排模块，依托现有 combatKeys、dragPlay、eventGroups、vfx；以窄接口访问场景所需对象，避免把整个场景复制到任意类型的服务对象。
- 每个新模块明确 create/init/shutdown 职责，所有输入监听、timer/tween、preview、overlay 释放恰好一次；保留 21 的加载就绪约束与 14 的设置读取。
- 保持 CombatScene 对外 scene key、启动数据、恢复入口以及规则事件消费顺序。记录新的依赖边界，先不移动回合驱动/奖励提交。

**预计修改的文件**

- `src/scenes/CombatScene.ts`
- `src/scenes/combat/input.ts`（新增）
- `src/scenes/combat/visuals.ts`（新增）
- `src/ui/combatKeys.ts`
- `src/ui/dragPlay.ts`
- `src/ui/eventGroups.ts`
- `src/ui/vfx.ts`
- `tests/combatScene.test.ts`
- `tests/combatKeys.test.ts`
- `tests/dragPlay.test.ts`
- `tests/eventGroups.test.ts`
- `tests/browser/combat-input.test.mjs`（新增）
- `docs/architecture.md`（新增，先写战斗边界）

**验收条件**

- [ ] 点击/拖动/键盘同一操作的可玩结果与拆分前一致，取消和嵌套 Esc 不穿透、不留下输入锁。
- [ ] 重复开始/结束/恢复战斗后监听和视觉对象不累计，已销毁对象不会被定时回调访问。
- [ ] 输入与视觉模块不持有存储写入或规则随机权责；规则层不依赖 Phaser。
- [ ] 黄金战斗、已有恢复/设置/资源回归全部通过；保留必要的架构断言，不以减行数作为完成标准。

**前置依赖**：依赖 [14-settings-session-snapshot.md](14-settings-session-snapshot.md)；依赖 [22-javascript-loading-budget.md](22-javascript-loading-budget.md)；依赖 [23-shared-view-logic.md](23-shared-view-logic.md)。

## 独立验证

- bun run test -- tests/combatScene.test.ts tests/combatKeys.test.ts tests/dragPlay.test.ts tests/eventGroups.test.ts sim/golden.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

等待所有交互、存储、统计、设置及资源改动完成再动 CombatScene；25 继续拆同一场景，必须串行。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
