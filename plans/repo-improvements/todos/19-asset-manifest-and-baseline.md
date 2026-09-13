difficulty: hard
agent: inherit

# 19 · 建立素材 manifest 与性能基线

方案项：R19。优先级：P2。来源：[仓库改进方案](../plan.md)。

先量化下载、像素展开、启动与切场景成本，再定义资源预算。

## T1 · 建立素材 manifest 与性能基线

**要做什么**

- 从 BootScene 的 HERO/ENEMY/CARD/RELIC/POTION/ROOM 显式名单和 public/assets 实际文件建立 manifest，记录 key、路径、尺寸、字节和标题/武将/章节/典籍用途。只能登记确实存在的文件，不按所有内容 ID 盲目注册纹理。
- 将加载名单的事实源移到独立素材模块，保留当前全量加载行为作为可比较基线；内容 registry/奖励池顺序不得由素材排序反向改变。
- 新增可重复测量脚本及 assets:measure、perf:browser 入口。记录冷缓存下载、首次可交互、切场景延迟、纹理尺寸、像素展开估算以及可观测内存；内存估算与实测指标明确分栏。
- 提出标题必需下载 ≤15 MiB、RGBA ≤64 MiB 的候选预算，记录测量环境和统计方法后确认可执行值；测量低纹理上限场景，不声称已有真实低端设备结果。
- 更新现有素材存在性测试读取 manifest，保留缺图占位规则；报告作为 20/21/22 的共同对照，后续不反复更换基线。

**预计修改的文件**

- `src/scenes/BootScene.ts`
- `src/assets/manifest.ts`（新增）
- `scripts/measure-assets.mjs`（新增）
- `scripts/measure-browser.mjs`（新增）
- `package.json`
- `tests/assetManifest.test.ts`（新增）
- `tests/heroAssets.test.ts`
- `tests/enemyAssets.test.ts`
- `tests/cardFaces.test.ts`
- `tests/sfxAssets.test.ts`
- `docs/performance.md`（新增）
- `public/assets/`（只读取，不在本任务优化）

**验收条件**

- [ ] manifest 覆盖实际加载的图像/音效名单，引用文件存在且 key 唯一；缺失美术继续使用程序绘制/占位，不污染有效纹理。
- [ ] assets:measure 和 perf:browser 能复现报告，显示压缩大小、RGBA 估算、最大尺寸、冷启动和切场景延迟；未测到的指标明确标注。
- [ ] 初始基线和候选预算有环境、次数/聚合方式以及调预算依据，不把 368.5 MiB 估算称为实测 GPU 占用。
- [ ] 本提交仅迁移资源清单，不改变资源加载时机、游戏内容注册顺序或 RNG。

**前置依赖**：依赖 [05-sprite-pool-cleanup.md](05-sprite-pool-cleanup.md)；依赖 [17-ci-build-browser-and-audit.md](17-ci-build-browser-and-audit.md)。

## 独立验证

- bun run assets:measure（本任务新增）
- bun run perf:browser（本任务新增）
- bun run test -- tests/assetManifest.test.ts tests/heroAssets.test.ts tests/enemyAssets.test.ts tests/cardFaces.test.ts tests/sfxAssets.test.ts
- bun run check
- bun run build
- bun run test:browser

## 集成边界

17 完成后公共浏览器夹具与工具配置稳定；本任务再次修改 package.json，必须晚于 02/16/17。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
