difficulty: easy
agent: inherit

# 29 · 完善开发文档、技能引用与产品标题

方案项：R25。优先级：P2。来源：[仓库改进方案](../plan.md)。

按最终实现整理命令与规则边界，修正失效引用和页面标题。

## T1 · 完善开发文档、技能引用与产品标题

**要做什么**

- 更新 README.md 与 docs/desktop.md 的安装、check/test/test:browser、sim/eval/eval:cards、资源测量和诊断入口；写清普通门禁与昂贵诊断的区别、失败产物位置和 CI/审计处置。
- 汇总 docs/architecture.md 的实际模块、保存恢复/结算/所有权、规则层无 Phaser/墙钟和内容声明顺序约束，引用新增性能/平衡报告。
- 修正 vitest 配置等当前维护文案中的 npm 命令为 Bun。AGENTS.md 中 full-reference/anchor-system/prompt-patterns/examples 四条失效相对路径，先查实际安装位置；有真实可移植路径则链接，否则给出可执行的安装/定位说明，不编造 references 目录或复制过期文档。
- 将 index.html 的当前产品标题统一为 README/桌面的“烽火尖塔”。历史 todos/weak-card-audit 等说明保留时间语境，不把旧实验结果改成当前事实。
- 检查本轮新增相对链接、脚本名称和贡献者启动路径，记录可用环境与无法本地验证的平台范围。

**预计修改的文件**

- `README.md`
- `docs/desktop.md`
- `docs/architecture.md`（24 新增）
- `AGENTS.md`
- `index.html`
- `vitest.config.ts`
- `vitest.sim.config.ts`
- `vitest.eval.config.ts`
- `vitest.audit.config.ts`
- `src/state/save.ts`（仅当前维护注释中的 npm 命令）

**验收条件**

- [ ] 新贡献者能按文档用 Bun 安装、启动、构建和运行分层校验；所有列出的 package scripts 确实存在。
- [ ] 修改/新增的相对链接可解析，四个失效技能引用得到真实路径或安装定位说明；历史产物未被重写。
- [ ] 浏览器标签、README 和桌面使用一致产品标题，架构文档反映最终模块及依赖。
- [ ] 记录实际执行的命令与结果，不把规划时基线或未跑的 Windows/macOS 验证写成当前通过。

**前置依赖**：依赖 [17-ci-build-browser-and-audit.md](17-ci-build-browser-and-audit.md)；依赖 [28-enemy-and-engine-boundaries.md](28-enemy-and-engine-boundaries.md)。

## 独立验证

- 核对 package.json 脚本和所有修改的本地相对链接；不为文案/命名新增测试。
- 对本任务文档/配置执行既有 lint/format 检查；只处理本任务触及文件的格式。
- bun run check
- bun run build
- 快速检查页面标题和文档中的 dev/preview 启动入口；昂贵模拟沿用 18 的可复核记录。

## 集成边界

最终汇总所有已落地命令与架构；依赖 17/28 已传递覆盖工程、诊断、资源与所有业务任务。只在执行此 todo 时修改列出文件。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
