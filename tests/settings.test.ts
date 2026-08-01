import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_SETTINGS_KEY, AUDIO_SETTINGS_VERSION } from '../src/audio/sfx';
import {
  DEFAULT_SETTINGS,
  defaultSettings,
  getSettings,
  KEY_ACTIONS,
  onSettingsChange,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  updateSettings,
  type Settings,
} from '../src/state/settings';

/**
 * 全局设置 — todos/21 t1 的单例账本。
 *
 * 四件事各有一节：**版本合并**（版本不匹配/字段缺失时逐字段 merge，音量
 * 不丢——todo 验收标准点名）、**逐字段夹取**（clamp、枚举白名单、按键
 * 名单）、**订阅**（有变才广播、退订）、以及 20 音频旧账（`sangota.audio.v1`）
 * 的一次性迁移。假 storage 沿用 `history.test.ts` 的那只——真的在 Node
 * 下不存在，而「不存在」本身也是被测的情形之一。
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

// --------------------------------------------------------------- 默认值与单例

describe('默认值', () => {
  it('DEFAULT_SETTINGS 冻结只读，defaultSettings 每次一份新对象', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.keys)).toBe(true);
    const a = defaultSettings();
    const b = defaultSettings();
    expect(a).toEqual(DEFAULT_SETTINGS);
    expect(a).not.toBe(b);
    expect(a.keys).not.toBe(b.keys);
  });

  it('keys 名单一格不缺——24 战斗交互按 KEY_ACTIONS 逐个取', () => {
    expect(Object.keys(DEFAULT_SETTINGS.keys).sort()).toEqual([...KEY_ACTIONS].sort());
    for (const action of KEY_ACTIONS) {
      expect(DEFAULT_SETTINGS.keys[action].length, action).toBeGreaterThan(0);
    }
  });

  it('无存储时一律默认值，getSettings 每次一份新对象', () => {
    const a = getSettings();
    expect(a).toEqual(DEFAULT_SETTINGS);
    a.musicVolume = 0;
    a.keys.endTurn = 'Q';
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('敌意存储（读写皆炸）——默认值照给，写入不炸', () => {
    const fake = withStorage();
    fake.hostile = true;
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => updateSettings({ musicVolume: 0.5 })).not.toThrow();
  });
});

// --------------------------------------------------------------- 往返与合并

describe('localStorage 往返与版本合并', () => {
  it('写了能读回来，且只写自己的键', () => {
    const fake = withStorage();
    updateSettings({ musicVolume: 0.3, animSpeed: 'fast' });
    const got = getSettings();
    expect(got.musicVolume).toBeCloseTo(0.3);
    expect(got.animSpeed).toBe('fast');
    expect(fake.length).toBe(1);
    expect(fake.getItem(SETTINGS_KEY)).not.toBeNull();
  });

  it('坏 JSON、非对象——回默认，不炸', () => {
    const fake = withStorage();
    fake.setItem(SETTINGS_KEY, '{oops');
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    fake.setItem(SETTINGS_KEY, 'null');
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    fake.setItem(SETTINGS_KEY, '42');
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('版本不匹配不清账——逐字段 merge，用户的音量保得住（验收标准点名）', () => {
    const fake = withStorage();
    fake.setItem(
      SETTINGS_KEY,
      JSON.stringify({ version: 999, musicVolume: 0.15, screenShake: 'off' }),
    );
    const got = getSettings();
    expect(got.version).toBe(SETTINGS_VERSION);
    expect(got.musicVolume).toBeCloseTo(0.15);
    expect(got.screenShake).toBe('off');
    // 缺的字段落回默认——加新选项不重置旧偏好，反之亦然。
    expect(got.animSpeed).toBe(DEFAULT_SETTINGS.animSpeed);
    expect(got.keys).toEqual(DEFAULT_SETTINGS.keys);
  });

  it('字段缺失补默认，账上多出来的野字段不带走', () => {
    const fake = withStorage();
    fake.setItem(
      SETTINGS_KEY,
      JSON.stringify({ version: SETTINGS_VERSION, sfxVolume: 0.5, vsync: true }),
    );
    const got = getSettings();
    expect(got.sfxVolume).toBeCloseTo(0.5);
    expect(got.musicVolume).toBeCloseTo(DEFAULT_SETTINGS.musicVolume);
    expect('vsync' in got).toBe(false);
    expect(Object.keys(got).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('逐字段夹取：数值 clamp、枚举白名单，哪格读不懂只丢哪格', () => {
    const fake = withStorage();
    fake.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        version: SETTINGS_VERSION,
        musicVolume: 7,
        sfxVolume: 'loud',
        renderScale: 5,
        screenShake: 'earthquake',
        animSpeed: 42,
        confirmPlay: 'sometimes',
        fullscreen: 'yes',
        autoEndTurn: true,
      }),
    );
    const got = getSettings();
    expect(got.musicVolume).toBe(1);
    expect(got.sfxVolume).toBe(DEFAULT_SETTINGS.sfxVolume);
    expect(got.renderScale).toBe('auto');
    expect(got.screenShake).toBe('full');
    expect(got.animSpeed).toBe('normal');
    expect(got.confirmPlay).toBe('off');
    expect(got.fullscreen).toBe(false);
    expect(got.autoEndTurn).toBe(true); // 读得懂的那格照收
  });

  it('keys 逐动作夹取：非字符串/空串落默认，名单外的动作不收', () => {
    const fake = withStorage();
    fake.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        version: SETTINGS_VERSION,
        keys: { endTurn: 'Q', cancel: 42, recenter: '', dance: 'Z' },
      }),
    );
    const got = getSettings();
    expect(got.keys.endTurn).toBe('Q');
    expect(got.keys.cancel).toBe(DEFAULT_SETTINGS.keys.cancel);
    expect(got.keys.recenter).toBe(DEFAULT_SETTINGS.keys.recenter);
    expect(Object.keys(got.keys).sort()).toEqual([...KEY_ACTIONS].sort());
  });

  it('updateSettings 的补丁同样过夹取——越界先夹再落账', () => {
    withStorage();
    updateSettings({ musicVolume: 1.5, sfxVolume: -3 });
    const got = getSettings();
    expect(got.musicVolume).toBe(1);
    expect(got.sfxVolume).toBe(0);
  });

  it('updateSettings 的 keys 允许只给一部分动作，其余不动', () => {
    withStorage();
    updateSettings({ keys: { endTurn: 'T' } as Settings['keys'] });
    const got = getSettings();
    expect(got.keys.endTurn).toBe('T');
    expect(got.keys.cancel).toBe(DEFAULT_SETTINGS.keys.cancel);
  });
});

// --------------------------------------------------------------- 订阅

describe('订阅（onSettingsChange）', () => {
  it('有变才广播，广播的是合并后的新值', () => {
    withStorage();
    const cb = vi.fn();
    const off = onSettingsChange(cb);
    updateSettings({ musicVolume: 0.5 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect((cb.mock.calls[0][0] as Settings).musicVolume).toBeCloseTo(0.5);
    expect((cb.mock.calls[0][0] as Settings).animSpeed).toBe('normal');
    // 同值补丁——浅比较无变，不惊动听者。
    updateSettings({ musicVolume: 0.5 });
    updateSettings({});
    expect(cb).toHaveBeenCalledTimes(1);
    off();
  });

  it('退订后不再收，重复退订无害', () => {
    withStorage();
    const cb = vi.fn();
    const off = onSettingsChange(cb);
    updateSettings({ animSpeed: 'instant' });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    off();
    updateSettings({ animSpeed: 'fast' });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('每个听者各拿一份拷贝——谁也改不了谁的，也脏不了账', () => {
    withStorage();
    let first: Settings | null = null;
    let second: Settings | null = null;
    const offA = onSettingsChange((s) => {
      first = s;
      s.musicVolume = 0;
      s.keys.endTurn = 'Q';
    });
    const offB = onSettingsChange((s) => {
      second = s;
    });
    updateSettings({ sfxVolume: 0.4 });
    expect(first).not.toBe(second);
    expect(second!.musicVolume).toBeCloseTo(DEFAULT_SETTINGS.musicVolume);
    expect(second!.keys.endTurn).toBe(DEFAULT_SETTINGS.keys.endTurn);
    expect(getSettings().musicVolume).toBeCloseTo(DEFAULT_SETTINGS.musicVolume);
    offA();
    offB();
  });

  it('无存储时照广播——本次会话内听者与调用方看到同一份值', () => {
    const cb = vi.fn();
    const off = onSettingsChange(cb);
    updateSettings({ musicVolume: 0.5 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect((cb.mock.calls[0][0] as Settings).musicVolume).toBeCloseTo(0.5);
    // 落不了盘，下一次读还是默认——文件头写明的取舍。
    expect(getSettings().musicVolume).toBeCloseTo(DEFAULT_SETTINGS.musicVolume);
    off();
  });
});

// --------------------------------------------------------------- 旧账迁移

describe('20 音频旧账（sangota.audio.v1）的迁移', () => {
  it('总账缺席时捡回旧音量——老玩家升上来不丢账', () => {
    const fake = withStorage();
    fake.setItem(
      AUDIO_SETTINGS_KEY,
      JSON.stringify({ version: AUDIO_SETTINGS_VERSION, music: 0.2, sfx: 0.9 }),
    );
    const got = getSettings();
    expect(got.musicVolume).toBeCloseTo(0.2);
    expect(got.sfxVolume).toBeCloseTo(0.9);
    // 其余字段与旧账无关，照默认。
    expect(got.animSpeed).toBe(DEFAULT_SETTINGS.animSpeed);
  });

  it('旧账读不懂（坏 JSON / 版本不合 / 越界值）——按旧账的规矩兜底', () => {
    const fake = withStorage();
    fake.setItem(AUDIO_SETTINGS_KEY, '{oops');
    expect(getSettings().musicVolume).toBeCloseTo(DEFAULT_SETTINGS.musicVolume);
    fake.setItem(AUDIO_SETTINGS_KEY, JSON.stringify({ version: 999, music: 0.1, sfx: 0.1 }));
    expect(getSettings().musicVolume).toBeCloseTo(DEFAULT_SETTINGS.musicVolume);
    fake.setItem(
      AUDIO_SETTINGS_KEY,
      JSON.stringify({ version: AUDIO_SETTINGS_VERSION, music: 7, sfx: 'loud' }),
    );
    const got = getSettings();
    expect(got.musicVolume).toBe(1);
    expect(got.sfxVolume).toBeCloseTo(DEFAULT_SETTINGS.sfxVolume);
  });

  it('总账在场时旧账被忽略——唯一事实源是 settings', () => {
    const fake = withStorage();
    fake.setItem(
      AUDIO_SETTINGS_KEY,
      JSON.stringify({ version: AUDIO_SETTINGS_VERSION, music: 0.2, sfx: 0.2 }),
    );
    fake.setItem(
      SETTINGS_KEY,
      JSON.stringify({ version: SETTINGS_VERSION, musicVolume: 0.6, sfxVolume: 0.7 }),
    );
    const got = getSettings();
    expect(got.musicVolume).toBeCloseTo(0.6);
    expect(got.sfxVolume).toBeCloseTo(0.7);
  });

  it('迁移后第一次写入落总账，旧账原样不动、从此只读', () => {
    const fake = withStorage();
    const legacy = JSON.stringify({ version: AUDIO_SETTINGS_VERSION, music: 0.2, sfx: 0.9 });
    fake.setItem(AUDIO_SETTINGS_KEY, legacy);
    updateSettings({ animSpeed: 'fast' });
    // 迁移来的音量随第一次写入一并落进总账。
    const got = getSettings();
    expect(got.musicVolume).toBeCloseTo(0.2);
    expect(got.sfxVolume).toBeCloseTo(0.9);
    expect(got.animSpeed).toBe('fast');
    expect(fake.getItem(AUDIO_SETTINGS_KEY)).toBe(legacy);
    expect(fake.getItem(SETTINGS_KEY)).not.toBeNull();
  });
});
