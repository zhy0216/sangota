import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, updateSettings } from '../src/state/settings';
import { ANIM_SPEED_DIVISOR, dur, shakeIntensity, skipDecor } from '../src/ui/timing';

/**
 * 动画时长换算 — todos/21 t2。
 *
 * 三节：**dur 三档换算**（纯函数，逐档验数）、**shake 挡位**（full 原样 /
 * reduced 减半 / off 跳过）、**接线守护**（`vfx.ts` / `CombatScene.ts` 载着
 * Phaser，Node 下 import 不进来，照 `audioWiring.test.ts` 的技法把源码当
 * 文本查——断的是 instant 跳过清单、hitStop 冻结时长过 dur、镜头只经
 * `screenShake` 摇这几根断了就静默失效的线）。
 *
 * 假 storage 沿用 `settings.test.ts` 的那只。其余时序测试不受影响：
 * 测试环境无 localStorage 时 `getSettings()` 天然落回 DEFAULT_SETTINGS
 * （animSpeed='normal'），dur 是恒等映射——本文件末尾钉死这一点。
 */

// --------------------------------------------------------------- 假 storage

class FakeStorage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }
  key(i: number): string | null {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
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

// --------------------------------------------------------------- dur 三档

describe('dur 按 animSpeed 三档换算', () => {
  it('normal 原值——除数是 1，一毫秒不动', () => {
    withStorage();
    updateSettings({ animSpeed: 'normal' });
    expect(dur(0)).toBe(0);
    expect(dur(333)).toBe(333);
    expect(dur(1700)).toBe(1700);
  });

  it('fast ÷1.6', () => {
    withStorage();
    updateSettings({ animSpeed: 'fast' });
    expect(dur(160)).toBe(100);
    expect(dur(320)).toBe(200);
  });

  it('instant ÷2.5', () => {
    withStorage();
    updateSettings({ animSpeed: 'instant' });
    expect(dur(250)).toBe(100);
    expect(dur(520)).toBe(208);
  });

  it('无 storage 时落回默认 normal——测试环境的其余时序测试因此不被本设置影响', () => {
    // afterEach 已删掉 localStorage；这里显式确认两级兜底：
    // DEFAULT_SETTINGS 的默认挡就是 normal，且 dur 在无账可读时是恒等映射。
    expect(DEFAULT_SETTINGS.animSpeed).toBe('normal');
    expect(dur(460)).toBe(460);
  });

  it('三档除数表与 todo 设计方案一致', () => {
    expect(ANIM_SPEED_DIVISOR).toEqual({ normal: 1, fast: 1.6, instant: 2.5 });
  });
});

describe('skipDecor 只在 instant 挡放行', () => {
  it('normal / fast 不跳过，instant 跳过', () => {
    withStorage();
    updateSettings({ animSpeed: 'normal' });
    expect(skipDecor()).toBe(false);
    updateSettings({ animSpeed: 'fast' });
    expect(skipDecor()).toBe(false);
    updateSettings({ animSpeed: 'instant' });
    expect(skipDecor()).toBe(true);
  });
});

// --------------------------------------------------------------- shake 挡位

describe('shakeIntensity 按 screenShake 三档换算', () => {
  it('full 原样', () => {
    withStorage();
    updateSettings({ screenShake: 'full' });
    expect(shakeIntensity(0.007)).toBe(0.007);
  });

  it('reduced 强度减半', () => {
    withStorage();
    updateSettings({ screenShake: 'reduced' });
    expect(shakeIntensity(0.007)).toBe(0.0035);
    expect(shakeIntensity(0.002)).toBe(0.001);
  });

  it('off 返回 null——调用方整个不摇', () => {
    withStorage();
    updateSettings({ screenShake: 'off' });
    expect(shakeIntensity(0.007)).toBeNull();
  });
});

// --------------------------------------------------------------- 接线守护

const SOURCES: Record<string, string> = import.meta.glob(
  ['../src/ui/vfx.ts', '../src/scenes/CombatScene.ts'],
  { query: '?raw', import: 'default', eager: true },
);
const vfx = SOURCES['../src/ui/vfx.ts'];
const scene = SOURCES['../src/scenes/CombatScene.ts'];

/** 函数体切片，照 `combatScene.test.ts` 的技法：函数头到下一个顶层收笔。 */
const fnBody = (src: string, head: string): string => {
  const at = src.indexOf(head);
  expect(at, head).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\n}', at));
};

describe('instant 跳过清单接在 vfx.ts 里', () => {
  it('纯装饰的三件——尘土、水墨飞溅、屏幕洗色——开头就问 skipDecor', () => {
    for (const head of ['export function dust(', 'export function inkSplash(', 'export function screenPulse(']) {
      expect(fnBody(vfx, head), head).toContain('if (skipDecor()) return;');
    }
  });

  it('伤害数字、护甲变化、命中反馈不许走这个闸', () => {
    // popText 是伤害数字，shieldFlare 是护甲变化，slash/burst 是命中反馈，
    // turnBanner 是回合信息——极速挡也得看得懂战况。
    for (const head of [
      'export function popText(',
      'export function shieldFlare(',
      'export function slash(',
      'export function burst(',
      'export function turnBanner(',
    ]) {
      expect(fnBody(vfx, head), head).not.toContain('skipDecor');
    }
  });

  it('hitStop 的冻结时长过 dur——缩放的轴（tweens.timeScale）不变', () => {
    const body = fnBody(vfx, 'export function hitStop(');
    expect(body).toContain('scene.time.delayedCall(dur(ms)');
    expect(body).toContain('scene.tweens.timeScale = factor');
    expect(body).not.toContain('time.timeScale');
  });

  it('vfx.ts 再无裸的时长字面量——duration/delay/delayedCall/lifespan 全过了 dur', () => {
    expect(vfx).not.toMatch(/duration: \d/);
    expect(vfx).not.toMatch(/delay: \d/);
    expect(vfx).not.toMatch(/delayedCall\(\d/);
    expect(vfx).not.toMatch(/lifespan: \{ min: \d/);
  });
});

describe('屏幕震动只经 screenShake 摇', () => {
  it('vfx.screenShake 是唯一出口：off 不摇、时长过 dur', () => {
    const body = fnBody(vfx, 'export function screenShake(');
    expect(body).toContain('shakeIntensity(intensity)');
    expect(body).toContain('if (strength === null) return;');
    expect(body).toContain('scene.cameras.main.shake(dur(duration), strength)');
  });

  it('CombatScene 里没有绕过挡位的裸 cameras.main.shake', () => {
    expect(scene).not.toContain('this.cameras.main.shake(');
    // 六处震源——全挡下的甲响、命中、连击段、横扫、死亡、作者神罚——
    // 都走 screenShake，继续服从 reduced / off 设置。
    expect(scene.match(/screenShake\(this, /g)).toHaveLength(6);
  });
});

describe('CombatScene 的时长接线', () => {
  it('wait 在唯一出口处过 dur，所有 await this.wait(…) 保持原始毫秒', () => {
    expect(scene).toContain('this.time.delayedCall(dur(ms), resolve)');
    // 调用点不许再包 dur——会双重加速。
    expect(scene).not.toMatch(/this\.wait\(dur\(/);
  });

  it('裸时长字面量只剩四个 repeat: -1 的环境循环（呼吸 ×2、致死脉冲、必杀闪烁）', () => {
    // 机械接线的「别漏」守护：新加一段动画忘了 dur()，这里第一时间响。
    // 环境循环故意不缩放（timing.ts 文件头），也逐个钉死它们真是循环。
    const bare = scene.match(/(?:duration|delay): \d[^,\n]*/g) ?? [];
    expect(bare.sort()).toEqual([
      'duration: 1700', // recoil 里恢复的呼吸
      'duration: 1700 + Math.random() * 600', // makeActorView 的呼吸
      'duration: 300', // setHpPreview 的必杀闪烁 (todos/24 k5)
      'duration: 520', // paintIntent 的致死脉冲
    ]);
    for (const at of [...scene.matchAll(/(?:duration|delay): \d/g)].map((m) => m.index)) {
      expect(scene.slice(at, at + 220)).toContain('repeat: -1');
    }
    expect(scene).not.toMatch(/delayedCall\(\d/);
    expect(scene).not.toMatch(/fade(?:In|Out)\(\d/);
  });

  it('抽牌音的 60ms 错峰故意不过 dur——÷1.6 就掉进 40ms 限流窗被吞声', () => {
    expect(scene).toContain(
      'this.time.delayedCall(drawn * 60, () => this.audio.play(cue.id, cue.opts));',
    );
  });
});
