# 三國 · 烽火尖塔

一款以三国为题材的 Roguelike 卡牌构筑游戏，使用 Phaser 3、TypeScript 和 Vite 构建。

## 运行项目

请先安装 [Bun](https://bun.sh/)，并安装项目依赖：

```bash
bun install
```

开发项目：

```bash
bun run dev
```

本地试玩生产版本：

```bash
bun run build
bun run preview
```

执行后打开终端中显示的本地地址即可。

## 桌面版（Electron）

开发环境需要 Bun 和 Node.js 22.12+；玩家运行打包版无需安装这些工具。

```bash
# 桌面开发模式，支持 Vite 热更新；F12 打开开发工具
bun run desktop:dev

# 构建并运行本地离线桌面版
bun run desktop

# 打包 Windows x64，输出 release/win-unpacked/Sangota.exe
bun run desktop:pack:win

# 打包当前操作系统
bun run desktop:pack
```

`F11` 或 `Alt+Enter` 切换全屏，游戏内「设置」也可以切换。分发时需要整个打包目录。
存档位置、自动验证、Linux 环境说明和 Steam 上传准备见 [桌面版开发与打包](docs/desktop.md)。

诸葛亮在累计通关两次后解锁，已达门槛的旧进度会自动补发。角色玩法、美术记录与专属试玩场景见 [诸葛亮 · 卧龙定计](docs/zhugeliang.md)。

想直接测试诸葛亮：主菜单进入「自定义」→「测试战场 · 指定关卡」。测试页默认选中诸葛亮，无需解锁；可选择四幕的普通战、精英战和首领战，以及初始牌组、锦囊、南征、传世构筑。战斗中可重选关卡，结束后可按相同开局重试。测试沿用自定义页的种子与天命，不覆盖征程存档，也不计入战史或解锁进度。

## 这个项目是怎么开发的

这是一个 AI-native 的个人项目。

- 我与 **Claude Code** 和 **Codex** 协作，由这些 agent 完成需求拆解、游戏设计、编码、调试和测试。
- 我将 **genmedia CLI** 提供给 agent 作为工具，让它们调用 fal.ai 上的生成式模型，制作和迭代角色、卡牌、敌人、地图与场景等游戏美术素材。
- 代码与素材在同一套 agent 工作流中持续迭代：描述目标、生成实现、运行验证，再根据游戏内的实际效果调整。

## 参与贡献

欢迎大家提交 Issue 反馈问题或分享想法，也欢迎直接提交 Pull Request 贡献代码。
