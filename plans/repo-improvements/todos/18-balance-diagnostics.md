difficulty: hard
agent: inherit

# 18 · 复核长局与逐武将模拟指标

方案项：R24。优先级：P2。来源：[仓库改进方案](../plan.md)。

按固定种子区分策略盲点、保护退出与可证实的玩法问题。

## T1 · 复核长局与逐武将模拟指标

**要做什么**

- 先读取 sim/balance.sim.ts、runCombat.ts、policy.ts、tactical.ts、docs/zhugeliang.md 及 weak-card-audit/results.md 的保护退出记录，保留历史实验产物原样。
- 以当前提交及固定种子复跑 per-hero balance，聚焦诸葛亮—张宝长局和全部带外格；分别运行 legacy greedy 与现有 tactical，对相同场景报告样本数、胜率/HP 指标、区间和有效样本。
- 对无效种子给出可复现实例、回合/动作轨迹与保护退出原因；审查多段伤害、准备顺序和可达到构筑，区分策略不会操作与玩法无法完成。
- 仅在需要时增加独立诊断 helper 或报告字段，保留 legacy policy 和黄金快照语义、60 回合保护上限及无效行排除规则；不通过提高上限或算成败局消掉告警。
- 产出新的诊断报告/结构化结果，明确是否有足够证据支持另行改数值；本任务不重复此前完成的十张改牌，也不直接修改卡牌/敌人规则。

**预计修改的文件**

- `sim/balance.sim.ts`
- `sim/runCombat.ts`（仅诊断观察接口确有需要时）
- `sim/cardAudit.ts`（仅复用/诊断输出确有需要时）
- `sim/balanceDiagnostics.ts`（新增，如需独立诊断逻辑）
- `sim/balanceDiagnostics.test.ts`（新增，如有新诊断逻辑）
- `docs/zhugeliang.md`（补当前诊断链接）
- `docs/balance-diagnostics.md`（新增）
- `docs/balance-diagnostics.csv`（新增）

**验收条件**

- [ ] 报告记录代码基线、完整命令、种子、策略、样本数、区间和构筑来源；greedy/tactical 不混成同一指标。
- [ ] 每个保护退出均被列为无效而非败局，有复现原因；诸葛亮—张宝例子得到具体解释或明确尚未确定的证据缺口。
- [ ] 带外不自动意味着要调参，结论区分调查结果与需要产品判断的后续建议。
- [ ] legacy 策略、60 回合保护、37 个黄金快照和历史 weak-card-audit 文件未被重写。

**前置依赖**：无。

## 独立验证

- bun run sim -t 'per-hero balance'
- 运行并记录本任务新增的定向 greedy/tactical 诊断命令；按证据需要选择 sim/eval:cards，不机械跑全部矩阵。
- 有诊断代码时执行对应测试；否则不为报告本身新增测试。
- bun run check

## 集成边界

纯诊断/报告任务可从首批并行启动；避免修改 policy.ts、tactical.ts、engine 或内容定义。工具/内容任务集成后若结果受影响，再按实际新基线定向复核。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
