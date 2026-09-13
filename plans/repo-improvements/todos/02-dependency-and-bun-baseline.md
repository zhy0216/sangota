difficulty: medium
agent: inherit

# 02 · 修补依赖并统一 Bun 开发基线

方案项：R16、R17。优先级：P1。来源：[仓库改进方案](../plan.md)。

在同一提交处理安全补丁、canonical lock 和开发环境声明。

## T1 · 修补依赖并统一 Bun 开发基线

**要做什么**

- 重新运行 bun audit，核对当时实际依赖路径及维护者公告。计划附录中的 Vitest 4.1.11、nanoid 3.3.18、sharp 0.35.4、undici 7.29.0 只是该次审计的补丁候选，执行时重新验证可用性、受影响分支与父依赖兼容性。
- 优先沿现有主版本更新受影响开发/构建依赖；禁止把未受同一公告影响的 undici 6.x 强制覆盖为 7.x，也不顺带升级 Phaser、Vite、TypeScript 等主版本。
- 用户已明确 Bun 是唯一依赖入口：移除过期 package-lock.json，声明与当前 CI 的 Bun 1.4.2 / Node 24 相符且经验证的 packageManager、engines；同步 README.md、docs/desktop.md 的开发环境说明。
- 只用 Bun 安装/更新，并一并提交有意变更的 bun.lock。记录未消除审计项的依赖路径、触发条件和处置，不将工具链风险直接描述为玩家可利用接口。

**预计修改的文件**

- `package.json`
- `bun.lock`
- `package-lock.json`（删除）
- `README.md`
- `docs/desktop.md`

**验收条件**

- [ ] 当前审计所列受影响路径得到兼容补丁，或留有具体、可复核的未解决原因及缓解方式；保留实际审计退出码。
- [ ] 干净检出以 bun install --frozen-lockfile 安装后 check/build 通过，bun.lock 没有再次漂移，package-lock.json 不再存在且不会被命令重新生成。
- [ ] 包管理器与 Node 声明匹配实际 CI；已有浏览器入口仍可运行。
- [ ] 桌面源构建 smoke 通过存档、恢复、音频、全屏与 renderer 隔离检查。

**前置依赖**：依赖 [01-browser-behavior-foundation.md](01-browser-behavior-foundation.md)。

## 独立验证

- bun install --frozen-lockfile（在隔离的干净检出验证）
- bun audit
- bun run check
- bun run build
- bun run test:browser
- bun run desktop:test；无显示环境采用 README 中约定的 Xvfb/Openbox 包装。

## 集成边界

R16 与 R17 共改 package.json / bun.lock，合为一个 worktree 和最终 commit；后续静态工具任务不得同时刷新锁文件。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
