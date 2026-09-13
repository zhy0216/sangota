# 仓库改进任务队列

来源：[仓库改进方案](../plan.md)。拆解日期：2026-09-12；仓库核对基线：`9a5ec4b07b50723273e847b9c102a7ee3d08f80d`。方案的探索基线为 `52251f7fded612bc6a940376b1e0303c2de5ccff`，其测试/审计数值作为历史证据，执行任务时按当时检出重新验证。

本队列覆盖 R01–R25，拆成 29 个独立任务；M01–M08 为方案明确的 roadmap，不进入执行队列。此前 weak-card-audit 已完成的改牌不重做。一个 todo 对应一个 worktree 和一个最终 commit；本次只生成本目录文件。

同批文件的标题/自定义控制、依赖/Bun 基线、时长/伤害统计分别合并；R05 恢复、R19 资源和 R22 结构整理按可验证边界拆开，并对共享文件显式串行。本文列出的“新增”路径是未来任务拟创建的路径，当前并不存在；若执行中调整路径，须同步任务文件与相关依赖，不能假定它们已经实现。

## 执行偏好

```yaml
default_agent: codex
```

默认 agent 继承方案保存值及当前 Codex 宿主；用户未指定全局模型、推理强度或单任务 agent。所有 todo 写 `agent: inherit`。表中解析结果来自本次读取的 `/home/ubuntu/.agents/skills/herdr-finish-plan/references/agent-routing.md`：Codex 模型均为 `gpt-6-astra`，easy → `high`、medium → `xhigh`、hard → `max`。不保存未被用户指定的模型覆盖；未来显式覆盖按该共享规则解析。

## 优先级

没有 P0。表按 P1 → P2 排列；编号表示下文的完整执行/集成顺序，已满足依赖且文件互不重叠的任务可提前并行。

| 文件 | 优先级 | 难度 | agent / 来源 | 模型 / Codex 推理强度 | 方案项 | 一句话说明 |
| --- | --- | --- | --- | --- | --- | --- |
| [01-browser-behavior-foundation.md](01-browser-behavior-foundation.md) | P1 | hard | codex / 继承默认 | gpt-6-astra / max | R14 | 提供隔离存储、固定种子、真实输入与稳定场景等待的 Chromium 入口。 |
| [02-dependency-and-bun-baseline.md](02-dependency-and-bun-baseline.md) | P1 | medium | codex / 继承默认 | gpt-6-astra / xhigh | R16、R17 | 在同一提交处理安全补丁、canonical lock 和开发环境声明。 |
| [03-title-and-custom-controls.md](03-title-and-custom-controls.md) | P1 | medium | codex / 继承默认 | gpt-6-astra / xhigh | R01、R02、R13、R14 | 统一取消/确认路径，保护正式存档并打通复制种子到自定义开局。 |
| [06-storage-io-and-feedback.md](06-storage-io-and-feedback.md) | P1 | hard | codex / 继承默认 | gpt-6-astra / max | R07、R23 | 为五种持久化数据提供可信 I/O 结果与非阻断保存状态。 |
| [07-saved-run-validation.md](07-saved-run-validation.md) | P1 | hard | codex / 继承默认 | gpt-6-astra / max | R03 | 在标题摘要和安装 active run 之前完成结构及关系校验。 |
| [08-progress-ledger-validation.md](08-progress-ledger-validation.md) | P1 | medium | codex / 继承默认 | gpt-6-astra / xhigh | R04 | 恢复部分合法进度并保留损坏来源，阻止 TypeError 和 NaN。 |
| [09-combat-entry-recovery.md](09-combat-entry-recovery.md) | P1 | hard | codex / 继承默认 | gpt-6-astra / max | R05、R14 | 保存待入战意图，使淡出期间重载仍进入欠下的战斗。 |
| [10-room-step-recovery.md](10-room-step-recovery.md) | P1 | hard | codex / 继承默认 | gpt-6-astra / max | R05 | 记录房间中的持久化步骤，重载后继续选择且不重复支付。 |
| [11-rewards-and-act-recovery.md](11-rewards-and-act-recovery.md) | P1 | hard | codex / 继承默认 | gpt-6-astra / max | R05 | 将领完奖励到下一幕的交接持久化，避免重复发奖或漏战。 |
| [12-idempotent-run-settlement.md](12-idempotent-run-settlement.md) | P1 | hard | codex / 继承默认 | gpt-6-astra / max | R06 | 用稳定 runId 和待提交结果保护多本账写入与征程清理。 |
| [13-browser-write-ownership.md](13-browser-write-ownership.md) | P1 | hard | codex / 继承默认 | gpt-6-astra / max | R08 | 明确单活跃写入者及接管协议，覆盖保存和结算的旧页写入。 |
| [04-map-scene-reset.md](04-map-scene-reset.md) | P2 | easy | codex / 继承默认 | gpt-6-astra / high | R12 | 让 restart 后的抽屉标记、位置和拖动状态一致。 |
| [05-sprite-pool-cleanup.md](05-sprite-pool-cleanup.md) | P2 | easy | codex / 继承默认 | gpt-6-astra / high | R21 | 用 finally 释放 measureSprite 的池资源并保留布局回退。 |
| [14-settings-session-snapshot.md](14-settings-session-snapshot.md) | P2 | medium | codex / 继承默认 | gpt-6-astra / xhigh | R09 | 拒绝持久化时设置仍立即生效，动画查询不重复读盘。 |
| [15-run-time-and-damage-statistics.md](15-run-time-and-damage-statistics.md) | P2 | hard | codex / 继承默认 | gpt-6-astra / max | R10、R11 | 保存累计活动用时，分清结算伤害、HP 损失和致死来源。 |
| [16-static-tooling-checks.md](16-static-tooling-checks.md) | P2 | medium | codex / 继承默认 | gpt-6-astra / xhigh | R18 | 增量加入 lint、format 和工具脚本检查，并接入 check。 |
| [17-ci-build-browser-and-audit.md](17-ci-build-browser-and-audit.md) | P2 | medium | codex / 继承默认 | gpt-6-astra / xhigh | R15 | 让普通 PR 验证 web 构建和 Chromium，并补桌面路径与定期审计。 |
| [18-balance-diagnostics.md](18-balance-diagnostics.md) | P2 | hard | codex / 继承默认 | gpt-6-astra / max | R24 | 按固定种子区分策略盲点、保护退出与可证实的玩法问题。 |
| [19-asset-manifest-and-baseline.md](19-asset-manifest-and-baseline.md) | P2 | hard | codex / 继承默认 | gpt-6-astra / max | R19 | 先量化下载、像素展开、启动与切场景成本，再定义资源预算。 |
| [20-texture-size-and-bounds.md](20-texture-size-and-bounds.md) | P2 | medium | codex / 继承默认 | gpt-6-astra / xhigh | R19、R21 | 依据显示尺寸控制纹理展开成本，减少首次像素扫描。 |
| [21-on-demand-asset-loading.md](21-on-demand-asset-loading.md) | P2 | hard | codex / 继承默认 | gpt-6-astra / max | R19 | 减少标题启动资源，并让延迟加载可重试、可离线运行。 |
| [22-javascript-loading-budget.md](22-javascript-loading-budget.md) | P2 | medium | codex / 继承默认 | gpt-6-astra / xhigh | R20 | 以网络、解析和可交互时间决定缓存与延迟导入方案。 |
| [23-shared-view-logic.md](23-shared-view-logic.md) | P2 | medium | codex / 继承默认 | gpt-6-astra / xhigh | R23 | 提取纯函数，保留战斗与典籍的展示上下文差异。 |
| [24-combat-input-and-visuals.md](24-combat-input-and-visuals.md) | P2 | hard | codex / 继承默认 | gpt-6-astra / max | R22、R14 | 用行为保护把键盘、拖牌与视觉生命周期从 CombatScene 移出。 |
| [25-combat-turns-and-rewards.md](25-combat-turns-and-rewards.md) | P2 | hard | codex / 继承默认 | gpt-6-astra / max | R22、R14 | 分离回合推进和奖励展示，保留恢复及一次性提交边界。 |
| [26-ordered-card-registries.md](26-ordered-card-registries.md) | P2 | hard | codex / 继承默认 | gpt-6-astra / max | R22 | 缩小 heroCards/cards 维护范围，同时保持卡池索引和公开导出。 |
| [27-relic-definitions-and-hooks.md](27-relic-definitions-and-hooks.md) | P2 | hard | codex / 继承默认 | gpt-6-astra / max | R22 | 整理宝物 registry 和运行期入口，保持掉落及触发顺序。 |
| [28-enemy-and-engine-boundaries.md](28-enemy-and-engine-boundaries.md) | P2 | hard | codex / 继承默认 | gpt-6-astra / max | R22 | 分离敌人表和伤害等内聚能力，保持协议、意图与确定性。 |
| [29-developer-docs-and-product-title.md](29-developer-docs-and-product-title.md) | P2 | easy | codex / 继承默认 | gpt-6-astra / high | R25 | 按最终实现整理命令与规则边界，修正失效引用和页面标题。 |

## 文件

以下是完整拓扑顺序。每行列直接前置依赖，传递依赖同样有效；任务须在其依赖的实现及验收集成后开始。

1. [01-browser-behavior-foundation.md](01-browser-behavior-foundation.md) — 建立浏览器行为测试夹具（hard；codex / gpt-6-astra / max）。
   前置依赖：无。

2. [02-dependency-and-bun-baseline.md](02-dependency-and-bun-baseline.md) — 修补依赖并统一 Bun 开发基线（medium；codex / gpt-6-astra / xhigh）。
   前置依赖：依赖 [01-browser-behavior-foundation.md](01-browser-behavior-foundation.md)。

3. [03-title-and-custom-controls.md](03-title-and-custom-controls.md) — 修复重开弹窗、自定义替换与种子输入（medium；codex / gpt-6-astra / xhigh）。
   前置依赖：依赖 [01-browser-behavior-foundation.md](01-browser-behavior-foundation.md)。

4. [04-map-scene-reset.md](04-map-scene-reset.md) — 重置地图场景的临时交互状态（easy；codex / gpt-6-astra / high）。
   前置依赖：依赖 [01-browser-behavior-foundation.md](01-browser-behavior-foundation.md)。

5. [05-sprite-pool-cleanup.md](05-sprite-pool-cleanup.md) — 归还异常路径中的临时 Canvas（easy；codex / gpt-6-astra / high）。
   前置依赖：无。

6. [06-storage-io-and-feedback.md](06-storage-io-and-feedback.md) — 统一存储结果、失败反馈和重试边界（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [03-title-and-custom-controls.md](03-title-and-custom-controls.md)；依赖 [04-map-scene-reset.md](04-map-scene-reset.md)。

7. [07-saved-run-validation.md](07-saved-run-validation.md) — 完整校验征程与战斗存档（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [06-storage-io-and-feedback.md](06-storage-io-and-feedback.md)。

8. [08-progress-ledger-validation.md](08-progress-ledger-validation.md) — 修复战史、解锁和天命账的数据容错（medium；codex / gpt-6-astra / xhigh）。
   前置依赖：依赖 [06-storage-io-and-feedback.md](06-storage-io-and-feedback.md)。

9. [09-combat-entry-recovery.md](09-combat-entry-recovery.md) — 建立恢复位置并修复入战中断（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [07-saved-run-validation.md](07-saved-run-validation.md)。

10. [10-room-step-recovery.md](10-room-step-recovery.md) — 恢复房间内未完成的选择和交易（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [09-combat-entry-recovery.md](09-combat-entry-recovery.md)。

11. [11-rewards-and-act-recovery.md](11-rewards-and-act-recovery.md) — 恢复奖励、幕间和双首领交接（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [10-room-step-recovery.md](10-room-step-recovery.md)。

12. [12-idempotent-run-settlement.md](12-idempotent-run-settlement.md) — 实现可恢复且只入账一次的结算（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [08-progress-ledger-validation.md](08-progress-ledger-validation.md)；依赖 [11-rewards-and-act-recovery.md](11-rewards-and-act-recovery.md)。

13. [13-browser-write-ownership.md](13-browser-write-ownership.md) — 阻止旧标签页覆盖新征程（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [12-idempotent-run-settlement.md](12-idempotent-run-settlement.md)。

14. [14-settings-session-snapshot.md](14-settings-session-snapshot.md) — 以会话快照保持设置一致（medium；codex / gpt-6-astra / xhigh）。
   前置依赖：依赖 [06-storage-io-and-feedback.md](06-storage-io-and-feedback.md)。

15. [15-run-time-and-damage-statistics.md](15-run-time-and-damage-statistics.md) — 修正跨会话用时、实际伤害和死因统计（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [13-browser-write-ownership.md](13-browser-write-ownership.md)。

16. [16-static-tooling-checks.md](16-static-tooling-checks.md) — 补静态检查与工具脚本类型环境（medium；codex / gpt-6-astra / xhigh）。
   前置依赖：依赖 [02-dependency-and-bun-baseline.md](02-dependency-and-bun-baseline.md)。

17. [17-ci-build-browser-and-audit.md](17-ci-build-browser-and-audit.md) — 接入构建、行为测试与依赖审计 CI（medium；codex / gpt-6-astra / xhigh）。
   前置依赖：依赖 [16-static-tooling-checks.md](16-static-tooling-checks.md)。

18. [18-balance-diagnostics.md](18-balance-diagnostics.md) — 复核长局与逐武将模拟指标（hard；codex / gpt-6-astra / max）。
   前置依赖：无。

19. [19-asset-manifest-and-baseline.md](19-asset-manifest-and-baseline.md) — 建立素材 manifest 与性能基线（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [05-sprite-pool-cleanup.md](05-sprite-pool-cleanup.md)；依赖 [17-ci-build-browser-and-audit.md](17-ci-build-browser-and-audit.md)。

20. [20-texture-size-and-bounds.md](20-texture-size-and-bounds.md) — 优化超大贴图并预计算静态轮廓（medium；codex / gpt-6-astra / xhigh）。
   前置依赖：依赖 [19-asset-manifest-and-baseline.md](19-asset-manifest-and-baseline.md)。

21. [21-on-demand-asset-loading.md](21-on-demand-asset-loading.md) — 按场景和章节加载所需资源（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [15-run-time-and-damage-statistics.md](15-run-time-and-damage-statistics.md)；依赖 [20-texture-size-and-bounds.md](20-texture-size-and-bounds.md)。

22. [22-javascript-loading-budget.md](22-javascript-loading-budget.md) — 建立 JS 预算并验证拆包收益（medium；codex / gpt-6-astra / xhigh）。
   前置依赖：依赖 [21-on-demand-asset-loading.md](21-on-demand-asset-loading.md)。

23. [23-shared-view-logic.md](23-shared-view-logic.md) — 统一招式分类与时长格式化（medium；codex / gpt-6-astra / xhigh）。
   前置依赖：依赖 [21-on-demand-asset-loading.md](21-on-demand-asset-loading.md)。

24. [24-combat-input-and-visuals.md](24-combat-input-and-visuals.md) — 拆出战斗输入与视觉职责（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [14-settings-session-snapshot.md](14-settings-session-snapshot.md)；依赖 [22-javascript-loading-budget.md](22-javascript-loading-budget.md)；依赖 [23-shared-view-logic.md](23-shared-view-logic.md)。

25. [25-combat-turns-and-rewards.md](25-combat-turns-and-rewards.md) — 拆出战斗回合与奖励编排（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [24-combat-input-and-visuals.md](24-combat-input-and-visuals.md)。

26. [26-ordered-card-registries.md](26-ordered-card-registries.md) — 按武将拆分卡牌定义并固定注册顺序（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [18-balance-diagnostics.md](18-balance-diagnostics.md)；依赖 [25-combat-turns-and-rewards.md](25-combat-turns-and-rewards.md)。

27. [27-relic-definitions-and-hooks.md](27-relic-definitions-and-hooks.md) — 分离宝物定义与钩子执行（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [26-ordered-card-registries.md](26-ordered-card-registries.md)。

28. [28-enemy-and-engine-boundaries.md](28-enemy-and-engine-boundaries.md) — 整理敌人定义与引擎内部职责（hard；codex / gpt-6-astra / max）。
   前置依赖：依赖 [27-relic-definitions-and-hooks.md](27-relic-definitions-and-hooks.md)。

29. [29-developer-docs-and-product-title.md](29-developer-docs-and-product-title.md) — 完善开发文档、技能引用与产品标题（easy；codex / gpt-6-astra / high）。
   前置依赖：依赖 [17-ci-build-browser-and-audit.md](17-ci-build-browser-and-audit.md)；依赖 [28-enemy-and-engine-boundaries.md](28-enemy-and-engine-boundaries.md)。

## 并行与集成

| 时机 | 可以并行的任务 / 顺序 |
| --- | --- |
| 初始 | 01、05、18 互不写同一文件；优先建立 01 的浏览器基础。 |
| 01 完成 | 02、03、04 可并行；03/04 各自增加独立 browser 测试，公共 helpers 由 01 管理。 |
| 工程支线 | 02 → 16 → 17；05 与 17 都完成后，19 → 20。该支线可与保存修复推进。 |
| 存储支线 | 03、04 完成后进入 06；06 完成后 07、08、14 可并行。07 → 09 → 10 → 11；08 与 11 完成后 12 → 13 → 15。 |
| 资源与显示 | 15、20 都完成后进入 21；随后 22 与 23 可并行。14、22、23 都完成后进入 24。 |
| 结构整理与收尾 | 24 → 25；18、25 完成后 26 → 27 → 28；17、28 完成后 29。 |

以上并行仅针对列出的写入范围。06–13 中共享 save/nav 的修改按接口依赖串行，07/08 分别负责征程与跨局账校验，允许并行；12/13 的结算写入和 24–28 的场景、内容导出及架构测试修改已串行。02/16/19/20/22 可能改 package.json/bun.lock，依赖链保证只有一个锁文件写入者。执行中若需要扩大到另一任务拥有的文件，应先补依赖并串行集成；公共夹具、校验器和 docs/performance.md / docs/architecture.md 同样遵守此规则。

优先级取组合任务的最高级别，难度取最难条目。06 的跨状态/UI 保存反馈、15 的事件/结算统计、19 的资源清单和运行测量按实际跨模块范围保守定为 hard；未使用 extreme。R22 的阶段拆分用于限制单次提交风险，不代表允许同时重写全部场景和规则。

## 方案覆盖

| 方案项 | 承接任务 |
| --- | --- |
| R01 | [03](03-title-and-custom-controls.md) |
| R02 | [03](03-title-and-custom-controls.md) |
| R03 | [07](07-saved-run-validation.md) |
| R04 | [08](08-progress-ledger-validation.md) |
| R05 | [09](09-combat-entry-recovery.md)、[10](10-room-step-recovery.md)、[11](11-rewards-and-act-recovery.md) |
| R06 | [12](12-idempotent-run-settlement.md) |
| R07 | [06](06-storage-io-and-feedback.md) |
| R08 | [13](13-browser-write-ownership.md) |
| R09 | [14](14-settings-session-snapshot.md) |
| R10 | [15](15-run-time-and-damage-statistics.md) |
| R11 | [15](15-run-time-and-damage-statistics.md) |
| R12 | [04](04-map-scene-reset.md) |
| R13 | [03](03-title-and-custom-controls.md) |
| R14 | [01](01-browser-behavior-foundation.md)、[03](03-title-and-custom-controls.md)、[09](09-combat-entry-recovery.md)、[24](24-combat-input-and-visuals.md)、[25](25-combat-turns-and-rewards.md) |
| R15 | [17](17-ci-build-browser-and-audit.md) |
| R16 | [02](02-dependency-and-bun-baseline.md) |
| R17 | [02](02-dependency-and-bun-baseline.md) |
| R18 | [16](16-static-tooling-checks.md) |
| R19 | [19](19-asset-manifest-and-baseline.md)、[20](20-texture-size-and-bounds.md)、[21](21-on-demand-asset-loading.md) |
| R20 | [22](22-javascript-loading-budget.md) |
| R21 | [05](05-sprite-pool-cleanup.md)、[20](20-texture-size-and-bounds.md) |
| R22 | [24](24-combat-input-and-visuals.md)、[25](25-combat-turns-and-rewards.md)、[26](26-ordered-card-registries.md)、[27](27-relic-definitions-and-hooks.md)、[28](28-enemy-and-engine-boundaries.md) |
| R23 | [06](06-storage-io-and-feedback.md)、[23](23-shared-view-logic.md) |
| R24 | [18](18-balance-diagnostics.md) |
| R25 | [29](29-developer-docs-and-product-title.md) |

R14 的公共夹具由 01 建立，03/09/24/25 分别补模式隔离、真实出牌和完整战斗/奖励路径，其余 R01–R13 的浏览器回归随各自修复提交。R23 的 store 去重由 06 完成，分类/格式化由 23 完成。R21 的异常释放由 05 完成，预计算扩展由 20 完成。所有非 roadmap 的近期发现都有对应验收。

## 校验约定

- 包管理只用 Bun。依赖变化时提交 bun.lock，干净检出使用 bun install --frozen-lockfile；不生成 package-lock.json。02 将移除已确认过期的 npm 锁文件。
- 当前存在的入口：bun run typecheck、test、check、build、desktop:test:unit、desktop:test、sim、eval、eval:cards，以及 bun audit。01 才新增 test:browser；16 才新增 lint、format:check、typecheck:tools 并扩展 check；19 才新增 assets:measure、perf:browser。依赖完成前不能声称这些未来命令已存在或已通过。
- 每个任务按自己的“独立验证”运行必要检查。check 当前包括类型检查、规则测试和桌面单元测试；16 后增加静态检查。每个行为修复自己带真实结果回归，不能只增加源码字符串断言。文档/命名小改不机械加测试。
- 测试只使用临时隔离存储和浏览器 profile；重载用例保留该用例的 profile，其他用例清理。页面输入驱动操作，测试探针只负责准备状态、观察、等待和故障注入。
- 桌面标准命令为 bun run desktop:test。在无显示 Linux 容器且已装 Xvfb/Openbox 时，可用下方包装。只有修改打包清单才额外运行 desktop:pack 和 --executable 实际产物 smoke。
- 规则/内容变化必须保持 37 个黄金战斗、存档往返、池声明顺序和 RNG 一致，不更新黄金 JSON 来掩盖差异。runId/计时/所有权元数据由展示或平台边界注入，不能放松规则层熵源限制。
- 审计补丁候选来自方案当时报告，执行 02 时核对维护者公告、当前版本和依赖路径；本次拆解未重新运行依赖审计。平衡结果明确有效样本、策略与保护退出，不等同于真人胜率。

```bash
xvfb-run -a -s '-screen 0 1600x1000x24' sh -c 'openbox --sm-disable >/tmp/sangota-todo-openbox.log 2>&1 & bun run desktop:test --no-sandbox'
```

本次文件校验检查编号/README 顺序、difficulty/agent 元数据、R01–R25 覆盖、依赖无环及可能并行任务的文件冲突；这不等同于提前执行上述实现任务或声称其验收通过。
