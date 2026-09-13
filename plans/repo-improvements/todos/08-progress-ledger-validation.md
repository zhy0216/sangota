difficulty: medium
agent: inherit

# 08 · 修复战史、解锁和天命账的数据容错

方案项：R04。优先级：P1。来源：[仓库改进方案](../plan.md)。

恢复部分合法进度并保留损坏来源，阻止 TypeError 和 NaN。

## T1 · 修复战史、解锁和天命账的数据容错

**要做什么**

- 分别校验 history.getCareer、unlocks.getUnlocks、ascension.getAscensionProgress 的未知输入、字段类型、整数边界和容器形状，复用 06 的存储结果。
- 为缺失的可兼容字段归一化；部分坏条目与合法条目分开处理，保留诊断来源及原始数据，避免后续写入静默把整个生涯覆盖为空白。
- 未知历史英雄/卡牌/敌人 ID 使用稳定展示回退；解锁与天命中的非法条目不能意外授予进度或计算出 NaN。
- 校验后再执行 grantAvailableHeroes 等业务逻辑；正常达到门槛的旧进度仍按原规则补发英雄。

**预计修改的文件**

- `src/state/history.ts`
- `src/state/unlocks.ts`
- `src/state/ascension.ts`
- `src/ui/historyView.ts`
- `tests/history.test.ts`
- `tests/unlocks.test.ts`
- `tests/ascension.test.ts`
- `tests/historyView.test.ts`
- `tests/browser/progress-validation.test.mjs`（新增）

**验收条件**

- [ ] career 仅 version、unlocks.heroes=null、ascension.cleared.guanyu='oops' 等计划复现不会抛错，难度上限始终为合法整数。
- [ ] 包含部分合法历史和坏条目的数据仍保留可恢复条目及来源，不自动将整本账写成 emptyCareer。
- [ ] 未知历史 ID 可展示，非法解锁/难度条目不扩大权限；正常门槛和已合法解锁内容不变。
- [ ] 读取不可用与新玩家空进度可区分，容错逻辑不掩盖持久化失败。

**前置依赖**：依赖 [06-storage-io-and-feedback.md](06-storage-io-and-feedback.md)。

## 独立验证

- bun run test -- tests/history.test.ts tests/unlocks.test.ts tests/ascension.test.ts tests/historyView.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

可与 07 并行：07 拥有征程校验，08 拥有三本跨局账及历史展示；避免共同改动公共 storage adapter。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
