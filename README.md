# 三國 · 烽火尖塔

一款以三国为题材的 Roguelike 卡牌构筑游戏，使用 Phaser 3、TypeScript 和 Vite 构建。

## 运行项目

请先安装 [Bun](https://bun.sh/)，然后执行：

```bash
bun install
bun run dev
```

打开 `http://localhost:5173` 即可开始游戏。

## 这个项目是怎么开发的

这是一个 AI-native 的个人项目。

- 我与 **Claude Code** 和 **Codex** 协作，由这些 agent 完成需求拆解、游戏设计、编码、调试和测试。
- 我将 **genmedia CLI** 提供给 agent 作为工具，让它们调用 fal.ai 上的生成式模型，制作和迭代角色、卡牌、敌人、地图与场景等游戏美术素材。
- 代码与素材在同一套 agent 工作流中持续迭代：描述目标、生成实现、运行验证，再根据游戏内的实际效果调整。

## 参与贡献

欢迎大家提交 Issue 反馈问题或分享想法，也欢迎直接提交 Pull Request 贡献代码。
