difficulty: hard
agent: inherit

# 10 · 恢复房间内未完成的选择和交易

方案项：R05。优先级：P1。来源：[仓库改进方案](../plan.md)。

记录房间中的持久化步骤，重载后继续选择且不重复支付。

## T1 · 恢复房间内未完成的选择和交易

**要做什么**

- 扩展 09 的恢复位置与校验，恢复 RoomScene 及其睡眠地图关系；以 run.rooms 账本为事实源持久化当前房间和未完成选择。
- 串联 events.chooseOption/pendingPick/resolvePending、RoomScene 的选牌和战斗启动入口：先持久化已支付结果/待选择数据，再呈现 CardGrid 或奇遇触发战斗；保存并恢复 eventFightNodeId 对应上下文。
- 为商店购买/删牌、营帐休息/升级、宝箱领取和退出建立稳定保存点，保留 stock/loot 已物化随机结果与 commit key。重载后的 UI 从账本重建，不能再扣费、重掷商品或再发奖励。
- 每种新增 payload 都同步 SavedRun 校验；对当前仅存在回调闭包的 pending 操作，用必要的可序列化标识表达，不保存函数或 Phaser 对象。

**预计修改的文件**

- `src/state/recovery.ts`（09 新增）
- `src/state/save.ts`
- `src/state/saveValidation.ts`（07 新增）
- `src/rooms/types.ts`
- `src/rooms/events.ts`
- `src/rooms/shop.ts`
- `src/rooms/campfire.ts`
- `src/rooms/treasure.ts`
- `src/rooms/fight.ts`
- `src/scenes/nav.ts`
- `src/scenes/RoomScene.ts`
- `src/scenes/CombatScene.ts`
- `tests/save.test.ts`
- `tests/rooms.events.test.ts`
- `tests/rooms.shop.test.ts`
- `tests/rooms.campfire.test.ts`
- `tests/rooms.foundation.test.ts`
- `tests/browser/room-recovery.test.mjs`（新增）

**验收条件**

- [ ] 奇遇花费后待删牌/升级/变换时重载，恢复同一合法选择且只扣款一次；选择完成后再次重载不重复执行。
- [ ] 奇遇触发战斗在启动前/战斗中/返回时重载，遭遇、承诺宝物和房间选项状态一致。
- [ ] 商店买入/删牌、营帐休息/升级、宝箱领取各自覆盖动作前后及离开前重载；金钱、牌组、HP、战利品和 RNG 不重复变化。
- [ ] 正常 Room sleep/wake 与 restart 路径均可继续，不能跳过必须完成的房间步骤。

**前置依赖**：依赖 [09-combat-entry-recovery.md](09-combat-entry-recovery.md)。

## 独立验证

- bun run test -- tests/save.test.ts tests/saveValidation.test.ts tests/rooms.events.test.ts tests/rooms.shop.test.ts tests/rooms.campfire.test.ts tests/rooms.foundation.test.ts tests/rooms.fight.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

只补当前房型的恢复语义，不引入整局决策日志或回放系统；房间规则仍通过 rooms/commit.ts 管理一次性动作。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
