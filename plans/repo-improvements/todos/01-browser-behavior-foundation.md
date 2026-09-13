difficulty: hard
agent: inherit

# 01 · 建立浏览器行为测试夹具

方案项：R14。优先级：P1。来源：[仓库改进方案](../plan.md)。

提供隔离存储、固定种子、真实输入与稳定场景等待的 Chromium 入口。

## T1 · 建立浏览器行为测试夹具

**要做什么**

- 复用 scripts/smoke-desktop.mjs 的 Playwright、临时用户目录及设计坐标换算经验，新增独立浏览器测试入口。使用已有 playwright 与 Node 内置 test runner；在 package.json 新增 test:browser，运行 node --test --test-concurrency=1 tests/browser/*.test.mjs。
- 新增 helpers.mjs 统一管理本地 Vite 服务、浏览器上下文、固定种子、场景稳定等待、页面错误收集和失败截图。支持同一 origin 的双 page、重载保留存储以及在游戏初始化前注入拒读/拒写/拒删；测试间清理存储、事件监听和进程。
- 正常路径用键盘/鼠标完成标题→拜别→地图→重载继续。观察状态可以使用现有开发态 window.__game 或仅在测试页注入的 Phaser 探针；不能用直接调用待测私有处理函数替代输入，不向生产构建增加调试入口。
- 将截图/日志写入 artifacts/browser/ 并添加忽略规则。为后续独立 *.test.mjs 自动发现提供稳定约定；此任务只提交能通过的正常路径用例，各缺陷任务自行增加相应回归。

**预计修改的文件**

- `package.json`
- `.gitignore`
- `scripts/smoke-desktop.mjs`（读取参考，保持现有入口独立）
- `tests/browser/helpers.mjs`（新增）
- `tests/browser/foundation.test.mjs`（新增）

**验收条件**

- [ ] bun run test:browser 在干净临时上下文通过，同一固定种子得到相同开局；标题继续恢复真实写入的征程。
- [ ] 夹具能等待场景及淡入结束，转换缩放后的点击/拖动坐标，并在失败时保留截图和 pageerror；不用任意长 sleep 隐藏竞态。
- [ ] 两个用例相互不污染存储；双页夹具共享同源存储且可保留重载前的故障配置。
- [ ] 生产构建仍不暴露 window.__game，现有桌面 smoke 与规则层静态约束继续有效。

**前置依赖**：无。

## 独立验证

- 首次缺浏览器时用 bun x playwright install chromium；不更新依赖。
- bun run test:browser
- bun run check
- bun run build

## 集成边界

本任务拥有浏览器公共夹具和 package.json 中的入口。后续任务在独立测试文件中增加用例；如需更改公共 helpers，先串行集成。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
