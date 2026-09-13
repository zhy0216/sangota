difficulty: medium
agent: inherit

# 14 · 以会话快照保持设置一致

方案项：R09。优先级：P2。来源：[仓库改进方案](../plan.md)。

拒绝持久化时设置仍立即生效，动画查询不重复读盘。

## T1 · 以会话快照保持设置一致

**要做什么**

- 为 settings.ts 增加显式初始化/测试重置接口与 sanitize 后的内存快照，getSettings 返回当前会话事实，updateSettings 先更新内存并通知订阅者，再通过 06 的 adapter 尝试持久化。
- 将写入失败反馈与用户选择分开，保留音频、动画速度、震动、全屏和 SettingsPanel 展示的一致性；同步调整依赖旧的每次读盘行为的测试。
- 处理外部 storage 更新：只安装有效的新快照，明确删除/坏值语义，避免监听回写循环；相同值不重复通知。
- 验证 timing.dur、动画/音频查询在快照不变时不再 getItem/JSON.parse，监听初始化与销毁不会叠加。

**预计修改的文件**

- `src/state/settings.ts`
- `src/ui/timing.ts`
- `src/ui/SettingsPanel.ts`
- `src/audio/sfx.ts`
- `tests/settings.test.ts`
- `tests/timing.test.ts`
- `tests/settingsView.test.ts`
- `tests/audioWiring.test.ts`
- `tests/browser/settings-session.test.mjs`（新增）

**验收条件**

- [ ] 拒绝 setItem 后设置 animSpeed=instant，getSettings、dur、设置面板和音频订阅者仍观察到新值；失败状态单独显示。
- [ ] 连续读取同一快照不会再次读盘/解析，重复初始化/更新不制造重复通知或事件监听。
- [ ] 外部合法 storage 更新进入当前会话；坏值不损坏已生效设置，也不触发循环写入。
- [ ] 存储恢复后新设置可持久化，现有兼容迁移与默认设置测试通过。

**前置依赖**：依赖 [06-storage-io-and-feedback.md](06-storage-io-and-feedback.md)。

## 独立验证

- bun run test -- tests/settings.test.ts tests/timing.test.ts tests/settingsView.test.ts tests/audioWiring.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

与 07/08 及后续恢复链文件不重叠，可在 06 完成后并行；不修改 main.ts 或公共 adapter 接口。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
