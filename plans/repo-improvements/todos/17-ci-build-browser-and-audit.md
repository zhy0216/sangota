difficulty: medium
agent: inherit

# 17 · 接入构建、行为测试与依赖审计 CI

方案项：R15。优先级：P2。来源：[仓库改进方案](../plan.md)。

让普通 PR 验证 web 构建和 Chromium，并补桌面路径与定期审计。

## T1 · 接入构建、行为测试与依赖审计 CI

**要做什么**

- 更新 .github/workflows/ci.yml，在 frozen Bun 安装后运行 check、web build 与 01 的 Chromium 行为入口；设置合理 job timeout、浏览器缓存和失败截图/日志产物。
- 完善 desktop.yml 路径过滤，覆盖 tsconfig、浏览器脚本、测试/工具配置及相关工作流；保留 Windows/Linux 实际打包与本地协议 smoke。
- 新增独立依赖审计 workflow，覆盖周期触发及 package.json/bun.lock 变更。报告真实退出码与可见处置入口，明确依赖变更作者/维护者的后续修复责任，不自动发消息或改依赖。
- 明确跨浏览器频率：Chromium 每 PR 门禁，Firefox/WebKit 定期或手动兼容性验证；使用 01 夹具可配置的浏览器选择，若需要扩展选择参数在此任务串行完善。
- 保持 sim/eval 为诊断命令，不因带外指标把普通 PR 设为必失败。

**预计修改的文件**

- `.github/workflows/ci.yml`
- `.github/workflows/desktop.yml`
- `.github/workflows/audit.yml`（新增）
- `tests/browser/helpers.mjs`（仅浏览器选择确有需要时；01 新增）

**验收条件**

- [ ] 普通 PR 的 workflow 具备 check/build/Chromium，浏览器失败时上传截图和错误日志，失败不会被 continue-on-error 隐藏。
- [ ] 修改 tsconfig、浏览器测试或工具配置会触发所需桌面校验；原有双平台打包 smoke 仍在。
- [ ] 审计具有明确 schedule/依赖变更触发与输出，非零审计结果可见；跨浏览器周期和超时在配置中明确。
- [ ] 使用与 workflow 相同的本地命令完成验证；未实际触发远程 Actions 时，不声称远程运行已通过。

**前置依赖**：依赖 [16-static-tooling-checks.md](16-static-tooling-checks.md)。

## 独立验证

- 检查 workflow YAML、事件路径和 action 参数；将对应 check/build/test:browser/audit 命令在本地验证。
- bun run check
- bun run build
- bun run test:browser
- bun audit（如存在遗留项，按 02 的实际处置记录解释退出码）

## 集成边界

依赖 16 即传递依赖 R14/R16/R17/R18；只在 CI 接入已有检查，不重新选择工具或刷新锁文件。与 19 共用 helper 时须先集成本任务。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
