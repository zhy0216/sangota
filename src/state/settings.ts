/**
 * 全局设置 (todos/21 t1) — 单例 + localStorage 持久化 + 版本合并 + 变更订阅。
 *
 * 第六把钥匙（`sangota.settings.v1`），与 08 的跑团档（`sangota.save.v1`）、
 * 22 的战史、19 的天命、23 的解锁并列，互不覆盖。读档策略却与它们都不同：
 * **版本不匹配或字段缺失时逐字段 merge 默认值，绝不丢弃整本账**——加一个
 * 新选项不该重置用户调好的音量（todo 实现步骤 1 点名）。逐字段夹取：数值
 * clamp 到量程、枚举过白名单、按键须是非空字符串——哪一格读不懂只丢哪一格。
 *
 * **音量的唯一事实源**：20 音频曾把音量记在 `sangota.audio.v1`
 * （`src/audio/sfx.ts`），自本账起那本退役为旧账——`getAudioSettings` /
 * `saveAudioSettings` 改为本账的适配层，`Audio` 类经 `onSettingsChange`
 * 跟读，两边永远同一本账。旧账只在本账缺席时被读一次（老玩家的音量
 * 不丢），此后不再写入。
 *
 * 单例的形态沿 `ascension.ts` / `unlocks.ts`：状态不缓存在内存里，每次
 * 现读现解析——测试逐用例换假 storage 时吃不到陈账，敌意存储也缓不下半个
 * 坏对象。模块自己只攒一份订阅名单。
 */

// ------------------------------------------------------------------- 数据结构

/**
 * 全部可绑按键的动作清单。数组是唯一事实源，`KeyAction` 从它派生（照
 * `SFX_IDS` 的做法）——24 战斗交互的键位定义与 21 的重绑界面共用这个类型，
 * 两边不可能各持一份对不上的名单。
 */
export const KEY_ACTIONS = [
  'endTurn', 'cancel', 'recenter', 'viewDeck',
  'viewDraw', 'viewDiscard', 'settings',
  'card1', 'card2', 'card3', 'card4', 'card5',
  'card6', 'card7', 'card8', 'card9', 'card10',
  'potion1', 'potion2', 'potion3',
] as const;

export type KeyAction = (typeof KEY_ACTIONS)[number];

export interface Settings {
  version: number;
  // 画面
  fullscreen: boolean;
  renderScale: 'auto' | 1 | 2 | 3;
  screenShake: 'full' | 'reduced' | 'off';
  // 音频
  /** 音乐音量 0..1。 */
  musicVolume: number;
  /** 音效音量 0..1。 */
  sfxVolume: number;
  // 游戏
  animSpeed: 'normal' | 'fast' | 'instant';
  confirmEndTurn: boolean;
  confirmPlay: 'off' | 'rare' | 'all';
  autoEndTurn: boolean;
  showIncomingDamage: boolean;
  /**
   * 按键 — 值是 Phaser `keydown-<KEY>` 事件的后缀（'E' / 'ESC' / 'SPACE' /
   * 'ONE'…），与各场景现有的 `keydown-${key}` 写法直接拼接。
   */
  keys: Record<KeyAction, string>;
}

/**
 * 版本号只为将来的**定向迁移**留位——版本不匹配不清账，照样逐字段 merge，
 * 见文件头。这一点与 19/22/23 的「版本不合即白卷」相反：那边丢的是进度，
 * 这边丢的是用户亲手调过的偏好。
 */
export const SETTINGS_VERSION = 1;

export const SETTINGS_KEY = 'sangota.settings.v1';

/** 20 音频的旧音量账（`src/audio/sfx.ts` 的 `AUDIO_SETTINGS_KEY`），迁移用。 */
const LEGACY_AUDIO_KEY = 'sangota.audio.v1';
const LEGACY_AUDIO_VERSION = 1;

/** 默认设置。函数而非常量：设置对象不许两处共享（仓库惯例）。 */
export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    fullscreen: false,
    renderScale: 'auto',
    screenShake: 'full',
    musicVolume: 0.8,
    sfxVolume: 0.8,
    animSpeed: 'normal',
    confirmEndTurn: true,
    confirmPlay: 'off',
    autoEndTurn: false,
    showIncomingDamage: true,
    keys: {
      endTurn: 'E',       // README：`E` 结束回合
      cancel: 'ESC',      // `Esc` 取消/关闭
      recenter: 'SPACE',  // `Space` 地图归位
      viewDeck: 'D',
      viewDraw: 'A',
      viewDiscard: 'S',
      settings: 'O',
      card1: 'ONE', card2: 'TWO', card3: 'THREE', card4: 'FOUR', card5: 'FIVE',
      card6: 'SIX', card7: 'SEVEN', card8: 'EIGHT', card9: 'NINE', card10: 'ZERO',
      potion1: 'Z', potion2: 'X', potion3: 'C',
    },
  };
}

/** todo 数据结构节点名的常量形态。冻结只读——要一份可改的拷贝用 `defaultSettings()`。 */
export const DEFAULT_SETTINGS: Settings = (() => {
  const d = defaultSettings();
  Object.freeze(d.keys);
  return Object.freeze(d);
})();

// ------------------------------------------------------------------- 存储

/**
 * Same guard as `save.ts` / `ascension.ts` / `unlocks.ts`: `localStorage` is
 * absent under Node and *throws on access* under some privacy settings, so it
 * is fetched per call, never cached. 没有存储时设置永远是默认值、写入无害空转。
 */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- 逐字段夹取

/** 音量夹到 0..1；NaN/Infinity（损坏的账）落到 0——与 `sfx.ts` 的 `clamp01` 同款。 */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

const RENDER_SCALES: readonly Settings['renderScale'][] = ['auto', 1, 2, 3];
const SCREEN_SHAKES: readonly Settings['screenShake'][] = ['full', 'reduced', 'off'];
const ANIM_SPEEDS: readonly Settings['animSpeed'][] = ['normal', 'fast', 'instant'];
const CONFIRM_PLAYS: readonly Settings['confirmPlay'][] = ['off', 'rare', 'all'];

const pickEnum = <T>(list: readonly T[], v: unknown, fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;

const pickBool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;

const pickVolume = (v: unknown, fallback: number): number =>
  typeof v === 'number' ? clamp01(v) : fallback;

/**
 * 逐字段合并进默认值——文件头说的「版本不匹配或字段缺失时 merge，绝不
 * 丢弃整本账」就是这一个函数。任何一格读不懂（类型不对、越界、枚举外、
 * 空按键）只丢那一格；账上多出来的野字段（改过名的旧选项、手改的垃圾）
 * 一律不带走，`keys` 也只收 `KEY_ACTIONS` 名单上的动作。
 */
function sanitize(parsed: unknown): Settings {
  const d = defaultSettings();
  if (typeof parsed !== 'object' || parsed === null) return d;
  const raw = parsed as Record<string, unknown>;

  const keys = d.keys;
  const rawKeys = raw.keys;
  if (typeof rawKeys === 'object' && rawKeys !== null) {
    for (const action of KEY_ACTIONS) {
      const k = (rawKeys as Record<string, unknown>)[action];
      if (typeof k === 'string' && k.length > 0) keys[action] = k;
    }
  }

  return {
    version: SETTINGS_VERSION,
    fullscreen: pickBool(raw.fullscreen, d.fullscreen),
    renderScale: pickEnum(RENDER_SCALES, raw.renderScale, d.renderScale),
    screenShake: pickEnum(SCREEN_SHAKES, raw.screenShake, d.screenShake),
    musicVolume: pickVolume(raw.musicVolume, d.musicVolume),
    sfxVolume: pickVolume(raw.sfxVolume, d.sfxVolume),
    animSpeed: pickEnum(ANIM_SPEEDS, raw.animSpeed, d.animSpeed),
    confirmEndTurn: pickBool(raw.confirmEndTurn, d.confirmEndTurn),
    confirmPlay: pickEnum(CONFIRM_PLAYS, raw.confirmPlay, d.confirmPlay),
    autoEndTurn: pickBool(raw.autoEndTurn, d.autoEndTurn),
    showIncomingDamage: pickBool(raw.showIncomingDamage, d.showIncomingDamage),
    keys,
  };
}

/**
 * 本账缺席时读一次 20 音频的旧账，把老玩家的音量捡回默认值里。读不到、
 * 读不懂、版本不合——按旧账自己的规矩放弃，落回默认。旧账从此只读不写，
 * 不删也无妨：没有写入方，两本账打不起来。
 */
function migratedDefaults(slot: Storage): Settings {
  const d = defaultSettings();
  let raw: string | null = null;
  try {
    raw = slot.getItem(LEGACY_AUDIO_KEY);
  } catch {
    return d;
  }
  if (!raw) return d;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return d;
  }
  const legacy = parsed as { version?: unknown; music?: unknown; sfx?: unknown } | null;
  if (typeof legacy !== 'object' || legacy === null) return d;
  if (legacy.version !== LEGACY_AUDIO_VERSION) return d;
  d.musicVolume = pickVolume(legacy.music, d.musicVolume);
  d.sfxVolume = pickVolume(legacy.sfx, d.sfxVolume);
  return d;
}

// ------------------------------------------------------------------- 读 / 写 / 订阅

/**
 * 读回整本设置（每次一份新对象，调用方改了不脏账）。读不到存储、坏 JSON
 * 一律默认值；账在而版本旧/字段缺，逐字段 merge——见文件头的取舍。
 */
export function getSettings(): Settings {
  const slot = store();
  if (!slot) return defaultSettings();

  let raw: string | null = null;
  try {
    raw = slot.getItem(SETTINGS_KEY);
  } catch {
    return defaultSettings();
  }
  if (!raw) return migratedDefaults(slot);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultSettings();
  }
  return sanitize(parsed);
}

/** 订阅名单——模块级单例仅有的一份内存状态。 */
const listeners: ((s: Settings) => void)[] = [];

/**
 * 打补丁：与当前账合并、逐字段夹取（`updateSettings({ musicVolume: 1.5 })`
 * 落账是 1）、浅比较**有变才**落盘并广播——无变化的写入既不磨存储也不
 * 惊动听者。`patch.keys` 允许只给一部分动作，按动作逐个并入。
 *
 * 写入失败（配额爆了、敌意存储、Node 下压根没有存储）也照广播：本次会话
 * 内听者与调用方看到同一份值，比各自为账体面；代价是下次会话回到旧账——
 * 与其余几本账「空转不打断游戏」的取舍一致。
 */
export function updateSettings(patch: Partial<Settings>): void {
  const current = getSettings();
  const merged = sanitize({
    ...current,
    ...patch,
    keys: { ...current.keys, ...(patch.keys ?? {}) },
  });
  if (settingsEqual(current, merged)) return;

  const slot = store();
  if (slot) {
    try {
      slot.setItem(SETTINGS_KEY, JSON.stringify(merged));
    } catch {
      // 空转，见函数头。
    }
  }
  // 快照名单再走：听者在回调里退订/加订不打乱本轮。每个听者各发一份
  // 拷贝——谁也改不了谁手里的那份。
  for (const cb of [...listeners]) cb({ ...merged, keys: { ...merged.keys } });
}

/** 订阅设置变更。返回退订函数；重复退订无害空转。 */
export function onSettingsChange(cb: (s: Settings) => void): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i !== -1) listeners.splice(i, 1);
  };
}

/** 浅比较（`keys` 按动作逐格）。`version` 恒为当前版本，不用比。 */
function settingsEqual(a: Settings, b: Settings): boolean {
  return (
    a.fullscreen === b.fullscreen &&
    a.renderScale === b.renderScale &&
    a.screenShake === b.screenShake &&
    a.musicVolume === b.musicVolume &&
    a.sfxVolume === b.sfxVolume &&
    a.animSpeed === b.animSpeed &&
    a.confirmEndTurn === b.confirmEndTurn &&
    a.confirmPlay === b.confirmPlay &&
    a.autoEndTurn === b.autoEndTurn &&
    a.showIncomingDamage === b.showIncomingDamage &&
    KEY_ACTIONS.every((k) => a.keys[k] === b.keys[k])
  );
}
