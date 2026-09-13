difficulty: medium
agent: inherit

# 23 · 统一招式分类与时长格式化

方案项：R23。优先级：P2。来源：[仓库改进方案](../plan.md)。

提取纯函数，保留战斗与典籍的展示上下文差异。

## T1 · 统一招式分类与时长格式化

**要做什么**

- 把 combat/intent.ts 与 ui/compendiumView.ts 的招式字段分类收敛为不依赖 Phaser 的共享函数，按现有优先级判序；hiddenFirstIntent 等运行时规则保留在 intentKindOf 调用层。
- 抽出 SummaryScene 与 ui/historyView.ts 的 formatDuration 为共享纯函数，复用 15 的最终时长输入而不再次改变计时口径。
- 维持当前导出/调用兼容并调整全表对照测试；核查全部 EnemyMove 组合及时间边界，不抹平典籍与战斗的必要文案差异。
- 确认五处 store 去重已经由 06 完成，本任务不重新改 storage adapter。

**预计修改的文件**

- `src/combat/intent.ts`
- `src/combat/moveIntentKind.ts`（新增）
- `src/ui/compendiumView.ts`
- `src/ui/historyView.ts`
- `src/ui/formatDuration.ts`（新增）
- `src/scenes/SummaryScene.ts`
- `tests/intent.test.ts`
- `tests/compendiumView.test.ts`
- `tests/historyView.test.ts`
- `tests/summaryFlow.test.ts`

**验收条件**

- [ ] 全体敌人所有招式在无隐藏上下文时保持原分类，首回合未知意图只影响战斗标签，不改变典籍或选招 RNG。
- [ ] 毫秒、零/负值、分钟/小时边界和异常输入的格式规则明确，Summary 与 History 显示相同合法时长。
- [ ] 共享函数可在 Node 单测导入，未形成新的表初始化循环或 Phaser 依赖。
- [ ] 相关全表/边界测试和结算行为回归通过，现有必要展示差异保留。

**前置依赖**：依赖 [21-on-demand-asset-loading.md](21-on-demand-asset-loading.md)。

## 独立验证

- bun run test -- tests/intent.test.ts tests/compendiumView.test.ts tests/historyView.test.ts tests/summaryFlow.test.ts tests/imports.test.ts
- bun run check
- bun run build
- bun run test:browser

## 集成边界

等待 15 的时长修复和 21 的场景加载变更后去重。24–28 的结构拆分在此之后，避免同时移动同一逻辑。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
