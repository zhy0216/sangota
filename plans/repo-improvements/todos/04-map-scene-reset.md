difficulty: easy
agent: inherit

# 04 · 重置地图场景的临时交互状态

方案项：R12。优先级：P2。来源：[仓库改进方案](../plan.md)。

让 restart 后的抽屉标记、位置和拖动状态一致。

## T1 · 重置地图场景的临时交互状态

**要做什么**

- 在 MapScene 每次重新创建时明确复位 drawerOpen、dragging、dragDistance、leaving 与失效的临时对象引用；核对 views、tooltip 等对象是否由 Phaser shutdown 管理。
- 保留 RoomScene 导致的 Map sleep/wake 语义及滚动位置；不要把正常 wake 也当作 restart 清空。
- 增加使用公共浏览器夹具的实际抽屉打开→地图重启，以及地图→战斗→地图往返回归。

**预计修改的文件**

- `src/scenes/MapScene.ts`
- `tests/browser/map-lifecycle.test.mjs`（新增）

**验收条件**

- [ ] 打开抽屉后 restart，隐藏位置对应 drawerOpen=false，第一次点击即可打开；Esc 不被旧状态吞掉。
- [ ] 离开战斗重建 Map 后交互正常；非战斗房 sleep/wake 保留预期滚动与抽屉状态。
- [ ] 重建时没有残留拖动、重复监听或已销毁对象访问。

**前置依赖**：依赖 [01-browser-behavior-foundation.md](01-browser-behavior-foundation.md)。

## 独立验证

- bun run test:browser
- bun run check
- bun run build

## 集成边界

独占 MapScene 的生命周期小修复；后续保存反馈和导航任务等此任务完成再改该文件。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
