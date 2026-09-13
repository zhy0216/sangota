difficulty: medium
agent: inherit

# 03 · 修复重开弹窗、自定义替换与种子输入

方案项：R01、R02、R13、R14。优先级：P1。来源：[仓库改进方案](../plan.md)。

统一取消/确认路径，保护正式存档并打通复制种子到自定义开局。

## T1 · 修复重开弹窗、自定义替换与种子输入

**要做什么**

- 修复 TitleScene.confirmDiscard：Esc、再想想、确认与场景销毁共用幂等关闭入口，同时释放 pushOverlay handle 和图层；使用 src/ui/confirm.ts 现有约定，必要时抽出可复用的替换确认组件。
- CustomScene.beginRun 在真正开始自定义征程时使用相同替换确认。进入配置页、返回标题、取消确认以及进入 TestBattleScene 均保留原正式存档；明确确认后才允许 startCustomRun / BlessingScene.leave 替换单槽。
- 将 CustomScene.buildSeedBox/onKey 改为有焦点的输入或同等的粘贴/选择实现，复用 state/customRun.ts 的 normaliseSeed。支持选择、删除、Ctrl/Cmd+V 及 24 字符限制；modifier 组合键不能追加字母。
- 输入在场景 shutdown 时移除节点与监听，适应设计坐标缩放，焦点不会截获弹窗的 Esc 或误触全局开局快捷键。

**预计修改的文件**

- `src/scenes/TitleScene.ts`
- `src/scenes/CustomScene.ts`
- `src/scenes/BlessingScene.ts`
- `src/state/customRun.ts`
- `src/ui/confirm.ts`
- `src/ui/overlayStack.ts`
- `tests/confirm.test.ts`
- `tests/customRun.test.ts`
- `tests/browser/title-custom.test.mjs`（新增）

**验收条件**

- [ ] 连续三次打开并用 Esc/按钮取消重开后，继续、选将、设置仍能操作；嵌套弹窗只关闭最上层，重复 close 不报错。
- [ ] 逐个验证自定义配置返回、确认取消、测试战场往返，原存档字节内容不变；明确确认并完成拜别才写入所选自定义局。
- [ ] 从结算页复制种子、粘贴到自定义页后，相同配置得到相同开局；Ctrl/Cmd+A/V 不写入 A/V，非法内容和超长输入有清晰反馈。
- [ ] 真实浏览器键盘/鼠标用例验证结果和覆盖栈状态；正式局、自定义局、测试战场的计分/解锁隔离保持原语义。

**前置依赖**：依赖 [01-browser-behavior-foundation.md](01-browser-behavior-foundation.md)。

## 独立验证

- bun run test -- tests/confirm.test.ts tests/customRun.test.ts tests/testBattle.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

三个发现共同修改 TitleScene / CustomScene 及输入覆盖层，合并执行。只调用现有 save API；其类型演进由 06/07 负责。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
