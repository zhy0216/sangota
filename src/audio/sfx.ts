import type Phaser from 'phaser';
import {
  DEFAULT_SETTINGS,
  getSettings,
  onSettingsChange,
  updateSettings,
  type Settings,
} from '../state/settings';

/**
 * 音频管理器 (todos/20 b3) — 音效与音乐的唯一出口。挂在 `game.registry` 上
 * 跨场景共享（`getAudio`），场景层只管在事件排水时喊 `audio.play(...)`。
 *
 * 两条约定边界，皆以 `tests/integrity.test.ts` 为准：
 * - **时钟禁令覆盖全 `src/`**（「keeps the clock out of every file, rules
 *   layer or not」），所以限流窗口读的是 `game.getTime()`——Phaser 主循环
 *   的时间轴——而不是 `Date.now`（那道扫描连注释一起数，这里也不拼全它）；
 * - **`Math.random` 只在规则层被禁**（`RULES_DIRS` 不含 `src/audio/`），
 *   随机音高直接掷真骰。todo 原文点名：音频不影响游戏逻辑，
 *   不需要走 `src/core/rng.ts` 的可复现路径。
 *
 * Phaser 只以类型进来（`import type`）：运行时全部经构造时传入的 `game`
 * 实例走，于是本模块能在 Node 下被 vitest 直接 import——纯函数层照常测，
 * `Audio` 类也能拿假 game 测（仓库惯例：Phaser 本体进不了 Node）。
 */

// ------------------------------------------------------------------- 音源清单

/**
 * 第一批音效，25 个。字面量兼作 loader key 与文件名——
 * `public/assets/audio/sfx/<id>.ogg` / `.m4a`（b1 的产出清单，一字不差）。
 *
 * 数组是唯一事实源，`SfxId` 从它派生（b4）：`BootScene` 拿它逐个 preload，
 * 类型上新增一个 id 而 boot 漏载在这儿成为不可能——两者是同一份清单。
 */
export const SFX_IDS = [
  'ui-click', 'ui-hover', 'map-select',
  'card-draw', 'card-attack', 'card-skill', 'card-power',
  'card-discard', 'card-exhaust', 'shuffle',
  'hit-light', 'hit-mid', 'hit-heavy',
  'block-gain', 'block-break', 'hp-loss',
  'status-buff', 'status-debuff',
  'enemy-death', 'player-death',
  'energy-spend', 'gold-gain', 'relic-gain', 'relic-trigger',
  'potion-use',
] as const;

export type SfxId = (typeof SFX_IDS)[number];

/**
 * 第一批音乐，4 首（b2 的产出清单）。todo 数据结构节里的第 5 首
 * `combat-elite` 属第二批（精英战曲），音源就位前不进类型——
 * 类型与文件名的一字不差比提前占位更值钱。
 */
export type MusicId = 'title' | 'map' | 'combat' | 'combat-boss';

export interface SfxOptions {
  /** 音量倍率，叠在全局音效音量上。 */
  volume?: number;
  /** 随机音高偏移幅度，默认 0.05。 */
  pitchJitter?: number;
  /** 固定音高偏移（cents；抽牌按序号递增）。 */
  detune?: number;
}

// ------------------------------------------------------------------- 音量账本

/** `Audio` 内部记账的形态——20 的旧字段名（music/sfx），免得类里全改名。 */
export interface AudioSettings {
  version: number;
  /** 音乐音量 0..1。 */
  music: number;
  /** 音效音量 0..1。 */
  sfx: number;
}

/** 旧账（`AUDIO_SETTINGS_KEY`）能读的最后一个版本——settings 的迁移按它对版。 */
export const AUDIO_SETTINGS_VERSION = 1;

/**
 * 曾是第五把钥匙，自 21 设置（todos/21 t1）起退役为**旧账**：音量的唯一
 * 事实源移进 `src/state/settings.ts` 的总账（`sangota.settings.v1`），
 * `getAudioSettings` / `saveAudioSettings` 只是它的适配层。本键仅在总账
 * 缺席时被 settings 迁移读一次（老玩家的音量不丢），此后不再写入——
 * 没有写入方，两本账打不起来。
 */
export const AUDIO_SETTINGS_KEY = 'sangota.audio.v1';

/** 音量夹到 0..1；NaN/Infinity（损坏的账）落到 0——静音比爆音体面。 */
export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** 默认音量——即 21 总账的默认音量，换回 20 的旧字段名。函数而非常量：不共享。 */
export function defaultAudioSettings(): AudioSettings {
  return {
    version: AUDIO_SETTINGS_VERSION,
    music: DEFAULT_SETTINGS.musicVolume,
    sfx: DEFAULT_SETTINGS.sfxVolume,
  };
}

/** 读音量——21 总账的适配层。夹取、兜底、旧账迁移全在 `settings.ts` 那边。 */
export function getAudioSettings(): AudioSettings {
  const s = getSettings();
  return { version: AUDIO_SETTINGS_VERSION, music: s.musicVolume, sfx: s.sfxVolume };
}

/** 写音量——写进 21 总账。变更经 `onSettingsChange` 广播回每个听者。 */
export function saveAudioSettings(settings: AudioSettings): void {
  updateSettings({ musicVolume: settings.music, sfxVolume: settings.sfx });
}

// ------------------------------------------------------------------- 纯函数层

/**
 * 同一音效的限流窗口：40ms 内只响一次，否则多段攻击（山贼双斧 `hits: 3`）
 * 会叠成一声爆音（todo 实现步骤 2 点名）。
 */
export const SFX_THROTTLE_MS = 40;

/** 上一次在 `lastAt` 响过、现在是 `now`——这一声要不要吞掉。 */
export function shouldThrottle(lastAt: number | undefined, now: number): boolean {
  return lastAt !== undefined && now - lastAt < SFX_THROTTLE_MS;
}

/** 随机音高偏移幅度的默认值（±5%，todo 原版行为节）。 */
export const DEFAULT_PITCH_JITTER = 0.05;

/**
 * 掷出的 `roll`（0..1）换算成 cents：`(roll - 0.5) * 2 * jitter * 1200`。
 * jitter 0.05 时落在 ±60 cents——半个半音上下，连响不像机器又听不出跑调。
 */
export function jitterDetune(roll: number, jitter: number): number {
  return (roll - 0.5) * 2 * jitter * 1200;
}

/**
 * 双位静音合成（b4，todo 实现步骤 8）：`user` 是玩家手动拨的闸，`hidden` 是
 * 切标签页自动拨的闸，任一位落下总闸就落。分两位记是为了切回标签页时
 * 只抬 `hidden` 位——玩家手动静音的状态原样保留，不被切页覆盖。
 */
export function combinedMute(user: boolean, hidden: boolean): boolean {
  return user || hidden;
}

/**
 * 懒加载队列去重（b4）：已进 cache（载完了）或已在途（`ensureMusic` 排过队）
 * 都不再排第二次——重复 `load.audio` 同一个 key 是白流量，还会翻倍回调。
 */
export function shouldStartLoad(inCache: boolean, inFlight: boolean): boolean {
  return !inCache && !inFlight;
}

/** 音乐交叉淡入的默认时长（todo 实现步骤 7：地图 ↔ 战斗 400ms）。 */
export const MUSIC_FADE_MS = 400;

/** 线性淡音量：`elapsed` 走到 `duration` 时恰好落在 `to`，越界夹住不回弹。 */
export function fadeVolume(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to;
  return from + (to - from) * (elapsed / duration);
}

// ------------------------------------------------------------------- 管理器

/**
 * `BaseSound` 的类型上没有音量——WebAudio/HTML5 两个实现都有，窄化一层。
 * `NoAudioSound`（音频被整体禁用时）也实现了同名空转方法，安全。
 */
interface FadableSound extends Phaser.Sound.BaseSound {
  readonly volume: number;
  setVolume(value: number): unknown;
}

/** 一条进行中的淡入/淡出。`stopWhenDone`：淡到头之后停掉并销毁（淡出用）。 */
interface Fade {
  sound: FadableSound;
  from: number;
  to: number;
  elapsed: number;
  duration: number;
  stopWhenDone: boolean;
}

/** 全局音频管理器。挂在 `game.registry` 上，跨场景共享——用 `getAudio` 取。 */
export class Audio {
  private readonly game: Phaser.Game;
  private settings: AudioSettings;
  /** SfxId → 上一次实际发声的 `game.getTime()`，限流窗口的账。 */
  private readonly lastPlayed = new Map<SfxId, number>();
  private currentMusic: FadableSound | null = null;
  private currentMusicId: MusicId | null = null;
  private fades: Fade[] = [];
  /**
   * 自动播放闸（b4，todo 实现步骤 4）：Chrome/Safari 禁止无交互出声，
   * 第一次用户 pointerdown 之前这里是 false——`play` 静默吞掉，`music`
   * 记进 `pendingMusic`，解锁后补播。
   */
  private unlocked = false;
  /** 想播而还播不了的音乐（闸没开、或懒加载还在途）。解锁/载完时补播。 */
  private pendingMusic: { id: MusicId; fadeMs: number } | null = null;
  /** 懒加载在途的音乐 id——`ensureMusic` 的去重账（b4）。 */
  private readonly loadingMusic = new Set<MusicId>();
  /** 双位静音账（b4）：玩家手动位 / 切页自动位，合成见 `combinedMute`。 */
  private userMuted = false;
  private hiddenMuted = false;

  constructor(game: Phaser.Game) {
    this.game = game;
    this.settings = getAudioSettings();
    // 交叉淡入不借场景 tween——场景会关、会睡，音乐横跨它们活着，
    // 所以挂主循环手推。'step' 即 Phaser.Core.Events.STEP；写字面量
    // 是为了让 Phaser 保持 type-only import（文件头的取舍）。
    this.game.events.on('step', this.onStep, this);
    // 切标签页自动静音（todo 实现步骤 8）。'hidden'/'visible' 即
    // Phaser.Core.Events.HIDDEN / VISIBLE——Phaser 自己听着 document 的
    // visibilitychange 再转发成这两个事件，挂它们等于挂 visibilitychange，
    // 且假 game 一行 emit 就能测。只动 hidden 位，玩家手动静音原样保留。
    this.game.events.on('hidden', this.onHidden, this);
    this.game.events.on('visible', this.onVisible, this);
    // 21 总账的跟读（todos/21 t1 的统一）：设置面板直接 `updateSettings`
    // 改音量时混音器立刻跟上，不必绕 setMusicVolume。Audio 与 game 同生
    // 共死（getAudio 全程只建一个），退订函数用不上。
    onSettingsChange((s) => this.onSettingsChanged(s));
  }

  /** 当前音效音量（0..1），设置界面（todos/21）读它画滑条。 */
  get sfxVolume(): number {
    return this.settings.sfx;
  }

  /** 当前音乐音量（0..1）。 */
  get musicVolume(): number {
    return this.settings.music;
  }

  /** 自动播放闸开了没——TitleScene 只在没开时才挂一次性解锁。 */
  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /**
   * 拨开自动播放闸（todo 实现步骤 4）。必须从用户手势的回调里调——
   * TitleScene 挂的一次性 pointerdown。幂等：重复调、解锁后再调都空转。
   */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    // WebAudio 下补一脚 context.resume()——Phaser 自己也在手势里解，
    // 这是双保险；HTML5AudioSoundManager / NoAudio 没有 context，可选链空转。
    (this.game.sound as { context?: { resume?: () => unknown } }).context?.resume?.();
    this.tryStartPending();
  }

  play(id: SfxId, opts: SfxOptions = {}): void {
    // 解锁前静默吞掉，不报错也不记限流账——记了账的话，解锁后 40ms 内
    // 的第一声会被自己吞掉（todo 实现步骤 4：「不要报错也不要静默失败」
    // 说的是音乐要 pending；音效转瞬即逝，补播没有意义，吞掉即正确）。
    if (!this.unlocked) return;
    // 限流的「现在」读主循环时钟：约定 2 的时钟禁令覆盖全 src/
    // （tests/integrity.test.ts），Date.now 在这儿也进不来。
    const now = this.game.getTime();
    if (shouldThrottle(this.lastPlayed.get(id), now)) return;
    this.lastPlayed.set(id, now);
    // b1 音源未就位、或该浏览器两种格式都解不了——静默跳过，不报错：
    // 没有声音的一刀仍然是一刀，音频永远不阻塞玩法。
    if (!this.game.cache.audio.exists(id)) return;
    const jitter = opts.pitchJitter ?? DEFAULT_PITCH_JITTER;
    // 真骰，见文件头：src/audio/ 不在 integrity 的 RULES_DIRS 里。
    const detune = (opts.detune ?? 0) + jitterDetune(Math.random(), jitter);
    this.game.sound.play(id, {
      volume: clamp01(this.settings.sfx * (opts.volume ?? 1)),
      detune,
    });
  }

  /**
   * 切音乐：旧曲淡出、新曲淡入（交叉，todo 实现步骤 7）。同曲不重进。
   * 播不了的时候（闸没开、音源在途）挂进 `pendingMusic`，条件齐了补播。
   */
  music(id: MusicId, fadeMs = MUSIC_FADE_MS): void {
    if (this.currentMusicId === id) return;
    if (!this.unlocked) {
      // 解锁前反正没声，旧曲也不存在——只记「想播这首」，闸开时补。
      this.pendingMusic = { id, fadeMs };
      return;
    }
    this.startMusic(id, fadeMs);
  }

  /**
   * 音乐懒加载（b4，todo 实现步骤 3）：音乐大件不进 boot，对应场景首次
   * 要用时喊这一口——`TitleScene.create` 载标题曲。已载完/已在途都空转
   * （`shouldStartLoad`），所以回到标题页重复喊是安全的。载完若正好是
   * `pendingMusic` 想要的那首，当场补播。
   */
  ensureMusic(id: MusicId, scene: Phaser.Scene): void {
    if (!shouldStartLoad(this.game.cache.audio.exists(id), this.loadingMusic.has(id))) {
      // 已经载好而 music() 先到过（挂在 pending 上）——现在就补。
      this.tryStartPending();
      return;
    }
    this.loadingMusic.add(id);
    // 三条退路共用一次清账：载完、载错、还有场景在两者之前就 shutdown——
    // 慢网下玩家秒点离开时 loader 事件永远不来，在途账不清这首曲子就
    // 整局无法重试（下一个场景的 ensureMusic 会一直被去重挡掉）。
    const cleanup = (): void => {
      scene.load.off('loaderror', onError);
      scene.load.off(`filecomplete-audio-${id}`, onComplete);
      scene.events.off('shutdown', onShutdown);
      this.loadingMusic.delete(id);
    };
    // 'loaderror' 即 Phaser.Loader.Events.FILE_LOAD_ERROR（字面量，保持
    // type-only import）。失败要把在途账销掉，否则这首曲子永远无法重试。
    const onError = (file: { key: string }): void => {
      if (file.key !== id) return;
      cleanup();
    };
    // 'filecomplete-audio-<key>' 即 FILE_KEY_COMPLETE 的具名形态。
    const onComplete = (): void => {
      cleanup();
      this.tryStartPending();
    };
    const onShutdown = (): void => cleanup();
    scene.load.on('loaderror', onError);
    scene.load.once(`filecomplete-audio-${id}`, onComplete);
    scene.events.once('shutdown', onShutdown);
    // 双格式数组：Phaser 按浏览器支持挑，Safari 不吃 ogg 就落到 m4a。
    // 写全路径不依赖 loader 的 setPath——每个场景的 loader 各有各的账。
    scene.load.audio(id, [`assets/audio/music/${id}.ogg`, `assets/audio/music/${id}.m4a`]);
    // preload 阶段 loader 本来就在跑，start() 空转；create 之后靠它点火。
    scene.load.start();
  }

  stopMusic(fadeMs = MUSIC_FADE_MS): void {
    // 欠着没播的也一并勾销——玩家已经不要它了。
    this.pendingMusic = null;
    this.fadeOutCurrent(fadeMs);
  }

  setMusicVolume(v: number): void {
    this.applyMusicVolume(clamp01(v));
    saveAudioSettings(this.settings);
  }

  setSfxVolume(v: number): void {
    this.settings.sfx = clamp01(v);
    saveAudioSettings(this.settings);
  }

  /**
   * 21 总账变了（设置面板或别的写入方喊了 `updateSettings`）——音量跟上。
   * setXVolume 自己引发的广播也会走到这儿：值已相同，重放一遍是空转。
   */
  private onSettingsChanged(s: Settings): void {
    this.settings.sfx = s.sfxVolume;
    this.applyMusicVolume(s.musicVolume);
  }

  /** 记账并作用到在播的曲子上（落盘不在这儿——广播回路不许再写账）。 */
  private applyMusicVolume(v: number): void {
    this.settings.music = v;
    const current = this.currentMusic;
    if (!current) return;
    // 正在淡入就改它的目标，否则直接落到位——两条路都不打断播放。
    const fade = this.fades.find((f) => f.sound === current && !f.stopWhenDone);
    if (fade) fade.to = v;
    else current.setVolume(v);
  }

  /**
   * 玩家手动静音位。不落盘——是状态不是设置。切页那位（`hiddenMuted`）
   * 由 hidden/visible 事件自动拨，两位经 `combinedMute` 合成总闸，
   * 所以切回标签页不会把玩家手动按下的静音抬起来。
   */
  setMuted(m: boolean): void {
    this.userMuted = m;
    this.applyMute();
  }

  // ----- 音乐补播与双位静音 -------------------------------------------------

  /** 真正开播一首（调用方保证闸已开）。音源不在 cache 就挂回 pending。 */
  private startMusic(id: MusicId, fadeMs: number): void {
    this.fadeOutCurrent(fadeMs);
    if (!this.game.cache.audio.exists(id)) {
      // b2 音源未就位或懒加载在途——留白挂账，`ensureMusic` 载完补播；
      // 没人去载的话，下次再喊同一首也还会重试。
      this.pendingMusic = { id, fadeMs };
      return;
    }
    this.pendingMusic = null;
    const next = this.game.sound.add(id, { loop: true, volume: 0 }) as FadableSound;
    next.play();
    this.currentMusic = next;
    this.currentMusicId = id;
    this.addFade(next, 0, this.settings.music, fadeMs, false);
  }

  /** 欠的账能还了吗——解锁后、每次懒加载落地后各问一次。 */
  private tryStartPending(): void {
    const pending = this.pendingMusic;
    if (!pending || !this.unlocked) return;
    if (this.currentMusicId === pending.id) {
      this.pendingMusic = null;
      return;
    }
    if (!this.game.cache.audio.exists(pending.id)) return; // 还在途，再等。
    this.pendingMusic = null;
    this.startMusic(pending.id, pending.fadeMs);
  }

  private applyMute(): void {
    this.game.sound.mute = combinedMute(this.userMuted, this.hiddenMuted);
  }

  private onHidden(): void {
    this.hiddenMuted = true;
    this.applyMute();
  }

  private onVisible(): void {
    this.hiddenMuted = false;
    this.applyMute();
  }

  // ----- 淡入淡出：主循环手推 ----------------------------------------------

  /** 把当前音乐送进淡出（淡完停掉销毁），并清掉「当前」二账。 */
  private fadeOutCurrent(fadeMs: number): void {
    const sound = this.currentMusic;
    this.currentMusic = null;
    this.currentMusicId = null;
    if (!sound) return;
    // 它若还在淡入途中，撤掉旧 fade，从此刻的实际音量往下走。
    this.fades = this.fades.filter((f) => f.sound !== sound);
    this.addFade(sound, sound.volume, 0, fadeMs, true);
  }

  private addFade(
    sound: FadableSound,
    from: number,
    to: number,
    duration: number,
    stopWhenDone: boolean,
  ): void {
    if (duration <= 0) {
      this.finishFade(sound, to, stopWhenDone);
      return;
    }
    sound.setVolume(from);
    this.fades.push({ sound, from, to, elapsed: 0, duration, stopWhenDone });
  }

  private finishFade(sound: FadableSound, to: number, stopWhenDone: boolean): void {
    sound.setVolume(to);
    if (stopWhenDone) {
      sound.stop();
      sound.destroy();
    }
  }

  private onStep(_time: number, delta: number): void {
    if (this.fades.length === 0) return;
    const done: Fade[] = [];
    for (const fade of this.fades) {
      fade.elapsed += delta;
      fade.sound.setVolume(fadeVolume(fade.from, fade.to, fade.elapsed, fade.duration));
      if (fade.elapsed >= fade.duration) done.push(fade);
    }
    if (done.length === 0) return;
    this.fades = this.fades.filter((f) => !done.includes(f));
    for (const fade of done) {
      if (fade.stopWhenDone) {
        fade.sound.stop();
        fade.sound.destroy();
      }
    }
  }
}

// ------------------------------------------------------------------- 取用口

const REGISTRY_KEY = 'sangota-audio';

/**
 * 场景层的取用口：第一次调用建管理器并挂上 `game.registry`，此后所有场景
 * 拿到的是同一个实例——音乐横跨场景切换不断，音量账也只有一本。
 */
export function getAudio(scene: Phaser.Scene): Audio {
  const registry = scene.game.registry;
  const existing = registry.get(REGISTRY_KEY) as Audio | undefined;
  if (existing) return existing;
  const audio = new Audio(scene.game);
  registry.set(REGISTRY_KEY, audio);
  return audio;
}
