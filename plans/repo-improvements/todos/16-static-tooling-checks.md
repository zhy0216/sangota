difficulty: medium
agent: inherit

# 16 · 补静态检查与工具脚本类型环境

方案项：R18。优先级：P2。来源：[仓库改进方案](../plan.md)。

增量加入 lint、format 和工具脚本检查，并接入 check。

## T1 · 补静态检查与工具脚本类型环境

**要做什么**

- 采用一套精简的 ESLint flat config 与 Prettier 配置；执行时核对兼容的插件版本，仅通过 Bun 增加所需开发依赖并提交 bun.lock。
- 新增 tsconfig.tools.json，把 scripts/dev-scene.ts、Vite/Vitest 配置和相关 Node/Bun 脚本纳入合适的类型/静态检查；区分浏览器 DOM、Node、Bun 与 Electron 环境。
- 新增 lint、format:check、typecheck:tools 脚本并接入 check；对纳入范围的异步代码启用能发现未处理 Promise 的检查。保留现有规则/模拟测试入口分层。
- 以明确的增量覆盖范围清理既有问题，避免全仓格式化内容表或重排声明；工具脚本真实错误应修复，不能以关闭规则、广泛 any 或 blanket ignore 达到全绿。
- 为 01 的浏览器脚本以及之后新增同目录脚本提供可继承的规则，不修改公共测试行为。

**预计修改的文件**

- `package.json`
- `bun.lock`
- `tsconfig.json`
- `tsconfig.tools.json`（新增）
- `eslint.config.mjs`（新增）
- `.prettierrc.json`（新增）
- `.prettierignore`（新增）
- `scripts/dev-scene.ts`
- `scripts/dev-desktop.mjs`
- `scripts/smoke-desktop.mjs`
- `tests/browser/helpers.mjs`（01 新增）
- `vite.config.ts`
- `vitest.config.ts`
- `vitest.sim.config.ts`
- `vitest.eval.config.ts`
- `vitest.audit.config.ts`
- `electron/main.cjs`
- `electron/preload.cjs`
- `electron/protocol.cjs`
- `electron/protocol.test.cjs`

**验收条件**

- [ ] lint、format:check、typecheck:tools 均可独立运行且被 check 调用；浏览器与 Node/Bun 类型环境不会互相污染。
- [ ] 在临时验证改动中引入脚本未定义变量/类型错误、未处理 Promise 和格式错误，对应检查失败，撤销探针后通过。
- [ ] 游戏内容声明顺序、规则输出与黄金快照不变；未一次性重排业务文件。
- [ ] bun install --frozen-lockfile 可复现新增工具，锁文件不意外漂移。

**前置依赖**：依赖 [02-dependency-and-bun-baseline.md](02-dependency-and-bun-baseline.md)。

## 独立验证

- bun run lint
- bun run format:check
- bun run typecheck:tools
- bun run check
- bun run build
- bun run test:browser

## 集成边界

继 02 后独占 package.json/bun.lock 和工具配置；如现有文件规模导致全量规则不切实际，记录增量覆盖边界与实际能发现的错误，不声称全仓已格式化。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
