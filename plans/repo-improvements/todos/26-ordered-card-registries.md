difficulty: hard
agent: inherit

# 26 · 按武将拆分卡牌定义并固定注册顺序

方案项：R22。优先级：P2。来源：[仓库改进方案](../plan.md)。

缩小 heroCards/cards 维护范围，同时保持卡池索引和公开导出。

## T1 · 按武将拆分卡牌定义并固定注册顺序

**要做什么**

- 把 data/heroCards.ts 的 ZHAOYUN_CARDS、ZHUGELIANG_CARDS 以及 combat/cards.ts 的关羽/无色内容按武将或既有能力组拆到纯定义模块。
- 保留 cards.ts 和 heroCards.ts 作为兼容导出/聚合入口，保持 tagHero、CARDS、HERO_CARD_POOLS、COLORLESS_POOL 与 resolveCard 的公开行为和枚举顺序。
- 新定义模块使用 types-only 依赖，不能在 import 阶段读取循环中的表；对卡牌 ID、内容值、池顺序与固定种子奖励/商店结果增加有意义的等价保护。
- 只有实现位置变化使架构断言失真时才更新对应定位，仍检查实际新模块；不重录黄金快照、不调整数值、解锁门槛或所属武将。
- 更新 docs/architecture.md 的内容声明/注册边界，并承接 18 报告的当前结论而不重写历史数据。

**预计修改的文件**

- `src/data/heroCards.ts`
- `src/combat/cards.ts`
- `src/data/cards/guanyu.ts`（新增）
- `src/data/cards/zhaoyun.ts`（新增）
- `src/data/cards/zhugeliang.ts`（新增）
- `src/data/cards/colorless.ts`（新增）
- `tests/cardRegistry.test.ts`（新增）
- `tests/heroes.test.ts`
- `tests/integrity.test.ts`（确需定位新模块时）
- `tests/imports.test.ts`
- `docs/architecture.md`（24 新增）

**验收条件**

- [ ] 每个卡牌定义、升级结果、ID/hero/rarity 和全池顺序与拆分前一致；固定种子奖励和商店索引不变。
- [ ] 从原导入路径读取 API 仍正常，任意模块先导入不会遇到未初始化表或新增 Phaser 依赖。
- [ ] 英雄/卡牌全表不变量、保存往返和全部黄金战斗通过，快照文件未修改。
- [ ] 新定义模块边界清楚，内容编辑不再必须打开跨武将大表；没有混入数值调整。

**前置依赖**：依赖 [18-balance-diagnostics.md](18-balance-diagnostics.md)；依赖 [25-combat-turns-and-rewards.md](25-combat-turns-and-rewards.md)。

## 独立验证

- bun run test -- tests/cardRegistry.test.ts tests/heroes.test.ts tests/cardBalance.test.ts tests/rewards.test.ts tests/rooms.shop.test.ts tests/imports.test.ts tests/save.test.ts sim/golden.test.ts
- bun run check
- bun run build
- bun run test:browser

## 集成边界

依赖 18 避免诊断代码/导入检查同时变化，依赖 25 等场景接口稳定。27 共享架构/导入测试和文档，因此串行。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
