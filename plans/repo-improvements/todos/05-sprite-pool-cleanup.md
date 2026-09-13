difficulty: easy
agent: inherit

# 05 · 归还异常路径中的临时 Canvas

方案项：R21。优先级：P2。来源：[仓库改进方案](../plan.md)。

用 finally 释放 measureSprite 的池资源并保留布局回退。

## T1 · 归还异常路径中的临时 Canvas

**要做什么**

- 调整 src/ui/spriteBounds.ts 的 measureSprite，将 CanvasPool.create 后的资源归还放进 finally；只归还成功取得的 canvas，覆盖 getContext、drawImage 和 getImageData 异常。
- 失败继续返回 null，使 groundSprite/contentWidthAt 使用现有回退；不缓存失败边界，不破坏后续成功测量。
- 用可控 CanvasPool/纹理替身添加针对资源占用的单元回归，验证真实 create/remove 次数及后续正常测量结果。

**预计修改的文件**

- `src/ui/spriteBounds.ts`
- `tests/spriteBounds.test.ts`（新增）

**验收条件**

- [ ] 三种失败点分别重复触发后，临时池资源数量不累计，每次已分配资源恰好释放一次。
- [ ] 分配自身失败不会尝试归还不存在的对象；随后正常纹理仍得到正确边界。
- [ ] 透明图和正常图的布局与缓存语义保持一致。

**前置依赖**：无。

## 独立验证

- bun run test -- tests/spriteBounds.test.ts
- bun run check

## 集成边界

本任务仅修生命周期错误；静态边界预计算属于 20 的资源处理工作，不在此提前扩展。

按 [队列 README](README.md) 解析最终 agent、模型与推理强度。本文件是一个独立 worktree / 最终 commit；只在执行此任务时修改上述业务文件，完成自身验证后再供下游集成。
