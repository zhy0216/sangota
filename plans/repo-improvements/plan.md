# 仓库改进方案

状态：完成仓库探索与规划，尚未实施。日期：2026-09-12。

分析基线：52251f7fded612bc6a940376b1e0303c2de5ccff。当前项目为 Phaser 3 + TypeScript + Vite 的单机卡牌游戏，支持浏览器和 Electron；src/ 共 111 个 TypeScript 文件、约 39,052 行。依赖管理以 Bun 和 bun.lock 为准。

本次仅新增本文件。进入工作区时已有未跟踪的 plans/weak-card-audit/ 及其实验产物，保持原样；不将其中已经完成的改牌工作重新列为待办。

## 意图

用户未提供具体开发 prompt，按 make-plan 的仓库探索模式排查正确性、健壮性、安全、性能、测试、工程体验和代码质量。结论是：规则层已有较扎实的确定性测试和桌面验证，但真实场景切换、异常存储和部分交互仍有漏测。优先处理自定义出征覆盖正式存档、取消弹窗后标题失去响应、同版本坏存档导致标题页报错，以及入战过渡期间重载跳过战斗；随后完善结算落盘、测试与 CI、依赖补丁和资源加载。

下文完整列出 25 个近期改进项与 8 个 roadmap 项。优先级不是漏洞评级：目前没有证据支持将任何发现定为 P0。带“复现”的条目有本次运行证据；“代码确认”说明存在具体实现缺口，但未声称穷尽所有玩家触发方式；“调查”项先验证原因再决定是否改规则。

## 目标 / 非目标

目标：

- 玩家在取消操作、重启、继续征程和切换模式时，进度与交互状态保持一致。
- 坏存档、拒绝存储及多标签页竞争不会悄悄损坏另一局进度。
- 用真实浏览器行为测试补齐现有源码断言的盲点。
- 处理本次依赖审计结果，建立可复现、持续运行的校验。
- 降低启动资源需求和维护成本，保留全部已发现的产品与工程改进空间。

非目标：

- 本轮不修改业务代码、依赖和锁文件，不创建 todos/，不启动执行 agent。
- 不自动调卡牌或敌人数值，不重置黄金快照，不改变解锁门槛。
- 不部署、不发布、不生成新美术、不接入外部遥测或云服务。
- 不把自动出牌胜率当作真实玩家通关率，也不把审计命中直接等同于线上可利用漏洞。
- roadmap 项仅保留在方案中，后续 plan-to-todo 不应自动纳入。

## 探索依据与当前基线

### 已运行的校验

环境：Bun 1.4.2，Node.js v24.20.0，Linux。所有依赖操作均为读取或审计，没有运行安装或升级。

| 校验 | 结果 | 说明 |
| --- | --- | --- |
| bun run typecheck | 通过 | tsc --noEmit |
| bun run test | 通过 | 72 个测试文件，4,962 项测试；24.97 秒 |
| bun run build | 通过 | Vite 6.4.3，115 个模块；Vite 构建阶段 7.03 秒 |
| bun run desktop:test:unit | 通过 | 6 项路径、导航、外链、IPC 来源与响应测试 |
| 桌面源构建 smoke | 通过 | 在 Xvfb + Openbox 下验证实际存档、正常退出后重启继续、音频、全屏及 renderer 隔离 |
| bun run sim -t 'per-hero balance' | 通过，但报告存在无效格及带外指标 | 三武将 × 16 行 × 250 场，12,000 场；15.37 秒；只运行这一筛选项 |
| bun audit | 退出码 1 | 原样报告 9 vulnerabilities (3 high, 6 moderate)，详见附录 |
| bun outdated | 完成 | 有同主版本补丁和大版本候选，详见附录 |
| lint / format / coverage | 当前未配置 | 没有对应 package script、工具配置或覆盖率门槛；不能宣称已通过 |

桌面 smoke 在已有生产构建上执行的容器适配命令：

~~~bash
xvfb-run -a -s '-screen 0 1600x1000x24' sh -c 'openbox --sm-disable >/tmp/sangota-plan-openbox.log 2>&1 & node scripts/smoke-desktop.mjs --no-sandbox'
~~~

输出：

~~~text
Desktop smoke passed: bundled assets, audio, real game save, relaunch/resume, fullscreen, renderer isolation.
~~~

本轮未验证 Windows 或 macOS 的实际运行，未重新打包桌面发行文件；现有 Windows/Linux 打包 CI 只是代码中已配置的能力。未跑完整 sim、eval 或 eval:cards；定向模拟的 skipped 是 -t 筛选结果，并非被禁用的测试。

### 新增的诊断复现

使用临时 Playwright Chromium 上下文和本地 Vite 服务，通过开发构建的场景接口重现实际处理函数；没有改动测试文件或玩家真实存档。以下探针不等同于已经加入 CI 的回归测试。

| 场景 | 本次观察 |
| --- | --- |
| 普通局进入自定义并完成拜别 | 原存档种子 plan-browser 被 plan-custom 替换，custom=true；中途没有放弃正式征程的确认 |
| 打开“重新出征”确认，再按 Esc | 弹窗消失，但 isOverlayOpen(Title) 仍为 true；再按 Enter，Title 仍活动且 leaving=false |
| 点击第一间战斗房，在淡出前重载，再继续 | 节点 0_2 已记录 enter，encounterId=null、combat=null；恢复后仍在该节点，可选子节点 1_2，Combat 未启动 |
| localStorage 中存入同版本的 { version: 7 } 后重载 | 标题页抛出 Cannot read properties of undefined (reading 'length') |
| 地图打开人物抽屉后重启 Map 场景 | drawerOpen=true，但新抽屉的 drawerX=-430，状态与位置不一致 |
| 自定义种子页按 Ctrl+V | 本次得到字母 V，没有粘贴种子 |
| 拒绝 setItem 后设置 animSpeed=instant | 再次 getSettings().animSpeed 为 normal |
| 1 HP 的敌人受到 999 点伤害 | 敌人变为 0 HP；damage.amount 和累计 damageDealt 都是 999 |
| 对同一 run 连续调用 settleRun | totals.runs=2、victories=2，说明结算入口本身不幂等；不是宣称正常游戏已经自动结算两次 |

对跨局数据的独立内存探针还确认：

- career 仅包含 version=1 时，读取 totals.highScore 抛错。
- unlocks 的 heroes=null、victories=2 时，grantAvailableHeroes 调用 includes 抛错。
- ascension 的 cleared.guanyu="oops" 时，可选难度上限得到 NaN。

### 资源与测试结构

- public/assets/ 共 382 个文件，约 69.65 MiB；包含音乐双格式。构建 dist 总计 74,977,550 字节，约 71.50 MiB。
- 321 张 PNG/JPEG 的尺寸按 width × height × 4 估算，单份 RGBA 像素数据合计约 368.5 MiB；这不是实测 GPU 占用，不含解码副本、画布、生成纹理和其他对象。
- 最大图片是 3072 × 5504 的 map-bg.jpg，单份 RGBA 约 64.5 MiB。卡图约 100.2 MiB、敌人约 80.8 MiB。
- BootScene.preload 全量加载角色、敌人、卡牌、宝物、丹药和场景图；背景音乐已经懒加载，不能再把“音乐未懒加载”列为问题。
- 生产 JS 为单个 1,943.95 kB 文件，gzip 483.89 kB。当前 chunkSizeWarningLimit=2000，因此构建没有体积警告。
- tests/ 中 29 个文件含 import.meta.glob 的源码读取。它们并非全是文本测试，但多个场景流程只检查源码字符串；真实桌面 smoke 当前走的是标题 → 拜别 → 地图 → 重启继续，没有完整战斗、奇遇选牌或重开取消覆盖。
- 已检索 TODO/FIXME/XXX/HACK 和已知问题记录；绝大多数命中是历史说明，没有据此凭空推断功能未实现。
- 对跟踪文本文件做了常见 token / 私钥特征扫描，未命中；这不代表完成了 Git 历史或外部服务的密钥审计。未发现游戏层 eval / innerHTML 注入入口。Electron 已有 sandbox、contextIsolation、来源限制、外链白名单和生产 CSP，应保留这些防线。

## 方案

### 存档先表达“当前在做什么”

现有 SavedRun 主要是征程数据与可空战斗快照。改为由持久化层表达稳定的恢复位置，例如地图、待开始战斗、进行中的战斗、房间中的待选步骤、幕间交接和待结算结果。先定义恢复状态的判别联合与校验器，再让统一导航入口完成“记录意图 / 提交规则状态 / 持久化 / 场景展示”。

不要通过延长动画、在 beforeunload 临时补写，或简单地把每个 visited 节点都视为完成来修补。继续沿用 roomCommit 和独立 RNG 流；同一奖励、花费、遭遇及三幕双首领流程都需要保持只执行一次。对于目前未落盘的拜别，先明确恢复策略：现状在完成拜别离开时才首次存档，并不存在可直接恢复的“未完成拜别存档”。

读档分两层：先把未知 JSON 校验为可用数据，再校验牌、敌人意图、节点路径和账本之间的关系。标题页拿到 ok 之前就应完成必要验证，不等到标题消失后由 CombatScene 抛错。保留无法读取的原始数据，给出稳定的 broken / stale / unavailable 状态。

### 统一落盘反馈与结算边界

提取小型 storage adapter，统一读取、序列化及写入结果；保留同步存储实现，不为了抽象引入数据库。征程、跨局进度和设置可以共享 I/O 结果类型，但各自的校验、恢复与降级策略仍分开。

设置用经过 sanitize 的内存快照作为本次会话事实源，持久化失败不撤销用户刚做的设置；同时避免每个动画 dur 调用都重新读盘解析。跨标签页变化必须显式处理。

结算使用持久化的稳定 runId 和待提交结果，支持重试且不重复入史、加分、计胜或解锁。三本跨局账与征程清理必须有可恢复顺序，不能先清掉唯一进度再寄希望于后续写入全部成功。runId 与可重复输入的地图 seed 分开，且不能消耗玩法 RNG 或改变同种子结果。

### 先增加行为保护，再整理结构和资源

复用已安装的 Playwright 与桌面 smoke 经验，为浏览器增加可重复的场景夹具和真实输入测试。保留规则层及依赖方向的静态约束；只把承担交互正确性职责的源码断言逐步替换成行为断言。

资源优化先测量、建预算，再分成标题必需资源、当前武将与章节资源、典籍预览资源。显式素材名单已有缺失文件测试，新增 manifest 应保留“确认文件存在才注册纹理”的规则。资产分类不能重排卡池、宝物池或 RNG 索引顺序。

大文件按战斗流程、输入、奖励和视觉职责渐进拆分。先修已复现问题，再重构；不要用一次重写同时替换引擎、存档和所有场景。

## 拆解：完整发现清单

P0 表示需要立即止损的广泛严重问题；P1 表示影响进度、核心操作或应优先修复的工程风险；P2 表示有明确收益的后续改进。依赖是建议集成顺序；“验收依赖 R14”表示可独立修复，但应使用公共浏览器夹具补回归。

### A. 正确性、健壮性与玩家操作

| ID | 位置与问题 | 改进建议与验收 | 优先级 / 难度 | 依赖 |
| --- | --- | --- | --- | --- |
| R01 | src/scenes/TitleScene.ts:738、CustomScene.ts:346、BlessingScene.ts:505：自定义出征绕过普通重开确认，首次写档时覆盖正式征程。已在浏览器复现。 | 将真正开始自定义征程也接入统一的存档替换确认；进入自定义配置页和测试战场不应提前清档。取消、返回和试玩均保留原存档；明确确认开始后才替换。继续采用单存档，不在此项扩成多槽。 | P1 / medium | 验收依赖 R14；可复用 R02 修复后的关闭入口 |
| R02 | src/scenes/TitleScene.ts:368、src/ui/overlayStack.ts:68：confirmDiscard 的 onDismiss 只销毁 layer，未 release 覆盖层。Esc 后所有 isCardGridOpen 门仍关闭。已复现。 | Esc 和“再想想”共用幂等 close；覆盖栈与图层一起释放。验收连续打开/取消 3 次后可继续、选将、打开设置；嵌套弹窗只关最上层。 | P1 / easy | 验收依赖 R14 |
| R03 | src/state/save.ts:484、:414、:331、:233，TitleScene.ts:340：版本检查后直接强转，摘要可先崩溃；fromSaved 不预检完整 combat，坏意图可能在场景切换后才抛错。 | 增加未知输入到 SavedRun 的结构及关系校验，覆盖数字边界、重复/未知 uid、卡牌/丹药/宝物、合法路径、账本、战斗牌堆和 intentId。任何拒读不安装半成品 active run、不删原始档，标题仍可操作。 | P1 / hard | 无；UI 验收依赖 R14 |
| R04 | src/state/history.ts:170、unlocks.ts:78、ascension.ts:43：同版本数据缺字段/错类型仍进入业务对象，已复现 TypeError 和 NaN。settings.ts 已有 sanitize，不应复制此缺口。 | 为三本账分别做字段校验与兼容归一化；恢复合法条目、隔离坏条目并保留诊断来源，不把整个部分损坏的生涯直接覆盖成空白。难度限制为合法整数，未知内容 ID 的历史展示可降级。 | P1 / medium | 无；后续共用 R07 的 I/O 层 |
| R05 | src/scenes/nav.ts:31、TitleScene.ts:354、MapScene.ts:151、:484：enterRoom 在 Combat 建立前写 combat=null，恢复只进 Map；非战斗房也没有恢复路由。入战跳过已复现，奇遇 pending、商店/营帐退出前和首领交接为代码确认缺口。 | 引入可验证的恢复位置和未完成房间状态；恢复时继续欠下的遭遇/选牌/幕间，已完成步骤不再付款或发奖。验收覆盖入战淡出、普通战/精英/首领、奇遇触发战斗、花费后待选牌、宝箱、营帐、首领领完奖励后交接及天命二十重双首领。 | P1 / hard | R03；验收依赖 R14 |
| R06 | src/scenes/SummaryScene.ts:108、CombatScene.ts:3966、RoomScene.ts:509、src/state/history.ts:244：先清征程、再逐本写跨局账；死亡淡出时退出会没有待结算记录。settleRun 重入可重复计胜，已在内存探针确认。 | 建立 runId、待结算结果及可恢复的幂等提交协议；去重记录不只依赖最近 50 条战史。注入每一处写入失败/重启后，结果最终恰好入账一次，失败期间保留可重试结果；普通重复种子仍是不同征程。 | P1 / hard | R03、R04、R05、R07 |
| R07 | src/state/save.ts:469、history.ts:307、unlocks.ts:107 等：读写被拒都静默降级，writeSave 返回 void，玩家无法区分正在保存与实际上不能保存。readSlot 的读取失败还被归为空槽。 | 统一返回 ok / unchanged / unavailable / failed 等结果；提供非阻断、可恢复的保存状态反馈，在下一个稳定节点重试。测试配额不足、读取/删除失败，失败不报告保存成功，也不触发清空或无意覆盖。 | P1 / medium | 无 |
| R08 | 浏览器运行入口及 src/state/save.ts：没有 storage 事件、BroadcastChannel 或写入归属检查；两个同源标签页可各持有旧 run 并覆盖同一键。Electron 单实例锁不覆盖浏览器。代码确认竞态风险，未做压力复现。 | 明确单活跃写入者策略，以可恢复的所有权/版本检查阻止旧标签页覆盖新进度；第二标签页可以查看并明确接管。两页交替推进、关闭持有页、接管后重试均需验证，拒绝把两个 run 合并。 | P1 / hard | R05、R07；验收依赖 R14 |
| R09 | src/state/settings.ts:220、:253、src/ui/timing.ts:31：设置每次从存储重读，拒写时订阅者收到新值、调用方却又读回旧值；也让动画/震动查询重复解析设置。已复现 instant 变回 normal。 | 使用会话内设置快照和显式初始化/重置测试接口，更新先在内存生效，落盘结果单独反馈；处理外部 storage 更新。拒写时音频、动画、面板显示保持一致；相同快照的 dur 调用不重复 getItem/parse。 | P2 / medium | R07 |
| R10 | src/state/history.ts:200、TitleScene.ts:353、SummaryScene.ts:119：续档重设 runStartMark，只统计最后一次会话，“本局用时”和 totalPlayMs 低估实际投入。代码明确如此，属于需要改善的现有取舍。 | 持久化累计活动时长，恢复时继续累计，暂停/后台的计时口径写明；显示层传入时钟值，玩法 RNG 和规则层仍不读墙钟。验收分两次游玩 30+15 分钟合计 45 分钟，时钟回退不产生负值。 | P2 / medium | R03、R05 |
| R11 | src/combat/engine.ts:1012、src/state/run.ts:583、CombatScene.ts:3968：damage.amount 含溢出伤害，却被统计注释称为实际掉血；1 HP 敌人被记成造成 999 伤害。死因仅取最后行动敌人，自伤/诅咒/反刺可能归错因。 | 明确结算伤害、实际 HP 损失和伤害来源三个语义；统计使用实际损失，死因使用导致死亡的事件。保留现有伤害展示/钩子语义或显式迁移，验证溢出伤害、复活、自伤、毒、反刺；规则结果及 RNG 不因统计修正改变。 | P2 / medium | 无；场景验收依赖 R14 |
| R12 | src/scenes/MapScene.ts:136、:151、:872：drawerOpen 仅类初始化为 false，场景重建时新抽屉隐藏，标记仍可能为 true。已复现状态与 x=-430 冲突。 | 每次进入 Map 明确复位抽屉、拖动和其他会话字段；保留 sleep/wake 所需状态与 restart 的区别。验证打开抽屉→战斗往返/场景重启→第一次点击即可打开，Esc 不被旧标记吞掉。 | P2 / easy | 验收依赖 R14 |
| R13 | src/scenes/CustomScene.ts:190、:212：种子使用全局 keydown 手工录入，无 paste、选择范围或 modifier 处理；Ctrl+V 实际写入 V，与结算页“复制种子”衔接不完整。 | 为种子提供有焦点的输入或等价的粘贴/选择支持，统一合法字符与 24 字符限制；Ctrl/Cmd 组合键不追加字母。验收复制种子→粘贴→相同配置开局可复现，非法内容有明确反馈。 | P2 / medium | 验收依赖 R14 |

### B. 测试、安全与工程体验

| ID | 位置与问题 | 改进建议与验收 | 优先级 / 难度 | 依赖 |
| --- | --- | --- | --- | --- |
| R14 | tests/save.test.ts、summaryFlow.test.ts、confirm.test.ts 等源码断言；scripts/smoke-desktop.mjs:140 的正常路径覆盖有限。4,962 项通过仍漏掉本次真实交互问题。 | 新建独立浏览器行为校验入口，先提供隔离存储、固定种子、等待场景稳定和正常路径夹具；R01–R13 的修复各自加入回归。补实际出牌/拖牌/奖励/退出恢复、弹窗键盘层级与测试战场隔离。保留架构静态测试；不要求用一套脆弱像素快照替代行为断言。 | P1 / hard | 无，作为相关修复的验收基础 |
| R15 | .github/workflows/ci.yml 只跑 check；desktop.yml 的路径过滤没有 tsconfig、浏览器测试及多数测试配置；没有持续依赖审计或跨浏览器行为验证。现有 CI 并非缺失或已失败。 | 普通 PR 固定运行 web build 和必要行为 smoke；完善桌面构建触发路径；为依赖审计配置独立周期/依赖变更检查并明确修复责任。先 Chromium 门禁，再选择 WebKit/Firefox 的兼容性频率，控制总时长和失败截图。 | P2 / medium | R14、R16；静态检查接入依赖 R18 |
| R16 | package.json / bun.lock：bun audit 命中 Vitest/mocker、nanoid、sharp、undici，含 3 项 high。均由开发/构建工具链引入，实际触发条件不同。 | 沿现有主版本优先补安全版本：Vitest ≥4.1.11、nanoid 3.x ≥3.3.18、sharp ≥0.35.4、受影响的 undici 7.x ≥7.29.0；核查父依赖支持，不能强把 undici 6.x 跨主版本替换。只使用 Bun 并提交 bun.lock；重跑审计、check、build、desktop 单测与 smoke。未能清零的条目需说明路径、触发条件和替代措施。 | P1 / medium | 无 |
| R17 | 根 package-lock.json 仍登记 0.1.0 且缺 Electron/Playwright 等，package.json 为 0.0.1；没有 packageManager / engines 来表达 CI 的 Bun 与 Node 环境。 | 确认 Bun 为唯一依赖入口后移除过期 npm 锁文件；声明匹配 CI 的包管理器/开发环境约束，补贡献文档。不重新生成 package-lock.json。干净目录 bun install --frozen-lockfile 后校验通过，bun.lock 无意外漂移。 | P2 / easy | R16 后集成，避免同时改依赖元数据 |
| R18 | package.json、tsconfig.json：无 lint/format；include 仅 src、tests、sim，scripts/dev-scene.ts、工具配置及 .mjs/.cjs 脚本缺少统一静态检查。 | 选择最小的 lint/format 方案，补独立的工具脚本检查配置，区分浏览器与 Bun/Node 类型环境。不要一次性重排内容表；增量清理后接入 check/CI。验收故意引入脚本变量/异步处理错误时能被检查发现。 | P2 / medium | R17；接入 CI 与 R15 协调 |

### C. 性能、代码质量与内容验证

| ID | 位置与问题 | 改进建议与验收 | 优先级 / 难度 | 依赖 |
| --- | --- | --- | --- | --- |
| R19 | src/scenes/BootScene.ts:128、public/assets/：全部图像在标题之前加载，321 张图片约 368.5 MiB RGBA；素材 key 同时散布在定义和显式列表。没有自动的尺寸/体积预算。 | 先建素材 manifest 与测量报告，按显示尺寸优化超大贴图，再分标题/武将/章节/典籍按需加载；对低端设备检查最大纹理尺寸。保留缺图占位与可重试路径、离线桌面资源完整性。建议先以标题必需下载 ≤15 MiB、其 RGBA ≤64 MiB 为候选预算，实测后调整；记录冷启动、峰值内存和切场景延迟，不能只比较压缩文件大小。 | P2 / hard | R14；复杂加载不与 R22 同时大改 |
| R20 | src/main.ts、vite.config.ts：所有场景静态导入，JS 单包 1,943.95 kB；2,000 kB 警告阈值使增长暂不可见。 | 给 JS 体积和首次可交互时间建预算，评估 Phaser vendor 稳定缓存、工具/典籍的延后加载。拆 chunk 只改善缓存未必改善首屏，需以网络与解析测量验收；确认相对 base 和 sangota 协议均可加载拆包资源。 | P2 / medium | R14、R19 的基线；与 R22 协调 |
| R21 | src/ui/spriteBounds.ts:38：CanvasPool.create 后仅成功路径 remove，getContext/drawImage/getImageData 抛错时直接进入 catch，临时 canvas 未归还。 | 用 finally 释放池资源；失败结果保持正常布局回退。注入像素读取失败后池占用不累计、后续正常纹理可测量。资源优化时可再将静态轮廓边界提前计算到 manifest，避免首次出现角色时同步扫描所有像素。 | P2 / easy | 无；预计算扩展依赖 R19 |
| R22 | CombatScene.ts 4,026 行，heroCards.ts 3,013 行，relics.ts 2,038 行，cards/enemies/engine 各约 1,400–1,650 行。规则、展示和内容注册的维护负担集中。 | 战斗场景先按输入/回合驱动/奖励/视觉提取职责，再按武将或能力拆内容定义，稳定的 registry 保持导出和声明顺序。逐模块集成，记录依赖边界。黄金战斗、存档往返和卡池顺序不变，不把文件变短本身当作验收目标。 | P2 / hard | R01–R06 的相关修复、R14 |
| R23 | src/ui/compendiumView.ts:175 与 combat/intent.ts:42 重复招式分类；SummaryScene.ts:72 与 ui/historyView.ts:24 重复时长格式化；五处 store 访问器重复。已有部分全表对照测试。 | 抽取不依赖 Phaser 的共享分类/格式化函数，敌人“意图未知”等上下文规则保留在调用层；store 合并由 R07 承接。以现有全表对照和边界测试证明一致性，不移除必要的展示差异。 | P2 / medium | R07；与 R10、R22 协调 |
| R24 | sim/balance.sim.ts:579、sim/policy.ts、tactical.ts、docs/zhugeliang.md 及旧计划 results.md：当前逐武将抽测仍有 1 个无效格，47 个有效格中 33 个在目标带外；旧策略有多段与准备顺序盲点。 | 先按固定种子复核诸葛亮—张宝长局和带外场景，分开报告 greedy 与 tactical、样本数/区间、无效原因及可达到构筑。保留旧策略/黄金快照语义；无效行继续排除，不能简单提高 60 回合限制消失警告。是否改数值需在复核报告中证明玩法问题，而非追着自动策略的带宽改。 | P2 / hard（调查） | 无；涉及后续规则变更时依赖 R14 的行为回归 |
| R25 | README.md 缺少 check/test/sim 分层说明；vitest 配置仍写 npm 命令；AGENTS.md 的 references/full-reference.md 等四个相对路径实际不存在；index.html 标题仍为“杀戮尖塔”，README/桌面为“烽火尖塔”。历史 todos 引用缺少当前架构说明。 | 补开发/校验/诊断入口与规则边界文档，修复技能引用的真实路径或安装说明，统一当前产品标题。历史方案保留其时间语境，不把旧基线文字改写成现状。验收文档命令可执行、相对链接可解析，新增贡献者能独立启动与验证。 | P2 / easy | 汇总 R14–R18 的最终命令；标题/失效链接可先处理 |

### D. roadmap：仅进方案，不进入后续自动拆解

| ID | 位置 / 现状 | 改进方向与验收方向 | 优先级 / 难度 | 依赖 |
| --- | --- | --- | --- | --- |
| M01 | save.ts:44–64 的版本不匹配直接拒读；地图从 seed 重建，过去拓扑变更已连续使旧存档失效。docs/desktop.md 的备份仅复制 Chromium 目录，浏览器/桌面互不迁移。 | 设计版本化导出/导入、显式地图/内容版本及可验证迁移策略；必要时保留旧生成器或拓扑快照。导出覆盖征程、战史、解锁、设置，导入先预检并能回退；不把未知旧图硬套新规则。云同步只在本地格式稳定后另立需求。 | P2 / extreme / roadmap | R03–R08 |
| M02 | history.ts 的 cardsTaken 是最终牌组计数，不含奖励出现/跳过/移除机会；customRun 和 sim 只有局部复现能力，seed 不包含解锁状态、全部玩家选择和版本信息。 | 建本地可导出的决策日志与机会统计，记录规则版本、初始解锁/构筑、RNG 状态和选择；支持整局重放与故障报告。默认不上传用户数据，不能从当前“最爱卡牌”推断真实选取率。 | P2 / extreme / roadmap | R05、R06、R11、R24 |
| M03 | SettingsPanel.ts:332 的按键页只读；MapScene 部分键位硬编码；main.ts 未启用手柄输入。 | 建统一可改键动作表与菜单焦点导航，再接手柄映射。完整走过选将、地图、出牌选敌、奖励、商店和设置，全程可不用鼠标；冲突键和退出弹窗语义一致。 | P2 / hard / roadmap | R02、R09、R12、R14 |
| M04 | 固定 1280×720 设计空间、FIT 缩放、Canvas 交互、桌面键盘种子录入；没有语义化操作树或小屏专项验证。已有动画加速和震动设置，不能当作完全没有辅助选项。 | 调研触屏横/竖屏布局、文字可读性、触控目标、替代输入和可访问反馈，明确支持设备范围。先做可用性原型和完整一局操作验证，再决定 DOM 辅助层或布局重构。 | P2 / extreme / roadmap | R13、R14、R19 |
| M05 | bun outdated 提示 Phaser 4、TypeScript 7、Vite 8、Vitest 5 大版本候选；当前仍能构建并通过测试。 | 引擎与工具链分开做兼容性试验，核对 Phaser 纹理/相机/输入 API、Electron 协议和 Vitest 静态导入行为。只有收益与迁移成本明确后才安排；安全补丁由 R16 先处理，不能为了最新版本一次升级全部。 | P2 / extreme / roadmap | R14–R20 |
| M06 | src/data/acts.ts 的四幕 bgKey 都是 map-bg；MapScene.buildBackground 也固定读取同一纹理，战场背景同样共用。 | 先让章节背景从 ActDef 消费，再形成各幕地图与战场视觉辨识度；新增美术遵循仓库角色锚点和生成流程，生成前另行明确美术范围。验收同一 UI 对四幕背景可读、资源在 R19 预算内。 | P2 / hard / roadmap | R19 |
| M07 | docs/art/ 有诸葛亮的生成记录，但 public/assets 的卡牌、敌人、宝物、音频等没有统一来源清单；根目录未发现项目 LICENSE / 第三方 NOTICE。 | 整理资产 ID、来源、生成/处理记录、可分发依据和第三方声明，明确项目贡献与使用许可信息。验收发行资源可逐项追溯；具体许可选择留给维护者，不在本次审查中判定权利归属。 | P2 / medium / roadmap | R19、R25 |
| M08 | docs/desktop.md、electron-builder.yml：发行使用默认图标，Windows 未签名；macOS 没有运行矩阵；Steam 集成和发行配置仍是说明。 | 在明确发行平台后完善版本/变更记录、图标、签名、公证、安装/更新验证和相应 CI。成就、Overlay、云存档分别立设计，不直接同步整个 Chromium 用户目录；验收实际安装包的干净安装、升级保档和离线启动。 | P2 / hard / roadmap | R15、R17、M01、M07 |

## 建议执行顺序

1. 先建立 R14 的最小正常路径夹具；R02、R01、R03、R04 与 R16 是首批修复。夹具创建时不先提交一套永久失败的缺陷测试，各修复任务负责加入自己的行为回归。
2. R07 提供 I/O 结果基础；R03 后实现 R05；再将 R06 的结算协议和 R08 的浏览器写入归属接入。
3. 处理 R09–R13 的设置、统计及交互问题；R12/R13 可在首批交互修复后提前集成。
4. R17/R18 完善工程入口，R15 接入已有检查与浏览器 smoke；R24 独立产出平衡诊断，不阻塞存档修复。
5. R19/R20 在可测量基线上优化资源；R21 可单独修复；R22/R23 在行为保护之后逐步重构，R25 更新实际落地后的文档。
6. M01–M08 保留为 roadmap，须单独确定产品目标后才进入实施队列。

同时改 save.ts 的 R03/R05/R06/R07/R08 需要按接口顺序集成；依赖更新与工程配置共用 package.json/bun.lock，R16/R17/R18 不应各自独立刷新锁文件。拆 CombatScene、资源加载及行为测试夹具也应避免同时重写相同初始化流程。

## 执行偏好

- default_agent：codex；来源为当前会话宿主，未收到上游覆盖。
- 用户未指定全局模型或 reasoning effort，不在本计划固化模型选择。
- 用户未对单个任务指定 agent；后续 todos 应使用 agent: inherit，而不是把每项固定为 codex。
- 已读取 make-plan 引用的 agent-routing.md；后续拆队列时依照难度和届时有效规则解析模型，不在规划阶段启动 agent 或 Herdr。
- 没有调用子 agent；此次请求的交付边界仅为 plan.md。

## 校验与验收

### 保留的仓库级入口

~~~bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run desktop:test:unit
bun run build
bun audit
~~~

实施后可使用 bun run check 汇总 typecheck、test、desktop:test:unit，再单独 build。依赖未变化时不必重复安装；涉及依赖时必须同时检查 bun.lock。新浏览器、lint 或工具脚本检查命令由 R14/R18 实施时正式新增，这些目前不是可执行的现成命令。

### 按变更增加的验证

| 变更范围 | 必须验证 |
| --- | --- |
| 存储 / 导航 / 模式切换 | 正常与畸形 JSON、错误类型、未知内容、版本不符、拒读拒写拒删；真实浏览器中断点重载与继续；正式局、普通自定义、测试战场隔离 |
| 结算 | 成功/失败/重复提交及每个跨局账写入前后重启；最终恰好一次入史、加分、计胜、解锁；原有自定义不记账 |
| 交互 / 设置 | 点击、拖动、Enter、Esc、Ctrl/Cmd+V、嵌套覆盖层、Map 重启、无存储设置；相同操作多次往返 |
| 战斗规则 / 统计 / 内容拆分 | 默认测试中的 37 个黄金战斗、全卡牌/敌人不变量、存档恢复一致性；只改展示统计时规则结果与 RNG 状态不变 |
| 平衡调整 | 先跑 bun run sim -t 'per-hero balance'；按问题选完整 sim 或 eval:cards，分别报告有效样本、策略和保护退出。不要把退出当败局补进胜率 |
| 图像 / 拆包 | 冷缓存启动、慢网、缺图、最大纹理限制；1280×720 及高倍率画质，切场景延迟/内存；web build 与 Electron 本地协议 smoke |
| 桌面运行 | bun run desktop:test；无显示容器用上述 Xvfb/Openbox 包装。改打包清单时运行 desktop:pack 并用 smoke 的 --executable 检查实际产物 |
| 文档 / 配置 | 命令和相对链接可用，源码/构建/测试读取 canonical lock，旧实验产物不被覆盖 |

不要为文档格式、命名等可逆小改动机械添加测试。行为缺陷的回归必须验证真实结果，而不是再次检查实现是否含有某个字符串。

## 风险与假设

- 当前已通过的测试是本轮基线；本轮复现说明覆盖存在缺口，不应将问题描述为“现有 4,962 个测试失败”。
- 默认保持一个正式征程存档槽，R01 采用显式替换确认。独立自定义存档槽属于另一个产品设计，不因本次修复自动引入。
- 地图由种子重建、内容声明顺序参与奖励、场景复用、房间账本只提交一次、规则层不引入时钟/Phaser，都是当前重要约束。需要改变存档格式时记录兼容策略与 SAVE_VERSION，不直接清掉玩家旧档。
- 新的元数据与计时可以由展示/平台边界注入，但不能因此让玩法结果依赖时间。计时口径及兼容旧档的累计值需明示。
- storage adapter 不代表所有账必须采取同一降级策略；旧数据恢复、读取失败与新账号应当区分。
- 浏览器跨标签页和崩溃持久化的真实表现受平台影响；相关条目含明确的故障注入验收，不能只靠单进程内存探针宣布完成。
- 368.5 MiB 是图片像素展开估算。未测真实低端设备 FPS、GPU 内存或移动端首屏；资源预算是建议起点，实施需根据测量调整。
- 9 项依赖报告均经工具返回路径检查；Vitest 开发 mock 插件、sharp 不可信 HEIF 解码、undici cache/retry 等需要各自前提。目前是静态游戏，未发现这些服务接口在发行版中对玩家开放；补丁优先级不据此降为“不处理”。
- 大版本候选取自本次在线 registry 查询，后续执行要重新确认兼容性和可用补丁；不把当前最新版本当硬性目标。
- 现有 weak-card-audit 计划明确已实施，本方案只继承其剩余仪器盲点和无效样本，不重做已完成的十张改牌。
- 未做用户研究、完整跨平台实机验证或 Git 历史安全审计。roadmap 中的可访问性、发行和同步范围尚未定案，但不影响本次仓库探索方案的完成。

## 附录：原始校验信号

### 生产构建

~~~text
vite v6.4.3 building for production...
transforming...
✓ 115 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                    1.14 kB │ gzip:   0.62 kB
dist/assets/index-DXK8o3nJ.js  1,943.95 kB │ gzip: 483.89 kB
✓ built in 7.03s
~~~

### 依赖审计

以下保留 bun audit 的原始报告。其输出的 9 项计数含 Vitest 与 @vitest/mocker 对同一 advisory 的重复命中，不是 9 个独立线上漏洞。

~~~text
bun audit v1.4.2 (744846f84)

@vitest/mocker@4.1.10
  vitest > @vitest/mocker
  moderate: Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock (>=2.1.0 <4.1.11) - https://github.com/advisories/GHSA-82fw-gwwq-j7x9

nanoid@3.3.16
  vite > postcss > nanoid
  high: nanoid: custom generators can loop indefinitely when size is zero (<3.3.18) - https://github.com/advisories/GHSA-2v37-7h3g-55p8

sharp@0.35.2
  wrangler > miniflare > sharp
  high: sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545 (<0.35.4) - https://github.com/advisories/GHSA-rgj7-g3m4-5g8c

undici@7.28.0, 6.28.1
  electron > @electron/get > undici
  wrangler > miniflare > undici
  electron-builder > dmg-builder > app-builder-lib > @electron/get > undici
  moderate: undici vulnerable to downstream response desynchronization via retry interceptor (>=7.0.0 <7.29.0) - https://github.com/advisories/GHSA-8xcm-r25x-g524
  high: undici vulnerable to cross-user information disclosure and parse-time crash via degenerate private cache directives (>=7.0.0 <7.29.0) - https://github.com/advisories/GHSA-4cwx-7wf7-3272
  moderate: undici vulnerable to CRLF Injection via blob-like body 'type' property (>=7.0.0 <7.29.0) - https://github.com/advisories/GHSA-m8rv-5g2x-5cg5
  moderate: undici vulnerable to cross-user information disclosure via whitespace around equals in Cache-Control directives (>=7.0.0 <7.29.0) - https://github.com/advisories/GHSA-jr45-8vmc-qm54
  moderate: undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields (>=7.0.0 <7.29.0) - https://github.com/advisories/GHSA-v3r7-h72x-cjcm

vitest@4.1.10
  (direct dependency)
  moderate: Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock (>=2.1.0 <4.1.11) - https://github.com/advisories/GHSA-82fw-gwwq-j7x9

9 vulnerabilities (3 high, 6 moderate)

  bun audit fix           upgrade the vulnerable packages within their ranges
  bun audit fix --latest  also cross major versions
~~~

已核对的安全公告、维护者说明与触发条件：

- Vitest/mocker 需要触及对应 mock 注册/加载路径；公开插件路径与 Vitest 自身带 token 的 browser RPC 应分别评估。[Vitest 公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)
- nanoid 审计涉及零长度自定义生成器，不能仅从 Vite→PostCSS 路径推出游戏运行时会卡死；修复范围需覆盖当前 3.x 分支。[nanoid 安全公告](https://github.com/advisories/GHSA-2v37-7h3g-55p8)、[维护者 3.3.18 发布记录](https://github.com/ai/nanoid/releases/tag/3.3.18)
- sharp 公告针对受影响版本处理不可信 HEIF 输入；本项目命中来自 Wrangler→Miniflare 的依赖。[sharp 公告](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c)
- undici 高危缓存项需要 cache interceptor 等使用条件，补丁版本与受影响主版本分别确认。[undici 公告](https://github.com/nodejs/undici/security/advisories/GHSA-4cwx-7wf7-3272)

### 大版本与补丁候选

bun outdated 原始结果：

~~~text
bun outdated v1.4.2 (744846f84)
|------------------------------------------------|
| Package          | Current | Update  | Latest  |
|------------------|---------|---------|---------|
| phaser           | 3.90.0  | 3.90.0  | 4.2.1   |
|------------------|---------|---------|---------|
| typescript (dev) | 5.9.3   | 5.9.3   | 7.0.2   |
|------------------|---------|---------|---------|
| vite (dev)       | 6.4.3   | 6.4.3   | 8.3.0   |
|------------------|---------|---------|---------|
| vitest (dev)     | 4.1.10  | 4.1.11  | 5.0.0   |
|------------------|---------|---------|---------|
| wrangler (dev)   | 4.118.0 | 4.131.1 | 4.131.1 |
|------------------------------------------------|
~~~

### 逐武将模拟的带外及无效结果

原样保留报告中的警告和指标；未改策略或提高保护上限：

~~~text
### 三将逐场 — 250 fights per row, greedy, act-appropriate kit

每格是该 tier 的 band 指标（首领看胜率，精英看体力消耗）。⚠ = 落在带外。
按当前武将牌池分别评测；三名武将均已开放。
保护退出不是正常败局：对应格子标为无效，不进入目标带比较。

| tier | 关羽 | 赵云 | 诸葛亮 | band |
|---|---|---|---|---|
| elite 华雄 | 52% | 55% | 46% | 40%–55% cost |
| elite 管亥 | 50% | 62% ⚠ | 73% ⚠ | 40%–55% cost |
| elite 张曼成 | 28% ⚠ | 22% ⚠ | 25% ⚠ | 40%–55% cost |
| boss 吕布 | 70% | 49% | 62% | 45%–70% win |
| boss 张梁 | 56% | 36% ⚠ | 20% ⚠ | 45%–70% win |
| boss 张宝 | 77% ⚠ | 75% ⚠ | 无效（1 次保护退出） | 45%–70% win |
| elite 李傕 | 57% ⚠ | 59% ⚠ | 33% ⚠ | 40%–55% cost |
| elite 郭汜 | 54% | 58% ⚠ | 40% ⚠ | 40%–55% cost |
| boss 董卓 | 42% ⚠ | 23% ⚠ | 70% | 45%–70% win |
| boss 李儒 | 80% ⚠ | 46% | 58% | 45%–70% win |
| elite 许褚 | 60% ⚠ | 75% ⚠ | 38% ⚠ | 40%–55% cost |
| elite 庞德 | 63% ⚠ | 64% ⚠ | 24% ⚠ | 40%–55% cost |
| boss 夏侯渊 | 53% | 42% ⚠ | 82% ⚠ | 45%–70% win |
| boss 张辽 | 38% ⚠ | 38% ⚠ | 87% ⚠ | 45%–70% win |
| elite 司马懿 | 62% ⚠ | 66% ⚠ | 20% ⚠ | 40%–55% cost |
| boss 天命 | 46% | 38% ⚠ | 78% ⚠ | 45%–70% win |

**Outside band** (per hero): 关羽 9/16　·　赵云 13/16　·　诸葛亮 11/15
~~~

旧实验的处置与种子记录见 [弱卡排查结果](../weak-card-audit/results.md#保护退出)，玩法与长局说明见 [诸葛亮文档](../../docs/zhugeliang.md)。这些历史产物作为参考，当前结论以上述本次运行结果为准。
