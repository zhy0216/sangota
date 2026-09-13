difficulty: medium
agent: inherit

# 22 · 建立 JS 预算并验证拆包收益

方案项：R20。优先级：P2。来源：[仓库改进方案](../plan.md)。

以网络、解析和可交互时间决定缓存与延迟导入方案。

## T1 · 建立 JS 预算并验证拆包收益

**要做什么**

- 基于 19–21 的资源测量，给生产 JS 总量/初始请求量与首次可交互时间建立可执行预算，调整 vite.config.ts 中掩盖增长的 chunkSizeWarningLimit。
- 分别评估 Phaser vendor 稳定缓存和开发工具/典籍的延迟导入。只实施有测量收益的拆分，记录冷缓存与复访；拆成更多 chunk 本身不算首屏改善。
- 调整 src/main.ts 或对应场景注册入口时保持 Room/Map 渲染顺序、开发场景浏览器及测试战场功能；生产构建不能暴露开发接口。
- 扩展测量脚本报告各 chunk、压缩/解析指标与动态资源失败；保持 base='./'、Electron sangota 协议和离线文件完整性。

**预计修改的文件**

- `src/main.ts`
- `vite.config.ts`
- `src/scenes/BootScene.ts`
- `src/devScenes/index.ts`
- `src/scenes/CompendiumScene.ts`
- `scripts/measure-browser.mjs`（19 新增）
- `package.json`（预算入口确需接线时）
- `tests/browser/bundle-loading.test.mjs`（新增）
- `docs/performance.md`（19 新增）

**验收条件**

- [ ] JS 预算能够发现超限且不会随意提高阈值规避；报告首次加载和复访各自收益或无收益结果。
- [ ] 拆包后冷启动、解析与交互指标无未解释退化；如测量不支持某项拆分，保留预算与证据即可，不强行引入复杂加载。
- [ ] 浏览器和 sangota 协议下动态 chunk 全部可加载；直接进入开发场景、典籍往返和测试战场正常。
- [ ] 生产构建、完整浏览器回归和桌面离线 smoke 通过。

**前置依赖**：依赖 [21-on-demand-asset-loading.md](21-on-demand-asset-loading.md)。

## 独立验证

- bun run build
- bun run perf:browser
- bun run test:browser
- bun run check
- bun run desktop:test

## 集成边界

不扩展到引擎或构建工具主版本迁移。可与 23 并行，两者只在 21 完成后启动并保持所列文件边界。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
