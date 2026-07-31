# 20 · 音频系统

## 现状

**完全没有声音**。全项目零 `this.sound` 调用，`BootScene`
（`src/scenes/BootScene.ts`）只 preload 图片，`public/assets/` 下没有音频目录。

README 明确写了：「No sound at all — every beat of combat feel is currently
visual only.」

而战斗手感的视觉部分做得相当细致（`src/ui/vfx.ts` 316 行：
笔刷斩击、冲击爆发、尘土、护盾闪光、水墨飞溅、弹出文字、屏幕洗色、回合横幅；
`CombatScene` 里还有突进、后仰、呼吸、倾倒溶解死亡、HP 拖尾段、
气球弹出、意图徽章揭示）。**这些动画有一半的表现力依赖声音**——
斩击没有刀声，冲击没有闷响，等于把打击感砍掉一半。

架构上有个现成的好条件：README 说的
「The engine emits a `CombatEvent[]` and the scene drains it, so animation is
sequenced off the rules rather than interleaved with them」——
音效可以挂在同一个事件排水管道上，和动画同源同步，几乎不用改结构。

## 原版行为

三层：

**1. 音乐** — 每幕一首环境曲 + 战斗曲，精英/Boss 战独立曲目。
房间类型切换时交叉淡入淡出。Boss 战有独立的进入音效（stinger）。

**2. 音效** — 极其密集，大致分类：
- UI：按钮悬停/点击、地图节点选择、翻页
- 卡牌：抽牌（每张略有音高差）、拿起、放下、打出（按类型不同）、
  弃牌、洗牌、消耗（独特的燃烧声）
- 战斗：攻击命中（按伤害档位三种）、护甲获得、护甲被击穿、
  掉血、上 buff/debuff、敌人死亡、玩家死亡
- 敌人：每类敌人独立的攻击声和死亡声
- 资源：能量消耗、金币获得、遗物获得（清亮的铃声）、药水使用

**3. 混音** — 音乐/音效独立音量，音效有随机音高偏移（±5%）
避免连续同音效听起来像机器。

原版还有一个关键细节：**打击音效和 hitstop 是对齐的**——
声音的 attack 落在动画卡顿的那一帧上。

## 设计方案

国风音色：古琴/箫/鼓/编钟做音乐，刀剑/战鼓/马蹄/铜锣做音效。

### 分级实施

**第一批（最小可用集，约 20 个音效 + 4 首音乐）**

| 类别 | 音效 |
|---|---|
| UI | 按钮点击、节点选择 |
| 卡牌 | 抽牌、打出攻击、打出谋、打出势、弃牌、洗牌 |
| 战斗 | 命中（轻/中/重 三档）、护甲获得、护甲击穿、掉血、上状态、敌人死亡 |
| 资源 | 消耗气、获得资财、获得宝物 |
| 音乐 | 标题、地图、普通战、Boss 战 |

**第二批** 每类敌人独立攻击/死亡声、精英战曲、幕间过场、
房间场景（营帐/商店/事件）各自的环境音。

### 事件驱动

音效**绑在 `CombatEvent` 上**，和动画一起在排水时触发。这是关键：

| CombatEvent | 音效 |
|---|---|
| `damage`（amount 分档） | hit-light / hit-mid / hit-heavy |
| `damage`（blocked > 0） | block-break |
| `block` | block-gain |
| `status` | status-buff / status-debuff（按 `STATUS_META.kind`） |
| `death` | enemy-death |
| `draw` | card-draw（音高按手牌序号微调） |
| `discard` | card-discard |
| `shuffle` | shuffle |
| `passive` / `relic` | relic-trigger |

## 数据结构

```ts
// src/audio/sfx.ts (新增)

export type SfxId =
  | 'ui-click' | 'ui-hover' | 'map-select'
  | 'card-draw' | 'card-attack' | 'card-skill' | 'card-power'
  | 'card-discard' | 'card-exhaust' | 'shuffle'
  | 'hit-light' | 'hit-mid' | 'hit-heavy'
  | 'block-gain' | 'block-break' | 'hp-loss'
  | 'status-buff' | 'status-debuff'
  | 'enemy-death' | 'player-death'
  | 'energy-spend' | 'gold-gain' | 'relic-gain' | 'relic-trigger'
  | 'potion-use';

export type MusicId = 'title' | 'map' | 'combat' | 'combat-elite' | 'combat-boss';

export interface SfxOptions {
  /** 音量倍率，叠在全局音效音量上。 */
  volume?: number;
  /** 随机音高偏移幅度，默认 0.05。 */
  pitchJitter?: number;
  /** 固定音高偏移（抽牌按序号递增）。 */
  detune?: number;
}

/** 全局音频管理器。挂在 game.registry 上，跨场景共享。 */
export class Audio {
  play(id: SfxId, opts?: SfxOptions): void;
  music(id: MusicId, fadeMs?: number): void;
  stopMusic(fadeMs?: number): void;
  setMusicVolume(v: number): void;   // 0..1
  setSfxVolume(v: number): void;
  /** 静音（切标签页时自动调用）。 */
  setMuted(m: boolean): void;
}
```

## 实现步骤

1. **音源获取**：走 `genmedia` 的音频端点生成
   （`genmedia models "sound effect" --json` 找可用模型；音乐用
   text-to-music，音效用 text-to-audio，两者都需要 `--async` + 轮询，
   见 AGENTS.md 里的 genmedia 用法）。备选是免费素材库。
   格式用 **`.ogg` + `.m4a` 双份**——Phaser 会按浏览器支持挑，
   Safari 不支持 ogg，只给 ogg 在 Safari 上会静默无声。
2. `src/audio/sfx.ts`：`Audio` 类。要点：
   - 音量存 localStorage（和 [21 设置](21-settings.md) 联动）
   - `play` 内部做**并发限流**：同一 `SfxId` 在 40ms 内只响一次，
     否则多段攻击（`hits: 3`）会叠成爆音
   - 随机音高：`detune: (rng - 0.5) * 2 * jitter * 1200` cents。
     **这里可以用 `Math.random()`**——音频不影响游戏逻辑，
     不需要走 `src/core/rng.ts` 的可复现路径
   - 音乐交叉淡入：两个 `Phaser.Sound` 实例互相 fade
3. `BootScene`（`src/scenes/BootScene.ts`）：preload 音频。
   **音频体积远大于图片**，要注意：
   - 音乐用流式加载（`loadAudioSprite` 或延迟到进入对应场景再 load），
     不要全部塞进 boot，否则首屏时间会明显变差
   - 现在 BootScene 有 loading 进度条的话要把音频算进总进度
4. **浏览器自动播放策略**：Chrome/Safari 会阻止无交互的音频播放。
   必须在**第一次用户点击之后**才 `music('title')`。
   `TitleScene` 里挂一次性的 pointerdown 解锁（`this.sound.unlock()`）。
   在解锁前不要报错也不要静默失败——记一个 pending 状态，解锁后补播。
5. `CombatScene` 的事件排水循环里按上表加 `audio.play(...)`。
   **对齐 hitstop**：README 提到 `hitStop()` 只缩放 `tweens.timeScale`，
   所以音效应该在 hitstop **开始的那一帧**播，而不是动画结束时。
6. `MapScene` / `TitleScene` / 各房间场景：按钮点击/悬停音、
   进入房间时切音乐。
7. 场景切换时的音乐：地图 ↔ 战斗要交叉淡入（400ms），
   不能硬切。Boss 战前加一个 stinger（铜锣一击）。
8. 切标签页自动静音：`document.addEventListener('visibilitychange', ...)`。

## 验收标准

- 打出劈砍：有刀声，命中有闷响，且响声落在 hitstop 那一帧上
- 三档伤害对应三种命中音（打 4 伤和打 20 伤听起来明显不同）
- 多段攻击（山贼双斧 5×2）响两声而不是叠成一声爆音
- 连续抽 5 张牌，5 声抽牌音的音高递增，不是同一个音重复
- 护甲被击穿和护甲吃满是两种不同的声音
- 地图 → 战斗的音乐交叉淡入，不硬切
- Boss 战有独立音乐和进入 stinger
- 音效/音乐音量可分别调节并持久化
- 在 Safari 上有声音（说明双格式生效）
- 首次进入不因为自动播放策略报错；点击后音乐正常开始
- 切到其他标签页自动静音，切回恢复
- 加入音频后首屏加载时间增加在可接受范围（音乐延迟加载）

## 依赖

- [21 设置菜单](21-settings.md)——音量控制的 UI（可以先做一个临时的
  `M` 键静音，不阻塞）
- 弱依赖 [09 多幕](09-acts-and-progression-done.md)（每幕独立音乐）
- 弱依赖 [15 敌人机制](15-enemy-mechanics-done.md)（每类敌人独立音效）
