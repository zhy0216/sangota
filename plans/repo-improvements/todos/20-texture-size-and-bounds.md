difficulty: medium
agent: inherit

# 20 · 优化超大贴图并预计算静态轮廓

方案项：R19、R21。优先级：P2。来源：[仓库改进方案](../plan.md)。

依据显示尺寸控制纹理展开成本，减少首次像素扫描。

## T1 · 优化超大贴图并预计算静态轮廓

**要做什么**

- 按 19 的报告优先处理 map-bg.jpg 等超大纹理，以现有素材做可重复的尺寸/压缩处理，保留 1280×720 与高倍率所需画质；记录输入、输出尺寸、字节及处理命令。
- 在 manifest 中补静态透明素材的轮廓边界及源尺寸，measureSprite 优先读匹配素材版本的预计算数据；无数据、尺寸不符和动态图仍走 05 修复后的运行时扫描/回退。
- 测量最大纹理尺寸限制下的加载结果，给超上限资源提供合适变体或明确回退；不让资源优化引入黑屏。
- 更新性能报告和预算测量，保留素材 key、布局基准及离线文件路径；不生成新美术或重画角色。

**预计修改的文件**

- `public/assets/map/map-bg.jpg`
- `public/assets/ 下由 19 报告确认的其他超预算纹理`（实施前列出实际文件）
- `src/assets/manifest.ts`（19 新增）
- `src/ui/spriteBounds.ts`
- `scripts/measure-assets.mjs`（19 新增）
- `scripts/optimize-assets.mjs`（新增）
- `tests/assetManifest.test.ts`（19 新增）
- `tests/spriteBounds.test.ts`（05 新增）
- `docs/performance.md`（19 新增）
- `package.json`（仅确需增加资源处理依赖时）
- `bun.lock`（仅依赖变化时，一并提交）

**验收条件**

- [ ] 已列明纹理的最大尺寸/展开体积下降，地图滚动、角色落脚点和透明轮廓在标准及高倍率下可接受，附对照截图。
- [ ] 静态边界与旧像素扫描在约定容差内一致；失配或缺元数据使用正常回退，首次出现已知角色无需再次扫描整张图片。
- [ ] 低最大纹理尺寸模拟/目标环境能够启动并显示合理替代，桌面本地资源仍全部存在。
- [ ] 测量报告说明实际收益和画质取舍，不只用 JPEG/PNG 文件大小作为完成依据。

**前置依赖**：依赖 [19-asset-manifest-and-baseline.md](19-asset-manifest-and-baseline.md)。

## 独立验证

- 运行并记录 optimize-assets 的实际可重复命令；依赖若需增加只用 Bun，并先检查无并行锁文件写入。
- bun run assets:measure
- bun run perf:browser
- bun run test -- tests/spriteBounds.test.ts tests/assetManifest.test.ts
- bun run check
- bun run build
- bun run test:browser
- bun run desktop:test

## 集成边界

只操作 19 测量确认的文件；不得批量重新生成所有素材。若新增依赖，package.json/bun.lock 也属于本任务，22 须等待该链完成。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
