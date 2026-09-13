difficulty: hard
agent: inherit

# 06 · 统一存储结果、失败反馈和重试边界

方案项：R07、R23。优先级：P1。来源：[仓库改进方案](../plan.md)。

为五种持久化数据提供可信 I/O 结果与非阻断保存状态。

## T1 · 统一存储结果、失败反馈和重试边界

**要做什么**

- 新增小型同步 storage adapter，把 localStorage 获取、读取、JSON 序列化、写入和删除异常转换为明确结果；区分空值、unavailable、failed、ok 与 unchanged。
- 让 save.ts、history.ts、unlocks.ts、ascension.ts、settings.ts 的重复 store 访问器共用 I/O 层。保留每类数据自己的校验和降级策略；本任务不以统一空对象代替坏数据修复。
- writeSave/clearSave 返回真实结果；只有成功写入才推进 lastWritten，删除失败不得清除唯一恢复依据或宣告空槽。TitleScene 区分 unreadable storage 与空槽，禁止把读取失败当作可无提示覆盖的新局。
- 在标题/地图及必要的保存调用边界展示小型非阻断状态，成功后恢复正常；在下一个稳定保存节点重试当前有效状态。状态组件订阅有 shutdown 清理，不增加每帧弹窗或 beforeunload 补写。
- 同步调整现有保存调用方的返回值处理，保留测试战场完全禁止写正式账的守卫；为 R06 的可恢复提交保留错误信息。

**预计修改的文件**

- `src/state/storage.ts`（新增）
- `src/state/save.ts`
- `src/state/history.ts`
- `src/state/unlocks.ts`
- `src/state/ascension.ts`
- `src/state/settings.ts`
- `src/ui/SaveStatus.ts`（新增）
- `src/scenes/TitleScene.ts`
- `src/scenes/MapScene.ts`
- `src/scenes/nav.ts`
- `src/scenes/CombatScene.ts`
- `src/scenes/RoomScene.ts`
- `src/scenes/BlessingScene.ts`
- `src/scenes/InterludeScene.ts`
- `tests/storage.test.ts`（新增）
- `tests/save.test.ts`
- `tests/browser/storage-feedback.test.mjs`（新增）

**验收条件**

- [ ] 注入 Storage 获取异常、getItem/setItem/removeItem 拒绝、配额不足及序列化错误，调用者得到可区分的结果，页面仍可操作。
- [ ] 失败不显示保存成功、不将不可读取槽位视为空槽、不自动删除/覆盖原始数据；重试成功才更新成功缓存和 UI。
- [ ] 相同成功快照返回 unchanged；之前写失败的相同快照可再次写入，不被 lastWritten 吞掉。
- [ ] 无外部数据库、遥测或异步存储迁移；五种数据共享 I/O 结果但没有失去各自业务策略。

**前置依赖**：依赖 [03-title-and-custom-controls.md](03-title-and-custom-controls.md)；依赖 [04-map-scene-reset.md](04-map-scene-reset.md)。

## 独立验证

- bun run test -- tests/storage.test.ts tests/save.test.ts tests/history.test.ts tests/unlocks.test.ts tests/ascension.test.ts tests/settings.test.ts
- bun run test:browser
- bun run check
- bun run build

## 集成边界

R07 跨五本状态模块、保存调用点和 UI，按实际范围从方案 medium 上调 hard；R23 的 store 去重在这里完成。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
