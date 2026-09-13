difficulty: hard
agent: inherit

# 21 · 按场景和章节加载所需资源

方案项：R19。优先级：P2。来源：[仓库改进方案](../plan.md)。

减少标题启动资源，并让延迟加载可重试、可离线运行。

## T1 · 按场景和章节加载所需资源

**要做什么**

- 基于 manifest 把 BootScene 全量图像加载拆为标题必需、所选武将/章节、房间及典籍预览资源；先保证进入目标场景所需纹理就绪，再启用交互。
- 建立可复用、去重的资源包加载入口，处理多次请求、退出场景、失败重试及占位替换。标题选将、Custom/TestBattle、战斗恢复、章节跳转和典籍均须走同一约定。
- 调整 makeCardArt 的程序兜底与真实图片注册时机，避免先注册占位 key 后永远阻挡实际美术；按使用点审计 actorView/CardView 等纹理假设。
- 保留已实现的背景音乐懒加载和音频双格式；保持 Phaser 场景层级、sangota 协议相对路径及桌面离线资源完整性。
- 在同一基线环境记录冷启动、场景延迟和内存变化，按 19 确认的预算验收，必要的预算调整必须给出实测依据。

**预计修改的文件**

- `src/assets/manifest.ts`（19 新增）
- `src/assets/loader.ts`（新增）
- `src/scenes/BootScene.ts`
- `src/scenes/TitleScene.ts`
- `src/scenes/CustomScene.ts`
- `src/scenes/TestBattleScene.ts`
- `src/scenes/BlessingScene.ts`
- `src/scenes/MapScene.ts`
- `src/scenes/CombatScene.ts`
- `src/scenes/RoomScene.ts`
- `src/scenes/InterludeScene.ts`
- `src/scenes/SummaryScene.ts`
- `src/scenes/CompendiumScene.ts`
- `src/ui/cardArt.ts`
- `src/ui/actorView.ts`
- `src/ui/CardView.ts`
- `tests/assetManifest.test.ts`（19 新增）
- `tests/browser/asset-loading.test.mjs`（新增）
- `docs/performance.md`（19 新增）

**验收条件**

- [ ] 冷启动请求只含标题必需资源，达到已确认预算或以测量明确记录调整；真实纹理和占位之间可正确替换。
- [ ] 慢网、某张图失败、重试、加载中离场、连续打开典籍/测试战场均不黑屏或重复泄漏资源。
- [ ] 三武将、所有章节、普通局/自定义/测试战场以及各种恢复位置均能显示所需素材，首次入战延迟有报告。
- [ ] 音乐原有按场景懒加载仍正常；离线 Electron smoke 和现有资产完整性测试通过。
- [ ] 卡池/宝物池、遭遇顺序和 RNG 与加载先后无关，保存恢复链回归仍通过。

**前置依赖**：依赖 [15-run-time-and-damage-statistics.md](15-run-time-and-damage-statistics.md)；依赖 [20-texture-size-and-bounds.md](20-texture-size-and-bounds.md)。

## 独立验证

- bun run assets:measure
- bun run perf:browser
- bun run test:browser
- bun run check
- bun run build
- bun run desktop:test

## 集成边界

依赖 15 等待所有保存/统计对场景文件的修改；不要同时实施 24/25 的 CombatScene 拆分。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
