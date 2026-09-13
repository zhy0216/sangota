difficulty: hard
agent: inherit

# 13 · 阻止旧标签页覆盖新征程

方案项：R08。优先级：P1。来源：[仓库改进方案](../plan.md)。

明确单活跃写入者及接管协议，覆盖保存和结算的旧页写入。

## T1 · 阻止旧标签页覆盖新征程

**要做什么**

- 在浏览器平台边界建立单写入者策略，使用当前目标浏览器实际支持的互斥机制及持久化版本/所有权校验；不能只靠非原子的 localStorage 读后写声称无竞态。
- 将写入资格接入 06 的保存 I/O 和 12 的结算协议，校验 runId 与进度版本；失去所有权的旧页不能继续覆盖、清档或重复入账。
- 通过 storage 事件或 BroadcastChannel 更新提示；第二页可查看并明确接管，接管时先读取并验证最新状态再恢复操作，不合并两个 run。
- 定义持有页关闭/崩溃、刷新、休眠后恢复和无法取得互斥能力时的可恢复策略；需要时间/身份时由平台边界注入且不影响玩法 RNG。保留 Electron 现有单实例锁。
- 用同一 Chromium context 的两个真实 page 编写交错写入与接管回归，状态消息和监听器随生命周期清理。

**预计修改的文件**

- `src/platform/saveOwnership.ts`（新增）
- `src/main.ts`
- `src/state/storage.ts`（06 新增）
- `src/state/save.ts`
- `src/state/settlement.ts`（12 新增）
- `src/scenes/TitleScene.ts`
- `src/scenes/SummaryScene.ts`
- `src/ui/SaveStatus.ts`（06 新增）
- `tests/saveOwnership.test.ts`（新增）
- `tests/integrity.test.ts`
- `tests/browser/write-ownership.test.mjs`（新增）

**验收条件**

- [ ] 两页交替推进时最多一页可写；旧页即使握有旧 run 或待结算结果，也不能覆盖新版本或清除另一局。
- [ ] 明确接管成功后新页继续最新进度；旧页从休眠恢复/重试必须重新验证资格。
- [ ] 关闭持有页、刷新、通信延迟和失败后可重新取得写入权；没有需要玩家手工清 localStorage 的永久死锁。
- [ ] 无互斥能力/存储不可用时采用明确且保守的写入策略，并给出可操作的状态；游戏规则和 Electron 隔离保持不变。

**前置依赖**：依赖 [12-idempotent-run-settlement.md](12-idempotent-run-settlement.md)。

## 独立验证

- bun run test -- tests/saveOwnership.test.ts tests/save.test.ts tests/settlement.test.ts tests/integrity.test.ts
- bun run test:browser
- bun run check
- bun run build
- bun run desktop:test

## 集成边界

虽方案只要求依赖 R05/R07，这里增加 12：两者共享保存/标题/结算写入，必须防止旧页绕过结算协议。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
