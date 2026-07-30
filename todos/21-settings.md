# 21 · 设置菜单

## 现状

完全没有设置。全项目没有任何可调选项，也没有任何用户偏好持久化。

`RENDER_SCALE` / `CANVAS_WIDTH` / `CANVAS_HEIGHT`（`src/config.ts:24-34`）
在**模块加载时算一次**：

```ts
const rawScale = ((): number => {
  const dpr = window.devicePixelRatio || 1;
  const fit = Math.min(window.innerWidth / GAME_WIDTH, window.innerHeight / GAME_HEIGHT);
  return Math.max(1, Math.min(fit * dpr, 3));
})();
```

README 说了后果：「Enlarging the window afterwards falls back to Phaser's
FIT scaling, so it softens gradually rather than re-laying out mid-run;
reload to re-sharpen.」——**放大窗口会变模糊，必须刷新页面**。
一旦有了 [08 存档](08-save-resume.md)，刷新的代价就低了；
但在设置里给一句提示（或一个「重新加载以适配窗口」按钮）会更好。

按键目前是硬编码散落在各场景：`E` 结束回合、`Esc` 取消/关闭、
`Space` 地图归位（README 有列）。没有键位说明界面，玩家只能靠猜。

## 原版行为

设置面板分几组：

**画面** — 分辨率、全屏、垂直同步、UI 缩放
**音频** — 主音量、音乐音量、音效音量
**游戏** —
- **动画速度**（Fast Mode：跳过部分动画，硬核玩家必开）
- **确认提示**（打出无目标的牌是否确认、能量未用完时结束回合是否确认）
- **自动结束回合**（能量用完且无可打牌时自动结束）
- **禁用鼠标悬停放大**
- **隐藏战斗提示**
**按键** — 全部可重绑
**语言** — 多语言
**其他** — 清除存档、查看统计、退出

原版里最有价值的两项是**动画速度**和**确认提示**：
前者是老玩家的必需（原版动画完整播完一场战斗要 4-5 分钟），
后者防止误操作（把关键牌打错目标）。

## 设计方案

本项目的战斗动画做得很足（`src/ui/vfx.ts` + `CombatScene` 里的
突进/后仰/hitstop/倾倒溶解），跑第二十局的时候必然想跳过。
所以**动画速度是第一优先的设置项**。

分四组，一个面板搞定：

### 画面
| 项 | 说明 |
|---|---|
| 全屏 | `scale.startFullscreen()` |
| 渲染倍率 | 自动 / 1× / 2× / 3×，改完提示需重载 |
| 屏幕震动 | 开 / 弱 / 关（有人对震动敏感） |

### 音频
| 项 | 说明 |
|---|---|
| 音乐音量 | 0-100 滑块 |
| 音效音量 | 0-100 滑块 |

### 游戏
| 项 | 说明 |
|---|---|
| **动画速度** | 正常 / 快速（1.6×）/ 极速（2.5×，跳过非必要动画） |
| 能量未尽时确认结束回合 | 开 / 关（默认开） |
| 打出牌前确认 | 关 / 仅稀有牌 / 全部（默认关） |
| 自动结束回合 | 开 / 关（无可打牌时） |
| 显示本回合总入伤 | 开 / 关（见 [16 意图](16-intent-system.md)） |

### 按键
显示当前绑定并允许重绑（第一版可以只显示不允许改）。

## 数据结构

```ts
// src/state/settings.ts (新增)

export interface Settings {
  version: number;
  // 画面
  fullscreen: boolean;
  renderScale: 'auto' | 1 | 2 | 3;
  screenShake: 'full' | 'reduced' | 'off';
  // 音频
  musicVolume: number;      // 0..1
  sfxVolume: number;
  // 游戏
  animSpeed: 'normal' | 'fast' | 'instant';
  confirmEndTurn: boolean;
  confirmPlay: 'off' | 'rare' | 'all';
  autoEndTurn: boolean;
  showIncomingDamage: boolean;
  // 按键
  keys: Record<KeyAction, string>;
}

export type KeyAction =
  | 'endTurn' | 'cancel' | 'recenter' | 'viewDeck'
  | 'viewDraw' | 'viewDiscard' | 'settings'
  | 'card1' | 'card2' | 'card3' | 'card4'
  | 'card5' | 'card6' | 'card7' | 'card8' | 'card9' | 'card10'
  | 'potion1' | 'potion2' | 'potion3';

export const DEFAULT_SETTINGS: Settings;

/** 单例。读写自动同步 localStorage。 */
export function getSettings(): Settings;
export function updateSettings(patch: Partial<Settings>): void;
export function onSettingsChange(cb: (s: Settings) => void): () => void;
```

## 实现步骤

1. `src/state/settings.ts`：单例 + localStorage 持久化 + 变更订阅。
   带 `version` 字段，版本不匹配时 merge 默认值（**不要丢弃整个设置**——
   加一个新选项不应该重置用户的音量）。
2. **动画速度**是最需要小心的一项。现有动画大量用
   `await` + `scene.time` 和 `scene.tweens`。README 里有一条重要提示：
   > `hitStop()` scales only `tweens.timeScale`, never `time.timeScale` —
   > the animation `await`s run on the scene clock

   所以要实现「快速模式」，**不能**简单地调 `time.timeScale`——那会
   影响 `await` 的时长，可能反而是想要的效果，但会和 hitstop 的设计冲突。
   正确做法是引入一个统一的时长换算：
   ```ts
   // src/ui/timing.ts
   export function dur(ms: number): number {
     const s = getSettings().animSpeed;
     return s === 'fast' ? ms / 1.6 : s === 'instant' ? ms / 2.5 : ms;
   }
   ```
   然后把 `CombatScene` 和 `vfx.ts` 里**所有** duration/delay 字面量
   过一遍 `dur()`。`instant` 模式额外跳过纯装饰动画
   （尘土、水墨飞溅、屏幕洗色），只保留必要的状态反馈。
   这是机械但必须逐处做的工作。
3. **屏幕震动**：`reduced` 减半强度，`off` 直接跳过。
   注意 README 那条：「Camera shake pulls empty space in at the edges,
   so the combat backdrop and ground band are drawn with ~6% bleed」——
   关掉震动后那 6% 出血是无害的，不用改。
4. **确认提示**：
   - `confirmEndTurn`：`E` 结束回合时若 `state.energy > 0` 且手里有
     可打的牌，弹一个轻量确认（原版是一个小气泡而非模态框）
   - `confirmPlay`：点卡后先高亮不立即结算，再点一次或点「确认」
5. **自动结束回合**：每次 `playCard` 后检查是否还有可打的牌
   （遍历手牌调 `canPlay`，`src/combat/engine.ts:210`），
   没有则延迟 700ms 自动结束。要能被玩家的任意操作打断
   （比如他想用丹药）。
6. **渲染倍率**：改 `config.ts` 的 `rawScale` 让它先读设置
   （`'auto'` 走现有逻辑，数字则直接用）。改完提示「重载后生效」
   并给一个「立即重载」按钮——有了 [08 存档](08-save-resume.md)
   重载的代价很低。
7. 设置面板 UI：全屏 overlay（复用 [07 牌堆查看器](07-deck-viewer-done.md)
   的 overlay 骨架），左侧分组 tab，右侧选项列表。
   滑块和开关用 `src/ui/theme.ts` 的风格自己画。
8. 入口：所有场景右上角一个齿轮图标 + `Esc` 在没有其他 overlay 时打开
   （注意 `Esc` 现在在战斗里是「取消选敌」，要分优先级）。
9. 面板底部放「清除存档」和「查看统计」（见
   [22 结算与统计](22-run-summary.md)、[23 图鉴](23-compendium-and-unlocks.md)）。

## 验收标准

- 设置在刷新页面后保留
- 加一个新设置项后，用户之前调的音量不被重置
- 快速模式下一场普通战的总时长明显缩短（正常 ~90s → 快速 ~55s），
  且所有状态反馈仍然可读
- 极速模式跳过装饰动画但保留伤害数字、护甲变化、死亡反馈
- 关闭屏幕震动后完全没有震动，且背景不露边
- 能量剩 2 点时按 `E` 会确认；能量为 0 时直接结束
- 自动结束回合在无可打牌时触发，且能被用丹药的操作打断
- 音量滑块实时生效（不用重启）
- 改渲染倍率提示重载，重载后确实更锐利/更省
- `Esc` 优先级正确：战斗选敌中按 `Esc` 取消选敌，不打开设置

## 依赖

- [20 音频](20-audio.md)——音量项的实际作用对象
- [07 牌堆查看器](07-deck-viewer-done.md)——overlay 骨架
- [24 战斗交互](24-combat-input.md)——按键重绑和它的键位定义共用
  `KeyAction`，两者应一起做
