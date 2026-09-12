# 桌面版开发与打包

桌面窗口加载随包附带的游戏与素材，可离线运行。网页版本仍使用 `bun run dev` / `bun run build`。

## 环境与命令

开发和打包需要 Bun、Node.js 22.12 或更新版本，然后运行 `bun install`。
首次启动 Electron 时会下载当前系统的运行程序；需要提前下载时可运行 `bun run install-electron --no`。

| 命令 | 用途 |
| --- | --- |
| `bun run desktop:dev` | 启动本地 Vite 服务和 Electron；关闭窗口会关闭服务 |
| `bun run desktop` | 构建网页，然后在 Electron 中运行离线版本 |
| `bun run desktop:pack` | 为当前系统生成完整的应用目录 |
| `bun run desktop:pack:win` | 生成 Windows x64 应用目录和可分发的 ZIP 包 |
| `bun run desktop:test` | 构建并验证离线启动、实际出征存档、重启继续、音频和全屏 |
| `bun run desktop:test:unit` | 验证资源路径边界、页面来源和外部链接限制 |

Windows 入口为 `release/win-unpacked/Sangota.exe`。Linux 入口为 `release/linux-unpacked/Sangota`。
Windows 压缩包为 `release/Sangota-<版本>-win-x64.zip`，解压后运行其中的 `Sangota.exe`。
打包目录中的运行库、`resources/`、语言包等都要一起分发。仅复制 `.exe` 无法运行游戏。
Windows 包可从当前 Linux 环境生成；Windows 原生运行验证由 `.github/workflows/desktop.yml` 提供。
macOS 需要在 Mac 上运行打包命令；对外分发的签名与公证另行配置。

当前 Windows 产物是未签名的应用目录，使用 Electron 默认图标。正式发行前可在 `electron-builder.yml`
中配置游戏图标与签名。构建命令始终使用 `--publish never`，不会自动上传或发布。

## 窗口与开发

- `F11` / `Alt+Enter`：切换全屏，与游戏内「设置」共用同一项偏好，重启后恢复。
- `F12`：开发模式打开或关闭开发工具。
- 关闭窗口退出游戏；macOS 保留标准应用菜单，可用 `Cmd+Q` 退出。
- 同一个存档目录只运行一个实例，重复启动会聚焦已有窗口。
- 标题页的 GitHub 按钮使用系统浏览器打开项目地址。

`desktop:dev` 只监听 `127.0.0.1`，自动选择可用端口。修改游戏代码由 Vite 热更新；
修改 `electron/` 中的主进程或 preload 后，需要重新运行开发命令。
打包版始终加载本地 `sangota://game/index.html`，不会读取开发服务地址。

## 存档

沿用游戏现有的 `localStorage` 存档格式，使用固定的页面来源和 Electron 用户目录，
不随安装位置或版本号变化：

| 系统 | 默认用户目录 |
| --- | --- |
| Windows | `%APPDATA%\Sangota` |
| macOS | `~/Library/Application Support/Sangota` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/Sangota` |

存档、解锁、战史和设置保存在该目录下的 Chromium `Local Storage` 中。
开发模式使用独立的 `Sangota Development` 目录。网页浏览器与桌面版的进度各自独立，
不会自动迁移。备份时先退出游戏，再复制整个用户目录；更新游戏不应删除这个目录。

自动验证通过临时 `--user-data-dir` 隔离存档，正常退出后重新启动应用，检查整份存档一致并实际继续到地图。
测试结束会删除临时目录，截图保存在 `artifacts/desktop/`。

## Linux 自动验证

有图形桌面时直接运行 `bun run desktop:test`。没有显示服务的 CI / 容器需要安装 Xvfb 和 Openbox：
Xvfb 提供显示服务，Openbox 处理原生全屏事件；只启动 Xvfb 无法完整验证全屏切换。

```bash
xvfb-run -a -s '-screen 0 1600x1000x24' sh -c 'openbox --sm-disable & bun run desktop:test'
```

部分 Linux 容器禁止 Chromium 使用用户命名空间，且没有配置 SUID sandbox。
仅在这种隔离测试环境里，可临时传入 `--no-sandbox`：

```bash
xvfb-run -a -s '-screen 0 1600x1000x24' sh -c 'openbox --sm-disable & bun run desktop:test --no-sandbox'

# 验证已经打好的 Linux 包
xvfb-run -a -s '-screen 0 1600x1000x24' sh -c 'openbox --sm-disable & bun run desktop:test --no-sandbox --executable release/linux-unpacked/Sangota'
```

此参数没有写入应用、开发脚本或分发包的默认配置。普通发行环境应保留沙箱。
Windows CI 直接验证 `release/win-unpacked/Sangota.exe`，不需要 Xvfb 或该参数。

## Steam 上传准备

1. 运行 `bun run desktop:pack:win`，在 Windows 上实际试玩完整目录。
2. 在 Steamworks 中创建产品和 Windows depot，取得实际的 App ID 与 Depot ID。
3. 将 `release/win-unpacked/` 的全部内容作为 depot 的内容根目录。
4. 配置 Windows 启动项，执行文件填 `Sangota.exe`，工作目录使用安装根目录。
5. 使用 Steamworks SDK 的 SteamPipe 工具上传到测试分支，经 Steam 客户端安装并验证后，再提交审核。

参考：[Steam 上传文档](https://partner.steamgames.com/doc/sdk/uploading)、
[Steamworks 入门](https://partner.steamgames.com/doc/gettingstarted)。

游戏资源独立存放在 `resources/game/`，主进程和 preload 放在 `resources/app.asar` 中，
便于 Steam 分别更新变动的素材。更新由 Steam 分发。

这次接入完成的是桌面运行与构建。Steam 成就、Steam Overlay、云存档和商店后台配置需要后续接入与验证。
不要直接把整个 Chromium 用户目录配置成 Steam Cloud；接云存档时应先设计独立的游戏存档文件与同步策略。
