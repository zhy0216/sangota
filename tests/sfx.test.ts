import { afterEach, describe, expect, it } from 'vitest';
import {
  Audio,
  AUDIO_SETTINGS_KEY,
  AUDIO_SETTINGS_VERSION,
  clamp01,
  combinedMute,
  DEFAULT_PITCH_JITTER,
  defaultAudioSettings,
  fadeVolume,
  getAudio,
  getAudioSettings,
  jitterDetune,
  MUSIC_FADE_MS,
  saveAudioSettings,
  SFX_THROTTLE_MS,
  shouldStartLoad,
  shouldThrottle,
} from '../src/audio/sfx';

/**
 * 音频管理器 — todos/20 b3 的纯函数层与 `Audio` 类。
 *
 * `src/audio/sfx.ts` 的 Phaser 是 type-only import，所以整个模块能在 Node
 * 下直接跑：纯函数（限流、夹音量、detune 换算、localStorage 往返）照常测，
 * `Audio` 类拿假 game 测——Phaser.Sound 本体进不了 Node（仓库惯例，见
 * `tests/integrity.test.ts` 对 CombatScene 的处理），假 game 只要长出
 * `getTime` / `sound` / `cache.audio` / `events` 这四条边就够。
 * 假 storage 沿用 `history.test.ts` 的那只——真的在 Node 下不存在。
 */

// --------------------------------------------------------------- 假 storage

class FakeStorage {
  private data = new Map<string, string>();
  /** Set to make every call throw, the way a locked-down browser does. */
  hostile = false;

  get length(): number {
    return this.data.size;
  }
  key(i: number): string | null {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    if (this.hostile) throw new Error('denied');
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.hostile) throw new Error('denied');
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    if (this.hostile) throw new Error('denied');
    this.data.delete(k);
  }
  clear(): void {
    this.data.clear();
  }
}

const withStorage = (): FakeStorage => {
  const fake = new FakeStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: fake,
    configurable: true,
    writable: true,
  });
  return fake;
};

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

// --------------------------------------------------------------- 假 game

interface PlayedCall {
  key: string;
  volume: number;
  detune: number;
}

/** `game.sound.add` 吐出来的假声音——只长 `Audio` 摸得到的那几个把手。 */
class FakeSound {
  volume: number;
  loop: boolean;
  playing = false;
  stopped = false;
  destroyed = false;

  constructor(
    public key: string,
    config?: { loop?: boolean; volume?: number },
  ) {
    this.volume = config?.volume ?? 1;
    this.loop = config?.loop ?? false;
  }
  setVolume(v: number): this {
    this.volume = v;
    return this;
  }
  play(): boolean {
    this.playing = true;
    return true;
  }
  stop(): boolean {
    this.playing = false;
    this.stopped = true;
    return true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

class FakeGame {
  /** 主循环时间轴，`step(delta)` 往前推——对应真身的 `game.getTime()`。 */
  time = 0;
  played: PlayedCall[] = [];
  added: FakeSound[] = [];
  /** audio cache 里有哪些 key——b1/b2 音源就位与否的开关。 */
  keys = new Set<string>();

  private handlers = new Map<string, { fn: (...args: number[]) => void; ctx: unknown }[]>();
  private store = new Map<string, unknown>();

  cache = { audio: { exists: (k: string) => this.keys.has(k) } };
  registry = {
    get: (k: string) => this.store.get(k),
    set: (k: string, v: unknown) => this.store.set(k, v),
  };
  sound = {
    mute: false,
    play: (key: string, config: { volume: number; detune: number }): boolean => {
      this.played.push({ key, volume: config.volume, detune: config.detune });
      return true;
    },
    add: (key: string, config?: { loop?: boolean; volume?: number }): FakeSound => {
      const s = new FakeSound(key, config);
      this.added.push(s);
      return s;
    },
  };
  events = {
    on: (name: string, fn: (...args: number[]) => void, ctx?: unknown): void => {
      const list = this.handlers.get(name) ?? [];
      list.push({ fn, ctx });
      this.handlers.set(name, list);
    },
  };

  /** 触发一个 game 事件——'hidden' / 'visible' 的切页戏靠它演。 */
  emit(name: string, ...args: number[]): void {
    for (const h of this.handlers.get(name) ?? []) h.fn.call(h.ctx, ...args);
  }

  getTime(): number {
    return this.time;
  }
  /** 推一帧：时间前进 `delta` 并触发 STEP——淡入淡出靠它走。 */
  step(delta: number): void {
    this.time += delta;
    this.emit('step', this.time, delta);
  }
}

/**
 * `game.load` 不存在——loader 挂在场景上。`ensureMusic` 只摸 `scene.load` 的
 * `audio` / `start` / `on` / `once` / `off` 五条边，照 FakeGame 的做法长出来。
 */
class FakeLoaderScene {
  loads: { key: string; urls: string[] }[] = [];
  started = 0;
  private handlers = new Map<string, { fn: (...args: unknown[]) => void; once: boolean }[]>();

  load = {
    audio: (key: string, urls: string[]): void => {
      this.loads.push({ key, urls });
    },
    start: (): void => {
      this.started += 1;
    },
    on: (name: string, fn: (...args: unknown[]) => void): void => {
      const list = this.handlers.get(name) ?? [];
      list.push({ fn, once: false });
      this.handlers.set(name, list);
    },
    once: (name: string, fn: (...args: unknown[]) => void): void => {
      const list = this.handlers.get(name) ?? [];
      list.push({ fn, once: true });
      this.handlers.set(name, list);
    },
    off: (name: string, fn: (...args: unknown[]) => void): void => {
      const list = (this.handlers.get(name) ?? []).filter((h) => h.fn !== fn);
      this.handlers.set(name, list);
    },
  };

  /** 场景事件（shutdown 清账那条退路挂在这上面），与 loader 分账。 */
  private sceneHandlers = new Map<string, { fn: (...args: unknown[]) => void; once: boolean }[]>();

  events = {
    once: (name: string, fn: (...args: unknown[]) => void): void => {
      const list = this.sceneHandlers.get(name) ?? [];
      list.push({ fn, once: true });
      this.sceneHandlers.set(name, list);
    },
    off: (name: string, fn: (...args: unknown[]) => void): void => {
      const list = (this.sceneHandlers.get(name) ?? []).filter((h) => h.fn !== fn);
      this.sceneHandlers.set(name, list);
    },
  };

  /** 一个文件落地：进 audio cache，再发 `filecomplete-audio-<key>`。 */
  complete(game: FakeGame, key: string): void {
    game.keys.add(key);
    this.fire(`filecomplete-audio-${key}`);
  }

  /** 一个文件挂了：发 'loaderror'，cache 不动。 */
  fail(key: string): void {
    this.fire('loaderror', { key });
  }

  /** 场景 shutdown——loader 事件从此不再来。 */
  shutdown(): void {
    const list = this.sceneHandlers.get('shutdown') ?? [];
    this.sceneHandlers.set('shutdown', list.filter((h) => !h.once));
    for (const h of list) h.fn();
  }

  private fire(name: string, ...args: unknown[]): void {
    const list = this.handlers.get(name) ?? [];
    this.handlers.set(name, list.filter((h) => !h.once));
    for (const h of list) h.fn(...args);
  }
}

const asScene = (fake: FakeLoaderScene): Parameters<Audio['ensureMusic']>[1] =>
  fake as unknown as Parameters<Audio['ensureMusic']>[1];

/** 默认拨开自动播放闸——闸本身的戏在「自动播放解锁」一节单独演。 */
const makeAudio = (opts: { unlocked?: boolean } = {}): { game: FakeGame; audio: Audio } => {
  const game = new FakeGame();
  const audio = new Audio(game as unknown as Parameters<typeof getAudio>[0]['game']);
  if (opts.unlocked !== false) audio.unlock();
  return { game, audio };
};

// ------------------------------------------------------------------- 纯函数

describe('clamp01', () => {
  it('夹到 0..1，损坏值落到 0', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('jitterDetune', () => {
  it('掷中点不偏，两端各偏 jitter*1200 cents', () => {
    expect(jitterDetune(0.5, DEFAULT_PITCH_JITTER)).toBe(0);
    expect(jitterDetune(1, 0.05)).toBeCloseTo(60);
    expect(jitterDetune(0, 0.05)).toBeCloseTo(-60);
  });

  it('jitter 为 0 时纹丝不动——detune 全靠调用方给的固定值', () => {
    expect(jitterDetune(0, 0)).toBeCloseTo(0);
    expect(jitterDetune(1, 0)).toBeCloseTo(0);
  });
});

describe('shouldThrottle', () => {
  it('从没响过——不限', () => {
    expect(shouldThrottle(undefined, 0)).toBe(false);
  });

  it('窗口内吞掉，窗口沿上放行', () => {
    expect(shouldThrottle(100, 100)).toBe(true);
    expect(shouldThrottle(100, 100 + SFX_THROTTLE_MS - 1)).toBe(true);
    expect(shouldThrottle(100, 100 + SFX_THROTTLE_MS)).toBe(false);
  });
});

describe('fadeVolume', () => {
  it('线性走完恰好落在 to，越界夹住', () => {
    expect(fadeVolume(0, 0.8, 200, 400)).toBeCloseTo(0.4);
    expect(fadeVolume(0.8, 0, 100, 400)).toBeCloseTo(0.6);
    expect(fadeVolume(0, 0.8, 400, 400)).toBe(0.8);
    expect(fadeVolume(0, 0.8, 999, 400)).toBe(0.8);
  });

  it('时长为 0 直接落到 to——除零不进公式', () => {
    expect(fadeVolume(0, 0.8, 0, 0)).toBe(0.8);
  });
});

describe('combinedMute 双位静音合成', () => {
  it('任一位落下总闸就落，两位都抬起才有声', () => {
    expect(combinedMute(false, false)).toBe(false);
    expect(combinedMute(true, false)).toBe(true);
    expect(combinedMute(false, true)).toBe(true);
    expect(combinedMute(true, true)).toBe(true);
  });
});

describe('shouldStartLoad 懒加载去重', () => {
  it('已进 cache 或已在途都不再排队，两头都干净才载', () => {
    expect(shouldStartLoad(false, false)).toBe(true);
    expect(shouldStartLoad(true, false)).toBe(false);
    expect(shouldStartLoad(false, true)).toBe(false);
    expect(shouldStartLoad(true, true)).toBe(false);
  });
});

// --------------------------------------------------------------- 音量账本

describe('音量账的 localStorage 往返', () => {
  it('无存储时是默认值，写入无害空转', () => {
    expect(getAudioSettings()).toEqual(defaultAudioSettings());
    expect(() => saveAudioSettings(defaultAudioSettings())).not.toThrow();
  });

  it('写了能读回来，且只写自己的键', () => {
    const fake = withStorage();
    saveAudioSettings({ version: AUDIO_SETTINGS_VERSION, music: 0.3, sfx: 0.7 });
    expect(getAudioSettings()).toEqual({
      version: AUDIO_SETTINGS_VERSION,
      music: 0.3,
      sfx: 0.7,
    });
    expect(fake.length).toBe(1);
    expect(fake.getItem(AUDIO_SETTINGS_KEY)).not.toBeNull();
  });

  it('敌意存储（读写皆炸）——默认值照给，写入不炸', () => {
    const fake = withStorage();
    fake.hostile = true;
    expect(getAudioSettings()).toEqual(defaultAudioSettings());
    expect(() => saveAudioSettings(defaultAudioSettings())).not.toThrow();
  });

  it('读不懂的账一律默认值：坏 JSON、版本不合、非对象', () => {
    const fake = withStorage();
    fake.setItem(AUDIO_SETTINGS_KEY, '{oops');
    expect(getAudioSettings()).toEqual(defaultAudioSettings());
    fake.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ version: 999, music: 0.1, sfx: 0.1 }));
    expect(getAudioSettings()).toEqual(defaultAudioSettings());
    fake.setItem(AUDIO_SETTINGS_KEY, 'null');
    expect(getAudioSettings()).toEqual(defaultAudioSettings());
  });

  it('半损坏的账逐字段兜底并夹回 0..1', () => {
    const fake = withStorage();
    fake.setItem(
      AUDIO_SETTINGS_KEY,
      JSON.stringify({ version: AUDIO_SETTINGS_VERSION, music: 7, sfx: 'loud' }),
    );
    const got = getAudioSettings();
    expect(got.music).toBe(1);
    expect(got.sfx).toBe(defaultAudioSettings().sfx);
  });
});

// --------------------------------------------------------------- Audio 类

describe('Audio.play', () => {
  it('同一音效 40ms 内只响一次，窗口过了再放行', () => {
    const { game, audio } = makeAudio();
    game.keys.add('hit-mid');
    audio.play('hit-mid');
    audio.play('hit-mid');
    expect(game.played).toHaveLength(1);
    game.time += SFX_THROTTLE_MS - 1;
    audio.play('hit-mid');
    expect(game.played).toHaveLength(1);
    game.time += 1; // 距上一声恰好 40ms
    audio.play('hit-mid');
    expect(game.played).toHaveLength(2);
  });

  it('限流按 SfxId 各记各的账——双斧两声是两个 id 才对的事,同帧异 id 不互吞', () => {
    const { game, audio } = makeAudio();
    game.keys.add('hit-light');
    game.keys.add('block-gain');
    audio.play('hit-light');
    audio.play('block-gain');
    expect(game.played).toHaveLength(2);
  });

  it('音源未就位——静默跳过，不报错', () => {
    const { game, audio } = makeAudio();
    expect(() => audio.play('ui-click')).not.toThrow();
    expect(game.played).toHaveLength(0);
  });

  it('detune = 固定偏移 + 随机抖动；jitter 0 时只剩固定偏移', () => {
    const { game, audio } = makeAudio();
    game.keys.add('card-draw');
    audio.play('card-draw', { detune: 30, pitchJitter: 0 });
    expect(game.played[0].detune).toBe(30);
    // 默认抖动 ±5% → ±60 cents。掷真骰,只验界。
    game.time += SFX_THROTTLE_MS;
    audio.play('card-draw');
    expect(Math.abs(game.played[1].detune)).toBeLessThanOrEqual(60);
  });

  it('音量 = 全局音效音量 × 单次倍率，夹在 0..1', () => {
    const { game, audio } = makeAudio();
    game.keys.add('gold-gain');
    audio.setSfxVolume(0.5);
    audio.play('gold-gain', { volume: 0.5, pitchJitter: 0 });
    expect(game.played[0].volume).toBeCloseTo(0.25);
    game.time += SFX_THROTTLE_MS;
    audio.play('gold-gain', { volume: 99, pitchJitter: 0 });
    expect(game.played[1].volume).toBe(1);
  });
});

describe('Audio.music 交叉淡入', () => {
  it('新曲从 0 淡到全局音乐音量，走完 MUSIC_FADE_MS 恰好到位', () => {
    const { game, audio } = makeAudio();
    game.keys.add('map');
    audio.music('map');
    const song = game.added[0];
    expect(song.playing).toBe(true);
    expect(song.loop).toBe(true);
    expect(song.volume).toBe(0);
    game.step(MUSIC_FADE_MS / 2);
    expect(song.volume).toBeCloseTo(audio.musicVolume / 2);
    game.step(MUSIC_FADE_MS / 2);
    expect(song.volume).toBeCloseTo(audio.musicVolume);
  });

  it('换曲时旧曲淡出停掉销毁，新曲同时淡入——交叉而非硬切', () => {
    const { game, audio } = makeAudio();
    game.keys.add('map');
    game.keys.add('combat');
    audio.music('map', 0); // 直接到位，省掉铺垫
    const mapSong = game.added[0];
    audio.music('combat');
    const combatSong = game.added[1];
    // 淡到一半：旧的还在响、在降,新的在升——这就是交叉。
    game.step(MUSIC_FADE_MS / 2);
    expect(mapSong.stopped).toBe(false);
    expect(mapSong.volume).toBeCloseTo(audio.musicVolume / 2);
    expect(combatSong.volume).toBeCloseTo(audio.musicVolume / 2);
    game.step(MUSIC_FADE_MS / 2);
    expect(mapSong.stopped).toBe(true);
    expect(mapSong.destroyed).toBe(true);
    expect(combatSong.volume).toBeCloseTo(audio.musicVolume);
  });

  it('同一首不重进——地图场景每次 WAKE 都喊 music("map") 也只放一份', () => {
    const { game, audio } = makeAudio();
    game.keys.add('map');
    audio.music('map');
    audio.music('map');
    expect(game.added).toHaveLength(1);
  });

  it('fadeMs 为 0 时立即到位', () => {
    const { game, audio } = makeAudio();
    game.keys.add('title');
    audio.music('title', 0);
    expect(game.added[0].volume).toBeCloseTo(audio.musicVolume);
  });

  it('音源未就位——留白不炸，旧曲照常退场', () => {
    const { game, audio } = makeAudio();
    game.keys.add('map');
    audio.music('map', 0);
    expect(() => audio.music('combat-boss', 0)).not.toThrow();
    expect(game.added).toHaveLength(1);
    expect(game.added[0].stopped).toBe(true);
  });

  it('stopMusic 淡出后停掉销毁', () => {
    const { game, audio } = makeAudio();
    game.keys.add('title');
    audio.music('title', 0);
    audio.stopMusic();
    game.step(MUSIC_FADE_MS);
    expect(game.added[0].stopped).toBe(true);
    expect(game.added[0].destroyed).toBe(true);
  });
});

describe('音量调节与静音', () => {
  it('setMusicVolume 立刻作用于在播的曲子并落盘', () => {
    withStorage();
    const { game, audio } = makeAudio();
    game.keys.add('map');
    audio.music('map', 0);
    audio.setMusicVolume(0.3);
    expect(game.added[0].volume).toBeCloseTo(0.3);
    expect(getAudioSettings().music).toBeCloseTo(0.3);
  });

  it('淡入途中调音量——改的是淡入的目标，不打断淡入', () => {
    const { game, audio } = makeAudio();
    game.keys.add('map');
    audio.music('map');
    audio.setMusicVolume(0.4);
    game.step(MUSIC_FADE_MS);
    expect(game.added[0].volume).toBeCloseTo(0.4);
  });

  it('setSfxVolume 落盘，越界先夹再写', () => {
    withStorage();
    const { audio } = makeAudio();
    audio.setSfxVolume(1.5);
    expect(audio.sfxVolume).toBe(1);
    expect(getAudioSettings().sfx).toBe(1);
  });

  it('构造时读回上一次的音量账', () => {
    withStorage();
    saveAudioSettings({ version: AUDIO_SETTINGS_VERSION, music: 0.2, sfx: 0.9 });
    const { audio } = makeAudio();
    expect(audio.musicVolume).toBeCloseTo(0.2);
    expect(audio.sfxVolume).toBeCloseTo(0.9);
  });

  it('setMuted 拨的是 sound manager 的总闸', () => {
    const { game, audio } = makeAudio();
    audio.setMuted(true);
    expect(game.sound.mute).toBe(true);
    audio.setMuted(false);
    expect(game.sound.mute).toBe(false);
  });
});

// ----------------------------------------------------------- 自动播放解锁

describe('自动播放闸（todo 步骤 4）', () => {
  it('解锁前 play 静默吞掉不报错，解锁后立刻能响——吞掉的不占限流账', () => {
    const { game, audio } = makeAudio({ unlocked: false });
    game.keys.add('ui-click');
    expect(audio.isUnlocked).toBe(false);
    expect(() => audio.play('ui-click')).not.toThrow();
    expect(game.played).toHaveLength(0);
    // 时间一格没走就解锁：锁前那声若记了账，这一声会被 40ms 窗吞掉。
    audio.unlock();
    audio.play('ui-click');
    expect(game.played).toHaveLength(1);
  });

  it('解锁前 music 只挂账，解锁那一刻补播', () => {
    const { game, audio } = makeAudio({ unlocked: false });
    game.keys.add('title');
    audio.music('title', 0);
    expect(game.added).toHaveLength(0);
    audio.unlock();
    expect(game.added).toHaveLength(1);
    expect(game.added[0].key).toBe('title');
    expect(game.added[0].playing).toBe(true);
  });

  it('锁着时换了主意——补播的是最后喊的那首', () => {
    const { game, audio } = makeAudio({ unlocked: false });
    game.keys.add('title');
    game.keys.add('map');
    audio.music('title', 0);
    audio.music('map', 0);
    audio.unlock();
    expect(game.added).toHaveLength(1);
    expect(game.added[0].key).toBe('map');
  });

  it('解锁前 stopMusic 勾销挂账——解锁后不冒出一首没人要的曲子', () => {
    const { game, audio } = makeAudio({ unlocked: false });
    game.keys.add('title');
    audio.music('title', 0);
    audio.stopMusic(0);
    audio.unlock();
    expect(game.added).toHaveLength(0);
  });

  it('unlock 幂等，重复解锁不重播', () => {
    const { game, audio } = makeAudio({ unlocked: false });
    game.keys.add('title');
    audio.music('title', 0);
    audio.unlock();
    audio.unlock();
    expect(game.added).toHaveLength(1);
    expect(audio.isUnlocked).toBe(true);
  });
});

// ----------------------------------------------------------- 音乐懒加载

describe('ensureMusic 懒加载队列（todo 步骤 3）', () => {
  it('排一次队：双格式、ogg 在前，且点火 load.start', () => {
    const { audio } = makeAudio();
    const scene = new FakeLoaderScene();
    audio.ensureMusic('title', asScene(scene));
    expect(scene.loads).toEqual([
      { key: 'title', urls: ['assets/audio/music/title.ogg', 'assets/audio/music/title.m4a'] },
    ]);
    expect(scene.started).toBe(1);
  });

  it('去重：在途的、已进 cache 的都不再排第二次', () => {
    const { game, audio } = makeAudio();
    const scene = new FakeLoaderScene();
    audio.ensureMusic('title', asScene(scene));
    audio.ensureMusic('title', asScene(scene)); // 在途
    expect(scene.loads).toHaveLength(1);
    scene.complete(game, 'title');
    audio.ensureMusic('title', asScene(scene)); // 已载完
    expect(scene.loads).toHaveLength(1);
  });

  it('music 先到、文件后落地——载完那一刻自动开播（标题曲的真实时序）', () => {
    const { game, audio } = makeAudio();
    const scene = new FakeLoaderScene();
    audio.ensureMusic('title', asScene(scene));
    audio.music('title', 0); // 还没载好,挂账
    expect(game.added).toHaveLength(0);
    scene.complete(game, 'title');
    expect(game.added).toHaveLength(1);
    expect(game.added[0].playing).toBe(true);
  });

  it('文件先落地、music 后到——ensureMusic 早已收工,music 直接播', () => {
    const { game, audio } = makeAudio();
    const scene = new FakeLoaderScene();
    audio.ensureMusic('map', asScene(scene));
    scene.complete(game, 'map');
    audio.music('map', 0);
    expect(game.added).toHaveLength(1);
  });

  it('锁着时载完不抢跑——等解锁再播', () => {
    const { game, audio } = makeAudio({ unlocked: false });
    const scene = new FakeLoaderScene();
    audio.music('title', 0);
    audio.ensureMusic('title', asScene(scene));
    scene.complete(game, 'title');
    expect(game.added).toHaveLength(0);
    audio.unlock();
    expect(game.added).toHaveLength(1);
  });

  it('载失败销掉在途账,同一首还能重试', () => {
    const { audio } = makeAudio();
    const scene = new FakeLoaderScene();
    audio.ensureMusic('title', asScene(scene));
    scene.fail('title');
    audio.ensureMusic('title', asScene(scene));
    expect(scene.loads).toHaveLength(2);
  });

  it('场景在载完前 shutdown——在途账照清,别的场景还能重试这首', () => {
    const { audio } = makeAudio();
    const first = new FakeLoaderScene();
    audio.ensureMusic('combat', asScene(first));
    first.shutdown(); // 慢网下玩家秒点离开,loader 事件从此不来
    const second = new FakeLoaderScene();
    audio.ensureMusic('combat', asScene(second));
    expect(second.loads).toHaveLength(1);
  });

  it('正常载完后 shutdown 不误伤下一次的在途账', () => {
    const { game, audio } = makeAudio();
    const scene = new FakeLoaderScene();
    audio.ensureMusic('title', asScene(scene));
    scene.complete(game, 'title');
    scene.shutdown(); // 清账已在 complete 时做过,这里应当是空转
    audio.ensureMusic('title', asScene(scene)); // 已进 cache,不再排队
    expect(scene.loads).toHaveLength(1);
  });
});

// ----------------------------------------------------------- 切页静音

describe('切标签页自动静音（todo 步骤 8）', () => {
  it('hidden 落闸,visible 抬闸', () => {
    const { game } = makeAudio();
    game.emit('hidden');
    expect(game.sound.mute).toBe(true);
    game.emit('visible');
    expect(game.sound.mute).toBe(false);
  });

  it('玩家手动静音不被切页覆盖——切走再切回,静音还在', () => {
    const { game, audio } = makeAudio();
    audio.setMuted(true);
    game.emit('hidden');
    game.emit('visible');
    expect(game.sound.mute).toBe(true);
    audio.setMuted(false);
    expect(game.sound.mute).toBe(false);
  });

  it('切走期间手动解除静音——页面还藏着,总闸不抬', () => {
    const { game, audio } = makeAudio();
    audio.setMuted(true);
    game.emit('hidden');
    audio.setMuted(false);
    expect(game.sound.mute).toBe(true); // hidden 位还压着
    game.emit('visible');
    expect(game.sound.mute).toBe(false);
  });
});

describe('getAudio', () => {
  it('全游戏一个实例：两个场景取到的是同一本账', () => {
    const game = new FakeGame();
    const sceneA = { game } as unknown as Parameters<typeof getAudio>[0];
    const sceneB = { game } as unknown as Parameters<typeof getAudio>[0];
    const a = getAudio(sceneA);
    expect(a).toBeInstanceOf(Audio);
    expect(getAudio(sceneB)).toBe(a);
  });
});
